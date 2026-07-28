# Three ways benchmark contamination scanning silently fails

**Scanning GSM8K, HumanEval and MMLU against 21.33 GB of C4.**

Ingot · 2026-07-28 · every number below reproduces from public files

A contamination scan that finds nothing tells you one of two things: your benchmark is
clean, or your scanner is lying to you. Distinguishing those is the whole job, and the
standard method — exact n-gram matching with a document-frequency filter — gets it wrong in
three separate ways, each of which produces a confident, checkable, incorrect answer.

We found all three by pointing our own scanner at a real pretraining corpus and reading
what came back. One of them we had already shipped as a headline number and had to retract.

---

## Read the limitations first

They change how you should read everything below.

- **Exact matching only.** A paraphrase defeats this method entirely. Nothing here says
  anything about contamination that was reworded, and real leakage is often reworded.
- **A 21.33 GB sample, not C4.** 26 of 1,024 shards, about 2.5% of the English split. An
  item absent here may appear in the other 97.5%.
- **One corpus, one snapshot.** C4 is Common Crawl from April 2019. Findings about C4 are
  not findings about any particular model's training set. We are not claiming any model
  trained on contaminated data.
- **The canonical-text finding is partly demonstrated, mostly undetermined.** 67 of 342
  flagged items are confirmed canonical against a corpus of independent provenance. The
  other 275 are undetermined, and a published control shows why absence proves nothing at
  this reference size. Zero leakage was demonstrated. See the last section.

## What was scanned

| | |
|---|---|
| Corpus | C4 `en`, 26 shards, 8.29 GB gzipped, **21.33 GB** raw |
| Scale | **9,264,249** documents, **3,418,685,530** tokens |
| Benchmarks | GSM8K (1,319 items), HumanEval (164), MMLU (14,042) |
| Method | exact n-gram matching, n=10, stride 1 |
| Filter | a match whose rarest gram appears in more than 5 corpus documents is discarded as ordinary language |
| Licence | C4 is ODC-BY. Benchmark indexes carry one-way hashes and item ids, never benchmark text |

Every shard's URL and SHA-256 is published in `results/pretraining-c4.json`, so the corpus
can be reassembled byte for byte without asking us for anything.

### The headline a naive scanner would print

```
  gsm8k        2 / 1,319    0.152%      2 matches
  humaneval    6 / 164      3.659%     15 matches
  mmlu       342 / 14,042   2.436%    865 matches
```

**"2.4% of MMLU is contaminated in C4" is wrong.** The evidence supporting it is real,
reproducible, and means almost nothing. Here is why.

---

## Failure 1 — items nothing can ever match

An item shorter than *n* tokens produces no n-grams at all. No n-gram means no possible
match, which means the scanner reports it clean without ever examining it.

At **n=13**, the field default since GPT-3 (Brown et al., 2020), this silently removes
**6.8%** of a benchmark from consideration. At **n=10** it is **0.3%**.

This is arithmetic, not statistics. It follows from counting tokens, and no fixture or
sampling choice can inflate it. It is also invisible in every report that does not
explicitly count it — the benchmark comes back clean, and part of it was never scanned.

Ingot reports uncheckable items beside the recall figure rather than folding them in. In
this run MMLU had 28 items with no surviving n-gram even at n=10.

### While we were there: 13 is a poor default

Everyone matches on 13-grams because GPT-3 did in 2020. We could find no systematic
re-derivation since. Measured over a 1,000-item benchmark with 300 items planted in 6,000
documents:

| n | verbatim | edited copies | false positives | unscannable |
|---|---|---|---|---|
| **10** | **100%** | **81.5%** | **2 / 1000** | **3 / 1000** |
| 13 | 100% | 69.6% | 0 | 68 / 1000 |

The unscannable column is the argument, not the recall column. Full sweep in
`results/contamination-validation.json`.

**An earlier version of this table claimed a 28x advantage for n=10 on edited copies.**
That was an artifact of a fixture that deleted words on a fixed lattice, so a 10-gram at
offset 0 could never be touched and a 13-gram at offset 0 always broke. It is retracted.
The corrected gap is 12 points. How we found it is in [`measurements.md`](measurements.md).

---

## Failure 2 — nearly every match is canonical text

Of the 342 MMLU items flagged, we inspected 200 retained matches across 120 distinct items.
**We found no contamination.** We found the Western canon.

```
  df=3  [mmlu-5951]  agree that an armed attack against one or more of them in Europe
                     or North America shall be considered an attack against them all
  df=1  [mmlu-5720]  I know not what course others may take, but as for me, give me
                     liberty or give me death!?- Patrick Henry
  df=1  [mmlu-5732]  The seeds of totalitarian regimes are nurtured by misery and want
  df=1  [mmlu-3811]  not "be deprived of life, liberty, or property, without due process
  df=1  [mmlu-6072]  friendships that are obtained by payments, and not by greatness or
                     nobility of mind, may indeed be earned, but they are not secured
  df=2  [mmlu-11040] because it violates the Equal Protection Clause of the Fourteenth
                     Amendment
  df=1  [mmlu-1049]  where n is the number of nodes in the tree
```

NATO Article 5. Patrick Henry. Roosevelt's Four Freedoms. The Fifth Amendment.
Machiavelli. Stock legal boilerplate. Stock exam phrasing. MMLU asks questions *about*
these documents, so it quotes them. C4 is web text, so it contains them too. The overlap
is exact, reproducible, and evidentially worthless.

**A percentage cannot distinguish these from a leak.** Only reading the words can, which is
why Ingot prints every match with its surrounding text and refuses to emit a bare score.

### The statistical version of the same finding

MMLU tags its quote-bearing questions with the phrase *"This question refers to the
following information"*. Those items are **6.3x over-represented** among the flagged:

| | count | share |
|---|---|---|
| MMLU items total | 14,042 | |
| ...quote-bearing | 606 | 4.3% |
| Flagged items | 342 | |
| ...quote-bearing | 93 | **27.2%** |

**This does not fully explain the effect.** 73% of flagged items are *not* quote-bearing —
they trip on stock domain language like "the Equal Protection Clause of the Fourteenth
Amendment", "is the most likely cause of this patient's symptoms", or "where n is the
number of nodes in the tree". Quoting explains a large minority, not the whole.

### Why the rarest matches are canonical too

The obvious objection: surely canonical text is common, so a frequency filter removes it?

Look at the `df` values above. They are the number of C4 documents containing that match's
rarest gram. Patrick Henry's most famous sentence appears in **one** document out of nine
million. Of 200 retained matches, **83 have df=1**.

The reason is visible in the match itself: `give me liberty or give me death!?- Patrick
Henry`. Web copies of a famous quotation vary in punctuation, attribution, spacing and
truncation. The passage is ubiquitous; that *exact ten-token span* is not. Exact matching
and frequency filtering are defeated by the same formatting variance.

---

## Failure 3 — the standard defence does not fire, and then does not work

Document-frequency filtering is the usual answer to failure 2: discard matches whose text
is common across the corpus. We ran the identical filter at the identical threshold of 5
documents, at two corpus sizes.

| corpus | documents | gsm8k | humaneval | mmlu | **dropped as ordinary language** |
|---|---|---|---|---|---|
| 1 shard | 356,317 | 0 matches | 5 | 74 | **0** |
| 26 shards | 9,264,249 | 2 | 15 | 865 | **757** |

Nothing about the filter changed. What changed is whether the corpus was large enough for
ubiquitous text to *look* ubiquitous. At 356k documents the ten digits appear a handful of
times and survive any sane threshold.

**This is uncomfortable for the practice.** Contamination scanning is usually run on the
corpus you have — a fine-tuning set, an eval suite, one dataset. At that size, document
frequency cannot separate ubiquitous text from leaked text, so the scan over-reports, and
the errors look exactly like real findings. The threshold is not the problem. The reference
corpus is.

**And at scale it still is not enough.** 757 matches were correctly discarded, and the 865
survivors are still canonical, for the df=1 reason above. Scale makes the filter fire. It
does not make it sufficient.

We made this mistake first. Ingot's earlier registry scanned two instruction-tuning sets,
flagged six items, and all six were canonical text — prime sequences, the ten digits,
"I Have a Dream". We published that null result, then went and got a corpus big enough to
understand why.

---

## A fourth failure, ours

Until today this repository advertised `37.1 MB/sec → 20 GB in 9.0 minutes` on its front
page. Scanning a real corpus put the end-to-end rate at **7.0 MB/sec — about 48 minutes for
20 GB.**

The measurement was never wrong. `bench-scan.ts` profiles the scan *kernel* — tokenize,
roll the n-gram, look it up — over text already read off disk and already parsed, and says
so directly underneath the number. The extrapolation was wrong. A real scan also
decompresses, splits lines, parses JSON, hashes the corpus twice and records matches, and
those are most of the wall clock. Measured across the three benchmarks here, end-to-end
throughput ranged **4.3 to 10.1 MB/sec** depending on index size.

We include this because a report arguing that other people's numbers measure the wrong
thing has no standing unless it says when its own did. Stating a caveat is not the same as
honouring it: "corpus held in memory, so this is CPU rather than disk" sat directly under
that number, and it still got quoted as a scanning rate.

---

## What we are not claiming

- Not that any model trained on contaminated data. C4 is a corpus, not a training set.
- Not that these benchmarks are clean. Exact matching cannot show that, and 2.5% of one
  corpus cannot show it either.
- Not that document-frequency filtering is useless. It is necessary, insufficient, and
  unavailable at the corpus sizes most people actually scan.
- Not that the 342 flagged MMLU items contain zero leakage. We inspected 200 matches across
  120 items and found none. **The scanner retains at most 200 matches for display, so the
  other 665 were counted but not kept** — we have not seen them either, and neither can you
  without re-running the scan. That is a real limit on this finding, not a formality.

## Testing failure 2 properly, and what the test could not tell us

The proper test for canonicality is independence: scan a **second corpus of different
provenance** and keep only matches confirmed in both. Text reaching two independently
assembled corpora is a property of the language; text that leaked into one is specific to
one.

**The obvious second corpus would have proved nothing.** C4, RedPajama and FineWeb are all
Common Crawl derivatives. A match confirmed across two of them most likely means one web
page survived two filtering pipelines. The test would appear to pass while measuring
nothing — the same shape of failure as everything else in this report.

So we built a reference corpus with the crawl removed: The Pile with `Pile-CC`,
`OpenWebText2`, `HackerNews` and `Ubuntu IRC` excluded. What remains is **251,488
documents, 1.49 GB** of court opinions, patents, academic abstracts, encyclopedia articles,
digitised books and parliamentary proceedings — text whose route into a dataset never
passed through a crawler. 108,876 web-derived documents were dropped, and the per-subset
counts are published.

```
  of 342 MMLU items flagged in C4:
    confirmed canonical (also in non-crawl text)     67   19.6%
    web-corpus only                                 275   80.4%

  confirmations by source:  freelaw 46 · gutenberg 3 · wikipedia 2 · arxiv 2
                            stackexchange 2 · pubmed-central 2 · pubmed-abstracts 1
```

**67 items are now demonstrated canonical rather than argued canonical**, most of them by
court opinions independently containing the legal phrasing MMLU's law questions use.

### The 80.4% is not a leakage rate, and here is the measurement that proves it

Before reading anything into the unconfirmed items, we ran a control: nine items identified
by inspection as unambiguously canonical — Patrick Henry, Roosevelt's Four Freedoms, NATO
Article 5, Machiavelli, Franklin's testimony to Parliament. Nobody believes MMLU leaked
Patrick Henry into Common Crawl.

**One of the nine was confirmed. Eight were not.**

```
  NOT FOUND   Patrick Henry, "give me liberty or give me death"
  NOT FOUND   Roosevelt, Four Freedoms
  confirmed   Fifth Amendment, "without due process"
  NOT FOUND   NATO Treaty, Article 5
  NOT FOUND   Machiavelli, on friendships obtained by payment
  NOT FOUND   Franklin's 1766 testimony to Parliament
  ...
```

A 1.49 GB reference against a 21.33 GB web corpus has almost no power to find a passage
that is genuinely canonical. 140 Gutenberg documents will not contain Patrick Henry's
speech. **So this test has strong positive power and negligible negative power: presence is
evidence, absence is not.** Reporting "19.6% canonical, 80.4% possibly leaked" would be
precisely the confident wrong number this report is about, and the control set is what
stops us writing it.

The fix is a reference corpus one to two orders of magnitude larger, which is the next
experiment. Until then the honest statement is: 67 confirmed canonical, 275 undetermined,
zero demonstrated leakage.

## Reproduce every number

```bash
git clone https://github.com/vaishak-v-nair/Ingot && cd Ingot
node scripts/fetch-benchmarks.ts
node scripts/fetch-pretraining.ts --shards 26     # ~8 GB, resumable
node scripts/pretraining-scan.ts --n 10           # ~50 min per benchmark
```

Or check your own corpus against a benchmark, downloading neither:

```bash
npx ingot-scan contaminate --index gsm8k --corpus yours.jsonl
```

Nothing is uploaded — there is nowhere to upload it to. Every report ends with a receipt
carrying the scanner version, index identity, corpus hash and the exact command, so a third
party reproduces any number here without asking us for anything.

Full results, every shard hash, and the retained matches:
[`results/canonicality.json`](../results/canonicality.json) — the cross-provenance test and its control set ·
[`results/canonical-grams.json`](../results/canonical-grams.json) — the 67 confirmed-canonical item ids, no benchmark text ·
[`results/pretraining-c4.json`](../results/pretraining-c4.json) — the three-benchmark run ·
[`results/pretraining-c4-mmlu-evidence.json`](../results/pretraining-c4-mmlu-evidence.json) — the 200 retained MMLU matches with their document frequencies ·
[`results/pretraining-c4-1shard.json`](../results/pretraining-c4-1shard.json) — the single-shard comparison ·
[`results/contamination-validation.json`](../results/contamination-validation.json) — the n sweep

## The claim, stated narrowly

At web scale, exact-match contamination findings are dominated by canonical text. The
machinery meant to separate signal from ubiquity — document-frequency filtering — does not
engage until the reference corpus is enormous, and even then it is defeated by the
formatting variance that makes a famous passage's exact n-gram rare.

If you are scanning a benchmark against a corpus you control, and you get a number, read
the matches. The number on its own is not evidence.
