# Design System — Ingot

Created 2026-07-29 by `/design-consultation`. This documents the system the site
**already had**, plus the typography added on the same day. It was written after looking
at the rendered pages, not after reading the CSS — an earlier draft was built from
computed styles alone and got the page badly wrong.

## Product context

- **What this is:** a contamination scanner. Point it at a benchmark and a training corpus
  and it tells you whether the test questions are in the training data, showing the
  matching text rather than a score.
- **Who it's for:** ML engineers and eval teams about to publish a benchmark number.
- **Space:** developer tooling and eval infrastructure. Peers: Semgrep, Trivy, Grype,
  Weights & Biases, Hugging Face.
- **Project type:** static site, no backend. The scanner **is** the front page.

**The one thing to remember:** *it shows you the words.* Every other tool gives you a
percentage. Every design decision below serves that.

## Aesthetic direction

- **Direction:** forensic editorial. The page should read like an assay certificate or a
  lab report, not a SaaS dashboard. An ingot is a bar of metal stamped with its measured
  purity; the product is the stamp.
- **Decoration:** minimal. Typography and one accent carry it. No gradients on the tool
  page, no icon-in-circle grids, no cards that exist only to be cards.
- **Category note:** Semgrep, Astral and W&B all lead with a marketing headline. Ingot
  leads with the working tool. That is the structural differentiator — **do not "fix" it
  by adding a hero section above the scanner.**

## Typography

Self-hosted in `web/fonts/`, latin subset only, **42 KB for both**. Same-origin on purpose:
a CDN font is a third-party request, and this site's claim is that the network panel stays
empty. Both SIL OFL, attributed in `NOTICE`.

| Role | Face | Notes |
|---|---|---|
| Display (h1, section h3) | **Instrument Serif 400** | High-contrast serif in a category of grotesques. Says "document". |
| Body / UI | system sans stack | Deliberate: body text should disappear. |
| Evidence, receipts, hashes, stats | **JetBrains Mono 400** | Matched text, corpus hashes, the receipt block. |

**Rules learned the hard way:**
- Instrument Serif has **no bold**. Asking for 600+ draws a synthetic bold. Use 400.
- It is naturally narrow. `letter-spacing: 0` at heading sizes; only h1 at ~59px can carry
  `-.015em`. The `-.02em` that suited the old grotesque closes its counters up.
- `font-display: swap` so text is readable before the font lands.

## Colour

Restrained: one accent, used as a mark and never as a fill.

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--paper` | `#fbfaf7` | `#0e0d09` | ground; warm, reads as paper not app-white |
| `--ink` | `#16150f` | `#f2efe4` | body text |
| `--dim` | `#6d6a5c` | `#9a968a` | secondary, and **what was not checked** |
| `--line` | `#ddd9cc` | `#2b281f` | rules and borders |
| `--gold` | `#9a6a00` | `#e0aa3e` | the stamp. Section kickers only. Never a fill. |
| `--ember` | `#d2451e` | `#ff7a4d` | findings that need reading |
| `--ok` / `--bad` | `#2f6b34` / `#8f2f22` | `#7fbf85` / `#e2887a` | verdict states |

Gold is the differentiator: the category runs blue, purple and green. It is on-name and
unclaimed. It only works if it stays rare.

## Layout

- **Hybrid.** Scanner controls are grid-disciplined and deliberately boring — someone
  dropping a confidential corpus needs that part to feel safe, not clever. Prose sections
  are editorial, single-column, generously spaced.
- **Max content width:** ~66rem shell, ~54ch for prose. Long lines destroy readability of
  matched text.
- **Border radius:** small and consistent. Rounded-everything reads as toy.

## Motion

Minimal-functional. Scan progress and results arriving. Nothing else. Bouncy motion on a
trust product undermines the trust.

## Hard constraints

1. **Zero external network requests.** No CDN fonts, no analytics, no remote images. The
   privacy claim is that the network panel stays empty during a scan, and it is checkable
   in thirty seconds. `pages.yml` asserts this — a page referencing `https://` outside
   github.com fails the build.
2. **No framework, no build step beyond `scripts/build-web.ts`.**
3. **Numbers on any page must trace to `results/`.** `scripts/check-published-numbers.ts`
   gates this in CI across the README, the docs and `web/index.html`.
4. **Every host runs the same gates.** Gates 1–3 are *checks*, not properties of the HTML,
   so a host that builds the site its own way would publish pages that passed none of them.
   They therefore live in `scripts/check-site.ts` and `scripts/check-published-numbers.ts`,
   and both hosts call the same two files. Adding a host means calling them, not
   reimplementing them.

## Deployment

Two hosts, one build definition, identical gates:

| | build | gates |
|---|---|---|
| **Vercel** (primary) | `scripts/vercel-build.ts` via `vercel.json` | `check-site.ts` → `check-published-numbers.ts` |
| **GitHub Pages** | `.github/workflows/pages.yml` | the same two scripts |

Both fetch benchmarks, build the bundle and indexes, build the registry page, then refuse
to publish if either gate exits non-zero. Run `node scripts/vercel-build.ts` locally to
reproduce exactly what the host does.

Vercel is primary because it sits alongside the other projects in one dashboard, and
because **it can set response headers, which GitHub Pages cannot at all.** That turns the
first hard constraint from a build-time assertion into something the browser enforces:
`vercel.json` sends a CSP of `default-src 'self'` with `connect-src 'self'` and
`font-src 'self'`, so a third-party request does not merely fail review — it fails to
happen. For a product whose claim is *check this yourself*, having the browser enforce the
claim is worth more than the build asserting it.

The CSP was verified against the real page served with those exact headers: no forms
(so `form-action 'none'` is safe), no inline event handlers, no `<base>`, and the report
download is an `<a download href="blob:">` click, which is not subject to CSP fetch
directives. A tracked reload logged zero violations.

Vercel's build cache cannot be configured — the docs are explicit that you cannot choose
what is cached, and what persists is `node_modules/**`. So `vercel-build.ts` stages the
benchmarks in `node_modules/.cache/ingot-bench`. Without it, every deploy re-downloads MMLU
from HuggingFace and a rate-limit there becomes a failed deploy of a site that did not
change. It is a cache, so every failure path falls through to fetching.

## Open, not yet done

- The four "What Ingot refuses to do" items are uniform bordered boxes — the one generic
  moment on the page. Would be stronger as a numbered list with the ember lead-in, no box.
- `about.html` keeps its molten-gradient h1. It now uses the same two faces, but it is a
  more expressive page than `index.html` and the two have not been reconciled.
- The results view still presents matches in a compact list. The strongest version makes
  the matched passage the largest designed element on the page — a pull quote with the
  matched span highlighted — since that is the product's whole thesis. Not built.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-29 | Keep the existing palette and layout | Looking at the rendered page showed it was already coherent and category-distinct. The proposal to redesign was based on computed styles, not the page. |
| 2026-07-29 | Instrument Serif + JetBrains Mono, self-hosted | The system font stack was the only undesigned thing on the page. Self-hosting keeps the network panel empty. |
| 2026-07-29 | Serif at weight 400, no negative tracking below h1 | The face has no bold and is narrow; the old grotesque's settings produced synthetic bold and closed counters. |
| 2026-07-29 | Front page carries the C4 findings | The site advertised the old null result while the 21.33 GB scan and the report were invisible to visitors. |
| 2026-07-29 | Vercel is primary; the gates move out of the workflow | Superseded a same-day entry that made Pages the only host. That entry was right that an ungated second host is a liability and wrong about the fix: the problem was never *which* host, it was that the gates lived inside one host's workflow as inline bash. Extracting them to `check-site.ts` removes the objection entirely, and Vercel then wins on two things Pages cannot do — one dashboard with the other projects, and response headers. |
| 2026-07-29 | CSP enforces the no-third-party-request claim | The claim was previously only asserted at build time. A header makes the browser enforce it, which is a stronger guarantee than a check the visitor has to trust. Only possible because the host can set headers. |
