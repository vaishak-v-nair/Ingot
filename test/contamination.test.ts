import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { NgramIndex, forEachNgram, tokenHash } from '../src/contamination/ngramIndex.ts';
import { hashTokens } from '../src/contamination/fastTokens.ts';
import { scanCorpus } from '../src/contamination/scan.ts';
import { ScanSession } from '../src/contamination/scanSession.ts';
import { runContaminate } from '../src/cli.ts';
import { IndexVersionError } from '../src/errors.ts';
import { mulberry32, tokenize } from '../src/text.ts';
import { INDEX_FORMAT_VERSION } from '../src/contamination/types.ts';
import type { BenchmarkItem } from '../src/contamination/types.ts';

const scratch = mkdtempSync(join(tmpdir(), 'ingot-contam-'));

function writeCorpus(name: string, rows: { id: string; text: string }[]): string {
  const p = join(scratch, name);
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return p;
}

const N = 13;

/**
 * Deterministic pseudo-text. Must use a real PRNG: an arithmetic progression like
 * `(i * 7919 + seed * 104729) % 4001` advances by a constant step, so every seed emits
 * the same cyclic sequence at a different offset and all items share long n-grams. That
 * produced 26 entirely correct "false positives" before the generator was fixed.
 */
function words(count: number, seed = 0): string {
  const rand = mulberry32((seed * 2654435761) >>> 0);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(`w${Math.floor(rand() * 100000)}`);
  return out.join(' ');
}

test('the fused hasher agrees with tokenize + tokenHash, token for token', () => {
  const samples = [
    words(80, 61),
    "Don't split contractions; keep 3.14 and ISO-8601 apart.",
    'Mixed CASE and    irregular   whitespace\nplus newlines.',
    'punctuation!!! everywhere??? (parens) [brackets] "quotes"',
    'accented café naïve über Ünicode straße',
  ];

  for (const text of samples) {
    const expected = tokenize(text).map(tokenHash);
    const { hashes, count } = hashTokens(text);
    assert.equal(count, expected.length, `token count differs for: ${text.slice(0, 40)}`);
    for (let i = 0; i < count; i++) {
      assert.equal(hashes[i], expected[i], `token ${i} hash differs for: ${text.slice(0, 40)}`);
    }
  }
});

test('fused token boundaries slice back to the original text', () => {
  const text = 'The Quick brown FOX jumps over the lazy dog near café walls.';
  const expected = tokenize(text);
  const { starts, ends, count } = hashTokens(text);
  assert.equal(count, expected.length);
  for (let i = 0; i < count; i++) {
    assert.equal(text.slice(starts[i], ends[i]).toLowerCase(), expected[i]);
  }
});

test('rolling hash agrees with direct computation at every window', () => {
  const tokens = tokenize(words(200, 3));

  const rolled: { key: number; offset: number }[] = [];
  forEachNgram(tokens, N, (key, offset) => rolled.push({ key, offset }));

  assert.equal(rolled.length, tokens.length - N + 1);

  // forEachNgram computes the first window directly and rolls thereafter. Feeding it a
  // single isolated window therefore exercises only the direct path.
  for (const { key, offset } of rolled) {
    const window = tokens.slice(offset, offset + N);
    let direct: number | null = null;
    forEachNgram(window, N, (k) => {
      direct = k;
    });
    assert.equal(key, direct, `rolled key at offset ${offset} disagrees with direct computation`);
  }
});

test('rolling hash yields a safe integer key', () => {
  const tokens = tokenize(words(300, 11));
  forEachNgram(tokens, N, (key) => {
    assert.ok(Number.isSafeInteger(key), `key ${key} is not a safe integer`);
    assert.ok(key >= 0);
  });
});

test('short inputs produce no grams rather than throwing', () => {
  let count = 0;
  forEachNgram(tokenize('only a handful of words here'), N, () => count++);
  assert.equal(count, 0);
});

test('planted text is found: every gram of an indexed item looks up to that item', () => {
  const items: BenchmarkItem[] = [
    { id: 'q1', text: words(60, 1) },
    { id: 'q2', text: words(60, 2) },
    { id: 'q3', text: words(60, 3) },
  ];
  const index = NgramIndex.build('planted', items, { n: N });

  const target = tokenize(items[1].text);
  let checked = 0;
  let found = 0;
  forEachNgram(target, N, (key) => {
    checked++;
    const owners = index.lookup(key);
    if (owners && owners.includes(1)) found++;
  });

  assert.ok(checked > 0);
  assert.equal(found, checked, 'every gram of an indexed item must resolve back to it');
});

test('the discriminative filter drops boilerplate shared across many items', () => {
  // 10 of 60 items share a phrase. Document frequency is 17%, below the stopword
  // threshold, so the stoplist leaves it alone and the discriminative filter must
  // be the thing that catches it.
  const boilerplate = words(40, 99);
  const items: BenchmarkItem[] = Array.from({ length: 60 }, (_, i) => ({
    id: `b${i}`,
    text: i < 10 ? `${boilerplate} ${words(40, 500 + i)}` : words(60, 900 + i),
  }));

  const filtered = NgramIndex.build('bp', items, { n: N, maxItemsPerGram: 3 });
  const unfiltered = NgramIndex.build('bp', items, { n: N, disableDiscriminativeFilter: true });

  assert.ok(
    filtered.stats.droppedNonDiscriminative > 0,
    'shared boilerplate should trip the discriminative filter',
  );
  assert.ok(filtered.size < unfiltered.size, 'filtering must remove grams, not add them');

  // The shared prefix must no longer resolve to anything.
  const shared = tokenize(boilerplate);
  let survivors = 0;
  forEachNgram(shared, N, (key) => {
    if (filtered.lookup(key)) survivors++;
  });
  assert.equal(survivors, 0, 'boilerplate grams must not survive the filter');
});

test('an all-stopword n-gram is dropped', () => {
  // "the of and to a" repeated makes the top-frequency list AND fills whole windows.
  // Needs at least STOPLIST_MIN_ITEMS items, below which document frequency is not
  // estimable and the stoplist is deliberately skipped.
  const filler = 'the of and to a in is it for on with as at by that '.repeat(4);
  const items: BenchmarkItem[] = Array.from({ length: 6 }, (_, i) => ({
    id: `s${i}`,
    text: `${filler} ${words(30, 7 + i)}`,
  }));
  const withStoplist = NgramIndex.build('sw', items, { n: N });
  // Compare against BOTH guards disabled. With only the stoplist off, the filler grams
  // are shared by all six items and the discriminative filter removes them anyway, so
  // the two index sizes come out equal and the comparison proves nothing.
  const unguarded = NgramIndex.build('sw', items, {
    n: N,
    disableStoplist: true,
    disableDiscriminativeFilter: true,
  });

  assert.ok(withStoplist.stats.droppedStoplist > 0, 'stopword-only windows should be dropped');
  assert.ok(withStoplist.size < unguarded.size, 'the stoplist must remove grams');

  // The filler must not resolve to anything once guarded.
  const fillerTokens = tokenize(filler);
  let survivors = 0;
  forEachNgram(fillerTokens, N, (key) => {
    if (withStoplist.lookup(key)) survivors++;
  });
  assert.equal(survivors, 0, 'stopword-only grams must not survive');
});

test('index round-trips through serialization', () => {
  const items: BenchmarkItem[] = [
    { id: 'r1', text: words(50, 21), subject: 'math' },
    { id: 'r2', text: words(50, 22), subject: 'history' },
  ];
  const original = NgramIndex.build('round', items, { n: N });
  const restored = NgramIndex.load(JSON.parse(JSON.stringify(original.serialize())));

  assert.equal(restored.n, original.n);
  assert.equal(restored.size, original.size);
  assert.equal(restored.benchmarkHash, original.benchmarkHash);
  assert.deepEqual(restored.itemIds, original.itemIds);
  assert.deepEqual(restored.itemSubjects, original.itemSubjects);

  const probe = tokenize(items[0].text);
  forEachNgram(probe, N, (key) => {
    assert.deepEqual(restored.lookup(key), original.lookup(key));
  });
});

test('a stale index format fails loudly instead of comparing silently', () => {
  const items: BenchmarkItem[] = [{ id: 'v1', text: words(40, 31) }];
  const data = NgramIndex.build('ver', items, { n: N }).serialize();
  data.formatVersion = INDEX_FORMAT_VERSION + 1;
  assert.throws(() => NgramIndex.load(data), IndexVersionError);
});

test('n outside the supported range is rejected', () => {
  const items: BenchmarkItem[] = [{ id: 'n1', text: words(40, 41) }];
  assert.throws(() => NgramIndex.build('n', items, { n: 5 }), RangeError);
  assert.throws(() => NgramIndex.build('n', items, { n: 20 }), RangeError);
});

test('planted verbatim contamination is recalled at 100%', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 40 }, (_, i) => ({
    id: `q${i}`,
    text: words(60, 1000 + i),
  }));
  const index = NgramIndex.build('planted-bench', bench, { n: N });

  // Ten benchmark items pasted verbatim into otherwise unrelated corpus documents.
  const plantedIds = bench.slice(0, 10).map((b) => b.id);
  const rows = [
    ...bench.slice(0, 10).map((b, i) => ({
      id: `dirty${i}`,
      text: `${words(25, 7000 + i)} ${b.text} ${words(25, 8000 + i)}`,
    })),
    ...Array.from({ length: 30 }, (_, i) => ({ id: `clean${i}`, text: words(80, 9000 + i) })),
  ];
  const corpusPath = writeCorpus('planted.jsonl', rows);

  const report = await scanCorpus(index, corpusPath);

  assert.equal(report.corpusDocs, 40);
  for (const id of plantedIds) {
    assert.ok(
      report.contaminatedItemIds.includes(id),
      `planted item ${id} must be recalled; tier-1 recall below 100% means a bug, not a metric`,
    );
  }
  assert.equal(report.contaminatedItemIds.length, plantedIds.length, 'no clean item may be flagged');
});

test('a gzipped corpus scans identically to the file it expands to', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 20 }, (_, i) => ({
    id: `g${i}`,
    text: words(50, 5100 + i),
  }));
  const index = NgramIndex.build('gz-bench', bench, { n: N });
  const rows = [
    { id: 'd1', text: `${words(20, 5300)} ${bench[4].text} ${words(20, 5400)}` },
    { id: 'd2', text: words(60, 5500) },
  ];

  const plainPath = writeCorpus('gz-twin.jsonl', rows);
  const gzPath = `${plainPath}.gz`;
  writeFileSync(gzPath, gzipSync(readFileSync(plainPath)));

  const plain = await scanCorpus(index, plainPath);
  const gz = await scanCorpus(index, gzPath);

  // The corpus is the text, not its encoding. If these hashes differ, a lab that stores
  // its corpus compressed and a reviewer who expanded it cannot compare two reports —
  // which is the entire point of publishing a hash.
  assert.equal(gz.corpusHash, plain.corpusHash, 'compression must not change corpus identity');
  assert.equal(gz.receipt.corpusHashFull, plain.receipt.corpusHashFull);
  assert.equal(gz.receipt.corpusBytes, plain.receipt.corpusBytes, 'bytes are the corpus, not the archive');
  assert.equal(gz.corpusDocs, plain.corpusDocs);
  assert.deepEqual(gz.contaminatedItemIds, plain.contaminatedItemIds);
  assert.ok(plain.contaminatedItemIds.includes('g4'), 'the fixture must actually find something');
});

test('sharded corpus files scan as the single corpus they concatenate to', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`,
    text: words(50, 6100 + i),
  }));
  const index = NgramIndex.build('shard-bench', bench, { n: N });

  const partA = [
    { id: 'a1', text: `${words(20, 6300)} ${bench[2].text} ${words(20, 6400)}` },
    { id: 'a2', text: words(60, 6500) },
  ];
  const partB = [
    { id: 'b1', text: words(60, 6600) },
    { id: 'b2', text: `${words(20, 6700)} ${bench[9].text} ${words(20, 6800)}` },
  ];

  const aPath = writeCorpus('shard-a.jsonl', partA);
  const bPath = writeCorpus('shard-b.jsonl', partB);
  const wholePath = writeCorpus('shard-whole.jsonl', [...partA, ...partB]);

  const sharded = await scanCorpus(index, [aPath, bPath], { corpusName: 'shard-whole.jsonl' });
  const whole = await scanCorpus(index, wholePath);

  // A pretraining corpus only ever arrives sharded. If the shard count changed the answer,
  // no two scans of the same corpus would agree and the number would mean nothing.
  assert.equal(sharded.corpusHash, whole.corpusHash, 'sharding must not change corpus identity');
  assert.equal(sharded.receipt.corpusHashFull, whole.receipt.corpusHashFull);
  assert.equal(sharded.receipt.corpusBytes, whole.receipt.corpusBytes);
  assert.equal(sharded.corpusDocs, whole.corpusDocs);
  assert.deepEqual(sharded.contaminatedItemIds, whole.contaminatedItemIds);
  assert.deepEqual(sharded.contaminatedItemIds, ['s2', 's9']);

  // The hash covers the concatenation, so the order that produced it has to be recoverable
  // or nobody can rebuild the input it attests to.
  assert.deepEqual(sharded.receipt.corpusParts, ['shard-a.jsonl', 'shard-b.jsonl']);
  assert.equal(whole.receipt.corpusParts, undefined);
});

test('a match reports its span with surrounding context, not just a count', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 20 }, (_, i) => ({
    id: `e${i}`,
    text: words(50, 2000 + i),
  }));
  const index = NgramIndex.build('evidence-bench', bench, { n: N });
  const corpusPath = writeCorpus('evidence.jsonl', [
    { id: 'd1', text: `${words(20, 3100)} ${bench[3].text} ${words(20, 3200)}` },
  ]);

  const report = await scanCorpus(index, corpusPath);
  const exact = report.tiers.find((t) => t.tier === 'exact')!;

  assert.ok(exact.hits.length > 0);
  const hit = exact.hits[0];
  assert.equal(hit.benchmarkItemId, 'e3');
  assert.equal(hit.corpusDocId, 'd1');
  assert.ok(hit.matchedText.split(' ').length >= N, 'matched span must be at least n tokens');
  assert.ok(hit.contextBefore.length > 0, 'context before the match must be shown');
  assert.ok(hit.contextAfter.length > 0, 'context after the match must be shown');
});

test('consecutive hits merge into one span rather than one per n-gram', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 20 }, (_, i) => ({
    id: `m${i}`,
    text: words(60, 4000 + i),
  }));
  const index = NgramIndex.build('merge-bench', bench, { n: N });
  const corpusPath = writeCorpus('merge.jsonl', [{ id: 'solo', text: bench[0].text }]);

  const report = await scanCorpus(index, corpusPath);
  const exact = report.tiers.find((t) => t.tier === 'exact')!;

  // 60 tokens verbatim yields 48 raw n-gram hits. They describe one copied passage.
  assert.equal(exact.totalHits, 1, 'a single copied passage must report as one match');
  assert.equal(exact.itemsHit, 1);
});

test('text common across the corpus is dropped as ordinary language, not reported', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 20 }, (_, i) => ({
    id: `g${i}`,
    text: words(50, 30000 + i),
  }));
  const index = NgramIndex.build('generic-bench', bench, { n: N });

  // The same benchmark text appears in 12 different corpus documents. That is what
  // canonical text looks like: a prime sequence, a famous quotation, a stock definition.
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: `common-${i}`,
    text: `${words(20, 31000 + i)} ${bench[0].text} ${words(20, 32000 + i)}`,
  }));
  const corpusPath = writeCorpus('generic.jsonl', rows);

  const report = await scanCorpus(index, corpusPath);
  const exact = report.tiers.find((t) => t.tier === 'exact')!;

  assert.equal(exact.totalHits, 0, 'text appearing in 12 documents is not evidence');
  assert.ok((exact.droppedGeneric ?? 0) > 0, 'the drop must be counted, not silent');
  assert.equal(report.contaminatedItemIds.length, 0);
});

test('a distinctive passage appearing once still counts, after the frequency filter', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 20 }, (_, i) => ({
    id: `d${i}`,
    text: words(50, 40000 + i),
  }));
  const index = NgramIndex.build('distinct-bench', bench, { n: N });

  const rows = [
    { id: 'leak', text: `${words(20, 41000)} ${bench[5].text} ${words(20, 42000)}` },
    ...Array.from({ length: 20 }, (_, i) => ({ id: `other-${i}`, text: words(70, 43000 + i) })),
  ];
  const corpusPath = writeCorpus('distinct.jsonl', rows);

  const report = await scanCorpus(index, corpusPath);
  const exact = report.tiers.find((t) => t.tier === 'exact')!;

  assert.equal(exact.itemsHit, 1, 'a one-off verbatim copy is exactly what should survive');
  assert.ok(report.contaminatedItemIds.includes('d5'));
});

test('a clean corpus produces no findings and still reports its content hash', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 20 }, (_, i) => ({
    id: `c${i}`,
    text: words(50, 5000 + i),
  }));
  const index = NgramIndex.build('clean-bench', bench, { n: N });
  const corpusPath = writeCorpus('clean.jsonl', [
    { id: 'a', text: words(90, 6001) },
    { id: 'b', text: words(90, 6002) },
  ]);

  const report = await scanCorpus(index, corpusPath);
  assert.equal(report.contaminatedItemIds.length, 0);
  assert.equal(report.tiers.find((t) => t.tier === 'exact')!.totalHits, 0);
  assert.match(report.corpusHash, /^[0-9a-f]{32}$/, 'a clean result still needs an attestable hash');
});

test('the near tier declines when the index carries no benchmark text', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 20 }, (_, i) => ({
    id: `n${i}`,
    text: words(50, 7500 + i),
  }));
  const index = NgramIndex.build('near-bench', bench, { n: N });
  const corpusPath = writeCorpus('near.jsonl', [{ id: 'x', text: words(80, 7700) }]);

  const report = await scanCorpus(index, corpusPath);
  const near = report.tiers.find((t) => t.tier === 'near')!;
  assert.match(near.unavailableReason ?? '', /benchmark text/);
  assert.equal(near.totalHits, 0);
});

test('an index built at one n does not silently match grams at another', () => {
  const items: BenchmarkItem[] = [{ id: 'x1', text: words(80, 51) }];
  const idx13 = NgramIndex.build('x', items, { n: 13 });
  const tokens = tokenize(items[0].text);

  let hits8 = 0;
  forEachNgram(tokens, 8, (key) => {
    if (idx13.lookup(key)) hits8++;
  });
  assert.equal(hits8, 0, '8-grams must not collide with a 13-gram index');
});

test('the corpus digest binds line boundaries, not just their concatenation', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 5 }, (_, i) => ({
    id: `lb${i}`,
    text: words(50, 8100 + i),
  }));
  const index = NgramIndex.build('digest-bench', bench, { n: N });

  // Same bytes once the newline moves: without a per-line separator in the full digest,
  // these two files — which parse into different documents — shared one attestation.
  const pa = join(scratch, 'digest-a.jsonl');
  writeFileSync(pa, '{"id":"a","text":"x"}\n{"id":"b","text":"y"}\n', 'utf8');
  const pb = join(scratch, 'digest-b.jsonl');
  writeFileSync(pb, '{"id":"a","text":"x"}{"id":"b","text":"y"}\n', 'utf8');

  const ra = await scanCorpus(index, pa);
  const rb = await scanCorpus(index, pb);
  assert.notEqual(
    ra.receipt.corpusHashFull,
    rb.receipt.corpusHashFull,
    'two different line structures must not share one attestation',
  );
});

test('an invalid byte does not split the corpus identity between gz and plain', async () => {
  const bench: BenchmarkItem[] = Array.from({ length: 5 }, (_, i) => ({
    id: `iv${i}`,
    text: words(50, 8200 + i),
  }));
  const index = NgramIndex.build('invalid-bench', bench, { n: N });

  // 0xE9 is not valid UTF-8 on its own; it decodes to U+FFFD, which re-encodes as three
  // bytes. Counting bytes AFTER decoding therefore disagreed with the browser's raw
  // count, and the byte count folds into the corpus hash: same shard, two identities.
  const raw = Buffer.concat([
    Buffer.from('{"id":"a","text":"caf'),
    Buffer.from([0xe9]),
    Buffer.from(` ${words(20, 8300)}"}\n`),
  ]);
  const pp = join(scratch, 'invalid.jsonl');
  writeFileSync(pp, raw);
  writeFileSync(`${pp}.gz`, gzipSync(raw));

  const plain = await scanCorpus(index, pp);
  const gz = await scanCorpus(index, `${pp}.gz`);
  assert.equal(gz.receipt.corpusBytes, plain.receipt.corpusBytes, 'bytes are the raw stream on both paths');
  assert.equal(gz.corpusHash, plain.corpusHash, 'an invalid byte must not fork the corpus identity');
});

test('a --bench file that is not the benchmark the index was built from is refused', () => {
  const bench: BenchmarkItem[] = Array.from({ length: 6 }, (_, i) => ({
    id: `mm${i}`,
    text: words(50, 8400 + i),
  }));
  const index = NgramIndex.build('mismatch-bench', bench, { n: N });

  // Same items, different order: near-tier hits used to resolve bench positions through
  // index.itemIds, so this exact pairing misattributed every near hit. Now it refuses.
  const shuffled = [bench[1], bench[0], ...bench.slice(2)];
  assert.throws(
    () => new ScanSession(index, { benchmarkItems: shuffled }),
    /IndexMismatch|not the benchmark/,
    'a reordered bench file must be refused, not misattributed',
  );
  assert.doesNotThrow(() => new ScanSession(index, { benchmarkItems: bench }));
});

test('a document whose every exact match is a certain drop is still near-checked', () => {
  // Seven filler documents each quote items[3] in full, so by the time the target
  // arrives, every gram of items[3] is past the frequency threshold — the target's exact
  // runs are all certain drops at capture time. The target IS a copy of items[3]: the
  // exact tier discards it as ordinary language, and the old gate (`raw.length === 0`)
  // then skipped the near tier for it too, so the one document most worth flagging was
  // flagged by neither tier.
  const bench: BenchmarkItem[] = Array.from({ length: 10 }, (_, i) => ({
    id: `cd${i}`,
    text: words(100, 8500 + i),
  }));
  const index = NgramIndex.build('certain-drop-bench', bench, { n: N });
  const session = new ScanSession(index, { benchmarkItems: bench });

  for (let i = 0; i < 7; i++) session.addDocument(`filler${i}`, `${bench[3].text} ${words(15, 8600 + i)}`);
  session.addDocument('target', `${bench[3].text} zz1 zz2`);

  const report = session.finish({
    corpusName: 'certain-drop', corpusHash: 'x', corpusBytes: 1, command: 'test', elapsedMs: 0,
  });
  const near = report.tiers.find((t) => t.tier === 'near')!;
  assert.ok(
    near.hits.some((h) => h.benchmarkItemId === 'cd3' && h.corpusDocId === 'target'),
    'the near tier must see a document whose exact matches are all certain drops',
  );
});

test('a verbatim copy against a strided index is one run, not one per stride step', () => {
  const item: BenchmarkItem = { id: 'st0', text: words(60, 8700) };
  const strided = NgramIndex.build('stride-bench', [item], { n: 13, stride: 4 });
  const session = new ScanSession(strided);
  session.addDocument('d1', item.text);

  const report = session.finish({
    corpusName: 'stride', corpusHash: 'x', corpusBytes: 1, command: 'test', elapsedMs: 0,
  });
  const exact = report.tiers.find((t) => t.tier === 'exact')!;
  assert.equal(exact.itemsHit, 1);
  assert.equal(exact.totalHits, 1, 'stride-spaced hits of one copy must merge into one span');
});

test('a valued flag with a missing value is refused, never defaulted to zero', async () => {
  // `--max-doc-freq` with nothing after it parsed as '' and Number('') is 0 — a threshold
  // that drops every match as ordinary language and prints a manufactured green verdict.
  assert.equal(await runContaminate(['--index', 'humaneval', '--corpus', 'x.jsonl', '--max-doc-freq']), 2);
  assert.equal(await runContaminate(['--index', 'humaneval', '--corpus', 'x.jsonl', '--max-doc-freq', '0']), 2);
});
