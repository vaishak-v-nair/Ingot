"""
Re-synthesise ONE narration line, without touching the other six.

Why this exists: the film's audio is stored per line (assets/voice/01..07.wav), each
frame owning exactly one. So a wording change costs one TTS call, one frame retime and
one render — minutes — instead of a full re-record. That structure is the reason the
2026-08-02 end-card cut was cheap; see
E:\\Second Brain\\Video Intelligence\\03 Tooling\\Recutting one narration line without rebuilding the film.md

HyperFrames 0.7.87 exposes no `tts` subcommand, so Kokoro is driven directly through the
`kokoro-onnx` pip package against the models HyperFrames already cached.

    python scripts/regen-line.py 07 "Ask it yourself — in your browser, or one command."

It prints the measured duration. That number must then be written into FIVE places or
the render is silently wrong:
  1. the frame composition's own DUR constant + its scene times
  2. the frame root's data-duration
  3. the frame's <div> in index.html
  4. the frame's <audio> data-duration in index.html
  5. index.html's root data-duration + the full-span anchor tween,
     plus audio_meta.json / audio_engine_meta.json (per-line and total)

Keep audio_request.json in sync by hand — it is the record of what was said.
"""

import sys
import wave
from pathlib import Path

import numpy as np
from kokoro_onnx import Kokoro

# Staged by HyperFrames on first use; no sign-in, no network, no CLI needed.
CACHE = Path.home() / ".cache" / "hyperframes" / "tts"
MODEL = CACHE / "models" / "kokoro-v1.0.onnx"
VOICES = CACHE / "voices" / "voices-v1.0.bin"

# The film's voice. bf_* is British female, so lang must be en-gb or the read drifts.
VOICE = "bf_emma"
LANG = "en-gb"
SPEED = 1.0

if len(sys.argv) != 3:
    sys.exit(__doc__)

line_id, text = sys.argv[1], sys.argv[2]
out = Path(__file__).resolve().parent.parent / "assets" / "voice" / f"{line_id}.wav"
if not out.parent.is_dir():
    sys.exit(f"no voice directory at {out.parent}")

samples, sr = Kokoro(str(MODEL), str(VOICES)).create(text, voice=VOICE, speed=SPEED, lang=LANG)
pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)
with wave.open(str(out), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr)
    w.writeframes(pcm.tobytes())

print(f"wrote {out.name}  duration_s={len(samples) / sr:.3f}  sr={sr}")
print("now update the five timing places listed in this file's docstring, then re-render")
