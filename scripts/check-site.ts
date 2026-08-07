/**
 * Asserts the built site is complete and self-contained, before anything publishes it.
 *
 * This lived as inline bash inside .github/workflows/pages.yml, which meant it was a
 * property of one workflow rather than of the site. A second host building the same
 * repository would have served pages that had passed none of it. It is a script so that
 * every host runs the identical check, and so it can be run locally before pushing.
 *
 * Exit code 1 fails the build. That is the point: a page that references a CDN, or a
 * missing index, must not reach a URL.
 */
import { readdirSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Emitted so GitHub renders these inline on the run; harmless plain text elsewhere. */
const annotate = process.env.GITHUB_ACTIONS === 'true';
const fail = (msg: string): void => {
  process.stdout.write(annotate ? `::error::${msg}\n` : `  FAIL  ${msg}\n`);
  failures++;
};
let failures = 0;

/**
 * Everything a visitor needs for the scanner to work. An empty file counts as missing:
 * a truncated download or a build that wrote nothing is the failure this catches, and it
 * would otherwise surface as a broken page rather than a broken build.
 */
const REQUIRED = [
  'web/index.html',
  'web/about.html',
  'web/registry.html',
  // The shared design layer. Every page links it, so a missing or empty file unstyles the
  // whole site while every page still renders — exactly the "looks fine, is broken" case
  // this manifest exists to catch.
  'web/site.css',
  'web/ingot.js',
  'web/scan.worker.js',
  'web/sample-corpus.jsonl',
  'web/indexes/mmlu.idx.bin.gz',
  'web/indexes/gsm8k.idx.bin.gz',
  'web/indexes/humaneval.idx.bin.gz',
  'web/fonts/archivo-latin-600.woff2',
  'web/fonts/public-sans-latin-400.woff2',
  'web/fonts/public-sans-latin-500.woff2',
  'web/fonts/jetbrains-mono-400.woff2',
  'web/og.png',
  'web/media/ingot-intro.mp4',
  'web/media/intro-poster.jpg',
];

process.stdout.write('\n  checking the built site\n\n');

for (const f of REQUIRED) {
  let size = -1;
  try {
    size = statSync(resolve(f)).size;
  } catch {
    fail(`missing: ${f}`);
    continue;
  }
  if (size === 0) fail(`empty: ${f}`);
  else process.stdout.write(`  ok    ${f.padEnd(38)} ${size.toLocaleString().padStart(10)} bytes\n`);
}

/** The drop target is the product. A build that loses it produces a page that looks fine. */
const index = readFileSync(resolve('web/index.html'), 'utf8');
if (!index.includes('id="drop"')) fail('web/index.html has no id="drop" — the scanner UI is gone');
else process.stdout.write('  ok    web/index.html carries the drop target\n');

/**
 * The privacy claim is that this page makes no third-party request, and it is checkable in
 * thirty seconds with a network panel. A CDN font or an analytics script would break it
 * silently — nothing about the rendered page would look wrong — so it is asserted instead
 * of trusted. github.com is allowed because those are prose links, not subresources.
 */
/**
 * Discovered, not listed. This used to be a second hardcoded copy of the page list, which
 * meant adding a page required remembering two places — and forgetting the second one
 * shipped a public page that the external-resource sweep never ran on, with the build
 * green. A manifest and a sweep answer different questions: REQUIRED above asserts
 * presence (a glob can never notice something missing), this asserts a property of
 * whatever exists (so it must not have exceptions).
 */
const PAGES = readdirSync(resolve('web'))
  .filter((f) => f.endsWith('.html'))
  .sort()
  .map((f) => `web/${f}`);

/**
 * A sweep that finds nothing reports nothing and passes. `for (const page of PAGES)` over
 * an empty array records zero failures and prints "site ok, self-contained" — a gate that
 * has become a no-op while still saying yes. That is the same shape as the CI failure
 * where check-site demanded an index the build had been told to skip: the check was fine,
 * its input was empty. The floor is the pages named in REQUIRED, so it rises on its own
 * whenever a page is added there.
 */
const MIN_PAGES = REQUIRED.filter((f) => f.endsWith('.html')).length;
if (PAGES.length < MIN_PAGES) {
  fail(
    `the page sweep found ${PAGES.length} page(s) in web/ but REQUIRED names ${MIN_PAGES} — ` +
      `refusing to report a clean sweep over a set this small`,
  );
} else {
  process.stdout.write(`  ok    page sweep found ${PAGES.length} page(s) in web/\n`);
}
// Four ways a page can name a remote resource, each with its own syntax. The attribute
// pattern was the only one checked for a while, which left CSS url() — a webfont or
// background fetched from a CDN inside the inline <style> blocks — invisible to the one
// gate whose job is "the network panel stays empty". github.com stays allowed for prose
// links only: a CSS url() is always a subresource, never prose.
const EXTERNAL_PATTERNS: { re: RegExp; allowGithub: boolean }[] = [
  { re: /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi, allowGithub: true },
  { re: /url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi, allowGithub: false },
  { re: /@import\s+["'](https?:\/\/[^"']+)["']/gi, allowGithub: false },
  { re: /srcset\s*=\s*["']([^"']*https?:\/\/[^"']*)["']/gi, allowGithub: false },
];

for (const page of PAGES) {
  const text = readFileSync(resolve(page), 'utf8');
  const offenders: string[] = [];
  for (const { re, allowGithub } of EXTERNAL_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const url = m[1];
      if (allowGithub && /^https?:\/\/(?:[\w.-]+\.)?github\.com\//i.test(url)) continue;
      offenders.push(url);
    }
  }
  if (offenders.length > 0) {
    for (const url of offenders) fail(`${page} references an external resource: ${url}`);
  } else {
    process.stdout.write(`  ok    ${page.padEnd(38)} no external subresources\n`);
  }
}

if (failures > 0) {
  process.stdout.write(
    `\n  ${failures} problem(s). Not publishing.\n` +
      `  The site must be complete and must make no third-party request.\n\n`,
  );
  process.exit(1);
}

process.stdout.write('\n  site ok, self-contained\n\n');
