# Threat model

What Ingot protects, what it does not, and who it is wrong to trust. An audit tool that is
vague about its own limits is asking for the trust it exists to replace.

## What leaves your machine

**Nothing.** Not as a policy — as an architecture.

| Surface | Network activity |
|---|---|
| Browser scanner | Fetches the benchmark index from the page's own origin. The corpus is read through the File API and never uploaded; there is no endpoint to upload it to. |
| `node src/cli.ts contaminate` | None. Reads two local files and writes a report. |
| `node src/cli.ts scan` | None. |
| `scripts/fetch-*.ts` | Downloads public benchmarks and corpora from HuggingFace and GitHub. Run deliberately, never as part of a scan. |

There are no runtime dependencies, no telemetry, no API key, and no account. The browser
claim is checkable rather than promised: open the network panel before scanning and it
stays empty. That is a property no hosted service can offer, whatever its privacy policy
says, because the file has to reach the service for the service to read it.

**What this does not cover.** Your browser, your extensions, and the machine you run this
on are outside the boundary. If the page is served over plain HTTP, a network attacker can
replace the code that makes this promise. Serve it over HTTPS.

## What the hashes do and do not protect

Ingot computes three different digests, for three different purposes. Confusing them is the
easiest way to over-trust a report.

### Index identity — `benchmarkHash`

Four FNV-1a lanes over the benchmark items, 128 bits, **deliberately not cryptographic**.

- **Protects against:** scanning against a stale index after the benchmark was revised, and
  silently comparing two reports built from different versions of the same benchmark.
- **Does not protect against:** anyone who wants to forge it. Constructing a benchmark that
  hashes the same is within reach for a non-cryptographic function, and nothing here treats
  this value as a signature.

### Corpus identity — `corpusHash`

SHA-256 over a deterministic sample: the first 64 lines, every thousandth line after that,
and the exact line and byte counts.

- **Protects against:** accidental drift. A changed sampled line, an added or removed line,
  or a different file length all change the hash. Re-scanning a corpus that has moved
  produces a different identity, loudly.
- **Does not protect against:** deliberate editing. Only the first 64 lines and one line in
  a thousand are covered, so a 100,000-line corpus has 164 of its lines hashed and 99.8% of
  it untouched. An adversary who knows the rule — it is in this repository — can rewrite
  those lines freely while the hash holds, provided the line and byte counts do not move.

The sample exists because the browser's SubtleCrypto has no streaming digest, so hashing
every line would mean holding the corpus in memory. The command line has no such limit and
records a full SHA-256 as well, in `receipt.corpusHashFull`.

**If you are relying on a corpus hash to bind a claim, use the full one, from the command
line.** The sampled hash is for comparability between surfaces, not for resisting anyone.

### Gram keys — the 53-bit composite

Two independent 32-bit polynomial rolling hashes, composed into 53 bits.

- **Protects against:** nothing. This is a speed structure, not a security one.
- **Costs:** an accidental collision reports a match that is not one. At roughly 773,000
  indexed grams, a corpus of 10 million tokens has about a 1-in-1,200 chance of producing a
  single spurious hit. This is why the index keys were not shortened to make the download
  smaller: every bit removed multiplies that rate, and a false match is the one failure an
  audit tool cannot absorb.
- **Visible:** every hit displays its matching text, so a collision reads as nonsense and a
  human dismisses it in a second.

## What a published index reveals

Published indexes carry one-way hashes and item ids. **They contain no benchmark text**,
which is why they can be distributed for benchmarks whose licence forbids redistributing
the data.

That is not the same as revealing nothing. An index is a **membership oracle**: anyone
holding it can test whether a specific 10-gram they already have is present, by hashing it
and looking. So an index confirms guesses; it does not produce text.

- Recovering a benchmark item from an index means guessing its exact wording first, at
  which point you had the text already.
- Confirming that a *suspected* phrasing appears in a benchmark is genuinely possible, and
  is the meaningful disclosure. For a benchmark whose items are already public, this
  discloses nothing. For a **held-out or private** benchmark it is a real leak, and the
  index should not be published.

**Do not publish an index for a benchmark whose contents are secret.** The hashing is not
what keeps it secret.

## Adversarial trimming

The open problem, stated plainly.

A vendor who wants to pass a contamination scan can run Ingot themselves, see exactly which
items matched, and edit their corpus until nothing does. Nothing here prevents that:

- Exact n-gram matching is defeated by paraphrase. On lightly edited copies, recall at
  n=10 is 81.5% and falls as n grows — and that is against random word dropping, not
  against someone deliberately rewriting to evade a detector they can run.
- Corpus attestation binds a report to a corpus, not to the corpus that was used for
  training. A clean scan of a cleaned corpus is a true statement about the wrong file.

Two things narrow it and neither closes it: the full SHA-256 in the receipt makes a
substituted corpus detectable *if* someone independently knows which bytes were trained on,
and cross-corpus independence in the registry makes canonical text distinguishable from
leakage without relying on any single corpus.

**Ingot is a scanner, not a proof of good faith.** It is strong evidence when the scanned
artifact is the real one, and worth nothing when it is not. Any claim built on it should
say which situation it is in.

## What Ingot deliberately does not claim

- **No closed-model auditing.** Detecting contamination in a model you cannot inspect is a
  different problem needing log-probabilities most providers do not expose.
- **No per-record authorship verdicts.** The provenance scanner reports batch-level evidence
  against named references. A general AI-text detector is an arms race Ingot does not enter.
- **No verdict on whether an overlap is leakage.** Ingot reports what overlaps and shows the
  text. Canonical facts with one natural phrasing look identical to contamination in any
  count, and only the words tell you which it is. The first six registry findings were all
  canonical text; see `results/registry.md`.
- **No claim about paraphrased contamination.** It is not counted in the headline and is
  invisible to exact matching.
- **No claim about answers.** Published indexes carry questions only, so a corpus that
  reproduces every solution while paraphrasing its questions scans clean. Answer
  contamination is real contamination; Ingot does not see it.
- **"Verbatim" means after normalization.** Matches are runs of lowercased tokens with
  punctuation stripped. For prose the difference is cosmetic. For code benchmarks it is
  not: a HumanEval match is an identifier-and-word stream, with operators and structure
  invisible, so treat code-benchmark counts as weaker evidence than prose counts.
- **Canonical is not harmless.** The registry's canonicality label answers "where did this
  text come from", not "was it free to train on". A test item sourced from a public web
  page sits in web corpora as ordinary text; nobody leaked it, and a model trained there
  still saw it.

## Supply chain

Zero runtime dependencies. Node 24 executes the TypeScript directly, with no build step and
nothing installed at scan time. `esbuild` is used once, at development time, to produce the
browser bundle, via `npx` — pinned to an exact version in `scripts/build-web.ts`, so two
checkouts build the same bundle.

The attack surface of a scan is therefore Node itself and this repository. That is a
deliberate choice: a tool whose job is to tell you what is in your data should not require
you to trust a hundred transitive packages to run it.

## Reporting a problem

Open an issue for anything that produces a wrong number. A defect that makes Ingot report
contamination that is not there, or stay silent about contamination that is, is the most
serious class of bug in this project and is treated that way — every one found so far is
written up in `docs/measurements.md` rather than quietly fixed.
