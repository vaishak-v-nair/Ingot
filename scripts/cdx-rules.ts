/**
 * The pure rules behind "should this writer be recruited", in one importable place.
 *
 * They live apart from cdx-check.ts for the same reason triage-rules.ts does: importing a
 * script executes it, so logic that decides something consequential would otherwise have
 * no tests. What this decides is consequential — whether a real person is asked to hand
 * over their URLs and wait for a report. Getting it wrong spends their goodwill to
 * measure our own coverage.
 *
 * Archive of Our Own is why this file exists, and it killed three wrong rules on the way
 * here. "Was this host crawled" — AO3 answers yes in both crawls, so it said recruit.
 * "Were real pages crawled" — AO3 passes that too, on its own /admin_posts news section.
 * "Is it crawled today" skipped AO3 outright, and was wrong in the other direction:
 * sampling the whole index instead of its alphabetically-first page turned up /works/ and
 * /users/ pages captured in April 2019 under the insecure.archiveofourown.org host. Today
 * AO3 returns nothing but robots.txt. In 2019 the crawler read the fiction.
 *
 * What survived: **a crawled host is not a crawled writer**, and the two crawls answer
 * different questions. The newest says whether a slice can be fetched now. The 2019 one
 * says whether the corpus already on disk can answer with no fetch at all — so a platform
 * blocked today can still be fully checkable for anything published before April 2019.
 *
 * So the two modes answer different questions and only one of them may say "recruit":
 *
 *   domain  a pre-filter over a publishing platform. It can rule a platform OUT, and it
 *           can say "keep going" — it can never clear an individual, because the pages
 *           sampled belong to whoever happens to sort first.
 *   exact   the writer's own URLs, which is what the design doc actually asks for. This
 *           is the only mode whose answer is about a person.
 */

/** One row of the CommonCrawl CDX index. filename/offset/length locate the WARC record. */
export type Capture = {
  url: string;
  timestamp: string;
  status: string;
  mime: string;
  filename: string;
  offset: string;
  length: string;
};

/** Fetched, but never a writer's page. */
const NON_CONTENT = /^\/(robots\.txt|sitemap[^/]*|favicon\.ico|feeds?|rss|atom)(\/|$)/i;

export function isContent(c: Capture): boolean {
  // A redirect or an error page is a capture of the crawler's experience, not of writing.
  if (c.status !== '200') return false;
  if (!/^text\/html/i.test(c.mime ?? '')) return false;
  let path: string;
  try {
    path = new URL(c.url).pathname;
  } catch {
    return false;
  }
  if (NON_CONTENT.test(path)) return false;
  // The root alone is a homepage. Somebody's writing lives at a path.
  return path.replace(/\/+$/, '') !== '';
}

export type Mode = 'domain' | 'exact';

export type Screen = {
  mode: Mode;
  /** Content captures in the April 2019 crawl C4 was built from. */
  c4Content: number;
  /** Content captures in the newest crawl — whether a targeted slice is fetchable today. */
  newestContent: number;
  /** Every capture of any kind, content or not. Distinguishes "excluded" from "unknown". */
  anyCaptures: number;
};

export type Outcome =
  | 'recruit'
  | 'recruit-with-caveat'
  | 'do-not-recruit'
  | 'screen-writer-urls'
  | 'skip-platform';

export function outcomeFor(s: Screen): Outcome {
  if (s.mode === 'domain') {
    // Either crawl is enough, and they buy different things. The newest crawl means a
    // targeted slice can be fetched today. The C4 source crawl means the check needs no
    // fetch at all, because that corpus is already on disk. A platform blocked today can
    // still be entirely checkable for writing published before April 2019 — which is
    // exactly AO3, and is the correction that a newest-crawl-only rule got wrong.
    return s.c4Content > 0 || s.newestContent > 0 ? 'screen-writer-urls' : 'skip-platform';
  }
  if (s.c4Content > 0) return 'recruit';
  if (s.newestContent > 0) return 'recruit-with-caveat';
  return 'do-not-recruit';
}

export function explain(s: Screen): string {
  switch (outcomeFor(s)) {
    case 'screen-writer-urls':
      return s.newestContent === 0
        ? 'PLATFORM OK FOR OLDER WRITING ONLY — blocked in the newest crawl, but present in the C4 source crawl, so anything published before April 2019 is checkable against the corpus already on disk. Screen the writer\'s own URLs'
        : 'PLATFORM OK — real pages are still being crawled here. Now screen the writer\'s own URLs: a crawled host is not a crawled writer';
    case 'skip-platform':
      return s.anyCaptures > 0
        ? 'SKIP THIS PLATFORM — the newest crawl holds only the front door and protocol files, so nothing written here is being collected'
        : 'SKIP THIS PLATFORM — never crawled in the crawls checked';
    case 'recruit':
      return 'RECRUIT — this writing is in the C4 source crawl (C4 filtering may still have dropped it), and a targeted slice is fetchable';
    case 'recruit-with-caveat':
      return 'RECRUIT WITH A CAVEAT — absent from the C4 source crawl, so C4 is a guaranteed null; the honest check is the targeted slice';
    default:
      return 'DO NOT RECRUIT — this writing was never collected; every corpus would return a structurally guaranteed null';
  }
}
