/**
 * Fails if a number published in prose no longer matches the results file it came from.
 *
 * Every measured claim in this repository is supposed to trace to a file under results/.
 * Nothing enforced that for prose. A scan gets re-run, a figure moves, and the report keeps
 * quoting the old one — which is the exact failure the report itself is about, committed by
 * the report itself.
 *
 * The check is deliberately dumb: derive the expected string from the JSON, then assert it
 * appears in the document. A dumb check that fails loudly beats a clever one that parses
 * prose and is wrong about what it found.
 *
 *   node scripts/check-published-numbers.ts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

type Claim = { doc: string; label: string; expected: string };

function json<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
}

const REPORT = 'docs/silent-failures.md';
const README = 'README.md';
const MEASUREMENTS = 'docs/measurements.md';
// The about page quotes measured figures too. It went ungated because nobody edits it —
// which is precisely how a page drifts.
const ABOUT = 'web/about.html';
// The front page publishes numbers too, and until now nothing checked it. It is the
// surface most people see and the one least likely to be updated when a scan is re-run.
const SITE = 'web/index.html';
// The registry page renders the same results a second time — generated, which is exactly
// how it drifted once: the generator only knew the instruction-set file while the front
// page had moved on to C4. Gating the generated page catches the stale-build failure mode.
const REGISTRY = 'web/registry.html';

for (const p of [REPORT, README, MEASUREMENTS, SITE, REGISTRY, ABOUT, 'results/pretraining-c4.json', 'results/registry.json']) {
  if (!existsSync(resolve(p))) {
    process.stderr.write(`\n  missing: ${p}\n\n`);
    process.exit(2);
  }
}

const c4 = json<{
  corpus: { uncompressedBytes: number };
  results: {
    benchmark: string;
    itemsHit: number;
    itemsTotal: number;
    totalMatches: number;
    droppedGeneric: number;
    corpusDocs: number;
    corpusTokens: number;
    corpusHash: string;
    throughputMBs: number;
    samples?: { benchmarkItemId: string; matchedText: string }[];
  }[];
}>('results/pretraining-c4.json');

const shard = json<{ results: { benchmark: string; corpusDocs: number }[] }>('results/pretraining-c4-1shard.json');
const sweep = json<{
  rows: {
    n: number;
    paraphraseRecall: number;
    benchmarkUncheckable: number;
    benchmarkItems: number;
    controlFalsePositives: number;
  }[];
}>('results/contamination-validation.json');

const mmlu = c4.results.find((r) => r.benchmark === 'mmlu')!;
const gsm8k = c4.results.find((r) => r.benchmark === 'gsm8k')!;
const droppedTotal = c4.results.reduce((a, r) => a + r.droppedGeneric, 0);
const n10 = sweep.rows.find((r) => r.n === 10)!;
const n13 = sweep.rows.find((r) => r.n === 13)!;

const claims: Claim[] = [
  { doc: REPORT, label: 'corpus size', expected: `${(c4.corpus.uncompressedBytes / 1e9).toFixed(2)} GB` },
  { doc: REPORT, label: 'corpus documents', expected: mmlu.corpusDocs.toLocaleString('en-US') },
  { doc: REPORT, label: 'corpus tokens', expected: mmlu.corpusTokens.toLocaleString('en-US') },
  { doc: REPORT, label: 'mmlu items flagged', expected: `${mmlu.itemsHit} / ${mmlu.itemsTotal.toLocaleString('en-US')}` },
  { doc: REPORT, label: 'mmlu matches', expected: `${mmlu.totalMatches} matches` },
  { doc: REPORT, label: 'total dropped by filter', expected: `${droppedTotal}` },
  { doc: REPORT, label: 'single-shard documents', expected: shard.results[0].corpusDocs.toLocaleString('en-US') },
  { doc: REPORT, label: 'edited-copy recall at n=10', expected: `${(n10.paraphraseRecall * 100).toFixed(1)}%` },
  { doc: REPORT, label: 'edited-copy recall at n=13', expected: `${(n13.paraphraseRecall * 100).toFixed(1)}%` },
  {
    doc: REPORT,
    label: 'unscannable at n=13',
    expected: `${((n13.benchmarkUncheckable / n13.benchmarkItems) * 100).toFixed(1)}%`,
  },
  {
    doc: REPORT,
    label: 'unscannable at n=10',
    expected: `${((n10.benchmarkUncheckable / n10.benchmarkItems) * 100).toFixed(1)}%`,
  },
  {
    doc: REPORT,
    label: 'unscannable, as published in the sweep table',
    expected: `${n13.benchmarkUncheckable} / ${n13.benchmarkItems}`,
  },
  // The throughput figure is the one that was already published wrong once. It is quoted in
  // five places, so all five are checked against the same source of truth — the front page
  // and the about page were the two this comment used to miss, and the front page is the
  // surface most people see.
  { doc: REPORT, label: 'end-to-end throughput', expected: `${gsm8k.throughputMBs.toFixed(1)} MB/sec` },
  { doc: README, label: 'end-to-end throughput', expected: `${gsm8k.throughputMBs.toFixed(1)} MB/sec` },
  { doc: MEASUREMENTS, label: 'end-to-end throughput', expected: `${gsm8k.throughputMBs.toFixed(1)} MB/sec` },
  { doc: SITE, label: 'site: end-to-end throughput', expected: `${gsm8k.throughputMBs.toFixed(1)} MB/sec` },
  { doc: ABOUT, label: 'about: end-to-end throughput', expected: `${gsm8k.throughputMBs.toFixed(1)} MB/sec` },
  // The Method section's resolution-sweep table and its bolded conclusions, gated on the
  // front page with the same figures the report is gated on. A re-run that shifts recall
  // used to update docs/silent-failures.md under CI pressure while the front page's
  // hand-typed table kept the old numbers and passed everything.
  ...sweep.rows.flatMap((row) => {
    const rowClaims: Claim[] = [
      {
        doc: SITE,
        label: `site: sweep n=${row.n} edited-copy recall`,
        expected: `${(row.paraphraseRecall * 100).toFixed(1)}%`,
      },
      {
        doc: SITE,
        label: `site: sweep n=${row.n} unscannable`,
        expected: `${row.benchmarkUncheckable} / ${row.benchmarkItems}`,
      },
    ];
    if (row.controlFalsePositives > 0) {
      rowClaims.push({
        doc: SITE,
        label: `site: sweep n=${row.n} false positives`,
        expected: `${row.controlFalsePositives} / ${row.benchmarkItems}`,
      });
    }
    return rowClaims;
  }),
  {
    doc: SITE,
    label: 'site: unscannable at n=13',
    expected: `${((n13.benchmarkUncheckable / n13.benchmarkItems) * 100).toFixed(1)}%`,
  },
  {
    doc: SITE,
    label: 'site: unscannable at n=10',
    expected: `${((n10.benchmarkUncheckable / n10.benchmarkItems) * 100).toFixed(1)}%`,
  },
  // The benchmark menu itself publishes item counts now; they come from the same runs.
  ...c4.results.map((r) => ({
    doc: SITE,
    label: `site: ${r.benchmark} menu item count`,
    expected: `${r.itemsTotal.toLocaleString('en-US')} items`,
  })),
  // The front page carries the C4 registry table. Each row is checked separately so a
  // re-run that moves one benchmark cannot slip through because the others still match.
  { doc: SITE, label: 'site: corpus size', expected: `${(c4.corpus.uncompressedBytes / 1e9).toFixed(2)} GB` },
  { doc: SITE, label: 'site: corpus documents', expected: mmlu.corpusDocs.toLocaleString('en-US') },
  { doc: SITE, label: 'site: corpus tokens', expected: mmlu.corpusTokens.toLocaleString('en-US') },
  ...c4.results.map((r) => ({
    doc: SITE,
    label: `site: ${r.benchmark} flagged`,
    expected: `${r.itemsHit} / ${r.itemsTotal}`,
  })),
  ...c4.results.map((r) => ({
    doc: SITE,
    label: `site: ${r.benchmark} rate`,
    expected: `${(r.rate * 100).toFixed(3)}%`,
  })),
  // The rail prints the corpus hash, which is the one figure on the page a reader can use to
  // prove two reports name the same bytes. A stale one is worse than none: it would claim
  // provenance for a corpus that is no longer the corpus that was scanned.
  { doc: SITE, label: 'site: corpus hash', expected: mmlu.corpusHash },
  // The front page bakes in one real specimen match (the NATO Article 5 ten-gram) so every
  // visitor sees the product's output without running anything. It must stay the match the
  // results file actually contains — a drifted specimen would be a fabricated exhibit on a
  // page whose whole argument is evidence.
  ...(mmlu.samples?.some((s) => s.benchmarkItemId === 'mmlu-5951')
    ? [
        { doc: SITE, label: 'site: specimen item', expected: 'mmlu-5951' },
        {
          doc: SITE,
          label: 'site: specimen text',
          expected: mmlu.samples.find((s) => s.benchmarkItemId === 'mmlu-5951')!.matchedText,
        },
      ]
    : [{ doc: SITE, label: 'site: specimen source missing from results', expected: 'SPECIMEN-SOURCE-MISSING' }]),
  { doc: SITE, label: 'site: total discarded by filter', expected: `${droppedTotal}` },
  { doc: SITE, label: 'site: single-shard documents', expected: shard.results[0].corpusDocs.toLocaleString('en-US') },
  // The registry page's C4 section, checked row by row like the front page's.
  { doc: REGISTRY, label: 'registry: corpus size', expected: `${(c4.corpus.uncompressedBytes / 1e9).toFixed(2)} GB` },
  { doc: REGISTRY, label: 'registry: corpus documents', expected: mmlu.corpusDocs.toLocaleString('en-US') },
  { doc: REGISTRY, label: 'registry: corpus tokens', expected: mmlu.corpusTokens.toLocaleString('en-US') },
  { doc: REGISTRY, label: 'registry: corpus hash', expected: mmlu.corpusHash },
  ...c4.results.map((r) => ({
    doc: REGISTRY,
    label: `registry: ${r.benchmark} flagged`,
    expected: `${r.itemsHit} / ${r.itemsTotal.toLocaleString('en-US')}`,
  })),
  ...c4.results.map((r) => ({
    doc: REGISTRY,
    label: `registry: ${r.benchmark} rate`,
    expected: `${(r.rate * 100).toFixed(3)}%`,
  })),
  { doc: REGISTRY, label: 'registry: total discarded by filter', expected: `${droppedTotal} matches` },
];

// The instruction-tuning section of the registry page renders results/registry.json — the
// one results file this gate never read, which meant both of its tables and the distinct-
// flagged headline could go stale without anything noticing: the exact stale-build failure
// the REGISTRY gating exists to catch.
const reg = json<{
  defaultN: number;
  results: {
    benchmark: string;
    corpus: string;
    n: number;
    itemsHit: number;
    itemsTotal: number;
    contaminatedItemIds: string[];
  }[];
}>('results/registry.json');
const regDefault = reg.results.filter((r) => r.n === reg.defaultN);
const regTotalItems = [...new Map(regDefault.map((r) => [r.benchmark, r.itemsTotal])).values()].reduce(
  (a, n) => a + n,
  0,
);
const regFlagged = new Set(
  regDefault.flatMap((r) => r.contaminatedItemIds.map((id) => `${r.benchmark}::${id}`)),
).size;
claims.push(
  {
    doc: REGISTRY,
    label: 'registry: instruction distinct-flagged headline',
    expected: `${regFlagged} distinct benchmark items flagged out of ${regTotalItems.toLocaleString('en-US')}`,
  },
  ...reg.results.map((r) => ({
    doc: REGISTRY,
    label: `registry: instruction ${r.benchmark} in ${r.corpus} n=${r.n}`,
    expected: `${r.itemsHit} / ${r.itemsTotal.toLocaleString('en-US')}`,
  })),
);

// The suite count is a published figure like any other, and it drifted: the README said
// 44 while the suite had grown to 64, and no gate noticed because the count was
// hand-typed. Derived here from the test files themselves — the number of top-level
// test( calls is exactly what node --test runs.
const testCount = readdirSync(resolve('test'))
  .filter((f) => f.endsWith('.test.ts'))
  .reduce((a, f) => a + (readFileSync(resolve('test', f), 'utf8').match(/^test\(/gm)?.length ?? 0), 0);
claims.push({ doc: README, label: 'test suite size', expected: `${testCount} tests` });

// The defect count on the front page was hand-typed, and by the time anyone looked it said
// eleven while the log held twelve — the same drift as the test count, in the number that
// advertises how carefully this thing is checked. Derived from the log's own numbered list.
const defectCount = (
  readFileSync(resolve('docs/measurements.md'), 'utf8')
    .split('## Defects found by measurement')[1]
    ?.split('\n## ')[0] ?? ''
).match(/^\d+\. \*\*/gm)?.length ?? 0;
claims.push({ doc: SITE, label: 'defects written up', expected: `All ${defectCount} are written up` });

// Release coherence: one version, three hand-bumped places that must all name it. The
// action pin decides which scanner every Action consumer runs; the changelog heading is
// the release's public record; SCANNER_VERSION is stamped into every receipt. A release
// that forgets one leaves consumers silently running — or receipts silently attributing —
// the wrong scanner, and 0.1.1 through 0.1.3 shipped receipts saying ingot-0.1.0 because
// exactly nothing checked this.
const pkgVersion = json<{ version: string }>('package.json').version;
claims.push(
  { doc: 'action.yml', label: 'action pins the released package', expected: `ingot-scan@${pkgVersion}` },
  { doc: 'CHANGELOG.md', label: 'changelog names the release', expected: `## ${pkgVersion}` },
  { doc: 'src/types.ts', label: 'receipts name the released scanner', expected: `'ingot-${pkgVersion}'` },
);

// Caveat parity, and the only gate here that asserts a phrase rather than a figure.
//
// The README's "read this before the numbers" list gained three epistemic limits that the
// front page never got. That is the wrong way round: the site is the surface most readers
// meet, and someone who acts on a clean result without ever opening the repository is
// precisely the person the limits are for. Asserting each phrase in BOTH documents means
// neither surface can quietly lose one, and a future edit that rewords a caveat has to
// reword it in both places or fail here.
for (const phrase of [
  'Canonical is not the same as harmless',
  'Questions are indexed; answers are not',
  'means after normalization',
]) {
  claims.push(
    { doc: README, label: 'caveat parity', expected: phrase },
    { doc: SITE, label: 'caveat parity', expected: phrase },
  );
}

// The feasibility decision is argued from measured numbers like everything else, and it is
// the kind of document that rots quietly: it concludes "kill", so nobody re-reads it, and
// the figures it killed on would go stale without a single reader noticing. Gated on the
// same terms as every published claim.
if (existsSync(resolve('results/membership-size.json'))) {
  const m = json<{
    projected: { gramsPerByte: number; totalGrams: number; distinctGrams: number };
    heaps: { beta: number };
    corpus: { uncompressedBytes: number };
    sizes: {
      winnowRate: number;
      projectedCorpusDistinct: number;
      bytesAt1pct: number;
      falsePositivesPer1000Words: number;
      detection: { words: number; probability: number }[];
    }[];
  }>('results/membership-size.json');

  const SELFSERVE = 'docs/self-serve-feasibility.md';
  const mb = (bytes: number): string =>
    (bytes / 1e6).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const rate = (r: number) => m.sizes.find((s) => s.winnowRate === r)!;
  const detect = (r: number, words: number): string =>
    `${(rate(r).detection.find((d) => d.words === words)!.probability * 100).toFixed(1)}%`;

  claims.push(
    { doc: SELFSERVE, label: 'corpus size', expected: `${(m.corpus.uncompressedBytes / 1e9).toFixed(2)} GB` },
    { doc: SELFSERVE, label: 'grams per byte', expected: m.projected.gramsPerByte.toFixed(4) },
    {
      doc: SELFSERVE,
      label: 'total grams',
      expected: Math.round(m.projected.totalGrams).toLocaleString('en-US'),
    },
    {
      doc: SELFSERVE,
      label: 'distinct grams',
      expected: Math.round(m.projected.distinctGrams).toLocaleString('en-US'),
    },
    { doc: SELFSERVE, label: 'heaps exponent', expected: m.heaps.beta.toFixed(4) },
    {
      doc: SELFSERVE,
      label: 'share of grams that are unique',
      expected: `${((m.projected.distinctGrams / m.projected.totalGrams) * 100).toFixed(1)}% of grams are unique`,
    },
    { doc: SELFSERVE, label: 'unwinnowed structure size', expected: `${mb(rate(1).bytesAt1pct)} MB` },
    {
      doc: SELFSERVE,
      label: 'winnowed 1/64 distinct',
      expected: rate(64).projectedCorpusDistinct.toLocaleString('en-US'),
    },
    { doc: SELFSERVE, label: 'winnowed 1/64 size', expected: `${mb(rate(64).bytesAt1pct)} MB` },
    {
      doc: SELFSERVE,
      label: 'winnowed 1/256 distinct',
      expected: rate(256).projectedCorpusDistinct.toLocaleString('en-US'),
    },
    { doc: SELFSERVE, label: 'winnowed 1/256 size', expected: `${mb(rate(256).bytesAt1pct)} MB` },
    // The false-positive column is the argument, so it is gated cell by cell.
    { doc: SELFSERVE, label: 'false hits, unwinnowed', expected: rate(1).falsePositivesPer1000Words.toFixed(3) },
    { doc: SELFSERVE, label: 'false hits, 1/64', expected: rate(64).falsePositivesPer1000Words.toFixed(3) },
    { doc: SELFSERVE, label: 'false hits, 1/256', expected: rate(256).falsePositivesPer1000Words.toFixed(3) },
    { doc: SELFSERVE, label: 'detection 1/64 at 200 words', expected: detect(64, 200) },
    { doc: SELFSERVE, label: 'detection 1/256 at 500 words', expected: detect(256, 500) },
  );
}

// Quote-style sensitivity needs a real C4 shard on disk, so like the canonicality run its
// absence is not a failure and a mismatch is. The recall curve is the reason the tokenizer
// was NOT changed, which makes it exactly the kind of figure that must not drift quietly:
// a decision recorded against a number is only as good as the number staying true.
if (existsSync(resolve('results/quote-style-sensitivity.json'))) {
  const q = json<{
    prevalence: { documentsRead: number; curlyShare: number; straightShare: number };
    byLength: { bucket: string; recall: number | null }[];
  }>('results/quote-style-sensitivity.json');
  const COVERAGE = 'docs/coverage.md';
  const shortBucket = q.byLength.find((b) => b.bucket === '10-24 tokens');

  claims.push(
    {
      doc: COVERAGE,
      label: 'documents read for quote prevalence',
      expected: q.prevalence.documentsRead.toLocaleString('en-US'),
    },
    {
      doc: COVERAGE,
      label: 'quote-style prevalence',
      // One line, because a load-bearing figure may never wrap: see DESIGN.md.
      expected:
        `**${(q.prevalence.curlyShare * 100).toFixed(1)}% use a word-internal curly apostrophe, ` +
        `${(q.prevalence.straightShare * 100).toFixed(1)}% an ASCII one.**`,
    },
  );
  if (shortBucket?.recall != null) {
    claims.push({
      doc: COVERAGE,
      label: 'recall at 10-24 tokens after re-quoting',
      expected: `**${(shortBucket.recall * 100).toFixed(1)}%**`,
    });
  }
}

// The canonicality run is optional: the report ships whether or not that scan has been run,
// so the file's absence is not a failure, but a mismatch is.
if (existsSync(resolve('results/canonicality.json'))) {
  const canon = json<{
    confirmedCanonical: string[];
    webCorpusOnly: string[];
    webCorpus: { itemsFlagged: number };
    referenceCorpus: { documents: number };
    controlSet: { confirmed: number; total: number };
  }>('results/canonicality.json');
  claims.push(
    { doc: REPORT, label: 'items confirmed canonical', expected: `${canon.confirmedCanonical.length}` },
    { doc: REPORT, label: 'items web-corpus only', expected: `${canon.webCorpusOnly.length}` },
    { doc: REPORT, label: 'reference corpus documents', expected: canon.referenceCorpus.documents.toLocaleString('en-US') },
    {
      doc: REPORT,
      label: 'control set result',
      expected: `${canon.controlSet.confirmed} of ${canon.controlSet.total}`,
    },
    { doc: SITE, label: 'site: items confirmed canonical', expected: `${canon.confirmedCanonical.length}` },
    { doc: SITE, label: 'site: items undetermined', expected: `${canon.webCorpusOnly.length}` },
    { doc: SITE, label: 'site: reference corpus documents', expected: canon.referenceCorpus.documents.toLocaleString('en-US') },
    {
      doc: SITE,
      label: 'site: control set result',
      expected: `${canon.controlSet.confirmed} of ${canon.controlSet.total}`,
    },
    // The registry page carries the full cross-provenance section, so the same four
    // figures are asserted there in the exact phrases the generator emits.
    {
      doc: REGISTRY,
      label: 'registry: items confirmed canonical',
      expected: `${canon.confirmedCanonical.length} of the ${canon.webCorpus.itemsFlagged}`,
    },
    {
      doc: REGISTRY,
      label: 'registry: items undetermined',
      expected: `${canon.webCorpusOnly.length} are undetermined`,
    },
    { doc: REGISTRY, label: 'registry: reference corpus documents', expected: canon.referenceCorpus.documents.toLocaleString('en-US') },
    {
      doc: REGISTRY,
      label: 'registry: control set result',
      expected: `${canon.controlSet.confirmed} of ${canon.controlSet.total}`,
    },
  );
}

// The distillation pass ships with its two verdict artifacts — the triage runs and the
// train-split check — and the page quotes all three. Same rule as everywhere else: the
// phrases carrying the figures are asserted against the files that produced them.
if (existsSync(resolve('results/sft-slimorca.json'))) {
  const sft = json<{
    results: { benchmark: string; n: number; itemsHit: number; itemsTotal: number; corpusDocs: number; corpusHash: string; rate: number }[];
  }>('results/sft-slimorca.json');
  claims.push(
    { doc: REGISTRY, label: 'registry: slimorca documents', expected: sft.results[0].corpusDocs.toLocaleString('en-US') },
    { doc: REGISTRY, label: 'registry: slimorca corpus hash', expected: sft.results[0].corpusHash },
    ...sft.results.map((r) => ({
      doc: REGISTRY,
      label: `registry: slimorca ${r.benchmark} n=${r.n} flagged`,
      expected: `${r.itemsHit} / ${r.itemsTotal.toLocaleString('en-US')}`,
    })),
  );
  for (const p of ['results/sft-slimorca-triage.json', 'results/sft-slimorca-train-check.json']) {
    if (!existsSync(resolve(p))) {
      claims.push({ doc: REGISTRY, label: `verdict artifact missing: ${p}`, expected: 'VERDICT-ARTIFACT-MISSING' });
    }
  }
  if (existsSync(resolve('results/sft-slimorca-triage.json'))) {
    const t = json<{ rows: { verdict: string }[] }>('results/sft-slimorca-triage.json');
    const count = (v: string): number => t.rows.filter((r) => r.verdict === v).length;
    claims.push({
      doc: REGISTRY,
      label: 'registry: slimorca triage verdicts',
      expected: `${count('leaked')} leaked · ${count('partial')} partial · ${count('phrase')} phrase-level`,
    });
  }
  if (existsSync(resolve('results/sft-slimorca-train-check.json'))) {
    const tc = json<{
      summary: { flaggedTestItems: number; testItemsReproducedVerbatim: number; itemsWithTrainSiblingInDocs: number };
    }>('results/sft-slimorca-train-check.json');
    claims.push(
      {
        doc: REGISTRY,
        label: 'registry: train siblings beside flagged test items',
        expected: `${tc.summary.itemsWithTrainSiblingInDocs} of ${tc.summary.flaggedTestItems} flagged`,
      },
      {
        doc: REGISTRY,
        label: 'registry: test questions reproduced verbatim',
        expected: `${tc.summary.testItemsReproducedVerbatim} test questions appear verbatim`,
      },
    );
  }
}

const docs = new Map<string, string>();
for (const claim of claims) {
  if (!docs.has(claim.doc)) docs.set(claim.doc, readFileSync(resolve(claim.doc), 'utf8'));
}

// The two indexes that ship — inside the npm tarball and to every browser — each record
// the scanner that built them, and nothing regenerated them when 0.1.3 landed. Both still
// said ingot-0.1.0 while action.yml, the changelog and SCANNER_VERSION had all been
// bumped: the exact drift the release-coherence block above exists to stop, surviving in
// the two artifacts a stranger actually receives. A provenance tool whose own shipped
// artifact misstates its provenance is the failure it was built to find.
//
// They seed the document map directly because they are gzipped binary rather than prose,
// and the loop above would read the compressed bytes. latin1 leaves the ASCII header
// exact instead of folding the binary tail into replacement characters.
for (const idx of ['web/indexes/humaneval.idx.bin.gz', 'web/indexes/gsm8k.idx.bin.gz']) {
  docs.set(idx, gunzipSync(readFileSync(resolve(idx))).toString('latin1'));
  claims.push({
    doc: idx,
    label: 'shipped index names its builder',
    expected: `"scannerVersion":"ingot-${pkgVersion}"`,
  });
}

let failed = 0;
process.stdout.write(`\n  checking ${claims.length} published figures against results/\n\n`);
for (const claim of claims) {
  const text = docs.get(claim.doc)!;
  const ok = text.includes(claim.expected);
  if (!ok) failed++;
  process.stdout.write(
    `  ${(ok ? 'ok  ' : 'FAIL').padEnd(6)}${claim.doc.padEnd(34)}${claim.label.padEnd(30)}${claim.expected}\n`,
  );
}

if (failed > 0) {
  process.stdout.write(
    `\n  ${failed} published figure(s) no longer match results/.\n` +
      `  Either the prose is stale, or a scan was re-run and the docs were not updated.\n` +
      `  Read the diff before changing either one.\n\n`,
  );
  process.exit(1);
}

process.stdout.write(`\n  all ${claims.length} figures trace to results/\n\n`);
