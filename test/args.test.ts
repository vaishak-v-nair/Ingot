import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, suggestFlag } from '../src/args.ts';
import type { FlagSpec } from '../src/args.ts';

/**
 * The parser's whole job is to refuse an invocation it does not understand.
 *
 * Every case here was silently accepted before, and each one produced a confident report of
 * a different experiment than the one that was asked for. That is the failure mode this
 * scanner exists to refuse, arriving through the front door.
 */
const SPEC: FlagSpec = {
  index: 'value',
  corpus: 'value',
  'max-doc-freq': 'value',
  out: 'value',
  quiet: 'boolean',
};

test('an unrecognised flag is an error, not a shrug', () => {
  const { errors } = parseArgs(['--corpus', 'c.jsonl', '--pretty-please'], SPEC);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown option --pretty-please/);
});

test('a near-miss flag names the flag that was meant', () => {
  // The motivating case: --maxdocfreq ran the scan at the default threshold of 5 and
  // exited 0. Four edits from the real name, and the wrong answer looked identical to
  // the right one.
  const { errors } = parseArgs(['--maxdocfreq', '1000'], SPEC);
  assert.match(errors[0], /did you mean --max-doc-freq\?/);
});

test('the typo’s value is not then reported as a stray argument', () => {
  const { errors, positional } = parseArgs(['--maxdocfreq', '1000'], SPEC);
  assert.equal(errors.length, 1, 'one mistake should produce one message');
  assert.deepEqual(positional, []);
});

test('a flag whose value is missing is refused rather than silently empty', () => {
  // `--out` at the end of the line stored '', `if (htmlPath)` read it as falsy, and the
  // report was never written. Exit 0, no complaint, no file.
  const { errors } = parseArgs(['--index', 'humaneval', '--out'], SPEC);
  assert.deepEqual(errors, ['--out needs a value']);
});

test('a flag does not eat the next flag when its own value is missing', () => {
  const { errors, flags } = parseArgs(['--out', '--quiet'], SPEC);
  assert.deepEqual(errors, ['--out needs a value']);
  assert.equal(flags.get('quiet'), 'true', 'the following flag must still be seen');
});

test('every problem in one invocation is reported at once', () => {
  const { errors } = parseArgs(['--nope', 'x', '--out', '--alsonope'], SPEC);
  assert.equal(errors.length, 3);
});

test('--flag=value is accepted', () => {
  const { flags, errors } = parseArgs(['--index=humaneval', '--corpus=c.jsonl'], SPEC);
  assert.deepEqual(errors, []);
  assert.equal(flags.get('index'), 'humaneval');
  assert.equal(flags.get('corpus'), 'c.jsonl');
});

test('--flag= with nothing after the equals is still a missing value', () => {
  const { errors } = parseArgs(['--index='], SPEC);
  assert.deepEqual(errors, ['--index needs a value']);
});

test('a boolean flag given a value is refused', () => {
  const { errors } = parseArgs(['--quiet=loud'], SPEC);
  assert.match(errors[0], /--quiet takes no value/);
});

test('a repeated flag is refused rather than last-one-wins', () => {
  // Someone writing this means to scan both files. Silently scanning only the second is a
  // wrong answer that looks exactly like a right one.
  const { errors } = parseArgs(['--corpus', 'a.jsonl', '--corpus', 'b.jsonl'], SPEC);
  assert.match(errors[0], /--corpus was given more than once/);
});

test('a negative number is a value, not a flag', () => {
  const { flags, errors } = parseArgs(['--max-doc-freq', '-1'], SPEC);
  assert.deepEqual(errors, []);
  assert.equal(flags.get('max-doc-freq'), '-1', 'the per-flag check refuses it, not the parser');
});

test('-- ends the flags', () => {
  const { positional, errors } = parseArgs(['--quiet', '--', '--not-a-flag'], SPEC);
  assert.deepEqual(errors, []);
  assert.deepEqual(positional, ['--not-a-flag']);
});

test('positional arguments survive alongside flags', () => {
  const { positional } = parseArgs(['batch.jsonl', '--quiet'], SPEC);
  assert.deepEqual(positional, ['batch.jsonl']);
});

test('suggestFlag stays quiet when nothing is close', () => {
  assert.equal(suggestFlag('out', ['index', 'corpus']), null);
  assert.equal(suggestFlag('corpuss', ['index', 'corpus']), 'corpus');
});
