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

```
  phase                       best ms  delta ms       tok/sec
  ───────────────────────────────────────────────────────────
  A baseline (loop only)            1
  B fused tokenize/hash           718       717    13,929,351
  C + ngram rolling              2038      1320     4,907,396
  D + index lookup (full)        2243       205     4,458,883

  37.1 MB/sec CPU, single-threaded  →  20 GB in 9.0 minutes
```

83.3 MB / 10.0M tokens, three repetitions, best of, corpus held in memory so the figure
is CPU rather than disk. Reproduce with `node scripts/bench-scan.ts`.

For comparison, lm-evaluation-harness indexes the corpus rather than the benchmark and
reports nine days on the Pile. Ingot indexes the benchmark, which fits in RAM, and
streams the corpus once.

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

1,000 alpaca items planted in 6,000 dolly documents, verbatim and again with one word in
eleven dropped. Full output in `results/contamination-validation.json`.

| n | verbatim recall | paraphrase recall | false positives | unscannable items |
|---|---|---|---|---|
| 8 | 100% | 100% | 5 / 1000 | 2 / 1000 |
| 9 | 100% | 100% | 3 / 1000 | 2 / 1000 |
| **10** | **100%** | **100%** | **2 / 1000** | **3 / 1000** |
| 11 | 100% | 98.2% | 1 / 1000 | 31 / 1000 |
| 12 | 100% | 8.8% | 0 | 57 / 1000 |
| 13 | 100% | 3.5% | 0 | 68 / 1000 |

Everyone uses 13-gram matching because GPT-3 (Brown et al., 2020) used it. We could find
no systematic re-derivation since. Dropping one word in eleven changes no meaning and
defeats n=13 96.5% of the time, and n=13 leaves 6.8% of the benchmark unscannable because
items shorter than 13 tokens produce no 13-grams at all.

n=10 matches n=13 on verbatim recall, is 28x better on edited copies, and scans 20x more
of the benchmark, for two false positives per thousand items — both inspectable, because
every hit displays its matching text.

Caveats, stated first: one corpus pair, both 2023-era, and paraphrase is simulated by
deterministic word dropping rather than a model rewriting the text. Real paraphrase will
be harder than this. The direction is not subtle, but the constant is not settled either.

## Defects found by measurement

Each one is now a guard in the code and a test in `test/guards.test.ts`.

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
11. **The registry's first findings were all false positives.** Six n=10 findings, every
    one canonical text: prime and digit sequences, "I Have a Dream", a stock definition of
    capitalism. The discriminative filter drops grams shared across many *benchmark* items
    but could not tell that a gram is ubiquitous in ordinary writing. A corpus-side
    document-frequency filter was added and did not fire, which is itself the finding —
    these phrases appear in two or three documents of a 26k corpus, below any sane
    threshold, while still being everywhere in English. Independence across corpora turned
    out to be the stronger signal, and it sharpens with every corpus added.

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
