/** Deterministic text primitives. No model calls, no network, no randomness without a seed. */

const WORD_RE = /[\p{L}\p{N}']+/gu;
const SENTENCE_SPLIT_RE = /(?<=[.!?])[\s]+|\n+/u;

export function normalizeText(input: string): { text: string; changed: boolean } {
  let text = input;
  let changed = false;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    changed = true;
  }
  if (text.includes('\r')) {
    text = text.replace(/\r\n?/g, '\n');
    changed = true;
  }
  return { text, changed };
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? [];
}

export function sentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function shingles(tokens: string[], k: number): string[] {
  if (tokens.length < k) return tokens.length ? [tokens.join(' ')] : [];
  const out: string[] = [];
  for (let i = 0; i + k <= tokens.length; i++) out.push(tokens.slice(i, i + k).join(' '));
  return out;
}

/** FNV-1a, 32 bit. Stable across runs and platforms, which matters for reproducible reports. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mixes a base hash with a seed so one string yields k independent hash values. */
export function mixHash(base: number, seed: number): number {
  let h = (base ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** Seeded PRNG. Sampling must be reproducible or a report cannot be defended. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) acc += (x - m) * (x - m);
  return Math.sqrt(acc / (xs.length - 1));
}

export function cosineSparse(a: Map<number, number>, b: Map<number, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w !== undefined) dot += v * w;
  }
  return dot;
}

export function l2NormalizeSparse(v: Map<number, number>): void {
  let acc = 0;
  for (const x of v.values()) acc += x * x;
  const norm = Math.sqrt(acc);
  if (norm === 0) return;
  for (const [k, x] of v) v.set(k, x / norm);
}

export function cosineDense(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function punctuationRates(text: string, tokenCount: number): Record<string, number> {
  const per = (n: number) => (tokenCount === 0 ? 0 : (n * 1000) / tokenCount);
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  return {
    comma: per(count(/,/g)),
    period: per(count(/\./g)),
    semicolon: per(count(/;/g)),
    colon: per(count(/:/g)),
    dash: per(count(/[-–—]/g)),
    question: per(count(/\?/g)),
    exclaim: per(count(/!/g)),
    quote: per(count(/["'“”]/g)),
    paren: per(count(/[()]/g)),
    apostrophe: per(count(/'/g)),
  };
}
