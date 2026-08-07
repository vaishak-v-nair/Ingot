# TODOS

Design and product debt, recorded with enough context that a session three months from
now understands the motivation. Each item came out of a review; none is a guess.

## Worker-pool corpus scanning, and the reader unification behind it

- **What:** Parallelize CLI corpus scans across worker threads (shards are independent;
  the browser's scan.worker.js already proves the pattern), unify scan.ts's inline line
  splitter with scripts/triage-rules.ts jsonlLines, and align canonicality-check.ts's
  reader the same way.
- **Partly done 2026-08-07, and it was not blocked after all.** The flag() duplication and
  the *record* reader divergence were the two halves of this item that could be fixed
  without touching the scan chain, and both are done: `src/args.ts` is now the one argument
  parser for the CLI and the scripts (three more private copies had appeared in
  build-index, cdx-check and fetch-crawl-slice, none of which refused an unrecognised
  flag), and `src/fields.ts` is the one answer to "which field holds this record's text"
  (loader.ts and scanSession.ts had ranked the candidates differently, so one record loaded
  as two different documents depending which half of the tool read it). Measured inert on
  the published corpus before shipping: shard 00000 has 356,317 documents, **zero**
  whitespace-only and **zero** carrying more than one text field, so neither change moves a
  published figure. What remains here is the worker pool and the *line* splitter.
- **Why:** 7.0 MB/s single-threaded makes the full C4 redo a 5-6 hour run; at 10x corpora
  the registry cadence collapses. Eng review 2026-08-01, issues 5 and 7.
- **Pros:** The full redo drops to under an hour on 8 cores; hosted corpus-scan runs get
  cheaper; one reader everywhere ends the readline-vs-browser bug family for good.
- **Cons:** Corpus hashing must stay order-stable across workers — a parity test is part
  of the work, not optional. **Scoping finding (2026-08-01):** in-pass parallelism is a
  deep redesign, not a patch — doc numbering, both corpus hashes, the frequency filter's
  evidence-slot allocation and the provisional cap are all order-dependent, so bit-parity
  with published results cannot be retrofitted cheaply. Process-level concurrency
  (independent benchmark×n passes side by side, which the CLI already supports) delivers
  most of the wall-clock win at zero parity risk, and is the interim tool of choice.
- **Context:** Deliberately NOT built during the 2026-08-01 review-fix pass because the C4
  fixed-reader redo was running: later commands in that chain load scan.ts fresh, and
  editing it mid-run would mix scanner versions inside one published result.
- **Depends on / blocked by:** the C4 redo completing and reconciling — the worker pool and
  the line splitter still are. The two deduplication halves above were not, and treating
  the whole item as blocked kept a live silent-failure class (an ignored flag) alive for
  longer than it needed to be. Worth remembering when the next item is marked blocked:
  check whether *all* of it is.

## Front-page caveat parity with the README

- **What:** The README's "read this before the numbers" list gained three epistemic
  caveats (canonical is not harmless; answers are not indexed; verbatim means
  post-normalization). The front page's equivalent section should carry the same three.
- **Why:** The site is the surface most people see; a caveat that lives only in the README
  is a caveat most readers never meet.
- **Pros:** The honesty that differentiates the product stays consistent across surfaces.
- **Cons:** Front-page prose changes are design work: DESIGN.md law, gate phrasing
  checks, fresh screenshots.
- **Context:** From the 2026-08-01 eng review's outside-voice pass (threat-model.md and
  README updated the same day; the page deliberately deferred).
- **Depends on / blocked by:** a DESIGN.md-guided pass; check-published-numbers gates must
  keep passing.

## Decide the provenance scanner's future at the week-3 gate

- **What:** Decide whether the batch-provenance subsystem (src/signals/, scorer.ts,
  baseline.ts, ~12 tests, the weekly validate corpora) stays, freezes, or retires.
- **Why:** It is the largest single block of code and CI in the repo and defends the
  weakest number (50% detection floor, 13% FPR, 2023-era reference). Post-reframe,
  neither the writer story nor the contamination story consumes it. Outside-voice
  finding 4, eng review 2026-08-02.
- **Pros:** Retiring or freezing frees maintenance budget for the wedge; keeping it is
  legitimate only with a consumer named.
- **Cons:** Removal is a public-surface change (the `scan` command is documented and
  published); freezing still costs CI minutes.
- **Context:** The design doc's week-3 demand-test gate is the natural decision point —
  the demand data says which product the code should serve.
- **Depends on / blocked by:** the 5-writer demand test outcome (design doc kill rules).

## Pin GitHub Actions to commit SHAs

- **What:** Replace `actions/checkout@v4`-style mutable tags with full commit SHAs across
  the three workflows (permissions blocks landed 2026-08-02; this is the remaining half).
- **Why:** A moved first-party tag is unlikely but nonzero, and the repo publishes to npm
  with provenance — the workflows are part of the supply chain the threat model claims to
  care about.
- **Pros:** Closes the last unpinned input in the build chain.
- **Cons:** SHA bumps become manual (or Dependabot-managed) maintenance.
- **Context:** Eng review 2026-08-02, CI finding 7; low urgency, recorded so it is a
  decision rather than an accident.
- **Depends on / blocked by:** nothing.
