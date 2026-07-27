# Ingot index format

An Ingot index answers one question: *does this n-gram appear in this benchmark, and in
which item?* It contains one-way hashes and item ids and **no benchmark text**, which is
why an index can be published for a benchmark whose licence forbids redistributing the
data.

This document specifies the format completely enough to write an independent implementation.
Read `docs/threat-model.md` before publishing an index — "no text" is not the same as "no
disclosure".

Two encodings carry the same data:

- **JSON** (`.idx.json`) — the reference form. Legible, diffable, and what this document
  describes semantically.
- **Binary** (`.idx.bin`, usually gzipped to `.idx.bin.gz`) — the wire form. Same content,
  about 3.6x smaller. MMLU is 19.4 MB as JSON and 5.35 MB this way.

An implementation that reads JSON is conformant. The binary form is worth supporting if you
serve indexes over a network.

---

## 1. Semantics

### 1.1 Tokenization

Text is tokenized into maximal runs of characters matching `[\p{L}\p{N}']`, each character
lowercased individually by `String.prototype.toLowerCase` on its own code point. Everything
else is a separator and is discarded.

Per-code-point lowercasing is normative and matters: lowercasing the whole string first
gives different tokens for code points that expand, such as U+0130 (`İ`), which lowercases
to two characters. An implementation that lowercases the string first will produce a
different index and will silently fail to match text containing those characters.

### 1.2 Token hash

FNV-1a, 32-bit, over the UTF-16 code units of the lowercased token:

```
h = 0x811c9dc5
for each code unit c of the token:
    h = (h XOR c) * 0x01000193   (mod 2^32)
return h as unsigned 32-bit
```

Multiplication is 32-bit with wraparound (`Math.imul` in JavaScript).

### 1.3 Gram key

An n-gram key is built from two independent polynomial rolling hashes over the token
hashes, modulo 2^32:

```
BASE_A = 0x01000193
BASE_B = 0x85ebca6b

hA = 0 ; hB = 0
for each of the n token hashes t:
    hA = (hA * BASE_A + t)  (mod 2^32)
    hB = (hB * BASE_B + t)  (mod 2^32)

key = hA * 2097152 + (hB >>> 11)
```

`key` is 53 bits: all 32 bits of lane A and the top 21 of lane B. 53 bits is the largest
integer JavaScript represents exactly, and the width is deliberate — every bit removed
multiplies the false-match rate, and a false match is the one failure this format exists
to avoid. See `docs/threat-model.md` for the arithmetic.

The rolling update, which makes a scan O(1) per token position:

```
hA = ((hA - t_out * BASE_A^(n-1)) * BASE_A + t_in)  (mod 2^32)
```

### 1.4 Which grams are indexed

For each benchmark item, in item order:

1. Grams are taken at every token offset `0, 1, 2, …`, except that when `stride > 1` only
   offsets where `offset % stride == 0` are kept. Position sampling, not hash sampling: it
   keeps the kept grams evenly spread, where hash sampling can leave whole passages
   uncovered by luck.
2. A gram whose every token is in the **stoplist** is dropped.
3. A gram already seen in this same item is dropped. A repeated phrase does not weigh more.
4. After all items, a gram owned by more than `maxItemsPerGram` items (default 3) is dropped
   entirely as boilerplate.

**Stoplist.** Derived from the benchmark, never a hardcoded English word list, so the format
works for code and non-English benchmarks. A token qualifies when it appears in at least 50%
of items **and** ranks in the top 200 by raw count. Both conditions are required: ranking by
count alone puts a small benchmark's entire vocabulary in the stoplist, which drops every
gram and reports zero contamination while looking like it worked. Skipped entirely below 4
items, where document frequency is not estimable. Stoplist membership is compared by token
hash.

### 1.5 Uncheckable items

An item with no surviving gram — shorter than `n` tokens, or entirely filtered — is listed
in `uncheckableItemIds`. Nothing can ever match those items.

**Reporting this is mandatory for a conformant implementation.** A benchmark of short items
otherwise yields "no contamination found" when part of it was never examined at all. At
n=13, 6.8% of a typical benchmark is unmatchable.

---

## 2. JSON form

```jsonc
{
  "formatVersion": 2,          // integer; readers MUST reject a version they do not know
  "benchmark": "mmlu",
  "benchmarkHash": "…",        // 32 hex chars, identity of the source benchmark
  "n": 10,
  "itemIds": ["mmlu-0", "…"],  // index i in this array is the item index used below
  "itemSubjects": ["anatomy", null],  // parallel to itemIds; null when absent
  "keys": [1234567890123, "…"],       // 53-bit gram keys
  "items": [[0], [3, 17], "…"],       // parallel to keys: item indices owning each gram
  "uncheckableItemIds": ["mmlu-9001"],
  "stats": {
    "itemCount": 14042,
    "gramsSeen": 812345,
    "gramsKept": 773421,
    "droppedStoplist": 0,
    "droppedNonDiscriminative": 3891,
    "droppedStride": 0,
    "stride": 1,
    "maxItemsPerGram": 3,
    "uncheckableItems": 28
  },
  "scannerVersion": "ingot-0.1.0"
}
```

**There is no build timestamp, deliberately.** An index is a pure function of its benchmark
and its build options, so the same inputs must produce the same bytes — which is what lets
anyone verify a published index by rebuilding it and comparing hashes. A `createdAt` field
made every rebuild show as a change and defeated exactly that. When a timestamp is needed
it belongs to the scan, not the index; identity here is `benchmarkHash`.

`keys` and `items` are parallel arrays of equal length. Order is not significant; readers
build a map.

**`benchmarkHash`** is four FNV-1a lanes over `id  text` of every item, joined, 128
bits rendered as 32 hex characters. It is deliberately not cryptographic: it exists to catch
a stale index, not a forger.

**Version handling is mandatory.** A reader encountering an unknown `formatVersion` must
fail loudly. Comparing against a stale index silently produces a wrong answer, which is
worse than producing none.

---

## 3. Binary form

Little-endian throughout. Byte offsets are from the start of the file.

### 3.1 Header, 32 bytes

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | magic, ASCII `INGOTIDX` |
| 8 | 4 | `codecVersion`, u32 — currently **1** |
| 12 | 4 | `metaLength`, u32 |
| 16 | 4 | `keyCount`, u32 |
| 20 | 4 | `flagsLength`, u32 — equals `ceil(keyCount / 8)` |
| 24 | 4 | `keyStreamLength`, u32 |
| 28 | 4 | `ownerStreamLength`, u32 |

Sections follow immediately, in this order, with no padding:

| Section | Length |
|---|---|
| meta | `metaLength` |
| flags | `flagsLength` |
| key stream | `keyStreamLength` |
| owner stream | `ownerStreamLength` |

`codecVersion` describes this byte layout; `formatVersion` inside the meta describes the
index semantics. They version independently, and a reader must check both.

### 3.2 Meta section

UTF-8 JSON: every field of the JSON form **except** `keys` and `items`. It stays JSON
because it is small, compresses well, and remains legible in a hex dump.

Note that JSON has no `undefined`: an item with no subject is written `null` and must be
read back as absent.

### 3.3 Flags section

A bitmap, one bit per key, in key order. Bit `i` lives in byte `i >> 3` at position
`i & 7`, counting from the least significant bit.

Set means "this gram is owned by more than one item". About 95% of grams have exactly one
owner, so the bitmap lets the common case skip storing a count.

### 3.4 Key stream

Keys **sorted ascending**, stored as varint deltas. The first delta is from 0.

```
previous = 0
for i in 0 .. keyCount-1:
    key[i] = previous + readVarint()
    previous = key[i]
```

Sorting is what makes the deltas small. For uniformly distributed 53-bit keys the
information floor is about `log2(2^53 / keyCount) + 1.44` bits each; delta varints land
within about 15% of it.

### 3.5 Owner stream

Read in key order, in lockstep with the flags bitmap:

```
for i in 0 .. keyCount-1:
    first = readVarint()
    if flag(i) is clear:
        owners[i] = [first]
    else:
        extra = readVarint()
        owners[i] = [first]
        running = first
        repeat extra times:
            running += readVarint()
            owners[i].append(running)
```

Owners are item indices into `itemIds`, ascending, delta-encoded after the first.

### 3.6 Varints

LEB128, unsigned, little-endian groups of seven bits, high bit set on every byte but the
last.

```
write(v):  while v >= 128: emit((v mod 128) + 128); v = floor(v / 128)
           emit(v)

read():    result = 0; scale = 1
           repeat: b = nextByte(); result += (b AND 127) * scale; scale *= 128
           until b < 128
           return result
```

**Values reach 2^53.** Implementations must not use 32-bit shift operators here.
JavaScript's `>>` and `<<` truncate silently to 32 bits and will corrupt every large key —
hence the division and multiplication above.

### 3.7 Compression

Published indexes are gzipped, conventionally named `.idx.bin.gz`. Whether a `.gz` file
arrives compressed depends on the host: some serve the bytes as they are, others set
`Content-Encoding` and the client has already unwrapped them.

**Readers should sniff rather than assume**: decompress only when the first two bytes are
`0x1f 0x8b`. A wrong guess reads as a corrupt index.

---

## 4. Conformance

An implementation is conformant when, for the same benchmark and the same corpus, it
produces the same set of `(benchmarkItemId, corpusDocId)` matches as the reference.

`test/index-codec.test.ts` is the reference test suite. The properties worth reproducing:

- a round trip through the binary form changes nothing, including keys past 2^45
- grams owned by several items keep every owner
- a file that is not an index is refused rather than misread
- an index from an unknown codec or format version is refused, not misparsed
- gzip round trips, and already-decompressed bytes are left alone

---

## 5. Version history

| formatVersion | Change |
|---|---|
| 3 | Removed `createdAt`, making an index byte-reproducible from its inputs |
| 2 | Added `stride` and `droppedStride` to `stats` |
| 1 | Initial |

| codecVersion | Change |
|---|---|
| 1 | Initial binary layout |
