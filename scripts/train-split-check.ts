/**
 * Settles WHICH split of GSM8K is inside a corpus: the train questions, the test
 * questions, or neither.
 *
 * The scan flags test-split items; the triage measures how much of each item its
 * matching documents reproduce. Both left a question open that eyeballing answered but
 * nothing recorded: the flagged test items looked like TEMPLATE SIBLINGS of train-split
 * questions — same phrasing skeleton, different names and numbers — and the train
 * questions themselves looked verbatim. A page may not claim that from an ad-hoc grep.
 * This script makes the claim reproducible:
 *
 *   node scripts/train-split-check.ts --results results/sft-slimorca.json --corpus ../corpora/slimorca
 *
 * For every corpus document the flagged items' evidence names, it records which
 * train-split questions appear verbatim inside it (whitespace-normalized substring), and
 * whether any flagged TEST question appears the same way. Emits
 * results/<name>-train-check.json, which the registry page quotes and CI gates.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createGunzip } from 'node:zlib';
import { SCANNER_VERSION } from '../src/types.ts';
import { withRetry } from './retry.ts';
import { jsonlLines, norm } from './triage-rules.ts';

const TRAIN_URL =
  'https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/train.jsonl';
const TRAIN_CACHE = resolve('data/bench/gsm8k-train.jsonl');

import { flag } from './cli-flags.ts';

const resultsPath = resolve(flag('results', 'results/sft-slimorca.json'));
const corpusDir = resolve(flag('corpus', '../corpora/slimorca'));

type ResultsFile = {
  defaultN: number;
  benchmarks: { name: string; path: string }[];
  results: {
    benchmark: string;
    n: number;
    contaminatedItemIds: string[];
    samples: { benchmarkItemId: string; corpusDocId: string }[];
  }[];
};
type Manifest = { corpus: string; shards: { name: string }[] };

const file = JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsFile;
const manifest = JSON.parse(readFileSync(join(corpusDir, 'manifest.json'), 'utf8')) as Manifest;

const row = file.results.find((r) => r.benchmark === 'gsm8k' && r.n === file.defaultN);
if (!row || row.samples.length === 0) {
  process.stdout.write('\n  no flagged gsm8k items at the default n — nothing to check\n\n');
  process.exit(0);
}

if (!existsSync(TRAIN_CACHE)) {
  process.stdout.write(`  fetching gsm8k train split → ${TRAIN_CACHE}\n`);
  const raw = await withRetry('gsm8k-train', async () => {
    const r = await fetch(TRAIN_URL, { redirect: 'follow' });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.text();
  });
  mkdirSync(resolve('data/bench'), { recursive: true });
  writeFileSync(TRAIN_CACHE, raw, 'utf8');
}

const train: { id: string; question: string; normed: string }[] = [];
{
  let i = 0;
  for (const line of readFileSync(TRAIN_CACHE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    i++;
    const q = (JSON.parse(t) as { question?: string }).question;
    if (q) train.push({ id: `gsm8k-train-${i}`, question: q, normed: norm(q) });
  }
}

const benchPath = file.benchmarks.find((b) => b.name === 'gsm8k')!.path;
const testText = new Map<string, string>();
for (const line of readFileSync(resolve(benchPath), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t) continue;
  const r = JSON.parse(t) as { id: string; text: string };
  testText.set(r.id, r.text);
}

const docIds = new Set(row.samples.map((s) => s.corpusDocId));
const docsByItem = new Map<string, string[]>();
for (const s of row.samples) {
  const list = docsByItem.get(s.benchmarkItemId) ?? [];
  if (!list.includes(s.corpusDocId)) list.push(s.corpusDocId);
  docsByItem.set(s.benchmarkItemId, list);
}

const docNormed = new Map<string, string>();
for (const shard of manifest.shards) {
  const input = createReadStream(join(corpusDir, shard.name));
  const stream = shard.name.endsWith('.gz') ? input.pipe(createGunzip()) : input;
  for await (const line of jsonlLines(stream)) {
    const t = line.trim();
    if (!t) continue;
    let r: { id?: string; text?: string };
    try {
      r = JSON.parse(t) as typeof r;
    } catch {
      continue;
    }
    if (r.id && r.text && docIds.has(r.id)) docNormed.set(r.id, norm(r.text));
  }
}

type ItemRow = {
  testItemId: string;
  testQuestion: string;
  /** The whole point: does the flagged TEST question itself appear in its matching docs? */
  testQuestionInMatchedDocs: boolean;
  matchedDocs: string[];
  trainSiblingsInThoseDocs: { trainId: string; question: string; docs: string[] }[];
};

const items: ItemRow[] = [];
for (const [itemId, docs] of [...docsByItem.entries()].sort()) {
  const testQ = testText.get(itemId) ?? '';
  const testNormed = norm(testQ);
  const siblings = new Map<string, { question: string; docs: string[] }>();
  let testFound = false;

  for (const docId of docs) {
    const body = docNormed.get(docId) ?? '';
    if (testNormed.length > 0 && body.includes(testNormed)) testFound = true;
    for (const tr of train) {
      if (body.includes(tr.normed)) {
        const e = siblings.get(tr.id) ?? { question: tr.question, docs: [] };
        e.docs.push(docId);
        siblings.set(tr.id, e);
      }
    }
  }

  items.push({
    testItemId: itemId,
    testQuestion: testQ,
    testQuestionInMatchedDocs: testFound,
    matchedDocs: docs,
    trainSiblingsInThoseDocs: [...siblings.entries()].map(([trainId, v]) => ({ trainId, ...v })),
  });
}

const summary = {
  flaggedTestItems: items.length,
  testItemsReproducedVerbatim: items.filter((i) => i.testQuestionInMatchedDocs).length,
  itemsWithTrainSiblingInDocs: items.filter((i) => i.trainSiblingsInThoseDocs.length > 0).length,
  distinctTrainQuestionsFound: new Set(items.flatMap((i) => i.trainSiblingsInThoseDocs.map((s) => s.trainId))).size,
};

process.stdout.write(`\n  TRAIN-SPLIT CHECK — ${SCANNER_VERSION} — gsm8k against ${manifest.corpus}\n\n`);
for (const it of items) {
  process.stdout.write(
    `  ${it.testItemId.padEnd(12)} test question in matched docs: ${it.testQuestionInMatchedDocs ? 'YES' : 'no'} · ` +
      `train siblings found: ${it.trainSiblingsInThoseDocs.map((s) => s.trainId).join(', ') || 'none'}\n`,
  );
}
process.stdout.write(
  `\n  ${summary.itemsWithTrainSiblingInDocs} of ${summary.flaggedTestItems} flagged test items sit beside a verbatim TRAIN question; ` +
    `${summary.testItemsReproducedVerbatim} test questions appear verbatim themselves\n\n`,
);

writeFileSync(
  resolve(resultsPath.replace(/\.json$/, '-train-check.json')),
  JSON.stringify(
    {
      scanner: SCANNER_VERSION,
      corpus: manifest.corpus,
      method:
        'whitespace-normalized case-insensitive substring: every gsm8k train question against every corpus document named by the flagged test items’ retained evidence, and each flagged test question against the same documents',
      trainSource: TRAIN_URL,
      trainQuestions: train.length,
      summary,
      items,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
process.stdout.write(`  wrote ${resultsPath.replace(/\.json$/, '-train-check.json').split(/[\\/]/).pop()}\n\n`);
