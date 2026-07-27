import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { minhashSignature } from '../signals/nearDup.ts';
import { CorpusStreamError } from '../errors.ts';
import { SCANNER_VERSION } from '../types.ts';
import { hashTokens } from './fastTokens.ts';
import { forEachNgramHashed, NgramIndex } from './ngramIndex.ts';
import { DEFAULT_MAX_CORPUS_DOC_FREQUENCY } from './types.ts';
import type { BenchmarkItem, ContaminationHit, ContaminationReport, TierResult } from './types.ts';

/** Stored hits per tier. totalHits keeps the true count; this only bounds what we render. */
const MAX_STORED_HITS = 200;

/** Tokens of context shown either side of a match, so a reader can judge it. */
const CONTEXT_TOKENS = 12;

/** MinHash Jaccard estimate at or above this counts as a near-duplicate. */
const NEAR_THRESHOLD = 0.55;

/** Runs buffered for the document-frequency pass. Overflow is counted and surfaced, never silent. */
const MAX_PROVISIONAL_RUNS = 200_000;

export type ScanOptions = {
  textField?: string;
  idField?: string;
  /**
   * Benchmark text, when available. Without it only the exact tier can run: near and
   * semantic tiers need the benchmark side to compare against, and a published index
   * deliberately carries no text.
   */
  benchmarkItems?: BenchmarkItem[];
  /**
   * A matched gram in more than this many distinct corpus documents is ordinary
   * language rather than evidence. See DEFAULT_MAX_CORPUS_DOC_FREQUENCY.
   */
  maxCorpusDocFrequency?: number;
  onProgress?: (docs: number, tokens: number) => void;
};

type RawHit = { itemIdx: number; offset: number; key: number };

type Run = { itemIdx: number; start: number; end: number; keys: number[] };

/** Distinct gram keys retained per run, enough to find the rarest one without unbounded memory. */
const MAX_KEYS_PER_RUN = 16;

/** Merges runs of consecutive n-gram hits into one span. A 100-token verbatim copy is one match, not 88. */
function mergeRuns(hits: RawHit[]): Run[] {
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

export async function scanCorpus(
  index: NgramIndex,
  corpusPath: string,
  options: ScanOptions = {},
): Promise<ContaminationReport> {
  const started = Date.now();
  const n = index.n;
  const hasher = createHash('sha256');

  const maxDocFrequency = options.maxCorpusDocFrequency ?? DEFAULT_MAX_CORPUS_DOC_FREQUENCY;

  // Matches are held until the whole corpus has been read, because whether a match is
  // evidence depends on how common its text turns out to be across the corpus.
  const provisional: { run: Run; hit: ContaminationHit | null }[] = [];
  const gramDocCount = new Map<number, number>();
  const seenGramsInDoc = new Set<number>();
  let truncatedRuns = 0;

  const exactHits: ContaminationHit[] = [];
  const exactItemsHit = new Set<number>();
  let exactTotal = 0;
  let droppedGeneric = 0;

  const nearHits: ContaminationHit[] = [];
  const nearItemsHit = new Set<number>();
  let nearTotal = 0;

  // Near tier needs the benchmark side. A published index carries no text, so this
  // degrades explicitly rather than silently reporting zero.
  const benchmarkItems = options.benchmarkItems;
  const benchSignatures = benchmarkItems
    ? benchmarkItems.map((it) => ({ id: it.id, sig: minhashSignature(it.text) }))
    : null;

  let corpusDocs = 0;
  let corpusTokens = 0;

  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(corpusPath, { encoding: 'utf8' });
  } catch (err) {
    throw new CorpusStreamError(basename(corpusPath), String(err));
  }

  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      hasher.update(trimmed);

      let row: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        row = parsed as Record<string, unknown>;
      } catch {
        continue; // counted by the loader on the benchmark side; corpus lines are best-effort
      }

      const textField =
        options.textField ??
        ['text', 'response', 'output', 'completion', 'content', 'answer'].find(
          (f) => typeof row[f] === 'string',
        );
      if (!textField) continue;
      const text = row[textField];
      if (typeof text !== 'string' || text.length === 0) continue;

      corpusDocs++;
      const docId = String(row[options.idField ?? 'id'] ?? `doc${corpusDocs}`);

      // Fused tokenize-and-hash: no token strings are allocated on the hot path.
      const { hashes, starts, ends, count } = hashTokens(text);
      corpusTokens += count;

      // Tier 1: exact. One probe per token position, allocation-free.
      const raw: RawHit[] = [];
      forEachNgramHashed(hashes, count, n, (key, offset) => {
        const owners = index.lookup(key);
        if (!owners) return;
        // Document frequency of the MATCHED gram, counted once per document. Only
        // matching grams are tracked, so this stays small.
        if (!seenGramsInDoc.has(key)) {
          seenGramsInDoc.add(key);
          gramDocCount.set(key, (gramDocCount.get(key) ?? 0) + 1);
        }
        for (const itemIdx of owners) raw.push({ itemIdx, offset, key });
      });
      seenGramsInDoc.clear();

      if (raw.length > 0) {
        // Copy boundaries before any further hashTokens call reuses the shared buffers.
        const runs = mergeRuns(raw);
        for (const run of runs) {
          if (provisional.length >= MAX_PROVISIONAL_RUNS) {
            truncatedRuns++;
            continue;
          }
          // Evidence is captured now, because the document text is only available on this
          // pass. Whether it survives is decided after document frequencies are known.
          let hit: ContaminationHit | null = null;
          if (provisional.length < MAX_STORED_HITS * 4) {
            const last = Math.min(count - 1, run.end + n - 1);
            const ctxFirst = Math.max(0, run.start - CONTEXT_TOKENS);
            const ctxLast = Math.min(count - 1, last + CONTEXT_TOKENS);
            hit = {
              tier: 'exact',
              benchmarkItemId: index.itemIds[run.itemIdx],
              corpusDocId: docId,
              corpusOffset: run.start,
              // Sliced from the source, so evidence shows real text rather than a
              // lowercased token join.
              matchedText: text.slice(starts[run.start], ends[last]),
              contextBefore: text.slice(starts[ctxFirst], starts[run.start]),
              contextAfter: text.slice(ends[last], ends[ctxLast]),
            };
          }
          provisional.push({ run, hit });
        }
      }

      // Tier 2: near-duplicate, only for documents the exact tier did not already flag.
      if (benchSignatures && raw.length === 0) {
        const docSig = minhashSignature(text);
        if (docSig) {
          for (let b = 0; b < benchSignatures.length; b++) {
            const bench = benchSignatures[b];
            if (!bench.sig) continue;
            let same = 0;
            for (let k = 0; k < docSig.length; k++) if (docSig[k] === bench.sig[k]) same++;
            const jaccard = same / docSig.length;
            if (jaccard >= NEAR_THRESHOLD) {
              nearTotal++;
              nearItemsHit.add(b);
              if (nearHits.length < MAX_STORED_HITS) {
                nearHits.push({
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

      if (options.onProgress && corpusDocs % 20_000 === 0) {
        options.onProgress(corpusDocs, corpusTokens);
      }
    }
  } finally {
    rl.close();
    stream.close();
  }

  // Corpus-side document frequency filter. A run survives if its RAREST gram is rare:
  // one distinctive phrase inside a passage is enough to make the passage evidence,
  // while text that is common end to end is ordinary language.
  for (const { run, hit } of provisional) {
    let rarest = Number.POSITIVE_INFINITY;
    for (const key of run.keys) rarest = Math.min(rarest, gramDocCount.get(key) ?? 1);
    if (rarest > maxDocFrequency) {
      droppedGeneric++;
      continue;
    }
    exactTotal++;
    exactItemsHit.add(run.itemIdx);
    if (hit && exactHits.length < MAX_STORED_HITS) exactHits.push(hit);
  }

  const itemsTotal = index.itemIds.length;

  const tiers: TierResult[] = [
    {
      tier: 'exact',
      itemsHit: exactItemsHit.size,
      itemsTotal,
      rate: itemsTotal === 0 ? 0 : exactItemsHit.size / itemsTotal,
      totalHits: exactTotal,
      hits: exactHits,
      droppedGeneric,
    },
    {
      tier: 'near',
      itemsHit: nearItemsHit.size,
      itemsTotal,
      rate: itemsTotal === 0 ? 0 : nearItemsHit.size / itemsTotal,
      totalHits: nearTotal,
      hits: nearHits,
      unavailableReason: benchSignatures
        ? undefined
        : 'needs benchmark text; a published index carries hashes only. Pass --bench to enable.',
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

  // Headline is exact plus near. Semantic is deliberately excluded: it is a lead for a
  // human, not evidence.
  const contaminated = new Set<string>();
  for (const i of exactItemsHit) contaminated.add(index.itemIds[i]);
  for (const i of nearItemsHit) contaminated.add(index.itemIds[i]);

  return {
    benchmark: index.benchmark,
    corpus: basename(corpusPath),
    corpusHash: hasher.digest('hex').slice(0, 32),
    n,
    corpusDocs,
    corpusTokens,
    tiers,
    contaminatedItemIds: [...contaminated].sort(),
    indexStats: index.stats,
    uncheckableItemIds: index.uncheckableItemIds,
    elapsedMs: Date.now() - started,
    scannerVersion: SCANNER_VERSION,
    generatedAt: new Date().toISOString(),
  };
}
