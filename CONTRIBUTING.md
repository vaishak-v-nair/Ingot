# Contributing

Small project, strict rules. The rules are the product: every one of them exists because
the alternative produced a wrong number that somebody published.

## Setup

Node 24+. Nothing else. No install step, no build step for development:

```bash
node --test test/*.test.ts        # the suite; CI runs exactly this
node e2e/run.ts                   # the shipped page in headless Chrome
node scripts/build-web.ts         # browser bundle + publishable indexes
```

## The three laws

1. **Zero runtime dependencies.** The published package must not gain a dependency. The one
   build-time tool (esbuild) is invoked via `npx`, pinned to an exact version.
2. **Every published number traces to `results/`.** If your change moves a figure, re-run
   the producing script and update the prose in the same commit —
   `node scripts/check-published-numbers.ts` fails the build otherwise, by design.
3. **Web pages make zero external requests.** `scripts/check-site.ts` asserts it. Visual
   changes follow `DESIGN.md`.

## Tests

A fix ships with the test that would have caught the defect. That convention is why the
suite exists at all — most tests name the defect they pin in a comment. Coverage of new
code paths is expected: with the harness in place, tests are the cheap part.

## Commits and PRs

- Run the suite and `node scripts/check-published-numbers.ts` before pushing (CI runs the
  same and also builds the registry page first — a claim inside generated HTML is still a
  claim).
- Defects that produced a wrong published number get a write-up in `docs/measurements.md`,
  not a quiet fix.
- Releases: bump the version, push the tag, publish a GitHub Release — `publish.yml` ships
  to npm via trusted publishing. Bump the pinned version in `action.yml` in the same
  change.
