import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { scanFile } from '../src/contamination/browserScan.ts';
import { scanCorpus } from '../src/contamination/scan.ts';
import { ScanSession } from '../src/contamination/scanSession.ts';
import { mulberry32 } from '../src/text.ts';
import type { BenchmarkItem } from '../src/contamination/types.ts';

function words(count: number, seed = 0): string {
  const rand = mulberry32((seed * 2654435761) >>> 0);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(`w${Math.floor(rand() * 100000)}`);
  return out.join(' ');
}

function bench(n = 10): NgramIndex {
  const items: BenchmarkItem[] = Array.from({ length: 10 }, (_, i) => ({
    id: `b${i}`,
    text: words(40, 70000 + i),
  }));
  return NgramIndex.build('load-test', items, { n });
}

/**
 * A file where every line skips must never present as a scanned file. The report has to
 * carry the counts that let the page refuse — corpusDocs 0 plus the skip tally — because
 * a green 0 over an unread file is the silent failure docs/silent-failures.md is about.
 */
test('all-garbage file reports zero docs and full skip counts, never a clean scan', async () => {
  const body = ['not json at all', '[1,2,3]', '{"no_text_field": true}', '42'].join('\n') + '\n';
  const report = await scanFile(bench(), new File([body], 'garbage.jsonl'));

  assert.equal(report.corpusDocs, 0);
  assert.ok(report.load, 'report.load must exist so the page can refuse');
  assert.equal(report.load.totalLines, 4);
  assert.equal(report.load.skipped, 4);
});

test('mixed file counts skips beside readable records', async () => {
  const rows = [
    JSON.stringify({ id: 'a', text: words(30, 71000) }),
    'broken line',
    JSON.stringify({ id: 'b', text: words(30, 71001) }),
    '{"text": ""}',
  ];
  const report = await scanFile(bench(), new File([rows.join('\n') + '\n'], 'mixed.jsonl'));

  assert.equal(report.corpusDocs, 2);
  assert.equal(report.load?.totalLines, 4);
  assert.equal(report.load?.skipped, 2);
});

test('a tail line without a trailing newline is counted, read, and hashed', async () => {
  const good = JSON.stringify({ id: 'tail', text: words(30, 72000) });
  const report = await scanFile(bench(), new File([`bad first line\n${good}`], 'tail.jsonl'));

  assert.equal(report.load?.totalLines, 2);
  assert.equal(report.load?.skipped, 1);
  assert.equal(report.corpusDocs, 1);
});

test('an empty file refuses with zero lines rather than presenting clean', async () => {
  const report = await scanFile(bench(), new File([''], 'empty.jsonl'));
  assert.equal(report.corpusDocs, 0);
  assert.equal(report.load?.totalLines, 0);
  assert.equal(report.load?.skipped, 0);
});

/**
 * "Dropped as ordinary language: N" is itself a judgement, so the dropped matches must be
 * readable. The filter drops a run when its rarest gram is common across the corpus; the
 * session must retain those hits (capped) with the doc frequency that condemned them.
 */
test('the frequency filter records what it drops, with the doc frequency carried', async () => {
  const phrase = words(15, 73000);
  const items: BenchmarkItem[] = [
    { id: 'famous', text: phrase },
    { id: 'other', text: words(40, 73001) },
  ];
  const index = NgramIndex.build('dropped', items, { n: 10 });
  // The phrase appears in many documents, so every one of its grams is common and the
  // match is dropped as ordinary language rather than kept as evidence.
  const session = new ScanSession(index, { maxCorpusDocFrequency: 3 });
  for (let d = 0; d < 8; d++) session.addDocument(`doc${d}`, `${words(10, 74000 + d)} ${phrase}`);
  const report = session.finish({
    corpusName: 'dropped.jsonl',
    corpusHash: 'x',
    corpusBytes: 1,
    command: 'test',
    elapsedMs: 0,
  });

  const exact = report.tiers.find((t) => t.tier === 'exact')!;
  assert.ok((exact.droppedGeneric ?? 0) > 0, 'setup must actually drop matches');
  assert.ok(exact.droppedSamples && exact.droppedSamples.length > 0, 'dropped matches are readable');
  assert.equal(exact.droppedSamples.length, exact.droppedGeneric, 'below the cap, every drop is kept');
  for (const h of exact.droppedSamples) {
    assert.ok((h.corpusDocFrequency ?? 0) > 3, 'each carries the frequency that condemned it');
    assert.ok(h.matchedText.length > 0);
  }
});

/**
 * The progress number is bytes fed to the decoder, not decoded characters. A decoded
 * string's .length is UTF-16 code units — dividing that by the file's byte size made the
 * bar and the ETA wrong by up to 3× on CJK corpora.
 */
test('progress reports real bytes, not decoded characters', async () => {
  // 5,001 records so the every-5,000-docs progress callback fires at least once. The
  // text is CJK-heavy: three bytes per character, so character counting would report
  // well under half the true byte count.
  const rows: string[] = [];
  for (let i = 0; i < 5001; i++) rows.push(JSON.stringify({ id: `c${i}`, text: '漢字'.repeat(40) }));
  const file = new File([rows.join('\n') + '\n'], 'cjk.jsonl');
  let lastBytes = 0;
  await scanFile(bench(), file, { onProgress: (_d, _t, b) => { lastBytes = b; } });

  assert.ok(lastBytes > 0, 'progress fired');
  assert.ok(lastBytes <= file.size, 'never past the true size');
  assert.ok(
    lastBytes > file.size * 0.6,
    `progress (${lastBytes}) must track bytes (${file.size}), not characters`,
  );
});

/**
 * Text slots are allocated by drop-certainty (frequencies only grow, so already-past-the-
 * threshold means certainly dropped). Without that, the drops-dominate regime at web scale
 * spends every slot on future discards and a late genuine leak is counted but wordless.
 */
test('a genuine leak found late in a drop-dominated scan still gets its words', () => {
  const common = words(15, 76000);
  const rare = words(15, 76001);
  const items: BenchmarkItem[] = [
    { id: 'common-item', text: common },
    { id: 'rare-item', text: rare },
  ];
  const index = NgramIndex.build('late', items, { n: 10 });
  const session = new ScanSession(index, { maxCorpusDocFrequency: 3 });
  // 900 certain drops: past the fourth document, the common item's grams are over the
  // threshold, so none of these may consume a survivor text slot.
  for (let d = 0; d < 900; d++) session.addDocument(`noise${d}`, `${words(8, 77000 + d)} ${common}`);
  // The genuine leak arrives after every naive slot would have been spent.
  session.addDocument('leak', `${words(8, 78000)} ${rare}`);
  const report = session.finish({
    corpusName: 'x', corpusHash: 'x', corpusBytes: 1, command: 't', elapsedMs: 0,
  });

  const exact = report.tiers.find((t) => t.tier === 'exact')!;
  assert.equal(exact.totalHits, 1, 'only the leak survives the filter');
  assert.ok((exact.droppedGeneric ?? 0) >= 800, 'the noise was dropped');
  assert.equal(exact.hits.length, 1, 'the late survivor kept its evidence');
  assert.equal(exact.hits[0].benchmarkItemId, 'rare-item');
  assert.ok(exact.hits[0].matchedText.length > 0, 'with actual words to show');
});

/**
 * Parity: the CLI path counts the same way the browser does, so a garbage corpus can
 * never exit as a clean scan on the surface that feeds the published registry.
 */
test('the CLI scan path counts skips and reports an unread corpus', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ingot-load-'));
  const p = join(scratch, 'garbage.jsonl');
  writeFileSync(p, 'nope\n[1,2,3]\n{"no_text": true}\n', 'utf8');
  const report = await scanCorpus(bench(), p);

  assert.equal(report.corpusDocs, 0);
  assert.equal(report.load?.totalLines, 3);
  assert.equal(report.load?.skipped, 3);
});

/**
 * The command line's documented rule holds in the browser: corpus bytes are counted
 * UNCOMPRESSED, because that is what the corpus is. A gzipped shard and the file it
 * expands to are the same scan with the same corpus hash — across both surfaces.
 */
test('a gzipped corpus scans identically to the file it expands to, on both surfaces', async () => {
  const items: BenchmarkItem[] = Array.from({ length: 10 }, (_, i) => ({
    id: `g${i}`,
    text: words(40, 79000 + i),
  }));
  const index = NgramIndex.build('gz', items, { n: 10 });
  const rows = [
    JSON.stringify({ id: 'leak', text: `${words(12, 79100)} ${items[0].text}` }),
    ...Array.from({ length: 20 }, (_, i) => JSON.stringify({ id: `c${i}`, text: words(50, 79200 + i) })),
  ];
  const plain = rows.join('\n') + '\n';
  const gz = gzipSync(Buffer.from(plain, 'utf8'));

  const a = await scanFile(index, new File([plain], 'c.jsonl'));
  const b = await scanFile(index, new File([gz], 'c.jsonl.gz'));

  assert.equal(b.corpusHash, a.corpusHash, 'same corpus, same identity');
  assert.equal(b.receipt.corpusBytes, a.receipt.corpusBytes, 'bytes are the corpus, not the container');
  assert.equal(b.corpusDocs, a.corpusDocs);
  assert.equal(b.corpusTokens, a.corpusTokens);
  const ea = a.tiers.find((t) => t.tier === 'exact')!;
  const eb = b.tiers.find((t) => t.tier === 'exact')!;
  assert.equal(eb.totalHits, ea.totalHits);
  assert.ok(ea.totalHits >= 1, 'the planted leak was found');

  // And the CLI, scanning the same gzipped bytes from disk, names the same corpus.
  const scratch = mkdtempSync(join(tmpdir(), 'ingot-gz-'));
  const p = join(scratch, 'c.jsonl.gz');
  writeFileSync(p, gz);
  const cli = await scanCorpus(index, p);
  assert.equal(cli.corpusHash, a.corpusHash, 'browser and CLI agree on the gzipped shard');
});

test('gzip is detected by magic bytes, not the filename', async () => {
  const plain = JSON.stringify({ id: 'a', text: words(30, 79300) }) + '\n';
  const gz = gzipSync(Buffer.from(plain, 'utf8'));
  const report = await scanFile(bench(), new File([gz], 'renamed.jsonl'));
  assert.equal(report.corpusDocs, 1);
  assert.equal(report.load?.skipped, 0);
});

test('progress for a gzipped file is measured against the compressed size', async () => {
  const rows: string[] = [];
  for (let i = 0; i < 5001; i++) {
    rows.push(JSON.stringify({ id: `p${i}`, text: 'plain filler text that compresses well '.repeat(4) + i }));
  }
  const gz = gzipSync(Buffer.from(rows.join('\n') + '\n', 'utf8'));
  const file = new File([gz], 'big.jsonl.gz');
  let lastBytes = 0;
  await scanFile(bench(), file, { onProgress: (_d, _t, b) => { lastBytes = b; } });

  assert.ok(lastBytes > 0, 'progress fired');
  assert.ok(
    lastBytes <= file.size,
    `progress (${lastBytes}) must track the compressed file (${file.size}), not the expanded corpus`,
  );
});

test('a clean scan leaves droppedSamples absent rather than empty', async () => {
  const report = await scanFile(
    bench(),
    new File([JSON.stringify({ id: 'c', text: words(30, 75000) }) + '\n'], 'clean.jsonl'),
  );
  const exact = report.tiers.find((t) => t.tier === 'exact')!;
  assert.equal(exact.droppedSamples, undefined);
});
