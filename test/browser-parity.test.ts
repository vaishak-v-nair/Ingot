import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { scanCorpus } from '../src/contamination/scan.ts';
import { scanFile } from '../src/contamination/browserScan.ts';
import { mulberry32 } from '../src/text.ts';
import type { BenchmarkItem } from '../src/contamination/types.ts';

const scratch = mkdtempSync(join(tmpdir(), 'ingot-parity-'));

function words(count: number, seed = 0): string {
  const rand = mulberry32((seed * 2654435761) >>> 0);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(`w${Math.floor(rand() * 100000)}`);
  return out.join(' ');
}

/**
 * The browser build and the command line must agree exactly. If they ever drift, one of
 * them reports a number the other cannot reproduce, which is the end of an audit tool.
 */
test('browser scan and node scan produce identical findings', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`,
    text: words(60, 60000 + i),
  }));
  const index = NgramIndex.build('parity', bench, { n: 10 });

  const rows = [
    ...bench.slice(0, 5).map((b, i) => ({ id: `leak-${i}`, text: `${words(20, 61000 + i)} ${b.text}` })),
    ...Array.from({ length: 40 }, (_, i) => ({ id: `clean-${i}`, text: words(80, 62000 + i) })),
  ];
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const path = join(scratch, 'parity.jsonl');
  writeFileSync(path, jsonl, 'utf8');

  const nodeReport = await scanCorpus(index, path);
  const file = new File([readFileSync(path)], 'parity.jsonl', { type: 'application/jsonl' });
  const webReport = await scanFile(index, file);

  assert.deepEqual(webReport.contaminatedItemIds, nodeReport.contaminatedItemIds);
  assert.equal(webReport.corpusDocs, nodeReport.corpusDocs);
  assert.equal(webReport.corpusTokens, nodeReport.corpusTokens);

  // Corpus identity has to match too. Two reports on the same bytes that disagree about
  // which bytes they were cannot be compared, which defeats the point of publishing one.
  assert.equal(webReport.corpusHash, nodeReport.corpusHash);
  assert.equal(webReport.receipt.corpusBytes, nodeReport.receipt.corpusBytes);
  assert.equal(webReport.receipt.benchmarkHash, nodeReport.receipt.benchmarkHash);
  assert.equal(webReport.receipt.indexGrams, nodeReport.receipt.indexGrams);
  assert.equal(webReport.receipt.n, nodeReport.receipt.n);
  assert.equal(webReport.receipt.stride, nodeReport.receipt.stride);

  // The full digest is the one thing the browser cannot compute. It must be absent there
  // rather than quietly filled in with the weaker sampled hash.
  assert.ok(nodeReport.receipt.corpusHashFull, 'the command line records a full SHA-256');
  assert.equal(webReport.receipt.corpusHashFull, undefined);

  const nodeExact = nodeReport.tiers.find((t) => t.tier === 'exact')!;
  const webExact = webReport.tiers.find((t) => t.tier === 'exact')!;
  assert.equal(webExact.itemsHit, nodeExact.itemsHit);
  assert.equal(webExact.totalHits, nodeExact.totalHits);
  assert.equal(webExact.droppedGeneric, nodeExact.droppedGeneric);

  assert.equal(webExact.hits.length, nodeExact.hits.length);
  for (let i = 0; i < webExact.hits.length; i++) {
    assert.equal(webExact.hits[i].benchmarkItemId, nodeExact.hits[i].benchmarkItemId);
    assert.equal(webExact.hits[i].matchedText, nodeExact.hits[i].matchedText);
  }
});

test('browser scan handles a file with no trailing newline', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, text: words(50, 70000 + i) }));
  const index = NgramIndex.build('tail', bench, { n: 10 });

  // Last line carries the planted text and ends without a newline: a classic off-by-one
  // that would silently skip the final document.
  const jsonl =
    JSON.stringify({ id: 'a', text: words(60, 71000) }) + '\n' +
    JSON.stringify({ id: 'b', text: bench[7].text });
  const file = new File([Buffer.from(jsonl, 'utf8')], 'tail.jsonl');

  const report = await scanFile(index, file);
  assert.equal(report.corpusDocs, 2, 'the final line must not be dropped');
  assert.ok(report.contaminatedItemIds.includes('t7'));
});
