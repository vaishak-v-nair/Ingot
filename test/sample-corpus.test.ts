import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { loadIndexFromBytes, scanFile } from '../src/contamination/browserScan.ts';

/**
 * The front page ships a "try a sample corpus" button. What it produces is a claim made to
 * every first-time visitor, so it is asserted here rather than trusted: five ordinary
 * documents, two matches, and both of them canonical text rather than leakage.
 *
 * If this test ever fails, the front page is teaching the wrong lesson.
 */

const indexPath = resolve(import.meta.dirname, '../web/indexes/humaneval.idx.bin.gz');
const samplePath = resolve(import.meta.dirname, '../web/sample-corpus.jsonl');

function loadIndex(): Promise<NgramIndex> {
  return loadIndexFromBytes(readFileSync(indexPath));
}

function sampleFile(): File {
  return new File([readFileSync(samplePath)], 'sample-corpus.jsonl', { type: 'application/x-ndjson' });
}

test('the sample corpus still matches HumanEval, and only where documented', async () => {
  const report = await scanFile(await loadIndex(), sampleFile());
  const exact = report.tiers.find((t) => t.tier === 'exact')!;

  assert.equal(report.corpusDocs, 5);
  assert.deepEqual(report.contaminatedItemIds, ['HumanEval-78']);
  assert.equal(exact.totalHits, 2, 'a prime sequence and the ten digits, nothing else');

  const docs = exact.hits.map((h) => h.corpusDocId).sort();
  assert.deepEqual(docs, ['sample-2', 'sample-4']);

  // Both are canonical text. The page says so, and the evidence has to bear it out.
  const matched = exact.hits.map((h) => h.matchedText).join(' | ');
  assert.match(matched, /prime numbers are 2, 3, 5, 7, 11, 13, 17/);
  assert.match(matched, /digits are 0, 1, 2, 3, 4, 5, 6, 7, 8, 9/);
});

/**
 * The page loads the bundle, not the sources. A bundling regression — an import that only
 * resolves under Node, say — would pass every other test and break the product silently.
 */
test('the browser bundle produces the same result as the sources', async (t) => {
  const bundlePath = resolve(import.meta.dirname, '../web/ingot.js');
  if (!existsSync(bundlePath)) {
    t.skip('web/ingot.js not built; run node scripts/build-web.ts --bundle-only');
    return;
  }

  const bundle = await import(pathToFileURL(bundlePath).href);
  const index = await bundle.loadIndexFromBytes(readFileSync(indexPath));
  const report = await bundle.scanFile(index, sampleFile());
  const exact = report.tiers.find((tier: { tier: string }) => tier.tier === 'exact');

  assert.deepEqual(report.contaminatedItemIds, ['HumanEval-78']);
  assert.equal(exact.totalHits, 2);
  assert.equal(report.corpusDocs, 5);
});
