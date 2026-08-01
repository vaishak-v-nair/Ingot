# TODOS

Design and product debt, recorded with enough context that a session three months from
now understands the motivation. Each item came out of a review; none is a guess.

## One landmark moment in the front page's section rhythm

- **What:** Choose ONE front-page moment to break the kicker → serif heading → prose →
  record metronome — a deliberate change of scale or measure — without violating the
  two-widths law in DESIGN.md.
- **Why:** Ten sections share one skeleton at one scale; a scrolling reader gets no
  landmarks. The specimen treatment proves the page can carry a scale change.
- **Pros:** Closes DESIGN.md's last open compositional item.
- **Cons:** Composition work: fresh screenshots, taste calls, probe verification.
- **Context:** Deferred by decision 7.5B of the 2026-07-30 design review, deliberately
  sequenced AFTER the built-in findings specimen shipped, so the pace change is designed
  against the page as it actually is.
- **Depends on:** the findings specimen (shipped 2026-07-30) being live long enough to
  judge.

## Worker-pool corpus scanning, and the reader unification behind it

- **What:** Parallelize CLI corpus scans across worker threads (shards are independent;
  the browser's scan.worker.js already proves the pattern), unify scan.ts's inline line
  splitter with scripts/triage-rules.ts jsonlLines, dedupe the eight flag() copies, and
  align canonicality-check.ts's reader the same way.
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
- **Depends on / blocked by:** the C4 redo completing and reconciling.

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
