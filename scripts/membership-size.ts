/**
 * Measures whether a browser could ever hold a corpus-side membership structure.
 *
 * The scanner's shape is asymmetric on purpose: it indexes the SMALL text and streams the
 * BIG one. For the benchmark wing that is exactly right — a benchmark is small, a corpus
 * is not. For a writer checking their own words it is backwards. Their writing is the
 * small text, so the thing that would have to be streamed is 21 GB of C4, and no browser
 * streams 21 GB.
 *
 * The proposed inversion is a membership structure built over the CORPUS n-grams, small
 * enough to download, that the page queries locally. Whether that is possible is arithmetic
 * — n-gram count times bits per element — and the design doc records it as an open question
 * with the size math explicitly unproven and a decision due. This script supplies the
 * measured inputs so the decision is made against C4 as it actually is rather than against
 * an estimate of it.
 *
 * What it measures, using the scanner's own tokenizer and the scanner's own rolling gram
 * hash, so the counts are the scanner's and not an approximation of it:
 *
 *   - grams per uncompressed byte, which extrapolates linearly to the whole corpus
 *   - DISTINCT grams, which does not: new grams arrive ever more slowly as documents
 *     accumulate, so the growth is sampled at checkpoints and Heaps' law is fitted to
 *     those points rather than assumed
 *   - the same two counts under hash winnowing, where only grams whose key falls in a
 *     1/rate slice are kept — the one lever that changes the size by orders of magnitude
 *
 * Distinct counting is exact on the sample and held in a Set, which is what bounds the
 * sample size. That is the honest trade: an exact count on 20,000 documents plus a fitted
 * curve beats an approximate count on all of them, because the extrapolation error
 * dominates either way and a fitted curve exposes its own uncertainty.
 *
 *   node scripts/membership-size.ts
 *   node scripts/membership-size.ts --docs 40000 --shard ../corpora/c4-en/c4-train.00000-of-01024.json.gz
 */
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGunzip } from 'node:zlib';
import { hashTokens } from '../src/contamination/fastTokens.ts';
import { forEachNgramHashed } from '../src/contamination/ngramIndex.ts';
import { DEFAULT_N } from '../src/contamination/types.ts';
import { jsonlLines } from './triage-rules.ts';

const argv = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) {
    process.stderr.write(`\n  --${name} needs a value\n\n`);
    process.exit(2);
  }
  return v;
}

const shardPath = flag('shard', '../corpora/c4-en/c4-train.00000-of-01024.json.gz');
const docLimit = Number(flag('docs', '20000'));
if (!Number.isInteger(docLimit) || docLimit <= 0) {
  process.stderr.write('\n  --docs must be a positive integer\n\n');
  process.exit(2);
}

/**
 * Winnowing rates to measure. 1 is the full set. The others keep grams whose key is
 * congruent to zero — a deterministic, corpus-independent slice, so a writer's browser and
 * the corpus build agree on which grams exist without exchanging anything.
 */
const WINNOW_RATES = [1, 16, 64, 256];

/** The published corpus this extrapolates to. Both figures come from results/. */
const c4 = JSON.parse(readFileSync(resolve('results/pretraining-c4.json'), 'utf8')) as {
  corpus: { uncompressedBytes: number; shardCount: number };
};

const CORPUS_BYTES = c4.corpus.uncompressedBytes;

type Checkpoint = { docs: number; bytes: number; totalGrams: number; distinctGrams: number };

const seen = new Map<number, Set<number>>();
for (const r of WINNOW_RATES) seen.set(r, new Set<number>());

const totalGrams = new Map<number, number>();
for (const r of WINNOW_RATES) totalGrams.set(r, 0);

const checkpoints: Checkpoint[] = [];
const CHECKPOINT_AT = new Set([1000, 2000, 5000, 10000, 20000, 40000, 80000]);

let docs = 0;
let bytes = 0;

process.stdout.write(`\n  reading ${shardPath}\n  n=${DEFAULT_N}, stride 1, scanner tokenizer\n\n`);

const stream = createReadStream(resolve(shardPath)).pipe(createGunzip());

for await (const line of jsonlLines(stream)) {
  const trimmed = line.trim();
  if (!trimmed) continue;

  let text: string;
  try {
    text = (JSON.parse(trimmed) as { text?: string }).text ?? '';
  } catch {
    // A shard that will not parse is a fetch problem, not a measurement problem, and
    // silently skipping would understate the corpus. Say so and stop.
    process.stderr.write(`\n  unparseable line at document ${docs + 1}\n\n`);
    process.exit(1);
  }
  if (!text) continue;

  bytes += Buffer.byteLength(text, 'utf8');
  const { hashes, count } = hashTokens(text);
  forEachNgramHashed(hashes, count, DEFAULT_N, (key) => {
    for (const rate of WINNOW_RATES) {
      if (rate === 1 || key % rate === 0) {
        totalGrams.set(rate, totalGrams.get(rate)! + 1);
        seen.get(rate)!.add(key);
      }
    }
  });

  docs++;
  if (CHECKPOINT_AT.has(docs)) {
    checkpoints.push({ docs, bytes, totalGrams: totalGrams.get(1)!, distinctGrams: seen.get(1)!.size });
    process.stdout.write(
      `  ${String(docs).padStart(6)} docs  ${(bytes / 1e6).toFixed(1).padStart(7)} MB  ` +
        `${totalGrams.get(1)!.toLocaleString('en-US').padStart(12)} grams  ` +
        `${seen.get(1)!.size.toLocaleString('en-US').padStart(12)} distinct\n`,
    );
  }
  if (docs >= docLimit) break;
}
stream.destroy();

if (checkpoints.length < 2) {
  process.stderr.write('\n  need at least two checkpoints to fit a curve; raise --docs\n\n');
  process.exit(1);
}

/**
 * Heaps' law: distinct = K * total^beta. Fitted by least squares in log space over the
 * checkpoints, which is the standard treatment and, more to the point, lets the fit be
 * checked against its own points instead of trusted.
 */
function fitHeaps(points: Checkpoint[]): { K: number; beta: number; maxRelErr: number } {
  const xs = points.map((p) => Math.log(p.totalGrams));
  const ys = points.map((p) => Math.log(p.distinctGrams));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const beta = num / den;
  const K = Math.exp(my - beta * mx);
  let maxRelErr = 0;
  for (const p of points) {
    const pred = K * p.totalGrams ** beta;
    maxRelErr = Math.max(maxRelErr, Math.abs(pred - p.distinctGrams) / p.distinctGrams);
  }
  return { K, beta, maxRelErr };
}

const { K, beta, maxRelErr } = fitHeaps(checkpoints);

const gramsPerByte = totalGrams.get(1)! / bytes;
const corpusTotalGrams = gramsPerByte * CORPUS_BYTES;
const corpusDistinct = K * corpusTotalGrams ** beta;

/** Bits per element for a Bloom filter at a target false-positive rate. */
const bloomBits = (eps: number): number => Math.log2(1 / eps) / Math.LN2;

/**
 * Passage lengths a writer might plausibly want checked, in words. Twenty is a sentence;
 * a thousand is a short essay.
 */
const PASSAGE_WORDS = [20, 50, 100, 200, 500, 1000];

/**
 * What winnowing costs. A passage of L words yields L-n+1 grams, of which a 1/rate slice
 * survives, so detection stops being certain and becomes a probability that depends on how
 * much the writer wrote. This is the number that decides whether the trade is acceptable,
 * and it is the number a report would have to disclose.
 */
function detectionProbability(words: number, rate: number): number {
  const grams = Math.max(0, words - DEFAULT_N + 1);
  if (rate === 1) return grams > 0 ? 1 : 0;
  return 1 - (1 - 1 / rate) ** grams;
}

/** Bloom false positives are per query, and a document issues one query per surviving gram. */
function expectedFalsePositives(words: number, rate: number, eps: number): number {
  const grams = Math.max(0, words - DEFAULT_N + 1);
  return (grams / rate) * eps;
}

const sizes = WINNOW_RATES.map((rate) => {
  // Winnowing keeps a fixed fraction of gram OCCURRENCES, so the distinct count scales by
  // the same fraction to first order. Measured on the sample rather than assumed.
  const sampleDistinct = seen.get(rate)!.size;
  const share = sampleDistinct / seen.get(1)!.size;
  const distinct = corpusDistinct * share;
  return {
    winnowRate: rate,
    sampleDistinct,
    shareOfDistinct: share,
    projectedCorpusDistinct: Math.round(distinct),
    bytesAt1pct: Math.round((distinct * bloomBits(0.01)) / 8),
    bytesAt10pct: Math.round((distinct * bloomBits(0.1)) / 8),
    detection: PASSAGE_WORDS.map((w) => ({ words: w, probability: detectionProbability(w, rate) })),
    falsePositivesPer1000Words: expectedFalsePositives(1000, rate, 0.01),
  };
});

process.stdout.write('\n  projection to the full published corpus\n\n');
process.stdout.write(`  corpus                ${(CORPUS_BYTES / 1e9).toFixed(2)} GB uncompressed, ${c4.corpus.shardCount} shards\n`);
process.stdout.write(`  grams per byte        ${gramsPerByte.toFixed(4)}\n`);
process.stdout.write(`  total grams           ${corpusTotalGrams.toLocaleString('en-US', { maximumFractionDigits: 0 })}\n`);
process.stdout.write(`  Heaps fit             distinct = ${K.toFixed(3)} * total^${beta.toFixed(4)}  (max fit error ${(maxRelErr * 100).toFixed(1)}%)\n`);
process.stdout.write(`  distinct grams        ${corpusDistinct.toLocaleString('en-US', { maximumFractionDigits: 0 })}\n\n`);

process.stdout.write('  bloom filter size by winnowing rate\n\n');
process.stdout.write('  rate    distinct grams        at 1% FP        at 10% FP\n');
for (const s of sizes) {
  process.stdout.write(
    `  1/${String(s.winnowRate).padEnd(4)} ${s.projectedCorpusDistinct.toLocaleString('en-US').padStart(18)}  ` +
      `${(s.bytesAt1pct / 1e6).toFixed(1).padStart(10)} MB  ${(s.bytesAt10pct / 1e6).toFixed(1).padStart(13)} MB\n`,
  );
}

process.stdout.write('\n  what winnowing costs: detection probability by passage length\n\n');
process.stdout.write(`  rate  ${PASSAGE_WORDS.map((w) => `${w}w`.padStart(8)).join('')}    FP per 1000w @1%\n`);
for (const s of sizes) {
  process.stdout.write(
    `  1/${String(s.winnowRate).padEnd(4)}${s.detection.map((d) => `${(d.probability * 100).toFixed(1)}%`.padStart(8)).join('')}` +
      `${s.falsePositivesPer1000Words.toFixed(3).padStart(20)}\n`,
  );
}

mkdirSync(resolve('results'), { recursive: true });
writeFileSync(
  resolve('results/membership-size.json'),
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      shard: shardPath,
      n: DEFAULT_N,
      stride: 1,
      sample: { docs, bytes, totalGrams: totalGrams.get(1)!, distinctGrams: seen.get(1)!.size },
      checkpoints,
      heaps: { K, beta, maxRelativeError: maxRelErr },
      corpus: { uncompressedBytes: CORPUS_BYTES, shardCount: c4.corpus.shardCount },
      projected: { gramsPerByte, totalGrams: corpusTotalGrams, distinctGrams: corpusDistinct },
      sizes,
      note:
        'Distinct-gram projection is a Heaps-law extrapolation from a single-shard sample, ' +
        'not a measurement of the whole corpus. Bloom sizes are the structure alone and ' +
        'exclude any index, header or transport overhead. Winnowing shares are measured on ' +
        'the sample and assumed to hold at corpus scale.',
    },
    null,
    2,
  ),
  'utf8',
);

process.stdout.write('\n  wrote results/membership-size.json\n\n');
