import { fnv1a, mixHash, shingles, tokenize } from '../text.ts';
import type { DataRecord, SignalResult } from '../types.ts';

const NUM_HASHES = 64;
const BAND_ROWS = 4;
const SHINGLE_K = 5;
const MAX_SHINGLES = 400;
const DUP_THRESHOLD = 0.7;

export function minhashSignature(text: string): Uint32Array | null {
  const toks = tokenize(text);
  const all = shingles(toks, SHINGLE_K);
  if (all.length === 0) return null;

  // Cap shingles per record so cost stays linear in batch size, sampled evenly
  // rather than truncated, so long records are represented end to end.
  const step = all.length > MAX_SHINGLES ? all.length / MAX_SHINGLES : 1;
  const sig = new Uint32Array(NUM_HASHES).fill(0xffffffff);
  for (let f = 0; f < all.length; f += step) {
    const base = fnv1a(all[Math.floor(f)]);
    for (let i = 0; i < NUM_HASHES; i++) {
      const h = mixHash(base, i + 1);
      if (h < sig[i]) sig[i] = h;
    }
  }
  return sig;
}

function jaccardEstimate(a: Uint32Array, b: Uint32Array): number {
  let same = 0;
  for (let i = 0; i < NUM_HASHES; i++) if (a[i] === b[i]) same++;
  return same / NUM_HASHES;
}

/**
 * Fraction of records that have a near-duplicate elsewhere in the same batch.
 * Machine-generated and scraped batches repeat themselves; independently written
 * human batches mostly do not.
 */
export function nearDupSignal(records: DataRecord[]): SignalResult {
  const sigs = new Map<string, Uint32Array>();
  for (const r of records) {
    const s = minhashSignature(r.text);
    if (s) sigs.set(r.id, s);
  }

  if (sigs.size < 2) {
    return {
      key: 'near_dup',
      label: 'Near-duplicate rate',
      strength: 'strong',
      available: false,
      reason: `only ${sigs.size} records produced shingles (need 2)`,
      value: null,
      detail: 'not enough shinglable text',
      flagged: [],
    };
  }

  const bands = Math.floor(NUM_HASHES / BAND_ROWS);
  const buckets = new Map<string, string[]>();
  for (const [id, sig] of sigs) {
    for (let b = 0; b < bands; b++) {
      let key = `${b}`;
      for (let r = 0; r < BAND_ROWS; r++) key += `:${sig[b * BAND_ROWS + r]}`;
      const arr = buckets.get(key);
      if (arr) arr.push(id);
      else buckets.set(key, [id]);
    }
  }

  const pairsChecked = new Set<string>();
  const dupOf = new Map<string, string>();
  for (const ids of buckets.values()) {
    if (ids.length < 2 || ids.length > 200) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
        if (pairsChecked.has(key)) continue;
        pairsChecked.add(key);
        const est = jaccardEstimate(sigs.get(ids[i])!, sigs.get(ids[j])!);
        if (est >= DUP_THRESHOLD) {
          if (!dupOf.has(ids[i])) dupOf.set(ids[i], ids[j]);
          if (!dupOf.has(ids[j])) dupOf.set(ids[j], ids[i]);
        }
      }
    }
  }

  const rate = dupOf.size / sigs.size;
  const flagged = [...dupOf.keys()].slice(0, 50);

  return {
    key: 'near_dup',
    label: 'Near-duplicate rate',
    strength: 'strong',
    available: true,
    value: rate,
    detail:
      `${dupOf.size} of ${sigs.size} records have a near-duplicate in this batch ` +
      `(MinHash ${NUM_HASHES}x, ${SHINGLE_K}-gram shingles, Jaccard >= ${DUP_THRESHOLD})`,
    flagged,
  };
}
