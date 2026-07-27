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
import { encodeIndex, gzipBytes } from '../src/contamination/indexCodec.ts';
import { scanCorpus } from '../src/contamination/scan.ts';
import { DEFAULT_N, LEGACY_N, MAX_N, MIN_N } from '../src/contamination/types.ts';
import { SCANNER_VERSION } from '../src/types.ts';
import type { BenchmarkItem } from '../src/contamination/types.ts';

const BENCH_ITEMS = 1000;

/**
 * 300, not 60. At 60 planted items one item is 1.7 percentage points, the standard error
 * on a recall near 80% is about 5 points, and adjacent values of n differ by less than
 * that — so the first version of this sweep was reporting noise as a ranking.
 */
const PLANTED = 300;
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
 * add the occasional filler. Deterministic given the seed, and enough to break a run of
 * identical tokens without changing what the passage says.
 *
 * Independent draws, NOT `i % 11`. A fixed modulus puts every deletion on the same lattice
 * in every item, and a lattice does not perturb — it decides in advance which n survive.
 * With deletions at 11, 22, 33 …, a 10-gram at offset 0 spans tokens 0-9 and can never be
 * touched, while a 13-gram at offset 0 spans 0-12 and is always broken. Measured on this
 * fixture: offset 0 survived for 60 of 60 items at n=10 and for 0 of 60 at n=13.
 *
 * That made the first published paraphrase numbers — 100% at n=10 against 3.5% at n=13 —
 * a property of the test fixture rather than of n. Same class of defect as the seeded
 * corpus that manufactured 26 false positives; see docs/measurements.md.
 */
const DROP_RATE = 1 / 11;
const INSERT_RATE = 1 / 17;

function perturb(text: string, seed: number): string {
  const r = mulberry32(seed);
  const words = text.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (r() < DROP_RATE) continue;
    out.push(words[i]);
    if (r() < INSERT_RATE) out.push(r() < 0.5 ? 'really' : 'actually');
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

/**
 * Stride sweep. A published index costs a download before anyone sees an answer, and
 * MMLU is 773,421 grams. Keeping one gram in every `stride` positions shrinks it in
 * proportion — the question is what that costs in recall, which is measured here rather
 * than assumed.
 */
type StrideRow = {
  stride: number;
  grams: number;
  indexBytesGz: number;
  verbatimRecall: number;
  paraphraseRecall: number;
  controlFalsePositives: number;
};

const strideRows: StrideRow[] = [];
process.stdout.write(`\n  STRIDE SWEEP (n=${DEFAULT_N}) — index size against recall\n`);

for (const stride of [1, 2, 3, 4, 6, 8]) {
  const index = NgramIndex.build(`stride-${stride}`, bench, { n: DEFAULT_N, stride });
  const planted = await scanCorpus(index, plantedCorpus);
  const paraphrase = await scanCorpus(index, paraphraseCorpus);
  const control = await scanCorpus(index, controlCorpus);

  const uncheckable = new Set(index.uncheckableItemIds);
  const checkable = plantedItems.filter((b) => !uncheckable.has(b.id)).length;
  const verbatim = planted.contaminatedItemIds.filter((id) => plantedIds.has(id)).length / Math.max(1, checkable);
  const para = paraphrase.contaminatedItemIds.filter((id) => plantedIds.has(id)).length / Math.max(1, checkable);
  const bytes = (await gzipBytes(encodeIndex(index.serialize()))).length;

  strideRows.push({
    stride,
    grams: index.size,
    indexBytesGz: bytes,
    verbatimRecall: verbatim,
    paraphraseRecall: para,
    controlFalsePositives: control.contaminatedItemIds.length,
  });

  process.stdout.write(
    `    stride ${stride}  grams ${index.size.toLocaleString().padStart(7)}  ` +
      `index ${(bytes / 1024).toFixed(0).padStart(4)} KB  ` +
      `verbatim ${(verbatim * 100).toFixed(1).padStart(5)}%  ` +
      `paraphrase ${(para * 100).toFixed(1).padStart(5)}%  ` +
      `FPs ${String(control.contaminatedItemIds.length).padStart(2)}\n`,
  );
}

// Ablation: does the discriminative filter change what we would report?
const withFilter = NgramIndex.build('ablate-on', bench, { n: DEFAULT_N });
const withoutFilter = NgramIndex.build('ablate-off', bench, { n: DEFAULT_N, disableDiscriminativeFilter: true });
const ablationOn = await scanCorpus(withFilter, controlCorpus);
const ablationOff = await scanCorpus(withoutFilter, controlCorpus);

process.stdout.write(
  `\n  DISCRIMINATIVE FILTER ABLATION (n=${DEFAULT_N}, control corpus)\n` +
    `    filter on   ${withFilter.size.toLocaleString()} grams, ${ablationOn.contaminatedItemIds.length} items flagged\n` +
    `    filter off  ${withoutFilter.size.toLocaleString()} grams, ${ablationOff.contaminatedItemIds.length} items flagged\n`,
);

const shipped = rows.find((r) => r.n === DEFAULT_N)!;
const legacy = rows.find((r) => r.n === LEGACY_N)!;
const verdictPass = shipped.verbatimRecall === 1;

process.stdout.write(
  `\n  VERDICT\n` +
    `    shipped default n=${DEFAULT_N}\n` +
    `      verbatim recall ${(shipped.verbatimRecall * 100).toFixed(1)}% ` +
    `${verdictPass ? 'PASS' : 'FAIL — this is a bug, not a metric'}\n` +
    `      paraphrase ${(shipped.paraphraseRecall * 100).toFixed(1)}%, ` +
    `false positives ${shipped.controlFalsePositives}/${bench.length}, ` +
    `unscannable ${shipped.plantedUncheckable}/${PLANTED} planted\n` +
    `    legacy n=${LEGACY_N}, reported so findings stay comparable with prior work\n` +
    `      verbatim recall ${(legacy.verbatimRecall * 100).toFixed(1)}%, ` +
    `paraphrase ${(legacy.paraphraseRecall * 100).toFixed(1)}%, ` +
    `unscannable ${legacy.plantedUncheckable}/${PLANTED} planted\n` +
    `    Recall counts only checkable items. Items shorter than n produce no grams, so\n` +
    `    nothing can match them; a clean result silent about those hides the part of the\n` +
    `    benchmark that was never examined.\n`,
);

if (shipped.controlHitIds.length > 0) {
  process.stdout.write(
    `    control hits are not automatically errors: an independent corpus can genuinely\n` +
      `    share a source. Inspect the matched text before calling them false positives.\n` +
      `    ids: ${shipped.controlHitIds.join(', ')}\n`,
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
      strideRows,
      ablation: {
        withFilterGrams: withFilter.size,
        withoutFilterGrams: withoutFilter.size,
        withFilterFlagged: ablationOn.contaminatedItemIds.length,
        withoutFilterFlagged: ablationOff.contaminatedItemIds.length,
      },
      defaultN: DEFAULT_N,
      legacyN: LEGACY_N,
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
