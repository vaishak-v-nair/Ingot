/**
 * Builds a PROMPT-MATCHED machine corpus.
 *
 * Why this exists: dolly and alpaca do not share prompts, so any statistic that
 * separates them might be separating task distributions rather than human from
 * machine. The resolution sweep showed exactly that instability. The fix is a
 * paired design: take the same dolly prompts, have a current model answer them,
 * and compare responses to identical questions. Anything left is provenance.
 *
 * This also replaces a 2023-era machine reference with a current one, which is the
 * harder and more honest test. If the detection floor gets worse, that is the real
 * number and it goes in the report.
 *
 *   ANTHROPIC_API_KEY=... node scripts/generate-paired.ts [count]
 *
 * Resumable: rerun and it continues from what is already on disk.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBatch } from '../src/loader.ts';

const MODEL = process.env.INGOT_MODEL ?? 'claude-sonnet-5';
const CONCURRENCY = Number(process.env.INGOT_CONCURRENCY ?? 6);
const OUT = resolve('data/machine-paired.jsonl');
const TARGET = Number(process.argv[2] ?? 1500);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  process.stderr.write(
    '\n  ANTHROPIC_API_KEY is not set.\n' +
      '  This script generates the prompt-matched machine reference. Without it, Ingot falls\n' +
      '  back to the alpaca reference, which confounds provenance with task distribution.\n\n',
  );
  process.exit(1);
}

const prompts = loadBatch(resolve('data/human-dolly.jsonl')).records
  .filter((r) => r.prompt && r.prompt.trim().length > 0)
  .slice(0, TARGET);

mkdirSync(resolve('data'), { recursive: true });
const done = new Set<string>();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = JSON.parse(t) as { pairedWith?: string };
      if (row.pairedWith) done.add(row.pairedWith);
    } catch {
      // a truncated final line from an interrupted run, ignore it
    }
  }
}

const todo = prompts.filter((p) => !done.has(p.id));
process.stdout.write(
  `\n  paired generation — model ${MODEL}\n` +
    `  ${prompts.length} prompts targeted, ${done.size} already done, ${todo.length} to go\n\n`,
);

let completed = 0;
let failed = 0;

async function generate(prompt: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        process.stderr.write(`    ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}\n`);
        return null;
      }

      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = (body.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim();
      return text.length > 0 ? text : null;
    } catch (err) {
      if (attempt === 3) {
        process.stderr.write(`    network failure after retries: ${String(err)}\n`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  return null;
}

async function worker(queue: typeof todo): Promise<void> {
  for (;;) {
    const item = queue.pop();
    if (!item) return;
    const text = await generate(item.prompt!);
    if (text === null) {
      failed++;
      continue;
    }
    appendFileSync(
      OUT,
      JSON.stringify({
        id: `paired-${item.id}`,
        text,
        prompt: item.prompt,
        source: `paired:${MODEL}`,
        pairedWith: item.id,
      }) + '\n',
      'utf8',
    );
    completed++;
    if (completed % 25 === 0) {
      process.stdout.write(`  ${completed} generated, ${failed} failed, ${queue.length} left\n`);
    }
  }
}

const queue = todo.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

process.stdout.write(
  `\n  done: ${completed} generated, ${failed} failed → ${OUT}\n` +
    `  next: INGOT_MACHINE=data/machine-paired.jsonl node scripts/resolution-sweep.ts\n\n`,
);
