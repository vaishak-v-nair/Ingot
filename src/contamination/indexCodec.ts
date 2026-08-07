import { INDEX_FORMAT_VERSION } from './types.ts';
import { IndexTruncatedError, IndexUnreadableError, IndexVersionError } from '../errors.ts';
import type { NgramIndexData } from './types.ts';

/**
 * A compact wire format for published indexes.
 *
 * The JSON form is the specification and stays readable, but it costs roughly 25 bytes per
 * gram: a 53-bit key printed as sixteen decimal digits, plus punctuation. MMLU is 773,421
 * grams, which is 19.4 MB, and a 19.4 MB download in front of a scan that takes two seconds
 * is the whole first impression.
 *
 * Three things do the work here:
 *
 *   1. Keys are sorted and delta-encoded. Sorted uniform 53-bit keys have an information
 *      floor near 34.6 bits each — log2(2^53 / count) plus about 1.44 — and delta varints
 *      land within a few percent of it. Storing the keys themselves cannot do much better
 *      without shortening the hash, which would trade download size for false matches, and
 *      a false match in an audit tool is the one thing not for sale.
 *   2. 95% of grams belong to exactly one benchmark item, so a bitmap marks the exceptions
 *      instead of every gram paying for a count.
 *   3. Everything small — item ids, subjects, stats — stays JSON, because it compresses
 *      well and stays legible in a hex dump.
 *
 * Gzip is applied separately, through CompressionStream, which exists in both Node and the
 * browser. Nothing here imports node:zlib: this module is in the browser bundle, and a
 * Node-only import in the bundle has broken the build before.
 */

const MAGIC = 'INGOTIDX';
export const CODEC_VERSION = 1;

class ByteWriter {
  private buf: Uint8Array;
  private len = 0;

  constructor(initial = 1 << 16) {
    this.buf = new Uint8Array(initial);
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let next = this.buf.length * 2;
    while (next < this.len + extra) next *= 2;
    const grown = new Uint8Array(next);
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
  }

  byte(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v;
  }

  bytes(src: Uint8Array): void {
    this.ensure(src.length);
    this.buf.set(src, this.len);
    this.len += src.length;
  }

  u32(v: number): void {
    this.ensure(4);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = (v >>> 16) & 0xff;
    this.buf[this.len++] = (v >>> 24) & 0xff;
  }

  /**
   * LEB128 over division rather than bit shifts. Keys run to 2^53 and JavaScript's bitwise
   * operators silently truncate to 32 bits, which would corrupt every large key.
   */
  varint(v: number): void {
    while (v >= 128) {
      this.byte((v % 128) + 128);
      v = Math.floor(v / 128);
    }
    this.byte(v);
  }

  finish(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

class ByteReader {
  private pos = 0;
  private readonly buf: Uint8Array;

  // Written out rather than a parameter property: Node's strip-only mode does not support
  // those, and this file has to run without a build step.
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  // Every read is bounds-checked. Past-the-end reads on a Uint8Array yield undefined,
  // and undefined & 127 is 0 — so a truncated buffer used to decode into a silently
  // SMALLER index whose remaining keys collapsed into duplicates: the scan then reported
  // clean over grams it never held. That is the silent-zero failure this project forbids.
  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new IndexTruncatedError(
        `index data ends at byte ${this.buf.length}, read needs ${this.pos + n}`,
      );
    }
  }

  u32(): number {
    this.need(4);
    const v =
      this.buf[this.pos] |
      (this.buf[this.pos + 1] << 8) |
      (this.buf[this.pos + 2] << 16) |
      (this.buf[this.pos + 3] << 24);
    this.pos += 4;
    return v >>> 0;
  }

  take(n: number): Uint8Array {
    this.need(n);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  varint(): number {
    let result = 0;
    let scale = 1;
    let b: number;
    do {
      this.need(1);
      b = this.buf[this.pos++];
      result += (b & 127) * scale;
      scale *= 128;
    } while (b >= 128);
    return result;
  }

  get offset(): number {
    return this.pos;
  }

  seek(to: number): void {
    this.pos = to;
  }
}

type MetaFields = Omit<NgramIndexData, 'keys' | 'items'>;

export function encodeIndex(data: NgramIndexData): Uint8Array {
  // Sort by key so the deltas are small. The Map that consumes them does not care about
  // order, so this costs nothing at load time.
  const order = data.keys.map((_, i) => i).sort((a, b) => data.keys[a] - data.keys[b]);

  const meta: MetaFields = {
    formatVersion: data.formatVersion,
    benchmark: data.benchmark,
    benchmarkHash: data.benchmarkHash,
    n: data.n,
    itemIds: data.itemIds,
    itemSubjects: data.itemSubjects,
    uncheckableItemIds: data.uncheckableItemIds,
    // JSON.stringify drops an undefined value, so an index with nothing to report encodes
    // byte-for-byte as it did before this field existed.
    unsegmentedItemIds: data.unsegmentedItemIds,
    itemNoun: data.itemNoun,
    stats: data.stats,
    scannerVersion: data.scannerVersion,
  };
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));

  const count = order.length;
  const flags = new Uint8Array(Math.ceil(count / 8));
  const keyStream = new ByteWriter(count * 5);
  const ownerStream = new ByteWriter(count * 3);

  let previous = 0;
  for (let i = 0; i < count; i++) {
    const idx = order[i];
    const key = data.keys[idx];
    keyStream.varint(key - previous);
    previous = key;

    const owners = data.items[idx].slice().sort((a, b) => a - b);
    ownerStream.varint(owners[0]);
    if (owners.length > 1) {
      flags[i >> 3] |= 1 << (i & 7);
      ownerStream.varint(owners.length - 1);
      for (let k = 1; k < owners.length; k++) ownerStream.varint(owners[k] - owners[k - 1]);
    }
  }

  const keyBytes = keyStream.finish();
  const ownerBytes = ownerStream.finish();

  const out = new ByteWriter(
    64 + metaBytes.length + flags.length + keyBytes.length + ownerBytes.length,
  );
  for (let i = 0; i < MAGIC.length; i++) out.byte(MAGIC.charCodeAt(i));
  out.u32(CODEC_VERSION);
  out.u32(metaBytes.length);
  out.u32(count);
  out.u32(flags.length);
  out.u32(keyBytes.length);
  out.u32(ownerBytes.length);
  out.bytes(metaBytes);
  out.bytes(flags);
  out.bytes(keyBytes);
  out.bytes(ownerBytes);
  return out.finish();
}

export function decodeIndex(bytes: Uint8Array): NgramIndexData {
  const reader = new ByteReader(bytes);
  const magic = String.fromCharCode(...reader.take(MAGIC.length));
  if (magic !== MAGIC) {
    // A named error rather than a bare one: this is the branch a saved HTML error page or
    // a half-finished download lands in, and it reaches a user on both surfaces.
    throw new IndexUnreadableError('this file', `expected the magic ${MAGIC}, found ${JSON.stringify(magic)}`);
  }
  const codecVersion = reader.u32();
  if (codecVersion !== CODEC_VERSION) {
    throw new IndexVersionError(codecVersion, CODEC_VERSION);
  }

  const metaLength = reader.u32();
  const count = reader.u32();
  const flagsLength = reader.u32();
  const keyLength = reader.u32();
  const ownerLength = reader.u32();

  // The header promises an exact total. Checking it up front turns "truncated in
  // transit" into a named refusal before a single gram is decoded.
  const expectedTotal = reader.offset + metaLength + flagsLength + keyLength + ownerLength;
  if (bytes.length !== expectedTotal) {
    throw new IndexTruncatedError(
      `index header promises ${expectedTotal} bytes, file has ${bytes.length}`,
    );
  }

  const meta = JSON.parse(new TextDecoder().decode(reader.take(metaLength))) as MetaFields;
  if (meta.formatVersion !== INDEX_FORMAT_VERSION) {
    throw new IndexVersionError(meta.formatVersion, INDEX_FORMAT_VERSION);
  }
  // JSON has no undefined: an item with no subject is written as null and would come back
  // as null, so a decoded index would not equal the one that was encoded. Harmless in the
  // scan path and exactly the kind of small drift that makes two builds disagree later.
  meta.itemSubjects = meta.itemSubjects.map((s) => s ?? undefined);

  const flags = reader.take(flagsLength);
  const keysAt = reader.offset;
  const ownersAt = keysAt + keyLength;

  const keys = new Array<number>(count);
  const items = new Array<number[]>(count);

  const keyReader = new ByteReader(bytes);
  keyReader.seek(keysAt);
  const ownerReader = new ByteReader(bytes);
  ownerReader.seek(ownersAt);

  let previous = 0;
  for (let i = 0; i < count; i++) {
    previous += keyReader.varint();
    keys[i] = previous;

    const first = ownerReader.varint();
    if ((flags[i >> 3] & (1 << (i & 7))) === 0) {
      items[i] = [first];
    } else {
      const extra = ownerReader.varint();
      const owners = new Array<number>(extra + 1);
      owners[0] = first;
      let running = first;
      for (let k = 1; k <= extra; k++) {
        running += ownerReader.varint();
        owners[k] = running;
      }
      items[i] = owners;
    }
  }

  // Both streams must land exactly on their declared boundaries: a short landing means
  // keys collapsed into duplicates somewhere upstream, and the Map would silently absorb
  // the collision.
  if (keyReader.offset !== keysAt + keyLength || ownerReader.offset !== ownersAt + ownerLength) {
    throw new IndexTruncatedError(
      `index streams misaligned: keys ended at ${keyReader.offset} of ${keysAt + keyLength}, ` +
        `owners at ${ownerReader.offset} of ${ownersAt + ownerLength}`,
    );
  }

  return { ...meta, keys, items };
}

/** Present in Node 18+ and every current browser, so one code path serves both. */
async function through(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const blob = new Blob([bytes as BlobPart]);
  const piped = blob.stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

export function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new CompressionStream('gzip'));
}

/**
 * Decompresses only when the gzip magic is present.
 *
 * Whether a `.gz` file arrives compressed depends on the host: some serve the bytes as
 * they are, others set Content-Encoding and the browser has already unwrapped them.
 * Sniffing removes the guess, and a wrong guess here reads as a corrupt index.
 */
export function gunzipIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return Promise.resolve(bytes);
  return through(bytes, new DecompressionStream('gzip'));
}
