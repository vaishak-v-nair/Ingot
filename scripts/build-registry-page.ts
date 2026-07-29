/**
 * Renders results/registry.json into web/registry.html.
 *
 * The registry is the discovery mechanism: it tells someone they have a problem before
 * they think to look for one. That only works if it is a page, not a JSON file in a
 * repository.
 *
 * Generated rather than hand-written, so the page cannot drift from the scan that produced
 * it. Every number here comes out of the same file CI checks.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_N, LEGACY_N } from '../src/contamination/types.ts';

type Sample = { benchmarkItemId: string; corpusDocId: string; contextBefore: string; matchedText: string; contextAfter: string };
type Row = {
  benchmark: string; corpus: string; n: number;
  itemsTotal: number; itemsHit: number; rate: number; totalMatches: number;
  uncheckableItems: number; corpusDocs: number; corpusTokens: number;
  corpusHash: string; elapsedMs: number; contaminatedItemIds: string[]; samples: Sample[];
};
type Registry = {
  scanner: string; defaultN: number; legacyN: number;
  benchmarks: string[]; corpora: string[]; results: Row[];
  crossCorpus?: { itemKey: string; corpora: string[] }[];
};

const registry = JSON.parse(readFileSync(resolve('results/registry.json'), 'utf8')) as Registry;

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function table(n: number): string {
  const rows = registry.results.filter((r) => r.n === n);
  const body = rows
    .map(
      (r) => `        <tr>
          <td>${esc(r.benchmark)}</td><td>${esc(r.corpus)}</td>
          <td class="num">${r.itemsHit} / ${r.itemsTotal.toLocaleString()}</td>
          <td class="num">${(r.rate * 100).toFixed(2)}%</td>
          <td class="num">${r.totalMatches}</td>
          <td class="num">${r.uncheckableItems}</td>
        </tr>`,
    )
    .join('\n');
  return `      <table>
        <tr><th>benchmark</th><th>corpus</th><th class="num">flagged</th><th class="num">rate</th><th class="num">matches</th><th class="num">unscannable</th></tr>
${body}
      </table>`;
}

const evidence = registry.results
  .filter((r) => r.n === DEFAULT_N && r.samples.length > 0)
  .map(
    (r) => `    <h4>${esc(r.benchmark)} in ${esc(r.corpus)}</h4>
${r.samples
  .map(
    (s) => `    <div class="hit">
      <code>${esc(s.benchmarkItemId)} &rarr; ${esc(s.corpusDocId)}</code>
      <div class="quote">…${esc(s.contextBefore)}<mark>${esc(s.matchedText)}</mark>${esc(s.contextAfter)}…</div>
    </div>`,
  )
  .join('\n')}`,
  )
  .join('\n');

const cross = (registry.crossCorpus ?? [])
  .map((c) => `      <li><code>${esc(c.itemKey)}</code> appears in ${c.corpora.map(esc).join(' and ')}</li>`)
  .join('\n');

/**
 * Distinct benchmark items, not rows.
 *
 * HumanEval-78 is flagged in both corpora: two rows, one finding. Summing itemsHit gives 7
 * where the honest count is 6, and summing itemsTotal counts every benchmark once per
 * corpus. Both mistakes inflate, which is the direction that matters here.
 */
const atDefault = registry.results.filter((r) => r.n === DEFAULT_N);
const totalItems = [...new Map(atDefault.map((r) => [r.benchmark, r.itemsTotal])).values()]
  .reduce((sum, n) => sum + n, 0);
const flaggedIds = new Set(atDefault.flatMap((r) => r.contaminatedItemIds.map((id) => `${r.benchmark}::${id}`)));
const totalFlagged = flaggedIds.size;
const flagRows = atDefault.reduce((sum, r) => sum + r.itemsHit, 0);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ingot registry — which benchmarks appear in which corpora</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M14 22h36l8 20H6z' fill='%239a6a00'/%3E%3C/svg%3E">
<meta name="description" content="A public record of which benchmarks appear inside which public training corpora, reproducible from the same files.">
<style>
  /* Same two faces the rest of the site serves, from the same origin. This page is
     generated, which is exactly why it was the page that never got them: nobody edits it,
     so it drifted into system-sans headings while index.html moved to the serif. Fonts
     live in web/fonts/ and are same-origin, so the CSP and the no-external-request
     assertion both still hold. */
  @font-face {
    font-family: "Instrument Serif"; font-style: normal; font-weight: 400;
    font-display: swap; src: url("fonts/instrument-serif-400.woff2") format("woff2");
  }
  @font-face {
    font-family: "JetBrains Mono"; font-style: normal; font-weight: 400;
    font-display: swap; src: url("fonts/jetbrains-mono-400.woff2") format("woff2");
  }
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --ink: #16150f; --paper: #fbfaf7; --dim: #6d6a5c; --line: #ddd9cc; --card: #fff;
    --gold: #9a6a00; --hot: #ff9d1f; --ok: #2f6b34;
    --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    --display: "Instrument Serif", Georgia, "Times New Roman", serif;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #f2efe4; --paper: #0e0d09; --dim: #9a968a; --line: #2b281f; --card: #16150f;
            --gold: #e0aa3e; --ok: #7fbf85; }
  }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.55 var(--sans); overflow-x: hidden; }
  a { color: inherit; }
  .wrap { max-width: 54rem; margin: 0 auto; padding: 0 1.25rem; }
  nav { border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5;
        background: color-mix(in srgb, var(--paper) 88%, transparent); backdrop-filter: blur(8px); }
  nav .wrap { display: flex; align-items: center; gap: 1.25rem; padding-top: .75rem; padding-bottom: .75rem; }
  .brand { font-family: var(--mono); font-size: .78rem; letter-spacing: .22em; text-transform: uppercase; color: var(--gold); margin-right: auto; }
  nav a { font-size: .85rem; color: var(--dim); text-decoration: none; }
  nav a:hover { color: var(--ink); }
  header { padding: 3rem 0 1rem; }
  h1 { font-family: var(--display); font-weight: 400;
       font-size: clamp(1.8rem, 5vw, 2.8rem); line-height: 1.06; margin: 0 0 .6rem; letter-spacing: -.015em; }
  .lede { color: var(--dim); max-width: 52ch; margin: 0 0 1rem; }
  section { padding: 2.5rem 0; border-top: 1px solid var(--line); }
  /* No negative tracking at this size. Instrument Serif is narrow already; the -.02em that
     suited the old grotesque closes its counters up. Only h1 has room for -.015em. */
  h2 { font-family: var(--display); font-weight: 400;
       font-size: clamp(1.2rem, 3vw, 1.6rem); margin: 0 0 .5rem; letter-spacing: 0; }
  h4 { font-family: var(--mono); font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
       color: var(--dim); margin: 1.6rem 0 .6rem; font-weight: 600; }
  p { color: var(--dim); max-width: 60ch; }
  p.plain { color: var(--ink); }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .88rem; margin-bottom: .5rem; }
  th, td { text-align: left; padding: .5rem .7rem; border-bottom: 1px solid var(--line); }
  th { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); font-weight: 600; }
  td.num, th.num { font-family: var(--mono); }
  .hit { border: 1px solid var(--line); border-radius: 10px; padding: .9rem 1rem; margin-bottom: .6rem; background: var(--card); }
  .hit code { font-family: var(--mono); font-size: .76rem; color: var(--dim); }
  .quote { margin-top: .45rem; font-size: .92rem; color: var(--ink); }
  mark { background: color-mix(in srgb, var(--hot) 35%, transparent); color: inherit; padding: .05rem .15rem; border-radius: 3px; }
  pre { font-family: var(--mono); font-size: .78rem; background: var(--card); border: 1px solid var(--line);
        border-radius: 10px; padding: 1rem; overflow-x: auto; }
  ul { color: var(--dim); }
  footer { padding: 2.5rem 0 4rem; border-top: 1px solid var(--line); color: var(--dim); font-family: var(--mono); font-size: .78rem; }
</style>
</head>
<body>

<nav>
  <div class="wrap">
    <span class="brand">Ingot</span>
    <a href="index.html">Scanner</a>
    <a href="about.html">About</a>
    <a href="https://github.com/vaishak-v-nair/Ingot">Source</a>
  </div>
</nav>

<header class="wrap">
  <h1>Which benchmarks appear in which training corpora</h1>
  <p class="lede">A public record, scanned with ${esc(registry.scanner)}. Everything here is
  public, so every number can be re-derived from the same files.</p>
  <pre>node scripts/fetch-benchmarks.ts &amp;&amp; node scripts/registry-scan.ts</pre>
</header>

<section>
  <div class="wrap">
    <h2>Results at n=${DEFAULT_N}, the Ingot default</h2>
    <p>${registry.benchmarks.length} benchmarks against ${registry.corpora.length} corpora.
    <strong>${totalFlagged} distinct benchmark items flagged out of
    ${totalItems.toLocaleString()}</strong>${flagRows !== totalFlagged ? `, appearing as ${flagRows} rows below because an item found in two corpora is one finding, not two` : ''}.</p>
    <div class="scroll">
${table(DEFAULT_N)}
    </div>

    <h2 style="margin-top:2.5rem">Results at n=${LEGACY_N}</h2>
    <p>The field's default since GPT-3, reported so findings stay comparable with prior
    published work. It flags less and leaves far more of each benchmark unscannable.</p>
    <div class="scroll">
${table(LEGACY_N)}
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <h2>Evidence</h2>
    <p>Every finding below is a verbatim match. Judge them yourself — some overlaps are
    canonical facts with one natural phrasing rather than contamination, and the only way to
    tell is to read the text.</p>
${evidence || '    <p>No findings at this n.</p>'}
  </div>
</section>

<section>
  <div class="wrap">
    <h2>What these findings actually are</h2>
    <p class="plain"><strong>All ${totalFlagged} were inspected and none is contamination.</strong>
    Every one is canonical text: a prime or digit sequence inside a HumanEval docstring, the
    proper noun "I Have a Dream speech", a stock definition of capitalism. They match because
    that text is everywhere, not because a benchmark leaked.</p>
    <p>That is published rather than quietly dropped, because it is the finding. A phrase
    appearing in exactly one benchmark item still carries no evidential weight if the whole
    world writes it. A corpus-side document-frequency filter was added and did not fire —
    these phrases sit in two or three documents of a 26k corpus, below any sane threshold,
    while still being ubiquitous in English.</p>
${cross ? `    <p>Independence across corpora is the stronger signal, and it sharpens with every corpus\n    added. Flagged in two or more independent corpora, and therefore canonical:</p>\n    <ul>\n${cross}\n    </ul>` : ''}
  </div>
</section>

<section>
  <div class="wrap">
    <h2>Limitations, stated first</h2>
    <ul>
      <li>Both corpora are 2023-era instruction datasets, not pretraining corpora. A finding
      here says a benchmark leaked into a widely used fine-tuning set, not that any particular
      model trained on it.</li>
      <li>Exact matching only. Paraphrased contamination is not counted and is invisible to
      this pass.</li>
      <li>Unscannable items are benchmark items too short to produce any n-gram. Nothing can
      ever match them, so they are reported rather than folded into a clean result.</li>
      <li>A vendor can run this on their own corpus and edit until nothing matches. See the
      threat model.</li>
    </ul>
  </div>
</section>

<footer>
  <div class="wrap">
    Ingot · ${esc(registry.scanner)} · Apache-2.0<br>
    Generated from results/registry.json. Do not edit this page by hand — rebuild it with
    <strong>node scripts/build-registry-page.ts</strong>.
  </div>
</footer>

</body>
</html>
`;

writeFileSync(resolve('web/registry.html'), html, 'utf8');
process.stdout.write(
  `\n  wrote web/registry.html — ${registry.results.length} scans, ` +
    `${totalFlagged} flagged of ${totalItems.toLocaleString()} at n=${DEFAULT_N}\n\n`,
);
