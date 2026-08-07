/**
 * Would this text have survived into C4 at all?
 *
 * The scanner answers "is your writing in this corpus". It cannot answer the question
 * underneath, which matters just as much to whoever asked: **could it ever have been?**
 * C4 is not the April 2019 crawl — it is what survived a documented cleaning pass over
 * that crawl, and the pass is aggressive. A writer whose pages were crawled, indexed, and
 * then discarded by a blocklist gets a clean scan that means nothing about them and
 * everything about the corpus.
 *
 * That distinction is the difference between "we did not find your words" and "we could
 * not have found your words", and a product that says the first when the second is true is
 * lying with a true sentence.
 *
 * The rules below are C4's own, from Raffel et al. 2020 (the T5 paper), appendix on
 * cleaning the Common Crawl:
 *
 *   1. keep only lines ending in a terminal punctuation mark
 *   2. keep only lines of at least 3 words; discard pages with fewer than 5 such lines
 *   3. discard any page containing a word from the "bad words" list
 *   4. discard any line containing "javascript"
 *   5. discard any page containing "lorem ipsum"
 *   6. discard any page containing a curly brace
 *
 * Two of C4's rules are NOT simulated and the output says so: the corpus-wide
 * three-sentence deduplication, which cannot be judged from one document, and the
 * langdetect English>=0.99 gate. Both can only remove pages, so every survival rate this
 * prints is an UPPER bound. That direction is deliberate — an over-estimate of survival
 * makes a null result look more meaningful than it is, which is the error worth refusing to
 * make quietly rather than the one worth hiding.
 *
 * The word list is fetched to data/ (gitignored) rather than committed, and this script
 * only ever reports counts from it. A public repository does not need a copy of an
 * obscenity list to make its point.
 *
 *   node scripts/c4-filter-sim.ts reports/writer.jsonl
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBatch } from '../src/loader.ts';
import { parseScriptArgs } from './cli-flags.ts';

const LIST_URL =
  'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en';
const LIST_PATH = resolve('data/c4-badwords.txt');

const USAGE = 'node scripts/c4-filter-sim.ts <corpus.jsonl>';
const { positional } = parseScriptArgs({}, USAGE);
const input = positional[0];
if (!input || positional.length > 1) {
  process.stderr.write(`\n  usage: ${USAGE}\n\n`);
  process.exit(2);
}

async function badWords(): Promise<string[]> {
  if (!existsSync(LIST_PATH)) {
    process.stdout.write('  fetching the word list C4 filtered on\n');
    const res = await fetch(LIST_URL);
    if (!res.ok) throw new Error(`${res.status} fetching the filter list`);
    mkdirSync(resolve('data'), { recursive: true });
    writeFileSync(LIST_PATH, await res.text(), 'utf8');
  }
  return readFileSync(LIST_PATH, 'utf8')
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

const list = await badWords();
// Phrases as well as single words appear in the list, so it is matched as alternation with
// boundaries rather than by tokenising — "bad word" would never match a token set.
const escaped = list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
const badRe = new RegExp(`(?<![a-z])(?:${escaped.join('|')})(?![a-z])`, 'i');

const TERMINAL = /[.!?"'”’]\s*$/;

type Verdict = { id: string; kept: boolean; reason: string; keptLines: number; words: number };

function judge(id: string, text: string): Verdict {
  const words = text.match(/\S+/g)?.length ?? 0;
  const lower = text.toLowerCase();

  if (text.includes('{')) return { id, kept: false, reason: 'curly brace (read as code)', keptLines: 0, words };
  if (lower.includes('lorem ipsum')) return { id, kept: false, reason: 'lorem ipsum', keptLines: 0, words };
  if (badRe.test(lower)) return { id, kept: false, reason: 'blocklisted word', keptLines: 0, words };

  let keptLines = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.toLowerCase().includes('javascript')) continue;
    if (!TERMINAL.test(t)) continue;
    if ((t.match(/\S+/g)?.length ?? 0) < 3) continue;
    keptLines++;
  }
  if (keptLines < 5) return { id, kept: false, reason: `only ${keptLines} usable line(s)`, keptLines, words };
  return { id, kept: true, reason: '', keptLines, words };
}

const records = loadBatch(resolve(input)).records;
const verdicts = records.map((r) => judge(r.id, r.text));
const kept = verdicts.filter((v) => v.kept);

const byReason = new Map<string, number>();
for (const v of verdicts) {
  if (v.kept) continue;
  const key = v.reason.startsWith('only ') ? 'too few usable lines' : v.reason;
  byReason.set(key, (byReason.get(key) ?? 0) + 1);
}

process.stdout.write(`\n  ${records.length} document(s) from ${input}\n`);
process.stdout.write(`  ${list.length.toLocaleString('en-US')} entries in the blocklist C4 used\n\n`);
process.stdout.write('  rejected by\n');
for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
  process.stdout.write(`    ${String(n).padStart(4)}  ${reason}\n`);
}

const pct = (n: number): string => ((n / records.length) * 100).toFixed(1);
process.stdout.write(
  `\n  SURVIVING C4's CLEANING:  ${kept.length} of ${records.length}  (${pct(kept.length)}%)\n\n` +
    `  Upper bound. Corpus-wide 3-sentence deduplication and the langdetect English gate\n` +
    `  are not simulated, and both can only remove more.\n\n`,
);

if (kept.length === 0) {
  process.stdout.write(
    `  Nothing here could be in C4. A clean scan against it would say nothing about this\n` +
      `  writing and everything about the corpus, and any report must say so in those words.\n\n`,
  );
}
