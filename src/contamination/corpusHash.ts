/**
 * Corpus identity, computed identically in Node and in a browser.
 *
 * Hashing every byte would mean holding the corpus, and the browser's SubtleCrypto has no
 * streaming digest, so the hash is taken over a deterministic sample: the first 64 lines,
 * every thousandth line after that, and the exact line and byte counts. Changing any
 * sampled line, adding a line, or changing the length changes the hash.
 *
 * What it is for: binding a report to the bytes that produced it, so re-scanning detects a
 * changed corpus. What it is not for: resisting someone who edits their corpus to keep the
 * hash. That is a real limitation and it is written down in docs/threat-model.md rather
 * than implied away. The Node path also records a full SHA-256 over every line, which does
 * resist that, and reports both.
 *
 * The sampling rule lives here, in one place, because a browser scan and a command-line
 * scan of the same file must produce the same identity or the two reports cannot be
 * compared at all.
 */

const HEAD_LINES = 64;
const SAMPLE_EVERY = 1000;

export class CorpusHasher {
  private readonly sample: string[] = [];
  private lines = 0;

  /** Call once per non-empty, trimmed corpus line, in file order. */
  add(line: string): void {
    this.lines++;
    if (this.lines <= HEAD_LINES || this.lines % SAMPLE_EVERY === 0) this.sample.push(line);
  }

  get lineCount(): number {
    return this.lines;
  }

  async digest(bytes: number): Promise<string> {
    const parts = [...this.sample, `lines:${this.lines}`, `bytes:${bytes}`];
    return sha256Hex(parts.join('\n'));
  }
}

/**
 * Uses the Web Crypto global, which Node has had since 18. node:crypto would be faster
 * here and is not importable from the browser bundle — that swap broke the build once.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
