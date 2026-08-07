import { hashTokens } from './fastTokens.ts';
import { portableHash } from './portableHash.ts';
import { isUnsegmentedScript } from '../text.ts';
import { BenchmarkEmptyError, IndexVersionError } from '../errors.ts';
import { SCANNER_VERSION } from '../types.ts';
import {
  DEFAULT_MAX_ITEMS_PER_GRAM,
  DEFAULT_N,
  DEFAULT_STRIDE,
  INDEX_FORMAT_VERSION,
  MAX_N,
  MIN_N,
  STOPLIST_MIN_DOC_RATIO,
  STOPLIST_MIN_ITEMS,
  STOPLIST_SIZE,
} from './types.ts';
import type { BenchmarkItem, IndexStats, NgramIndexData } from './types.ts';

/**
 * Two independent polynomial rolling hashes mod 2^32, composed into one 53-bit key.
 *
 * Rolling is what makes this O(1) per token position instead of O(n). lm-eval indexes
 * the corpus and scans the benchmark against it, which took them nine days on the Pile.
 * Ingot indexes the benchmark (small, fits in RAM) and streams the corpus once.
 */
const BASE_A = 0x01000193;
const BASE_B = 0x85ebca6b;

/** Bounded token-hash cache. Token frequency is Zipfian, so a small cache catches most lookups. */
const TOKEN_CACHE_LIMIT = 200_000;
const tokenCache = new Map<string, number>();

export function tokenHash(token: string): number {
  const cached = tokenCache.get(token);
  if (cached !== undefined) return cached;

  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h = h >>> 0;

  if (tokenCache.size >= TOKEN_CACHE_LIMIT) tokenCache.clear();
  tokenCache.set(token, h);
  return h;
}

function powMod32(base: number, exp: number): number {
  let result = 1;
  let b = base >>> 0;
  let e = exp;
  while (e > 0) {
    if (e & 1) result = Math.imul(result, b) >>> 0;
    b = Math.imul(b, b) >>> 0;
    e >>>= 1;
  }
  return result >>> 0;
}

/** 32 bits from lane A plus 21 from lane B: 53 bits, the exact limit of a safe integer. */
function composite(a: number, b: number): number {
  return a * 2097152 + (b >>> 11);
}

/**
 * Rolls over precomputed token hashes. This is the hot path: one multiply-add per lane
 * per token position, no allocation, no string work.
 */
export function forEachNgramHashed(
  hashes: Uint32Array,
  count: number,
  n: number,
  visit: (key: number, offset: number) => void,
): void {
  if (count < n) return;

  const powA = powMod32(BASE_A, n - 1);
  const powB = powMod32(BASE_B, n - 1);

  let hA = 0;
  let hB = 0;
  for (let i = 0; i < n; i++) {
    const t = hashes[i];
    hA = (Math.imul(hA, BASE_A) + t) >>> 0;
    hB = (Math.imul(hB, BASE_B) + t) >>> 0;
  }
  visit(hA * 2097152 + (hB >>> 11), 0);

  for (let i = n; i < count; i++) {
    const out = hashes[i - n];
    const inn = hashes[i];
    hA = (Math.imul((hA - Math.imul(out, powA)) >>> 0, BASE_A) + inn) >>> 0;
    hB = (Math.imul((hB - Math.imul(out, powB)) >>> 0, BASE_B) + inn) >>> 0;
    visit(hA * 2097152 + (hB >>> 11), i - n + 1);
  }
}

/**
 * String-token convenience wrapper, used by index construction and tests. Delegates to
 * the same rolling code as the scan path so the two can never drift apart: an index and
 * a scan that disagree on a key would report zero contamination and look correct.
 */
export function forEachNgram(
  tokens: string[],
  n: number,
  visit: (key: number, offset: number) => void,
): void {
  if (tokens.length < n) return;
  const hashes = new Uint32Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) hashes[i] = tokenHash(tokens[i]);
  forEachNgramHashed(hashes, tokens.length, n, visit);
}

/** Index identity, portable across Node and browser. See portableHash for why not SHA-256. */
export const contentHash = portableHash;

export type BuildOptions = {
  n?: number;
  /** Keep one gram in every `stride` positions. See DEFAULT_STRIDE. */
  stride?: number;
  maxItemsPerGram?: number;
  /** Disable the discriminative filter, for the ablation in the validation harness. */
  disableDiscriminativeFilter?: boolean;
  disableStoplist?: boolean;
};

export class NgramIndex {
  readonly n: number;
  readonly benchmark: string;
  readonly benchmarkHash: string;
  readonly itemIds: string[];
  readonly itemSubjects: (string | undefined)[];
  readonly stats: IndexStats;
  /** Items nothing can ever match. See IndexStats.uncheckableItems. */
  readonly uncheckableItemIds: string[];
  /** Of those, the ones the tokenizer could not segment. See NgramIndexData. */
  readonly unsegmentedItemIds: string[];
  private readonly map: Map<number, number[]>;

  private constructor(
    n: number,
    benchmark: string,
    benchmarkHash: string,
    itemIds: string[],
    itemSubjects: (string | undefined)[],
    map: Map<number, number[]>,
    stats: IndexStats,
    uncheckableItemIds: string[] = [],
    unsegmentedItemIds: string[] = [],
  ) {
    this.uncheckableItemIds = uncheckableItemIds;
    this.unsegmentedItemIds = unsegmentedItemIds;
    this.n = n;
    this.benchmark = benchmark;
    this.benchmarkHash = benchmarkHash;
    this.itemIds = itemIds;
    this.itemSubjects = itemSubjects;
    this.map = map;
    this.stats = stats;
  }

  get size(): number {
    return this.map.size;
  }

  static build(benchmark: string, items: BenchmarkItem[], options: BuildOptions = {}): NgramIndex {
    const n = options.n ?? DEFAULT_N;
    if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) {
      throw new RangeError(`n must be an integer in [${MIN_N}, ${MAX_N}], got ${n}`);
    }
    if (items.length === 0) throw new BenchmarkEmptyError(benchmark);

    const stride = options.stride ?? DEFAULT_STRIDE;
    if (!Number.isInteger(stride) || stride < 1) {
      throw new RangeError(`stride must be a positive integer, got ${stride}`);
    }

    const maxItemsPerGram = options.maxItemsPerGram ?? DEFAULT_MAX_ITEMS_PER_GRAM;

    // Tokenized by exactly the routine the scan uses, not by an equivalent one.
    //
    // The index used tokenize() while the scan used hashTokens(), and the two disagreed on
    // a handful of code points: "İstanbul" indexed as ["i", "stanbul"] — U+0130 lowercases
    // to two characters and the combining dot is not a letter — while the scan read it as
    // one token. A benchmark item containing that character could never be matched, and
    // nothing would have said so. Sharing the routine makes the class of bug impossible
    // rather than fixed.
    //
    // hashTokens reuses its buffers, so each item's hashes are copied out before the next
    // call overwrites them.
    const tokenized = items.map((it) => {
      const { hashes, count } = hashTokens(it.text);
      return hashes.slice(0, count);
    });

    // Stoplist is derived from this benchmark, not a hardcoded English list, so it works
    // for code and non-English benchmarks too.
    //
    // Two conditions, both required. Rank by raw count alone and a small benchmark's whole
    // vocabulary lands in the stoplist, every gram is dropped, and the scan reports zero
    // contamination while looking like it worked. Document frequency is the guard: a
    // stopword is a token most items contain, not merely a token seen often.
    // Keyed by token hash rather than token string: the hash is what the scan compares, so
    // a stoplist keyed by anything else is a second opinion about what a token is.
    const stop = new Set<number>();
    if (!options.disableStoplist && items.length >= STOPLIST_MIN_ITEMS) {
      const freq = new Map<number, number>();
      const docFreq = new Map<number, number>();
      for (const toks of tokenized) {
        for (const t of toks) freq.set(t, (freq.get(t) ?? 0) + 1);
        for (const t of new Set(toks)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
      }
      const minDocs = items.length * STOPLIST_MIN_DOC_RATIO;
      const ranked = [...freq.entries()]
        .filter(([t]) => (docFreq.get(t) ?? 0) >= minDocs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, STOPLIST_SIZE);
      for (const [t] of ranked) stop.add(t);
    }

    const map = new Map<number, number[]>();
    let gramsSeen = 0;
    let droppedStoplist = 0;
    let droppedStride = 0;

    tokenized.forEach((toks, itemIdx) => {
      // Per item, a gram counts once. A benchmark item that repeats a phrase should not
      // weight that phrase more heavily.
      const seenInItem = new Set<number>();
      forEachNgramHashed(toks, toks.length, n, (key, offset) => {
        gramsSeen++;
        // Sampled by position rather than by hash, so the kept grams stay evenly spread
        // across the item. Hash sampling would leave whole passages uncovered by luck.
        if (stride > 1 && offset % stride !== 0) {
          droppedStride++;
          return;
        }
        if (seenInItem.has(key)) return;

        let allStop = true;
        for (let k = offset; k < offset + n; k++) {
          if (!stop.has(toks[k])) {
            allStop = false;
            break;
          }
        }
        if (allStop) {
          droppedStoplist++;
          return;
        }

        seenInItem.add(key);
        const owners = map.get(key);
        if (owners) owners.push(itemIdx);
        else map.set(key, [itemIdx]);
      });
    });

    let droppedNonDiscriminative = 0;
    if (!options.disableDiscriminativeFilter) {
      for (const [key, owners] of map) {
        if (owners.length > maxItemsPerGram) {
          map.delete(key);
          droppedNonDiscriminative++;
        }
      }
    }

    const covered = new Set<number>();
    for (const owners of map.values()) for (const o of owners) covered.add(o);
    const uncheckableIdx: number[] = [];
    for (let i = 0; i < items.length; i++) if (!covered.has(i)) uncheckableIdx.push(i);

    const stats: IndexStats = {
      itemCount: items.length,
      gramsSeen,
      gramsKept: map.size,
      droppedStoplist,
      droppedNonDiscriminative,
      droppedStride,
      stride,
      maxItemsPerGram: options.disableDiscriminativeFilter ? Number.POSITIVE_INFINITY : maxItemsPerGram,
      uncheckableItems: uncheckableIdx.length,
    };

    const built = new NgramIndex(
      n,
      benchmark,
      contentHash(items.map((it) => `${it.id}\u0001${it.text}`)),
      items.map((it) => it.id),
      items.map((it) => it.subject),
      map,
      stats,
      uncheckableIdx.map((i) => items[i].id),
      // Why each uncheckable item is uncheckable, for the ones where the reason is the
      // scanner rather than the item. An unspaced script tokenizes to almost nothing, so it
      // lands here by a route that has nothing to do with being short — and a report that
      // called a Japanese essay "shorter than 10 tokens" would be describing the tokenizer
      // while appearing to describe the writing.
      uncheckableIdx.filter((i) => isUnsegmentedScript(items[i].text)).map((i) => items[i].id),
    );
    return built;
  }

  /**
   * Item indices owning this gram, or undefined.
   *
   * Hot path: called once per corpus token position. An open-addressing table over
   * typed arrays was tried here and measured 2.8x SLOWER than V8's Map (2549ms vs
   * 903ms over 12M probes), so the Map stays. See docs/measurements.md.
   */
  lookup(key: number): number[] | undefined {
    return this.map.get(key);
  }

  serialize(): NgramIndexData {
    const keys: number[] = [];
    const items: number[][] = [];
    for (const [k, v] of this.map) {
      keys.push(k);
      items.push(v);
    }
    return {
      formatVersion: INDEX_FORMAT_VERSION,
      benchmark: this.benchmark,
      benchmarkHash: this.benchmarkHash,
      n: this.n,
      itemIds: this.itemIds,
      itemSubjects: this.itemSubjects,
      keys,
      items,
      uncheckableItemIds: this.uncheckableItemIds,
      // Omitted entirely when empty, which is the overwhelmingly common case: an index of
      // an English benchmark should not carry an empty array in every published artifact
      // just because the field exists.
      unsegmentedItemIds: this.unsegmentedItemIds.length > 0 ? this.unsegmentedItemIds : undefined,
      stats: this.stats,
      scannerVersion: SCANNER_VERSION,
    };
  }

  static load(data: NgramIndexData): NgramIndex {
    if (data.formatVersion !== INDEX_FORMAT_VERSION) {
      throw new IndexVersionError(data.formatVersion, INDEX_FORMAT_VERSION);
    }
    const map = new Map<number, number[]>();
    for (let i = 0; i < data.keys.length; i++) map.set(data.keys[i], data.items[i]);
    const loaded = new NgramIndex(
      data.n,
      data.benchmark,
      data.benchmarkHash,
      data.itemIds,
      data.itemSubjects,
      map,
      data.stats,
      data.uncheckableItemIds ?? [],
      data.unsegmentedItemIds ?? [],
    );
    return loaded;
  }
}
