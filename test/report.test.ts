import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

test('the delivered report obeys the design system', async () => {
  // DESIGN.md: radius 0, no cards, hairline rules, and the palette adopted 2026-08-01.
  // This document kept the archived warm-paper-and-gold look for two releases after the
  // site left it behind, which meant the artifact and the product that made it did not
  // look related.
  const html = renderContaminationReport(await reportWith({ hit: true }));

  assert.equal(/border-radius/.test(html), false, 'radius is 0: an instrument has machined edges');
  assert.match(html, /#0C0E0F/, 'current ground colour');
  assert.equal(/#fbfaf7|#9a6a00|#16150f/i.test(html), false, 'archived palette must be gone');
  assert.equal(/color-mix/.test(html.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'no color-mix outside comments');
});

test('colour is testimony: findings are amber, red is only for refusals', async () => {
  // DESIGN.md 2026-08-01: "Green only for verified-clean; amber for findings; red only for
  // refusals." A count of matches is a measurement, and rendering it red told the reader
  // "error" about a number that is the entire point of the scan.
  const html = renderContaminationReport(await reportWith({ hit: true }));
  assert.match(html, /\.big\.dirty \{ color: var\(--sig\)/);
  assert.match(html, /\.big\.refused \{ color: var\(--bad\)/);
  assert.match(html, /\.big\.clean \{ color: var\(--ok\)/);
  // --sig is a signal and never a fill, so the evidence mark is an underline.
  assert.match(html, /mark \{ background: transparent/);
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
