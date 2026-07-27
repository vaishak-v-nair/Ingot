/** Contamination scanning: does benchmark text appear inside a training corpus. */

export const INDEX_FORMAT_VERSION = 1;

/** GPT-3 (Brown et al. 2020) established 13. The n sweep re-derives it rather than assuming it. */
export const DEFAULT_N = 13;
export const MIN_N = 8;
export const MAX_N = 13;

/**
 * An n-gram appearing in more than this many benchmark items is boilerplate, not
 * contamination. Without this filter the headline count fills with formulaic filler
 * and the first reader who checks destroys the report.
 */
export const DEFAULT_MAX_ITEMS_PER_GRAM = 3;

/** Tokens this common cannot carry evidence; an n-gram made only of them is dropped. */
export const STOPLIST_SIZE = 200;

/**
 * A token is only a stopword if it appears in at least this share of benchmark items.
 * Rank by raw count alone and a small benchmark's entire vocabulary becomes the
 * stoplist, which silently drops every gram and reports zero contamination.
 */
export const STOPLIST_MIN_DOC_RATIO = 0.5;

/** Below this many items, document frequency is not estimable, so the stoplist is skipped. */
export const STOPLIST_MIN_ITEMS = 4;

/** Score-impact partitions below this are not reported, consistent with the provenance scorer. */
export const MIN_PARTITION_ITEMS = 30;

export type BenchmarkItem = {
  id: string;
  text: string;
  /** Optional grouping (MMLU subject, ARC split) used for per-subject score deltas. */
  subject?: string;
};

/**
 * A published index. Contains one-way hashes and item ids only — never benchmark text —
 * so an index can be distributed for benchmarks whose licence forbids redistributing
 * the data itself.
 */
export type NgramIndexData = {
  formatVersion: number;
  benchmark: string;
  /** Content hash of the source benchmark, so a stale index fails loudly. */
  benchmarkHash: string;
  n: number;
  itemIds: string[];
  itemSubjects: (string | undefined)[];
  /** Parallel arrays: keys[i] is a 53-bit composite gram hash, items[i] indexes itemIds. */
  keys: number[];
  items: number[][];
  uncheckableItemIds: string[];
  stats: IndexStats;
  createdAt: string;
  scannerVersion: string;
};

export type IndexStats = {
  itemCount: number;
  gramsSeen: number;
  gramsKept: number;
  droppedStoplist: number;
  droppedNonDiscriminative: number;
  maxItemsPerGram: number;
  /**
   * Items with no surviving n-gram, so nothing can ever match them. Either they are
   * shorter than n tokens, or every gram they had was filtered as boilerplate.
   *
   * This must be reported. A benchmark with short items otherwise returns "no
   * contamination found" while part of it was never checked at all, which is the
   * silent failure this whole scanner exists to avoid.
   */
  uncheckableItems: number;
};

export type ContaminationTier = 'exact' | 'near' | 'semantic';

export type ContaminationHit = {
  tier: ContaminationTier;
  benchmarkItemId: string;
  corpusDocId: string;
  /** Token offset of the match inside the corpus document. */
  corpusOffset: number;
  matchedText: string;
  contextBefore: string;
  contextAfter: string;
  /** Jaccard estimate for near, cosine for semantic. Absent for exact: it is a match or it isn't. */
  score?: number;
};

export type TierResult = {
  tier: ContaminationTier;
  /** Distinct benchmark items with at least one hit at this tier. */
  itemsHit: number;
  itemsTotal: number;
  rate: number;
  totalHits: number;
  /** Capped sample retained for display. totalHits is the real count. */
  hits: ContaminationHit[];
  /** Set when the tier could not run. */
  unavailableReason?: string;
};

export type PartitionStat = {
  label: string;
  items: number;
  correct: number;
  accuracy: number;
};

export type ScoreImpact = {
  contaminated: PartitionStat;
  clean: PartitionStat;
  /** Raw accuracy gap. Confounded — see difficultyMatchedDelta. */
  rawDelta: number;
  rawDeltaCi95: [number, number];
  /**
   * Delta after matching on per-subject difficulty. Contaminated items may simply be
   * more popular and easier, so the raw delta overstates memorisation. Null when there
   * are too few subjects to stratify.
   */
  difficultyMatchedDelta: number | null;
  perSubject: { subject: string; contaminated: number; clean: number; delta: number }[];
  caveat: string;
  refusal?: string;
};

export type ContaminationReport = {
  benchmark: string;
  corpus: string;
  /** Content hash of the exact corpus scanned, so an attestation is bound to these bytes. */
  corpusHash: string;
  n: number;
  corpusDocs: number;
  corpusTokens: number;
  tiers: TierResult[];
  /** Union of exact and near tiers. Semantic is deliberately excluded. */
  contaminatedItemIds: string[];
  scoreImpact?: ScoreImpact;
  indexStats: IndexStats;
  /** Benchmark items nothing could match, named so a reader knows what was NOT checked. */
  uncheckableItemIds: string[];
  elapsedMs: number;
  scannerVersion: string;
  generatedAt: string;
};

/**
 * What Ingot claims, printed in every report. Exact matches are facts. Near matches are
 * near-facts. Semantic matches are leads for a human, never evidence on their own.
 */
export const CONTAMINATION_CLAIM_SCOPE =
  'Exact-tier findings are verbatim n-gram matches you can reproduce from the same public files. ' +
  'Near and semantic tiers are reported separately and are not counted in the headline.';
