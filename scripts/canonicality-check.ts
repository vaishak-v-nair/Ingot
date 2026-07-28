/**
 * Tests whether benchmark items flagged against a web corpus are canonical text or leakage.
 *
 * The logic: a passage that reached two corpora by GENUINELY DIFFERENT routes is a property
 * of the language, not evidence a benchmark leaked. The Declaration of Independence is in
 * scraped web pages and in digitised books because it is the Declaration of Independence.
 * A benchmark item that leaked into one training corpus is specific to that corpus.
 *
 * The trap this avoids: C4, RedPajama and FineWeb are all Common Crawl derivatives, so
 * "confirmed in two of them" most likely means one web page survived two filtering
 * pipelines. The reference corpus here is built by fetch-reference-corpus.ts with every
 * web-crawl subset removed, so a confirmation means print, court records, patents or
 * encyclopedia articles — routes a crawler was never involved in.
 *
 *   node scripts/fetch-reference-corpus.ts
 *   node scripts/canonicality-check.ts
 *
 * Emits results/canonicality.json (the finding) and results/canonical-grams.json (the
 * artifact a scanner could consume). The artifact carries GRAM HASHES AND ITEM IDS, never
 * benchmark text — the same rule a published index follows, for the same reason: the
 * benchmark's licence is not ours to relicense.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { scanCorpus } from '../src/contamination/scan.ts';
import { DEFAULT_N } from '../src/contamination/types.ts';
import { loadBatch } from '../src/loader.ts';
import { SCANNER_VERSION } from '../src/types.ts';
import type { BenchmarkItem, ContaminationHit } from '../src/contamination/types.ts';

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const refDir = resolve(flag('reference', '../corpora/pile-noncrawl'));
const webResults = resolve(flag('web-results', 'results/pretraining-c4.json'));
const benchName = flag('benchmark', 'mmlu');
const benchPath = resolve(flag('bench', `data/bench/${benchName}.jsonl`));
const n = Number(flag('n', String(DEFAULT_N)));

for (const [label, p] of [
  ['reference manifest', join(refDir, 'manifest.json')],
  ['web scan results', webResults],
  ['benchmark', benchPath],
] as const) {
  if (!existsSync(p)) {
    process.stderr.write(`\n  missing ${label}: ${p}\n\n`);
    process.exit(2);
  }
}

const manifest = JSON.parse(readFileSync(join(refDir, 'manifest.json'), 'utf8')) as {
  documents: number;
  droppedDocuments: number;
  excludedAsWebDerived: string[];
  keptBySubset: Record<string, number>;
  file: { name: string; bytes: number; sha256: string };
};
const web = JSON.parse(readFileSync(webResults, 'utf8')) as {
  corpus: { name: string; shardCount: number; uncompressedBytes: number };
  results: { benchmark: string; contaminatedItemIds: string[]; itemsTotal: number }[];
};
const webRow = web.results.find((r) => r.benchmark === benchName);
if (!webRow) {
  process.stderr.write(`\n  no ${benchName} row in ${webResults}\n\n`);
  process.exit(2);
}
const webFlagged = new Set(webRow.contaminatedItemIds);

const items: BenchmarkItem[] = loadBatch(benchPath).records.map((r) => ({ id: r.id, text: r.text }));
const index = NgramIndex.build(benchName, items, { n });

process.stdout.write(`\n  CANONICALITY CHECK — ${SCANNER_VERSION}\n\n`);
process.stdout.write(`  benchmark   ${benchName} · ${items.length.toLocaleString()} items · n=${n}\n`);
process.stdout.write(`  web corpus  ${web.corpus.name} · ${(web.corpus.uncompressedBytes / 1e9).toFixed(2)} GB · ${webFlagged.size} items flagged\n`);
process.stdout.write(`  reference   pile-noncrawl · ${manifest.documents.toLocaleString()} docs · excludes ${manifest.excludedAsWebDerived.join(', ')}\n\n`);

const report = await scanCorpus(index, join(refDir, manifest.file.name), {
  corpusName: 'pile-noncrawl',
  command: `node scripts/canonicality-check.ts --benchmark ${benchName} --n ${n}`,
  onProgress: (docs, tokens) => {
    if (docs % 100_000 === 0) {
      process.stdout.write(`    ${(docs / 1e3).toFixed(0)}k docs · ${(tokens / 1e6).toFixed(0)}M tokens\n`);
    }
  },
});

const exact = report.tiers.find((t) => t.tier === 'exact')!;
const refFlagged = new Set(report.contaminatedItemIds);

// The intersection is the finding. An item flagged in BOTH a web crawl and a corpus of
// print, court records and encyclopedia articles is canonical text by construction.
const confirmedCanonical = [...webFlagged].filter((id) => refFlagged.has(id)).sort();
const webOnly = [...webFlagged].filter((id) => !refFlagged.has(id)).sort();

// Which non-crawl source confirmed each item. "confirmed in Gutenberg and FreeLaw" is
// evidence; "confirmed in the reference corpus" is an assertion.
const subsetsByItem = new Map<string, Set<string>>();
for (const hit of exact.hits as ContaminationHit[]) {
  if (!webFlagged.has(hit.benchmarkItemId)) continue;
  const subset = hit.corpusDocId.replace(/-\d+$/, '');
  const set = subsetsByItem.get(hit.benchmarkItemId) ?? new Set<string>();
  set.add(subset);
  subsetsByItem.set(hit.benchmarkItemId, set);
}

const subsetTally: Record<string, number> = {};
for (const sets of subsetsByItem.values()) {
  for (const s of sets) subsetTally[s] = (subsetTally[s] ?? 0) + 1;
}

/**
 * Control set: items identified by manual inspection as unambiguously canonical — famous
 * speeches, founding documents, political philosophy. Nobody believes MMLU leaked Patrick
 * Henry into Common Crawl.
 *
 * They exist to measure the test's NEGATIVE power. If items this canonical still fail to
 * appear in the reference corpus, then "absent from the reference" carries no information
 * about leakage, and the confirmed/unconfirmed split must not be read as a leakage rate.
 * Hand-labelled, and declared as such: it calibrates the test, it is not a sample of it.
 */
const CONTROL: Record<string, string> = {
  'mmlu-5720': 'Patrick Henry, "give me liberty or give me death"',
  'mmlu-5732': "Roosevelt, Four Freedoms",
  'mmlu-3811': 'Fifth Amendment, "without due process"',
  'mmlu-5951': 'NATO Treaty, Article 5',
  'mmlu-11040': 'Equal Protection Clause, Fourteenth Amendment',
  'mmlu-6072': 'Machiavelli, on friendships obtained by payment',
  'mmlu-5745': "Franklin's 1766 testimony to Parliament",
  'mmlu-5703': 'Jonathan Edwards, "Sinners in the Hands of an Angry God"',
  'mmlu-8373': "Singer's second premise",
};
const confirmedSet = new Set(confirmedCanonical);
const controlRows = Object.entries(CONTROL)
  .filter(([id]) => webFlagged.has(id))
  .map(([id, label]) => ({ id, label, confirmed: confirmedSet.has(id) }));
const controlConfirmed = controlRows.filter((r) => r.confirmed).length;

process.stdout.write(
  `\n  reference scan: ${exact.itemsHit} / ${items.length} items, ${exact.totalHits} matches, ` +
    `${exact.droppedGeneric ?? 0} dropped, ${(report.elapsedMs / 1000).toFixed(0)}s\n\n`,
);
process.stdout.write(`  ${'='.repeat(64)}\n`);
process.stdout.write(`  of ${webFlagged.size} items flagged in ${web.corpus.name}:\n`);
process.stdout.write(`    confirmed canonical (also in non-crawl text)  ${String(confirmedCanonical.length).padStart(5)}  ${((confirmedCanonical.length / webFlagged.size) * 100).toFixed(1)}%\n`);
process.stdout.write(`    web-corpus only                               ${String(webOnly.length).padStart(5)}  ${((webOnly.length / webFlagged.size) * 100).toFixed(1)}%\n`);
process.stdout.write(`  ${'='.repeat(64)}\n\n`);

if (Object.keys(subsetTally).length > 0) {
  process.stdout.write(`  confirmations by source (from retained matches only):\n`);
  for (const [k, v] of Object.entries(subsetTally).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`    ${k.padEnd(24)} ${String(v).padStart(5)} items\n`);
  }
  process.stdout.write('\n');
}

process.stdout.write(`  CONTROL SET — items nobody believes leaked:\n`);
for (const r of controlRows) {
  process.stdout.write(`    ${(r.confirmed ? 'confirmed' : 'NOT FOUND').padEnd(11)} ${r.id.padEnd(12)} ${r.label}\n`);
}
process.stdout.write(
  `\n  ${controlConfirmed} of ${controlRows.length} known-canonical items were confirmed. ` +
    `${controlRows.length - controlConfirmed} were not.\n` +
    `  => absence from this reference corpus does NOT indicate leakage. Presence is evidence; absence is not.\n\n`,
);

mkdirSync(resolve('results'), { recursive: true });

writeFileSync(
  resolve('results/canonicality.json'),
  JSON.stringify(
    {
      scanner: SCANNER_VERSION,
      benchmark: benchName,
      n,
      webCorpus: { name: web.corpus.name, uncompressedBytes: web.corpus.uncompressedBytes, itemsFlagged: webFlagged.size },
      referenceCorpus: {
        name: 'pile-noncrawl',
        documents: manifest.documents,
        droppedAsWebDerived: manifest.droppedDocuments,
        excludedSubsets: manifest.excludedAsWebDerived,
        keptBySubset: manifest.keptBySubset,
        sha256: manifest.file.sha256,
        itemsHit: exact.itemsHit,
        totalMatches: exact.totalHits,
      },
      confirmedCanonical,
      webCorpusOnly: webOnly,
      confirmationsBySource: subsetTally,
      subsetsByItem: Object.fromEntries([...subsetsByItem].map(([k, v]) => [k, [...v].sort()])),
      // Source attribution comes from retained match evidence, which the scanner caps.
      // Items confirmed but not attributed are counted in confirmedCanonical and simply
      // have no source listed — the count is complete, the attribution is not.
      attributionCoverage: { retainedMatches: exact.hits.length, totalMatches: exact.totalHits },
      controlSet: {
        note: 'Hand-labelled items nobody believes leaked. They measure the test\'s negative power, and are not a sample.',
        confirmed: controlConfirmed,
        total: controlRows.length,
        rows: controlRows,
      },
      // Stated here so it travels with the number: a 1.5 GB reference against a 21 GB web
      // corpus means ABSENCE is weak evidence. Presence is the finding; absence is a lead.
      caveat:
        'The reference corpus is far smaller than the web corpus. An item confirmed in both is canonical. An item absent from the reference is NOT thereby leakage — it may simply be too rare for a corpus this size.',
      receipt: report.receipt,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

// The artifact a scanner could consume. Item ids and gram hashes only, never benchmark
// text — a published index follows the same rule, because the benchmark's licence is not
// ours to relicense.
writeFileSync(
  resolve('results/canonical-grams.json'),
  JSON.stringify(
    {
      scanner: SCANNER_VERSION,
      format: 'canonical-items/1',
      benchmark: benchName,
      benchmarkHash: index.benchmarkHash,
      n,
      note: 'Benchmark items whose flagged text was independently confirmed in non-web-crawl sources. Item ids only; no benchmark text is redistributed.',
      method: `flagged in ${web.corpus.name} AND in a Pile subset excluding ${manifest.excludedAsWebDerived.join('/')}`,
      canonicalItemIds: confirmedCanonical,
      sourcesByItem: Object.fromEntries([...subsetsByItem].map(([k, v]) => [k, [...v].sort()])),
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

process.stdout.write(`  wrote results/canonicality.json and results/canonical-grams.json\n\n`);
