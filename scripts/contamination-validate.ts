/**
 * Trustworthiness harness. Run this before quoting any contamination number.
 *
 * A language model cannot do what this does, and that is the point: it produces the same
 * numbers on the same inputs forever, and it makes a pass/fail assertion rather than a
 * judgment. An auditor whose answers move between runs is not an auditor.
 *
 * Four checks:
 *   1 planted recall     verbatim items hidden in a corpus. 100% at tier 1 or it is a bug.
 *   2 paraphrase recall  lightly edited items. Measures the known weakness honestly.
 *   3 control            an independent corpus. Every hit is a false positive or a
 *                        genuine shared source, and the report shows which by showing text.
 *   4 n sweep            8 through 13. The field inherited 13 from GPT-3 in 2020 and has
 *                        not re-derived it. Recall and false positives at each n.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadBatch } from '../src/loader.ts';
import { mulberry32 } from '../src/text.ts';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { scanCorpus } from '../src/contamination/scan.ts';
import { MAX_N, MIN_N } from '../src/contamination/types.ts';
import { SCANNER_VERSION } from '../src/types.ts';
import type { BenchmarkItem } from '../src/contamination/types.ts';

const BENCH_ITEMS = 1000;
const PLANTED = 60;
const CORPUS_DOCS = 6000;
const SEED = 0xc0d;

const scratch = join(tmpdir(), `ingot-validate-${process.pid}`);
mkdirSync(scratch, { recursive: true });

const alpaca = loadBatch(resolve('data/machine-alpaca.jsonl')).records;
const dolly = loadBatch(resolve('data/human-dolly.jsonl')).records;

const rand = mulberry32(SEED);
function shuffled<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Benchmark: alpaca items. Corpus: dolly documents, an independently produced corpus
// with no derivation relationship to alpaca.
const bench: BenchmarkItem[] = shuffled(alpaca)
  .slice(0, BENCH_ITEMS)
  .map((r) => ({ id: r.id, text: r.text }));
const corpusDocs = shuffled(dolly).slice(0, CORPUS_DOCS);

const plantedItems = bench.slice(0, PLANTED);
const plantedIds = new Set(plantedItems.map((b) => b.id));

/**
 * Light editing that a person might do when reusing text: drop the occasional word and
 * add the occasional filler. Deterministic, and enough to break a run of 13 identical
 * tokens without changing what the passage says.
 */
function perturb(text: string, seed: number): string {
  const r = mulberry32(seed);
  const words = text.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && i % 11 === 0) continue; // drop roughly one word in eleven
    out.push(words[i]);
    if (i > 0 && i % 17 === 0) out.push(r() < 0.5 ? 'really' : 'actually');
  }
  return out.join(' ');
}

function writeCorpus(name: string, extra: { id: string; text: string }[]): string {
  const rows = [
    ...corpusDocs.map((d) => ({ id: d.id, text: d.text })),
    ...extra,
  ];
  const p = join(scratch, name);
  writeFileSync(p, shuffled(rows).map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return p;
}

// Planted: each item buried inside an unrelated host document, as real contamination
// appears — surrounded by other text, not sitting alone in its own record.
const plantedCorpus = writeCorpus(
  'planted.jsonl',
  plantedItems.map((b, i) => ({
    id: `planted-${i}`,
    text: `${corpusDocs[i % corpusDocs.length].text} ${b.text} ${corpusDocs[(i + 7) % corpusDocs.length].text}`,
  })),
);

const paraphraseCorpus = writeCorpus(
  'paraphrase.jsonl',
  plantedItems.map((b, i) => ({
    id: `para-${i}`,
    text: `${corpusDocs[(i + 3) % corpusDocs.length].text} ${perturb(b.text, SEED + i)} ${corpusDocs[(i + 11) % corpusDocs.length].text}`,
  })),
);

const controlCorpus = writeCorpus('control.jsonl', []);

process.stdout.write(
  `\n  INGOT CONTAMINATION VALIDATION — ${SCANNER_VERSION}\n` +
    `  benchmark ${bench.length} alpaca items · corpus ${corpusDocs.length} dolly docs\n` +
    `  ${PLANTED} items planted verbatim, the same ${PLANTED} planted again lightly edited\n\n`,
);

type Row = {
  n: number;
  checkablePlanted: number;
  plantedUncheckable: number;
  indexGrams: number;
  droppedStoplist: number;
  droppedNonDiscriminative: number;
  verbatimRecall: number;
  paraphraseRecall: number;
  controlFalsePositives: number;
  controlHitIds: string[];
};

const rows: Row[] = [];

for (let n = MIN_N; n <= MAX_N; n++) {
  const index = NgramIndex.build(`alpaca-${n}`, bench, { n });

  const planted = await scanCorpus(index, plantedCorpus);
  const paraphrase = await scanCorpus(index, paraphraseCorpus);
  const control = await scanCorpus(index, controlCorpus);

  const foundVerbatim = planted.contaminatedItemIds.filter((id) => plantedIds.has(id)).length;
  const foundParaphrase = paraphrase.contaminatedItemIds.filter((id) => plantedIds.has(id)).length;

  // Items with no surviving n-gram cannot be matched by anything, so scoring recall
  // against them measures the benchmark's item lengths rather than the scanner. They
  // are excluded from the denominator and reported separately, never hidden.
  const uncheckable = new Set(index.uncheckableItemIds);
  const checkablePlanted = plantedItems.filter((b) => !uncheckable.has(b.id)).length;
  const plantedUncheckable = PLANTED - checkablePlanted;

  rows.push({
    n,
    indexGrams: index.size,
    droppedStoplist: index.stats.droppedStoplist,
    droppedNonDiscriminative: index.stats.droppedNonDiscriminative,
    checkablePlanted,
    plantedUncheckable,
    verbatimRecall: checkablePlanted === 0 ? 0 : foundVerbatim / checkablePlanted,
    paraphraseRecall: checkablePlanted === 0 ? 0 : foundParaphrase / checkablePlanted,
    controlFalsePositives: control.contaminatedItemIds.length,
    controlHitIds: control.contaminatedItemIds.slice(0, 5),
  });

  process.stdout.write(
    `  n=${String(n).padStart(2)}  grams ${index.size.toLocaleString().padStart(9)}  ` +
      `verbatim ${((foundVerbatim / Math.max(1, checkablePlanted)) * 100).toFixed(1).padStart(5)}%  ` +
      `paraphrase ${((foundParaphrase / Math.max(1, checkablePlanted)) * 100).toFixed(1).padStart(5)}%  ` +
      `FPs ${String(control.contaminatedItemIds.length).padStart(3)}  ` +
      `uncheckable ${String(index.stats.uncheckableItems).padStart(3)}/${bench.length}\n`,
  );
}

// Ablation: does the discriminative filter change what we would report?
const withFilter = NgramIndex.build('ablate-on', bench, { n: 13 });
const withoutFilter = NgramIndex.build('ablate-off', bench, { n: 13, disableDiscriminativeFilter: true });
const ablationOn = await scanCorpus(withFilter, controlCorpus);
const ablationOff = await scanCorpus(withoutFilter, controlCorpus);

process.stdout.write(
  `\n  DISCRIMINATIVE FILTER ABLATION (n=13, control corpus)\n` +
    `    filter on   ${withFilter.size.toLocaleString()} grams, ${ablationOn.contaminatedItemIds.length} items flagged\n` +
    `    filter off  ${withoutFilter.size.toLocaleString()} grams, ${ablationOff.contaminatedItemIds.length} items flagged\n`,
);

const n13 = rows.find((r) => r.n === 13)!;
const verdictPass = n13.verbatimRecall === 1;

process.stdout.write(
  `\n  VERDICT\n` +
    `    verbatim recall at n=13: ${(n13.verbatimRecall * 100).toFixed(1)}% ` +
    `${verdictPass ? 'PASS' : 'FAIL — this is a bug, not a metric'}\n` +
    `    control false positives at n=13: ${n13.controlFalsePositives} of ${bench.length} items\n` +
    `    uncheckable at n=13: ${n13.plantedUncheckable} of ${PLANTED} planted items are shorter\n` +
    `      than 13 tokens, so nothing could ever match them. Recall is over the\n` +
    `      ${n13.checkablePlanted} that are checkable. A user must be told this, or a clean\n` +
    `      result hides the part of their benchmark that was never checked.\n`,
);

if (n13.controlHitIds.length > 0) {
  process.stdout.write(
    `    control hits are not automatically errors: an independent corpus can genuinely\n` +
      `    share a source. Inspect the matched text before calling them false positives.\n` +
      `    ids: ${n13.controlHitIds.join(', ')}\n`,
  );
}

mkdirSync(resolve('results'), { recursive: true });
writeFileSync(
  resolve('results/contamination-validation.json'),
  JSON.stringify(
    {
      scanner: SCANNER_VERSION,
      benchmarkItems: bench.length,
      corpusDocs: corpusDocs.length,
      planted: PLANTED,
      seed: SEED,
      rows,
      ablation: {
        withFilterGrams: withFilter.size,
        withoutFilterGrams: withoutFilter.size,
        withFilterFlagged: ablationOn.contaminatedItemIds.length,
        withoutFilterFlagged: ablationOff.contaminatedItemIds.length,
      },
      verdictPass,
      limitations: [
        'The control is an independent corpus, not one that predates the benchmark. A true temporal control needs dated corpora and is not yet available here.',
        'Paraphrase is simulated by deterministic light editing, not by a model rewriting the text. Real paraphrase will be harder.',
        'Benchmark and corpus are both 2023-era public datasets.',
      ],
    },
    null,
    2,
  ),
  'utf8',
);

process.stdout.write(`\n  wrote results/contamination-validation.json\n\n`);
if (!verdictPass) process.exitCode = 1;
