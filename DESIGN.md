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
   They therefore live in `scripts/check-site.ts` and `scripts/check-published-numbers.ts`
   rather than inside any one host's config. Adding a host means calling those two files,
   not reimplementing them.

## Deployment

**Vercel, at <https://ingot-six.vercel.app>.** `vercel.json` runs `scripts/vercel-build.ts`
on every push to `main`: fetch benchmarks → build the bundle and indexes → build the
registry page → `check-site.ts` → `check-published-numbers.ts`. Either gate exiting
non-zero fails the deploy, and the previous deployment stays live. Run
`node scripts/vercel-build.ts` locally to reproduce exactly what the host does.

GitHub Pages was retired once Vercel was confirmed serving. `ci.yml` still runs the tests
and `check-published-numbers.ts` on every push and pull request, so a bad commit is caught
by GitHub independently of whether the host happens to build.

Vercel over Pages for two reasons. It sits with the other projects in one dashboard — an
operational argument, and a real one. And **it can set response headers, which GitHub Pages
cannot at all**, which turns the first hard constraint from a build-time assertion into
something the browser enforces: the deployment sends `default-src 'self'` with
`connect-src 'self'` and `font-src 'self'`, so a third-party request does not merely fail
review, it fails to happen. For a product whose claim is *check this yourself*, the browser
enforcing the claim is worth more than the build asserting it. Verified live: the header is
present on the production URL, alongside `X-Content-Type-Options: nosniff` and
`Referrer-Policy: no-referrer`.

The CSP was verified against the real page served with those exact headers: no forms
(so `form-action 'none'` is safe), no inline event handlers, no `<base>`, and the report
download is an `<a download href="blob:">` click, which is not subject to CSP fetch
directives. A tracked reload logged zero violations.

Vercel's build cache cannot be configured — the docs are explicit that you cannot choose
what is cached, and what persists is `node_modules/**`. So `vercel-build.ts` stages the
benchmarks in `node_modules/.cache/ingot-bench`. Without it, every deploy re-downloads MMLU
from HuggingFace and a rate-limit there becomes a failed deploy of a site that did not
change. It is a cache, so every failure path falls through to fetching.

## Two widths, and only two

Records span the full 54rem shell: the assay strip, tables, the findings record. Prose holds
a 54–56ch measure. That contrast is deliberate and it is the whole layout system. What is
*not* allowed is a third width — a block that resolves at some arbitrary point between the
two, which is what made the page read as assembled rather than composed before the audit.

The receipt rail does not break this, and the reason is worth stating because it is the test
any future second column has to pass. **The rail is margin, not column.** Above 78.5rem the
shell widens from 54rem to 76rem and the rail takes the entire difference; the text keeps the
width it already had. Measured in the browser at a 1484px viewport, the text column runs
154→986px, so 832px against the 824px it occupied before the rail existed — eight pixels, from
the padding arithmetic, not from a decision. Nav, text column and footer share one left edge at
both sizes. Widening a shell is only safe when the text does not notice.

## Cards

Almost none, and that is the rule. Three bordered boxes in a row is the most recognisable
generated-page layout there is, and the page had two such grids. Both are now ruled records:
dividing lines instead of fences, because the boxes were decoration around content that
already had structure. If a card seems necessary, the content probably needs a rule, a
numeral, or a measure — not a border.

Two boxes survive, both in the results view: the verdict block and the sample-corpus notice.
They are listed as open below rather than quietly excused. An earlier version of this section
claimed there were none, which was wrong on the surface a visitor is most likely to look at.

## The receipt rail

A sticky annotation in the right margin, above 78.5rem only. It holds the published C4 receipt
— corpus, size, documents, tokens, n, scanner, corpus hash — then the flagged counts, then the
canonicality caveat, so the figures the argument cites stay in view while the argument is read.
During a scan it ticks: bytes read, documents, tokens, and `uploaded 0 bytes`, in ember, because
mid-scan is exactly when the privacy claim is easiest to doubt. After a scan its top block
becomes the reader's own receipt — their filename, their corpus hash, their counts — sitting
above ours for comparison. That is the part no template can contain.

**Everything in it is duplicated in the body of the page, deliberately.** The rail disappears
below the breakpoint, so an annotation holding the only copy of a fact would be a load-bearing
column that happens to vanish on a laptop. This is also why the assay strip stays even though
the rail repeats it a few centimetres away: for one screen out of the page's length, the two
overlap, and that is the correct trade for the rail being droppable.

## Open, not yet done

- **Two cards left, both in the results view.** `.verdict` and the sample-corpus notice are
  still bordered rounded boxes. The verdict block is the harder one: it is the only place a
  single number is the content, so a rule may not be enough to hold it. It is also the most
  visible thing on the page after a scan, which is the argument for fixing it rather than
  writing an exception into this file.
- **No favicon.** The tab shows a default globe. Chrome requests `/favicon.ico` and gets a 404,
  confirmed in a headless run. A same-origin SVG would satisfy `img-src 'self' data:`.
- **Section rhythm is still uniform.** Every section is kicker, serif heading, prose,
  optional record. Ten times. Nothing goes full-bleed and no scale changes between them.
  The specimen treatment proves the page can carry a change of pace; nowhere else does.
- `about.html` keeps its molten-gradient h1. Palette, measure and type now match the rest
  of the site, so this is the only remaining difference, and it is deliberate: a one-off
  hero treatment on the one page that argues rather than measures.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-29 | Keep the existing palette and layout | Looking at the rendered page showed it was already coherent and category-distinct. The proposal to redesign was based on computed styles, not the page. |
| 2026-07-29 | Instrument Serif + JetBrains Mono, self-hosted | The system font stack was the only undesigned thing on the page. Self-hosting keeps the network panel empty. |
| 2026-07-29 | Serif at weight 400, no negative tracking below h1 | The face has no bold and is narrow; the old grotesque's settings produced synthetic bold and closed counters. |
| 2026-07-29 | Front page carries the C4 findings | The site advertised the old null result while the 21.33 GB scan and the report were invisible to visitors. |
| 2026-07-29 | Vercel is primary; the gates move out of the workflow | Superseded a same-day entry that made Pages the only host. That entry was right that an ungated second host is a liability and wrong about the fix: the problem was never *which* host, it was that the gates lived inside one host's workflow as inline bash. Extracting them to `check-site.ts` removes the objection entirely, and Vercel then wins on two things Pages cannot do — one dashboard with the other projects, and response headers. |
| 2026-07-29 | CSP enforces the no-third-party-request claim | The claim was previously only asserted at build time. A header makes the browser enforce it, which is a stronger guarantee than a check the visitor has to trust. Only possible because the host can set headers. |
| 2026-07-29 | GitHub Pages retired once Vercel was confirmed serving | Not before. Removing a working deployment on the assumption its replacement works is how a project ends up with no site at all. `ci.yml` keeps the tests and the numbers gate running on GitHub regardless of the host. |
| 2026-07-29 | The matched passage is the largest element in a result | The results view rendered the percentage at 42px and the evidence at 15px, so the layout argued the opposite of the product. The first match is now the specimen at display scale; the rest stay compact. |
| 2026-07-29 | No cards anywhere | Both card grids became ruled records. Removing boxes is not a style preference here: three bordered boxes in a row is the layout a reader has already seen on a thousand generated pages, and it makes real evidence look templated. |
| 2026-07-29 | Provenance before the claim | The assay strip states corpus, size, tokens and method above the findings table. Those numbers were buried mid-paragraph, which asked anyone checking a claim to parse prose to find what it was measured on. |
| 2026-07-29 | The receipt rail is built, as margin rather than as a column | The shell widens by exactly the rail's width, so the text column moves by 8px and no reading measure changes. A second column that takes width from the text would have been a redesign; a margin is an addition. |
| 2026-07-29 | The rail becomes the reader's receipt after a scan | A static rail is a sidebar. One that fills with the visitor's own filename, corpus hash and counts — beside ours, for comparison — is content the page could not have been generated with, which is the whole brief. |
| 2026-07-29 | The rail may never hold the only copy of a fact | It is hidden below 78.5rem. Anything unique to it would silently disappear on a laptop. This is the rule that makes hiding it safe, and the reason the assay strip stays even though the rail repeats it. |
| 2026-07-29 | The corpus hash is gated by `check-published-numbers.ts` | It is the one figure a reader can use to prove two reports name the same bytes, so a stale one would claim provenance for a corpus that was never scanned. Hard constraint 3 applies to it more than to anything else on the page. |
| 2026-07-29 | Build subprocesses spawn with `windowsHide` and no shell | `execFileSync('npx', …, { shell: true })` routes through cmd.exe, which gets a console window — a window flashing open and shut for every bundle, and much worse with several builds running at once. The shell was only there because npx on Windows is `npx.cmd`; naming the file directly removes the reason for it. See `scripts/npx.ts`. |
