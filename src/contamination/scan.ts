import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
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

  // A line ends at '\n' and nowhere else — the same rule the browser path applies, because
  // the two surfaces must agree on what a line is. This used to be readline, which also
  // breaks on U+2028/U+2029. Those are legal UNESCAPED inside a JSON string, so a document
  // containing one was three unparseable fragments here and one clean document in the
  // browser: same bytes, two different reports, on the pair of surfaces whose agreement
  // this product promises. Found by scanning our own derived corpus, not by a test.
  //
  // Bytes are counted on the RAW stream, before decoding — the browser counts them the
  // same way. This used to count the re-encoded decoded string, and the two disagree the
  // moment a corpus carries an invalid byte: it decodes to U+FFFD, which re-encodes as
  // three bytes where the raw stream had one, and the byte count folds into the corpus
  // hash — same shard, two identities, on the pair of surfaces whose agreement this
  // product promises. TextDecoder with {stream: true} keeps multibyte sequences whole
  // across chunk boundaries, exactly as setEncoding did; the trailing \r of CRLF corpora
  // is removed by the caller's trim, exactly as before.
  const decoder = new TextDecoder('utf-8');
  return (async function* () {
    let carry = '';
    for await (const chunk of input as AsyncIterable<Buffer>) {
      onBytes(chunk.length);
      carry += decoder.decode(chunk, { stream: true });
      let nl = carry.indexOf('\n');
      while (nl !== -1) {
        yield carry.slice(0, nl);
        carry = carry.slice(nl + 1);
        nl = carry.indexOf('\n');
      }
    }
    carry += decoder.decode();
    if (carry.length > 0) yield carry;
  })();
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
  //
  // The full digest is SHA-256 over the trimmed non-empty lines JOINED BY \n. The
  // separator is load-bearing: without it ["abcd","ef"] and ["abc","def"] — two corpora
  // that parse into different documents — hashed identically, so the "stronger
  // attestation" did not bind line structure at all. It is still a canonicalized-line
  // digest rather than a digest of the file's raw bytes (trim and blank-line removal are
  // deliberate, so the .gz and the file it expands to agree); the receipt says so.
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
  // Same accounting as the browser path: a corpus where every line skips must surface as
  // an unread corpus, never as a clean scan. The CLI feeds the published registry, which
  // makes it the worst possible place for the green-zero silent failure.
  let totalLines = 0;
  let skippedLines = 0;
  for (const path of paths) {
    const lines = openLines(path, (n) => {
      readBytes += n;
    });

    try {
      for await (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        fullHasher.update(trimmed);
        fullHasher.update('\n');
        portable.add(trimmed);
        totalLines++;

        const parsed = parseCorpusLine(trimmed, session.corpusDocs + 1, options.textField, options.idField);
        if (!parsed) { skippedLines++; continue; }

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

  const report = session.finish({
    corpusName: name,
    corpusHash: await portable.digest(corpusBytes),
    corpusHashFull: fullHasher.digest('hex'),
    corpusBytes,
    corpusParts: paths.length > 1 ? paths.map((p) => basename(p)) : undefined,
    command: options.command ?? `node src/cli.ts contaminate --index <index> --corpus ${name}`,
    elapsedMs: Date.now() - started,
  });
  report.load = { totalLines, skipped: skippedLines };
  return report;
}
