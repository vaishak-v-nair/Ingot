import { runSignals } from './signals/index.ts';
import { mean, mulberry32, stdev } from './text.ts';
import { SCANNER_VERSION } from './types.ts';
import type { Baseline, BaselineStat, DataRecord } from './types.ts';

/**
 * Chunk size is the batch size the reference is valid for. Size-sensitive signals
 * are only comparable near it, which the scorer enforces.
 *
 * Bigger is sharper: every signal is a batch statistic, so its standard error falls
 * as the batch grows. At 300 records the spread of clean human batches swamped a 5%
 * contamination. At 1000 it does not.
 */
export const BASELINE_CHUNK = Number(process.env.INGOT_BATCH ?? 1000);
export const BASELINE_DRAWS = Number(process.env.INGOT_DRAWS ?? 20);

/**
 * A baseline is a distribution, not a threshold.
 *
 * The corpus is cut into disjoint chunks the size of a realistic delivered batch,
 * every signal runs on each chunk, and the mean and spread across chunks become
 * the reference. That is what lets a report say "2.4 standard deviations from the
 * human reference" instead of "above 0.31", which is a number nobody can argue with
 * because nobody knows where it came from.
 */
/**
 * Splits a corpus into a calibration half and a held-out half, randomly and
 * reproducibly. Positional splitting is wrong: public corpora are ordered by
 * category, so the two halves end up with different task mixes and every held-out
 * batch reads as drifted from the reference. That bug put clean human batches at
 * purity 60 instead of ~100.
 */
export const CORPUS_SPLIT_SEED = 0x5b117;

export function splitCorpus(
  records: DataRecord[],
  seed = CORPUS_SPLIT_SEED,
): { calibration: DataRecord[]; holdout: DataRecord[] } {
  const shuffled = records.slice();
  const rand = mulberry32(seed);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const mid = Math.floor(shuffled.length / 2);
  return { calibration: shuffled.slice(0, mid), holdout: shuffled.slice(mid) };
}

export function subsample(records: DataRecord[], size: number, seed: number): DataRecord[] {
  const idx = records.map((_, i) => i);
  const rand = mulberry32(seed);
  // Partial Fisher-Yates: draw `size` distinct indices, no record twice in one batch.
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(rand() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, size).map((i) => records[i]);
}

export function buildBaseline(
  label: string,
  corpus: string,
  records: DataRecord[],
  chunkSize = BASELINE_CHUNK,
  draws = BASELINE_DRAWS,
): Baseline {
  if (records.length < chunkSize * 1.5) {
    throw new Error(
      `${label}: need at least ${Math.ceil(chunkSize * 1.5)} records to calibrate at batch size ` +
        `${chunkSize}, have ${records.length}`,
    );
  }

  // Random subsamples, not sequential slices. Public corpora arrive grouped by
  // category, so sequential chunks measure topic homogeneity rather than provenance,
  // which produced a 60% false positive rate on clean human batches. Subsamples may
  // overlap each other; this is subsampling, and the report says so.
  const chunks: DataRecord[][] = [];
  for (let d = 0; d < draws; d++) chunks.push(subsample(records, chunkSize, 0xba5e0000 + d));

  const collected = new Map<string, number[]>();
  for (const chunk of chunks) {
    for (const s of runSignals(chunk)) {
      if (!s.available || s.value === null) continue;
      const arr = collected.get(s.key);
      if (arr) arr.push(s.value);
      else collected.set(s.key, [s.value]);
    }
  }

  const signals: Record<string, BaselineStat> = {};
  for (const [key, values] of collected) {
    if (values.length < 3) continue;
    signals[key] = { mean: mean(values), sd: stdev(values), n: values.length };
  }

  return { label, corpus, records: records.length, chunkSize, signals };
}

export const BASELINE_NOTE =
  `Baselines are estimated from ${BASELINE_DRAWS} random ${BASELINE_CHUNK}-record subsamples of ` +
  `the first half of each corpus. Subsamples may overlap each other, so the spread is a ` +
  `subsampling estimate rather than one from independent batches. Every record scored in the ` +
  `spike test comes from the held-out second half, so nothing that calibrated the reference is ` +
  `ever scored against it. Scanner ${SCANNER_VERSION}.`;
