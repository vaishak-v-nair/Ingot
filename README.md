# Ingot

**Is the benchmark you are quoting inside the data you trained on?**

Ingot answers that with evidence rather than a score: it shows the matching text, side by
side with its surroundings, so you can judge each match yourself. It runs on your machine —
in a browser tab or on the command line — and nothing is uploaded, because there is nowhere
to upload it to.

```bash
npx @ingot/scan contaminate --index gsm8k --corpus your-corpus.jsonl
```

No clone, no benchmark download, no account. Or open the web scanner, drop a file, and
watch the network panel stay empty.

Apache-2.0. Zero runtime dependencies: Node 24 executes the TypeScript directly, with no
build step and nothing installed at scan time.

## Read this before the numbers

- **Exact matching only.** Paraphrased contamination is not counted and is invisible to the
  headline. On lightly edited copies, recall is 81.5% at n=10 and falls as n grows — and
  that is against random word dropping, not against someone deliberately rewriting.
- **A match is not a verdict.** Canonical text with one natural phrasing looks exactly like
  leakage in any count. Every one of the first six registry findings turned out to be
  canonical — prime sequences, the ten digits, "I Have a Dream". Only reading the words
  tells you which it is, which is why Ingot always shows them.
- **It does not stop a determined vendor.** Anyone can run Ingot on their own corpus, see
  what matched, and edit until nothing does. `docs/threat-model.md` says so plainly.
- **The provenance scanner's detection floor is 50% contamination**, with a 13% false
  positive rate. That is not a good number yet, and the four reasons are below.

## What it does

Ingot indexes the **benchmark** and streams the corpus once. lm-evaluation-harness does the
reverse, indexing the corpus, and reports nine days on the Pile.

```
  37.1 MB/sec CPU, single-threaded  →  20 GB in 9.0 minutes
```

83.3 MB / 10.0M tokens, three repetitions, best of, corpus held in memory so the figure is
CPU rather than disk. Reproduce with `node scripts/bench-scan.ts`.

Published indexes carry **one-way hashes and item ids, never benchmark text**, so an index
can be distributed for a benchmark whose licence forbids redistributing the data — and a
user checks their corpus without downloading the benchmark at all. MMLU is 5.35 MB and
loads in under a second.

Every report ends with a **receipt**: scanner version, index format, benchmark identity
hash, n, stride, gram count, corpus name, size, document count, corpus hash, and the exact
command. A third party reproduces any published number from it without asking us for
anything.

Both surfaces produce the same **self-contained HTML report** — `--out report.html` on the
command line, a download button in the browser. No scripts, no external requests: it opens
from an email attachment on a machine with no network, which is the point of an artifact
you can hand to a reviewer.

## Quickstart

`gsm8k` and `humaneval` ship with the package, so this needs nothing else:

```bash
npx @ingot/scan contaminate --index gsm8k --corpus mine.jsonl
```

Corpus format is JSONL, one record per line. The text field is auto-detected as `text`,
`response`, `output`, `completion`, `answer` or `content`, or pass `--text-field`. `--index`
also takes a path to any published `.idx.bin.gz`, which is how MMLU and anything you build
yourself are used.

From a clone, with no install step at all:

```bash
node --test test/*.test.ts        # 44 tests, one per defect found so far

node scripts/fetch-benchmarks.ts  # public benchmarks, normalised
node scripts/build-web.ts         # browser bundle + publishable indexes
npx --yes serve web               # the scanner, at the root URL

node src/cli.ts contaminate --index web/indexes/mmlu.idx.bin.gz --corpus mine.jsonl
```

## The n sweep: 13 is a poor default

Everyone matches on 13-grams because GPT-3 (Brown et al., 2020) used it. We could find no
systematic re-derivation since. Running 8 through 13 on a 1,000-item benchmark with 300
items planted in 6,000 documents, verbatim and again with roughly one word in eleven
dropped:

| n | verbatim recall | edited-copy recall | false positives | unscannable items |
|---|---|---|---|---|
| 8 | 100% | 90.9% | 5 / 1000 | 2 / 1000 |
| 9 | 100% | 85.9% | 3 / 1000 | 2 / 1000 |
| **10** | **100%** | **81.5%** | **2 / 1000** | **3 / 1000** |
| 11 | 100% | 79.7% | 1 / 1000 | 31 / 1000 |
| 12 | 100% | 75.0% | 0 | 57 / 1000 |
| 13 | 100% | 69.6% | 0 | 68 / 1000 |

Two findings, both against the default:

- **n=13 leaves 6.8% of the benchmark unscannable**, because items shorter than 13 tokens
  produce no 13-grams and can never match anything. At n=10 that falls to 0.3%. Structural
  rather than statistical, and the stronger of the two.
- **n=13 recovers 69.6% of lightly edited copies against 81.5% at n=10.** At 300 planted
  items the standard error is about 2.3 points, so the gap is real, and recall falls
  monotonically with n.

Both find every verbatim copy. n=10 costs two false positives per thousand items against
zero at n=13, and both are inspectable, because every hit displays its matching text.

An earlier version of this table claimed 100% against 3.5%. That gap was an artifact of a
test fixture that deleted words on a fixed lattice, which decided in advance which values of
n could survive. `docs/measurements.md` has the full account, along with every other defect
found by measurement rather than assumed away.

Reports quote n=13 alongside n=10 so findings stay comparable with prior published work.

## What was NOT checked

Every report names the benchmark items that produced no surviving n-gram, either because
they are shorter than n tokens or because all their grams were filtered as boilerplate.
Nothing can ever match those items, so a clean result that stayed silent about them would
be hiding the part of the benchmark nobody looked at.

This was a bug first: the validation harness failed on its first run at 95% recall, and
three of sixty planted items turned out to be 10 tokens long. Not a scanner defect — a
structural limit that was invisible.

## The registry

Which public benchmarks appear in which public training corpora, in `results/registry.md`,
reproducible with `node scripts/registry-scan.ts`. Everything scanned is public, so every
number can be re-derived from the same files.

At n=10 the current answer is six flagged items across 15,525, **and all six are canonical
text rather than leakage.** That is published rather than quietly dropped, because it is
the finding: a phrase appearing in exactly one benchmark item still carries no evidential
weight if the whole world writes it.

## The provenance scanner

A second, weaker product: was this batch written by a human or generated? Batch-level, six
structural signals, measured against two named reference corpora.

| Signal | What it looks at | Separation on the reference pair |
|---|---|---|
| Sentence burstiness | how much sentence length varies inside a record | **6.31σ** |
| Structural repetition | reused openings, closings, markdown scaffolding | **5.18σ** |
| Lexical cluster tightness | mean pairwise TF-IDF cosine across the batch | 1.24σ |
| Lexical variety | type-token ratio and rare-term rate | 0.94σ |
| Near-duplicate rate | MinHash 64x over 5-gram shingles | 0.00σ, no information here |
| Cross-author style distance | function-word fingerprint per annotator | unavailable, see below |

Signals below 0.25σ are excluded rather than included with a small weight, because a signal
that cannot separate the references cannot inform a verdict about a batch.

```
  contamination    purity (5 draws)      clean control
  ─────────────────────────────────────────────────────
       0%          88.0 ± 4.7            mean 89.9
       5%          90.2 ± 6.6            sd   4.7
      10%          87.6 ± 10.2           n    8 batches
      25%          81.2 ± 5.0
      50%          56.4 ± 7.7
```

**Detection floor: 50%.** The first level landing more than two control standard deviations
below the clean-human mean. 25% is marginal at about 1.8σ. 5% and 10% are inside the noise
and are **not** detectable with this corpus pair at this batch size. **False positive rate:
13%** — one of eight clean human batches, at a purity threshold of 85.

That is the honest number, and the four reasons it is not better are known:

1. **The reference pair is not prompt-matched.** Dolly and Alpaca answer different
   questions, so part of the measured separation is task distribution rather than
   provenance. `scripts/generate-paired.ts` regenerates the same dolly prompts with a
   current model, giving a paired design. Needs `ANTHROPIC_API_KEY`. Highest-value next step.
2. **The machine reference is 2023-era.** Treat this curve as an upper bound, never as a
   claim about 2026 models.
3. **Only 7,208 human records.** At batch 1,200 that is roughly six independent batches per
   half, so split luck alone shifts the reference.
4. **Neither corpus ships annotator ids**, so cross-author stylometry never runs. On a real
   vendor batch it is the strongest available signal.

Contamination leads the product because it is not an inference. A shared n-gram is a fact
you can display; authorship is a statistical claim about a distribution.

## What it refuses to do

Every one of these was a bug first, found by running the experiment and reading the output
instead of trusting it. All are written up in `docs/measurements.md` and guarded by tests.

- **No per-record verdicts.** Batch-level evidence against named references.
- **No extrapolation.** A batch outside the interval the references span is unlike *both*.
  Clamping such a batch once put a clean human batch at 34/100.
- **No absolute thresholds.** Missing baselines means no score, not a fallback guess.
- **No comparing across batch sizes.** Near-duplicate rate and type-token ratio move with
  batch size regardless of provenance.
- **No zero-variance division.** A pinned statistic is not a perfect discriminator.
  Treating it as one produced NaN purity on every row.
- **No silent 0.0.** Non-finite scores raise; unparseable lines are counted and listed.

## Documentation

- `docs/measurements.md` — every published number, how it was measured, and every wrong
  turn taken on the way
- `docs/threat-model.md` — what leaves your machine, what the hashes do and do not protect,
  and where a determined vendor still wins
- `docs/index-format.md` — the index format, specified completely enough to implement
  independently
- `docs/github-action.md` — running the scan as a gate in your own CI

## Licences of the reference data

`databricks-dolly-15k` is CC-BY-SA-3.0. `stanford_alpaca` is CC-BY-NC-4.0, so the Alpaca
reference is for calibration and research only, not commercial use. Stated here because a
verification product that plays loose with data licensing has no standing to audit anyone
else.
