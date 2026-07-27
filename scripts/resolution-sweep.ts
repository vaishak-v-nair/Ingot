/**
 * Sensitivity analysis: how does the instrument's resolution change with batch size?
 *
 * For each batch size, calibrate references on the calibration halves, then score
 * clean held-out human batches. The spread of those clean scores IS the resolution:
 * contamination smaller than that spread cannot be distinguished from noise.
 *
 * Run before quoting any detection floor. Batch size is the single biggest lever and
 * picking it by taste rather than measurement is how you end up quoting a number the
 * data does not support.
 */
import { loadBatch } from '../src/loader.ts';
import { buildBaseline, splitCorpus, subsample } from '../src/baseline.ts';
import { runSignals } from '../src/signals/index.ts';
import { scoreBatch } from '../src/scorer.ts';
import { mean, stdev } from '../src/text.ts';
import { SCANNER_VERSION } from '../src/types.ts';
import type { BaselinePair, DataRecord, LoadResult } from '../src/types.ts';
import { resolve } from 'node:path';

const SIZES = [200, 300, 500, 800, 1200];
const CONTROLS = 8;
const SPIKE_RATIOS = [0.05, 0.1, 0.25];

const HUMAN_PATH = process.env.INGOT_HUMAN ?? 'data/human-dolly.jsonl';
const MACHINE_PATH = process.env.INGOT_MACHINE ?? 'data/machine-alpaca.jsonl';
const PAIRED = MACHINE_PATH.includes('paired');

const humanAll = loadBatch(resolve(HUMAN_PATH)).records;
const machineAll = loadBatch(resolve(MACHINE_PATH)).records;
const human = splitCorpus(humanAll);
const machine = splitCorpus(machineAll);

function fakeLoad(records: DataRecord[]): LoadResult {
  return { records, totalLines: records.length, skipped: [], encodingNormalized: false };
}

function purityOf(name: string, records: DataRecord[], pair: BaselinePair): number | null {
  return scoreBatch(name, records, runSignals(records), pair, fakeLoad(records)).purity;
}

process.stdout.write(
  `\n  RESOLUTION SWEEP — ${SCANNER_VERSION}\n` +
    `  human   ${HUMAN_PATH} (${humanAll.length} records)\n` +
    `  machine ${MACHINE_PATH} (${machineAll.length} records)` +
    `${PAIRED ? '  [prompt-matched, no task-distribution confound]' : '  [NOT prompt-matched: separation may reflect task mix, not provenance]'}\n` +
    `  human calibration ${human.calibration.length}, held out ${human.holdout.length}\n\n` +
    `  ${'batch'.padStart(6)}${'clean mean'.padStart(12)}${'clean sd'.padStart(10)}` +
    `${'5%'.padStart(8)}${'10%'.padStart(8)}${'25%'.padStart(8)}${'floor'.padStart(9)}${'signals'.padStart(9)}\n` +
    `  ${'─'.repeat(70)}\n`,
);

const results: Record<string, unknown>[] = [];

for (const size of SIZES) {
  if (human.holdout.length < size * 1.3 || human.calibration.length < size * 1.5) {
    process.stdout.write(`  ${String(size).padStart(6)}   skipped, human pool too small for this batch size\n`);
    continue;
  }

  const pair: BaselinePair = {
    human: buildBaseline('dolly-15k (human)', 'databricks-dolly-15k', human.calibration, size, 20),
    machine: buildBaseline('alpaca-52k (davinci-003)', 'stanford_alpaca', machine.calibration, size, 20),
    builtAt: new Date().toISOString(),
    scannerVersion: SCANNER_VERSION,
    note: 'resolution sweep',
  };

  const controls: number[] = [];
  for (let c = 0; c < CONTROLS; c++) {
    const p = purityOf(`clean-${size}-${c}`, subsample(human.holdout, size, 0xc00100 + c * 7919 + size), pair);
    if (p !== null) controls.push(p);
  }
  const cleanMean = mean(controls);
  const cleanSd = stdev(controls);

  const spikes: Record<string, number | null> = {};
  for (const r of SPIKE_RATIOS) {
    const mCount = Math.round(size * r);
    const records = [
      ...subsample(human.holdout, size - mCount, 0x5b1ce0 + size + mCount),
      ...subsample(machine.holdout, mCount, 0x9a1e00 + size + mCount),
    ];
    spikes[String(r)] = purityOf(`spike-${size}-${r}`, records, pair);
  }

  // A ratio is detected when it lands more than 2 clean-control SD below the clean mean.
  const detected = SPIKE_RATIOS.find((r) => {
    const p = spikes[String(r)];
    return p !== null && cleanSd > 0 && cleanMean - p > 2 * cleanSd;
  });

  const usedSignals = Object.keys(pair.human.signals).filter((k) => {
    const h = pair.human.signals[k];
    const m = pair.machine.signals[k];
    return h && m && h.sd > 0 && m.sd > 0 && Math.abs(m.mean - h.mean) / h.sd >= 0.25;
  }).length;

  process.stdout.write(
    `  ${String(size).padStart(6)}${cleanMean.toFixed(1).padStart(12)}${cleanSd.toFixed(1).padStart(10)}` +
      `${String(spikes['0.05'] ?? '—').padStart(8)}${String(spikes['0.1'] ?? '—').padStart(8)}` +
      `${String(spikes['0.25'] ?? '—').padStart(8)}` +
      `${(detected ? `${detected * 100}%` : 'none').padStart(9)}${String(usedSignals).padStart(9)}\n`,
  );

  results.push({ size, cleanMean, cleanSd, controls, spikes, detectedFloor: detected ?? null, usedSignals });
}

process.stdout.write('\n');
