import { mean, sentences, stdev, tokenize } from '../text.ts';
import type { DataRecord, SignalResult } from '../types.ts';

/**
 * Burstiness: within a record, how much sentence length varies.
 *
 * People write unevenly. A short sentence, then a long one that runs on with
 * three clauses, then a fragment. Generated text tends toward uniform sentence
 * length, so burstiness drops. Reported alongside the spread of record lengths,
 * which tightens for the same reason.
 */
export function lengthShapeSignal(records: DataRecord[]): SignalResult {
  const burstiness: number[] = [];
  const recordLengths: number[] = [];

  for (const r of records) {
    const toks = tokenize(r.text);
    recordLengths.push(toks.length);
    const sents = sentences(r.text).map((s) => tokenize(s).length).filter((n) => n > 0);
    if (sents.length < 2) continue;
    const m = mean(sents);
    if (m === 0) continue;
    burstiness.push(stdev(sents) / m);
  }

  if (burstiness.length < 10) {
    return {
      key: 'length_shape',
      label: 'Sentence burstiness',
      strength: 'medium',
      available: false,
      reason: `only ${burstiness.length} records have 2+ sentences (need 10)`,
      value: null,
      detail: 'batch is too short-form for a burstiness estimate',
      flagged: [],
    };
  }

  const meanBurst = mean(burstiness);
  const lenMean = mean(recordLengths);
  const lenCv = lenMean === 0 ? 0 : stdev(recordLengths) / lenMean;

  return {
    key: 'length_shape',
    label: 'Sentence burstiness',
    strength: 'medium',
    available: true,
    value: meanBurst,
    detail:
      `mean within-record burstiness ${meanBurst.toFixed(4)} over ${burstiness.length} records; ` +
      `record length ${lenMean.toFixed(0)} tokens, spread (CV) ${lenCv.toFixed(3)}. ` +
      `Lower burstiness means more uniform sentence lengths.`,
    flagged: [],
  };
}

/**
 * Lexical variety per token. Weak on its own and reported as weak: it moves with
 * topic and length, not only with authorship.
 */
export function lexicalVarietySignal(records: DataRecord[]): SignalResult {
  let types = 0;
  let tokensTotal = 0;
  const rareRates: number[] = [];
  const globalCounts = new Map<string, number>();

  const perRecordTokens: string[][] = records.map((r) => tokenize(r.text));
  for (const toks of perRecordTokens) {
    tokensTotal += toks.length;
    for (const t of toks) globalCounts.set(t, (globalCounts.get(t) ?? 0) + 1);
  }
  types = globalCounts.size;

  if (tokensTotal < 500) {
    return {
      key: 'lexical_variety',
      label: 'Lexical variety',
      strength: 'weak',
      available: false,
      reason: `only ${tokensTotal} tokens in batch (need 500)`,
      value: null,
      detail: 'batch too small for a variety estimate',
      flagged: [],
    };
  }

  for (const toks of perRecordTokens) {
    if (toks.length === 0) continue;
    let rare = 0;
    for (const t of toks) if ((globalCounts.get(t) ?? 0) <= 2) rare++;
    rareRates.push(rare / toks.length);
  }

  const ttr = types / tokensTotal;
  return {
    key: 'lexical_variety',
    label: 'Lexical variety',
    strength: 'weak',
    available: true,
    value: ttr,
    detail:
      `type-token ratio ${ttr.toFixed(5)} over ${tokensTotal.toLocaleString()} tokens; ` +
      `rare-term rate ${(mean(rareRates) * 100).toFixed(2)}%. Weak signal, never decisive alone.`,
    flagged: [],
  };
}
