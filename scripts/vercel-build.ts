/**
 * The build Vercel runs. Same steps, same gates, same order as the GitHub Actions job.
 *
 * The point of this file existing is that the gates must not be a property of one host.
 * `check-site.ts` and `check-published-numbers.ts` both exit non-zero, so a page that
 * references a third-party origin, or quotes a figure that no longer matches results/,
 * fails the build and never reaches a URL.
 *
 * Run it locally with `node scripts/vercel-build.ts` to reproduce exactly what the host does.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { QUIET } from './npx.ts';

const BENCH_DIR = resolve('data/bench');
const BENCH_FILES = ['gsm8k.jsonl', 'humaneval.jsonl', 'mmlu.jsonl'];

/**
 * Vercel's build cache cannot be configured — the documentation is explicit that you
 * cannot choose which files are cached, and what it keeps is `node_modules/**`. So the
 * benchmarks are staged inside node_modules to survive between deploys. Without this,
 * every deploy re-downloads MMLU from HuggingFace, and a rate-limit there becomes a
 * failed deploy of a site that did not change.
 *
 * It is a cache and it is allowed to miss. Every failure below falls through to fetching.
 */
const CACHE_DIR = resolve('node_modules/.cache/ingot-bench');

const step = (label: string): void => process.stdout.write(`\n=== ${label} ===\n`);
const run = (script: string): void =>
  execFileSync(process.execPath, [resolve(script)], { stdio: 'inherit', ...QUIET });

const haveBenchmarks = (): boolean =>
  BENCH_FILES.every((f) => existsSync(resolve(BENCH_DIR, f)));

step('benchmarks');
if (haveBenchmarks()) {
  process.stdout.write('  already present in data/bench\n');
} else {
  try {
    if (BENCH_FILES.every((f) => existsSync(resolve(CACHE_DIR, f)))) {
      mkdirSync(BENCH_DIR, { recursive: true });
      for (const f of BENCH_FILES) cpSync(resolve(CACHE_DIR, f), resolve(BENCH_DIR, f));
      process.stdout.write('  restored from the build cache\n');
    }
  } catch (err) {
    process.stdout.write(`  cache restore failed, will fetch: ${(err as Error).message}\n`);
  }
}

if (!haveBenchmarks()) {
  process.stdout.write('  fetching from source\n');
  run('scripts/fetch-benchmarks.ts');
}

// Populate the cache for the next deploy. A failure here costs a download later and
// nothing else, so it must never fail the build.
try {
  mkdirSync(CACHE_DIR, { recursive: true });
  for (const f of BENCH_FILES) cpSync(resolve(BENCH_DIR, f), resolve(CACHE_DIR, f));
  process.stdout.write('  staged into the build cache for the next deploy\n');
} catch (err) {
  process.stdout.write(`  could not stage the cache: ${(err as Error).message}\n`);
}

step('building the scanner and the indexes');
run('scripts/build-web.ts');

step('building the registry page');
run('scripts/build-registry-page.ts');

// The published sample is the real renderer's output. Rebuilding it here is what stops
// the page a visitor is shown as an example from drifting away from the report they would
// actually be sent — it was hand-made once and then hand-edited, and nothing would have
// said so. It refuses rather than writing an unlabelled sample.
step('building the sample report');
run('scripts/build-sample-report.ts');

// Below here, nothing builds. Everything refuses.
step('gate: the site is complete and makes no third-party request');
run('scripts/check-site.ts');

step('gate: every published figure traces to results/');
run('scripts/check-published-numbers.ts');

process.stdout.write('\n  build ok, all gates passed\n\n');
