/**
 * The pure rules behind the registry's verdicts, in one importable place.
 *
 * leak-triage.ts and train-split-check.ts each carried private copies of this logic, which
 * meant the thresholds that decide what the registry publicly calls "leaked" had no tests:
 * importing a script executes it. The rules live here so the scripts and the test suite
 * read the same lines.
 *
 * On the thresholds: coverage alone is a trap the triage fell into on its first run. Every
 * flagged item has coverage of at least n/itemTokens BY CONSTRUCTION — that is what being
 * flagged means — so a 10-token gram is 53% of a 19-token item before any evidence of
 * leakage exists. Three short MMLU items were labelled "leaked" on exactly that floor
 * artifact. The verdicts therefore also require EXCESS: tokens matched beyond the n-gram
 * that triggered the flag, which is the part the flag did not already guarantee.
 */

export const LEAK = 0.5; // half the item or more, verbatim...
export const LEAK_EXCESS = 5; // ...and meaningfully past the flagging gram
export const PARTIAL = 0.25;
export const PARTIAL_EXCESS = 2;

export type Verdict = 'leaked' | 'partial' | 'phrase';

export function verdictFor(coverage: number, excess: number): Verdict {
  return coverage >= LEAK && excess >= LEAK_EXCESS
    ? 'leaked'
    : coverage >= PARTIAL && excess >= PARTIAL_EXCESS
      ? 'partial'
      : 'phrase';
}

/** Triage tokenizer: lowercase unicode word split — an approximation of the scanner's
 * tokenizer, fine for measuring runs of ordinary words. The scan that flags items uses
 * the real one. */
export const tokens = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Case- and whitespace-insensitive form for substring checks: formatting differs between
 * FLAN framings, words do not. */
export const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Longest common contiguous token run, classic DP. Items are short; documents are pages. */
export function longestRun(a: string[], b: string[]): number {
  let best = 0;
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : 0;
      if (cur[j] > best) best = cur[j];
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return best;
}

/**
 * JSONL lines with \n as the ONLY terminator.
 *
 * readline treats U+2028/U+2029 as line breaks; JSON permits both unescaped inside string
 * values, and the browser splits on \n alone. The same bytes therefore produced different
 * document counts on different surfaces until the scanner got a manual splitter (bug 13).
 * The triage scripts read corpora too, so they split the same way — with a streaming
 * decoder, because a chunk boundary can land inside a multi-byte character.
 */
export async function* jsonlLines(stream: AsyncIterable<Buffer | string>): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  for await (const chunk of stream) {
    buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      yield buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  }
  buf += decoder.decode();
  if (buf.length > 0) yield buf;
}
