/**
 * Asks the public CommonCrawl index whether a writer's pages were ever crawled at all.
 *
 * This runs BEFORE recruiting anyone. The personal check scans a writer's published words
 * against corpora derived from CommonCrawl, so a writer whose site the crawler never
 * visited is guaranteed a null result — not because their words are absent from AI
 * training data, but because the corpora we can check were built from pages we can prove
 * were never fetched. Sending that person a "we found nothing" report would measure
 * nothing except our own coverage, and would spend a real person's goodwill to do it.
 *
 * Two questions get asked per host, and they are different questions:
 *
 *   CC-MAIN-2019-18   the April 2019 crawl C4 was built from. Absence here means C4 cannot
 *                     produce a hit for this writer, ever, no matter how much they wrote.
 *   the newest crawl  whether a targeted slice can be fetched today. This is the path the
 *                     design doc calls URL-targeted: look the pages up, fetch the specific
 *                     WARC ranges that contain them, scan those.
 *
 * Presence is necessary, not sufficient. C4 kept a small fraction of what it started from
 * — deduplication, English-only, a three-sentence-per-line rule, a blocklist. A host
 * present in CC-MAIN-2019-18 might still have been filtered out of C4 entirely. This
 * script reports what the index says and refuses to extrapolate past it, which is the same
 * rule the scanner itself follows.
 *
 * The output records WARC filename, offset and length for every capture found, because
 * that triple is exactly what the targeted fetch needs next. The screen and the input to
 * the scan are the same artifact.
 *
 *   node scripts/cdx-check.ts example.com https://blog.example/posts/one
 *   node scripts/cdx-check.ts --crawls CC-MAIN-2019-18,CC-MAIN-2024-10 example.com
 *   node scripts/cdx-check.ts --out reports/candidates.json example.com other.example
 *
 * Writes to reports/, which is gitignored: candidate hosts are outreach material and do
 * not belong in a public repository.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type Capture, explain, isContent } from './cdx-rules.ts';
import { parseScriptArgs } from './cli-flags.ts';

/** The crawl C4 was built from. docs/silent-failures.md: "C4 is Common Crawl from April 2019." */
const C4_CRAWL = 'CC-MAIN-2019-18';
const COLLINFO = 'https://index.commoncrawl.org/collinfo.json';

type HostResult = {
  target: string;
  matchType: 'domain' | 'exact';
  crawls: {
    crawl: string;
    captures: number;
    contentCaptures: number;
    pagesSampled: number[];
    indexPages: number | null;
    samples: Capture[];
  }[];
};

const USAGE =
  'node scripts/cdx-check.ts <url-or-domain> [more...] [--crawls a,b] [--limit n] [--out path]';

/**
 * The index server rate-limits hard and answers 503 under load. Giving up early would
 * report a writer as uncrawled when the truth is that we were throttled — a false null
 * that would then be sent to a person as a finding.
 */
const MAX_ATTEMPTS = 7;
/** One request per second, self-imposed. The index is a free public service. */
const MIN_GAP_MS = 1000;
let lastRequestAt = 0;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<{ status: number; body: string }> {
  for (let attempt = 0; ; attempt++) {
    const since = Date.now() - lastRequestAt;
    if (since < MIN_GAP_MS) await sleep(MIN_GAP_MS - since);
    lastRequestAt = Date.now();

    let res: Response;
    try {
      res = await fetch(url, { headers: { 'user-agent': 'ingot-cdx-check (+https://github.com/vaishak-v-nair/Ingot)' } });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw new Error(`network failure after ${attempt} retries: ${(err as Error).message}`);
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    // 504 belongs in here with 429 and 503: the index gateway times out under load, and
    // treating that as "no captures" is exactly the false null this whole script exists
    // to prevent. Refusing after the retries is the correct end state — a screen that
    // guesses is worse than a screen that stops.
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_ATTEMPTS) throw new Error(`${res.status} after ${attempt} retries for ${url}`);
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    return { status: res.status, body: await res.text() };
  }
}

/**
 * Everything runs inside main, and nothing at module scope awaits.
 *
 * This script used to be a top-level program with a top-level `await`, which makes its
 * module evaluation a promise. Calling `process.exit()` from inside that evaluation — which
 * every argument-validation path did — raced libuv's handle teardown on Windows and aborted
 * the process: `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c`,
 * exit code 127 instead of 2. A wrapper reading the exit code of a screen that refused its
 * arguments would have seen a crash and could not have told it apart from a real failure.
 *
 * Returning a code and letting the event loop drain avoids the whole class. It also gives
 * network failure somewhere to land: an exhausted retry used to surface as an unhandled
 * rejection, which for a screen whose entire purpose is to avoid reporting a false null is
 * the worst available ending.
 */
async function main(): Promise<number> {
  const { positional: targets, flags } = parseScriptArgs(
    { out: 'value', limit: 'value', crawls: 'value' },
    USAGE,
  );

  const outPath = flags.get('out') ?? 'reports/cdx-check.json';
  const limit = Number(flags.get('limit') ?? '50');
  if (!Number.isInteger(limit) || limit <= 0) {
    process.stderr.write('\n  --limit must be a positive integer\n\n');
    return 2;
  }
  const crawlsFlag = flags.get('crawls');

  if (targets.length === 0) {
    process.stderr.write(`\n  usage: ${USAGE}\n\n`);
    return 2;
  }

  process.stdout.write('\n  asking the CommonCrawl index which candidates were ever crawled\n\n');

  const { body: collBody } = await get(COLLINFO);
  const collections = JSON.parse(collBody) as { id: string; name: string; 'cdx-api': string }[];
  const newest = collections[0].id;

  const crawls = crawlsFlag ? crawlsFlag.split(',').map((c) => c.trim()).filter(Boolean) : [C4_CRAWL, newest];
  for (const c of crawls) {
    if (!collections.some((x) => x.id === c)) {
      process.stderr.write(`\n  unknown crawl: ${c}\n  (${collections.length} available, newest ${newest})\n\n`);
      return 2;
    }
  }

  // collinfo lists newest first, so a lower index is more recent. Which crawl counts as
  // "today" has to come from the list rather than from the default pair, or a custom
  // --crawls would silently make every host look uncrawled-today and skip them all.
  const recencyRank = new Map(collections.map((c, i) => [c.id, i]));
  const mostRecentChecked = [...crawls].sort((a, b) => recencyRank.get(a)! - recencyRank.get(b)!)[0];

  process.stdout.write(`  crawls: ${crawls.join(', ')}\n`);
  process.stdout.write(`  ${C4_CRAWL} is the crawl C4 was built from; absence there means C4 cannot hit\n\n`);

  const results: HostResult[] = [];

  for (const target of targets) {
    // A bare host screens the whole site including subdomains — foo.substack.com only shows
    // up under matchType=domain. A full URL with a path is asking about that one page.
    const hasPath = /^https?:\/\//i.test(target) && new URL(target).pathname.replace(/\/+$/, '') !== '';
    const matchType: 'domain' | 'exact' = hasPath ? 'exact' : 'domain';
    const queryUrl = hasPath ? target : target.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

    const hostResult: HostResult = { target, matchType, crawls: [] };
    process.stdout.write(`  ${target}  (${matchType})\n`);

    for (const crawl of crawls) {
      const base = `https://index.commoncrawl.org/${crawl}-index?url=${encodeURIComponent(queryUrl)}&matchType=${matchType}&output=json`;

      // Magnitude first, and it is deliberately reported as index pages rather than converted
      // into a record count: the number the API returns counts blocks of the index, not
      // captured pages, and quoting it as pages would be the invented-number failure.
      let indexPages: number | null = null;
      const pagesRes = await get(`${base}&showNumPages=true`);
      if (pagesRes.status === 200) {
        try {
          indexPages = (JSON.parse(pagesRes.body) as { pages: number }).pages;
        } catch {
          indexPages = null;
        }
      }

      // CDX returns records in URL-sorted order, so one page of results is the
      // alphabetically-first slice of a host rather than a sample of it. On AO3 that meant
      // fifty records that were all "/" and "/admin_posts" while the rest of the index went
      // unseen. Sampling the first, middle and last index page costs two extra requests and
      // removes the bias.
      const pagesSampled =
        indexPages && indexPages > 1 ? [...new Set([0, Math.floor(indexPages / 2), indexPages - 1])] : [0];

      const samples: Capture[] = [];
      for (const page of pagesSampled) {
        const res = await get(`${base}&limit=${limit}&page=${page}`);
        if (res.status === 200) {
          for (const line of res.body.split('\n')) {
            if (line.trim()) samples.push(JSON.parse(line) as Capture);
          }
        } else if (res.status !== 404) {
          // 404 is the index's way of saying no captures. Anything else is not an answer.
          throw new Error(`${res.status} from ${crawl} for ${target}: ${res.body.slice(0, 200)}`);
        }
      }

      const contentCaptures = samples.filter(isContent).length;
      hostResult.crawls.push({ crawl, captures: samples.length, contentCaptures, pagesSampled, indexPages, samples });

      const pages = indexPages === null ? '' : ` across ${indexPages} index page(s)`;
      process.stdout.write(
        `      ${crawl.padEnd(18)} ${String(samples.length).padStart(4)} sampled, ` +
          `${String(contentCaptures).padStart(4)} are real pages${pages}\n`,
      );
    }

    // The verdict names what the writer's report could contain, not what it will say.
    const verdict = explain({
      mode: matchType,
      c4Content: hostResult.crawls.find((c) => c.crawl === C4_CRAWL)?.contentCaptures ?? 0,
      newestContent: hostResult.crawls.find((c) => c.crawl === mostRecentChecked)?.contentCaptures ?? 0,
      anyCaptures: hostResult.crawls.reduce((a, c) => a + c.captures, 0),
    });
    process.stdout.write(`      -> ${verdict}\n\n`);
    results.push(hostResult);
  }

  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(
    resolve(outPath),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        c4SourceCrawl: C4_CRAWL,
        crawls,
        limit,
        note:
          'Presence in a crawl is necessary but not sufficient for presence in a derived corpus. ' +
          'C4 kept a small fraction of CC-MAIN-2019-18 after deduplication, English-only and ' +
          'line-quality filtering. Capture counts are samples capped by --limit, not totals.',
        results,
      },
      null,
      2,
    ),
    'utf8',
  );

  process.stdout.write(`  wrote ${outPath}\n`);
  process.stdout.write('  the WARC filename/offset/length in each capture is the input to the targeted fetch\n\n');

  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    // A screen that cannot reach the index must say so and stop. Reporting a writer as
    // uncrawled because we were throttled is the one answer this script exists to prevent.
    process.stderr.write(`\n  cdx-check failed: ${err instanceof Error ? err.message : String(err)}\n\n`);
    process.exitCode = 1;
  },
);
