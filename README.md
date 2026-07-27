# Ingot

Independent verification of the AI training data supply chain. A batch of training
or eval data goes in, a purity report comes out: where the batch sits between a
known-human reference corpus and a known-machine one, which signals say so, and
how far outside normal it falls.

Runs entirely on your machine. No network calls, no data retention, no API key.
Zero dependencies: Node 24 executes the TypeScript directly.

```bash
node scripts/fetch-corpora.ts      # download the two reference corpora
node scripts/build-baselines.ts    # calibrate reference distributions
node scripts/spike.ts              # the contamination experiment
node src/cli.ts scan batch.jsonl   # scan a real batch
node --test test/*.test.ts         # 12 guard tests
```

## Contamination scanning

Does benchmark text appear inside a training corpus. Unlike provenance, this is not an
inference: a shared 13-gram is a fact, displayed side by side with its surrounding
context so a reader can judge it.

Ingot indexes the **benchmark** and streams the corpus once. lm-eval-harness does the
reverse, indexing the corpus, which took nine days on the Pile.

```
  phase                       best ms  delta ms       tok/sec
  ───────────────────────────────────────────────────────────
  A baseline (loop only)            1
  B fused tokenize/hash           718       717    13,929,351
  C + ngram rolling              2038      1320     4,907,396
  D + index lookup (full)        2243       205     4,458,883

  37.1 MB/sec CPU, single-threaded  →  20 GB in 9.0 minutes
```

Measured on 83.3 MB / 10.0M tokens, three repetitions, best of, corpus held in memory so
the figure is CPU rather than disk. Reproduce with `node scripts/bench-scan.ts`.

Indexes serialize to one-way hashes and item ids with **no benchmark text**, so an index
can be published for benchmarks whose licence forbids redistributing the data.

### The n sweep: 13 is a poor default

Everyone uses 13-gram matching because GPT-3 (Brown et al., 2020) used it. We could find
no systematic re-derivation since. Running 8 through 13 on a 1,000-item benchmark with 300
items planted in 6,000 dolly documents, verbatim and again with roughly one word in eleven
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
  produce no 13-grams and can never match anything. At n=10 that falls to 0.3%. This one is
  structural rather than statistical, and it is the stronger of the two.
- **n=13 recovers 69.6% of lightly edited copies against 81.5% at n=10.** At 300 planted
  items the standard error is about 2.3 points, so the gap is real, and recall falls
  monotonically as n grows.

Both find every verbatim copy. n=10 costs two false positives per thousand items against
zero at n=13, and those are inspectable, because every hit displays its matching text.

An earlier version of this table claimed 100% against 3.5%. That gap was an artifact of a
test fixture that deleted words on a fixed lattice, which decided in advance which values
of n could survive. `docs/measurements.md` has the full account.

**What the false positives actually are.** Both n=10 control hits are canonical facts with
one natural phrasing:

```
The planets [[are Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune]]

...the squares of the two adjacent sides is equal to [[the square of the hypotenuse
(the side opposite to the right]] angled triangle...
```

Neither is contamination, and no reader needs the docs to know that, because the report
shows the matching text rather than a count. That is the argument for displaying evidence:
a false positive you can see is a judgment a user makes in one second, while a false
positive expressed as a percentage is one they cannot evaluate at all.

Caveats stated first: one corpus pair, both 2023-era, and paraphrase is simulated by
deterministic word dropping rather than a model rewriting the text. Real paraphrase will
be harder than this.

### What was NOT checked

Every report names the benchmark items that produced no surviving n-gram, either because
they are shorter than n tokens or because all their grams were filtered as boilerplate.
Nothing can ever match those items, so a clean result that stays silent about them hides
the part of the benchmark that was never examined. Reproduce with
`node scripts/contamination-validate.ts`.

## What the provenance scanner measures

| Signal | What it looks at | Separation on the reference pair |
|---|---|---|
| Sentence burstiness | how much sentence length varies inside a record | **6.31σ** |
| Structural repetition | reused openings, closings, markdown scaffolding | **5.18σ** |
| Lexical cluster tightness | mean pairwise TF-IDF cosine across the batch | 1.24σ |
| Lexical variety | type-token ratio and rare-term rate | 0.94σ |
| Near-duplicate rate | MinHash 64x over 5-gram shingles | 0.00σ, no information here |
| Cross-author style distance | function-word and punctuation fingerprint per annotator | unavailable, see below |

Separation is the gap between the two reference means measured in units of
batch-to-batch noise. It is the signal-to-noise ratio, and it is what each signal
is weighted by in the score. Signals below 0.25σ are excluded rather than
included with a small weight, because a signal that cannot separate the
references cannot inform a verdict about a batch.

## Measured result

Reference pair: `databricks-dolly-15k` (human-authored, 7,208 usable records) versus
`stanford_alpaca` 52k (generated by text-davinci-003, 26,534 usable records).
Batch size 1,200. Baselines calibrated on a random half of each corpus; every
scored record comes from the held-out half.

```
  contamination    purity (5 draws)      clean control
  ─────────────────────────────────────────────────────
       0%          88.0 ± 4.7            mean 89.9
       5%          90.2 ± 6.6            sd   4.7
      10%          87.6 ± 10.2           n    8 batches
      25%          81.2 ± 5.0
      50%          56.4 ± 7.7
```

- **Detection floor: 50%** contamination is the first level that lands more than
  two control standard deviations below the clean-human mean. 25% is marginal at
  about 1.8σ. 5% and 10% are inside the noise and are **not** detectable with this
  corpus pair at this batch size.
- **False positive rate: 13%** (1 of 8 clean human batches) at an operating
  threshold of purity < 85.

That is the honest number. It is not a good number yet, and the four reasons are
known and fixable.

## Why the floor is 50% and how to lower it

1. **The reference pair is not prompt-matched.** Dolly and Alpaca answer different
   questions, so part of the measured separation is task distribution rather than
   provenance, and clean human batches drift for the same reason. Fix:
   `scripts/generate-paired.ts` regenerates the *same* dolly prompts with a current
   model, giving a paired design where the only difference is who wrote the answer.
   Needs `ANTHROPIC_API_KEY`. This is the single highest-value next step.
2. **The machine reference is 2023-era.** Current frontier output is harder to
   separate, so treat this curve as an upper bound, never as a claim about 2026
   models. The paired generator fixes this at the same time.
3. **Only 7,208 human records.** At batch 1,200 that is roughly six independent
   batches per half, so split luck alone shifts the reference. More human corpora
   would tighten every number.
4. **Neither corpus ships annotator ids**, so cross-author stylometry never runs.
   On a real vendor batch it is the strongest available signal, and it catches two
   patterns nothing else does: forty "experts" who all write like one model, and one
   "expert" whose records look like forty different writers.

## What it refuses to do

Every one of these was a bug first, found by running the experiment and reading
the output instead of trusting it.

- **No per-record verdicts.** Batch-level evidence against named references. A
  general AI-text detector is an arms race Ingot does not enter.
- **No scoring below 30 records**, and no per-author style profile below 30 records
  for that author. It says which author and how many it had.
- **No extrapolation.** A batch outside the interval the two references span is
  unlike *both*, which is not evidence that it resembles the machine one. Clamping
  such a batch silently put a clean human batch at 34/100 during development.
- **No absolute thresholds.** If the baseline file is missing, it refuses to score.
- **No comparing across batch sizes.** Near-duplicate rate and type-token ratio move
  with batch size regardless of provenance, so those signals decline when the batch
  is more than 2x off the calibration size.
- **No zero-variance division.** Zero reference variance means the statistic is
  pinned at a floor, not that it separates perfectly. Treating it as infinite
  separating power produced a NaN score.
- **No silent 0.0.** A non-finite score raises; unparseable lines are counted and
  listed; a batch with no variance is refused.

## Data schema

JSONL, one record per line. Field names are auto-detected, or pass the flags.

```json
{"id": "r1", "text": "the response being verified", "prompt": "optional", "annotator_id": "optional"}
```

`text` is looked for as `text`, `response`, `output`, `completion`, `answer`, or
`content`. Annotator id as `annotator_id`, `author_id`, `worker_id`, `contributor`.

## Licences of the reference corpora

`databricks-dolly-15k` is CC-BY-SA-3.0. `stanford_alpaca` is CC-BY-NC-4.0, so the
Alpaca reference is for calibration and research only, not commercial use. Stated
here because a verification product that plays loose with data licensing has no
standing to audit anyone else.
