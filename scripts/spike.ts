/**
 * The spike test. This is both the test suite and the headline result.
 *
 * Human records are contaminated with machine records at known ratios. The purity
 * score must fall monotonically as contamination rises. The detection floor is the
 * lowest ratio that separates from the clean-human control.
 *
 * Also reports the false positive rate: clean human batches that would be flagged
 * at the operating threshold. Volunteering that number is what makes the rest
 * believable.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBatch } from '../src/loader.ts';
import { runSignals } from '../src/signals/index.ts';
import { scoreBatch } from '../src/scorer.ts';
import { mean, mulberry32, stdev } from '../src/text.ts';
import { BASELINE_CHUNK, splitCorpus, subsample } from '../src/baseline.ts';
import { loadBaselines } from '../src/cli.ts';
import type { DataRecord, LoadResult } from '../src/types.ts';

const RATIOS = [0, 0.05, 0.1, 0.25, 0.5];
/** Must match BASELINE_CHUNK, or size-sensitive signals decline to compare. */
const BATCH_SIZE = BASELINE_CHUNK;
const CONTROL_BATCHES = 8;
const DRAWS_PER_RATIO = 5;
const OPERATING_THRESHOLD = 85;

function shuffled<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function fakeLoad(records: DataRecord[]): LoadResult {
  return { records, totalLines: records.length, skipped: [], encodingNormalized: false };
}

function score(name: string, records: DataRecord[]) {
  const signals = runSignals(records);
  return scoreBatch(name, records, signals, pair, fakeLoad(records));
}

const pair = loadBaselines(resolve('data/baselines.json'));

const HUMAN_PATH = process.env.INGOT_HUMAN ?? 'data/human-dolly.jsonl';
const MACHINE_PATH = process.env.INGOT_MACHINE ?? 'data/machine-alpaca.jsonl';

const humanAll = loadBatch(resolve(HUMAN_PATH)).records;
const machineAll = loadBatch(resolve(MACHINE_PATH)).records;

// Held-out halves only, using the same random split the baselines used.
const humanPool = splitCorpus(humanAll).holdout;
const machinePool = splitCorpus(machineAll).holdout;

if (humanPool.length < BATCH_SIZE * 1.5) {
  process.stderr.write(
    `  held-out human pool has ${humanPool.length} records, need ${Math.ceil(BATCH_SIZE * 1.5)} ` +
      `to draw distinct ${BATCH_SIZE}-record batches. Reduce BASELINE_CHUNK.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `\n  SPIKE TEST — ${pair.human.label} contaminated with ${pair.machine.label}\n` +
    `  batch size ${BATCH_SIZE}, drawn from held-out halves ` +
    `(human pool ${humanPool.length.toLocaleString()}, machine pool ${machinePool.length.toLocaleString()})\n` +
    `  batches are random subsamples and may overlap each other\n\n`,
);

const rows: {
  ratio: number;
  purities: number[];
  mean: number;
  sd: number;
  confidence: string;
}[] = [];

// Several draws per ratio. A single draw is one sample from a noisy distribution and
// reading a curve off single draws is how you convince yourself of a trend that isn't there.
for (const ratio of RATIOS) {
  const machineCount = Math.round(BATCH_SIZE * ratio);
  const humanCount = BATCH_SIZE - machineCount;
  const purities: number[] = [];
  let confidence = 'low';

  for (let d = 0; d < DRAWS_PER_RATIO; d++) {
    const records = [
      ...subsample(humanPool, humanCount, 0x5b1ce0 + machineCount * 31 + d * 7919),
      ...subsample(machinePool, machineCount, 0x9a1e00 + machineCount * 17 + d * 6271),
    ];
    const report = score(
      `spike-${Math.round(ratio * 100)}pct-d${d}`,
      shuffled(records, 0xc0ffee + machineCount + d),
    );
    if (report.purity !== null) purities.push(report.purity);
    confidence = report.confidence;
  }

  const m = mean(purities);
  const sd = stdev(purities);
  rows.push({ ratio, purities, mean: m, sd, confidence });

  process.stdout.write(
    `  ${(ratio * 100).toFixed(0).padStart(3)}% machine   purity ${m.toFixed(1).padStart(5)} ± ${sd
      .toFixed(1)
      .padStart(4)}   (${purities.length} draws)   confidence ${confidence}\n`,
  );
}

process.stdout.write(`\n  CONTROL — ${CONTROL_BATCHES} clean human batches (false positive check)\n\n`);
const controls: number[] = [];
for (let c = 0; c < CONTROL_BATCHES; c++) {
  const records = subsample(humanPool, BATCH_SIZE, 0xc07401 + c * 7919);
  const report = score(`control-${c + 1}`, records);
  if (report.purity !== null) controls.push(report.purity);
  process.stdout.write(`  control ${c + 1}          purity ${String(report.purity).padStart(3)}/100\n`);
}

const falsePositives = controls.filter((p) => p < OPERATING_THRESHOLD).length;
const monotonic = rows.every((r, i) => i === 0 || r.mean <= rows[i - 1].mean);

const cleanMean = mean(controls);
const cleanSd = stdev(controls);
const floorRow = rows.find((r) => r.ratio > 0 && cleanSd > 0 && cleanMean - r.mean > 2 * cleanSd);

const summary = {
  scanner: pair.scannerVersion,
  humanReference: pair.human.label,
  machineReference: pair.machine.label,
  batchSize: BATCH_SIZE,
  operatingThreshold: OPERATING_THRESHOLD,
  monotonic,
  cleanControl: { batches: controls.length, purities: controls, mean: cleanMean, sd: cleanSd },
  falsePositiveRate: controls.length ? falsePositives / controls.length : null,
  detectionFloor: floorRow ? floorRow.ratio : null,
  rows,
  generatedAt: new Date().toISOString(),
  note: pair.note,
};

mkdirSync(resolve('results'), { recursive: true });
writeFileSync(resolve('results/spike.json'), JSON.stringify(summary, null, 2), 'utf8');

const md = [
  `# Ingot spike test`,
  ``,
  `Scanner ${pair.scannerVersion}. Human reference ${pair.human.label}, machine reference ${pair.machine.label}.`,
  `Batch size ${BATCH_SIZE}. Baselines built on the first half of each corpus; every record scored here comes from the held-out second half.`,
  ``,
  `Each contamination level is ${DRAWS_PER_RATIO} independent draws; the figure is mean ± standard deviation.`,
  ``,
  `| machine contamination | purity | draws | confidence |`,
  `|---|---|---|---|`,
  ...rows.map(
    (r) =>
      `| ${(r.ratio * 100).toFixed(0)}% | ${r.mean.toFixed(1)} ± ${r.sd.toFixed(1)} | ${r.purities.length} | ${r.confidence} |`,
  ),
  ``,
  `Monotonic: **${monotonic ? 'yes' : 'no'}**`,
  `Clean-human control: ${controls.length} batches, purity mean ${cleanMean.toFixed(1)}, sd ${cleanSd.toFixed(1)}`,
  `False positive rate at purity < ${OPERATING_THRESHOLD}: **${
    controls.length ? `${((falsePositives / controls.length) * 100).toFixed(0)}% (${falsePositives}/${controls.length})` : 'n/a'
  }**`,
  `Detection floor (first ratio more than 2 control SD below the clean mean): **${
    floorRow ? `${(floorRow.ratio * 100).toFixed(0)}%` : 'not reached within tested ratios'
  }**`,
  ``,
  `## Stated limitations`,
  ``,
  `- The machine reference is 2023-era text-davinci-003 output. Current frontier output is harder to separate. Treat this curve as an upper bound, not a claim about 2026 models.`,
  `- Cross-author stylometry, the strongest signal on a real vendor batch, is unavailable here because neither public corpus ships annotator ids.`,
  `- Evidence is batch-level. Ingot makes no determination about any single record.`,
  ``,
].join('\n');

writeFileSync(resolve('results/spike.md'), md, 'utf8');

process.stdout.write(
  `\n  monotonic: ${monotonic ? 'yes' : 'NO — investigate before quoting this'}\n` +
    `  clean control mean ${cleanMean.toFixed(1)} (sd ${cleanSd.toFixed(1)})\n` +
    `  false positive rate at purity < ${OPERATING_THRESHOLD}: ${
      controls.length ? `${((falsePositives / controls.length) * 100).toFixed(0)}% (${falsePositives}/${controls.length})` : 'n/a'
    }\n` +
    `  detection floor: ${floorRow ? `${(floorRow.ratio * 100).toFixed(0)}%` : 'not reached in tested ratios'}\n\n` +
    `  wrote results/spike.json and results/spike.md\n\n`,
);
