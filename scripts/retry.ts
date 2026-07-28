/**
 * Bounded retry with exponential backoff, for fetching corpora measured in gigabytes.
 *
 * A CDN closing the connection part-way through is normal at this scale — the first
 * 26-shard C4 download died on shard 9 with "other side closed", and the Pile fetch lost
 * test.jsonl.zst the same way. Without this, a multi-gigabyte download is only as long as
 * its unluckiest minute.
 *
 * Retries are bounded and reported, so a genuinely missing file still fails instead of
 * looping. `baseMs` exists so tests do not have to wait out real backoff.
 */
export type RetryOptions = {
  tries?: number;
  baseMs?: number;
  onRetry?: (attempt: number, waitMs: number, reason: string) => void;
};

export async function withRetry<T>(label: string, attempt: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const tries = options.tries ?? 5;
  const baseMs = options.baseMs ?? 2000;
  const onRetry =
    options.onRetry ??
    ((n: number, waitMs: number, reason: string) => {
      process.stdout.write(`      ${label}: ${reason} — retry ${n}/${tries - 1} in ${waitMs / 1000}s\n`);
    });

  let lastErr: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      // The last failure re-throws rather than sleeping: waiting after the final attempt
      // delays the error without changing it.
      if (i === tries) break;
      const waitMs = baseMs * 2 ** (i - 1);
      onRetry(i, waitMs, err instanceof Error ? err.message : String(err));
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}
