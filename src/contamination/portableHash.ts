/**
 * A content hash that works identically in Node and in a browser.
 *
 * Used for index identity and staleness detection — "is this index still the one built
 * from that benchmark" — not for security. Four independent FNV-1a lanes give 128 bits,
 * which is far more than enough to notice a changed benchmark and cheap enough to run
 * over every item at build time.
 *
 * Deliberately NOT cryptographic, and labelled so nobody later mistakes it for a
 * tamper-proof signature. Corpus attestation in the Node path uses real SHA-256.
 */

const SEEDS = [0x811c9dc5, 0x01000193, 0x9e3779b1, 0x85ebca6b];

export function portableHash(parts: Iterable<string>): string {
  const lanes = SEEDS.slice();

  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      const c = part.charCodeAt(i);
      for (let L = 0; L < lanes.length; L++) {
        lanes[L] ^= c + L;
        lanes[L] = Math.imul(lanes[L], 0x01000193);
      }
    }
    // Separator, so ["ab","c"] and ["a","bc"] hash differently.
    for (let L = 0; L < lanes.length; L++) {
      lanes[L] ^= 0xff;
      lanes[L] = Math.imul(lanes[L], 0x01000193);
    }
  }

  return lanes.map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}
