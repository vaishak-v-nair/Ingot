import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../scripts/retry.ts';

/**
 * The retry exists because two separate multi-gigabyte downloads died mid-transfer on
 * their first run: C4 shard 9 with "other side closed", and the Pile's test.jsonl.zst the
 * same way. Both would have cost the whole download. These tests pin the behaviour that
 * makes a long fetch survive an unlucky minute, and the behaviour that stops it looping
 * forever on something genuinely absent.
 *
 * baseMs is 1 throughout so the suite does not wait out real exponential backoff.
 */

test('a transient failure is retried and the eventual success is returned', async () => {
  let calls = 0;
  const result = await withRetry(
    'flaky',
    async () => {
      calls++;
      if (calls < 3) throw new Error('other side closed');
      return 'payload';
    },
    { baseMs: 1, onRetry: () => {} },
  );

  assert.equal(result, 'payload');
  assert.equal(calls, 3, 'should have failed twice and succeeded on the third attempt');
});

test('a permanent failure stops at the try limit and rethrows the last error', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        'gone',
        async () => {
          calls++;
          throw new Error(`404 Not Found (attempt ${calls})`);
        },
        { tries: 4, baseMs: 1, onRetry: () => {} },
      ),
    // The error surfaced must be the LAST one, not the first: a fetch that fails 404 then
    // 500 should report the 500 the caller would see if they tried again now.
    /attempt 4/,
  );
  assert.equal(calls, 4, 'should attempt exactly `tries` times, not one more or fewer');
});

test('success on the first attempt costs no retries and no delay', async () => {
  let calls = 0;
  let retried = false;
  const result = await withRetry(
    'clean',
    async () => {
      calls++;
      return 42;
    },
    { baseMs: 10_000, onRetry: () => { retried = true; } },
  );

  assert.equal(result, 42);
  assert.equal(calls, 1);
  // baseMs is 10s here on purpose: if the happy path ever slept, this test would hang
  // rather than pass, which is the failure worth catching.
  assert.equal(retried, false);
});

test('backoff grows exponentially and the final failure does not sleep', async () => {
  const waits: number[] = [];
  await assert.rejects(() =>
    withRetry(
      'backoff',
      async () => {
        throw new Error('nope');
      },
      { tries: 4, baseMs: 100, onRetry: (_n, waitMs) => waits.push(waitMs) },
    ),
  );

  // Three waits for four attempts: sleeping after the last one would delay the error
  // without changing it.
  assert.deepEqual(waits, [100, 200, 400]);
});
