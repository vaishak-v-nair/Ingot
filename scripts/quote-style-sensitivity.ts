/**
 * If a copy of your writing had its quotation marks normalised, would Ingot still find it?
 *
 * Ingot's tokenizer treats the ASCII apostrophe as part of a word and the typographic one
 * (U+2019) as a separator. So `don't` written with a straight quote is ONE token, and the
 * same word written with a curly quote is TWO — `don` and `t`. Both spellings are common —
 * this script measures how common on the way past, and the two conventions turn out to be
 * roughly the whole corpus split down the middle rather than a rare edge.
 *
 * This script was written on the assumption that a changed apostrophe "shifts every
 * subsequent n-gram window", which would have made any re-quoted copy invisible. That is
 * wrong, and the measurement is what says so. The window is ten tokens wide and rolls, so a
 * changed character damages only the windows CONTAINING it: any run of ten consecutive
 * apostrophe-free tokens still matches exactly. The real variable is length, and the effect
 * is bounded by it rather than global.
 *
 * The question is therefore how short a text has to be before quote style breaks matching,
 * which only a curve answers. Measured on real C4 documents:
 *
 *   1. take documents from the corpus that actually use typographic apostrophes
 *   2. build an index from them exactly as they are
 *   3. scan a copy of those same documents with U+2019 rewritten to ASCII
 *   4. count how many the scanner still finds
 *
 * Step 3 is the single most common text transformation on the web — every CMS, exporter and
 * scraper that "cleans up smart quotes" performs it. The control run scans the documents
 * unmodified, which must find all of them, or the experiment is measuring a bug in itself.
 *
 * Writes results/quote-style-sensitivity.json. Nothing here changes the scanner: this
 * produces the number that a decision about the tokenizer would have to be made against,
 * and that decision is deliberately not made here — changing tokenization changes every
 * published figure, which is a call for whoever owns them.
 *
 *   node scripts/quote-style-sensitivity.ts [--shard path] [--docs 300]
 */
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { createGunzip } from 'node:zlib';
import { hashTokens } from '../src/contamination/fastTokens.ts';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { scanCorpus } from '../src/contamination/scan.ts';
import { SCANNER_VERSION } from '../src/types.ts';
import { parseScriptArgs } from './cli-flags.ts';

const USAGE = 'node scripts/quote-style-sensitivity.ts [--shard path] [--docs 300] [--out path]';
const { flags } = parseScriptArgs({ shard: 'value', docs: 'value', out: 'value' }, USAGE);

const shard = flags.get('shard') ?? '../corpora/c4-en/c4-train.00000-of-01024.json.gz';
const wanted = Number(flags.get('docs') ?? '300');
const outPath = flags.get('out') ?? 'results/quote-style-sensitivity.json';

if (!Number.isInteger(wanted) || wanted < 20) {
  process.stderr.write('\n  --docs must be an integer of at least 20\n\n');
  process.exit(2);
}
if (!existsSync(shard)) {
  process.stderr.write(`\n  no corpus shard at ${shard}\n  Fetch one with: node scripts/fetch-corpora.ts\n\n`);
  process.exit(2);
}

const CURLY = '’';
const CURLY_WORD = new RegExp(`[A-Za-z]${CURLY}[A-Za-z]`);

process.stdout.write(`\n  reading ${shard}\n`);

/**
 * Bucketed by token count, because the effect is length-dependent and a single average
 * would hide the only case that matters.
 *
 * Changing an apostrophe damages the n-gram windows that CONTAIN it and no others — the
 * rolling window is ten tokens wide, so a long document still matches on every stretch of
 * ten consecutive tokens that has no apostrophe in it. Which means the question is not
 * "does quote style break matching" but "how short does a text have to be before quote
 * style breaks matching", and only a curve answers that.
 */
const BUCKETS = [
  { label: '10-24 tokens', min: 10, max: 24 },
  { label: '25-49 tokens', min: 25, max: 49 },
  { label: '50-99 tokens', min: 50, max: 99 },
  { label: '100-299 tokens', min: 100, max: 299 },
  { label: '300+ tokens', min: 300, max: Number.POSITIVE_INFINITY },
];
const perBucket = Math.ceil(wanted / BUCKETS.length);

const STRAIGHT_WORD = /[A-Za-z]'[A-Za-z]/;

const docs: { id: string; text: string; bucket: string }[] = [];
const counts = new Map(BUCKETS.map((b) => [b.label, 0]));

// How common each convention is, over every document read on the way to filling the
// buckets. Without this the recall curve is a fact about a hand-picked cohort; with it,
// the doc can say how much of the corpus the cohort represents.
const prevalence = { documents: 0, curly: 0, straight: 0, both: 0 };

await new Promise<void>((done) => {
  const rl = createInterface({ input: createReadStream(shard).pipe(createGunzip()) });
  let seen = 0;
  rl.on('line', (line) => {
    if (docs.length >= perBucket * BUCKETS.length) { rl.close(); return; }
    seen++;
    let text: unknown;
    try { text = (JSON.parse(line) as { text?: unknown }).text; } catch { return; }
    if (typeof text !== 'string') return;

    prevalence.documents++;
    const hasCurly = CURLY_WORD.test(text);
    const hasStraight = STRAIGHT_WORD.test(text);
    if (hasCurly) prevalence.curly++;
    if (hasStraight) prevalence.straight++;
    if (hasCurly && hasStraight) prevalence.both++;

    // Must actually carry the character in question, or it measures nothing.
    if (!hasCurly) return;

    const tokens = hashTokens(text).count;
    const bucket = BUCKETS.find((b) => tokens >= b.min && tokens <= b.max);
    if (!bucket || (counts.get(bucket.label) ?? 0) >= perBucket) return;

    counts.set(bucket.label, (counts.get(bucket.label) ?? 0) + 1);
    docs.push({ id: `c4-${seen}`, text, bucket: bucket.label });
  });
  rl.on('close', () => done());
});

if (docs.length < 20) {
  process.stderr.write(`\n  only ${docs.length} usable documents found; nothing to measure\n\n`);
  process.exit(1);
}

process.stdout.write(`  ${docs.length} documents that use typographic apostrophes\n\n`);

const index = NgramIndex.build('quote-style', docs);
const tmp = resolve('reports/.quote-style');
mkdirSync(tmp, { recursive: true });

/** One JSONL of the same documents, optionally with the quote style rewritten. */
function corpusOf(name: string, transform: (s: string) => string): string {
  const p = resolve(tmp, `${name}.jsonl`);
  writeFileSync(p, docs.map((d) => JSON.stringify({ id: d.id, text: transform(d.text) })).join('\n') + '\n', 'utf8');
  return p;
}

const identical = await scanCorpus(index, corpusOf('identical', (s) => s));
const ASCII_APOSTROPHE = "'";
const normalised = await scanCorpus(index, corpusOf('normalised', (s) => s.split(CURLY).join(ASCII_APOSTROPHE)));

const exactOf = (r: typeof identical) => r.tiers.find((t) => t.tier === 'exact')!;
const control = exactOf(identical);
const treated = exactOf(normalised);

// The control must find everything it indexed. If it does not, the experiment is measuring
// the frequency filter or the stoplist rather than the quote style, and the number below
// would be attributing someone else's effect to this one.
const controlComplete = control.itemsHit === control.itemsTotal;

const foundControl = new Set(identical.contaminatedItemIds);
const foundTreated = new Set(normalised.contaminatedItemIds);

const byBucket = BUCKETS.map((b) => {
  const inBucket = docs.filter((d) => d.bucket === b.label);
  const c = inBucket.filter((d) => foundControl.has(d.id)).length;
  const t = inBucket.filter((d) => foundTreated.has(d.id)).length;
  return {
    bucket: b.label,
    documents: inBucket.length,
    foundUnchanged: c,
    foundAfterNormalisation: t,
    recall: c === 0 ? null : Number((t / c).toFixed(4)),
  };
}).filter((r) => r.documents > 0);

const recall = control.itemsHit === 0 ? 0 : treated.itemsHit / control.itemsHit;
const lost = control.itemsHit - treated.itemsHit;

const result = {
  measuredBy: 'scripts/quote-style-sensitivity.ts',
  scannerVersion: SCANNER_VERSION,
  shard,
  n: index.n,
  documents: docs.length,
  prevalence: {
    documentsRead: prevalence.documents,
    wordInternalCurly: prevalence.curly,
    wordInternalStraight: prevalence.straight,
    both: prevalence.both,
    curlyShare: Number((prevalence.curly / prevalence.documents).toFixed(4)),
    straightShare: Number((prevalence.straight / prevalence.documents).toFixed(4)),
  },
  control: { found: control.itemsHit, of: control.itemsTotal, complete: controlComplete },
  quotesNormalised: { found: treated.itemsHit, of: treated.itemsTotal },
  documentsLost: lost,
  recallAfterQuoteNormalisation: Number(recall.toFixed(4)),
  byLength: byBucket,
  note:
    'The tokenizer keeps the ASCII apostrophe inside a word and treats U+2019 as a separator, ' +
    'so the same word written both ways produces different tokens. The damage is local to the ' +
    'windows containing the changed character, so length is the variable that matters: a long ' +
    'document still matches on any ten consecutive tokens that contain no apostrophe. This ' +
    'measures verbatim-copy recall when the ONLY change is quote style.',
};

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), JSON.stringify(result, null, 2), 'utf8');

process.stdout.write(`  control, documents unchanged     ${control.itemsHit} of ${control.itemsTotal} found\n`);
if (!controlComplete) {
  process.stdout.write('    NOTE: the control did not find everything, so the figure below\n');
  process.stdout.write('    mixes this effect with the stoplist or the frequency filter.\n');
}
process.stdout.write(`  same documents, quotes to ASCII  ${treated.itemsHit} of ${treated.itemsTotal} found\n\n`);
process.stdout.write('  by length — the variable that actually decides it\n');
for (const b of byBucket) {
  const pct = b.recall === null ? '—' : `${(b.recall * 100).toFixed(1)}%`;
  process.stdout.write(
    `    ${b.bucket.padEnd(15)} ${String(b.foundAfterNormalisation).padStart(4)} of ` +
      `${String(b.foundUnchanged).padStart(4)} still found   ${pct}\n`,
  );
}
process.stdout.write(`\n  RECALL AFTER QUOTE NORMALISATION: ${(recall * 100).toFixed(1)}% overall\n`);
process.stdout.write(`  ${lost} of ${control.itemsHit} verbatim copies became invisible.\n\n`);
process.stdout.write(`  wrote ${outPath}\n\n`);
