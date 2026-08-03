/**
 * Builds a scannable index out of any JSONL — a writer's pages, a cohort, one essay.
 *
 * The three published benchmark indexes are built by build-web.ts, which knows their names
 * and where their files live. Nothing could build an index out of anything else, which
 * meant the personal check had no way to exist: the design doc's wedge batches five
 * writers' texts into ONE index so the cohort costs a single pass over the corpus, and that
 * index had no builder. This is it.
 *
 * The asymmetry is the reason the whole thing is affordable. The scanner indexes the small
 * side and streams the big one, so five writers' collected work — a few megabytes — becomes
 * the index, and 21 GB of C4 streams past it once. Checking five people costs what checking
 * one costs.
 *
 * Indexes carry one-way hashes and item ids, never the text. That is what makes them safe
 * to keep and safe to hand to someone else, and it is the same property that lets published
 * benchmark indexes exist for benchmarks whose licence forbids redistributing the data.
 *
 *   node scripts/build-index.ts reports/writer.jsonl --name writer --out reports/writer.idx.bin.gz
 *   node src/cli.ts contaminate --index reports/writer.idx.bin.gz --corpus ../corpora/c4-en/shard.json.gz
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { encodeIndex, gzipBytes } from '../src/contamination/indexCodec.ts';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { DEFAULT_N, MAX_N, MIN_N } from '../src/contamination/types.ts';
import { loadBatch } from '../src/loader.ts';

const argv = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) {
    process.stderr.write(`\n  --${name} needs a value\n\n`);
    process.exit(2);
  }
  return v;
}

const input = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!input) {
  process.stderr.write('\n  usage: node scripts/build-index.ts <input.jsonl> [--name n] [--n 10] [--out path]\n\n');
  process.exit(2);
}

const n = Number(flag('n', String(DEFAULT_N)));
if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) {
  process.stderr.write(`\n  --n must be an integer between ${MIN_N} and ${MAX_N}\n\n`);
  process.exit(2);
}

const name = flag('name', input.replace(/^.*[/\\]/, '').replace(/\.jsonl$/i, ''));
const outPath = flag('out', `reports/${name}.idx.bin.gz`);

const records = loadBatch(resolve(input)).records;
if (records.length === 0) {
  process.stderr.write(`\n  REFUSED — ${input} has no readable records. An empty index scans clean\n`);
  process.stderr.write(`  against everything, which reads exactly like a result.\n\n`);
  process.exit(1);
}

const index = NgramIndex.build(name, records.map((r) => ({ id: r.id, text: r.text })), { n });

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), await gzipBytes(encodeIndex(index.serialize())));

const uncheckable = index.stats.uncheckableItems;
process.stdout.write(
  `\n  ${name}\n` +
    `    items        ${records.length.toLocaleString('en-US')}\n` +
    `    grams        ${index.size.toLocaleString('en-US')} at n=${n}\n` +
    `    index        ${(statSync(resolve(outPath)).size / 1e6).toFixed(2)} MB  ${outPath}\n`,
);

// The silence this scanner refuses to keep: an item shorter than n produces no grams, so
// nothing can ever match it. A clean result that does not say which items were never
// checkable is hiding the part of the input that was never examined.
if (uncheckable > 0) {
  process.stdout.write(
    `    UNCHECKABLE  ${uncheckable} item(s) are shorter than ${n} tokens and can never match.\n` +
      `                 Any "nothing found" must be read as "nothing found in the rest".\n`,
  );
}
process.stdout.write('\n');
