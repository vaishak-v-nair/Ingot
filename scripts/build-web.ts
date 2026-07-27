/**
 * Builds the browser bundle and the publishable benchmark indexes.
 *
 * Indexes carry one-way hashes and item ids only — never benchmark text — so they can be
 * served for benchmarks whose licence forbids redistributing the data, and so a user
 * checks their corpus without downloading the benchmark at all.
 *
 * They ship as compact binary, gzipped. MMLU is 19.4 MB as JSON and 5.3 MB this way, and
 * that download happens before anyone sees a single result. Pass --json to also write the
 * readable form, which is the format specification and what docs/index-format.md describes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBatch } from '../src/loader.ts';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { encodeIndex, gzipBytes } from '../src/contamination/indexCodec.ts';
import { DEFAULT_N } from '../src/contamination/types.ts';

const BENCHES = ['gsm8k', 'humaneval', 'mmlu'];

/** Indexes need the benchmark files; the bundle does not. CI builds the bundle alone. */
const bundleOnly = process.argv.includes('--bundle-only');
const alsoJson = process.argv.includes('--json');

process.stdout.write('\n  building browser bundle\n');
execFileSync(
  'npx',
  ['--yes', 'esbuild', 'src/contamination/browserScan.ts', '--bundle', '--format=esm',
   '--outfile=web/ingot.js', '--platform=browser', '--target=es2022', '--minify'],
  { stdio: 'inherit', shell: true },
);

if (bundleOnly) {
  process.stdout.write('\n  bundle only; skipping indexes\n\n');
  process.exit(0);
}

mkdirSync(resolve('web/indexes'), { recursive: true });
process.stdout.write('\n  building publishable indexes\n\n');

for (const name of BENCHES) {
  const items = loadBatch(resolve(`data/bench/${name}.jsonl`)).records.map((r) => ({ id: r.id, text: r.text }));
  const index = NgramIndex.build(name, items, { n: DEFAULT_N });
  const data = index.serialize();

  const binPath = resolve(`web/indexes/${name}.idx.bin.gz`);
  writeFileSync(binPath, await gzipBytes(encodeIndex(data)));
  const mb = statSync(binPath).size / 1e6;

  let jsonNote = '';
  if (alsoJson) {
    const jsonPath = resolve(`web/indexes/${name}.idx.json`);
    writeFileSync(jsonPath, JSON.stringify(data), 'utf8');
    jsonNote = `  (json ${(statSync(jsonPath).size / 1e6).toFixed(1)} MB)`;
  }

  process.stdout.write(
    `  ${name.padEnd(11)} ${String(items.length).padStart(6)} items  ` +
      `${index.size.toLocaleString().padStart(9)} grams  ${mb.toFixed(2).padStart(5)} MB${jsonNote}\n`,
  );
}
process.stdout.write('\n  serve with: npx --yes serve web\n\n');
