/**
 * Downloads public benchmarks and normalizes them to Ingot's schema.
 *
 * What gets indexed is the text that POSES each test item — the question, the prompt,
 * the function signature and docstring. That is what a model would need to have
 * memorised, and what uniquely identifies the item. Answers are excluded: they are
 * often short, formulaic, and shared across items, which would manufacture matches.
 *
 * Every benchmark records its licence and source URL, because a verification product
 * that plays loose with data licensing has no standing to audit anyone else.
 */
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Item = { id: string; text: string; subject?: string; source: string };

const argv = process.argv.slice(2);
const outFlag = argv.indexOf('--out');
if (outFlag !== -1 && (argv[outFlag + 1] === undefined || argv[outFlag + 1].startsWith('--'))) {
  process.stderr.write('\n  --out needs a value\n\n');
  process.exit(2);
}
/** Overridable so a verification run can fetch somewhere other than the data that produced published results. */
const OUT_DIR = resolve(outFlag === -1 ? 'data/bench' : argv[outFlag + 1]);

/**
 * Upstream revisions, and the hash of what they normalize to.
 *
 * Two of these follow immutable commits; MMLU cannot. The datasets-server /rows endpoint
 * takes no revision parameter, so there is no URL that pins it — which is exactly why the
 * hash matters more than the pin. Every benchmark is asserted by CONTENT, so drift is
 * caught the same way whether or not the source offered a revision to name.
 *
 * Why any of this: MMLU ids are positional (`mmlu-N` by row order), and every published
 * finding cites them. An upstream edit that inserts one row renumbers everything after it,
 * and each of the 342 flagged MMLU items in the registry would silently start pointing at a
 * different question. Nothing would look wrong. The scan would still pass every gate.
 *
 * Updating a hash here is not a chore — it means the benchmark moved, and every published
 * number measured against it needs re-deriving before the new hash is written down.
 */
const PINS = {
  gsm8k: {
    // Repo HEAD. The data file itself last changed 2021-10-28 and has been stable since.
    url: 'https://raw.githubusercontent.com/openai/grade-school-math/3101c7d5072418e28b9008a6636bde82a006892c/grade_school_math/data/test.jsonl',
    sha256: 'e219be40e9298d3ba8ca9b9bd0d40ad20de2e701e2f5d040c25d0c0ec9df959c',
  },
  humaneval: {
    // Repo HEAD 2025-01-17; HumanEval.jsonl.gz last changed 2021-07-08.
    url: 'https://github.com/openai/human-eval/raw/6d43fb980f9fee3c892a914eda09951f772ad10d/data/HumanEval.jsonl.gz',
    sha256: 'e81f109a7397ae2134d69b968525786515fd7fdbb434243e317a39867a5bf3f7',
  },
  mmlu: {
    // No revision parameter exists on this endpoint. Recorded for the record: the dataset
    // repository has been at c30699e8356da336a370243923dbaf21066bb9fe since 2024-03-08.
    revision: 'c30699e8356da336a370243923dbaf21066bb9fe',
    sha256: 'fba811640999d4eac516ad2c680451dd114af3e24726157573dcb3437a223e92',
  },
} as const;

async function get(url: string, asBuffer = false): Promise<string> {
  // The datasets server rate-limits. Give up too early and MMLU truncates mid-subject,
  // which silently produces a biased benchmark rather than a smaller one.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 6) throw new Error(`${res.status} after ${attempt} retries for ${url}`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    if (!asBuffer) return await res.text();
    return gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
  }
}

function write(name: keyof typeof PINS, items: Item[], licence: string): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, `${name}.jsonl`);
  const body = items.map((i) => JSON.stringify(i)).join('\n') + '\n';
  const digest = createHash('sha256').update(body, 'utf8').digest('hex');
  const expected = PINS[name].sha256;

  // Refuse before writing, not after. A benchmark that no longer hashes to its pin has
  // moved upstream, and writing it would rebuild every index and re-run every scan against
  // silently different data — the failure this whole pin exists to make loud.
  if (digest !== expected) {
    process.stderr.write(
      `\n  REFUSED — ${name} does not match its pinned content.\n` +
        `    expected  ${expected}\n` +
        `    fetched   ${digest}\n\n` +
        `  The benchmark changed upstream. Item ids are positional, so every published\n` +
        `  finding that cites one may now point at a different item. Re-derive the\n` +
        `  published numbers before updating the hash in scripts/fetch-benchmarks.ts.\n` +
        `  Nothing was written.\n\n`,
    );
    process.exit(1);
  }

  writeFileSync(path, body, 'utf8');
  process.stdout.write(
    `  ${name.padEnd(12)} ${String(items.length).padStart(6)} items  ${licence}  sha ${digest.slice(0, 12)}\n`,
  );
}

/** GSM8K test split — grade school maths word problems. MIT. */
async function gsm8k(): Promise<void> {
  const raw = await get(PINS.gsm8k.url);
  const items: Item[] = [];
  let i = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const row = JSON.parse(t) as { question?: string };
    if (!row.question) continue;
    items.push({ id: `gsm8k-${++i}`, text: row.question, source: 'openai/grade-school-math test.jsonl' });
  }
  write('gsm8k', items, 'MIT');
}

/** HumanEval — Python function synthesis. The prompt is signature plus docstring. MIT. */
async function humaneval(): Promise<void> {
  const raw = await get(PINS.humaneval.url, true);
  const items: Item[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const row = JSON.parse(t) as { task_id?: string; prompt?: string };
    if (!row.prompt || !row.task_id) continue;
    items.push({ id: row.task_id.replace('/', '-'), text: row.prompt, source: 'openai/human-eval' });
  }
  write('humaneval', items, 'MIT');
}

/**
 * MMLU test split via the HuggingFace datasets server, which pages at 100 rows.
 * Question plus choices, because the choice set is part of what identifies the item.
 */
async function mmlu(limit = 14_100): Promise<void> {
  // The known size of the MMLU test split. A fetch that lands far below it is truncated —
  // and a truncated write is the "silently biased benchmark" the header warns about: the
  // subjects that happen to sort late vanish, every downstream index under-counts, and
  // the page's item counts stop being true. This file used to catch the error, print one
  // line, and write the partial file anyway with exit 0; the existsSync guard below then
  // made the truncation permanent.
  const EXPECTED_MIN = 14_000;
  const items: Item[] = [];
  let offset = 0;
  while (offset < limit) {
    const url =
      `https://datasets-server.huggingface.co/rows?dataset=cais%2Fmmlu&config=all&split=test` +
      `&offset=${offset}&length=100`;
    let body: { rows?: { row: { question?: string; choices?: string[]; subject?: string } }[] };
    try {
      body = JSON.parse(await get(url));
    } catch (err) {
      process.stderr.write(`\n  REFUSED — mmlu fetch failed at offset ${offset}: ${String(err).slice(0, 120)}\n`);
      process.stderr.write(`  Writing the partial benchmark would bias every scan against it. Nothing was written.\n\n`);
      process.exit(1);
    }
    const rows = body.rows ?? [];
    if (rows.length === 0) break;
    for (const { row } of rows) {
      if (!row.question) continue;
      const choices = Array.isArray(row.choices) ? row.choices.join(' ') : '';
      items.push({
        id: `mmlu-${items.length + 1}`,
        text: `${row.question} ${choices}`.trim(),
        subject: row.subject,
        source: 'cais/mmlu test',
      });
    }
    offset += rows.length;
    if (offset % 2000 === 0) process.stdout.write(`    mmlu ${offset} rows...\n`);
  }
  if (items.length < EXPECTED_MIN) {
    process.stderr.write(
      `\n  REFUSED — mmlu fetched ${items.length} items, expected at least ${EXPECTED_MIN}. ` +
        `Truncated upstream response; nothing was written.\n\n`,
    );
    process.exit(1);
  }
  write('mmlu', items, 'MIT');
}

process.stdout.write('\n  fetching benchmarks\n\n');

if (existsSync(resolve(OUT_DIR, 'gsm8k.jsonl'))) process.stdout.write('  gsm8k        already present\n');
else await gsm8k();

if (existsSync(resolve(OUT_DIR, 'humaneval.jsonl'))) process.stdout.write('  humaneval    already present\n');
else await humaneval();

if (existsSync(resolve(OUT_DIR, 'mmlu.jsonl'))) process.stdout.write('  mmlu         already present\n');
else await mmlu();

process.stdout.write('\n  next: node scripts/registry-scan.ts\n\n');
