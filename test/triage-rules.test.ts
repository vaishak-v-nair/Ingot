/**
 * The triage thresholds decide what the registry publicly calls "leaked". Until now they
 * were private to a script and untested: a regression that kept the published counts by
 * coincidence would have passed every gate. These pin the rules themselves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { jsonlLines, longestRun, norm, tokens, verdictFor } from '../scripts/triage-rules.ts';

test('verdictFor: the floor artifact alone is phrase-level', () => {
  // A 19-token item flagged by a 10-gram has 53% coverage by construction, zero excess.
  // This exact shape was once labelled "leaked"; it must never be again.
  assert.equal(verdictFor(10 / 19, 0), 'phrase');
});

test('verdictFor: coverage without excess is never leaked', () => {
  assert.equal(verdictFor(0.9, 4), 'partial');
});

test('verdictFor: leaked at exactly the published thresholds', () => {
  assert.equal(verdictFor(0.5, 5), 'leaked');
});

test('verdictFor: partial at exactly the published thresholds', () => {
  assert.equal(verdictFor(0.25, 2), 'partial');
});

test('verdictFor: high excess with low coverage stays phrase', () => {
  assert.equal(verdictFor(0.2, 50), 'phrase');
});

test('longestRun: finds an interior run', () => {
  assert.equal(longestRun(['x', 'a', 'b', 'c', 'y'], ['q', 'a', 'b', 'c']), 3);
});

test('longestRun: empty and disjoint inputs are zero', () => {
  assert.equal(longestRun([], ['a']), 0);
  assert.equal(longestRun(['a'], []), 0);
  assert.equal(longestRun(['a', 'b'], ['c', 'd']), 0);
});

test('longestRun: identical sequences cover the whole item', () => {
  assert.equal(longestRun(['a', 'b', 'c'], ['a', 'b', 'c']), 3);
});

test('tokens: lowercases, strips punctuation, keeps numbers and unicode letters', () => {
  assert.deepEqual(tokens('The prime, numbers: 2 and 3 (café)!'), [
    'the',
    'prime',
    'numbers',
    '2',
    'and',
    '3',
    'café',
  ]);
});

test('norm: collapses all whitespace, folds case, trims', () => {
  assert.equal(norm("  Janet's\n\tducks  LAY "), "janet's ducks lay");
});

test('jsonlLines: U+2028 inside a JSON string does not end a line', async () => {
  const input = Readable.from(['{"text":"a\u2028b"}\n{"text":"c"}\n']);
  const lines: string[] = [];
  for await (const line of jsonlLines(input)) lines.push(line);
  assert.equal(lines.length, 2);
  assert.equal((JSON.parse(lines[0]) as { text: string }).text, 'a\u2028b');
});

test('jsonlLines: a line split across chunks is reassembled, trailing line flushed', async () => {
  const input = Readable.from(['{"a', '":1}\n{"b":2}']);
  const lines: string[] = [];
  for await (const line of jsonlLines(input)) lines.push(line);
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});
