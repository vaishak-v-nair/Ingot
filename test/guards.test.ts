import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBatch } from '../src/loader.ts';
import { runSignals } from '../src/signals/index.ts';
import { scoreBatch } from '../src/scorer.ts';
import { DegenerateBatchError, EmptyBatchError, InsufficientBatchError, SchemaMismatchError } from '../src/errors.ts';
import { MIN_BATCH_RECORDS, SCANNER_VERSION } from '../src/types.ts';
import type { BaselinePair, DataRecord, LoadResult } from '../src/types.ts';

const dir = mkdtempSync(join(tmpdir(), 'ingot-test-'));

function writeJsonl(name: string, rows: unknown[]): string {
  const p = join(dir, name);
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n'), 'utf8');
  return p;
}

function syntheticRecords(n: number, seedText: (i: number) => string): DataRecord[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, text: seedText(i) }));
}

function fakeLoad(records: DataRecord[]): LoadResult {
  return { records, totalLines: records.length, skipped: [], encodingNormalized: false };
}

function pairWith(humanSd: number, machineSd: number): BaselinePair {
  const stat = (mean: number, sd: number) => ({ mean, sd, n: 20 });
  return {
    human: {
      label: 'h',
      corpus: 'h',
      records: 1000,
      chunkSize: 40,
      signals: { template: stat(0.02, humanSd), length_shape: stat(0.45, humanSd) },
    },
    machine: {
      label: 'm',
      corpus: 'm',
      records: 1000,
      chunkSize: 40,
      signals: { template: stat(0.04, machineSd), length_shape: stat(0.4, machineSd) },
    },
    builtAt: new Date().toISOString(),
    scannerVersion: SCANNER_VERSION,
    note: 'test',
  };
}

test('loader refuses a batch with no text field instead of guessing', () => {
  const p = writeJsonl('noschema.jsonl', [{ foo: 'bar', baz: 1 }]);
  assert.throws(() => loadBatch(p), SchemaMismatchError);
});

test('loader refuses an empty batch', () => {
  const p = writeJsonl('empty.jsonl', []);
  assert.throws(() => loadBatch(p), EmptyBatchError);
});

test('loader counts unparseable lines rather than dropping them silently', () => {
  const p = join(dir, 'broken.jsonl');
  writeFileSync(p, ['{"text":"a real record with enough words to matter here"}', '{not json', ''].join('\n'), 'utf8');
  const result = loadBatch(p);
  assert.equal(result.records.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].line, 2);
});

test('signals refuse a batch with no variance', () => {
  const records = syntheticRecords(40, () => 'the same sentence repeated forever and ever again');
  assert.throws(() => runSignals(records), DegenerateBatchError);
});

test('scorer refuses batches below the minimum record count', () => {
  const records = syntheticRecords(MIN_BATCH_RECORDS - 1, (i) => `record number ${i} with a few distinct words in it`);
  const signals = runSignals(records);
  assert.throws(() => scoreBatch('tiny', records, signals, pairWith(0.005, 0.005), fakeLoad(records)), InsufficientBatchError);
});

test('zero reference variance yields no score, never a NaN', () => {
  const records = syntheticRecords(40, (i) => `sentence ${i}. Another clause here, with variety. And a third one too.`);
  const signals = runSignals(records);
  const report = scoreBatch('zerosd', records, signals, pairWith(0, 0), fakeLoad(records));
  assert.equal(report.purity, null);
  assert.equal(report.refusal, 'no comparable signals');
  const baselined = new Set(['template', 'length_shape']);
  for (const s of report.signals) {
    assert.equal(s.usedInScore, false);
    if (s.available && baselined.has(s.key)) {
      assert.match(s.skipReason ?? '', /reference variance is zero/);
    }
  }
});

test('purity is always either null or a finite value in range, never NaN', () => {
  const records = syntheticRecords(60, (i) =>
    `Response ${i}. It has a short clause. Then a considerably longer one that keeps going for a while, adding detail.`,
  );
  const report = scoreBatch('ok', records, runSignals(records), pairWith(0.004, 0.004), fakeLoad(records));
  if (report.purity !== null) {
    assert.ok(Number.isFinite(report.purity));
    assert.ok(report.purity >= -50 && report.purity <= 150);
  }
});

test('a batch sitting on the human reference scores near 100', () => {
  const records = syntheticRecords(60, (i) =>
    `Response ${i}. Short clause. Then a considerably longer one that keeps going for a while, adding real detail.`,
  );
  const signals = runSignals(records);

  // Build references around this batch's own measurements: human mean = observed,
  // machine mean = four noise-widths away. The batch then sits exactly on human.
  const pair = pairWith(0.004, 0.004);
  pair.human.signals = {};
  pair.machine.signals = {};
  pair.human.chunkSize = records.length;
  for (const s of signals) {
    if (!s.available || s.value === null) continue;
    const sd = Math.max(Math.abs(s.value) * 0.02, 1e-6);
    pair.human.signals[s.key] = { mean: s.value, sd, n: 20 };
    pair.machine.signals[s.key] = { mean: s.value + 4 * sd, sd, n: 20 };
  }

  const report = scoreBatch('on-human', records, signals, pair, fakeLoad(records));
  assert.ok(report.purity !== null, 'a batch on the human reference must be scorable');
  assert.ok(report.purity >= 95, `expected purity >= 95, got ${report.purity}`);
});

test('a batch sitting on the machine reference scores near 0', () => {
  const records = syntheticRecords(60, (i) =>
    `Response ${i}. Short clause. Then a considerably longer one that keeps going for a while, adding real detail.`,
  );
  const signals = runSignals(records);

  const pair = pairWith(0.004, 0.004);
  pair.human.signals = {};
  pair.machine.signals = {};
  pair.human.chunkSize = records.length;
  for (const s of signals) {
    if (!s.available || s.value === null) continue;
    const sd = Math.max(Math.abs(s.value) * 0.02, 1e-6);
    pair.human.signals[s.key] = { mean: s.value - 4 * sd, sd, n: 20 };
    pair.machine.signals[s.key] = { mean: s.value, sd, n: 20 };
  }

  const report = scoreBatch('on-machine', records, signals, pair, fakeLoad(records));
  assert.ok(report.purity !== null);
  assert.ok(report.purity <= 5, `expected purity <= 5, got ${report.purity}`);
});

test('stylometry declines when no annotator ids are present', () => {
  const records = syntheticRecords(40, (i) => `Text ${i} with several words so the signal has something to chew on.`);
  const stylometry = runSignals(records).find((s) => s.key === 'stylometry');
  assert.ok(stylometry);
  assert.equal(stylometry.available, false);
  assert.match(stylometry.reason ?? '', /annotator_id/);
});

test('stylometry declines when authors have too few records', () => {
  const records = syntheticRecords(40, (i) => `Text ${i} with several words so the signal has something to chew on.`).map(
    (r, i) => ({ ...r, authorId: `a${i % 4}` }),
  );
  const stylometry = runSignals(records).find((s) => s.key === 'stylometry');
  assert.ok(stylometry);
  assert.equal(stylometry.available, false);
  assert.match(stylometry.reason ?? '', /records/);
});

test('size-sensitive signals decline when the batch size differs from calibration', () => {
  const records = syntheticRecords(40, (i) => `Row ${i}. Words vary here. Some sentences run longer than others do.`);
  const pair = pairWith(0.004, 0.004);
  pair.human.signals.near_dup = { mean: 0.01, sd: 0.002, n: 20 };
  pair.machine.signals.near_dup = { mean: 0.05, sd: 0.002, n: 20 };
  pair.human.chunkSize = 1000; // batch is 40, so 25x off
  const report = scoreBatch('sizemismatch', records, runSignals(records), pair, fakeLoad(records));
  const nearDup = report.signals.find((s) => s.key === 'near_dup');
  assert.ok(nearDup);
  assert.equal(nearDup.usedInScore, false);
  assert.match(nearDup.skipReason ?? '', /calibrated at 1000 records/);
});
