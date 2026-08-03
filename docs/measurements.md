# Measurements

Every number Ingot publishes, how it was measured, and how to get it yourself. Where a
measurement was wrong first, that is recorded too — a tool that audits other people's
claims has no standing to hide its own corrections.

```bash
node --test test/*.test.ts             # guards, one per defect below
node scripts/contamination-validate.ts # planted recall, false positives, n sweep
node scripts/bench-scan.ts             # throughput
node scripts/fetch-benchmarks.ts
node scripts/registry-scan.ts          # the public registry
```

## Throughput

The number that answers "how long will my scan take", measured on a real corpus rather
than extrapolated from a kernel:

```
  7.0 MB/sec single-threaded, end to end  →  20 GB in about 48 minutes
```

21.4 GB of gzipped C4 shards on disk, GSM8K at n=10, 51 minutes wall clock. Decompression,
line splitting, `JSON.parse`, corpus hashing and match bookkeeping all included, because a
user pays for all of them. Reproduce with `node scripts/pretraining-scan.ts`.

For comparison, lm-evaluation-harness indexes the corpus rather than the benchmark and
reports nine days on the Pile. Ingot indexes the benchmark, which fits in RAM, and
streams the corpus once.

### The scan kernel, and the claim it should not have become

```
  phase                       best ms  delta ms       tok/sec
  ───────────────────────────────────────────────────────────
  A baseline (loop only)            1
  B fused tokenize/hash           718       717    13,929,351
  C + ngram rolling              2038      1320     4,907,396
  D + index lookup (full)        2243       205     4,458,883

  37.1 MB/sec, kernel only
```

83.3 MB / 10.0M tokens, three repetitions, best of, corpus held in memory so the figure
is CPU rather than disk. Reproduce with `node scripts/bench-scan.ts`.

**This figure was published as `37.1 MB/sec → 20 GB in 9.0 minutes`, and that extrapolation
was wrong by about 5x.** The measurement is sound and the caveat was even stated — corpus
in memory, CPU not disk — but stating a caveat is not the same as honouring it. Phase D
covers tokenize, roll, look up. A scan also decompresses, splits lines, parses JSON, hashes
the corpus twice and records matches, and those are the majority of the wall clock.

`scripts/bench-pipeline.ts` measures the whole path, one stage added at a time so the
deltas attribute cost instead of inferring it. On one C4 shard the kernel is roughly half
of end-to-end time, and I/O with parsing is most of the rest.

The lesson is not "measure more". It is that a benchmark built to guide optimisation
answers a different question from the one a reader asks, and the caveat that made it
honest in context disappeared the moment the number was quoted on a front page. Same shape
as the fixture defects below: a number that was correct about something nobody was asking.

### Two wrong optimizations, and the ruler that caused them

Scanning started at 859k tokens/sec, roughly 10x short of the target.

**The first guess was wrong.** The tokenizer looked like the obvious cost. Profiling said
tokenizing was 9% and n-gram hashing 84% — 9,134ms of 10,810ms. The real cost was
allocating a substring per token and then doing two string-keyed `Map` lookups per token
position to hash it. Fusing tokenization and hashing into one pass that never
materialises a token string took that stage from 9,134ms to roughly 200ms.

**The second guess was measurement noise.** With hashing fixed, index lookup appeared to
be 48% of what remained, so it was replaced with an open-addressing table over typed
arrays. The replacement measured *slower*. Then the original `Map` measured slower than
itself on a rerun: 903ms and 3,290ms for the same code path on consecutive runs. Every
conclusion drawn in that range was noise.

**The fix was to the ruler, not the code.** The harness now reads the corpus into memory
once, times pure CPU across three repetitions, and reports the minimum, because
interference only ever adds time. Against a stable ruler, index lookup is 205ms — 9%, not
48%. The typed-array table had been replacing something that was never slow. The revert
was correct for a reason only visible after fixing the benchmark.

The remaining cost is the rolling loop at 59%, most of it 10M closure invocations, which
is where further work should go.

An unstable benchmark does not merely fail to help. It produces confident wrong decisions.

## The n sweep: 13 is a poor default

A 1,000-item benchmark drawn from alpaca, 300 of those items planted in 6,000 dolly
documents, verbatim and again with roughly one word in eleven dropped and the occasional
filler word inserted. Full output in `results/contamination-validation.json`.

| n | verbatim recall | edited-copy recall | false positives | unscannable items |
|---|---|---|---|---|
| 8 | 100% | 90.9% | 5 / 1000 | 2 / 1000 |
| 9 | 100% | 85.9% | 3 / 1000 | 2 / 1000 |
| **10** | **100%** | **81.5%** | **2 / 1000** | **3 / 1000** |
| 11 | 100% | 79.7% | 1 / 1000 | 31 / 1000 |
| 12 | 100% | 75.0% | 0 | 57 / 1000 |
| 13 | 100% | 69.6% | 0 | 68 / 1000 |

Everyone uses 13-gram matching because GPT-3 (Brown et al., 2020) used it. We could find
no systematic re-derivation since. Two things separate the values of n:

- **Unscannable items.** n=13 leaves 6.8% of the benchmark unscannable, because an item
  shorter than 13 tokens produces no 13-grams and nothing can ever match it. At n=10 that
  is 0.3%. This is structural, not statistical, and it is the stronger argument.
- **Edited copies.** 81.5% at n=10 against 69.6% at n=13. With 300 planted items the
  standard error is about 2.3 points, so a 12-point gap is real, and the curve falls
  monotonically with n as it should.

The cost of n=10 is two false positives per thousand items, against zero at n=13 — and
both are inspectable, because every hit displays its matching text.

### The first version of this table was wrong

It reported 100% at n=10 against 3.5% at n=13, and that gap was an artifact of the test
fixture rather than a property of n.

The perturbation dropped word *i* whenever `i % 11 == 0`, which puts every deletion on the
same lattice in every item. Deletions at 11, 22, 33 … mean a 10-gram at offset 0 spans
tokens 0-9 and can never be touched, while a 13-gram at offset 0 spans 0-12 and is always
broken. Measured directly on that fixture: the offset-0 gram survived for 60 of 60 items at
n=10 and 0 of 60 at n=13. The sweep was reporting the phase of the deletion pattern.

The fix is independent draws at the same rate, which removes the lattice. The planted
sample also went from 60 items to 300, because at 60 the standard error is about 5 points
and adjacent values of n differ by less than that — the old table was ranking noise.

Same class of defect as the seeded corpus generator that manufactured 26 false positives.
Both were fixtures with a constant step, and both produced confident, wrong, publishable
numbers.

Caveats, stated first: one corpus pair, both 2023-era, and edited copies are simulated by
random word dropping rather than a model rewriting the text. Real paraphrase will be
harder than this.

## Index size against recall

A published index is a download that happens before anyone sees a result, so its size is a
product decision. Keeping one gram in every `stride` positions shrinks it in proportion.
Measured at n=10 on the same fixture:

| stride | grams | index (gzipped) | verbatim | edited copies | false positives |
|---|---|---|---|---|---|
| **1** | 53,023 | 358 KB | 100% | 81.5% | 2 |
| 2 | 26,788 | 187 KB | 100% | 80.5% | 2 |
| 3 | 18,016 | 129 KB | 100% | 78.1% | 1 |
| 4 | 13,667 | 99 KB | 100% | 77.4% | 2 |
| 6 | 9,261 | 70 KB | 100% | 74.4% | 1 |
| 8 | 7,086 | 55 KB | 100% | 69.4% | 1 |

Verbatim recall is unaffected at every stride, because a whole copied item contains all of
its grams and only one of them has to be kept. Recall on edited copies falls, slowly at
first: halving the index costs about one point.

**Published indexes ship at stride 1 anyway.** A smaller index that detects slightly less
would make the website and the command line disagree, and "the same code gives the same
numbers" is worth more than 2 MB. The lever is documented and measured for anyone
publishing their own.

## The wire format

The JSON form of an index is the specification and stays legible, but it costs about 25
bytes per gram — a 53-bit key printed as sixteen decimal digits, plus punctuation.

| benchmark | grams | JSON | binary, gzipped | load |
|---|---|---|---|---|
| humaneval | 10,277 | 0.23 MB | 0.07 MB | 27 ms |
| gsm8k | 49,866 | 1.17 MB | 0.35 MB | 13 ms |
| mmlu | 773,421 | 19.37 MB | 5.35 MB | 277 ms |

Three things do the work: keys are sorted and delta-encoded as varints; a bitmap marks the
5% of grams owned by more than one benchmark item, so the rest do not pay for a count; and
everything small stays JSON, which compresses well.

Sorted uniform 53-bit keys have an information floor near 4.36 bytes each — log2(2^53 /
count) plus about 1.44 bits — and the delta varints land at 5.03. Closing that last 15%
would mean bit-packing; shortening the hash would close much more, and would trade download
size for false matches, which is not a trade an audit tool can make.

## Defects found by measurement

Each one is now a guard in the code and a test under `test/`.

1. **Baseline calibrated at the wrong batch size.** Near-duplicate rate and type-token
   ratio move with batch size regardless of provenance. Size-sensitive signals now decline
   when the batch is more than 2x off the calibration size, and say so.
2. **Sequential baseline chunks measured topic, not provenance.** Public corpora arrive
   grouped by category, so clean human batches came back with a 60% false positive rate.
   Fixed with seeded random subsampling.
3. **Positional corpus split.** Halves split by position had different task mixes, so
   clean batches scored 60 instead of ~100. `splitCorpus()` now shuffles deterministically
   first, with the same seed in the baseline builder and the experiment.
4. **Zero variance read as infinite separating power.** Near-duplicate rate went to exactly
   0 in both references; the code divided by zero and produced NaN purity on every row.
   Zero reference variance means the statistic is pinned at a floor, not that it
   discriminates. Both references must now show non-zero variance, and a non-finite
   aggregate raises instead of printing.
5. **Silent extrapolation.** Lexical cluster tightness sat 4.84σ from the human reference
   while the two references were only 1.24σ apart. The score clamped it to "fully machine"
   and dragged a clean human batch to 34/100. A batch outside the interval the references
   span is unlike *both*. The scorer now refuses to extrapolate more than 50% past either
   end and reports the σ distance instead.
6. **Hand-assigned signal weights.** Weights came from strength labels guessed before any
   data existed; measured separation ranged from 0.00σ to 6.31σ. Signals are now weighted
   by measured separation, which is their signal-to-noise ratio.
7. **A curve read off single draws.** One draw per contamination level produced a
   non-monotonic curve that invited over-interpretation. Five draws per level now, reported
   as mean ± standard deviation. The noise was always there; now it is visible.
8. **The confound found last.** Dolly and Alpaca do not share prompts, so part of the
   measured separation is task distribution rather than provenance. A design flaw rather
   than a code bug, and the reason the provenance detection floor is 50%.
9. **Optimised the wrong thing, twice** — above.
10. **The scanner silently skipped items it could never match.** The validation harness
    failed on its first run at 95% recall. Three of sixty planted items were 10 tokens
    long, and at n=13 a 10-token item produces no 13-grams, so nothing could ever match
    them. Not a scanner bug but a structural limit, and a silent failure of exactly the
    kind this project exists to prevent. The index now tracks every item with no surviving
    n-gram, and every report names them. Recall is measured over checkable items with the
    uncheckable count beside it, never folded in.
11. **The paraphrase fixture deleted words on a lattice** — above. It made the project's
    headline finding look four times larger than it is.
12. **The registry's first findings were all false positives.** Six n=10 findings, every
    one canonical text: prime and digit sequences, "I Have a Dream", a stock definition of
    capitalism. The discriminative filter drops grams shared across many *benchmark* items
    but could not tell that a gram is ubiquitous in ordinary writing. A corpus-side
    document-frequency filter was added and did not fire, which is itself the finding —
    these phrases appear in two or three documents of a 26k corpus, below any sane
    threshold, while still being everywhere in English. Independence across corpora turned
    out to be the stronger signal, and it sharpens with every corpus added.

13. **The frequency filter judged a run by the first sixteen grams it met.** A run kept its
    first sixteen gram keys and picked the rarest among them, under a comment claiming that
    was "enough to find the rarest". For a verbatim copy that opens with common phrasing and
    turns distinctive later, all sixteen are ordinary, and the entire passage was discarded
    as ordinary language — silently, because a correct drop and this drop are the same
    output. The rarer the opening, the more likely the copy is real, so the sampling failed
    hardest on the adversarial case it was there to survive. It is now exact rather than a
    larger sample, on a one-way property: document frequencies only grow, so a gram already
    past the drop threshold when it is seen can never become the gram that saves the run and
    is discarded on sight instead of taking a slot. What remains is every gram that could
    still matter. A running minimum would have been cheaper and wrong — keeping only the
    rarest gram *at capture* loses the run when that gram later turns common while a
    discarded sibling stays rare, trading one false negative for another.

    Found by review rather than by measurement, which is the uncomfortable part: nothing in
    any output distinguished it, and both the validation harness and a two-shard C4 spot
    pass reproduce identically before and after the fix — same 57 MMLU items, same 10
    discards, no difference in which items were found. A defect that moves no number is
    invisible to every gate this repository has, and the only thing that catches it is
    someone reading the comment and disbelieving it.

Also fixed along the way: a TypeScript parameter property unsupported by Node's strip-only
mode; a CLI arg parser that swallowed the batch path as a command; a test asserting a
variance message on signals that had no baseline at all.

## Provenance: the honest floor

The provenance scanner's detection floor is 50% contamination, with a 13% false positive
rate at a purity threshold of 85. Reference pair, measured curve and the four known
reasons the floor is that high are in the README and `results/spike.json`.

Contamination scanning leads the product because it is not inference. A shared n-gram is
a fact you can display side by side; authorship is a statistical claim about a
distribution.
