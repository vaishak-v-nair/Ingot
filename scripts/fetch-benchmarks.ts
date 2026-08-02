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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Item = { id: string; text: string; subject?: string; source: string };

const OUT_DIR = resolve('data/bench');

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

function write(name: string, items: Item[], licence: string): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, `${name}.jsonl`);
  writeFileSync(path, items.map((i) => JSON.stringify(i)).join('\n') + '\n', 'utf8');
  process.stdout.write(`  ${name.padEnd(12)} ${String(items.length).padStart(6)} items  ${licence}\n`);
}

/** GSM8K test split — grade school maths word problems. MIT. */
async function gsm8k(): Promise<void> {
  const raw = await get(
    'https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl',
  );
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
  const raw = await get('https://github.com/openai/human-eval/raw/master/data/HumanEval.jsonl.gz', true);
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
