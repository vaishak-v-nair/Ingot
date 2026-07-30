import { NgramIndex } from './ngramIndex.ts';
import { CorpusHasher } from './corpusHash.ts';
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
  /** Recorded in the receipt: the command-line invocation that reproduces this report. */
  command?: string;
  /** Called roughly every 5,000 documents so a long scan can show progress. */
  onProgress?: (docs: number, tokens: number, bytesRead: number) => void;
};

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

  // Bytes are counted BEFORE the decoder: a decoded string's .length is UTF-16 code
  // units, and dividing that by the file's byte size makes the progress bar (and the
  // ETA built on it) wrong by up to 3× on CJK-heavy corpora.
  let bytesRead = 0;
  const byteCounter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesRead += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const reader = file.stream().pipeThrough(byteCounter).pipeThrough(new TextDecoderStream()).getReader();
  let carry = '';
  // A line the parser cannot read is skipped, and skipped lines must reach the report:
  // a file where every line skips is an unread file, and an unread file that presented
  // as a clean scan would be the exact silent failure this project documents.
  let totalLines = 0;
  let skippedLines = 0;
  // Shared with the command line, so the same file yields the same corpus identity on
  // either surface. Two implementations of one sampling rule would drift, and reports
  // that cannot be compared are reports nobody can check.
  const hasher = new CorpusHasher();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += value;

    let newlineAt = carry.indexOf('\n');
    while (newlineAt !== -1) {
      const line = carry.slice(0, newlineAt).trim();
      carry = carry.slice(newlineAt + 1);
      newlineAt = carry.indexOf('\n');
      if (line.length === 0) continue;

      hasher.add(line);
      totalLines++;

      const parsed = parseCorpusLine(line, session.corpusDocs + 1, options.textField, options.idField);
      if (!parsed) { skippedLines++; continue; }
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
    hasher.add(tail);
    totalLines++;
    const parsed = parseCorpusLine(tail, session.corpusDocs + 1, options.textField, options.idField);
    if (parsed) session.addDocument(parsed.docId, parsed.text);
    else skippedLines++;
  }

  const report = session.finish({
    corpusName: file.name,
    corpusHash: await hasher.digest(file.size),
    corpusBytes: file.size,
    command: options.command ?? `node src/cli.ts contaminate --index <index> --corpus ${file.name}`,
    elapsedMs: Math.round(performance.now() - started),
  });
  report.load = { totalLines, skipped: skippedLines };
  return report;
}

export { NgramIndex, decodeIndex, gunzipIfNeeded };
export { renderContaminationReport, reportFileName } from './reportHtml.ts';
export type { ContaminationReport, NgramIndexData };
