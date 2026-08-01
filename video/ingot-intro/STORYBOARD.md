---
format: 1920x1080
duration: 51s
message: "See which exact words are inside AI training data — the words, never a score, and nothing leaves your machine."
arc: hook → pain → product intro → mechanism/demo → trust → proof → CTA
audience: writers and ML engineers meeting Ingot for the first time
mode: autonomous
music: none
---

## Video direction

- **Palette system (frame.md roles):** `cream` (#0C0E0F graphite) is the only ground; `ink`
  (#E8EAEC) is the voice; `coral` (#4ADE80 signal green) appears in exactly TWO moments in
  the whole film — the zero in Frame 5 and the final URL underline in Frame 7 — because
  colour is testimony; `tile-strong` (#F59E0B amber) appears ONLY in Frame 4 on the
  matched-run highlight and the progress thread; `navy` panels (#121415) are the
  instrument surfaces; hairlines are ink@12%. Mono = JetBrains Mono for every number,
  log line, receipt, and caption-adjacent label; display = Archivo 600, tight.
- **Motion grammar:** long-tail settles only (`power3` default) — this film's thesis is an
  instrument, so nothing bounces, ever. Reveals are VO-paced: at t=0 each frame carries
  only what the narration is saying; every further element lands on its spoken cue,
  weighted into the back half. Registration crosshairs (four corners) are the recurring
  chrome: they draw in via **SVG self-draw** (`svg-path-draw`) in Frame 3 and persist
  as static chrome in Frames 4–7 (redrawn per frame, never animated again).
- **Rhythm / held frames:** Frame 3 (the title) and Frame 5 (the zero) are the two
  deliberate near-stills — the breath before and after the working Frame 4. Frame 5 is
  the stillest shot in the film by design: the number that refuses to move IS the claim.
- **Negative list:** no gradients, no glow blooms, no blur washes, no bounce/overshoot,
  no breathing loops, no slow back-half pans, no cursors, no browser chrome, no invented
  UI beyond the ruled press-bed panel, no purple anything. Both failure modes banned:
  slideshow (front-load-then-freeze) and screensaver (independent floaters).
- **Captions:** bottom ~17% stays clear in every frame; all content plans into the top 83%.

## Frame 1 — The question

- scene: The question builds word by word on bare graphite; the last slot swaps "your words" ⇄ "a benchmark's exam"
- voiceover: "What's inside AI training data? Your words? A benchmark's exam questions?"
- duration: 4.928s
- transition_in: cut
- status: outline
- src: compositions/frames/01-question.html
- type: hook
- persuasion: Curiosity + personal stake — the question is about the viewer
- beat: curiosity + unease
- blueprint: kinetic-type-beats (Reproduce)
- focal: the headline itself (typography-only)
- asset_candidates:

narrativeRole: Open on the one question everyone shares; the swapping slot teaches that this concerns both people and benchmarks.
keyMessage: The question is about YOU, not just about AI labs.

Scene 1 (0.0–2.0s): bare graphite field, nothing else; the headline "What's inside AI
training data?" assembles via **per-word staggered reveal** (`dynamic-content-sequencing`)
on smooth long-tail settles, Archivo 600, centered, upper-third golden position, ~55% of
frame width. Nothing but the words.
Scene 2 (2.0–3.4s): as the VO asks "Your words?", the phrase "your words" lands beneath
the headline in mono, ink — an **in-place token cycle** slot (`discrete-text-sequence`)
established with its first token. Centered under the headline, clear hierarchy: headline
3:1 over the slot.
Scene 3 (3.4–4.9s): on "A benchmark's exam questions?", the slot **hard-cut word-swaps**
(`discrete-text-sequence`) to "a benchmark's exam questions" — the swap is the beat.
Holds still to the cut; no drift, no jitter needed at this length.

## Frame 2 — The score you can't check

- scene: Pain lands alone: "a score." / "a percentage." / "trust us." — each line solo on the graphite, dimming
- voiceover: "Until now, every answer was a score. A percentage. Trust us."
- duration: 3.605s
- transition_in: crossfade
- status: outline
- src: compositions/frames/02-score.html
- type: pain_point
- persuasion: Negative contrast — the status quo is unverifiable
- beat: skepticism + frustration
- blueprint: kinetic-type-beats (Reproduce)
- focal: the three pain lines (typography-only)
- asset_candidates:

narrativeRole: Name the status quo's failure in three short blows; sets up "shows you the words" as the inversion.
keyMessage: Scores demand trust; they can't be checked.

Scene 1 (0.0–1.4s): graphite field; on "every answer was a score", the line "a score."
lands alone dead-center via **hard-cut flash** (`discrete-text-sequence`), Archivo 600,
~40% width. Solo — nothing else on canvas.
Scene 2 (1.4–2.4s): on "A percentage.", the first line dims to @40% and shifts up one
line-height on a long-tail settle while "a percentage." **hard-cuts** in at center — a
**waterfall seam** at line granularity (`cut-catalog.md`), stacking evidence of sameness.
Scene 3 (2.4–3.6s): on "Trust us.", both prior lines dim to @25%; "trust us." lands
center in mono — the register shift (display → mono) is the point: a claim reduced to
fine print. Holds dim and still into the crossfade.

## Frame 3 — Ingot: it shows you the words

- scene: Calm title chain: registration crosshairs draw in corners → "INGOT" mono brand → the claim card "It shows you the words." held still
- voiceover: "Ingot answers differently. It shows you the words."
- duration: 2.688s
- transition_in: crossfade
- status: outline
- src: compositions/frames/03-intro.html
- type: product_intro
- persuasion: Category inversion — evidence instead of scores
- beat: clarity + intrigue
- blueprint: titlecard-reveal (Adapt)
- focal: the claim line (typography + chrome)
- asset_candidates:

narrativeRole: The calm beat — an instrument switching on, not a product shouting; the crosshairs establish the visual system.
keyMessage: The product's answer is evidence you can read.

Adapt: keep the signature (near-still cards, one restrained move each, blur-snap chain
compressed to two cards); the "cards" are the bare stage itself — the instrument
switching on replaces a card chain.
Scene 1 (0.0–1.3s): on "Ingot answers differently", four registration crosshairs
**SVG self-draw** (`svg-path-draw`) simultaneously in the four corners — the instrument
powering on — while "I N G O T" letter-spaced mono lands top-center via **per-word
staggered reveal** (letters as units, `dynamic-content-sequencing`). Sparse: chrome +
wordmark only, layered-depth via the corner chrome.
Scene 2 (1.3–2.7s): on "It shows you the words.", the claim line slides up into center
with a single **slide-up crossfade** (the titlecard signature move), Archivo 600 at hero
scale, ~50% width, then HOLDS dead still for the back 2s — the film's first breath.
No jitter: this stillness is allocated.

## Frame 4 — The measurement

- scene: The instrument works: a corpus drops into a ruled press-bed panel, a thin amber progress thread runs with a mono scan log, then the receipt cascades in — and the published NATO Article 5 specimen (mmlu-5951) lands with its matched run highlighted in amber
- voiceover: "Drop a training corpus. The scan runs — and every overlap is shown word for word. Like this exam question, found inside twenty-one gigabytes of web text."
- duration: 9.131s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/04-measurement.html
- type: feature_showcase
- persuasion: Show-don't-tell proof — the machine visibly works and hands over evidence
- beat: awe + trust
- blueprint: agent-progress-theater (Adapt)
- focal: the specimen card (reconstructed instrument panel; no captured assets)
- asset_candidates:

narrativeRole: The heart of the film — trigger, working theater, receipt. The specimen is the already-published mmlu-5951 match; the amber highlight is the only amber in the film.
keyMessage: You watch it measure, then you read the words it found.

Adapt: keep the signature (trigger → working theater → receipt rows that land and
resolve); the receipt is a matched-text specimen rather than a checklist — the findings
ARE text. Specimen content is the published mmlu-5951 record, verbatim: item id
`mmlu-5951`, corpus `c4-en · 21.33 GB`, matched run "…an armed attack against one or
more of them … shall be considered an attack against them all…" with the run
highlighted; no other text may be invented.
Scene 1 (0.0–1.8s): on "Drop a training corpus", a ruled press-bed panel (navy surface,
hairline border, radius 0) sits center-right at ~55% width; a mono file chip
"corpus.jsonl.gz" descends into it on one long-tail settle (**spring-pop entrance**
`spring-pop-entrance`, smooth register — no overshoot). Asymmetric 60/40, panel right.
Scene 2 (1.8–4.0s): on "The scan runs", a 2px amber progress thread fills across the
panel top (**bars/progress fill** `stat-bars-and-fills`) while three mono log lines land
beneath it one per beat (**per-word staggered reveal** at line granularity,
`dynamic-content-sequencing`): "reading 9,264,249 documents", "tokens 3,418,685,530",
"matching n-grams…". The machine is visibly working; nothing else moves.
Scene 3 (4.0–7.0s): on "shown word for word", the log yields via an **inverse
zoom-through seam** (`cut-catalog.md`) to the specimen card filling ~70% center: mono
header "mmlu-5951 · c4-en · 21.33 GB", then the specimen sentence with its matched run
receiving a **highlight sweep** (`css-marker-patterns`, amber @30% wash) left-to-right
exactly as the VO says "exam question".
Scene 4 (7.0–9.1s): on "twenty-one gigabytes", the corpus figure "21.33 GB" in the
header gains a one-beat **keyword glow** (`asr-keyword-glow`, amber, single
attack-decay); the card then holds still to the cut — evidence left on screen long
enough to actually read.

## Frame 5 — Zero

- scene: One number fills the frame and refuses to move: "0" in signal green with "bytes uploaded" in mono; a subtle "press F12 — watch the network stay empty" line beneath
- voiceover: "And what leaves your machine? Zero bytes. Not a policy — your browser enforces it."
- duration: 4.629s
- transition_in: crossfade
- status: outline
- src: compositions/frames/05-zero.html
- type: benefit_highlight
- persuasion: Risk reversal made verifiable — the claim is checkable in the viewer's own devtools
- beat: relief + control
- blueprint: dataviz-countup (Adapt)
- focal: the zero (typography-only)
- asset_candidates:

narrativeRole: The count-up that never counts — the only green in the film, spent on the verified state. Inverts the stat-explosion trope: stillness is the proof.
keyMessage: Nothing is uploaded, and you don't have to take our word for it.

Adapt: keep the signature (one hero statistic owns the frame at scale) and invert its
engine — the number never counts, never scales. The refusal to move is the shot.
Scene 1 (0.0–1.4s): on "what leaves your machine?", the question sits alone upper-third
in Archivo, modest scale — a setup line, nothing else on the graphite.
Scene 2 (1.4–2.9s): on "Zero bytes", a giant "0" lands dead-center in signal green —
the film's first green pixel — via one **hard cut** (no entrance animation at all; it is
simply, suddenly there — `discrete-text-sequence` single-step), with "bytes uploaded"
in mono beneath. Centered, ~45% of frame height, 3:1 over everything.
Scene 3 (2.9–4.6s): on "your browser enforces it", one mono line reveals beneath
(**per-word staggered reveal**, `dynamic-content-sequencing`): "press F12 — the network
panel stays empty". Then the film's stillest hold: nothing moves, not even jitter.
The zero does not blink, count, or breathe. That is the proof.

## Frame 6 — The receipt

- scene: A mono receipt assembles line by line on a ruled panel: 9,264,249 documents · 21.33 GB · 342 / 14,042 flagged · 76 tests · every line with a hairline rule; closing line "every number carries its receipt"
- voiceover: "Nine million documents scanned. Every published number gated in CI — and every report ends with a receipt anyone can re-run."
- duration: 7.68s
- transition_in: crossfade
- status: outline
- src: compositions/frames/06-receipt.html
- type: social_proof
- persuasion: Statistical proof with reproducibility — the numbers vouch because they can be re-derived
- beat: confidence + trust
- blueprint: grid-card-assemble (Adapt)
- focal: the receipt panel (typography-only)
- asset_candidates:

narrativeRole: Proof by receipts rather than logos — this product's social proof is that its numbers survive re-running.
keyMessage: The published record is real, current, and checkable.

Adapt: keep the signature (staggered cascade assembling a list that holds); the grid is
a thermal-receipt vertical list on a ruled panel — line items with hairline rules, not
cards. All figures verbatim from the published record; nothing else may appear.
Scene 1 (0.0–2.2s): on "Nine million documents", a ruled receipt panel (navy, hairline,
~42% width, centered) tears in from a 2px top rule; first line item lands: mono
"documents  9,264,249" via **per-word staggered reveal** at line granularity
(`dynamic-content-sequencing`), its figure arriving as a fast **value-scaled counter**
(`counting-dynamic-scale`) that settles in under a second — the only count-up in the
film, spent where counting is honest (a scan total).
Scene 2 (2.2–5.0s): as the VO continues, three more line items cascade one per beat
(**staggered cascade**, the grid-card signature, `dynamic-content-sequencing`):
"corpus  21.33 GB", "mmlu flagged  342 / 14,042", "tests  76 / 76". Hairline rule
between each; steady list cadence matching the VO's breath-per-figure.
Scene 3 (5.0–7.7s): on "a receipt anyone can re-run", the closing line lands beneath
the rules in ink@70% mono: "every number carries its receipt" — then the panel holds
still into the crossfade.

## Frame 7 — Ask it yourself

- scene: The headline demotes; a terminal pill springs in and types "npx ingot-scan contaminate" with a blinking caret; the URL ingot-six.vercel.app settles beneath with the crosshairs closing the frame
- voiceover: "Ask it yourself — in your browser, or one command. ingot dash six dot vercel dot app."
- duration: 5.163s
- transition_in: crossfade
- status: outline
- src: compositions/frames/07-cta.html
- type: cta
- persuasion: Friction reduction — the ask is one URL or one command
- beat: motivation + ease
- blueprint: prompt-type-submit-generate (Adapt)
- focal: the terminal pill (typography + chrome)
- asset_candidates:

narrativeRole: The install-command end card — the CTA is the product's own real command, held with a breathing caret.
keyMessage: Trying it costs one command.

Adapt: keep the signature (the ask IS the typed command; the card holds on the caret);
the caret's "blink" is a finite three-step opacity sequence then a steady on-state —
no loop (seek-safe core). The end card is the film's exit, so it may resolve fully.
Scene 1 (0.0–1.3s): on "Ask it yourself", the line lands top-center in Archivo via
**per-word staggered reveal** (`dynamic-content-sequencing`), then demotes (scales to
~60%, ink@70%) as the frame's focus hands off.
Scene 2 (1.3–3.4s): on "one command", a terminal pill (navy, hairline, radius 0, mono)
enters center on a long-tail settle; "npx ingot-scan contaminate" **types on with
caret** (`discrete-text-sequence` + `context-sensitive-cursor`), character cadence
even, machine-steady — no human typos: instruments don't mistype.
Scene 3 (3.4–5.2s): on the spoken URL, "ingot-six.vercel.app" settles beneath the pill
in mono with a 1px signal-green underline **SVG self-draw** (`svg-path-draw`) — the
film's second and last green — while the four corner crosshairs (static since entrance)
remain as the closing chrome. Caret executes exactly three finite blinks
(`discrete-text-sequence`, stepped opacity tweens) and holds ON. Full stop.
