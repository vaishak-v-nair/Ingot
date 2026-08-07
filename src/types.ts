// Kept equal to package.json's version by check-published-numbers.ts: releases 0.1.1
// through 0.1.3 shipped receipts stamped ingot-0.1.0 because nothing tied these together.
export const SCANNER_VERSION = 'ingot-0.1.5';

/** Minimum records before any batch-level statistic is reported. */
export const MIN_BATCH_RECORDS = 30;

/** Minimum records per author before stylometry is reported for that author. */
export const MIN_AUTHOR_RECORDS = 30;

export type DataRecord = {
  id: string;
  text: string;
  prompt?: string;
  authorId?: string;
};

export type SkippedLine = {
  line: number;
  reason: string;
};

export type LoadResult = {
  records: DataRecord[];
  totalLines: number;
  skipped: SkippedLine[];
  encodingNormalized: boolean;
};

export type SignalStrength = 'strong' | 'medium' | 'weak';

export type SignalResult = {
  key: string;
  label: string;
  strength: SignalStrength;
  /** True when the signal produced a number. False means it declined, with a reason. */
  available: boolean;
  reason?: string;
  value: number | null;
  /** Human-readable evidence. Shown next to the number in the report. */
  detail: string;
  /** Record ids this signal considers suspect. */
  flagged: string[];
};

export type BaselineStat = {
  mean: number;
  sd: number;
  n: number;
};

export type Baseline = {
  label: string;
  corpus: string;
  records: number;
  /** Batch size the reference was calibrated at. Size-sensitive signals are only comparable near it. */
  chunkSize: number;
  signals: Record<string, BaselineStat>;
};

/**
 * Signals whose value moves with batch size regardless of provenance. A bigger
 * batch has more chances to contain a duplicate, and type-token ratio falls as
 * token count rises. Comparing these across very different batch sizes would
 * produce a confident wrong answer, so the scorer refuses to.
 */
export const SIZE_SENSITIVE_SIGNALS = new Set(['near_dup', 'lexical_cluster', 'lexical_variety']);

export type BaselinePair = {
  human: Baseline;
  machine: Baseline;
  builtAt: string;
  scannerVersion: string;
  note: string;
};

export type ScoredSignal = SignalResult & {
  /** 0 = sits on the human baseline, 1 = sits on the machine baseline. */
  machineLikeness: number | null;
  /** Standard deviations away from the human baseline mean. */
  zVsHuman: number | null;
  /** How far apart the two references sit on this signal, in human-baseline SD. Its discriminating power. */
  separationSd: number | null;
  weight: number;
  usedInScore: boolean;
  skipReason?: string;
};

export type Confidence = 'high' | 'medium' | 'low';

export type ScanReport = {
  batchName: string;
  records: number;
  /** 100 = indistinguishable from the human baseline. null = refused to score. */
  purity: number | null;
  confidence: Confidence;
  verdict: string;
  signals: ScoredSignal[];
  /** Set when Ingot declined to produce a score. */
  refusal?: string;
  scannerVersion: string;
  baselineNames: { human: string; machine: string };
  generatedAt: string;
  load: { totalLines: number; skipped: number };
  authors: { count: number; withEnoughRecords: number };
};

export const STRENGTH_WEIGHT: Record<SignalStrength, number> = {
  strong: 1,
  medium: 0.6,
  weak: 0.3,
};
