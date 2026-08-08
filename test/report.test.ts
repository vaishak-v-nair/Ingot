import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { decodeIndex, encodeIndex } from '../src/contamination/indexCodec.ts';
import { renderContaminationReport } from '../src/contamination/reportHtml.ts';
import { scanCorpus } from '../src/contamination/scan.ts';

/**
 * The report is the artifact that leaves the building — the thing a writer, a reviewer or a
 * regulator actually holds. Everything else in this repo can be re-run; this is posted.
 */

const dir = mkdtempSync(join(tmpdir(), 'ingot-report-'));

const ESSAY =
  'My grandmother kept her recipes on index cards in a tin that had once held shortbread, ' +
  'and the handwriting changes across four decades of them.';

function corpusFile(name: string, rows: unknown[]): string {
  const p = join(dir, name);
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return p;
}

async function reportWith(options: { itemNoun?: { one: string; many: string }; hit?: boolean } = {}) {
  const index = NgramIndex.build('subject', [{ id: 'essay-1', text: ESSAY }], {
    disableStoplist: true,
    itemNoun: options.itemNoun,
  });
  const corpus = corpusFile(
    `c-${options.itemNoun?.one ?? 'default'}-${options.hit ? 'hit' : 'clean'}.jsonl`,
    [{ id: 'd1', text: options.hit ? `Reprinted: ${ESSAY} What a lovely piece.` : 'Unrelated material entirely.' }],
  );
  return scanCorpus(index, corpus);
}

test('the delivered report wears the same palette as the site', async () => {
  // The defect this exists to prevent has now happened twice. The report was
  // warm-paper-and-gold while the site was graphite, and then graphite while the site
  // turned to paper — each time for releases, and each time the one artifact that leaves
  // the building looked unrelated to the product that made it.
  //
  // Asserting literal hex values is what let it happen twice: they were right on the day
  // they were written and nothing tied them to anything. This reads web/site.css and
  // requires the report to name the same values, so the next redesign of the site fails
  // this test until the report follows it.
  const site = readFileSync(new URL('../web/site.css', import.meta.url), 'utf8');
  const html = renderContaminationReport(await reportWith({ hit: true }));

  for (const name of ['paper', 'ink', 'dim', 'line', 'wash', 'accent', 'accent-ink', 'accent-wash', 'ok', 'bad']) {
    const declared = site.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
    assert.ok(declared, `web/site.css declares --${name}`);
    assert.match(
      html,
      new RegExp(`--${name}:\\s*${declared}`, 'i'),
      `the report's --${name} is the site's ${declared}`,
    );
  }
  // Both retired systems, by their most distinctive values: Cleanroom's graphite ground
  // and the forensic-editorial paper and gold that preceded it.
  assert.equal(/#0C0E0F|#fbfaf7|#9a6a00|#16150f/i.test(html), false, 'no retired palette');
  assert.equal(/color-mix/.test(html.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'no color-mix outside comments');
});

test('colour is testimony: findings take the accent, red is only for refusals', async () => {
  // Green only for verified-clean; the accent for findings that have to be read; red only
  // for refusals. A count of matches is a measurement, and rendering it red told the
  // reader "error" about the number that is the entire point of the scan.
  const html = renderContaminationReport(await reportWith({ hit: true }));
  assert.match(html, /\.big\.dirty \{ color: var\(--accent\)/);
  assert.match(html, /\.big\.refused \{ color: var\(--bad\)/);
  assert.match(html, /\.big\.clean \{ color: var\(--ok\)/);
  // The site's struck highlight, and the same gesture on the same words. The explicit
  // background-color is not redundant: <mark> ships a yellow UA background, and a rule that
  // sets only background-image leaves that yellow showing through the gradient's
  // transparent top — which is how every match in every report came out highlighter yellow
  // the first time this was repapered.
  assert.match(html, /mark \{ background-color: transparent;/);
  assert.match(html, /background-image: linear-gradient\(transparent 60%, var\(--accent-wash\) 60%\)/);
  // On paper it becomes a rule: a 12% wash prints as an indistinguishable grey and takes
  // the evidence with it, which is the one thing this document may not lose.
  assert.match(html, /mark \{ background-image: none; border-bottom: 2px solid/);
});

test('the report makes no external request', async () => {
  // It has to open from an email attachment on a machine with no network, years from now.
  const html = renderContaminationReport(await reportWith({ hit: true }));
  assert.equal(/<script|src="http|href="http|@import|url\(http/.test(html), false);
});

test('a writer is not told their essays are benchmark items', async () => {
  const html = renderContaminationReport(await reportWith({ itemNoun: { one: 'essay', many: 'essays' }, hit: true }));
  assert.match(html, /of 1 essay appear in this corpus/);
  assert.equal(/benchmark item/.test(html), false);
});

test('the registry keeps its own vocabulary', async () => {
  const html = renderContaminationReport(await reportWith({ hit: true }));
  assert.match(html, /of 1 benchmark item appear in this corpus/);
});

test('the noun survives the published wire format', () => {
  const index = NgramIndex.build('w', [{ id: 'a', text: ESSAY }], {
    itemNoun: { one: 'piece of writing', many: 'pieces of writing' },
  });
  const restored = NgramIndex.load(decodeIndex(encodeIndex(index.serialize())));
  assert.deepEqual(restored.itemNoun, { one: 'piece of writing', many: 'pieces of writing' });
});

test('a default noun is not written into the artifact at all', () => {
  // An index of a real benchmark must encode exactly as it did before this field existed,
  // or every published index changes bytes for a field that says what the default says.
  const data = NgramIndex.build('bench', [{ id: 'a', text: ESSAY }]).serialize();
  assert.equal(data.itemNoun, undefined);
  assert.equal(JSON.stringify(data).includes('itemNoun'), false);
});

test('a hostile document cannot inject markup into the report', async () => {
  // The corpus is somebody else's text by construction. Every field that reaches the
  // template is escaped, including the ones inside <code> and <pre>.
  const evil = '</mark></p><script>alert(1)</script><p>';
  const index = NgramIndex.build(evil, [{ id: evil, text: `${ESSAY} ${evil}` }], { disableStoplist: true });
  const corpus = corpusFile('evil.jsonl', [{ id: evil, text: `${ESSAY} ${evil}` }]);
  const html = renderContaminationReport(await scanCorpus(index, corpus));

  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('</title><script'), false);
  assert.match(html, /&lt;script&gt;/);
});
