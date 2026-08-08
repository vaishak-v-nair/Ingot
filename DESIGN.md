# Design System — Ingot

Created 2026-08-01 by `/design-consultation`, superseding the forensic-editorial system
(archived with its full decisions log at `docs/design-archive-2026-07-forensic-editorial.md`
— its operational lessons still apply wherever this file does not overrule them). The
redesign was a deliberate fresh start, chosen by the founder from three rendered
directions after competitive research and an independent outside design voice.

## Product context

- **What this is:** a scanner that finds exact text inside public AI training corpora and
  shows the overlap verbatim, with a receipt. Two front doors onto one engine: a person
  asking whether their own published writing is in there, and an eval team asking whether a
  benchmark is.
- **Who it's for:** **writers first** — someone who published online and wants to know
  whether their sentences are inside the data an AI learned from. Eval teams and the people
  who buy model claims are the institutional wing, served by the registry and the CLI.
  <br>*Corrected 2026-08-07. This file said "ML engineers and eval teams" from the day it
  was written — which was 2026-08-01, the same day the product reframed to lead with the
  personal check. The site inherited the mismatch and kept it for six days: a writer's
  headline sitting above an engineer's primary control, with the writer's own path a text
  link two-thirds down the page. A design system specified for the audience the product no
  longer leads with will keep producing correct-looking answers to the wrong question.*
- **Space:** developer tooling / eval infrastructure. Peers measured 2026-08-01: Linear,
  Stripe, Semgrep, Raycast, Vercel (screenshots in the design consultation record).
- **Project type:** static site, no backend. The working scanner is **on** the front page
  and runs itself on arrival — it is the proof, not the ask. (It *was* the front page until
  2026-08-07; see the amended category note.)

**The one thing to remember:** *this is a live instrument, not a brochure — every
coloured pixel is a measurement.*

## Aesthetic direction

- **Direction: PAPER**, adopted 2026-08-07, replacing Cleanroom Instrument (dark graphite,
  hairline rules everywhere, radius 0, no surfaces — archived in the decisions log below).
  Warm paper ground, ink text, one accent, generous air. Still an instrument and still not
  a SaaS: the change is that the instrument is now legible, because the thing it publishes
  is meant to be *read* by a novelist and not only scanned by an engineer.
- **Three rules carry the whole system**, and `web/site.css` is written to them:
  1. **Space separates, not lines.** There is almost no border in the stylesheet. Sections
     are told apart by the room between them. A rule is a last resort. The two that earn
     their place are a table's row separators (the eye has to track across a table, and
     space cannot do that) and the dropzone's dashed edge (a drop target has to look like
     it has an inside).
  2. **One spacing scale.** `--s1: .5rem` through `--s8: 8rem`. Every margin and padding is
     a step on it. Nothing is hand-picked. This is the thing the old system never had, and
     its absence is what made every page feel arbitrary.
  3. **Surfaces, not fences.** Content that needs setting apart sits on white with a soft
     shadow at a 16px radius, never inside a box drawn with a line.
- **Decoration level:** minimal, but *air* is not decoration. No gradients except the one
  that draws the highlight, no glass, no glow, no icons, no photography.
- **The signature is the strike.** The one gesture this product owns: matched words marked
  the way a reader marks them, in `--accent-wash`, swept left to right when they arrive.
  It is on the wordmark, on the exhibit, on every match on every page, and on the emailed
  report. It is defined **once**, in `web/site.css`. A second definition of it anywhere is
  a defect — that is exactly how the front page ended up drawing two different highlights
  for the same thing on 2026-08-08.
- **Category note, amended 2026-08-07:** every peer leads with a marketing headline. Ingot
  leads with **evidence** — a real finding, marked, at reading size, before any pitch. The
  working tool is still on the page and still runs itself on arrival, but it is now the
  *proof of the offer* rather than the offer. **The working tool leads as evidence; the
  offer leads as action.**
  <br>The original form of this law — "Ingot leads with the working tool, do not add a hero
  above the scanner" — was written for engineers, for whom the scanner *is* the offer. Held
  literally after the reframe it produced a page that asked a novelist's question and then
  handed her a JSONL dropzone. What survives unchanged: a screenshot of the product would
  still be absurd, and no marketing hero goes above anything. An exhibit is not a hero —
  it is the product's output, shown.
- **Colour is testimony:** a chromatic pixel is a claim backed by a measurement. The
  chassis is achromatic; the tokens and what each one is allowed to mean are in **Colour**
  below, which is the single authority.

## Typography

Self-hosted in `web/fonts/`, latin subset, SIL OFL, attributed in `NOTICE`. Same-origin
because the network panel staying empty is the product's claim.

| Role | Face | Notes |
|---|---|---|
| Display (h1, section heads) | **Archivo** 600, tight tracking (−.03em at hero sizes) | Neo-grotesque with enough character to not be Inter; variable file keeps weight range cheap. |
| Body / UI | **Public Sans** 400/500 | Built for US government records — reads like a filing, not a landing page. |
| Evidence, receipts, hashes, tables | **JetBrains Mono** 400/700 | Kept from v1 for measured reasons: best 0/O/1/l/I disambiguation of any OFL mono; hashes are first-class content. |

**Scale — instrument panel:** `12.5 / 13.5 / 17 / 28 / 44 / clamp(2.6rem, 5.2vw, 4.5rem)`.
Two-line hero maximum. Evidence at 13.5 mono; captions and readouts at 12.5 mono with
`.1em`+ letter-spacing and uppercase; body 17. Hierarchy leans on weight, colour and rules
more than size — the Linear lesson from the research.

## Colour

Defined once, in `web/site.css`. Anything that names a colour anywhere else — a page's
local `<style>`, a generator, the emailed report — must resolve to a token from this table,
and `test/report.test.ts` reads `site.css` and asserts the report's values match it.

| Token | Value | Meaning |
|---|---|---|
| `--paper` | `#FBFAF8` | the ground |
| `--white` | `#FFFFFF` | surfaces — cards, panels, the receipt |
| `--ink` | `#12100E` | primary text |
| `--dim` | `#6F6A63` | secondary, and what was not checked |
| `--line` | `#E7E3DC` | rare, and never structural |
| `--wash` | `#F3F0EA` | a tint, for bands and code blocks that recede |
| `--accent` | `#D4541E` | **evidence and action, and nothing else** |
| `--accent-wash` | `#FBD9C7` | the strike |
| `--accent-soft` | `#FCEFE8` | the tag/label pill |
| `--ok` | `#1F6B3E` | verified / clean. The only green anywhere. |
| `--bad` | `#B3261E` | refusals and errors only — never verdicts |

**Light only, deliberately** (2026-08-07). A dark inverse was written and removed: the
complaint that produced PAPER was that the site read as unchanged, and the thing it had
been was dark. A designed dark mode is a second document to keep true; an inferred one is
a document nobody looked at. If one is wanted it has to be designed and *looked at*.

**Colour is testimony** — unchanged as law, and the accent is the thing most easily spent.
It went to every digit in every table for a day, at which point it meant nothing at all.
Verdicts use `--ok` and `--accent`; `--bad` is reserved for the machine refusing to answer.
Never colour-alone: every state colour is paired with a mono label, so no meaning is lost
to colour-blindness or greyscale print.

## Layout

- **One shell, `72rem`**, `min(72rem, 100% - 3rem)`. `.wrap` centres; **`.page` does not** —
  a band that changes the ground has to reach both edges of the window.
- **Reading measure** 52–64ch for prose. Records (tables, the scanner, the film) take the
  full shell.
- **Border radius: `--r`, 16px**, one value. (Was 0 under Cleanroom.)
- **Surfaces carry two shadows**, `--shadow` and `--shadow-sm`. There is no third.
- **The receipt rail sits beside the instrument that produces it**, not beside the page.
  It was a page-tall margin column for six days: filled for the first 900px, then an empty
  20rem track ran the remaining eight thousand. Same law as always — it may never hold the
  only copy of a fact, which is what makes it safe to drop below `64rem` rather than
  reflow.
- **Every panel is padded.** `.tool` had a background, a shadow and no padding at all, and
  that single missing declaration is most of what a reader described as "clustered".

## Motion

An instrument settles; it never performs. Two gestures, both borrowed from what the tool
does — content **settles** (arrives from below and stops) and the highlight **strikes**
(sweeps left to right). Defined once in `web/site.css` and shared by every page.

- The opening plays **once on load**, in reading order — label, specimen, strike, headline,
  offer. Everything else reveals on scroll.
- Verdict counts to its value once (ease-out, ≤500ms). Progress is a thread, not a bar.
- The status dot is the only loop — it is a status light.
- Everything honours `prefers-reduced-motion`, and every hidden pre-reveal state is keyed
  on a `.js` class the script adds — a page whose script never runs shows the finished
  state, never blank paper. The no-JS page loses motion, never content.
- Scroll-reveals live inside `@media screen`: print renders the un-scrolled state
  (v1 lesson, e2e S7 asserts it).
- **A container holding a live control is never a reveal target.** `#scan` is excluded by
  name, because a container that starts at `opacity: 0` can hide a working tool if its
  observer never fires.

## States

Carried over from v1 as law, restyled not rethought:

- Failure is designed: a refusal fills its surface with `--bad-soft`, states the cause in
  plain words, and offers one action that helps. It is the only place in the system where
  a colour fills a surface, and that is the point — it must not be possible to skim past a
  refusal as though it were a low number. Raw error strings never reach the page alone.
- Zero readable documents is a refusal, never a verdict. The green 0 is reserved for
  scans that read something.
- Nothing about the evidence is silent: skipped lines, capped matches, filter discards
  all render or unfold. Long scans are escorted (cancel, ETA, leave-guard, worker).

## Hard constraints (unchanged — these are the product)

1. **Zero external network requests.** No CDN fonts, analytics or remote images;
   CSP-enforced in deployment (`default-src 'self'`), checked by `scripts/check-site.ts`.
2. **No framework, no build step beyond `scripts/build-web.ts`.**
3. **Every number on any page traces to `results/`** — `scripts/check-published-numbers.ts`
   gates exact substrings; a load-bearing phrase may never line-wrap mid-figure.
4. **The gates are host-independent** (`check-site.ts`, `check-published-numbers.ts`);
   deployment facts (Vercel, CSP headers, build cache) are documented in the archived v1
   file and remain accurate.

## Implementation contract for the redesign

- Restyling may not move a gated phrase: run `build-registry-page.ts` +
  `check-published-numbers.ts` after every structural edit.
- The e2e suite (25 checks) asserts behaviour and key DOM hooks — keep functional ids
  and classes stable, or update `e2e/` in the same commit.
- The tour, the guidance video, the worker scan flow, gzip handling and all refusal
  states are product behaviour, not decoration: the redesign restyles them, never drops
  them.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-01 | Fresh redesign; forensic editorial archived | Founder direction ("re-design the entire website", everything reconsidered). Research: warm-paper+serif+gold has become a common AI-default look in 2026; the site read "research notebook" rather than venture-grade instrument. |
| 2026-08-01 | Cleanroom Instrument over OVERPRINT | Founder chose C from three rendered variants (OVERPRINT light/dark, Cleanroom). OVERPRINT's stain concept recorded in the consultation output as reusable material for evidence rendering if ever wanted. |
| 2026-08-01 | Archivo / Public Sans / JetBrains Mono | Neo-grotesque with character (not Inter-class), government-filing body register, and the v1 mono kept on measured legibility grounds. All OFL, self-hostable. |
| 2026-08-01 | Green only for verified-clean; amber for findings; red only for refusals | Colour as testimony. Verdicts never celebrate and never use the red/green axis alone; every state colour pairs with a mono label. |
| 2026-08-01 | Radius 0, hairline rules, no cards | An instrument has machined edges; v1's no-cards law survives the aesthetic change because it was never aesthetic. |
| 2026-08-02 | The rail flows with the page — never sticky, never its own scroller | Founder decision: a pinned rail taller than the viewport needs an inner scrollbar, which cut hashes off and put a second scrollbar inside the instrument. Full visibility beats persistence; every rail figure also lives in the body, so nothing is lost when it scrolls away. |
| 2026-08-03 | Exactly one landmark: the registry's thesis sentence, `.landmark` | Every section ran kicker → heading → prose → record at one scale, so a scrolling reader's eye stayed level even at the sentence the registry exists to deliver. It now breaks there and nowhere else — 2.4rem against a 1.95rem heading ceiling and a 3.4rem hero, weight 600 against the headings' 400, re-measured to 36ch because large type needs a shorter character measure (physically wider than the 56ch prose column, so the change is of measure as well as scale). Two lines, the same ceiling the hero keeps. Hairline rules rather than a panel: an instrument marks a reading, it does not frame it. **No colour** — colour is testimony and belongs to measured states; this is a claim *about* measurements, not one of them. Closes the last open compositional item (deferred by decision 7.5B of the 2026-07-30 review so it would be designed against the page as it actually is). **There must never be a second one:** a page with two landmarks has none. |
| 2026-08-07 | **Writer-first front door.** Primary action is "Check my writing"; the live scanner demotes from offer to proof | The page asked a writer's question above an engineer's primary control, with the writer's path a text link at line 446. Not a taste call: the week-3 kill rule counts *"10 inbound requests through a pinned contact link"*, so with the link buried a zero would have measured the layout rather than the demand — killing the product on a reading of its own scroll depth. The auto-running scan already existed and was free proof; it now argues for the offer instead of being it. |
| 2026-08-07 | Direction **C — THE SPECIMEN**: an exhibit leads, the h1 is its caption | Chosen from three directions built as real HTML (A THE RECORD, B THE FIELD, C THE SPECIMEN — kept in `~/.gstack/projects/vaishak-v-nair-Ingot/designs/`). C performs the differentiator instead of describing it: a marked paragraph before any pitch is the one thing no competitor page can copy without building the scanner. B was rejected on honesty — its input implied a backend that does not exist. Two fixes were required before adoption and both are in: the offer shares the first viewport (an earlier draft pushed it below 744px, the same burial defect committed differently, now enforced by e2e S9 at 1366×768 and 390×844), and the specimen is labelled **Illustration** because it is composed prose. Presenting it as a real finding would be the exact overclaim every gate here exists to prevent. |
| 2026-08-07 | A `mailto:` gets designed states: expectation before, confirmation on return, fallback address, and a real sample report | A mailto has no states. The click hands off and the page says nothing — and a visitor with no mail handler sees nothing happen and has no address. An undesigned success state suppresses exactly the costly acts the five-writer bar measures, so a broken control would read as "writers did not want this". The sample report is generated from the real renderer (`web/sample-report.html`), so what a writer is shown before spending an email is what they would receive after. CSP `form-action 'none'` keeps this from quietly becoming a form. |
| 2026-08-07 | `about.html` becomes the trust page: **what Ingot cannot see** | `docs/coverage.md` — unsegmentable scripts, the n-gram floor, what C4's own cleaning already removed, pages never crawled, verbatim-only — is the strongest honesty asset in the project and it was unpublished. Nobody else in this category tells you what they cannot see. The displaced provenance material gets `for-eval-teams.html` rather than deletion. |
| 2026-08-07 | The design system stops being three copies: `web/site.css` | Tokens were triplicated and had already drifted — each page defined only the subset it used, and about.html called the verified-clean green `--good` while DESIGN.md and index.html called it `--ok`. Nothing was broken, which is the point: nothing would have been until the copies disagreed about something that mattered. The emailed report is the cautionary case, two systems behind for two releases because it was a copy nobody remembered. Same-origin, so the network-panel claim is untouched; a `<link>`, so there is still no build step. `registry.html` keeps `body { font-size: 16px }` as an explicit override — DESIGN.md's scale says 17, and that reconciliation is a design decision left open. |
| 2026-08-08 | **PAPER is enforced, not described.** `web/site.css` is the only place a colour, a highlight or a spacing step is defined; `test/report.test.ts` reads it and fails if the emailed report names different values | The report had now been left behind by two consecutive redesigns — warm-paper-and-gold while the site was graphite, then graphite while the site turned to paper — and each time for releases, and each time the test that was supposed to catch it asserted *literal hex values*, which were correct on the day they were written and tied to nothing. A test that hardcodes the thing it is guarding is a test that certifies drift. |
| 2026-08-08 | Every panel is padded; the report leaves the panel; the receipt sits beside the instrument | `.tool` had a background, a shadow, and no padding at all, so the scanner's every line and the whole 2,500px report it renders ran edge to edge and out the right side of a white slab. The receipt rail headed a two-track grid whose second track was empty for eight thousand pixels. Read as a list of complaints this was "clustered, unorganized, texts overflowing"; read as code it was one missing declaration and one grid in the wrong place. |
| 2026-08-08 | The scanner moves above the film; the film gets a band and a plate | A visitor met a black video rectangle on a paper page before they met the working instrument, which is the one thing on this site no competitor can copy without building it. The darkness is not a defect — it is a film — but pasted flat on paper it read as an element nobody styled. Mounted on an ink plate inside a `--wash` band, it reads as a screen. |
| 2026-08-08 | Motion is a system, not a page: settle and strike, in `site.css`, shared by all four pages | The reveal existed only on `index.html` and `registry.html`, keyed on selectors each page happened to use; `about.html` and `for-eval-teams.html` had no script at all and therefore no motion. Two gestures now, both borrowed from what the tool does, defined once, and both inside `prefers-reduced-motion: no-preference`. The opening is the one orchestrated moment and it plays once, on load, in reading order. |
| 2026-08-08 | `web/sample-report.html` is generated by `scripts/build-sample-report.ts`, and CI refuses any hand edit | It is the artifact a writer is shown *before* deciding to spend an email, presented as an example of what they would receive. It was made by hand once and then edited by hand, so it could drift from the real renderer and nothing would say so. The generator refuses to write if either "sample" label fails to apply: an unlabelled sample report is a fabricated finding, which is the exact overclaim every gate in this repository exists to prevent. |
