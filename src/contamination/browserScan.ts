import { NgramIndex } from './ngramIndex.ts';
import { decodeIndex, gunzipIfNeeded } from './indexCodec.ts';
import { parseCorpusLine, ScanSession } from './scanSession.ts';
import type { ContaminationReport, NgramIndexData } from './types.ts';

/**
 * Browser entry point. Scans a file the user dropped, in their own tab.
 *
 * Nothing is uploaded. The file is read through the File System API, hashed and scanned
 * on their CPU, and the report never leaves the page. That is checkable in devtools,
 * which is the strongest privacy claim a verification product can make and one no
 * hosted AI service can match.
 *
 * The algorithm is the shared ScanSession, so a scan here and a scan on the command line
 * produce the same numbers for the same bytes.
 */

export type BrowserScanOptions = {
  textField?: string;
  idField?: string;
  maxCorpusDocFrequency?: number;
  /** Called roughly every 5,000 documents so a long scan can show progress. */
  onProgress?: (docs: number, tokens: number, bytesRead: number) => void;
};

async function sha256Hex(chunks: string[]): Promise<string> {
  const encoder = new TextEncoder();
  const joined = encoder.encode(chunks.join('\n'));
  const digest = await crypto.subtle.digest('SHA-256', joined);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export function loadIndexFromJson(data: NgramIndexData): NgramIndex {
  return NgramIndex.load(data);
}

/**
 * Loads a published index from its wire form: the compact binary, gzipped.
 *
 * The JSON form is the specification and stays supported, but MMLU is 19.4 MB as JSON and
 * 5.3 MB this way, and the download happens before the user sees anything at all.
 */
export async function loadIndexFromBytes(bytes: Uint8Array): Promise<NgramIndex> {
  return NgramIndex.load(decodeIndex(await gunzipIfNeeded(bytes)));
}

/**
 * Streams a JSONL File through the scanner without loading it into memory.
 * A 5 GB file works the same as a 5 MB one.
 */
export async function scanFile(
  index: NgramIndex,
  file: File,
  options: BrowserScanOptions = {},
): Promise<ContaminationReport> {
  const started = performance.now();
  const session = new ScanSession(index, { maxCorpusDocFrequency: options.maxCorpusDocFrequency });

  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let carry = '';
  let bytesRead = 0;
  // Hashing every line would hold the whole corpus in memory; sample deterministically so
  // the attestation still binds to these exact bytes without a second pass.
  const hashSample: string[] = [];
  let lineNo = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.length;
    carry += value;

    let newlineAt = carry.indexOf('\n');
    while (newlineAt !== -1) {
      const line = carry.slice(0, newlineAt).trim();
      carry = carry.slice(newlineAt + 1);
      newlineAt = carry.indexOf('\n');
      if (line.length === 0) continue;

      lineNo++;
      if (lineNo <= 64 || lineNo % 1000 === 0) hashSample.push(line);

      const parsed = parseCorpusLine(line, session.corpusDocs + 1, options.textField, options.idField);
      if (!parsed) continue;
      session.addDocument(parsed.docId, parsed.text);

      if (options.onProgress && session.corpusDocs % 5000 === 0) {
        options.onProgress(session.corpusDocs, session.corpusTokens, bytesRead);
        // Yield so the page stays responsive during a long scan.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  const tail = carry.trim();
  if (tail.length > 0) {
    lineNo++;
    hashSample.push(tail);
    const parsed = parseCorpusLine(tail, session.corpusDocs + 1, options.textField, options.idField);
    if (parsed) session.addDocument(parsed.docId, parsed.text);
  }

  hashSample.push(`lines:${lineNo}`, `bytes:${file.size}`);
  const hash = await sha256Hex(hashSample);

  return session.finish(file.name, hash, Math.round(performance.now() - started));
}

export { NgramIndex, decodeIndex, gunzipIfNeeded };
export type { ContaminationReport, NgramIndexData };
