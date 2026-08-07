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

- **Direction:** Cleanroom Instrument — dark-first metrology. The page is an oscilloscope,
  not a SaaS. Function-first, data-dense where evidence lives, hairline-ruled, zero
  decoration that is not an instrument marking.
- **Decoration level:** minimal. Rules, tabular numerals and one calibrated signal colour
  carry everything. No gradients, no glass, no glow, no icons, no photography, no cards.
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
  chassis is achromatic; signal-green appears only on verified/clean states, signal-amber
  only on findings that need reading. Never colour-alone: every state colour is paired
  with a mono label, so no meaning is lost to colour-blindness or grayscale print.

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

| Token | Dark (default) | Light | Meaning |
|---|---|---|---|
| `--ground` | `#0C0E0F` | `#F4F5F4` | graphite bench / lab daylight |
| `--panel` | `#121415` | `#FFFFFF` | instrument panel surface |
| `--text` | `#E8EAEC` | `#16181A` | primary |
| `--mut` | `#82878C` | `#5D6165` | secondary, and what was not checked |
| `--rule` | `#2A2E31` | `#D9DBDA` | hairlines — the entire layout system |
| `--ok` | `#4ADE80` | `#15803D` | verified / clean. The only green anywhere. |
| `--sig` | `#F59E0B` | `#B45309` | findings that need reading; never a fill |
| `--bad` | `#F87171` | `#B91C1C` | refusals and errors only — never verdicts |

Dark is the identity; light is a designed inverse, not an inversion filter. Saturation
drops ~15% in light mode. Verdicts use `--ok`/`--sig` (a clean scan is calm, not a
celebration); `--bad` is reserved for the machine refusing to answer.

## Layout

- **Grid-disciplined everywhere.** The instrument panel (scanner) and the records
  (tables, registry) share one ruled grid; prose sits in a 60–66ch measure.
- **Shell:** ~68rem; rem-based throughout, root font-size scales fluidly past 94rem
  (16 → 19.5px cap) — the ultra-wide rule from v1 carries over verbatim.
- **Border radius: 0.** An instrument has machined edges. The single exception is the
  focus ring's native rounding.
- **The readout strip** replaces v1's receipt rail concept in spirit: a mono
  data strip (corpus, hash, tokens, flagged counts, `uploaded: 0 bytes`) pinned near the
  scanner. Same law as v1: it may never hold the only copy of a fact.

## Motion

Minimal-functional. An instrument settles; it never performs.

- Verdict counts to its value once (ease-out, ≤500ms). Progress is a 1px thread.
- The status dot is the only loop — it is a status light.
- Everything honours `prefers-reduced-motion`; the no-JS page loses motion, never content.
- Scroll-reveals, if any survive implementation, must live inside `@media screen` —
  print renders the un-scrolled state (v1 lesson, e2e S7 asserts it).

## States

Carried over from v1 as law, restyled not rethought:

- Failure is designed: refusals open with a 4px `--bad` rule, the cause in plain words,
  one action that helps. Raw error strings never reach the page alone.
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
