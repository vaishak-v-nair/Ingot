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
 * A 5 GB file works the same as a 5 MB one, and a gzipped shard works the same as the
 * file it expands to: decompression is streamed, and — matching the command line's
 * documented rule — corpus bytes are counted UNCOMPRESSED, because that is what the
 * corpus is. Scanning `shard.jsonl.gz` and the `shard.jsonl` it expands to must produce
 * the same corpus hash or the two reports could not be compared.
 */
export async function scanFile(
  index: NgramIndex,
  file: File,
  options: BrowserScanOptions = {},
): Promise<ContaminationReport> {
  const started = performance.now();
  const session = new ScanSession(index, { maxCorpusDocFrequency: options.maxCorpusDocFrequency });

  // Gzip is detected by its magic bytes, not the filename — a renamed shard is still a
  // shard. Real pretraining corpora ship gzipped; expanding 20 GB onto disk first is a
  // cost with nothing to show for it.
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const isGzip = head.length === 2 && head[0] === 0x1f && head[1] === 0x8b;
  if (isGzip && typeof DecompressionStream === 'undefined') {
    throw new Error(
      'this browser cannot decompress gzip — unzip the file first, or use the command line, which reads .gz directly',
    );
  }

  // Two counters, two jobs. Progress is measured in bytes CONSUMED FROM THE FILE,
  // because file.size is the only total we know — for a gzipped file that is compressed
  // bytes. The corpus itself is measured in bytes fed to the text decoder — uncompressed,
  // the same number the CLI counts — because the hash digest is bound to it.
  let fileBytesRead = 0;
  let corpusBytes = 0;
  const fileCounter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      fileBytesRead += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const corpusCounter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      corpusBytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });

  let byteStream = file.stream().pipeThrough(fileCounter);
  if (isGzip) byteStream = byteStream.pipeThrough(new DecompressionStream('gzip'));
  const reader = byteStream.pipeThrough(corpusCounter).pipeThrough(new TextDecoderStream()).getReader();
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
        options.onProgress(session.corpusDocs, session.corpusTokens, fileBytesRead);
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
    corpusHash: await hasher.digest(corpusBytes),
    corpusBytes,
    command: options.command ?? `node src/cli.ts contaminate --index <index> --corpus ${file.name}`,
    elapsedMs: Math.round(performance.now() - started),
  });
  report.load = { totalLines, skipped: skippedLines };
  return report;
}

export { NgramIndex, decodeIndex, gunzipIfNeeded };
export { renderContaminationReport, reportFileName } from './reportHtml.ts';
export type { ContaminationReport, NgramIndexData };
