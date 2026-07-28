/**
 * Downloads shards of a public pretraining corpus, for scanning benchmarks against the
 * data models are actually trained on.
 *
 * The registry's first pass scanned instruction-tuning sets — alpaca and dolly, a few
 * million tokens each — and found essentially nothing. That was the wrong place to look.
 * Contamination enters during pretraining, from web text that happens to contain the
 * benchmark, so a corpus of web text is the only one where the question has an answer.
 *
 *   c4/en   Common Crawl, cleaned, April 2019   ODC-BY   1024 shards
 *
 * C4 is chosen because it is the corpus behind T5 and is reused widely enough that a
 * finding matters; because it predates none of the benchmarks scanned against it, which
 * is what makes leakage possible rather than assumed; and because it ships as gzipped
 * JSONL with a `text` field, so Ingot scans the published bytes with no transformation
 * step between download and result. Nothing here rewrites the corpus, which means a
 * reader reproduces the scan by fetching the same URLs.
 *
 *   node scripts/fetch-pretraining.ts --shards 26 --out ../corpora/c4-en
 *
 * Resumable: a shard whose size already matches the server's is left alone, so an
 * interrupted download costs only the shard it was on.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { withRetry } from './retry.ts';

const TOTAL_SHARDS = 1024;
const BASE = 'https://huggingface.co/datasets/allenai/c4/resolve/main/en';

type Manifest = {
  corpus: string;
  licence: string;
  source: string;
  fetchedAt: string;
  shards: { name: string; url: string; bytes: number; sha256: string }[];
};

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const shardCount = Number(flag('shards', '26'));
// Defaults beside the repository, not inside it. A pretraining corpus is gigabytes of
// third-party data under its own licence, and the manifest written here makes it
// reproducible from the URLs — so there is never a reason for it to enter a git tree.
const outDir = resolve(flag('out', '../corpora/c4-en'));

if (!Number.isInteger(shardCount) || shardCount < 1 || shardCount > TOTAL_SHARDS) {
  process.stderr.write(`--shards must be between 1 and ${TOTAL_SHARDS}\n`);
  process.exit(2);
}

function shardName(i: number): string {
  // Both halves are padded to five digits: c4-train.00000-of-01024.json.gz
  const pad = (n: number) => String(n).padStart(5, '0');
  return `c4-train.${pad(i)}-of-${pad(TOTAL_SHARDS)}.json.gz`;
}

function human(bytes: number): string {
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

async function sha256(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

async function remoteSize(url: string): Promise<number> {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return Number(res.headers.get('content-length') ?? 0);
}

/** Returns true when the shard was downloaded, false when it was already complete. */
async function fetchShard(url: string, dest: string, expected: number): Promise<boolean> {
  if (existsSync(dest) && statSync(dest).size === expected && expected > 0) return false;

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText} for ${url}`);

  // Written to a temporary name and renamed only on success, so an interrupted run can
  // never leave a truncated shard that looks complete to the next one.
  const tmp = `${dest}.partial`;
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmp));

  const got = statSync(tmp).size;
  if (expected > 0 && got !== expected) {
    throw new Error(`${basename(dest)}: expected ${expected} bytes, got ${got}`);
  }
  const { renameSync } = await import('node:fs');
  renameSync(tmp, dest);
  return true;
}

mkdirSync(outDir, { recursive: true });
process.stdout.write(`\n  c4/en · ${shardCount} of ${TOTAL_SHARDS} shards → ${outDir}\n\n`);

const shards: Manifest['shards'] = [];
let downloadedBytes = 0;
const started = Date.now();

for (let i = 0; i < shardCount; i++) {
  const name = shardName(i);
  const url = `${BASE}/${name}`;
  const dest = join(outDir, name);

  const expected = await withRetry(name, () => remoteSize(url));
  const label = `  [${String(i + 1).padStart(3)}/${shardCount}] ${name}`;

  const fetched = await withRetry(name, () => fetchShard(url, dest, expected));
  const bytes = statSync(dest).size;
  if (fetched) downloadedBytes += bytes;

  const digest = await sha256(dest);
  shards.push({ name, url, bytes, sha256: digest });

  const elapsed = (Date.now() - started) / 1000;
  const rate = downloadedBytes > 0 ? ` · ${(downloadedBytes / 1e6 / elapsed).toFixed(1)} MB/s` : '';
  process.stdout.write(`${label}  ${human(bytes)}  ${fetched ? 'fetched' : 'cached '}  ${digest.slice(0, 12)}${rate}\n`);
}

const totalBytes = shards.reduce((a, s) => a + s.bytes, 0);
const manifestPath = join(outDir, 'manifest.json');
const manifest: Manifest = {
  corpus: `c4-en-${shardCount}shards`,
  licence: 'ODC-BY',
  source: `${BASE}/c4-train.<shard>-of-${String(TOTAL_SHARDS).padStart(5, '0')}.json.gz`,
  // Preserved across resumed runs: the first fetch is when these bytes were obtained.
  fetchedAt: existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest).fetchedAt
    : new Date().toISOString(),
  shards,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

process.stdout.write(`\n  ${shardCount} shards · ${human(totalBytes)} compressed · manifest → ${manifestPath}\n`);
process.stdout.write(`\n  next: node scripts/pretraining-scan.ts --corpus ${outDir}\n\n`);
