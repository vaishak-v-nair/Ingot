import { IndexMismatchError } from '../errors.ts';
import { minhashSignature } from '../signals/nearDup.ts';
import { SCANNER_VERSION } from '../types.ts';
import { hashTokens } from './fastTokens.ts';
import { contentHash, forEachNgramHashed, NgramIndex } from './ngramIndex.ts';
import { DEFAULT_MAX_CORPUS_DOC_FREQUENCY, INDEX_FORMAT_VERSION } from './types.ts';
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

/**
 * Memory backstop on the keys retained per run. Reaching it is not a truncation of the
 * evidence in any meaningful sense — see mergeRuns for why a run with this many still-rare
 * grams is treated as a survivor outright.
 */
const MAX_KEYS_PER_RUN = 256;

export type SessionOptions = {
  benchmarkItems?: BenchmarkItem[];
  maxCorpusDocFrequency?: number;
};

/** What only the caller knows: where the corpus came from and how to run this again. */
export type FinishInput = {
  corpusName: string;
  corpusHash: string;
  corpusBytes: number;
  corpusHashFull?: string;
  /** Ordered file list, when the corpus arrived sharded. See Receipt.corpusParts. */
  corpusParts?: string[];
  /** The exact invocation that reproduces this report. */
  command: string;
  elapsedMs: number;
};

type RawHit = { itemIdx: number; offset: number; key: number };
type Run = {
  itemIdx: number;
  start: number;
  end: number;
  keys: number[];
  keysTruncated: boolean;
  /**
   * The rarest gram this run ever saw, kept or discarded, for reporting only. When every
   * key is ruled out on sight there is nothing left to name the frequency that condemned
   * the run, and "dropped as ordinary language" without a number is the silent judgement
   * this scanner refuses to make.
   */
  witnessKey: number | null;
};

/**
 * Merges runs of consecutive n-gram hits into one span. A 100-token verbatim copy is one
 * match, not 88. `stride` is the gap the index itself introduces: a stride-built index
 * stores every stride-th gram of each item, so the hits of one verbatim copy land ~stride
 * apart — with the old `+ 1` threshold a single copied passage fragmented into dozens of
 * runs, each carrying one key for the frequency filter to judge alone.
 *
 * `keep` decides which gram keys the run carries into the frequency filter, and it is the
 * fix for a false negative that was invisible by construction. The run used to keep its
 * FIRST sixteen keys, with a comment claiming that was "enough to find the rarest". In the
 * one case that matters it is not: a long verbatim copy that opens with common phrasing and
 * turns distinctive later hands the filter sixteen ordinary grams, and the whole passage is
 * discarded as ordinary language. The rarer the opening, the likelier the copy was found —
 * so the sampling failed hardest on exactly the adversarial case.
 *
 * The predicate is exact rather than a bigger sample, and the reason is a one-way property:
 * document frequencies only ever grow. A key already past the drop threshold when it is
 * seen is past it at the end too, so it can never be the gram that saves the run — and it
 * can be discarded on sight rather than occupying a slot. What is left is every key that
 * could still matter, which is what "find the rarest" needed all along.
 *
 * A running minimum would have been wrong here, incidentally, and cheaper. Keeping only the
 * key that is rarest AT CAPTURE loses the run when that key later becomes common while a
 * discarded sibling stays rare — a new false negative traded for the old one. Only the set
 * survives the fact that the counts are still moving.
 *
 * MAX_KEYS_PER_RUN remains as a memory backstop. Hitting it means the run has 256 grams
 * that are all still rare, which is not a marginal call about ordinary language — it is an
 * overwhelming verbatim match, so a truncated run is treated as a survivor outright and
 * never silently dropped.
 */
export function mergeRuns(
  hits: RawHit[],
  stride = 1,
  filter?: { frequency: (key: number) => number; max: number },
): Run[] {
  if (hits.length === 0) return [];
  const sorted = hits.slice().sort((a, b) => a.itemIdx - b.itemIdx || a.offset - b.offset);
  const runs: Run[] = [];

  let witnessFreq = Number.POSITIVE_INFINITY;

  const add = (run: Run, key: number): void => {
    if (filter) {
      const freq = filter.frequency(key);
      if (freq < witnessFreq) {
        witnessFreq = freq;
        run.witnessKey = key;
      }
      if (freq > filter.max) return;
    }
    if (run.keys.length >= MAX_KEYS_PER_RUN) {
      run.keysTruncated = true;
      return;
    }
    // Linear, and deliberately so: the array is capped, and a repeated phrase inside one
    // run would otherwise spend slots on a key already held.
    if (!run.keys.includes(key)) run.keys.push(key);
  };

  const start = (h: RawHit): Run => {
    const run: Run = {
      itemIdx: h.itemIdx,
      start: h.offset,
      end: h.offset,
      keys: [],
      keysTruncated: false,
      witnessKey: null,
    };
    witnessFreq = Number.POSITIVE_INFINITY;
    add(run, h.key);
    return run;
  };

  let cur = start(sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    const h = sorted[i];
    if (h.itemIdx === cur.itemIdx && h.offset <= cur.end + stride) {
      cur.end = h.offset;
      add(cur, h.key);
    } else {
      runs.push(cur);
      cur = start(h);
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

  // Keyed by the bench item's OWN id, never by its position: the near tier matches
  // against --bench text, and a position in that array said nothing about
  // index.itemIds — resolving one through the other misattributed every near hit the
  // moment the two files differed in order or length.
  private readonly nearHits: ContaminationHit[] = [];
  private readonly nearItemsHit = new Set<string>();
  private nearTotal = 0;

  corpusDocs = 0;
  corpusTokens = 0;
  /** Text slots spent on runs that can still survive the frequency filter. */
  private survivorTextCaptured = 0;
  /** Text slots spent on runs already certain to be dropped (feeds droppedSamples). */
  private droppedTextCaptured = 0;

  constructor(index: NgramIndex, options: SessionOptions = {}) {
    this.index = index;
    this.maxDocFrequency = options.maxCorpusDocFrequency ?? DEFAULT_MAX_CORPUS_DOC_FREQUENCY;
    // --bench must be THE benchmark the index was built from. The report merges exact-tier
    // ids (from the index) with near-tier ids (from the bench file) and stamps one
    // benchmark hash in the receipt — a mismatched pair would mix two item sets under one
    // name, silently. Refusing is the house discipline; the hash is the same one build()
    // stamped, computed the same way.
    if (options.benchmarkItems) {
      const benchHash = contentHash(options.benchmarkItems.map((it) => `${it.id}\u0001${it.text}`));
      if (benchHash !== index.benchmarkHash) {
        throw new IndexMismatchError(
          `the --bench file is not the benchmark this index was built from ` +
            `(index ${index.benchmarkHash}, --bench ${benchHash}). Near-tier results would ` +
            `mix two different item sets under one receipt. Use the benchmark file the ` +
            `index was built from.`,
        );
      }
    }
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

    // True while any of this document's exact runs could still survive the frequency
    // filter. Frequencies only grow, so a run whose rarest matched gram is already past
    // the threshold is certain to be dropped — and a document whose EVERY exact match is
    // a certain drop must still be near-checked, or a paraphrased near-copy that happens
    // to share one common n-gram with the benchmark is flagged by neither tier.
    let survivorPossible = false;
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
      // Counts for this document are already folded in above, so the filter sees the
      // frequency as of now — the earliest point at which a key can be ruled out forever.
      const filter = {
        frequency: (key: number): number => this.gramDocCount.get(key) ?? 1,
        max: this.maxDocFrequency,
      };

      for (const run of mergeRuns(raw, this.index.stats.stride, filter)) {
        if (this.provisional.length >= MAX_PROVISIONAL_RUNS) {
          this.truncatedRuns++;
          // Never frequency-checked, so its survival is unknown — treat it as a possible
          // survivor rather than letting the near tier double-report the document.
          survivorPossible = true;
          continue;
        }
        // Evidence is captured now, because the text is only available on this pass.
        // Whether it survives is decided once document frequencies are known — but
        // frequencies only grow, so a run whose rarest matched gram is ALREADY past the
        // threshold is certain to be dropped. Text slots are allocated by that certainty:
        // possible survivors draw from the deep pool, certain drops from a smaller one
        // that feeds droppedSamples. Without this split, the drops-dominate regime at web
        // scale fills every slot with future discards, and a genuine leak found late in a
        // 20 GB scan is counted but has no words to show.
        let hit: ContaminationHit | null = null;
        let rarestNow = Number.POSITIVE_INFINITY;
        for (const key of run.keys) rarestNow = Math.min(rarestNow, this.gramDocCount.get(key) ?? 1);
        // No key survived the predicate, so every gram in this run is already past the
        // threshold and can only get commoner: certain to drop, and known so on this pass.
        // A truncated run is the opposite case and is never a certain drop.
        const certainDrop = !run.keysTruncated && rarestNow > this.maxDocFrequency;
        if (!certainDrop) survivorPossible = true;
        const wantText = certainDrop
          ? this.droppedTextCaptured < MAX_STORED_HITS
          : this.survivorTextCaptured < MAX_STORED_HITS * 4;
        if (wantText) {
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
          if (certainDrop) this.droppedTextCaptured++;
          else this.survivorTextCaptured++;
        }
        this.provisional.push({ run, hit });
      }
    }

    // Tier 2 for documents the exact tier will not flag: no raw hits at all, or every
    // run already certain to be dropped as ordinary language. The old gate was
    // `raw.length === 0`, which let one generic shared n-gram exempt a document from the
    // near check entirely — the tier that exists to catch edited copies never saw the
    // edited copies most likely to contain a common phrase.
    if (this.benchSignatures && !survivorPossible) {
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
            this.nearItemsHit.add(bench.id);
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

  finish(input: FinishInput): ContaminationReport {
    const { corpusName, corpusHash, elapsedMs } = input;
    const exactHits: ContaminationHit[] = [];
    const exactItemsHit = new Set<number>();
    let exactTotal = 0;
    let droppedGeneric = 0;

    // A run survives if its RAREST gram is rare: one distinctive phrase inside a passage
    // is enough, while text common end to end is ordinary language.
    const droppedSamples: ContaminationHit[] = [];
    for (const { run, hit } of this.provisional) {
      let rarest = Number.POSITIVE_INFINITY;
      for (const key of run.keys) rarest = Math.min(rarest, this.gramDocCount.get(key) ?? 1);
      // 256 grams still rare when the cap was hit. Whatever the kept ones did afterwards,
      // this is not the ordinary-language case the filter exists to catch.
      if (!run.keysTruncated && rarest > this.maxDocFrequency) {
        droppedGeneric++;
        // Kept (capped) so the discard count is inspectable: "dropped as ordinary
        // language" is itself a judgement, and the reader gets to check it. When every key
        // was ruled out on sight there is no kept key left to name a frequency, so the run
        // falls back to the rarest gram it ever saw. That gram was already past the
        // threshold when it was discarded and frequencies only grow, so the number shown
        // is always a real reason for the drop.
        const condemned = Number.isFinite(rarest)
          ? rarest
          : run.witnessKey === null
            ? undefined
            : this.gramDocCount.get(run.witnessKey);
        if (hit && droppedSamples.length < MAX_STORED_HITS) {
          droppedSamples.push({ ...hit, corpusDocFrequency: condemned });
        }
        continue;
      }
      exactTotal++;
      exactItemsHit.add(run.itemIdx);
      // Carried on the hit so a reader can weigh it without rerunning the scan: survived
      // the filter is not the same as rare, and the margin is the whole judgement.
      if (hit && exactHits.length < MAX_STORED_HITS) {
        exactHits.push({ ...hit, corpusDocFrequency: Number.isFinite(rarest) ? rarest : undefined });
      }
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
        droppedSamples: droppedSamples.length > 0 ? droppedSamples : undefined,
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
    for (const id of this.nearItemsHit) contaminated.add(id);

    const generatedAt = new Date().toISOString();

    return {
      benchmark: this.index.benchmark,
      corpus: corpusName,
      corpusHash,
      receipt: {
        scannerVersion: SCANNER_VERSION,
        indexFormatVersion: INDEX_FORMAT_VERSION,
        benchmark: this.index.benchmark,
        benchmarkHash: this.index.benchmarkHash,
        n: this.index.n,
        stride: this.index.stats.stride,
        indexGrams: this.index.stats.gramsKept,
        corpus: corpusName,
        corpusHash,
        corpusBytes: input.corpusBytes,
        corpusDocs: this.corpusDocs,
        corpusHashFull: input.corpusHashFull,
        corpusParts: input.corpusParts,
        command: input.command,
        generatedAt,
      },
      n: this.index.n,
      corpusDocs: this.corpusDocs,
      corpusTokens: this.corpusTokens,
      tiers,
      contaminatedItemIds: [...contaminated].sort(),
      indexStats: this.index.stats,
      uncheckableItemIds: this.index.uncheckableItemIds,
      elapsedMs,
      scannerVersion: SCANNER_VERSION,
      generatedAt,
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
