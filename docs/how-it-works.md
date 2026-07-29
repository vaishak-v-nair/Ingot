# How Ingot works

No background needed. Five minutes, and you should be able to explain this to someone else.

---

## The problem, in one story

You're a teacher. You give your class a test. Everyone scores 95%.

Then you find out the test questions were printed in the back of the textbook they studied
from. Now the scores mean nothing. You have no idea who actually learned anything, because
you can't tell understanding from memorisation.

**This happens to AI models constantly.**

Models are graded on *benchmarks* — standard sets of test questions everyone uses, so
different models can be compared. MMLU has 14,042 questions on history, law, medicine and
more. GSM8K has maths word problems. HumanEval has programming tasks.

But models learn by reading enormous amounts of text scraped off the internet. Often
**trillions** of words. And nobody reads all of it, because nobody can.

So the question nobody can answer is: *were the test questions in the study material?*

If they were, the score is not a measure of intelligence. It's a measure of memory. And
every decision made on that score — which model to use, which to fund, which to ship — was
made on a number that doesn't mean what people think it means.

**Ingot answers that question.** That's the whole product.

---

## How it actually works

### The naive approach, and why it fails

Obvious idea: compare every test question against every document in the training data.

MMLU has 14,042 questions. C4 has ~365 million documents. That's **5 trillion**
comparisons, each one comparing long pieces of text. You would wait years.

### What Ingot does instead

**Step 1 — chop the test questions into overlapping chunks of 10 words.**

Take a sentence:

```
"the cat sat on the mat and then it slept again quietly"
```

Slide a 10-word window across it, one word at a time:

```
window 1:  the cat sat on the mat and then it slept
window 2:  cat sat on the mat and then it slept again
window 3:  sat on the mat and then it slept again quietly
```

Each window is called a **10-gram**. Ten words in a row.

**Step 2 — turn each chunk into a number.**

Feeding text through a *hash function* turns it into a number. Same text in, same number
out, every time. Different text, different number.

```
"the cat sat on the mat and then it slept"   →   8,412,993,006
```

Do this for every window of every question. Put all those numbers in a lookup table.

That table is the **index**. For MMLU it's about 5 MB — small enough to hold in memory
while you work.

**Step 3 — stream the training data past the index.**

Read the training corpus one document at a time. Chop each document into 10-grams the same
way. Hash each one. Ask the table: *have I seen this number?*

```
corpus document  →  chop into 10-grams  →  hash each  →  is it in the table?
                                                              │
                                                    yes ──────┴────── no
                                                     │                 │
                                              those exact          keep going
                                            10 words appear
                                              in BOTH
```

Because you only ever hold one document at a time, the corpus can be **any size**. 20 GB,
2 TB, it makes no difference to memory. It just takes longer.

### The trick that makes it fast

Re-hashing all 10 words for every window would mean reading each word 10 times over.

Instead Ingot uses a **rolling hash**. When the window slides forward one word, it
*subtracts* the word that left and *adds* the word that arrived. The other nine are already
accounted for.

```
window 1:  [the cat sat on the mat and then it slept] again quietly
                ↓ subtract "the", add "again"
window 2:  the [cat sat on the mat and then it slept again] quietly
```

One operation per word instead of ten. This is why a 21 GB scan takes about 50 minutes on
one CPU core instead of most of a day.

### The one design decision that matters most

**Index the small side. Stream the big side.**

The benchmark is a few megabytes. The corpus is gigabytes or terabytes. So Ingot builds its
lookup table from the *benchmark* and streams the *corpus* past it, once.

The best-known alternative tool does the reverse — it indexes the corpus — and reports
**nine days** for a similar job. Same idea, opposite way round, and the difference is
enormous.

---

## Why 10 words?

The window length is the single most important setting, and it is a trade-off in both
directions.

**Too short — say 3 words.** `"one of the"` appears in millions of documents. Everything
matches everything. You drown in noise.

**Too long — say 20 words.** Now one typo, one changed comma, one reworded clause breaks
the match completely. Worse: any question *shorter* than 20 words produces **no windows at
all**, so it can never match anything — and the scanner will cheerfully report it clean
without ever having looked at it.

**Ten is the measured sweet spot**, and "measured" is the point — we ran 8 through 13 and
published the whole table in [`measurements.md`](measurements.md).

The field has used 13 since GPT-3 did in 2020. Nobody appears to have re-checked. At 13,
**6.8% of a benchmark is too short to scan at all**. At 10, it's 0.3%.

---

## The part most tools get wrong

Here is a real match Ingot found in C4:

```
MMLU question  ...give me liberty or give me death!?- Patrick Henry...
C4 document    ...give me liberty or give me death!?- Patrick Henry...
```

Ten identical words. A perfect match.

**It means nothing.** That's Patrick Henry in 1775. MMLU quotes it because it's asking a
history question. C4 contains it because it's on half the internet. Nothing leaked.

Now consider what a tool that only prints a percentage would tell you:

> *2.4% of MMLU is contaminated in C4*

That number is **wrong**, and you would have no way of knowing, because you never saw the
words behind it.

So Ingot has one hard rule:

> **Every match is shown with the text around it. Never a bare score.**

You look at the words and decide. The tool finds candidates; the judgement stays yours.
This is why reports are readable documents rather than a number, and it is the single most
important thing about how Ingot is designed.

---

## Using it — three ways

### 1. In your browser (easiest)

Go to **[the scanner](https://ingot-six.vercel.app/)**, drag your file in, read
the results.

Your data never leaves your computer. Not a promise — a fact you can check: open your
browser's Network tab before you scan and watch it stay empty. There's no server to upload
to.

No account, no install, no download.

### 2. On the command line

```bash
npx ingot-scan contaminate --index gsm8k --corpus yours.jsonl
```

That's the whole thing. No clone, no install, no benchmark download — GSM8K and HumanEval
ship inside the package.

Useful extras:

```bash
--index mmlu             # or humaneval, gsm8k, or a path to any published index
--out report.html        # a self-contained file you can email someone
--json report.json       # machine-readable, for scripts
```

### 3. Automatically, on every commit

Drop the GitHub Action into your repo and every push gets scanned. See
[`github-action.md`](github-action.md).

### The file format

**JSONL** — one JSON object per line, each with a `text` field:

```json
{"id": "doc-1", "text": "Whatever your document says."}
{"id": "doc-2", "text": "One line per document, no commas between them."}
```

That's it. If your `id` field is called something else, use `--id-field`. Same for
`--text-field`.

---

## How to know whether to believe it

Every report ends with a **receipt**:

```
RECEIPT — everything needed to reproduce this
  scanner        ingot-0.1.0, index format 3
  index          humaneval · n=10 · stride 1 · 10,277 grams
  benchmark hash b3d1c0d1b5b2d0f595501d1dfef4a6a1
  corpus         mine.jsonl · 165 bytes · 1 docs
  corpus sha256  b672adfd43feb936e53266ed11d132b8...
  command        npx ingot-scan contaminate --index humaneval --corpus mine.jsonl
```

Anyone you hand that to can re-run it and get the same answer, without asking us for
anything. **That's what makes it evidence rather than an opinion.**

The reports also tell you what *couldn't* be checked — questions too short to produce any
10-gram. A tool that quietly skips those and says "clean" is lying to you by omission.

---

## The four things worth remembering

1. **The problem:** if the test was in the study material, the score is meaningless.
2. **The method:** index the small side, stream the big side, once.
3. **The window:** 10 words. Shorter is noise, longer misses things and silently skips
   short questions.
4. **The rule:** always read the matched words. A match is a candidate, not a verdict.

---

## Where to go next

- **[Three ways contamination scanning silently fails](silent-failures.md)** — what we
  found scanning 21 GB of real training data, including the ways this method quietly gets
  it wrong.
- **[How every number was measured](measurements.md)** — every figure we publish, and every
  mistake we made getting there, including two we had to retract.
- **[The threat model](threat-model.md)** — what Ingot cannot do, and where a determined
  vendor still wins.
