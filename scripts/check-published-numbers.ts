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
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Claim = { doc: string; label: string; expected: string };

function json<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
}

const REPORT = 'docs/silent-failures.md';
const README = 'README.md';
const MEASUREMENTS = 'docs/measurements.md';
// The front page publishes numbers too, and until now nothing checked it. It is the
// surface most people see and the one least likely to be updated when a scan is re-run.
const SITE = 'web/index.html';
// The registry page renders the same results a second time — generated, which is exactly
// how it drifted once: the generator only knew the instruction-set file while the front
// page had moved on to C4. Gating the generated page catches the stale-build failure mode.
const REGISTRY = 'web/registry.html';

for (const p of [REPORT, README, MEASUREMENTS, SITE, REGISTRY, 'results/pretraining-c4.json']) {
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
  rows: { n: number; paraphraseRecall: number; benchmarkUncheckable: number; benchmarkItems: number }[];
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
  // three places, so all three are checked against the same source of truth.
  { doc: REPORT, label: 'end-to-end throughput', expected: `${gsm8k.throughputMBs.toFixed(1)} MB/sec` },
  { doc: README, label: 'end-to-end throughput', expected: `${gsm8k.throughputMBs.toFixed(1)} MB/sec` },
  { doc: MEASUREMENTS, label: 'end-to-end throughput', expected: `${gsm8k.throughputMBs.toFixed(1)} MB/sec` },
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

const docs = new Map<string, string>();
for (const claim of claims) {
  if (!docs.has(claim.doc)) docs.set(claim.doc, readFileSync(resolve(claim.doc), 'utf8'));
}

let failed = 0;
process.stdout.write(`\n  checking ${claims.length} published figures against results/\n\n`);
for (const claim of claims) {
  const text = docs.get(claim.doc)!;
  const ok = text.includes(claim.expected);
  if (!ok) failed++;
  process.stdout.write(
    `  ${(ok ? 'ok  ' : 'FAIL').padEnd(6)}${claim.doc.padEnd(26)}${claim.label.padEnd(30)}${claim.expected}\n`,
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
