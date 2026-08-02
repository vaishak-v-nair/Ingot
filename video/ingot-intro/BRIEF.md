---
workflow: product-launch-video
flow: automation
storyboard: no
message: "See which exact words are inside AI training data — the words, never a score, and nothing leaves your machine."
destination: youtube-embed
aspect: "16:9"
language: en
audience: "writers and ML engineers meeting Ingot for the first time"
length: 45-60s
angle: "instrument calibration, not hype — a precision measurement device switching on"
style_preset: ""
voice: bf_emma
music: none
---

## Intent

An introduction film for Ingot (https://ingot-six.vercel.app) in the site's own Cleanroom
Instrument design system. It should feel like a calibrated instrument powering up and
taking one measurement — not a SaaS promo. Motion settles, never bounces. Near-silence:
narration only, no BGM (deliberate: an instrument does not play music).

## Revisions after the first cut

**2026-08-02, founder review.** Two standing corrections — they override the
Customizations below, and they apply to every future Ingot visual:

1. **No decorative mark.** The ✱ spike inherited from the style preset is retired
   film-wide (it had reached three of seven frames — a mark repeated reads as clip-art).
   `frame.md` now voids its own spike mandate.
2. **Never show the hosting domain.** "Close on the URL" below is VOID: a
   `*.vercel.app` on an end card advertises the host, not the product. The film closes
   on `npx ingot-scan contaminate` and nothing else. Line 7 was re-synthesised without
   the spoken URL; frame 07 retimed 5.163s → 4.8s; total 37.8s → 37.5s.

## Truth constraints (absolute — zero hallucination)

- Only published, CI-gated figures may appear: 9,264,249 documents · 21.33 GB ·
  342 / 14,042 MMLU items flagged · 0 bytes uploaded. (The suite size quoted here as
  "76 tests" at brief time is now 83 — figures move; always re-read `results/` and the
  gates rather than this brief.)
- The only quotable matched-text specimen is the published mmlu-5951 NATO Article 5 match
  (already on the site, gated).
- NEVER use the Paul Graham findings (fenced behind legal review).
- No invented testimonials, users, logos, quotes, or claims. No em-dash-free rule on
  numbers: every number traces to results/.

## Customizations

- Brand tokens ARE the design spec (from the product's DESIGN.md): ground #0C0E0F,
  text #E8EAEC, rules #2A2E31, signal green #4ADE80 only for verified/zero-upload states,
  amber #F59E0B only for findings, Archivo 600 display, Public Sans body, JetBrains Mono
  for data and receipts, registration-crosshair motif, border-radius 0.
- Captions: on (Cleanroom-consistent skin).
- Close on the URL: ingot-six.vercel.app.

## Notes

- New project; video/ingot-guide is the OLD design and must not be reused for look.
- Autonomous run: user said "just build it". Signed out of HeyGen — local engines
  (Kokoro voice bf_emma; music deliberately none).
