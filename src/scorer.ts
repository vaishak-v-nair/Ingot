import { InsufficientBatchError, ScoreComputationError } from './errors.ts';
import { MIN_BATCH_RECORDS, SCANNER_VERSION, SIZE_SENSITIVE_SIGNALS, STRENGTH_WEIGHT } from './types.ts';
import type {
  BaselinePair,
  Confidence,
  DataRecord,
  LoadResult,
  ScanReport,
  ScoredSignal,
  SignalResult,
} from './types.ts';

/** A signal whose two baselines sit closer than this cannot separate the classes. */
const MIN_SEPARATION_SD = 0.25;

/** How far outside the human-to-machine interval a batch may sit before the signal declines. */
const OUT_OF_RANGE_MARGIN = 0.5;

/** Cap on separation-based weighting, so one very sharp signal cannot own the score. */
const MAX_SIGNAL_WEIGHT = 6;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function scoreBatch(
  batchName: string,
  records: DataRecord[],
  signals: SignalResult[],
  pair: BaselinePair,
  load: LoadResult,
): ScanReport {
  if (records.length < MIN_BATCH_RECORDS) {
    throw new InsufficientBatchError(records.length, MIN_BATCH_RECORDS);
  }

  const scored: ScoredSignal[] = signals.map((s) => {
    const base: ScoredSignal = {
      ...s,
      machineLikeness: null,
      zVsHuman: null,
      separationSd: null,
      weight: STRENGTH_WEIGHT[s.strength],
      usedInScore: false,
    };

    if (!s.available || s.value === null) {
      base.skipReason = s.reason ?? 'signal unavailable';
      return base;
    }

    const h = pair.human.signals[s.key];
    const m = pair.machine.signals[s.key];
    if (!h || !m) {
      base.skipReason = 'no reference baseline for this signal';
      return base;
    }

    if (SIZE_SENSITIVE_SIGNALS.has(s.key)) {
      const calibratedAt = pair.human.chunkSize;
      const ratio = records.length / calibratedAt;
      if (ratio > 2 || ratio < 0.5) {
        base.skipReason =
          `this signal moves with batch size and the reference was calibrated at ` +
          `${calibratedAt} records, not ${records.length}. Rebuild baselines at this batch size.`;
        return base;
      }
    }

    base.zVsHuman = h.sd > 0 ? (s.value - h.mean) / h.sd : null;

    // Zero reference variance means the statistic is pinned at a floor or ceiling on
    // these corpora, not that it separates them perfectly. Treating it as infinite
    // separating power divides by zero and hands back a NaN score.
    if (h.sd <= 0 || m.sd <= 0) {
      base.skipReason =
        `reference variance is zero on this signal (human sd ${h.sd}, machine sd ${m.sd}), ` +
        `so it carries no information at this batch size`;
      return base;
    }

    const delta = m.mean - h.mean;
    const separation = Math.abs(delta) / h.sd;
    base.separationSd = Number.isFinite(separation) ? separation : null;
    if (!Number.isFinite(separation) || separation < MIN_SEPARATION_SD) {
      base.skipReason =
        `reference corpora are only ${separation.toFixed(2)} SD apart on this signal, ` +
        `too close to separate`;
      return base;
    }

    const likeness = (s.value - h.mean) / delta;
    if (!Number.isFinite(likeness)) {
      base.skipReason = 'position between references is not finite';
      return base;
    }
    base.machineLikeness = likeness;

    // Refuse to extrapolate. A batch far outside the interval the two references
    // span is unlike BOTH of them, which is not evidence that it resembles the
    // machine one. Silently clamping such a batch to "fully machine" is how a clean
    // human batch scored 34/100 in testing.
    if (likeness < -OUT_OF_RANGE_MARGIN || likeness > 1 + OUT_OF_RANGE_MARGIN) {
      base.skipReason =
        `batch sits ${base.zVsHuman === null ? 'far' : `${base.zVsHuman.toFixed(1)}σ`} from the human ` +
        `reference, outside the range the two references span. Unlike both, so not scored.`;
      return base;
    }

    // Weight by measured signal-to-noise: how far apart the references sit in units
    // of batch-to-batch noise. A signal whose references are 5σ apart carries more
    // information than one at 1.9σ, whatever label it was given in advance.
    base.weight = Math.min(separation, MAX_SIGNAL_WEIGHT);
    base.usedInScore = true;
    return base;
  });

  const used = scored.filter((s) => s.usedInScore && s.machineLikeness !== null);
  if (used.length === 0) {
    return {
      batchName,
      records: records.length,
      purity: null,
      confidence: 'low',
      verdict: 'No signal could be compared against the reference corpora.',
      signals: scored,
      refusal: 'no comparable signals',
      scannerVersion: SCANNER_VERSION,
      baselineNames: { human: pair.human.label, machine: pair.machine.label },
      generatedAt: new Date().toISOString(),
      load: { totalLines: load.totalLines, skipped: load.skipped.length },
      authors: authorStats(records),
    };
  }

  let weightAcc = 0;
  let likenessAcc = 0;
  for (const s of used) {
    weightAcc += s.weight;
    likenessAcc += s.weight * clamp01(s.machineLikeness!);
  }
  const machineLikeness = likenessAcc / weightAcc;
  if (!Number.isFinite(machineLikeness)) {
    throw new ScoreComputationError('aggregate', `a non-finite position (${machineLikeness})`);
  }
  const purity = Math.round((1 - machineLikeness) * 100);

  // Confidence follows measured separating power, not a strength label guessed in
  // advance. A signal whose references sit 3 SD apart tells you more than one
  // labelled "strong" whose references overlap.
  const totalSeparation = used.reduce((acc, s) => acc + (s.separationSd ?? 0), 0);
  let confidence: Confidence = 'low';
  if (used.length >= 3 && totalSeparation >= 4 && records.length >= 200) confidence = 'high';
  else if (used.length >= 2 && totalSeparation >= 2 && records.length >= 60) confidence = 'medium';

  return {
    batchName,
    records: records.length,
    purity,
    confidence,
    verdict: verdictFor(purity, confidence, used.length, scored.length, totalSeparation),
    signals: scored,
    scannerVersion: SCANNER_VERSION,
    baselineNames: { human: pair.human.label, machine: pair.machine.label },
    generatedAt: new Date().toISOString(),
    load: { totalLines: load.totalLines, skipped: load.skipped.length },
    authors: authorStats(records),
  };
}

function authorStats(records: DataRecord[]): { count: number; withEnoughRecords: number } {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (!r.authorId) continue;
    counts.set(r.authorId, (counts.get(r.authorId) ?? 0) + 1);
  }
  let enough = 0;
  for (const n of counts.values()) if (n >= 30) enough++;
  return { count: counts.size, withEnoughRecords: enough };
}

function verdictFor(
  purity: number,
  confidence: Confidence,
  usedCount: number,
  totalCount: number,
  totalSeparation: number,
): string {
  const suffix =
    `${usedCount} of ${totalCount} signals compared, ${totalSeparation.toFixed(1)}σ of combined ` +
    `separating power, ${confidence} confidence.`;
  if (purity >= 85) return `Consistent with the human reference. ${suffix}`;
  if (purity >= 65) return `Mostly consistent with the human reference, with measurable drift. ${suffix}`;
  if (purity >= 40) return `Sits between the references. Investigate before paying or training. ${suffix}`;
  return `Closer to the machine reference than the human one. ${suffix}`;
}

/**
 * Evidence, not a verdict on any single record. Ingot reports where a batch sits
 * between two named reference corpora and how far from each. It does not claim to
 * know who wrote one row.
 */
export const CLAIM_SCOPE =
  'Batch-level evidence against named reference corpora. Not a per-record determination.';
