/**
 * End-to-end throughput on a real corpus: gzipped bytes on disk to finished scan.
 *
 * `bench-scan.ts` measures the scan *kernel* — tokenize, roll, look up — over text already
 * read and already JSON-parsed, and says so. This measures the pipeline a user actually
 * runs. The two answer different questions, and the difference between them turned out to
 * be large enough that quoting the kernel figure as a scanning rate was an overclaim.
 *
 * Each stage adds exactly one thing to the previous, so the deltas attribute the cost
 * rather than inferring it. Run against one shard of a fetched pretraining corpus:
 *
 *   node scripts/bench-pipeline.ts --shard ../corpora/c4-en/c4-train.00000-of-01024.json.gz
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { CorpusHasher } from '../src/contamination/corpusHash.ts';
import { hashTokens } from '../src/contamination/fastTokens.ts';
import { NgramIndex, forEachNgramHashed } from '../src/contamination/ngramIndex.ts';
import { DEFAULT_N } from '../src/contamination/types.ts';
import { loadBatch } from '../src/loader.ts';

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const shard = resolve(flag('shard', '../corpora/c4-en/c4-train.00000-of-01024.json.gz'));
const benchPath = resolve(flag('bench', 'data/bench/mmlu.jsonl'));
const N = Number(flag('n', String(DEFAULT_N)));

if (!existsSync(shard)) {
  process.stderr.write(`\n  no shard at ${shard}\n  run: node scripts/fetch-pretraining.ts --shards 1\n\n`);
  process.exit(2);
}

const items = loadBatch(benchPath).records.map((r) => ({ id: r.id, text: r.text }));
const index = NgramIndex.build(basename(benchPath, '.jsonl'), items, { n: N });

type Stage = { parse?: boolean; hash?: boolean; scan?: boolean; lookup?: boolean };

async function run(label: string, opts: Stage): Promise<{ s: number; bytes: number; docs: number; tokens: number }> {
  const t0 = Date.now();
  let bytes = 0;
  let docs = 0;
  let tokens = 0;
  const full = opts.hash ? createHash('sha256') : null;
  const portable = opts.hash ? new CorpusHasher() : null;

  const gz = createReadStream(shard).pipe(createGunzip());
  gz.on('data', (c: Buffer) => {
    bytes += c.length;
  });
  const rl = createInterface({ input: gz, crlfDelay: Number.POSITIVE_INFINITY });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (full && portable) {
      full.update(trimmed);
      portable.add(trimmed);
    }
    if (!opts.parse) continue;

    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const text = row.text;
    if (typeof text !== 'string') continue;
    docs++;
    if (!opts.scan) continue;

    const { hashes, count } = hashTokens(text);
    tokens += count;
    if (!opts.lookup) continue;

    forEachNgramHashed(hashes, count, N, (key) => {
      index.lookup(key);
    });
  }

  if (full && portable) {
    full.digest('hex');
    await portable.digest(bytes);
  }

  const s = (Date.now() - t0) / 1000;
  process.stdout.write(`  ${label.padEnd(32)}${s.toFixed(1).padStart(8)}s${(bytes / 1e6 / s).toFixed(1).padStart(10)} MB/s\n`);
  return { s, bytes, docs, tokens };
}

process.stdout.write(
  `\n  ${basename(shard)} · ${(statSync(shard).size / 1e6).toFixed(0)} MB gzipped\n` +
    `  ${basename(benchPath)} · n=${N} · ${index.size.toLocaleString()} grams\n\n`,
);

const a = await run('A gunzip + readline', {});
const b = await run('B + JSON.parse', { parse: true });
const c = await run('C + corpus hashing', { parse: true, hash: true });
const d = await run('D + tokenize/hash', { parse: true, hash: true, scan: true });
const e = await run('E + ngram roll + index lookup', { parse: true, hash: true, scan: true, lookup: true });

const stages: [string, number][] = [
  ['gunzip + readline', a.s],
  ['JSON.parse', b.s - a.s],
  ['corpus hashing', c.s - b.s],
  ['tokenize/hash', d.s - c.s],
  ['ngram + lookup', e.s - d.s],
];

process.stdout.write(
  `\n  ${(a.bytes / 1e9).toFixed(2)} GB uncompressed · ${e.docs.toLocaleString()} docs · ` +
    `${e.tokens.toLocaleString()} tokens · ${(a.bytes / e.tokens).toFixed(2)} bytes/token\n\n`,
);
for (const [name, secs] of stages) {
  process.stdout.write(`  ${name.padEnd(24)}${secs.toFixed(1).padStart(7)}s${((secs / e.s) * 100).toFixed(0).padStart(5)}%\n`);
}

const mbs = a.bytes / 1e6 / e.s;
process.stdout.write(
  `\n  end to end: ${mbs.toFixed(1)} MB/sec, ${Math.round(e.tokens / e.s).toLocaleString()} tokens/sec\n` +
    `  20 GB would take ${(20_000 / mbs / 60).toFixed(0)} minutes single-threaded\n\n`,
);
