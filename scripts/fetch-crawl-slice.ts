/**
 * Turns the captures cdx-check.ts found into a corpus the scanner can read.
 *
 * This is the second half of the design doc's prerequisite. The first half asks the
 * CommonCrawl index whether a writer's pages were ever collected; this one fetches the
 * specific pages it named. Not the crawl — the pages. Every capture carries a WARC
 * filename, a byte offset and a length, and CommonCrawl serves ranges over plain HTTP, so
 * a hundred of a writer's articles cost a hundred small reads instead of a multi-terabyte
 * download. That is the whole reason the URL-targeted route exists: without it, checking a
 * living writer against post-2021 web text is a corpus problem nobody solo can afford.
 *
 * Each range is its own gzip member — that is how WARC files are built — so the bytes come
 * back independently decompressible, with no need to touch the rest of the archive.
 *
 * On the text extraction: it is deliberately crude, and honest about it. Script and style
 * blocks go, tags go, entities are decoded, whitespace collapses. No boilerplate stripping,
 * no readability heuristics, no attempt to find "the article". That is the right trade here
 * because the scanner normalises to lowercase tokens with punctuation removed before it
 * matches anything — navigation furniture adds text that will not match, which costs a
 * little speed and cannot manufacture a hit. Under-extraction would be the dangerous
 * direction, so nothing is dropped that might be prose.
 *
 *   node scripts/cdx-check.ts https://example.com/post --out reports/writer.json
 *   node scripts/fetch-crawl-slice.ts reports/writer.json --out reports/writer.jsonl
 *   node src/cli.ts contaminate --index web/indexes/mmlu.idx.bin.gz --corpus reports/writer.jsonl
 *
 * Output is JSONL in the scanner's corpus shape, written to reports/, which is gitignored:
 * this is somebody's writing, fetched for one check, and it does not belong in a public
 * repository.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { type Capture, isContent } from './cdx-rules.ts';

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

const inputPath = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!inputPath) {
  process.stderr.write('\n  usage: node scripts/fetch-crawl-slice.ts <cdx-check output.json> [--out path] [--max n]\n\n');
  process.exit(2);
}
const outPath = flag('out', 'reports/crawl-slice.jsonl');
const max = Number(flag('max', '200'));
if (!Number.isInteger(max) || max <= 0) {
  process.stderr.write('\n  --max must be a positive integer\n\n');
  process.exit(2);
}

const BASE = 'https://data.commoncrawl.org/';
const MIN_GAP_MS = 200;
let lastRequestAt = 0;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A failed range read is not an empty page. Returning nothing on error would quietly shrink
 * the corpus and turn a network problem into "we found nothing in your writing", which is
 * the one answer this pipeline must never produce by accident.
 */
async function fetchRange(filename: string, offset: number, length: number): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    const since = Date.now() - lastRequestAt;
    if (since < MIN_GAP_MS) await sleep(MIN_GAP_MS - since);
    lastRequestAt = Date.now();

    let res: Response;
    try {
      res = await fetch(BASE + filename, {
        headers: { range: `bytes=${offset}-${offset + length - 1}` },
      });
    } catch (err) {
      if (attempt >= 5) throw new Error(`network failure: ${(err as Error).message}`);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`${res.status} after ${attempt} retries`);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    // 206 is the expected answer. A 200 means the server ignored the range and is sending
    // the whole archive, which must not be read as if it were one record.
    if (res.status !== 206) throw new Error(`expected 206 Partial Content, got ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
};

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Block-level tags become breaks so sentences on either side do not fuse into one word.
    .replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim();
}

/** WARC record: WARC headers, blank line, HTTP headers, blank line, body. */
function warcBody(raw: Buffer): { body: string; contentType: string } | null {
  const text = raw.toString('latin1');
  const afterWarc = text.indexOf('\r\n\r\n');
  if (afterWarc === -1) return null;
  const afterHttp = text.indexOf('\r\n\r\n', afterWarc + 4);
  if (afterHttp === -1) return null;

  const httpHeaders = text.slice(afterWarc + 4, afterHttp);
  const contentType = /content-type:\s*([^\r\n]+)/i.exec(httpHeaders)?.[1] ?? '';

  // Re-decode the body as UTF-8 from the original bytes: latin1 was only ever a safe way to
  // find the offsets without mangling them.
  const bodyStart = Buffer.byteLength(text.slice(0, afterHttp + 4), 'latin1');
  return { body: raw.subarray(bodyStart).toString('utf8'), contentType };
}

const report = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as {
  results: { target: string; crawls: { crawl: string; samples: Capture[] }[] }[];
};

// Same capture can appear in several crawls; the digest identifies identical content, so one
// fetch per distinct page is enough and re-crawls of an unchanged page cost nothing.
const wanted: { capture: Capture; crawl: string; target: string }[] = [];
const seenDigest = new Set<string>();
for (const r of report.results) {
  for (const c of r.crawls) {
    for (const s of c.samples) {
      if (!isContent(s)) continue;
      const key = (s as Capture & { digest?: string }).digest ?? `${s.filename}:${s.offset}`;
      if (seenDigest.has(key)) continue;
      seenDigest.add(key);
      wanted.push({ capture: s, crawl: c.crawl, target: r.target });
    }
  }
}

process.stdout.write(`\n  ${wanted.length} distinct pages to fetch (capped at ${max})\n\n`);

const rows: string[] = [];
let failed = 0;
let empty = 0;

for (const { capture, crawl, target } of wanted.slice(0, max)) {
  let text = '';
  try {
    const raw = await fetchRange(capture.filename, Number(capture.offset), Number(capture.length));
    const record = warcBody(gunzipSync(raw));
    if (record) text = htmlToText(record.body);
  } catch (err) {
    failed++;
    process.stdout.write(`  FAIL  ${capture.url.slice(0, 70)} — ${(err as Error).message}\n`);
    continue;
  }
  if (text.length < 200) {
    empty++;
    continue;
  }
  rows.push(
    JSON.stringify({
      id: `${crawl}:${capture.timestamp}:${capture.url}`,
      text,
      url: capture.url,
      timestamp: capture.timestamp,
      source: `commoncrawl ${crawl} · ${target}`,
    }),
  );
  if (rows.length % 10 === 0) process.stdout.write(`  ${rows.length} pages...\n`);
}

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), rows.join('\n') + (rows.length ? '\n' : ''), 'utf8');

const words = rows.reduce((a, r) => a + ((JSON.parse(r) as { text: string }).text.match(/\S+/g)?.length ?? 0), 0);
process.stdout.write(
  `\n  wrote ${outPath}\n` +
    `  ${rows.length} pages · ${words.toLocaleString('en-US')} words · ${empty} too short · ${failed} failed\n\n`,
);
if (failed > 0) {
  // Loud, because a short corpus and a clean scan look identical in the report that follows.
  process.stdout.write(`  ${failed} page(s) could not be read. A scan of what remains is a scan of LESS\n`);
  process.stdout.write(`  than the writer published, and any "nothing found" must say so.\n\n`);
}
