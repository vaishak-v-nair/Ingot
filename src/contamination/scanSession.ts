import { minhashSignature } from '../signals/nearDup.ts';
import { SCANNER_VERSION } from '../types.ts';
import { hashTokens } from './fastTokens.ts';
import { forEachNgramHashed, NgramIndex } from './ngramIndex.ts';
import { DEFAULT_MAX_CORPUS_DOC_FREQUENCY } from './types.ts';
import type { BenchmarkItem, ContaminationHit, ContaminationReport, TierResult } from './types.ts';

/**
 * The scanning algorithm, independent of where documents come from.
 *
 * Node streams them from a file; a browser streams them from a dropped File. Both feed
 * this same session, because two copies of this logic would eventually disagree, and a
 * scanner that disagrees with itself reports zero contamination while looking healthy.
 */

/** Stored hits per tier. totalHits keeps the true count; this only bounds what we render. */
const MAX_STORED_HITS = 200;

/** Tokens of context shown either side of a match, so a reader can judge it. */
const CONTEXT_TOKENS = 12;

/** MinHash Jaccard estimate at or above this counts as a near-duplicate. */
const NEAR_THRESHOLD = 0.55;

/** Runs buffered for the document-frequency pass. Overflow is counted and surfaced, never silent. */
const MAX_PROVISIONAL_RUNS = 200_000;

/** Distinct gram keys retained per run, enough to find the rarest without unbounded memory. */
const MAX_KEYS_PER_RUN = 16;

export type SessionOptions = {
  benchmarkItems?: BenchmarkItem[];
  maxCorpusDocFrequency?: number;
};

type RawHit = { itemIdx: number; offset: number; key: number };
type Run = { itemIdx: number; start: number; end: number; keys: number[] };

/** Merges runs of consecutive n-gram hits into one span. A 100-token verbatim copy is one match, not 88. */
export function mergeRuns(hits: RawHit[]): Run[] {
  if (hits.length === 0) return [];
  const sorted = hits.slice().sort((a, b) => a.itemIdx - b.itemIdx || a.offset - b.offset);
  const runs: Run[] = [];
  let cur: Run = { itemIdx: sorted[0].itemIdx, start: sorted[0].offset, end: sorted[0].offset, keys: [sorted[0].key] };
  for (let i = 1; i < sorted.length; i++) {
    const h = sorted[i];
    if (h.itemIdx === cur.itemIdx && h.offset <= cur.end + 1) {
      cur.end = h.offset;
      if (cur.keys.length < MAX_KEYS_PER_RUN) cur.keys.push(h.key);
    } else {
      runs.push(cur);
      cur = { itemIdx: h.itemIdx, start: h.offset, end: h.offset, keys: [h.key] };
    }
  }
  runs.push(cur);
  return runs;
}

export class ScanSession {
  readonly index: NgramIndex;
  private readonly maxDocFrequency: number;
  private readonly benchSignatures: { id: string; sig: Uint32Array | null }[] | null;

  private readonly provisional: { run: Run; hit: ContaminationHit | null }[] = [];
  private readonly gramDocCount = new Map<number, number>();
  private readonly seenGramsInDoc = new Set<number>();
  private truncatedRuns = 0;

  private readonly nearHits: ContaminationHit[] = [];
  private readonly nearItemsHit = new Set<number>();
  private nearTotal = 0;

  corpusDocs = 0;
  corpusTokens = 0;

  constructor(index: NgramIndex, options: SessionOptions = {}) {
    this.index = index;
    this.maxDocFrequency = options.maxCorpusDocFrequency ?? DEFAULT_MAX_CORPUS_DOC_FREQUENCY;
    this.benchSignatures = options.benchmarkItems
      ? options.benchmarkItems.map((it) => ({ id: it.id, sig: minhashSignature(it.text) }))
      : null;
  }

  addDocument(docId: string, text: string): void {
    const n = this.index.n;
    this.corpusDocs++;

    // Fused tokenize-and-hash: no token strings allocated on the hot path.
    const { hashes, starts, ends, count } = hashTokens(text);
    this.corpusTokens += count;

    const raw: RawHit[] = [];
    forEachNgramHashed(hashes, count, n, (key, offset) => {
      const owners = this.index.lookup(key);
      if (!owners) return;
      // Document frequency of the MATCHED gram, counted once per document.
      if (!this.seenGramsInDoc.has(key)) {
        this.seenGramsInDoc.add(key);
        this.gramDocCount.set(key, (this.gramDocCount.get(key) ?? 0) + 1);
      }
      for (const itemIdx of owners) raw.push({ itemIdx, offset, key });
    });
    this.seenGramsInDoc.clear();

    if (raw.length > 0) {
      for (const run of mergeRuns(raw)) {
        if (this.provisional.length >= MAX_PROVISIONAL_RUNS) {
          this.truncatedRuns++;
          continue;
        }
        // Evidence is captured now, because the text is only available on this pass.
        // Whether it survives is decided once document frequencies are known.
        let hit: ContaminationHit | null = null;
        if (this.provisional.length < MAX_STORED_HITS * 4) {
          const last = Math.min(count - 1, run.end + n - 1);
          const ctxFirst = Math.max(0, run.start - CONTEXT_TOKENS);
          const ctxLast = Math.min(count - 1, last + CONTEXT_TOKENS);
          hit = {
            tier: 'exact',
            benchmarkItemId: this.index.itemIds[run.itemIdx],
            corpusDocId: docId,
            corpusOffset: run.start,
            matchedText: text.slice(starts[run.start], ends[last]),
            contextBefore: text.slice(starts[ctxFirst], starts[run.start]),
            contextAfter: text.slice(ends[last], ends[ctxLast]),
          };
        }
        this.provisional.push({ run, hit });
      }
    }

    // Tier 2 only for documents the exact tier did not already flag.
    if (this.benchSignatures && raw.length === 0) {
      const docSig = minhashSignature(text);
      if (docSig) {
        for (let b = 0; b < this.benchSignatures.length; b++) {
          const bench = this.benchSignatures[b];
          if (!bench.sig) continue;
          let same = 0;
          for (let k = 0; k < docSig.length; k++) if (docSig[k] === bench.sig[k]) same++;
          const jaccard = same / docSig.length;
          if (jaccard >= NEAR_THRESHOLD) {
            this.nearTotal++;
            this.nearItemsHit.add(b);
            if (this.nearHits.length < MAX_STORED_HITS) {
              this.nearHits.push({
                tier: 'near',
                benchmarkItemId: bench.id,
                corpusDocId: docId,
                corpusOffset: 0,
                matchedText: text.slice(0, 240),
                contextBefore: '',
                contextAfter: '',
                score: jaccard,
              });
            }
          }
        }
      }
    }
  }

  finish(corpusName: string, corpusHash: string, elapsedMs: number): ContaminationReport {
    const exactHits: ContaminationHit[] = [];
    const exactItemsHit = new Set<number>();
    let exactTotal = 0;
    let droppedGeneric = 0;

    // A run survives if its RAREST gram is rare: one distinctive phrase inside a passage
    // is enough, while text common end to end is ordinary language.
    for (const { run, hit } of this.provisional) {
      let rarest = Number.POSITIVE_INFINITY;
      for (const key of run.keys) rarest = Math.min(rarest, this.gramDocCount.get(key) ?? 1);
      if (rarest > this.maxDocFrequency) {
        droppedGeneric++;
        continue;
      }
      exactTotal++;
      exactItemsHit.add(run.itemIdx);
      if (hit && exactHits.length < MAX_STORED_HITS) exactHits.push(hit);
    }

    const itemsTotal = this.index.itemIds.length;
    const tiers: TierResult[] = [
      {
        tier: 'exact',
        itemsHit: exactItemsHit.size,
        itemsTotal,
        rate: itemsTotal === 0 ? 0 : exactItemsHit.size / itemsTotal,
        totalHits: exactTotal,
        hits: exactHits,
        droppedGeneric,
        unavailableReason:
          this.truncatedRuns > 0
            ? `${this.truncatedRuns} matches beyond the ${MAX_PROVISIONAL_RUNS} buffer were not frequency-checked`
            : undefined,
      },
      {
        tier: 'near',
        itemsHit: this.nearItemsHit.size,
        itemsTotal,
        rate: itemsTotal === 0 ? 0 : this.nearItemsHit.size / itemsTotal,
        totalHits: this.nearTotal,
        hits: this.nearHits,
        unavailableReason: this.benchSignatures
          ? undefined
          : 'needs benchmark text; a published index carries hashes only',
      },
      {
        tier: 'semantic',
        itemsHit: 0,
        itemsTotal,
        rate: 0,
        totalHits: 0,
        hits: [],
        unavailableReason: 'not implemented in this build',
      },
    ];

    const contaminated = new Set<string>();
    for (const i of exactItemsHit) contaminated.add(this.index.itemIds[i]);
    for (const i of this.nearItemsHit) contaminated.add(this.index.itemIds[i]);

    return {
      benchmark: this.index.benchmark,
      corpus: corpusName,
      corpusHash,
      n: this.index.n,
      corpusDocs: this.corpusDocs,
      corpusTokens: this.corpusTokens,
      tiers,
      contaminatedItemIds: [...contaminated].sort(),
      indexStats: this.index.stats,
      uncheckableItemIds: this.index.uncheckableItemIds,
      elapsedMs,
      scannerVersion: SCANNER_VERSION,
      generatedAt: new Date().toISOString(),
    };
  }
}

/** Field names a corpus might use for its text, in preference order. */
export const TEXT_FIELDS = ['text', 'response', 'output', 'completion', 'content', 'answer'];

/** Extracts (docId, text) from one JSONL line, or null when the line carries no text. */
export function parseCorpusLine(
  line: string,
  fallbackId: number,
  textField?: string,
  idField?: string,
): { docId: string; text: string } | null {
  let row: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    row = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const field = textField ?? TEXT_FIELDS.find((f) => typeof row[f] === 'string');
  if (!field) return null;
  const text = row[field];
  if (typeof text !== 'string' || text.length === 0) return null;
  return { docId: String(row[idField ?? 'id'] ?? `doc${fallbackId}`), text };
}
