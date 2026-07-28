/**
 * Builds a reference corpus of NON-web-crawl text, for testing whether a benchmark match
 * is canonical rather than leaked.
 *
 * The test for canonicality is independence: text appearing in two corpora assembled from
 * genuinely different sources is a property of the language, not evidence that a benchmark
 * leaked. Text that leaked into one corpus is specific to that corpus.
 *
 * That test is worthless if the two corpora share provenance, which is the trap this file
 * exists to avoid. C4, RedPajama and FineWeb are ALL Common Crawl derivatives — a match
 * confirmed across two of them most likely means one web page survived both filtering
 * pipelines. The comparison would appear to pass while proving nothing.
 *
 * So this corpus is built from The Pile with every web-crawl subset REMOVED. What is left
 * is digitised books, court opinions, patents, academic abstracts, encyclopedia articles
 * and parliamentary proceedings — text whose route into a dataset never passed through a
 * crawler. A phrase appearing in both C4 and here reached them by different paths.
 *
 *   node scripts/fetch-reference-corpus.ts
 *   node scripts/canonicality-check.ts
 *
 * The Pile ships JSONL inside zstd, and every record carries meta.pile_set_name, which is
 * what makes the filtering auditable. Output is gzipped JSONL so the scanner reads it with
 * no new format support.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { createGzip, createZstdDecompress } from 'node:zlib';
import { withRetry } from './retry.ts';

const BASE = 'https://huggingface.co/datasets/monology/pile-uncopyrighted/resolve/main';
const PARTS = ['val.jsonl.zst', 'test.jsonl.zst'];

/**
 * Subsets removed because their text arrived via a web crawl or a scrape of the open web,
 * which is the same route C4 took. Keeping them would break the independence the whole
 * comparison rests on.
 */
const WEB_DERIVED = new Set(['Pile-CC', 'OpenWebText2', 'HackerNews', 'Ubuntu IRC']);

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const outDir = resolve(flag('out', '../corpora/pile-noncrawl'));
const cacheDir = join(outDir, 'download');

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function download(name: string): Promise<string> {
  const dest = join(cacheDir, name);
  const url = `${BASE}/${name}`;

  const head = await withRetry(name, async () => {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return Number(r.headers.get('content-length') ?? 0);
  });

  if (existsSync(dest) && statSync(dest).size === head && head > 0) {
    process.stdout.write(`  ${name}  ${(head / 1e6).toFixed(0)} MB  cached\n`);
    return dest;
  }

  await withRetry(name, async () => {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
    const tmp = `${dest}.partial`;
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmp));
    const got = statSync(tmp).size;
    if (head > 0 && got !== head) throw new Error(`expected ${head} bytes, got ${got}`);
    const { renameSync } = await import('node:fs');
    renameSync(tmp, dest);
  });

  process.stdout.write(`  ${name}  ${(head / 1e6).toFixed(0)} MB  fetched\n`);
  return dest;
}

mkdirSync(cacheDir, { recursive: true });
process.stdout.write(`\n  reference corpus (non-crawl subsets of The Pile) → ${outDir}\n\n`);

const sources: string[] = [];
for (const part of PARTS) sources.push(await download(part));

const outPath = join(outDir, 'pile-noncrawl.jsonl.gz');
const gzip = createGzip();
const sink = createWriteStream(outPath);
gzip.pipe(sink);

const kept: Record<string, number> = {};
const dropped: Record<string, number> = {};
let keptChars = 0;
const started = Date.now();

for (const src of sources) {
  const stream = createReadStream(src).pipe(createZstdDecompress());
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let row: { text?: unknown; meta?: { pile_set_name?: unknown } };
    try {
      row = JSON.parse(t) as typeof row;
    } catch {
      continue;
    }
    const set = String(row.meta?.pile_set_name ?? 'unknown');
    const text = row.text;
    if (typeof text !== 'string' || text.length === 0) continue;

    if (WEB_DERIVED.has(set)) {
      dropped[set] = (dropped[set] ?? 0) + 1;
      continue;
    }
    kept[set] = (kept[set] ?? 0) + 1;
    keptChars += text.length;

    // The document id carries its subset, so a match in the scan report says WHERE the
    // text was found. "confirmed in Gutenberg and FreeLaw" is the evidence; "confirmed in
    // the reference corpus" is not.
    const id = `${slug(set)}-${kept[set]}`;
    if (!gzip.write(JSON.stringify({ id, text, source: set }) + '\n')) {
      await new Promise((r) => gzip.once('drain', r));
    }
  }
}

gzip.end();
await new Promise((r) => sink.on('close', r));

const gzBytes = statSync(outPath).size;
const sha = await (async () => {
  const h = createHash('sha256');
  await pipeline(createReadStream(outPath), h);
  return h.digest('hex');
})();

const keptTotal = Object.values(kept).reduce((a, b) => a + b, 0);
const droppedTotal = Object.values(dropped).reduce((a, b) => a + b, 0);

writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify(
    {
      corpus: 'pile-noncrawl',
      purpose: 'canonicality reference: text whose route into a dataset never passed through a web crawler',
      licence: 'The Pile (uncopyrighted subset); component licences vary by subset',
      source: `${BASE}/{${PARTS.join(',')}}`,
      excludedAsWebDerived: [...WEB_DERIVED],
      fetchedAt: new Date().toISOString(),
      documents: keptTotal,
      droppedDocuments: droppedTotal,
      uncompressedChars: keptChars,
      file: { name: 'pile-noncrawl.jsonl.gz', bytes: gzBytes, sha256: sha },
      keptBySubset: kept,
      droppedBySubset: dropped,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

process.stdout.write(`\n  kept ${keptTotal.toLocaleString()} documents, dropped ${droppedTotal.toLocaleString()} as web-derived\n\n`);
for (const [k, v] of Object.entries(kept).sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`    ${k.padEnd(22)} ${v.toLocaleString().padStart(9)}\n`);
}
process.stdout.write(`\n  excluded: ${[...WEB_DERIVED].join(', ')}\n`);
process.stdout.write(`  ${(gzBytes / 1e6).toFixed(0)} MB gzipped · ${(keptChars / 1e9).toFixed(2)} GB of text · ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
process.stdout.write(`\n  next: node scripts/canonicality-check.ts\n\n`);
