import { cosineDense, mean, punctuationRates, sentences, tokenize } from '../text.ts';
import { MIN_AUTHOR_RECORDS } from '../types.ts';
import type { DataRecord, SignalResult } from '../types.ts';

/**
 * Function words and punctuation are the classic authorship fingerprint: writers
 * cannot control them consciously, and topic does not drive them.
 */
const FUNCTION_WORDS = [
  'a', 'about', 'above', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only',
  'or', 'other', 'our', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
  'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your',
];

const PUNCT_KEYS = ['comma', 'period', 'semicolon', 'colon', 'dash', 'question', 'exclaim', 'quote', 'paren', 'apostrophe'];

function featureVector(texts: string[]): number[] {
  const counts = new Map<string, number>();
  let tokenTotal = 0;
  const punctAcc: number[] = new Array(PUNCT_KEYS.length).fill(0);
  const sentLens: number[] = [];
  const typeSet = new Set<string>();

  for (const text of texts) {
    const toks = tokenize(text);
    tokenTotal += toks.length;
    for (const t of toks) {
      typeSet.add(t);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const rates = punctuationRates(text, Math.max(1, toks.length));
    PUNCT_KEYS.forEach((k, i) => {
      punctAcc[i] += rates[k];
    });
    for (const s of sentences(text)) sentLens.push(tokenize(s).length);
  }

  const per1k = (n: number) => (tokenTotal === 0 ? 0 : (n * 1000) / tokenTotal);
  const vec = FUNCTION_WORDS.map((w) => per1k(counts.get(w) ?? 0));
  PUNCT_KEYS.forEach((_, i) => vec.push(punctAcc[i] / texts.length));
  vec.push(sentLens.length ? mean(sentLens) : 0);
  vec.push(tokenTotal === 0 ? 0 : typeSet.size / tokenTotal);
  return vec;
}

/**
 * Mean cosine distance between per-author style profiles.
 *
 * Two failure patterns this catches that no text detector does: forty "experts"
 * who all write like one model (distance collapses toward zero), and one
 * "expert" whose own records look like forty different writers.
 */
export function stylometrySignal(records: DataRecord[]): SignalResult {
  const byAuthor = new Map<string, DataRecord[]>();
  for (const r of records) {
    if (!r.authorId) continue;
    const arr = byAuthor.get(r.authorId);
    if (arr) arr.push(r);
    else byAuthor.set(r.authorId, [r]);
  }

  if (byAuthor.size === 0) {
    return {
      key: 'stylometry',
      label: 'Cross-author style distance',
      strength: 'strong',
      available: false,
      reason: 'batch ships no annotator_id field',
      value: null,
      detail:
        'This is the strongest available signal on a real vendor batch. Ask the vendor ' +
        'to deliver per-record annotator ids, or pass --author-field.',
      flagged: [],
    };
  }

  const eligible = [...byAuthor.entries()].filter(([, rs]) => rs.length >= MIN_AUTHOR_RECORDS);
  if (eligible.length < 2) {
    const largest = Math.max(...[...byAuthor.values()].map((v) => v.length));
    return {
      key: 'stylometry',
      label: 'Cross-author style distance',
      strength: 'strong',
      available: false,
      reason:
        `${eligible.length} of ${byAuthor.size} authors have >= ${MIN_AUTHOR_RECORDS} records ` +
        `(largest has ${largest}), need 2`,
      value: null,
      detail: 'Ingot does not estimate a style profile from a handful of records.',
      flagged: [],
    };
  }

  const profiles = eligible.map(([author, rs]) => ({ author, vec: featureVector(rs.map((r) => r.text)) }));

  let acc = 0;
  let pairs = 0;
  const perAuthor = new Map<string, { sum: number; n: number }>();
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const d = 1 - cosineDense(profiles[i].vec, profiles[j].vec);
      acc += d;
      pairs++;
      for (const p of [profiles[i], profiles[j]]) {
        const cur = perAuthor.get(p.author) ?? { sum: 0, n: 0 };
        cur.sum += d;
        cur.n += 1;
        perAuthor.set(p.author, cur);
      }
    }
  }
  const crossDistance = acc / pairs;

  // Within-author dispersion: how far an author's own records sit from their centroid.
  const dispersions = eligible.map(([author, rs]) => {
    const centroid = featureVector(rs.map((r) => r.text));
    const ds = rs.map((r) => 1 - cosineDense(featureVector([r.text]), centroid));
    return { author, dispersion: mean(ds) };
  });
  const meanDispersion = mean(dispersions.map((d) => d.dispersion));

  const tightest = [...perAuthor.entries()]
    .sort((a, b) => a[1].sum / a[1].n - b[1].sum / b[1].n)
    .slice(0, 10)
    .map(([author]) => author);

  return {
    key: 'stylometry',
    label: 'Cross-author style distance',
    strength: 'strong',
    available: true,
    value: crossDistance,
    detail:
      `mean cosine distance ${crossDistance.toFixed(4)} across ${eligible.length} authors ` +
      `(${pairs} pairs); within-author dispersion ${meanDispersion.toFixed(4)}. ` +
      `Low cross-author distance means the authors are not distinguishable from each other.`,
    flagged: tightest,
  };
}
