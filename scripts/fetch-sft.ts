/**
 * Downloads SlimOrca and normalizes it for scanning: the first corpus in the registry
 * where benchmark leakage is chronologically POSSIBLE.
 *
 * Everything scanned so far forecloses the question. C4 is an April 2019 crawl — every
 * benchmark postdates it, so nothing could have leaked in. Dolly and alpaca are a few
 * million tokens of hand-written or davinci-generated instructions. SlimOrca is different:
 * ~500k GPT-4 completions over FLAN prompts, assembled in 2023 — two years after GSM8K and
 * HumanEval were published, three after MMLU. If benchmark text is inside, that is not
 * canonical overlap; the leak window was open. A null here is equally real: the
 * distillation set half the community fine-tunes on, measured clean against the test
 * splits rather than assumed clean.
 *
 *   node scripts/fetch-sft.ts
 *   node scripts/pretraining-scan.ts --corpus ../corpora/slimorca --out sft-slimorca
 *
 * SlimOrca ships ShareGPT-style rows: {"conversations":[{"from","value","weight"}]}. The
 * scanner reads a flat text field, so each row is flattened to every turn's text joined by
 * blank lines — system, human and gpt turns alike, because a leaked exam question can sit
 * in the prompt a "human" turn poses just as easily as in the answer a "gpt" turn gives.
 * The transformation is deterministic (same input bytes, same output bytes — Node's gzip
 * writes no timestamp), and the manifest records the source file's SHA-256 beside the
 * derived file's, so the derivation is checkable end to end. MIT licence, recorded.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { createGzip } from 'node:zlib';
import { withRetry } from './retry.ts';

const SOURCE_URL =
  'https://huggingface.co/datasets/Open-Orca/SlimOrca/resolve/main/oo-labeled_correct.gpt4.sharegpt.jsonl';
const SOURCE_NAME = 'oo-labeled_correct.gpt4.sharegpt.jsonl';

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const outDir = resolve(flag('out', '../corpora/slimorca'));
const cacheDir = join(outDir, 'download');

async function sha256(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

async function download(): Promise<string> {
  const dest = join(cacheDir, SOURCE_NAME);

  const head = await withRetry(SOURCE_NAME, async () => {
    const r = await fetch(SOURCE_URL, { method: 'HEAD', redirect: 'follow' });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return Number(r.headers.get('content-length') ?? 0);
  });

  if (existsSync(dest) && statSync(dest).size === head && head > 0) {
    process.stdout.write(`  ${SOURCE_NAME}  ${(head / 1e6).toFixed(0)} MB  cached\n`);
    return dest;
  }

  await withRetry(SOURCE_NAME, async () => {
    const res = await fetch(SOURCE_URL, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
    const tmp = `${dest}.partial`;
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmp));
    const got = statSync(tmp).size;
    if (head > 0 && got !== head) throw new Error(`expected ${head} bytes, got ${got}`);
    const { renameSync } = await import('node:fs');
    renameSync(tmp, dest);
  });

  process.stdout.write(`  ${SOURCE_NAME}  ${(head / 1e6).toFixed(0)} MB  fetched\n`);
  return dest;
}

mkdirSync(cacheDir, { recursive: true });
process.stdout.write(`\n  SlimOrca (2023 GPT-4/FLAN distillation set) → ${outDir}\n\n`);

const src = await download();
const srcSha = await sha256(src);

const outName = 'slimorca.jsonl.gz';
const outPath = join(outDir, outName);
const gzip = createGzip();
const sink = createWriteStream(outPath);
gzip.pipe(sink);

type Turn = { from?: unknown; value?: unknown };

let docs = 0;
let skipped = 0;
let chars = 0;
const started = Date.now();

const rl = createInterface({ input: createReadStream(src), crlfDelay: Number.POSITIVE_INFINITY });
for await (const line of rl) {
  const t = line.trim();
  if (!t) continue;
  let row: { conversations?: Turn[] };
  try {
    row = JSON.parse(t) as typeof row;
  } catch {
    skipped++;
    continue;
  }
  const turns = Array.isArray(row.conversations) ? row.conversations : [];
  const text = turns
    .map((turn) => (typeof turn.value === 'string' ? turn.value : ''))
    .filter((v) => v.length > 0)
    .join('\n\n');
  if (text.length === 0) {
    skipped++;
    continue;
  }
  docs++;
  chars += text.length;
  // U+2028/U+2029 are legal unescaped in a JSON string, and line-based readers — Node's
  // readline included — treat them as line breaks, shattering the document into
  // unparseable fragments. Six SlimOrca documents carry them. Escaping produces the
  // identical parsed string while keeping the physical file one-line-per-document for
  // every consumer's reader, not just ours.
  const out = JSON.stringify({ id: `slimorca-${docs}`, text })
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  if (!gzip.write(out + '\n')) {
    await new Promise((r) => gzip.once('drain', r));
  }
  if (docs % 100_000 === 0) {
    process.stdout.write(`    ${(docs / 1e3).toFixed(0)}k documents · ${(chars / 1e6).toFixed(0)}M chars · ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
  }
}

gzip.end();
await new Promise((r) => sink.on('close', r));

const gzBytes = statSync(outPath).size;
const gzSha = await sha256(outPath);

// The shards[] shape is what pretraining-scan.ts consumes; the sourceFile block is the
// provenance that makes the derived bytes checkable against the published ones.
writeFileSync(
  join(outDir, 'manifest.json'),
  JSON.stringify(
    {
      corpus: 'slimorca',
      purpose:
        'first corpus in the registry where benchmark leakage is chronologically possible: a 2023 distillation set assembled after every scanned benchmark was published',
      licence: 'MIT',
      source: SOURCE_URL,
      fetchedAt: new Date().toISOString(),
      documents: docs,
      skippedLines: skipped,
      uncompressedChars: chars,
      transformation:
        'scripts/fetch-sft.ts — conversations[].value joined with blank lines, all roles kept; deterministic, byte-reproducible',
      sourceFile: { name: SOURCE_NAME, bytes: statSync(src).size, sha256: srcSha },
      shards: [{ name: outName, url: SOURCE_URL, bytes: gzBytes, sha256: gzSha }],
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

process.stdout.write(
  `\n  ${docs.toLocaleString()} documents · ${skipped} skipped · ${(chars / 1e9).toFixed(2)} GB of text · ` +
    `${(gzBytes / 1e6).toFixed(0)} MB gzipped · ${((Date.now() - started) / 1000).toFixed(0)}s\n` +
    `  source sha256 ${srcSha.slice(0, 12)}… · derived sha256 ${gzSha.slice(0, 12)}…\n` +
    `\n  next: node scripts/pretraining-scan.ts --corpus ${outDir} --out sft-slimorca\n\n`,
);
