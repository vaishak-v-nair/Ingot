import { cosineSparse, l2NormalizeSparse, mulberry32, tokenize } from '../text.ts';
import type { DataRecord, SignalResult } from '../types.ts';

const MAX_VOCAB = 4000;
const MIN_DF = 3;
const MAX_DF_RATIO = 0.6;
const MAX_PAIRS = 40_000;
const PAIR_SAMPLE_SEED = 0x1ce07;

/**
 * Mean pairwise cosine similarity of TF-IDF vectors.
 *
 * One model answering many prompts collapses into a tight lexical cluster.
 * Many independent people answering the same prompts do not. This runs offline
 * with no embedding provider, which keeps a scan reproducible and keeps a
 * buyer's data on their own machine. A semantic embedding provider is a
 * drop-in upgrade to the same statistic, not a different signal.
 */
export function lexicalClusterSignal(records: DataRecord[]): SignalResult {
  const n = records.length;
  const df = new Map<string, number>();
  const tokenized: string[][] = [];

  for (const r of records) {
    const toks = tokenize(r.text);
    tokenized.push(toks);
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const maxDf = Math.max(MIN_DF, Math.floor(n * MAX_DF_RATIO));
  const vocab = [...df.entries()]
    .filter(([, d]) => d >= MIN_DF && d <= maxDf)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_VOCAB);

  if (vocab.length < 50) {
    return {
      key: 'lexical_cluster',
      label: 'Lexical cluster tightness',
      strength: 'strong',
      available: false,
      reason: `vocabulary too small (${vocab.length} usable terms, need 50)`,
      value: null,
      detail: 'batch has too little lexical variety to compare',
      flagged: [],
    };
  }

  const index = new Map<string, number>();
  const idf: number[] = [];
  vocab.forEach(([term, d], i) => {
    index.set(term, i);
    idf.push(Math.log(n / d));
  });

  const vectors: Map<number, number>[] = [];
  const kept: number[] = [];
  tokenized.forEach((toks, ri) => {
    const tf = new Map<number, number>();
    for (const t of toks) {
      const i = index.get(t);
      if (i !== undefined) tf.set(i, (tf.get(i) ?? 0) + 1);
    }
    if (tf.size === 0) return;
    for (const [i, c] of tf) tf.set(i, (1 + Math.log(c)) * idf[i]);
    l2NormalizeSparse(tf);
    vectors.push(tf);
    kept.push(ri);
  });

  if (vectors.length < 2) {
    return {
      key: 'lexical_cluster',
      label: 'Lexical cluster tightness',
      strength: 'strong',
      available: false,
      reason: `only ${vectors.length} records had in-vocabulary terms`,
      value: null,
      detail: 'not enough vectorizable records',
      flagged: [],
    };
  }

  const rand = mulberry32(PAIR_SAMPLE_SEED);
  const m = vectors.length;
  const totalPairs = (m * (m - 1)) / 2;
  const sampled = Math.min(MAX_PAIRS, totalPairs);
  let acc = 0;
  const perRecord = new Float64Array(m);
  const perRecordCount = new Float64Array(m);

  for (let p = 0; p < sampled; p++) {
    let i = Math.floor(rand() * m);
    let j = Math.floor(rand() * m);
    if (i === j) j = (j + 1) % m;
    const sim = cosineSparse(vectors[i], vectors[j]);
    acc += sim;
    perRecord[i] += sim;
    perRecordCount[i] += 1;
    perRecord[j] += sim;
    perRecordCount[j] += 1;
  }

  const meanSim = acc / sampled;

  // Flag the records sitting closest to everything else: the centre of the collapse.
  const scored = kept
    .map((ri, k) => ({
      id: records[ri].id,
      avg: perRecordCount[k] > 0 ? perRecord[k] / perRecordCount[k] : 0,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 50);

  return {
    key: 'lexical_cluster',
    label: 'Lexical cluster tightness',
    strength: 'strong',
    available: true,
    value: meanSim,
    detail:
      `mean pairwise cosine ${meanSim.toFixed(4)} over ${sampled.toLocaleString()} sampled pairs, ` +
      `${vocab.length} term vocabulary, ${vectors.length} vectorized records (TF-IDF, offline)`,
    flagged: scored.map((s) => s.id),
  };
}
