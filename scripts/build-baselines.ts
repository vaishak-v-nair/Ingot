/**
 * Builds the reference distributions from the FIRST half of each corpus.
 * The spike test uses the second half, so nothing that calibrated the reference
 * is ever scored against it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBatch } from '../src/loader.ts';
import { BASELINE_NOTE, buildBaseline, splitCorpus } from '../src/baseline.ts';
import { SCANNER_VERSION } from '../src/types.ts';
import type { BaselinePair } from '../src/types.ts';

const HUMAN_PATH = process.env.INGOT_HUMAN ?? 'data/human-dolly.jsonl';
const MACHINE_PATH = process.env.INGOT_MACHINE ?? 'data/machine-alpaca.jsonl';

const humanAll = loadBatch(resolve(HUMAN_PATH)).records;
const machineAll = loadBatch(resolve(MACHINE_PATH)).records;

const humanHalf = splitCorpus(humanAll).calibration;
const machineHalf = splitCorpus(machineAll).calibration;

process.stdout.write(
  `  human corpus   ${humanAll.length.toLocaleString()} records, calibrating on ${humanHalf.length.toLocaleString()}\n` +
    `  machine corpus ${machineAll.length.toLocaleString()} records, calibrating on ${machineHalf.length.toLocaleString()}\n\n`,
);

const PAIRED = MACHINE_PATH.includes('paired');
const machineLabel = PAIRED
  ? `paired regeneration (${process.env.INGOT_MODEL ?? 'claude-sonnet-5'})`
  : 'alpaca-52k (text-davinci-003)';

const pair: BaselinePair = {
  human: buildBaseline('dolly-15k (human-authored)', 'databricks/databricks-dolly-15k', humanHalf),
  machine: buildBaseline(machineLabel, MACHINE_PATH, machineHalf),
  builtAt: new Date().toISOString(),
  scannerVersion: SCANNER_VERSION,
  note: BASELINE_NOTE,
};

mkdirSync(resolve('data'), { recursive: true });
writeFileSync(resolve('data/baselines.json'), JSON.stringify(pair, null, 2), 'utf8');

const keys = new Set([...Object.keys(pair.human.signals), ...Object.keys(pair.machine.signals)]);
process.stdout.write(`  ${'signal'.padEnd(22)}${'human'.padStart(12)}${'machine'.padStart(12)}${'separation'.padStart(13)}\n`);
process.stdout.write(`  ${'─'.repeat(59)}\n`);
for (const k of keys) {
  const h = pair.human.signals[k];
  const m = pair.machine.signals[k];
  if (!h || !m) {
    process.stdout.write(`  ${k.padEnd(22)}${(h ? h.mean.toFixed(4) : '—').padStart(12)}${(m ? m.mean.toFixed(4) : '—').padStart(12)}${'one-sided'.padStart(13)}\n`);
    continue;
  }
  const sep = h.sd > 0 ? Math.abs(m.mean - h.mean) / h.sd : Number.POSITIVE_INFINITY;
  const sepText = Number.isFinite(sep) ? `${sep.toFixed(2)}σ` : 'inf';
  process.stdout.write(`  ${k.padEnd(22)}${h.mean.toFixed(4).padStart(12)}${m.mean.toFixed(4).padStart(12)}${sepText.padStart(13)}\n`);
}
process.stdout.write(`\n  wrote data/baselines.json\n  next: node scripts/spike.ts\n\n`);
