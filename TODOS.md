# TODOS

Design and product debt, recorded with enough context that a session three months from
now understands the motivation. Each item came out of a review; none is a guess.

## In-browser gunzip for .gz corpora

- **What:** Stream `.gz` corpus files through `DecompressionStream` in the browser scan
  path, so a dropped C4-style shard scans directly instead of being refused.
- **Why:** Real training corpora ship as gzipped shards — the registry itself scanned 26
  of them. Today the browser refuses `.gz` with an honest message naming the workaround
  (gunzip first, or `npx ingot-scan`, which reads .gz natively).
- **Pros:** The flagship 20 GB story works with the files people actually have, no
  two-step workflow.
- **Cons:** Scanner-core change with its own test surface; memory behaviour on huge
  shards needs measuring before it ships.
- **Context:** Surfaced by the 2026-07-30 design review (finding 1.1c): a `.gz` file used
  to decode to garbage, skip every line, and render a clean verdict. The refusal state
  shipped the same day; this item is the real fix. The plumbing precedent lives in
  `src/contamination/indexCodec.ts` (`gunzipIfNeeded`), which already decompresses the
  published indexes in the browser.
- **Depends on:** nothing.

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
