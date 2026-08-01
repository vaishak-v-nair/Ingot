/**
 * Measures how much of each flagged benchmark item actually appears in the corpus
 * documents that matched it — the difference between a leak and a phrase.
 *
 * The scanner's unit of evidence is one n-gram. That is the right trigger and the wrong
 * verdict: "ten shared words" describes both a leaked exam question and the stock stem
 * "which of the following best describes the". Eyeballing settles small sets, but
 * "inspected by eye" is an assertion. This script turns the inspection into a number:
 * for every flagged item, the longest common token run between the item's text and each
 * corpus document that matched it, reported as a fraction of the item.
 *
 *   node scripts/leak-triage.ts --results results/sft-slimorca.json --corpus ../corpora/slimorca
 *
 * A leaked question reproduces most of itself — coverage near 1. Boilerplate and famous
 * quotes reproduce the phrase and nothing else — coverage near the n-gram floor. The
 * thresholds below are triage labels for reading the output, not ground truth, and they
 * are published beside the numbers. Tokenization here is a lowercase word split — an
 * approximation of the scanner's tokenizer, fine for measuring runs of ordinary words;
 * the scan that flagged the items used the real one.
 */
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createGunzip } from 'node:zlib';
import { SCANNER_VERSION } from '../src/types.ts';
import { LEAK, LEAK_EXCESS, PARTIAL, PARTIAL_EXCESS, jsonlLines, longestRun, tokens, verdictFor } from './triage-rules.ts';

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const resultsPath = resolve(flag('results', 'results/sft-slimorca.json'));
const corpusDir = resolve(flag('corpus', '../corpora/slimorca'));

// The thresholds, the floor-artifact rationale behind them, and the tokenizer live in
// triage-rules.ts, where the test suite can reach them.

type Sample = { benchmarkItemId: string; corpusDocId: string };
type ResultsFile = {
  defaultN: number;
  benchmarks: { name: string; path: string }[];
  results: { benchmark: string; n: number; contaminatedItemIds: string[]; samples: Sample[] }[];
};
type Manifest = { shards: { name: string }[] };

const file = JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsFile;
const manifest = JSON.parse(readFileSync(join(corpusDir, 'manifest.json'), 'utf8')) as Manifest;

const benchText = new Map<string, string>();
for (const b of file.benchmarks) {
  if (!existsSync(resolve(b.path))) continue;
  for (const line of readFileSync(resolve(b.path), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const row = JSON.parse(t) as { id: string; text: string };
    benchText.set(`${b.name}::${row.id}`, row.text);
  }
}

// Which corpus documents matter, and which items each one matched. Retained samples name
// every (item, doc) pair under the evidence cap; rows here are far under it.
const docsNeeded = new Map<string, Set<string>>();
for (const r of file.results.filter((x) => x.n === file.defaultN)) {
  for (const s of r.samples) {
    const key = `${r.benchmark}::${s.benchmarkItemId}`;
    const set = docsNeeded.get(s.corpusDocId) ?? new Set<string>();
    set.add(key);
    docsNeeded.set(s.corpusDocId, set);
  }
}

process.stdout.write(`\n  LEAK TRIAGE — ${SCANNER_VERSION}\n\n`);
process.stdout.write(`  ${docsNeeded.size} corpus documents to read, ${[...new Set([...docsNeeded.values()].flatMap((s) => [...s]))].length} flagged items\n\n`);

// One streaming pass collects only the documents the evidence names.
const docText = new Map<string, string>();
for (const shard of manifest.shards) {
  const input = createReadStream(join(corpusDir, shard.name));
  const stream = shard.name.endsWith('.gz') ? input.pipe(createGunzip()) : input;
  for await (const line of jsonlLines(stream)) {
    const t = line.trim();
    if (!t) continue;
    let row: { id?: string; text?: string };
    try {
      row = JSON.parse(t) as typeof row;
    } catch {
      continue;
    }
    if (row.id && row.text && docsNeeded.has(row.id)) docText.set(row.id, row.text);
  }
}

type TriageRow = {
  benchmark: string;
  itemId: string;
  itemTokens: number;
  longestRun: number;
  coverage: number;
  /** The coverage a flag guarantees for free: n / itemTokens. */
  floor: number;
  /** Tokens matched beyond the flagging n-gram — the evidence the flag did not already imply. */
  excess: number;
  bestDoc: string;
  docsExamined: number;
  verdict: 'leaked' | 'partial' | 'phrase';
};

const rows: TriageRow[] = [];
const byItem = new Map<string, { docs: string[] }>();
for (const [docId, items] of docsNeeded) {
  for (const item of items) {
    const e = byItem.get(item) ?? { docs: [] };
    e.docs.push(docId);
    byItem.set(item, e);
  }
}

for (const [key, { docs }] of [...byItem.entries()].sort()) {
  const [benchmark, itemId] = key.split('::');
  const item = tokens(benchText.get(key) ?? '');
  if (item.length === 0) continue;
  let best = 0;
  let bestDoc = '';
  for (const docId of docs) {
    const run = longestRun(item, tokens(docText.get(docId) ?? ''));
    if (run > best) {
      best = run;
      bestDoc = docId;
    }
  }
  const coverage = best / item.length;
  const excess = best - file.defaultN;
  rows.push({
    benchmark,
    itemId,
    itemTokens: item.length,
    longestRun: best,
    coverage,
    floor: file.defaultN / item.length,
    excess,
    bestDoc,
    docsExamined: docs.length,
    verdict: verdictFor(coverage, excess),
  });
}

rows.sort((a, b) => b.excess - a.excess || b.coverage - a.coverage);
for (const r of rows) {
  process.stdout.write(
    `  ${r.verdict.padEnd(8)} ${r.benchmark.padEnd(10)} ${r.itemId.padEnd(14)} ` +
      `${String(r.longestRun).padStart(4)} of ${String(r.itemTokens).padEnd(4)} tokens ` +
      `(${(r.coverage * 100).toFixed(0).padStart(3)}%, +${r.excess} past the gram)  ` +
      `best: ${r.bestDoc} of ${r.docsExamined} docs\n`,
  );
}

const leaked = rows.filter((r) => r.verdict === 'leaked');
const partial = rows.filter((r) => r.verdict === 'partial');
process.stdout.write(
  `\n  ${leaked.length} leaked · ${partial.length} partial · ${rows.length - leaked.length - partial.length} phrase-level, of ${rows.length} flagged items\n\n`,
);

writeFileSync(
  resolve(resultsPath.replace(/\.json$/, '-triage.json')),
  JSON.stringify(
    {
      scanner: SCANNER_VERSION,
      method:
        'longest common contiguous token run between each flagged benchmark item and every corpus document its retained evidence names, as a fraction of the item',
      tokenization: 'lowercase unicode word split — a triage approximation; the scan that flagged the items used the scanner tokenizer',
      thresholds: {
        leaked: { coverage: LEAK, excess: LEAK_EXCESS },
        partial: { coverage: PARTIAL, excess: PARTIAL_EXCESS },
        note: 'excess = longest run minus the flagging n; required because every flagged item carries coverage of n/itemTokens by construction, and coverage alone labelled three short items leaked on that floor artifact',
      },
      source: { results: 'results/' + resultsPath.split(/[\\/]/).pop(), corpus: corpusDir.split(/[\\/]/).pop() },
      rows,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
process.stdout.write(`  wrote ${resultsPath.replace(/\.json$/, '-triage.json').split(/[\\/]/).pop()} beside the scan results\n\n`);
