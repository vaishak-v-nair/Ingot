/**
 * End-to-end suite: drives the real shipped page — index.html, ingot.js, scan.worker.js —
 * in headless Chrome against deterministic synthetic indexes. Every scenario is a user
 * story the unit tests cannot see: the worker round-trip, the refusal states, the escort
 * controls (cancel, double-drop), and gzip-vs-plain hash parity in the actual browser.
 *
 *   node e2e/run.ts            — assemble the site from web/ and run everything
 *
 * Exits non-zero on any failure; CI runs this on every push.
 */
import { assembleSite, words } from './site.ts';
import { serveSite } from './server.ts';
import { Browser } from './cdp.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const failures: string[] = [];
let checks = 0;
function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}\n`);
}

const { dir, planted } = await assembleSite();
const server = await serveSite(dir);
// ?noauto=1 suppresses the page's auto-running sample scan: the suite's scenarios own
// every scan they assert about, so the instrument must open idle here (and only here).
const url = `http://127.0.0.1:${server.port}/?noauto=1`;
const browser = await Browser.launch();

/** The S1/S6 corpus, built identically on each call so gz and plain hash the same. */
const CORPUS_EXPR = `(() => {
  const rows = [JSON.stringify({ id: 'leak', text: 'filler start ' + ${JSON.stringify(planted)} })];
  for (let i = 0; i < 30; i++) {
    rows.push(JSON.stringify({ id: 'c' + i, text: 'clean english filler number ' + i + ' with a bit of length to it' }));
  }
  return rows.join('\\n') + '\\n';
})()`;

const drop = (fileExpr: string) => `(async () => {
  const file = await (async () => (${fileExpr}))();
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById('file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'dropped';
})()`;

async function freshPage(): Promise<void> {
  await browser.goto(url);
  const ready = await browser.waitFor(
    `document.getElementById('benchmeta').textContent.includes('hashes only')`,
    15000,
  );
  if (!ready) throw new Error('index never loaded');
}

// ---- S1: a real scan through the worker, with the receipt contract ----
await freshPage();
// The flagship claim — nothing leaves this machine — asserted, not assumed: every
// request from drop to verdict must target the suite's own server. A stray beacon,
// CDN import or telemetry call fails the run.
browser.requests = [];
await browser.eval(drop(`new File([${CORPUS_EXPR}], 'planted.jsonl')`));
check('S1 verdict renders', await browser.waitFor(`document.querySelector('#out .verdict')`));
const offsite = browser.requests.filter(
  (u) => !u.startsWith(`http://127.0.0.1:${server.port}/`) && !u.startsWith('data:'),
);
check('S1 network stays on this machine', offsite.length === 0, offsite.join(' '));
await sleep(1300); // count-up (650ms) settles before the number is read
check('S1 exactly one item flagged', (await browser.eval<string>(`document.querySelector('#out .big')?.textContent`)) === '1');
check('S1 specimen rendered', await browser.eval<boolean>(`!!document.querySelector('#out .hit--lead mark')`));
check('S1 rail becomes the receipt', (await browser.eval<string>(`document.querySelector('#rail-live h3')?.textContent`)) === 'Your scan');
const s1Hash = await browser.eval<string>(`document.querySelector('#rail-live dd.hash')?.textContent ?? ''`);
check('S1 rail carries a corpus hash', s1Hash.length === 32, s1Hash);
check(
  'S1 receipt command is the real invocation',
  await browser.eval<boolean>(
    `[...document.querySelectorAll('#out pre')].some(p => p.textContent.includes('npx ingot-scan contaminate --index gsm8k --corpus planted.jsonl'))`,
  ),
);
check('S1 no console errors', browser.errors.length === 0, browser.errors.join(' | '));

// ---- S6: the same corpus gzipped IN THE BROWSER scans to the same identity ----
await freshPage();
await browser.eval(
  drop(
    `await (async () => {
      const gzBlob = await new Response(new Blob([${CORPUS_EXPR}]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
      return new File([gzBlob], 'planted.jsonl.gz');
    })()`,
  ),
);
check('S6 gz verdict renders', await browser.waitFor(`document.querySelector('#out .verdict')`));
await sleep(1300);
check('S6 gz finds the same single item', (await browser.eval<string>(`document.querySelector('#out .big')?.textContent`)) === '1');
const s6Hash = await browser.eval<string>(`document.querySelector('#rail-live dd.hash')?.textContent ?? ''`);
check('S6 gz and plain share one corpus hash', s6Hash === s1Hash, `${s6Hash} vs ${s1Hash}`);
check('S6 no console errors', browser.errors.length === 0, browser.errors.join(' | '));

// ---- S2: a file the parser cannot read is refused, never called clean ----
await freshPage();
await browser.eval(drop(`new File(['this is not json\\n[1,2,3]\\nplain words\\n'], 'garbage.jsonl')`));
check('S2 refusal renders', await browser.waitFor(`document.querySelector('#out .refusal')`));
check(
  'S2 refusal names the failure',
  (await browser.eval<string>(`document.querySelector('#out .refusal b')?.textContent`)) === 'This file was not scanned.',
);
check('S2 no verdict, no green zero', await browser.eval<boolean>(`!document.querySelector('#out .verdict')`));
check('S2 rail cleared', await browser.eval<boolean>(`document.getElementById('rail-live').innerHTML.trim() === ''`));

// ---- S3: an empty file gets its own words ----
await freshPage();
await browser.eval(drop(`new File([''], 'empty.jsonl')`));
check('S3 empty-file refusal', await browser.waitFor(`document.querySelector('#out .refusal')`));
check(
  'S3 refusal says empty',
  (await browser.eval<string>(`document.querySelector('#out .refusal b')?.textContent`)) === 'This file is empty.',
);

// ---- S4 + S5: the escort controls on a scan long enough to catch mid-flight ----
await freshPage();
await browser.eval(`(() => {
  const rows = [];
  for (let i = 0; i < 100000; i++) {
    rows.push(JSON.stringify({ id: 'd' + i, text: 'wordy filler text goes on '.repeat(8) + i }));
  }
  window.__big = new File([rows.join('\\n')], 'big.jsonl');
  return window.__big.size;
})()`);
await browser.eval(drop(`window.__big`));
check(
  'S4 scan visibly under way',
  await browser.waitFor(`!document.getElementById('bar').hidden && document.getElementById('bar').value > 0`, 10000),
);
// The worker must be observable as a real browser target mid-scan, so that its DEATH
// after cancel is observable too — "nothing renders" cannot distinguish a terminated
// worker from a live one still burning CPU on a 48-minute file.
let workerSeen = false;
for (let i = 0; i < 20 && !workerSeen; i++) {
  workerSeen = (await browser.targets()).some((t) => t.type === 'worker');
  if (!workerSeen) await sleep(150);
}
check('S4 worker is a live target mid-scan', workerSeen);
const doubleDrop = await browser.eval<string>(`(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['{"text": "tiny"}'], 'second.jsonl'));
  const input = document.getElementById('file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return document.getElementById('status').textContent;
})()`);
check('S5 second drop refused', doubleDrop.includes('a scan is already running'), doubleDrop);
check('S5 first scan continues', await browser.eval<boolean>(`!document.getElementById('bar').hidden`));
check('S5 benchmark select locked', await browser.eval<boolean>(`document.getElementById('bench').disabled`));

await browser.eval(`document.getElementById('cancel').click(); 'clicked'`);
await sleep(300);
check(
  'S4 cancel message',
  (await browser.eval<string>(`document.getElementById('status').textContent`)).includes('scan cancelled'),
);
check('S4 controls reset', await browser.eval<boolean>(
  `document.getElementById('bar').hidden && document.getElementById('cancel').hidden && !document.getElementById('bench').disabled`,
));
check('S4 rail cleared', await browser.eval<boolean>(`document.getElementById('rail-live').innerHTML.trim() === ''`));
await sleep(2000);
check(
  'S4 nothing renders after cancel — the worker is dead',
  (await browser.eval<number>(`document.getElementById('out').innerHTML.trim().length`)) === 0,
);
let workerGone = !workerSeen; // only meaningful if the worker was observed alive
for (let i = 0; i < 25 && !workerGone; i++) {
  workerGone = !(await browser.targets()).some((t) => t.type === 'worker');
  if (!workerGone) await sleep(200);
}
check('S4 cancel terminates the worker target', workerGone);

// ---- S7: print never sees the scroll-reveal's hidden state ----
// Print rendering does not scroll, so an IntersectionObserver reveal that applies in
// print leaves every below-fold section as blank paper. Found by /qa 2026-07-30.
await freshPage();
await browser.send('Emulation.setEmulatedMedia', { media: 'print' });
const printOpacity = await browser.eval<string>(
  `getComputedStyle(document.querySelector('#findings > .wrap')).opacity`,
);
check('S7 sections are visible under print media', printOpacity === '1', `opacity=${printOpacity}`);
await browser.send('Emulation.setEmulatedMedia', { media: '' });

// ---- S8: the auto-demo — the page opens already measuring ----
// The one behavior every real visitor sees first is gated off under automation
// (navigator.webdriver), so it was the one behavior this suite could never reach.
// Spoofing webdriver false and loading WITHOUT ?noauto exercises the real wiring:
// no interaction, and the instrument must still produce a result on its own.
await browser.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });`,
});
await browser.goto(`http://127.0.0.1:${server.port}/`);
check(
  'S8 the instrument runs itself on arrival',
  await browser.waitFor(`document.querySelector('#out .verdict, #out .refusal')`, 20000),
);
check(
  'S8 auto-demo picked the sample benchmark',
  (await browser.eval<string>(`document.getElementById('bench').value`)) === 'humaneval',
);
check('S8 no console errors', browser.errors.length === 0, browser.errors.join(' | '));

// ---- S9: the primary action ----
// The writer CTA is what the week-3 demand gate counts. Until this scenario existed the
// suite bound to three ids and all three belonged to the scanner, so the one control the
// product decision rests on had no coverage at all. A CTA that is present but below the
// fold, or that does nothing for a visitor with no mail handler, reads as "writers did not
// want this" — a broken control misread as a measurement.
const ctaHref = await browser.eval<string>(
  `document.getElementById('check-mine')?.getAttribute('href') ?? ''`,
);
check('S9 the writer CTA exists and is a mailto link', ctaHref.startsWith('mailto:'), ctaHref.slice(0, 40));

// Above the fold at both a laptop and a phone. 1366x768 is the narrow desktop case where
// an earlier draft of this layout pushed the CTA off-screen; 390x844 is the phone.
for (const [w, h] of [
  [1366, 768],
  [390, 844],
] as const) {
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: w < 500,
  });
  await browser.goto(`http://127.0.0.1:${server.port}/?noauto=1`);
  const top = await browser.eval<number>(
    `document.getElementById('check-mine').getBoundingClientRect().top`,
  );
  check(
    `S9 the CTA is in the first viewport at ${w}x${h}`,
    top >= 0 && top < h,
    `top=${Math.round(top)} viewport=${h}`,
  );
}
await browser.send('Emulation.clearDeviceMetricsOverride');
await browser.goto(`http://127.0.0.1:${server.port}/?noauto=1`);

// The fallback address is the only thing standing between a visitor with no mail handler
// and a dead end. It ships in the markup rather than being injected, so it survives a
// script that never runs.
const fallback = await browser.eval<string>(
  `document.getElementById('check-sent')?.textContent ?? ''`,
);
check(
  'S9 a mail-handler fallback address is in the markup',
  fallback.includes('@'),
  fallback.trim().slice(0, 60),
);

// DESIGN.md: the no-JS page loses motion, never content. The CTA must work without the
// script, which it does by being a plain link rather than a button with a handler.
const ctaTag = await browser.eval<string>(`document.getElementById('check-mine').tagName`);
check('S9 the CTA works without JavaScript (it is an anchor)', ctaTag === 'A', ctaTag);

check('S9 no console errors', browser.errors.length === 0, browser.errors.join(' | '));

browser.close();
server.close();

process.stdout.write(
  `\n  e2e: ${checks - failures.length}/${checks} checks passed${failures.length ? `\n  FAILURES:\n    ${failures.join('\n    ')}` : ''}\n\n`,
);
process.exit(failures.length > 0 ? 1 : 0);
