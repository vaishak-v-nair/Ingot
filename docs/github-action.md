# GitHub Action

A contamination gate for your own CI. The best version of this tool is the one nobody has
to remember to run.

```yaml
name: contamination
on: [pull_request]

jobs:
  ingot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: OWNER/REPO@v1        # replace with this repository once published
        with:
          corpus: data/sft-mix.jsonl
          index: gsm8k
```

Any finding fails the build, and **the matching text goes into the log and the job
summary**. A gate that reports "3 findings" and nothing else just forces everyone to go and
look; the text is the finding, and some of it will be canonical phrasing rather than
leakage.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `corpus` | *required* | JSONL corpus to scan. Any size — it streams. |
| `index` | `gsm8k` | A bundled benchmark name (`gsm8k`, `humaneval`), or a path or URL to any published `.idx.bin.gz`. |
| `max-items` | `0` | Fail when more than this many benchmark items are found. `0` means any finding fails. |
| `text-field` | auto | Field holding the document text. |
| `report` | `ingot-report.json` | Where to write the JSON report, receipt included. |
| `fail-on-findings` | `true` | Set `false` to report without failing. |

## Outputs

| Output | Meaning |
|---|---|
| `items-found` | Distinct benchmark items found. |
| `report` | Path to the JSON report. |

## Scanning against MMLU

MMLU is 5.35 MB and does not ship inside the package, so point `index` at the published
file:

```yaml
      - uses: OWNER/REPO@v1
        with:
          corpus: data/sft-mix.jsonl
          index: https://OWNER.github.io/REPO/indexes/mmlu.idx.bin.gz
```

Indexes carry one-way hashes and item ids, never benchmark text.

## Reporting without failing

Useful for a first run against an existing corpus, where you want the picture before you
want the gate:

```yaml
      - uses: OWNER/REPO@v1
        id: ingot
        with:
          corpus: data/sft-mix.jsonl
          fail-on-findings: 'false'

      - run: echo "found ${{ steps.ingot.outputs.items-found }} items"
```

## Keeping the report

The JSON report contains the receipt — scanner version, index identity, corpus hash, and
the exact command — so a reviewer can reproduce the number without access to your CI:

```yaml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: ingot-report
          path: ingot-report.json
```

## What this does not do

Reads `docs/threat-model.md` first if you plan to point at this as evidence. In short: it
proves something about the file you scanned, not about the file you trained on, and anyone
who can run this action can also run it locally and edit until it passes.
