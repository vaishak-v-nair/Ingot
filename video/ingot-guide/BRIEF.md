---
workflow: general-video
flow: automation
storyboard: no
message: "Check whether an AI's test questions were in its training data — and see the proof yourself"
destination: web-landing
aspect: 1920x1080
language: en
audience: first-time visitor to ingot-six.vercel.app who has never met the word "benchmark"
length: 60s
angle: guidance
---

## Intent

A guidance video for the Ingot landing page — purpose and how-to, not an introduction.
It teaches the exam / study-pile metaphor (benchmarks are exams, training data is the
study pile, contamination is the leak), states what Ingot does differently (shows the
words, never just a score), and walks the three steps of using the site: pick the exam,
drop training data, read the evidence — closing on the receipt and the privacy claim.
Tone: calm, forensic, editorial — an assay certificate that learned to speak.

## Assets

- E:\Ingot\ingot\web\fonts\instrument-serif-400.woff2 — display face; copy into assets/fonts/.
- E:\Ingot\ingot\web\fonts\jetbrains-mono-400.woff2 — evidence face; copy into assets/fonts/.

## Customizations

- AI voiceover via the local Kokoro engine (offline; HeyGen signed out — user has no key).
- Burned-in captions timed to the narration segments.
- Audio identity: voice over deliberate silence — MusicGen deps are missing, and silence
  suits the assay-certificate brand.
- Deliverables copied to E:\Ingot\ingot\web\media\ as self-hosted mp4 (+ webm when ffmpeg
  permits) with a poster frame; wired click-to-play into the site's Start-here section.

## Notes

- Design truth: the site's palette and rules, distilled into design.md — paper #fbfaf7,
  ink #16150f, dim #6d6a5c, line #ddd9cc, gold #9a6a00, ember #d2451e, hot #ff9d1f.
  Ruled records, never cards. Gold is a mark, never a fill.
- The video must not contradict the site's published numbers; it quotes none except
  "nothing is uploaded", which is architecture, not measurement.
