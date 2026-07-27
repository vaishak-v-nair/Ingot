import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import {
  CODEC_VERSION,
  decodeIndex,
  encodeIndex,
  gunzipIfNeeded,
  gzipBytes,
} from '../src/contamination/indexCodec.ts';
import { mulberry32 } from '../src/text.ts';
import type { BenchmarkItem, NgramIndexData } from '../src/contamination/types.ts';

/**
 * The wire format is what other people's tools will read. A codec that loses a key loses a
 * finding, and it loses it silently — the scan runs, the report looks healthy, and the
 * contaminated item simply is not there.
 */

function bench(count: number, length = 40, seed = 1): BenchmarkItem[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    text: Array.from({ length }, () => `w${Math.floor(rand() * 50000)}`).join(' '),
    subject: i % 3 === 0 ? `subject-${i % 7}` : undefined,
  }));
}

function asMap(data: NgramIndexData): Map<number, string> {
  const out = new Map<number, string>();
  for (let i = 0; i < data.keys.length; i++) {
    out.set(data.keys[i], data.items[i].slice().sort((a, b) => a - b).join(','));
  }
  return out;
}

test('a round trip through the binary format changes nothing', () => {
  const original = NgramIndex.build('codec', bench(200)).serialize();
  const back = decodeIndex(encodeIndex(original));

  assert.equal(back.keys.length, original.keys.length);
  assert.deepEqual(asMap(back), asMap(original));

  assert.equal(back.benchmark, original.benchmark);
  assert.equal(back.benchmarkHash, original.benchmarkHash);
  assert.equal(back.n, original.n);
  assert.deepEqual(back.itemIds, original.itemIds);
  assert.deepEqual(back.itemSubjects, original.itemSubjects);
  assert.deepEqual(back.uncheckableItemIds, original.uncheckableItemIds);
  assert.deepEqual(back.stats, original.stats);
  assert.equal(back.scannerVersion, original.scannerVersion);
});

test('keys near the 53-bit ceiling survive, where 32-bit shifts would not', () => {
  const original = NgramIndex.build('wide', bench(400, 60, 99)).serialize();
  const largest = Math.max(...original.keys);
  assert.ok(largest > 2 ** 45, `expected a key past 2^45, largest was ${largest}`);

  const back = decodeIndex(encodeIndex(original));
  assert.deepEqual(asMap(back), asMap(original));
  assert.ok(back.keys.every(Number.isSafeInteger));
});

test('a decoded index finds exactly what the original found', async () => {
  const items = bench(120, 50, 7);
  const built = NgramIndex.build('equal', items);
  const reloaded = NgramIndex.load(decodeIndex(encodeIndex(built.serialize())));

  assert.equal(reloaded.size, built.size);
  for (const key of built.serialize().keys) {
    assert.deepEqual(reloaded.lookup(key), built.lookup(key));
  }
});

test('grams shared by several items keep every owner', () => {
  // Repeating one passage across items forces multi-owner grams, which take the
  // bitmap-flagged path rather than the common single-owner one.
  const shared = 'the quick brown fox jumps over the lazy dog again and again';
  const items: BenchmarkItem[] = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`,
    text: i < 3 ? `${shared} tail ${i}` : `unique ${i} ${Array.from({ length: 30 }, (_, k) => `u${i}x${k}`).join(' ')}`,
  }));
  const original = NgramIndex.build('shared', items).serialize();
  const multi = original.items.filter((o) => o.length > 1).length;
  assert.ok(multi > 0, 'fixture should produce grams owned by more than one item');

  assert.deepEqual(asMap(decodeIndex(encodeIndex(original))), asMap(original));
});

test('a file that is not an index is refused, not misread', () => {
  const junk = new TextEncoder().encode('this is a JSON file, actually {"keys":[]}');
  assert.throws(() => decodeIndex(junk), /not an Ingot index/);
});

test('an index from a future codec is refused rather than misparsed', () => {
  const bytes = encodeIndex(NgramIndex.build('future', bench(20)).serialize());
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  view.setUint32(8, CODEC_VERSION + 1, true);
  assert.throws(() => decodeIndex(bytes), /index format/i);
});

test('gzip round trips, and unzipping plain bytes leaves them alone', async () => {
  const original = encodeIndex(NgramIndex.build('gz', bench(150)).serialize());
  const zipped = await gzipBytes(original);

  assert.ok(zipped.length < original.length, 'the index should compress');
  assert.equal(zipped[0], 0x1f);
  assert.equal(zipped[1], 0x8b);
  assert.deepEqual(await gunzipIfNeeded(zipped), original);

  // A host that already decompressed for us must not be double-unzipped.
  assert.deepEqual(await gunzipIfNeeded(original), original);
});

test('stride keeps every item findable while shrinking the index', () => {
  const items = bench(150, 80, 21);
  const full = NgramIndex.build('stride-1', items, { stride: 1 });
  const sparse = NgramIndex.build('stride-4', items, { stride: 4 });

  assert.ok(sparse.size < full.size / 3, `expected a much smaller index, got ${sparse.size} vs ${full.size}`);
  assert.equal(sparse.stats.stride, 4);
  assert.ok(sparse.stats.droppedStride > 0);
  assert.deepEqual(sparse.uncheckableItemIds, full.uncheckableItemIds);
});
