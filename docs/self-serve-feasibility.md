# Can the check run in the browser?

The scanner is asymmetric on purpose: it indexes the **small** text and streams the
**big** one. For the benchmark wing that is the right way round — a benchmark is small, a
corpus is not. For a writer checking their own words it is backwards. Their writing is the
small text, so the thing that would have to be streamed is 21.33 GB of C4, and no browser
streams 21.33 GB.

The proposed inversion is a membership structure built over the corpus n-grams, small
enough to download, that the page queries locally. This document settles whether that is
possible. Every figure traces to `results/membership-size.json`, produced by
`scripts/membership-size.ts` using the scanner's own tokenizer and rolling gram hash.

## What C4 actually contains

Measured on 20,000 documents of shard 0, then projected:

| | |
|---|---|
| grams per uncompressed byte | 0.1664 |
| total 10-grams in the corpus | 3,549,423,762 |
| **distinct 10-grams** | **3,503,568,526** |
| Heaps fit | distinct = 1.000 × total<sup>0.9994</sup>, max fit error 0.1% |

The exponent is the finding. At n=10 in a document-deduplicated corpus,
**98.7% of grams are unique** — there is no saturation to exploit. Distinct count grows
essentially linearly with corpus size, so a bigger corpus buys no compression, and the
structure has to hold three and a half billion elements.

## The size, and why it is not close

A Bloom filter needs log₂(1/ε)/ln2 bits per element.

| Winnowing | Distinct grams | At 1% false positive | At 10% |
|---|---|---|---|
| none | 3,503,568,526 | **4,197.7 MB** | 2,098.9 MB |
| 1 in 16 | 218,987,574 | 262.4 MB | 131.2 MB |
| 1 in 64 | 54,619,853 | 65.4 MB | 32.7 MB |
| 1 in 256 | 13,758,884 | 16.5 MB | 8.2 MB |

Against a realistic browser budget — the site ships a 5.35 MB MMLU index today and treats
that as a real cost — the unwinnowed structure misses by roughly **800×**.

**The conclusion survives an order-of-magnitude error in the extrapolation.** The
projection reads distinct-gram growth from a 7.2-million-gram sample and extends it 500×;
saturation can only make the true number smaller, never larger, so the figure is an upper
bound in practice. Even if it were ten times too high, the structure would still be 420 MB.
The decision does not depend on the precision of the estimate.

## The cost nobody notices until it ships

Size is the smaller problem. A Bloom filter has false positives, and here a false positive
is not a wasted cycle — it is telling a writer their words are inside AI training data when
they are not.

| Winnowing | 20w | 50w | 100w | 200w | 500w | 1000w | False hits per 1,000 words at ε=1% |
|---|---|---|---|---|---|---|---|
| none | 100% | 100% | 100% | 100% | 100% | 100% | 9.910 |
| 1 in 16 | 50.8% | 92.9% | 99.7% | 100% | 100% | 100% | 0.619 |
| 1 in 64 | 15.9% | 47.6% | 76.1% | 95.1% | 100% | 100% | 0.155 |
| 1 in 256 | 4.2% | 14.8% | 30.0% | 52.6% | 85.4% | 97.9% | 0.039 |

Read the last column first. **Even the unwinnowed 4.2 GB structure produces about ten false
hits per thousand words** at a 1% rate, because a document issues one query per gram. Making
the answer trustworthy means driving ε far below 1%, which costs bits: at ε=10⁻⁵ the
unwinnowed structure is roughly 10.7 GB. Size and honesty pull in the same direction, and
both point away from this design.

## The reason that would hold even if it fit

Suppose the arithmetic were kind. It still fails, for a reason that has nothing to do with
bytes.

**A membership structure cannot show you the words.** It answers *maybe present* or
*definitely absent*, and that is all it can ever answer. The product's promise is the
opposite of that:

> See which of your exact words are inside AI training data — or get confirmation we
> couldn't find any.

DESIGN.md states it as law: evidence with words shown, never black-box verdicts. A Bloom
filter *is* a black-box verdict. Shipping one as the personal check would mean shipping the
thing the product exists to replace, and dressing it in the product's own vocabulary.

## Decision

**Kill the in-browser full-corpus membership structure as the personal check.** Not because
it is 800× too large, though it is, and not because its false positives are unshippable,
though they are — but because it cannot produce evidence, and evidence is the product.

The founder-run check stays v1. It is slower and it does not scale, and it returns the
matching sentences with a receipt, which the alternative cannot do at any size.

## What survives, and what it is for

The winnowed structure is not useless. It is the wrong shape for a **verdict** and the right
shape for a **screen**.

At 1 in 256 it is 16.5 MB — shippable — and finds 85.4% of 500-word passages. That is a page
that answers *"there is probably something here, and it costs you nothing to find out"* in
seconds, with no upload and no waiting, and then hands off to the real scan for the words
and the receipt. Its false positives become tolerable because it stops making a claim: a
screen that says *likely* is honest at 4% error in a way a report that says *found* is not.

That is a demand instrument as much as a feature. The Week-3 gate currently measures inbound
requests through a pinned contact link; a self-serve screen measures the same intent without
asking anyone to compose an email.

**It is not built, and this document does not authorise building it.** The design doc's kill
rules gate all building on the five-writer demand test, and that test has not run. What is
settled here is the engineering question the doc asked — the size math, due 2026-08-15 — and
the answer is: the verdict path is dead, the screen path is affordable, and the choice
between them is a product decision that belongs at the Week-3 gate with demand data in hand.

## Reproducing

```
node --max-old-space-size=6144 scripts/membership-size.ts --docs 20000
```

Reads `../corpora/c4-en/c4-train.00000-of-01024.json.gz`, writes
`results/membership-size.json`. Distinct counting is exact on the sample and held in memory,
which is what bounds the sample size; the projection is Heaps' law fitted to checkpoints at
1k, 2k, 5k, 10k and 20k documents rather than assumed.
