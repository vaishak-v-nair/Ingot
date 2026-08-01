# Changelog

Numbers quoted here trace to `results/`; defect write-ups live in `docs/measurements.md`.

## 0.1.2 — August 2026

The whole-product review release. No scan-behavior changes: results and receipts are
identical to 0.1.1.

- The build toolchain is pinned exactly — esbuild in `scripts/build-web.ts` and the npx
  call inside the GitHub Action. An unpinned tool in a reproducibility product was a hole.
- The triage verdict rules move to `scripts/triage-rules.ts` and gain tests, including
  the short-item floor artifact; the triage scripts now split corpus lines on `\n` only,
  matching the scanner (readline treats U+2028 as a line terminator; the scan does not).
- The README's test count is derived from the test files and CI-gated, after being caught
  stale at 44 while the suite ran 64.
- Weekly CI actually re-fetches reference corpora now; the cache key was immortal, so the
  drift check could never see drift.
- Epistemic caveats documented in the README and threat model: answers are not indexed,
  "verbatim" means post-normalization, and canonical is not the same as harmless.
- The provenance scanner is labelled experimental in the CLI, with its measured floor.
- New: `corpus-scan.yml` (registry-scale scans on hosted runners, artifact-only),
  SECURITY.md, CONTRIBUTING.md, and this changelog.

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
