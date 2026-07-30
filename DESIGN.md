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

## Voice: two registers

The page teaches before it argues. The test reader is a smart 18-year-old who has never met
the word "benchmark", and the metaphor that carries everything is **the exam**: benchmarks
are exams, training data is the study pile, contamination is the exam leaking into the pile.

- Every section opens in plain words and earns its jargon afterwards. A term of art gets its
  plain meaning beside it at first use.
- The `#plain` section ("Start here") owns the metaphor: three numbered steps and a five-term
  glossary. New jargon anywhere on the page must either be decoded where it stands or added
  to that glossary.
- The plain layer is added **above** the expert layer, never instead of it. No measured number,
  caveat or method detail is deleted to make room for accessibility — the expert reader lost
  nothing in the comprehension pass and must lose nothing in future ones.
- **Depth folds, it does not delete.** Since 2026-07-30 the deep prose — retractions, standard
  errors, the two canonicality tests, the glossary — sits behind `details.more` ruled disclosures:
  a hairline, a mono small-caps summary, a `+` that becomes `−`. The content stays in the DOM, so
  every gated figure still traces and the expert reader is one click away, but the visible page
  reads at the density of the best product sites measured (Linear ~400 words, Resend ~610).
- **Word budget, measured not vibed:** hero ≤ 30 words; a section is one heading, at most two
  sentences of prose, and one exhibit (table, record, specimen) that does the explaining; the
  front page holds ~450 words of visible running prose. Numbers replace adjectives everywhere.

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

Heat is allowed as temperature, never as fill: a 7% ember wash sits behind the hero —
absolute rather than fixed, so the page cools as you scroll down into the record — and the
h1 cools from ink into a trace of ember at its tail, the about-page molten treatment at a
tenth the dose. An ingot is molten before it is stamped; the top of the page is the crucible
and the record below is the cooled bar.

## Layout

- **Hybrid.** Scanner controls are grid-disciplined and deliberately boring — someone
  dropping a confidential corpus needs that part to feel safe, not clever. Prose sections
  are editorial, single-column, generously spaced.
- **Max content width:** ~66rem shell, ~54ch for prose. Long lines destroy readability of
  matched text.
- **Border radius:** small and consistent. Rounded-everything reads as toy.

## Motion

Motion that settles, never bounces. The first version of this section said "scan progress
and results arriving. Nothing else," and the page it produced was judged stiff — correctly.
The replacement rule: motion is allowed exactly where it narrates measurement.

- Sections settle in beneath their rules as they enter the viewport. The rules never move;
  the content breathes in beneath them.
- The kicker's gold rule draws in a beat after its section lands.
- The verdict counts to its value — ease-out cubic, 650 ms, ending on the exact figure. A
  measurement converging, not a slot machine.
- The highlight sweeps across matched text once: the stamp striking.
- The progress bar is a gold-to-ember thread. The promise dot breathes — the only loop on
  the page, and it is a status light.
- Hover is alive but small: underlines draw in, data rows warm by 5% ember, buttons lift
  one pixel.

What keeps this from becoming the thing the old rule feared: ease-out only, every animation
runs once, everything sits behind `prefers-reduced-motion: no-preference`, and the hidden
pre-reveal state is keyed on a `.js` class the script adds — a script that never runs costs
the settling, never the content. Bounce, parallax and looping ornament remain banned.

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

**Ultra-wide is a scale, not a width.** Every dimension on the page is in rem, so past
94rem the root font size grows fluidly (16px → 19.5px, capped) and the whole composition
scales like a print page instead of floating in dead margins. Measured at 1904px before the
rule: 336px of nothing on the left, 356px on the right, 63% of the viewport used. Never fix a
wide viewport by widening a measure — text lines are in ch and must stay in their range; fix
it by scaling the page.

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

- **The guided demo ("Watch it work") exists only on the front page**, and its captions are
  hand-written English. If the scan flow gains a step, the tour's step list in `index.html`
  must gain one too — nothing checks this yet.
- **Two cards left, both in the results view.** `.verdict` and the sample-corpus notice are
  still bordered rounded boxes. The verdict block is the harder one: it is the only place a
  single number is the content, so a rule may not be enough to hold it. It is also the most
  visible thing on the page after a scan, which is the argument for fixing it rather than
  writing an exception into this file.
- **Section rhythm is still uniform.** Every section is kicker, serif heading, prose,
  optional record. Ten times. Nothing goes full-bleed and no scale changes between them.
  The specimen treatment proves the page can carry a change of pace; nowhere else does.
- **The plain-words register exists only on the front page.** `about.html` and the generated
  registry page still speak in one register, to experts. The Start-here treatment — metaphor
  first, glossary, jargon decoded in place — should travel to both.
- **The guidance video is built and live** (2026-07-29; re-cut 2026-07-30): 56.5s, voiced
  (Kokoro bf_emma) and captioned, produced from the HyperFrames project in `video/ingot-guide/`
  (source committed; re-render with `npm run render -- --quality high` there — the bare script
  renders at draft bitrate, which is the 485 kbps mistake the re-cut fixed). Click-to-play from
  a poster in Start-here — zero bytes until pressed. If the scan flow changes, the film's S4
  steps and the tour's captions both need the same edit; neither is gated yet.
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
| 2026-07-29 | One navigation, on every page | Each page had grown its own nav dialect — seven links on index, three on about ("← Back to the scanner"), three different ones on registry. Failed the trunk test on every subpage. All pages now carry the same seven links in the same order, with `aria-current` marking the page you are on. |
| 2026-07-29 | Subpages join the shell | Measured at 1904px, clicking Index → About jumped the whole site 300px right: the subpages had neither the wide shell nor the root scale. Nav and footer now widen to 76rem and the root scales past 94rem on all three pages; content stays a centered 54rem measure, which is how a document site should behave. |
| 2026-07-29 | about.html and the registry are de-carded | The front page earned "no cards anywhere" while about.html kept five card grids — including the blacklisted colored-left-border pattern — and the registry boxed its evidence. All are now ruled records; the about page's warning boxes became stamped pull quotes in the display serif. |
| 2026-07-29 | The tour auto-starts once per browser | First visit only, ~1.6s after load; flag written at auto-start so even instant skippers are never re-hijacked; Esc, Skip, or the user's own scroll ends it. Krug's forced-tour warning is honoured by making the dismissal free and the repetition impossible. |
| 2026-07-29 | A guidance video joins Start-here | Supersedes the same-day "not a video" reasoning at the user's explicit direction, and narrows rather than reverses it: the tour remains the primary demo because it runs the real scanner; the video (HyperFrames, voiced, captioned, self-hosted, click-to-play) serves the visitor who wants to watch before touching anything. |
| 2026-07-29 | The guided demo is the live scanner, not a video | A recording would rot the moment the page changed, weigh megabytes against a zero-network budget, and show a scan instead of doing one. "Watch it work" moves a gold ring across the real controls, runs the real sample scan at step three, and advances itself when the results exist. Always current, zero bytes of media, CSP untouched. |
| 2026-07-29 | Favicon: an ingot as a data: URI | Gold trapezoid bar, inline SVG on all three pages. No request, no new CSP surface — `img-src` already allowed `data:`. Closes the open item recorded the same day. |
| 2026-07-29 | The page teaches before it argues | The site assumed its reader arrived knowing what a benchmark is, and for everyone else it was jargon from the first control. A comprehension pass added the plain register: the exam metaphor in the hero, a Start-here section with a three-step record and a five-term glossary, plain openers on the method sections, and de-jargoned tool labels. Nothing was dumbed down; it was preceded. |
| 2026-07-29 | Motion: from "nothing" to "settling" | Supersedes the same-day minimal rule after the no-motion page was judged stiff. The fix is not decoration: every animation narrates measurement — settle, count, sweep, breathe — runs once, honours reduced-motion, and fails static. Bounce remains banned, and heat joined the palette as temperature rather than fill. |
| 2026-07-29 | Build subprocesses spawn with `windowsHide` and no shell | `execFileSync('npx', …, { shell: true })` routes through cmd.exe, which gets a console window — a window flashing open and shut for every bundle, and much worse with several builds running at once. The shell was only there because npx on Windows is `npx.cmd`; naming the file directly removes the reason for it. See `scripts/npx.ts`. |
| 2026-07-30 | The front page halves its words | Measured against six reference sites (Linear, Stripe, Plausible, Resend, Raycast, Vercel — all land on hero ≤ 30 words, ≤ 2 sentences per section, exhibits doing the explaining), the page ran 1,844 words. Now 1,390 total and ~450 of visible running prose: the hero lede is gone, Start-here is one paragraph and three one-line steps, and every deep paragraph folded into a `details.more` disclosure. Nothing was deleted — all 35 gated figures still trace. |
| 2026-07-30 | Disclosures are ruled, not boxed | `details.more` is a hairline, a mono small-caps summary and a `+`/`−` marker — the editorial fold of a broadsheet, not a widget. A bordered accordion would have re-imported the card language the page just removed. |
| 2026-07-30 | The film re-rendered at high quality, QA'd before shipping | The first render used the pinned script's default quality: 485 kbps at 1080p, soft type. Re-cut: CLI 0.7.82 → 0.7.83, `--quality high`, type scaled to fill the 16:9 frame, scene-2 entrance tightened from 0.7s of empty canvas to 0.25s, captions moved fully below the footer rule (the 48s caption used to cross it). Frames extracted and inspected at seven timestamps before the files replaced the live ones. |
