import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NgramIndex, forEachNgram } from '../src/contamination/ngramIndex.ts';
import { IndexVersionError } from '../src/errors.ts';
import { tokenize } from '../src/text.ts';
import { INDEX_FORMAT_VERSION } from '../src/contamination/types.ts';
import type { BenchmarkItem } from '../src/contamination/types.ts';

const N = 13;

function words(count: number, seed = 0): string {
  // Deterministic pseudo-text with enough variety that grams are distinct.
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(`w${(i * 7919 + seed * 104729) % 4001}`);
  return out.join(' ');
}

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
