import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
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
  onProgress?: (docs: number, tokens: number) => void;
};

export async function scanCorpus(
  index: NgramIndex,
  corpusPath: string,
  options: ScanOptions = {},
): Promise<ContaminationReport> {
  const started = Date.now();
  // Two hashes on this path. The sampled one is what a browser can also compute, so the
  // two surfaces produce comparable identities; the full one is the stronger attestation
  // and exists only here. Reporting both beats quietly picking one.
  const fullHasher = createHash('sha256');
  const portable = new CorpusHasher();
  const session = new ScanSession(index, {
    benchmarkItems: options.benchmarkItems,
    maxCorpusDocFrequency: options.maxCorpusDocFrequency,
  });

  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(corpusPath, { encoding: 'utf8' });
  } catch (err) {
    throw new CorpusStreamError(basename(corpusPath), String(err));
  }

  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  try {
    for await (const line of rl) {
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
  } finally {
    rl.close();
    stream.close();
  }

  const corpusBytes = statSync(corpusPath).size;
  const name = basename(corpusPath);

  return session.finish({
    corpusName: name,
    corpusHash: await portable.digest(corpusBytes),
    corpusHashFull: fullHasher.digest('hex'),
    corpusBytes,
    command: options.command ?? `node src/cli.ts contaminate --index <index> --corpus ${name}`,
    elapsedMs: Date.now() - started,
  });
}
