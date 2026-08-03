/**
 * The recruitment screen decides whether a real person is asked to hand over their URLs
 * and wait for a report. A wrong yes spends their goodwill to measure our own coverage,
 * and a wrong no loses a writer whose words really are in the corpora.
 *
 * Every capture below is a real row returned by the CommonCrawl CDX index for
 * archiveofourown.org, kept verbatim. AO3 is the case the design doc warns about and the
 * case that broke two earlier versions of this rule, so it is the fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Capture, explain, isContent, outcomeFor } from '../scripts/cdx-rules.ts';

/** Newest crawl, 2026: every AO3 capture is this. The crawler reads the exclusion and leaves. */
const AO3_ROBOTS: Capture = {
  url: 'https://archiveofourown.org/robots.txt',
  timestamp: '20260710131405',
  status: '200',
  mime: 'text/plain',
  filename: 'crawl-data/CC-MAIN-2026-30/segments/1783663951376.37/robotstxt/CC-MAIN-20260710131147-20260710161147-00945.warc.gz',
  offset: '339028',
  length: '1306',
};

/** The homepage. Fetched, HTML, 200 — and not one word of anybody's writing. */
const AO3_ROOT: Capture = {
  url: 'https://archiveofourown.org/',
  timestamp: '20190418182008',
  status: '200',
  mime: 'text/html',
  filename: 'crawl-data/CC-MAIN-2019-18/segments/1555578526228.27/warc/CC-MAIN-20190418181435-20190418203435-00230.warc.gz',
  offset: '360690082',
  length: '10069',
};

const AO3_REDIRECT: Capture = {
  url: 'http://archiveofourown.org/',
  timestamp: '20190418182004',
  status: '302',
  mime: 'text/html',
  filename: 'crawl-data/CC-MAIN-2019-18/segments/1555578526228.27/crawldiagnostics/CC-MAIN-20190418181435-20190418203435-00247.warc.gz',
  offset: '839258',
  length: '605',
};

/** The site's own news section — a genuine page, and still nobody's fiction. */
const AO3_ADMIN_POST: Capture = {
  url: 'https://archiveofourown.org/admin_posts/10473?add_comment_reply_id=163807812&show_comments=true',
  timestamp: '20190420121648',
  status: '200',
  mime: 'text/html',
  filename: 'crawl-data/CC-MAIN-2019-18/segments/1555578529813.23/warc/CC-MAIN-20190420120902-20190420142902-00194.warc.gz',
  offset: '348065863',
  length: '26619',
};

test('isContent: robots.txt is not writing', () => {
  assert.equal(isContent(AO3_ROBOTS), false);
});

test('isContent: a homepage is not writing', () => {
  assert.equal(isContent(AO3_ROOT), false);
});

test('isContent: a redirect is a record of the crawler, not of a page', () => {
  assert.equal(isContent(AO3_REDIRECT), false);
});

test('isContent: a real article counts, even one nobody would call literature', () => {
  assert.equal(isContent(AO3_ADMIN_POST), true);
});

test('AO3 as it actually is: blocked today, readable in 2019', () => {
  // The real measured shape, from reports/cdx-ao3.json: sampling index pages 0, 4 and 7
  // of CC-MAIN-2019-18 returned 108 content captures including /works/ and /users/ pages,
  // while the whole of CC-MAIN-2026-30 is six copies of robots.txt. Skipping this
  // platform would discard a cohort whose pre-2019 writing is checkable against C4 with
  // no fetch at all; treating it as live would promise a slice that cannot be fetched.
  const screen = { mode: 'domain' as const, c4Content: 108, newestContent: 0, anyCaptures: 156 };
  assert.equal(outcomeFor(screen), 'screen-writer-urls');
  assert.match(explain(screen), /OLDER WRITING ONLY/);
});

test('a host absent from both crawls is the only platform actually skipped', () => {
  const screen = { mode: 'domain' as const, c4Content: 0, newestContent: 0, anyCaptures: 0 };
  assert.equal(outcomeFor(screen), 'skip-platform');
  assert.match(explain(screen), /never crawled/);
});

test('crawled today but only protocol files: skipped, and told why', () => {
  const screen = { mode: 'domain' as const, c4Content: 0, newestContent: 0, anyCaptures: 6 };
  assert.equal(outcomeFor(screen), 'skip-platform');
  assert.match(explain(screen), /only the front door and protocol files/);
});

test('a crawled host never clears an individual writer', () => {
  // The whole trap in one assertion: a platform full of crawled pages returns a verdict
  // about the platform. Only the writer's own URLs return a verdict about the writer.
  const busyPlatform = { mode: 'domain' as const, c4Content: 400, newestContent: 400, anyCaptures: 900 };
  assert.equal(outcomeFor(busyPlatform), 'screen-writer-urls');
  assert.match(explain(busyPlatform), /a crawled host is not a crawled writer/);
});

test('the writer\'s own URL in the C4 source crawl is the one yes', () => {
  assert.equal(outcomeFor({ mode: 'exact', c4Content: 1, newestContent: 1, anyCaptures: 2 }), 'recruit');
});

test('present only in recent crawls: recruit, but C4 is a guaranteed null', () => {
  const s = { mode: 'exact' as const, c4Content: 0, newestContent: 3, anyCaptures: 3 };
  assert.equal(outcomeFor(s), 'recruit-with-caveat');
  assert.match(explain(s), /C4 is a guaranteed null/);
});

test('a writer whose pages were never captured is never sent a null report', () => {
  assert.equal(outcomeFor({ mode: 'exact', c4Content: 0, newestContent: 0, anyCaptures: 0 }), 'do-not-recruit');
});
