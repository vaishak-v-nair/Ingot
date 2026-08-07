# Coverage: what Ingot cannot look for

A scanner that reports "no match" has said one of two very different things:

> **We looked for your words and did not find them.**
>
> **We could not have found your words.**

Both are true sentences. Only the first is a result. This document is the list of every way
the second one can happen, because a tool that blurs them is more dangerous than one that
finds nothing at all — it converts a limit of the software into a reassurance about the
world.

Everything here is a limit Ingot knows about and reports. The failure this project actually
fears is the limit nobody wrote down.

---

## 1. Scripts the tokenizer cannot segment

Ingot matches on word n-grams. Finding a word requires knowing where it ends, and Ingot
decides that on word boundaries — whitespace and punctuation. Chinese, Japanese, Thai, Lao,
Khmer, Burmese and Tibetan are written without spaces between words, so that rule does not
apply to them at all.

The consequence is not degraded accuracy. It is total: a Japanese essay of several hundred
characters tokenizes to **one token**, produces no 10-gram, and cannot be matched against
anything.

Reproduce it:

```bash
node -e 'const {hashTokens}=await import("./src/contamination/fastTokens.ts");
for (const s of ["The quick brown fox jumps over the lazy dog and keeps going",
                 "私の文章が人工知能の訓練データに含まれているかどうかを確認したい"])
  console.log(hashTokens(s).count, "tokens");' --input-type=module
```

**What Ingot does about it.** The index records which items were unmatchable for this
reason, separately from the ones that were merely short, and the report says so in those
words — that the scan could not look, not that it looked and found nothing. See
`unsegmentedItemIds` in `src/contamination/types.ts` and the "What was not checked" section
of any HTML report.

Korean is *not* on the list: modern Korean puts spaces between words and segments correctly.

**What would fix it.** Character n-grams for unspaced scripts, or `Intl.Segmenter` at index
time. Neither is built. Both change what a "match" means, and shipping a second definition
of matching without saying so would be a worse bug than the one it fixes.

## 2. Text shorter than n tokens

An item shorter than `n` tokens produces no n-gram. At the default `n=10`, a nine-word
sentence cannot be matched by construction.

This is reported as `uncheckableItemIds` and has been since the first release. It is the
oldest entry in this document and the reason the section in the report exists.

## 3. Short text whose quote style was changed

Ingot keeps the ASCII apostrophe inside a word and treats the typographic one (U+2019) as a
separator, so `don't` is one token spelled one way and two tokens — `don`, `t` — spelled the
other. Both spellings are ordinary. Over 126,578 C4 documents:

**39.1% use a word-internal curly apostrophe, 30.0% an ASCII one.**

Normalising smart quotes is what every CMS, exporter and scraper does, so the two spellings
of one sentence genuinely meet.

It would be easy to assume this makes any re-quoted copy invisible. It does not, and the
measurement is what says so — the ten-token window rolls, so a changed character damages
only the windows containing it, and any run of ten consecutive apostrophe-free tokens still
matches exactly. Length is the variable:

| length of the copied text | verbatim copies still found after quote normalisation |
|---|---|
| 10–24 tokens | **68.0%** |
| 25–49 tokens | 100% |
| 50–99 tokens | 100% |
| 100–299 tokens | 100% |
| 300+ tokens | 100% |

`scripts/quote-style-sensitivity.ts`, 500 real C4 documents, 100 per bucket, control run
finds 500 of 500. Full figures in `results/quote-style-sensitivity.json`.

**So the limit is real and it is small and it is bounded.** Below about 25 tokens — a
caption, an aphorism, a few lines of verse — roughly a third of re-quoted copies are missed.
Above it, nothing is. A short text is close to the n=10 floor anyway, which is section 2.

**Why the tokenizer was not changed.** Folding U+2019 to ASCII would fix the 68% case and
would also change every gram in every index, which changes every published figure in this
repository. Buying a correction that only applies below 25 tokens at the price of making
several thousand published numbers unreproducible is not obviously the right trade, and it
is not a trade to make quietly. The number is measured, written down, and left as a decision
rather than taken as one.

## 4. Grams filtered as boilerplate

A gram shared by more than `maxItemsPerGram` benchmark items is dropped at index time, and a
gram appearing in more than `--max-doc-freq` corpus documents is dropped at scan time as
ordinary language. An item all of whose grams are filtered becomes unmatchable, and lands in
`uncheckableItemIds` alongside the short ones.

Both filters exist because without them a scan reports contamination every time two
documents share a stock phrase. Both are tunable, and the discards are printed — "dropped as
ordinary language" is itself a judgement, so the report shows the discarded text and lets
the reader check it.

## 5. The corpus is not the crawl

`scripts/c4-filter-sim.ts` answers a question the scanner cannot: **could this text have
been in the corpus at all?**

C4 is not the April 2019 Common Crawl. It is what survived a documented cleaning pass over
it — a blocklist, a rule that discards any page containing a curly brace as code, a
requirement that lines end in terminal punctuation, a five-line minimum. Text that was
crawled and then discarded by that pass is absent from C4 for reasons that have nothing to
do with who trained on it.

Run the simulation before drawing a conclusion from a clean result:

```bash
node scripts/c4-filter-sim.ts <corpus.jsonl>
```

It reports an **upper** bound on survival: C4's corpus-wide three-sentence deduplication and
its `langdetect` English gate are not simulated, and both can only remove more. The bound is
deliberately in that direction — an over-estimate of survival makes a null look more
meaningful than it is, which is the error worth refusing loudly rather than the one worth
hiding.

## 6. The crawl is not the web

A page CommonCrawl never fetched cannot be in any corpus derived from it. `scripts/cdx-check.ts`
screens URLs against the CommonCrawl index before anyone bothers scanning.

Two rules that cost three wrong versions to learn:

- A domain check may rule a platform **out**. It may never clear a **person** — a crawled
  host is not a crawled writer, so screen the writer's own URLs.
- The index is sorted by URL, so sampling only the first page of results is biased toward
  whatever sorts first. Sample across the range.

## 7. Verbatim only

The exact tier finds verbatim overlap. A paraphrase, a translation, or a copy with edited
punctuation is not verbatim and the exact tier will not see it. The near-duplicate tier
exists for edited copies and needs the benchmark text (`--bench`), which a published index
does not carry — so it reports *why* it is unavailable rather than reporting zero.

Measured recall against edited copies is in `docs/measurements.md`. It is not 100%, and the
number is published rather than described.

## 8. The corpora Ingot has

A clean result covers the corpora that were actually scanned, on the crawl dates printed in
the receipt. It says nothing about corpora nobody has scanned, private datasets, or
post-training data. Every report carries this sentence; it is not a disclaimer bolted on
afterwards but the actual scope of the claim.

---

## The rule this document exists to enforce

Before any report goes out, its null results have to survive one question: **could this scan
have found the thing it says it did not find?**

If the answer is no — the script cannot be segmented, the text is too short, the page was
never crawled, the corpus filtered it out — then the report says so, in the same place and
the same size as the result. A caveat in a footnote under a green checkmark is a way of
being technically honest and practically misleading, and it is the one thing this tool must
never do.

Related: `docs/silent-failures.md` (defects found and what each one taught),
`docs/threat-model.md`, `docs/measurements.md`.
