/**
 * Allocation-free tokenize-and-hash.
 *
 * Profiling a scan showed n-gram hashing was 84% of the time and index lookup only 2%.
 * The cost was not arithmetic: it was allocating a substring per token and then doing two
 * string-keyed Map lookups per token position to hash it. This scans the source string
 * once, computes each token's hash in place, and never materialises a token.
 *
 * Token boundaries are kept so evidence spans can be sliced from the original text, but
 * only when a hit occurs, which is rare.
 */

/** 1 where an ASCII code point may appear inside a token. Mirrors /[\p{L}\p{N}']/u for ASCII. */
const ASCII_TOKEN_CHAR = new Uint8Array(128);
for (let c = 48; c <= 57; c++) ASCII_TOKEN_CHAR[c] = 1; // 0-9
for (let c = 65; c <= 90; c++) ASCII_TOKEN_CHAR[c] = 1; // A-Z
for (let c = 97; c <= 122; c++) ASCII_TOKEN_CHAR[c] = 1; // a-z
ASCII_TOKEN_CHAR[39] = 1; // apostrophe

/** Non-ASCII decisions are cached; corpora are ASCII-dominant so this stays tiny in practice. */
const nonAsciiIsToken = new Map<number, boolean>();
const nonAsciiLower = new Map<number, number>();

function isTokenChar(code: number): boolean {
  if (code < 128) return ASCII_TOKEN_CHAR[code] === 1;
  const cached = nonAsciiIsToken.get(code);
  if (cached !== undefined) return cached;
  const ch = String.fromCodePoint(code);
  const value = /[\p{L}\p{N}]/u.test(ch);
  nonAsciiIsToken.set(code, value);
  return value;
}

function lowerCode(code: number): number {
  if (code < 128) return code >= 65 && code <= 90 ? code | 0x20 : code;
  const cached = nonAsciiLower.get(code);
  if (cached !== undefined) return cached;
  const lowered = String.fromCodePoint(code).toLowerCase();
  const value = lowered.length === 1 ? lowered.charCodeAt(0) : code;
  nonAsciiLower.set(code, value);
  return value;
}

/** Reused across documents so a scan does not churn the heap once per line. */
let hashBuf = new Uint32Array(4096);
let startBuf = new Uint32Array(4096);
let endBuf = new Uint32Array(4096);

function ensure(capacity: number): void {
  if (capacity <= hashBuf.length) return;
  let size = hashBuf.length;
  while (size < capacity) size *= 2;
  hashBuf = new Uint32Array(size);
  startBuf = new Uint32Array(size);
  endBuf = new Uint32Array(size);
}

export type HashedTokens = {
  /** FNV-1a of each lowercased token. Identical to tokenHash() over the same token. */
  hashes: Uint32Array;
  /** Character offsets into the source text, for slicing evidence spans lazily. */
  starts: Uint32Array;
  ends: Uint32Array;
  count: number;
};

/**
 * Hashes every token in `text` without allocating any of them.
 * The returned arrays are reused on the next call: read what you need before calling again.
 */
export function hashTokens(text: string): HashedTokens {
  // Upper bound on token count: a token needs at least one character, and tokens are
  // separated, so half the length plus one is always enough.
  ensure((text.length >> 1) + 2);

  let count = 0;
  let i = 0;
  const len = text.length;

  while (i < len) {
    let code = text.charCodeAt(i);
    if (!isTokenChar(code)) {
      i++;
      continue;
    }

    const start = i;
    let h = 0x811c9dc5;
    while (i < len) {
      code = text.charCodeAt(i);
      if (!isTokenChar(code)) break;
      h ^= lowerCode(code);
      h = Math.imul(h, 0x01000193);
      i++;
    }

    if (count >= hashBuf.length) ensure(count + 1);
    hashBuf[count] = h >>> 0;
    startBuf[count] = start;
    endBuf[count] = i;
    count++;
  }

  return { hashes: hashBuf, starts: startBuf, ends: endBuf, count };
}
