import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { CorpusStreamError } from '../errors.ts';
import { CorpusHasher } from './corpusHash.ts';
import { NgramIndex } from './ngramIndex.ts';
import { parseCorpusLine, ScanSession } from './scanSession.ts';
import type { BenchmarkItem, ContaminationReport } from './types.ts';

/**
 * Node entry point. Streams a JSONL corpus from disk into a ScanSession.
 *
 * The scanning algorithm itself lives in scanSession.ts, shared with the browser build,
 * so the two can never produce different numbers for the same input.
 */
export type ScanOptions = {
  textField?: string;
  idField?: string;
  /**
   * Benchmark text, when available. Without it only the exact tier can run: near and
   * semantic tiers need the benchmark side, and a published index carries no text.
   */
  benchmarkItems?: BenchmarkItem[];
  /** A matched gram in more than this many distinct corpus documents is ordinary language. */
  maxCorpusDocFrequency?: number;
  /** Recorded in the receipt so a reader can reproduce this exact report. */
  command?: string;
  /** Name for a sharded corpus, which has no single filename of its own. */
  corpusName?: string;
  onProgress?: (docs: number, tokens: number) => void;
};

/**
 * Opens one corpus file as a line stream, decompressing when the name says to.
 *
 * A pretraining corpus is always shipped gzipped, and expanding 20 GB onto disk before
 * scanning it is a cost with nothing to show for it. Decompression is streamed, so peak
 * memory is a buffer rather than a corpus.
 *
 * `onBytes` counts *uncompressed* bytes, because that is what the corpus is. Scanning
 * `shard.jsonl.gz` and scanning the `shard.jsonl` it expands to are the same scan, and
 * must produce the same corpus hash or the two could not be compared.
 */
function openLines(path: string, onBytes: (n: number) => void): AsyncIterable<string> {
  let raw: ReturnType<typeof createReadStream>;
  try {
    raw = createReadStream(path);
  } catch (err) {
    throw new CorpusStreamError(basename(path), String(err));
  }

  let input: Readable = raw;
  if (path.endsWith('.gz')) {
    const gunzip = createGunzip();
    // Without this the gzip error surfaces as an unhandled 'error' on the source stream
    // and takes the process down instead of the scan.
    raw.on('error', (err) => gunzip.destroy(err));
    input = raw.pipe(gunzip);
  }

  input.on('data', (chunk: Buffer | string) => {
    onBytes(typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length);
  });

  return createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
}

export async function scanCorpus(
  index: NgramIndex,
  corpus: string | string[],
  options: ScanOptions = {},
): Promise<ContaminationReport> {
  const started = Date.now();
  const paths = typeof corpus === 'string' ? [corpus] : corpus;
  if (paths.length === 0) throw new CorpusStreamError('(none)', 'no corpus files given');

  // Two hashes on this path. The sampled one is what a browser can also compute, so the
  // two surfaces produce comparable identities; the full one is the stronger attestation
  // and exists only here. Reporting both beats quietly picking one.
  const fullHasher = createHash('sha256');
  const portable = new CorpusHasher();
  const session = new ScanSession(index, {
    benchmarkItems: options.benchmarkItems,
    maxCorpusDocFrequency: options.maxCorpusDocFrequency,
  });

  // Shards feed one session in order, so the result is identical to scanning the single
  // file they concatenate to — which is the only way a sharded corpus and a whole one can
  // be compared. Both hashes accumulate across the whole sequence for the same reason.
  let readBytes = 0;
  for (const path of paths) {
    const lines = openLines(path, (n) => {
      readBytes += n;
    });

    try {
      for await (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        fullHasher.update(trimmed);
        portable.add(trimmed);

        const parsed = parseCorpusLine(trimmed, session.corpusDocs + 1, options.textField, options.idField);
        if (!parsed) continue;

        session.addDocument(parsed.docId, parsed.text);

        if (options.onProgress && session.corpusDocs % 20_000 === 0) {
          options.onProgress(session.corpusDocs, session.corpusTokens);
        }
      }
    } catch (err) {
      throw new CorpusStreamError(basename(path), String(err));
    }
  }

  const single = paths.length === 1 && !paths[0].endsWith('.gz');
  // A plain single file keeps reporting its size from the filesystem: every corpus hash
  // published so far was computed that way, and a counted total would silently reissue
  // them all. The two agree anyway; this only removes the chance that they ever don't.
  const corpusBytes = single ? statSync(paths[0]).size : readBytes;
  const name = options.corpusName ?? (paths.length === 1 ? basename(paths[0]) : `${basename(paths[0])} +${paths.length - 1} more`);

  return session.finish({
    corpusName: name,
    corpusHash: await portable.digest(corpusBytes),
    corpusHashFull: fullHasher.digest('hex'),
    corpusBytes,
    corpusParts: paths.length > 1 ? paths.map((p) => basename(p)) : undefined,
    command: options.command ?? `node src/cli.ts contaminate --index <index> --corpus ${name}`,
    elapsedMs: Date.now() - started,
  });
}
