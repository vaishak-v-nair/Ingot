/**
 * Scans benchmarks against a real pretraining corpus.
 *
 * The registry's first pass used instruction-tuning sets of a few million tokens and found
 * nothing. That result was honest but uninformative: contamination enters during
 * pretraining, so a null result on fine-tuning data says almost nothing about whether a
 * benchmark leaked. This is the same scan pointed at the place the answer lives.
 *
 *   node scripts/fetch-pretraining.ts --shards 26 --out ../corpora/c4-en
 *   node scripts/pretraining-scan.ts --corpus ../corpora/c4-en
 *
 * One pass per (benchmark, n). The benchmarks are deliberately NOT merged into a single
 * index to save passes: the discriminative filter drops grams shared across benchmark
 * items, so a merged index would silently drop text that two different benchmarks happen
 * to share and suppress real findings. Each pass here is exactly what
 * `ingot contaminate --index <name>` produces, which is what makes it reproducible.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadBatch } from '../src/loader.ts';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { scanCorpus } from '../src/contamination/scan.ts';
import { DEFAULT_N, LEGACY_N } from '../src/contamination/types.ts';
import { SCANNER_VERSION } from '../src/types.ts';
import type { BenchmarkItem, ContaminationHit } from '../src/contamination/types.ts';

const BENCHMARKS = [
  { name: 'gsm8k', path: 'data/bench/gsm8k.jsonl', licence: 'MIT', note: 'test split, question text' },
  { name: 'humaneval', path: 'data/bench/humaneval.jsonl', licence: 'MIT', note: 'prompt: signature + docstring' },
  { name: 'mmlu', path: 'data/bench/mmlu.jsonl', licence: 'MIT', note: 'test split, question + choices' },
];

type Manifest = {
  corpus: string;
  licence: string;
  source: string;
  fetchedAt: string;
  shards: { name: string; url: string; bytes: number; sha256: string }[];
};

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const corpusDir = resolve(flag('corpus', '../corpora/c4-en'));
const shardLimit = Number(flag('shards', '0')) || 0;
const nValues = flag('n', '') ? [Number(flag('n', ''))] : [DEFAULT_N, LEGACY_N];
const outName = flag('out', 'pretraining-c4');
// A single pass over 21 GB costs the better part of an hour, so re-examining one
// benchmark should not mean re-scanning all three.
const only = flag('benchmark', '');

const manifestPath = join(corpusDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  process.stderr.write(`\n  no manifest at ${manifestPath}\n  run: node scripts/fetch-pretraining.ts\n\n`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
const shards = (shardLimit > 0 ? manifest.shards.slice(0, shardLimit) : manifest.shards).map((s) => ({
  ...s,
  path: join(corpusDir, s.name),
}));

const missing = shards.filter((s) => !existsSync(s.path));
if (missing.length > 0) {
  process.stderr.write(`\n  ${missing.length} shard(s) named in the manifest are not on disk\n\n`);
  process.exit(2);
}

const compressedBytes = shards.reduce((a, s) => a + s.bytes, 0);
const corpusName = `c4-en-${shards.length}shards`;

type PairResult = {
  benchmark: string;
  corpus: string;
  n: number;
  itemsTotal: number;
  itemsHit: number;
  rate: number;
  totalMatches: number;
  uncheckableItems: number;
  corpusDocs: number;
  corpusTokens: number;
  corpusBytes: number;
  corpusHash: string;
  elapsedMs: number;
  throughputMBs: number;
  /** Matches the corpus-frequency filter discarded as ordinary language. */
  droppedGeneric: number;
  contaminatedItemIds: string[];
  samples: ContaminationHit[];
};

const results: PairResult[] = [];

process.stdout.write(`\n  INGOT — benchmarks against a pretraining corpus — ${SCANNER_VERSION}\n\n`);
process.stdout.write(`  corpus   ${manifest.corpus} · ${shards.length} shards · ${(compressedBytes / 1e9).toFixed(2)} GB gzipped\n`);
process.stdout.write(`  licence  ${manifest.licence}\n`);
process.stdout.write(`  passes   ${BENCHMARKS.length * nValues.length} (one per benchmark per n)\n\n`);

for (const b of BENCHMARKS) {
  if (only && b.name !== only) continue;
  if (!existsSync(resolve(b.path))) {
    process.stdout.write(`  ${b.name}: missing, run scripts/fetch-benchmarks.ts\n`);
    continue;
  }
  const items: BenchmarkItem[] = loadBatch(resolve(b.path)).records.map((r) => ({
    id: r.id,
    text: r.text,
    subject: undefined,
  }));

  for (const n of nValues) {
    const index = NgramIndex.build(b.name, items, { n });
    const started = Date.now();
    let lastTick = started;

    const report = await scanCorpus(
      index,
      shards.map((s) => s.path),
      {
        corpusName,
        command: `node scripts/pretraining-scan.ts --corpus ${corpusDir} --n ${n}`,
        onProgress: (docs, tokens) => {
          const now = Date.now();
          if (now - lastTick < 15_000) return;
          lastTick = now;
          const secs = (now - started) / 1000;
          process.stdout.write(
            `    ${b.name} n=${n}  ${(docs / 1e6).toFixed(2)}M docs · ${(tokens / 1e6).toFixed(0)}M tokens · ${secs.toFixed(0)}s\n`,
          );
        },
      },
    );

    const exact = report.tiers.find((t) => t.tier === 'exact')!;
    const throughput = report.receipt.corpusBytes / 1e6 / (report.elapsedMs / 1000);

    results.push({
      benchmark: b.name,
      corpus: corpusName,
      n,
      itemsTotal: items.length,
      itemsHit: exact.itemsHit,
      rate: exact.itemsHit / items.length,
      totalMatches: exact.totalHits,
      uncheckableItems: index.stats.uncheckableItems,
      corpusDocs: report.corpusDocs,
      corpusTokens: report.corpusTokens,
      corpusBytes: report.receipt.corpusBytes,
      corpusHash: report.corpusHash,
      elapsedMs: report.elapsedMs,
      throughputMBs: throughput,
      droppedGeneric: exact.droppedGeneric ?? 0,
      contaminatedItemIds: report.contaminatedItemIds,
      // Every retained hit, not a slice of them. At this scale the evidence IS the
      // finding: deciding whether 865 matches are leakage or canonical text cannot be
      // done from 25 of them, and the scanner already caps what it keeps.
      samples: exact.hits,
    });

    process.stdout.write(
      `  ${b.name.padEnd(10)} n=${n}  ` +
        `${String(exact.itemsHit).padStart(6)}/${String(items.length).padEnd(6)} items ` +
        `(${((exact.itemsHit / items.length) * 100).toFixed(3).padStart(7)}%)  ` +
        `${String(exact.totalHits).padStart(7)} matches  ` +
        `${String(exact.droppedGeneric ?? 0).padStart(6)} dropped  ` +
        `${(report.elapsedMs / 1000).toFixed(0).padStart(4)}s  ${throughput.toFixed(1)} MB/s\n`,
    );
  }
  process.stdout.write('\n');
}

mkdirSync(resolve('results'), { recursive: true });
const payload = {
  scanner: SCANNER_VERSION,
  defaultN: DEFAULT_N,
  legacyN: LEGACY_N,
  corpus: {
    name: corpusName,
    licence: manifest.licence,
    source: manifest.source,
    fetchedAt: manifest.fetchedAt,
    shardCount: shards.length,
    compressedBytes,
    uncompressedBytes: results[0]?.corpusBytes ?? 0,
    // Every shard with its digest: the scan hashes the concatenation, so without the
    // ordered part list the corpus hash attests to bytes nobody can reassemble.
    shards: shards.map((s) => ({ name: s.name, bytes: s.bytes, sha256: s.sha256 })),
  },
  benchmarks: BENCHMARKS,
  results,
};
writeFileSync(resolve(`results/${outName}.json`), JSON.stringify(payload, null, 2) + '\n', 'utf8');

process.stdout.write(`  wrote results/${outName}.json\n\n`);
