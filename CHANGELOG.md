# Changelog

Numbers quoted here trace to `results/`; defect write-ups live in `docs/measurements.md`.

## 0.1.1 — July 2026

- **False-clean fix:** a scan that read zero documents now refuses (exit code 3) instead of
  reporting a clean corpus. A clean report over nothing was the worst bug this project has
  shipped.
- Skipped-line disclosure: every report states lines read and lines the parser rejected.
  Zero skips is a claim; a nonzero count is a disclosure the scan may not omit.
- Gzip parity: `.gz` corpora produce byte-identical results and the same corpus hash as
  their uncompressed form, on both surfaces.
- npm publishing moved to trusted publishing (OIDC) — no stored tokens.

## 0.1.0 — July 2026

- First release: browser scanner (nothing uploaded, checkable in the network panel), CLI
  (`npx ingot-scan contaminate`), published hash-only benchmark indexes (gsm8k, humaneval,
  mmlu), self-contained HTML reports with reproducibility receipts, GitHub Action.
