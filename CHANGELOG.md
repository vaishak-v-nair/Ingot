# Changelog

Numbers quoted here trace to `results/`; defect write-ups live in `docs/measurements.md`.

## 0.1.5 — August 2026

One scan-behaviour change and a pass of failure-mode fixes. Nothing here moves a published
number, and each part was checked separately: the validation harness reproduces identically,
a two-shard C4 spot pass finds the same 57 MMLU items with the same 10 discards, and the two
reader changes were measured inert on the corpus before shipping — shard 00000 has 356,317
documents, zero whitespace-only and zero carrying more than one text field.

**Upgrade note.** If you script Ingot, an unrecognised or valueless flag now exits 2 instead
of being ignored. That is the point of the change, and it is the only way this release can
break an existing invocation — an invocation it was already answering wrongly.

- **The frequency filter now judges every gram that could still be rare, not the first
  sixteen it met.** A verbatim copy that opens with common phrasing and turns distinctive
  later handed the filter sixteen ordinary grams and was discarded whole, as "ordinary
  language", with nothing in the output to say otherwise. The rarer the opening, the more
  likely the copy — so the sampling failed hardest on exactly the case that matters. Grams
  already past the drop threshold are now discarded on sight instead of occupying a slot,
  which is exact rather than merely a bigger sample: document frequencies only grow, so a
  gram that is common when seen can never become the one that saves the run.
- Every discard still names the frequency that condemned it, including when no gram
  survived long enough to supply one.
- Receipts stamp `ingot-0.1.5`. The 0.1.3 tarball shipped indexes built by `ingot-0.1.0`
  because nothing compared the committed indexes to a rebuild; `scripts/check-index-parity.ts`
  now does, in CI, before every merge.
- Benchmarks are pinned: GSM8K and HumanEval to upstream commits, and all three asserted
  by content hash, because MMLU item ids are positional and an upstream insertion would
  silently renumber every published finding.

Then seven defects found by running the tool the way a stranger would, rather than reading
it. Every gate this project has checks outputs; none checked what happens when the input is
wrong. Written up in full as entries 14–20 of `docs/measurements.md`.

- **An unrecognised flag is now an error rather than a shrug.** `--maxdocfreq 1000`, a
  plausible typo for `--max-doc-freq`, was accepted, stored and never read: the scan ran at
  the default threshold of 5 and exited 0 with a confident report of a *different
  experiment* than the one asked for. `--out` with no value silently wrote no report at all.
  Unknown flags are refused with the near miss named, missing values are refused, a repeated
  flag is refused rather than taken last-one-wins, and every problem in one invocation is
  reported at once. `--flag=value`, `--`, and `--version` now work because people type them.
- **One answer to "which field holds this record's text".** The batch loader ranked `answer`
  above `content` and the scanner ranked `content` above `answer`, so a record carrying both
  loaded as two different documents depending on which half of the tool read it. The same
  pair disagreed about whitespace-only records, which the scanner counted as scanned
  documents contributing zero tokens.
- **A blank first record no longer condemns a file.** Field detection read record one and
  gave up on it, so a JSONL whose first row had an empty text field aborted with `no "text"
  field found. Fields present: text`. The first row is a sample, not a schema.
- **Text in a script the tokenizer cannot segment is reported as such.** Chinese, Japanese,
  Thai and the other unspaced scripts have no word boundaries to split on, so a
  several-hundred-character essay tokenizes to one token and can never be matched. The
  report called this "shorter than 10 tokens" — true of the token count, false about the
  writing. Indexes now carry the reason and both surfaces say the scan *could not look*
  rather than that it looked and found nothing. `docs/coverage.md` is the complete list of
  ways a clean result can mean that.
- **Failures that dumped Node internals now produce sentences.** A truncated index arrived
  as a bare `TypeError` carrying no message, from inside the webstreams adapter — for the
  likeliest thing to go wrong with a 5 MB download. A directory passed to `--index` exited
  on a raw `EISDIR`; an `--out` path under a regular-file parent threw away a finished scan
  on a raw `EEXIST`.
- **The HTML report is the product's own design system again.** It had kept the palette
  archived in 0.1.3, with card surfaces and 14px radii, and painted the match count in the
  colour reserved for refusals — colouring the measurement the scan exists to produce as a
  failure. Findings are amber, red means refused, and the evidence highlight is an underline
  rather than a fill so it survives greyscale printing.
- **`build-index.ts --item-noun`**, so a report about somebody's essays does not call them
  benchmark items.

Also measured, and deliberately *not* acted on: quote-style sensitivity. The tokenizer keeps
the ASCII apostrophe inside a word and treats U+2019 as a separator, and 39.1% of C4 uses one
convention against 30.0% the other. Recall after re-quoting is 68.0% at 10–24 tokens and 100%
above 25 — so folding the two together would change every gram in every index, and make
several thousand published figures unreproducible, to fix a case already near the n=10 floor.
`results/quote-style-sensitivity.json`, and the figures are gated so the decision cannot go
stale quietly.

## 0.1.4 — never published

Tagged and never released. The tag was cut for the frequency-filter change alone; by the
time the release was made, the seven fixes above were in and it was better to publish them
together than to ship a build that still ignored a mistyped flag. The `v0.1.4` tag stays
where it is rather than being rewritten. Nothing was ever installed under this number.

## 0.1.3 — August 2026

The reframe release. No scan-behavior changes: results and receipts are identical to
0.1.1 and 0.1.2.

- The site and README lead with the question everyone shares — "What's inside AI
  training data?" — with a personal check ("see which of your exact words are inside —
  or get confirmation we couldn't find any") as the front door and the benchmark
  contamination record as the institutional wing.
- Full visual redesign: the Cleanroom Instrument system (dark graphite identity, designed
  light inverse, Archivo/Public Sans/JetBrains Mono self-hosted, colour as testimony —
  green only for verified-clean). The prior forensic-editorial system is archived in
  docs/ with its complete decisions log.
- Weekly CI corpora cache now actually rotates; esbuild and this Action's npx call are
  version-pinned; triage verdict rules extracted to scripts/triage-rules.ts and tested.

## 0.1.2 — August 2026

The whole-product review release. No scan-behavior changes: results and receipts are
identical to 0.1.1.

- The build toolchain is pinned exactly — esbuild in `scripts/build-web.ts` and the npx
  call inside the GitHub Action. An unpinned tool in a reproducibility product was a hole.
- The triage verdict rules move to `scripts/triage-rules.ts` and gain tests, including
  the short-item floor artifact; the triage scripts now split corpus lines on `\n` only,
  matching the scanner (readline treats U+2028 as a line terminator; the scan does not).
- The README's test count is derived from the test files and CI-gated, after being caught
  stale at 44 while the suite ran 64.
- Weekly CI actually re-fetches reference corpora now; the cache key was immortal, so the
  drift check could never see drift.
- Epistemic caveats documented in the README and threat model: answers are not indexed,
  "verbatim" means post-normalization, and canonical is not the same as harmless.
- The provenance scanner is labelled experimental in the CLI, with its measured floor.
- New: `corpus-scan.yml` (registry-scale scans on hosted runners, artifact-only),
  SECURITY.md, CONTRIBUTING.md, and this changelog.

## 0.1.1 — July 2026

- **False-clean fix:** a scan that read zero documents now refuses (exit code 3) instead of
  reporting a clean corpus. A clean report over nothing was the worst bug this project has
  shipped.
- Skipped-line disclosure: every report states lines read and lines the parser rejected.
  Zero skips is a claim; a nonzero count is a disclosure the scan may not omit.
- Gzip parity: `.gz` corpora produce byte-identical results and the same corpus hash as
  their uncompressed form, on both surfaces.
- npm publishing moved to trusted publishing (OIDC) — no stored tokens.

## 0.1.0 — July 2026

- First release: browser scanner (nothing uploaded, checkable in the network panel), CLI
  (`npx ingot-scan contaminate`), published hash-only benchmark indexes (gsm8k, humaneval,
  mmlu), self-contained HTML reports with reproducibility receipts, GitHub Action.
