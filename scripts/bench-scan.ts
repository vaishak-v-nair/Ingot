/**
 * Phase-by-phase throughput profile of a contamination scan.
 *
 * Two rules, both learned the hard way. Measure before optimising: n-gram hashing was
 * 84% of scan time and tokenizing only 9%, the opposite of the guess. And make the
 * measurement stable before believing it: an earlier version timed each phase once
 * while streaming from disk, and reported 903ms and 3290ms for the same code path on
 * consecutive runs. Any conclusion drawn from that was noise.
 *
 * So: corpus is read once into memory, each phase runs REPS times over the same array,
 * and the reported figure is the minimum. Minimum, not mean, because interference only
 * ever adds time.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBatch } from '../src/loader.ts';
import { hashTokens } from '../src/contamination/fastTokens.ts';
import { NgramIndex, forEachNgramHashed } from '../src/contamination/ngramIndex.ts';

const SOURCE = resolve('data/machine-alpaca.jsonl');
const BIG = resolve('data/bench-corpus.jsonl');
const REPEATS = 6;
const REPS = 3;
const N = 13;

if (!existsSync(BIG)) {
  process.stdout.write(`  building bench corpus (${REPEATS}x alpaca)...\n`);
  const raw = readFileSync(SOURCE, 'utf8').trimEnd();
  const parts: string[] = [];
  for (let r = 0; r < REPEATS; r++) {
    for (const line of raw.split('\n')) {
      const row = JSON.parse(line) as Record<string, unknown>;
      row.id = `${String(row.id)}-r${r}`;
      parts.push(JSON.stringify(row));
    }
  }
  writeFileSync(BIG, parts.join('\n') + '\n', 'utf8');
}

const corpusBytes = statSync(BIG).size;

// I/O and parse, measured once and separately. It is not what we optimise.
const ioStart = Date.now();
const raw = readFileSync(BIG, 'utf8');
const texts: string[] = [];
for (const line of raw.split('\n')) {
  if (!line) continue;
  const row = JSON.parse(line) as Record<string, unknown>;
  if (typeof row.text === 'string') texts.push(row.text);
}
const ioMs = Date.now() - ioStart;

const bench = loadBatch(SOURCE)
  .records.slice(0, 2000)
  .map((r) => ({ id: r.id, text: r.text }));
const index = NgramIndex.build('bench', bench, { n: N });

// Exact token count, so the rate is not resting on a bytes-per-token guess.
let realTokens = 0;
for (const t of texts) realTokens += hashTokens(t).count;

process.stdout.write(
  `\n  corpus ${(corpusBytes / 1e6).toFixed(1)} MB, ${texts.length.toLocaleString()} docs, ` +
    `${realTokens.toLocaleString()} tokens\n` +
    `  index ${index.size.toLocaleString()} grams from ${bench.length} items\n` +
    `  read + JSON.parse: ${ioMs}ms (measured once, not the target of optimisation)\n\n`,
);

type Phase = { name: string; run: (text: string) => void };

const phases: Phase[] = [
  { name: 'A baseline (loop only)', run: () => {} },
  { name: 'B fused tokenize/hash', run: (t) => void hashTokens(t) },
  {
    name: 'C + ngram rolling',
    run: (t) => {
      const { hashes, count } = hashTokens(t);
      forEachNgramHashed(hashes, count, N, () => {});
    },
  },
  {
    name: 'D + index lookup (full)',
    run: (t) => {
      const { hashes, count } = hashTokens(t);
      forEachNgramHashed(hashes, count, N, (key) => {
        index.lookup(key);
      });
    },
  },
];

function timePhase(phase: Phase): number {
  for (const t of texts) phase.run(t); // warm up, let the JIT settle
  let best = Number.POSITIVE_INFINITY;
  for (let r = 0; r < REPS; r++) {
    const t0 = Date.now();
    for (const t of texts) phase.run(t);
    best = Math.min(best, Date.now() - t0);
  }
  return best;
}

process.stdout.write(
  `  ${'phase'.padEnd(26)}${'best ms'.padStart(9)}${'delta ms'.padStart(10)}${'tok/sec'.padStart(14)}\n` +
    `  ${'─'.repeat(59)}\n`,
);

let prev = 0;
let full = 0;
for (const phase of phases) {
  const ms = timePhase(phase);
  const rate = Math.round(realTokens / (ms / 1000));
  process.stdout.write(
    `  ${phase.name.padEnd(26)}${String(ms).padStart(9)}${String(ms - prev).padStart(10)}${rate.toLocaleString().padStart(14)}\n`,
  );
  prev = ms;
  full = ms;
}

const mbPerSec = corpusBytes / 1e6 / (full / 1000);
process.stdout.write(
  `\n  scan throughput: ${mbPerSec.toFixed(1)} MB/sec (CPU only, ${REPS} reps, best of)\n` +
    `  20 GB would take ${((20_000 / mbPerSec) / 60).toFixed(1)} minutes single-threaded\n\n`,
);
