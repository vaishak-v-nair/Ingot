/**
 * Builds web/sample-report.html — the "see a sample report" link on the front page.
 *
 * That page is the real renderer's output, published. It was made by hand once and then
 * edited by hand, which meant the artifact a visitor is shown as an example of what they
 * will receive could drift from the artifact they would actually receive, and nothing
 * would say so. It is generated now, and `node scripts/build-sample-report.ts` is the only
 * way it is allowed to change.
 *
 * The report object below is composed, not measured. Everything in it is a plausible
 * shape for a writer's check — that is the point of a sample — and the page is labelled
 * ILLUSTRATION twice so nobody can mistake it for a finding. It quotes no measured figure,
 * so check-published-numbers has nothing to trace and nothing to gate: the corpus size and
 * document count are the published C4 run's, which that gate already covers where they are
 * claimed as results.
 */
import { writeFileSync } from 'node:fs';
import { renderContaminationReport } from '../src/contamination/reportHtml.ts';
import type { ContaminationReport } from '../src/contamination/types.ts';

const OUT = new URL('../web/sample-report.html', import.meta.url);

const report: ContaminationReport = {
  benchmark: 'your writing',
  corpus: 'c4-en (26 shards)',
  n: 10,
  corpusDocs: 9_264_249,
  corpusTokens: 3_418_685_530,
  elapsedMs: 3_067_000,
  uncheckableItemIds: [],
  itemNoun: { one: 'piece of writing', many: 'pieces of writing' },
  tiers: [
    {
      tier: 'exact',
      itemsTotal: 3,
      itemsHit: 1,
      totalHits: 1,
      droppedGeneric: 0,
      hits: [
        {
          benchmarkItemId: 'essay-2',
          corpusDocId: 'c4-train.00007 · doc 411,982',
          contextBefore: 'Reprinted without permission: ',
          matchedText:
            'My grandmother kept her recipes on index cards in a tin that had once held ' +
            'shortbread. The handwriting changes across four decades, from a schoolgirl ' +
            'copperplate to something looser and more urgent.',
          contextAfter: ' What a lovely piece.',
        },
      ],
    },
    {
      tier: 'near',
      itemsTotal: 3,
      itemsHit: 0,
      totalHits: 0,
      hits: [],
      unavailableReason: 'needs the text of what was indexed; this run carried hashes only',
    },
  ],
  receipt: {
    scannerVersion: 'ingot-0.1.5',
    indexFormatVersion: 3,
    benchmark: 'your writing',
    benchmarkHash: '89bee225be93a2c85b2597b7da32bada',
    n: 10,
    stride: 1,
    indexGrams: 406,
    corpus: 'c4-en (26 shards)',
    corpusBytes: 21_330_000_000,
    corpusDocs: 9_264_249,
    corpusHash: 'fa98d595f8fdea47',
    corpusHashFull: '56e0965c421d4d642a18aeba27af3bb6c69f6a56d553bce96ec803261170bf2b',
    generatedAt: '2026-08-07T09:00:00.000Z',
    command:
      'node scripts/build-index.ts reports/writer.jsonl --name "your writing" ' +
      '--item-noun "piece of writing|pieces of writing" --out reports/writer.idx.bin.gz ' +
      '&& node src/cli.ts contaminate --index reports/writer.idx.bin.gz ' +
      '--corpus ../corpora/c4-en/ --out report.html',
  },
} as ContaminationReport;

let html = renderContaminationReport(report);

/**
 * Two edits, and both are refusals to publish an unlabelled specimen. A sample report that
 * does not say it is a sample is a fabricated finding, and this project's every gate exists
 * to stop exactly that. Each substitution is checked: if the renderer's markup moves and a
 * label silently stops being applied, this refuses to write rather than publishing a page
 * that looks like a real scan of somebody's writing.
 */
const EDITS: Array<[string, string, string]> = [
  ['the sample brand line', '<div class="brand">Ingot</div>', '<div class="brand">Ingot &middot; sample</div>'],
  [
    'the illustration label',
    '<h1>',
    '<p class="illustration">Illustration — not a real scan</p>\n  <h1>',
  ],
];

for (const [what, from, to] of EDITS) {
  if (!html.includes(from)) {
    process.stderr.write(
      `\n  REFUSED — could not apply ${what}: the renderer no longer emits ${JSON.stringify(from)}.\n` +
        `  Not writing web/sample-report.html; an unlabelled sample report is a fabricated finding.\n\n`,
    );
    process.exit(1);
  }
  html = html.replace(from, to);
}

writeFileSync(OUT, html);
process.stdout.write(`\n  wrote web/sample-report.html — ${html.length.toLocaleString('en-US')} bytes\n\n`);
