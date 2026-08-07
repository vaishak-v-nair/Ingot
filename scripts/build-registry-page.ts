/**
 * Renders results/registry.json — and, when present, results/pretraining-c4.json and
 * results/canonicality.json — into web/registry.html.
 *
 * The registry is the discovery mechanism: it tells someone they have a problem before
 * they think to look for one. That only works if it is a page, not a JSON file in a
 * repository.
 *
 * Generated rather than hand-written, so the page cannot drift from the scans that
 * produced it. Every number here comes out of files CI checks, and the phrases carrying
 * the load-bearing figures are asserted by check-published-numbers.ts against the same
 * JSON this script reads.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_N, LEGACY_N } from '../src/contamination/types.ts';

type Sample = {
  benchmarkItemId: string; corpusDocId: string;
  contextBefore: string; matchedText: string; contextAfter: string;
  corpusDocFrequency?: number;
};
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
type PretrainRow = Row & { corpusBytes: number; droppedGeneric: number; throughputMBs: number };
type Pretrain = {
  scanner: string; defaultN: number; legacyN: number;
  corpus: { name: string; licence: string; source: string; shardCount: number; uncompressedBytes: number };
  results: PretrainRow[];
};
type Canon = {
  benchmark: string; n: number;
  webCorpus: { name: string; itemsFlagged: number };
  referenceCorpus: {
    name: string; documents: number; excludedSubsets: string[]; itemsHit: number; totalMatches: number;
  };
  confirmedCanonical: string[]; webCorpusOnly: string[];
  confirmationsBySource: Record<string, number>;
  controlSet: { confirmed: number; total: number; rows: { id: string; label: string; confirmed: boolean }[] };
  caveat: string;
};

type Triage = {
  thresholds: { leaked: { coverage: number; excess: number }; partial: { coverage: number; excess: number } };
  rows: {
    benchmark: string; itemId: string; itemTokens: number; longestRun: number;
    coverage: number; excess: number; verdict: 'leaked' | 'partial' | 'phrase';
  }[];
};
type TrainCheck = {
  summary: {
    flaggedTestItems: number;
    testItemsReproducedVerbatim: number;
    itemsWithTrainSiblingInDocs: number;
    distinctTrainQuestionsFound: number;
  };
  items: {
    testItemId: string;
    testQuestion: string;
    testQuestionInMatchedDocs: boolean;
    trainSiblingsInThoseDocs: { trainId: string; question: string; docs: string[] }[];
  }[];
};

const opt = <T>(path: string): T | null =>
  existsSync(resolve(path)) ? (JSON.parse(readFileSync(resolve(path), 'utf8')) as T) : null;

const registry = JSON.parse(readFileSync(resolve('results/registry.json'), 'utf8')) as Registry;
const pretrain = opt<Pretrain>('results/pretraining-c4.json');
const canon = opt<Canon>('results/canonicality.json');
const sft = opt<Pretrain>('results/sft-slimorca.json');
const sftTriage = opt<Triage>('results/sft-slimorca-triage.json');
const trainCheck = opt<TrainCheck>('results/sft-slimorca-train-check.json');

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const num = (n: number): string => n.toLocaleString('en-US');

function table(n: number): string {
  const rows = registry.results.filter((r) => r.n === n);
  const body = rows
    .map(
      (r) => `        <tr>
          <td>${esc(r.benchmark)}</td><td>${esc(r.corpus)}</td>
          <td class="num">${r.itemsHit} / ${num(r.itemsTotal)}</td>
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

/**
 * The exhibit rule, stated so nobody mistakes it for hand-picking: longest matched text
 * first, because a long verbatim run is the most informative evidence either way — most
 * damning if it were leakage, most obviously canonical when it is a famous passage. At
 * most two exhibits per benchmark item, so one item cannot fill the section. Ties break
 * on ids, so the same JSON always renders the same page.
 */
function curate(samples: Sample[], cap: number): Sample[] {
  const sorted = [...samples].sort(
    (a, b) =>
      b.matchedText.length - a.matchedText.length ||
      a.benchmarkItemId.localeCompare(b.benchmarkItemId) ||
      a.corpusDocId.localeCompare(b.corpusDocId),
  );
  const perItem = new Map<string, number>();
  const out: Sample[] = [];
  for (const s of sorted) {
    const seen = perItem.get(s.benchmarkItemId) ?? 0;
    if (seen >= 2) continue;
    perItem.set(s.benchmarkItemId, seen + 1);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

const hitBlock = (s: Sample, corpusDocs?: number): string => `    <div class="hit">
      <div class="meta">
        <span><b>${esc(s.benchmarkItemId)}</b></span>
        <span>${esc(s.corpusDocId)}</span>${
          s.corpusDocFrequency && corpusDocs
            ? `\n        <span>in ${s.corpusDocFrequency} of ${num(corpusDocs)} documents</span>`
            : ''
        }
      </div>
      <div class="quote">…${esc(s.contextBefore)}<mark>${esc(s.matchedText)}</mark>${esc(s.contextAfter)}…</div>
    </div>`;

const evidence = registry.results
  .filter((r) => r.n === DEFAULT_N && r.samples.length > 0)
  .map((r) => `    <h4>${esc(r.benchmark)} in ${esc(r.corpus)}</h4>\n${r.samples.map((s) => hitBlock(s)).join('\n')}`)
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

// ---------------------------------------------------------------------------------------
// The pretraining pass. One corpus, so ids are already distinct across rows.
// ---------------------------------------------------------------------------------------

const ptRows = pretrain ? pretrain.results.filter((r) => r.n === pretrain.defaultN) : [];
const ptDocs = ptRows[0]?.corpusDocs ?? 0;
const ptGB = pretrain ? (pretrain.corpus.uncompressedBytes / 1e9).toFixed(2) : '';
const ptFlagged = ptRows.reduce((sum, r) => sum + r.contaminatedItemIds.length, 0);
const ptMmlu = ptRows.find((r) => r.benchmark === 'mmlu');

const ptTable = ptRows
  .map(
    (r) => `        <tr>
          <td>${esc(r.benchmark)}</td>
          <td class="num">${r.itemsHit} / ${num(r.itemsTotal)}</td>
          <td class="num">${(r.rate * 100).toFixed(3)}%</td>
          <td class="num">${r.totalMatches}</td>
          <td class="num">${r.droppedGeneric}</td>
          <td class="num">${r.uncheckableItems}</td>
        </tr>`,
  )
  .join('\n');

// Exhibit budget per benchmark: everything for the small rows, a curated six for MMLU,
// with the retained-versus-total accounting printed beside them rather than implied.
const ptEvidence = ptRows
  .map((r) => {
    const cap = r.benchmark === 'mmlu' ? 6 : r.benchmark === 'humaneval' ? 4 : r.samples.length;
    const shown = curate(r.samples, cap);
    const held = `${r.totalMatches} matches, ${r.samples.length} retained under the evidence cap, ${shown.length} shown — the full retained set is in results/pretraining-c4.json`;
    return `    <h4>${esc(r.benchmark)} — ${esc(held)}</h4>\n${shown.map((s) => hitBlock(s, ptDocs)).join('\n')}`;
  })
  .join('\n');

const ptSection = pretrain
  ? `<section>
  <div class="wrap">
    <h2>The pretraining pass — three benchmarks against ${ptGB} GB of C4</h2>
    <p class="plain">C4 is a public snapshot of web text — Common Crawl from April 2019, cleaned —
    the kind of corpus models are actually pretrained on. Every benchmark below was assembled
    <em>after</em> that snapshot, so a match here can never mean the exam leaked into this pile.
    What a match shows is the reverse: the text posing a test item already existed on the
    public web before the benchmark did.</p>
    <dl class="assay">
      <div><dt>Corpus</dt><dd>${esc(pretrain.corpus.name)}<small>${pretrain.corpus.shardCount} shards, Common Crawl, ${esc(pretrain.corpus.licence)}</small></dd></div>
      <div><dt>Size</dt><dd><strong>${ptGB} GB</strong><small>${num(ptDocs)} documents</small></dd></div>
      <div><dt>Tokens</dt><dd>${num(ptRows[0]?.corpusTokens ?? 0)}<small>one pass, streamed</small></dd></div>
      <div><dt>Method</dt><dd>n = ${pretrain.defaultN}<small>exact, ${esc(pretrain.scanner)}</small></dd></div>
      <div><dt>Corpus hash</dt><dd class="hash">${esc(ptRows[0]?.corpusHash ?? '')}<small>same bytes, same number</small></dd></div>
    </dl>
    <div class="scroll">
      <table>
        <tr><th>benchmark</th><th class="num">flagged</th><th class="num">rate</th><th class="num">matches</th><th class="num">discarded</th><th class="num">unscannable</th></tr>
${ptTable}
      </table>
    </div>
    <p class="plain" style="margin-top:1.4rem"><strong>&ldquo;2.4% of MMLU is contaminated in C4&rdquo;
    is wrong, and that is the finding.</strong> The ${ptMmlu?.samples.length ?? 0} retained MMLU matches
    were inspected and none is contamination: they are NATO Article 5, Patrick Henry, the Fifth
    Amendment — canonical text, the famous passages the whole world quotes. MMLU quotes famous
    documents; web text contains them. The overlap is exact, reproducible and evidentially worthless
    — and a scanner that printed the rate without the words would have called it a scandal.</p>
    <p>GSM8K's two matches are everyday phrasings each found in a single document, and HumanEval's
    are digit runs and a textbook prime definition — the number sequences every explanation of
    numbers contains. Judge all of it yourself:</p>
${ptEvidence}
  </div>
</section>

${canon ? canonSection() : ''}`
  : '';

function canonSection(): string {
  if (!canon) return '';
  const sources = Object.entries(canon.confirmationsBySource)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `      <li><code>${esc(k)}</code> confirmed ${v} item${v === 1 ? '' : 's'}</li>`)
    .join('\n');
  const controls = canon.controlSet.rows
    .map(
      (r) => `        <tr><td>${esc(r.id)}</td><td>${esc(r.label)}</td>
          <td class="num">${r.confirmed ? 'confirmed' : 'not found'}</td></tr>`,
    )
    .join('\n');
  return `<section>
  <div class="wrap">
    <h2>Canonical or leaked — the cross-provenance test</h2>
    <p class="plain">A passage that reached two corpora by genuinely different routes is a property
    of the language, not evidence a benchmark leaked. So the flagged MMLU items were scanned again
    — against The Pile with every web-crawl subset removed: ${num(canon.referenceCorpus.documents)}
    documents of court opinions, patents, paper abstracts and digitised books, routes a crawler was
    never involved in.</p>
    <p class="plain"><strong>${canon.confirmedCanonical.length} of the ${canon.webCorpus.itemsFlagged}
    flagged items are confirmed canonical</strong> — their text lives in non-crawl print, most of it
    in court opinions. The other ${canon.webCorpusOnly.length} are undetermined, <em>not</em> leaked:
    a control set of nine unmistakably canonical items scored ${canon.controlSet.confirmed} of ${canon.controlSet.total}
    against this reference, so absence from it carries no information.
    Presence is evidence; absence is a lead.</p>
    <ul>
${sources}
    </ul>
    <details class="more">
      <summary>The control set, and why absence proves nothing</summary>
      <p>Nine items nobody believes leaked — famous speeches, founding documents — hand-labelled to
      measure the test's negative power, not sampled from it. ${canon.controlSet.confirmed} of ${canon.controlSet.total}
      appeared in the reference corpus at all:</p>
      <div class="scroll">
      <table>
        <tr><th>item</th><th>what it quotes</th><th class="num">in the reference?</th></tr>
${controls}
      </table>
      </div>
      <p>${esc(canon.caveat)}</p>
    </details>
  </div>
</section>`;
}

// ---------------------------------------------------------------------------------------
// The distillation pass: the first corpus in the registry assembled AFTER the benchmarks,
// so a match could have been a real leak — which is exactly why its verdict is measured
// (triage runs, train-split check) rather than asserted.
// ---------------------------------------------------------------------------------------

function sftSection(): string {
  if (!sft || !sftTriage || !trainCheck) return '';
  const rows10 = sft.results.filter((r) => r.n === sft.defaultN);
  const docs = rows10[0]?.corpusDocs ?? 0;
  const gb = (sft.corpus.uncompressedBytes / 1e9).toFixed(2);
  const t = sftTriage.rows;
  const leaked = t.filter((r) => r.verdict === 'leaked').length;
  const partial = t.filter((r) => r.verdict === 'partial').length;
  const phrase = t.filter((r) => r.verdict === 'phrase').length;
  const top = t[0];
  const s = trainCheck.summary;

  const table = sft.results
    .map(
      (r) => `        <tr>
          <td>${esc(r.benchmark)}</td>
          <td class="num">${r.n}</td>
          <td class="num">${r.itemsHit} / ${num(r.itemsTotal)}</td>
          <td class="num">${(r.rate * 100).toFixed(3)}%</td>
          <td class="num">${r.totalMatches}</td>
          <td class="num">${(r as PretrainRow).droppedGeneric}</td>
          <td class="num">${r.uncheckableItems}</td>
        </tr>`,
    )
    .join('\n');

  const gsm = rows10.find((r) => r.benchmark === 'gsm8k');
  const exhibits = gsm ? curate(gsm.samples, 2).map((x) => hitBlock(x, docs)).join('\n') : '';

  const clip = (q: string): string => (q.length > 180 ? `${q.slice(0, 180)}…` : q);
  const siblings = trainCheck.items
    .map(
      (it) => `        <tr>
          <td><b>${esc(it.testItemId)}</b> (test${it.testQuestionInMatchedDocs ? ', REPRODUCED' : ', not reproduced'})<br>${esc(clip(it.testQuestion))}</td>
          <td>${it.trainSiblingsInThoseDocs
            .map((tr) => `<b>${esc(tr.trainId)}</b> — verbatim in ${tr.docs.length} doc${tr.docs.length === 1 ? '' : 's'}<br>${esc(clip(tr.question))}`)
            .join('<br><br>') || '—'}</td>
        </tr>`,
    )
    .join('\n');

  return `<section>
  <div class="wrap">
    <h2>The distillation pass — the first corpus where leakage was possible</h2>
    <p class="plain">SlimOrca is ${num(docs)} GPT-4 completions over FLAN prompts, assembled in
    2023 — <em>after</em> every benchmark here was published. The leak window was open, so for the
    first time a match could be more than canonical text. Every flagged item was therefore
    measured rather than eyeballed: the longest verbatim run between the item and each document
    that matched it, published beside the scan.</p>
    <dl class="assay">
      <div><dt>Corpus</dt><dd>${esc(sft.corpus.name)}<small>${esc(sft.corpus.licence)} · derived — both SHA-256s in the manifest</small></dd></div>
      <div><dt>Size</dt><dd><strong>${gb} GB</strong><small>${num(docs)} documents · ${(rows10[0] as PretrainRow).linesSkipped} lines skipped</small></dd></div>
      <div><dt>Tokens</dt><dd>${num(rows10[0]?.corpusTokens ?? 0)}<small>one pass, streamed</small></dd></div>
      <div><dt>Method</dt><dd>n = ${sft.defaultN} and ${sft.legacyN}<small>exact, ${esc(sft.scanner)}</small></dd></div>
      <div><dt>Corpus hash</dt><dd class="hash">${esc(rows10[0]?.corpusHash ?? '')}<small>same bytes, same number</small></dd></div>
    </dl>
    <div class="scroll">
      <table>
        <tr><th>benchmark</th><th class="num">n</th><th class="num">flagged</th><th class="num">rate</th><th class="num">matches</th><th class="num">discarded</th><th class="num">unscannable</th></tr>
${table}
      </table>
    </div>
    <p class="plain" style="margin-top:1.4rem"><strong>GSM8K's train split is inside this corpus;
    its test split is not.</strong> ${s.itemsWithTrainSiblingInDocs} of ${s.flaggedTestItems} flagged
    test questions are template siblings of train-split questions that appear verbatim in the very
    same documents — and ${s.testItemsReproducedVerbatim} test questions appear verbatim themselves.
    Across all three benchmarks the triage reads ${leaked} leaked · ${partial} partial · ${phrase} phrase-level,
    and the longest verbatim run anywhere is ${top?.longestRun ?? 0} tokens
    of a ${top?.itemTokens ?? 0}-token item.</p>
    <p>A scanner that stopped at the flag would have called this a test-set leak. The words say
    otherwise — and they also say the fine-tuning set carries the training questions, which is
    worth knowing before quoting a GSM8K number for any model tuned on it.</p>
${exhibits}
    <details class="more">
      <summary>Every flagged test question beside the train question found with it</summary>
      <div class="scroll">
      <table>
        <tr><th>flagged test item</th><th>train-split question, verbatim in its documents</th></tr>
${siblings}
      </table>
      </div>
      <p>Texts clipped for the page; full questions and document lists are in
      results/sft-slimorca-train-check.json.</p>
    </details>
    <details class="more">
      <summary>How the triage measures a leak — and the artifact it almost published</summary>
      <p>For every flagged item: the longest common token run against each document its evidence
      names, as a fraction of the item. A leak reproduces most of itself; boilerplate reproduces
      the phrase and stops. The verdicts also require <em>excess</em> — tokens beyond the flagging
      ${sft.defaultN}-gram — because every flagged item carries ${sft.defaultN}/length coverage by
      construction, and on its first run coverage alone labelled three short items "leaked" on
      exactly that floor. Thresholds and per-item numbers: results/sft-slimorca-triage.json.</p>
    </details>
  </div>
</section>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ingot registry — which benchmarks appear in which corpora</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M14 22h36l8 20H6z' fill='%239BA1A6'/%3E%3C/svg%3E">
<meta name="description" content="A public record of which benchmarks appear inside which public training corpora, reproducible from the same files.">
<meta property="og:type" content="website">
<meta property="og:title" content="The Ingot registry — which benchmarks appear in which training corpora">
<meta property="og:description" content="A public record of which benchmarks appear inside which public training corpora, reproducible from the same files.">
<meta property="og:url" content="https://ingot-six.vercel.app/registry.html">
<meta property="og:image" content="https://ingot-six.vercel.app/og.png">
<meta name="twitter:card" content="summary_large_image">
<!-- Dark browser chrome from the first paint; without this the scrollbar is the
     browser's light default over the graphite. Same rule as index.html. -->
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0C0E0F" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#F4F5F4" media="(prefers-color-scheme: light)">
<link rel="stylesheet" href="site.css">
<style>
  /* Shared tokens, faces, chassis and nav come from site.css. Only this page's own
     composition stays here.

     The 16px body is a deliberate carry-over, NOT a shared value: DESIGN.md's scale
     specifies 17 and the other two pages use it. Preserved verbatim so extracting the
     shared layer changed nothing visible; reconciling it to 17 is a design decision and
     belongs in the redesign, not in a refactor. */
  body { font-size: 16px; }
  /* The registry widens its nav and footer above the rail breakpoint the way index does. */
  @media (min-width: 78.5rem) {
    nav .wrap, footer .wrap { max-width: 76rem; }
  }
  header { padding: 3rem 0 1rem; }
  h1 { font-family: var(--display); font-weight: 600;
       font-size: clamp(1.8rem, 5vw, 2.8rem); line-height: 1.04; margin: 0 0 .6rem; letter-spacing: -.03em; }
  .lede { color: var(--dim); max-width: 52ch; margin: 0 0 1rem; }
  /* The focus contract, same token as the front page. */
  :focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
  section { padding: 2.5rem 0; border-top: 1px solid var(--line); }
  h2 { font-family: var(--display); font-weight: 600;
       font-size: clamp(1.2rem, 3vw, 1.6rem); margin: 0 0 .5rem; letter-spacing: -.01em; }
  h4 { font-family: var(--mono); font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
       color: var(--dim); margin: 1.6rem 0 .6rem; font-weight: 600; }
  p { color: var(--dim); max-width: 60ch; }
  p.plain { color: var(--ink); }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .88rem; margin-bottom: .5rem; }
  th, td { text-align: left; padding: .5rem .7rem; border-bottom: 1px solid var(--line); }
  th { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); font-weight: 600; }
  td.num, th.num { font-family: var(--mono); }
  /* The corpus facts, stamped before the results — the same assay strip the front page
     uses. A reader judging a claim should see what it was measured on without parsing a
     paragraph. */
  dl.assay { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
             gap: .9rem 1.4rem; margin: 1.2rem 0 1.4rem; padding: .9rem 0;
             border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  dl.assay div { display: grid; gap: .15rem; align-content: start; }
  dl.assay dt { font-family: var(--mono); font-size: .68rem; text-transform: uppercase;
                letter-spacing: .08em; color: var(--dim); }
  dl.assay dd { margin: 0; font-size: .98rem; }
  dl.assay dd small { display: block; color: var(--dim); font-size: .74rem; }
  dl.assay dd.hash { font-family: var(--mono); font-size: .78rem; word-break: break-all; }
  /* Findings are a ruled record, exactly as on the front page. A border around each match
     adds no information and makes the most important content on the site look templated. */
  .hit { border-bottom: 1px solid var(--line); padding: .95rem 0; }
  .hit code { font-family: var(--mono); font-size: .76rem; color: var(--dim); }
  .hit .meta { display: flex; flex-wrap: wrap; gap: .3rem 1.1rem;
               font-family: var(--mono); font-size: .74rem; color: var(--dim); }
  .hit .meta b { color: var(--ink); font-weight: 600; }
  .quote { margin-top: .45rem; font-size: .92rem; color: var(--ink); }
  mark { background: color-mix(in srgb, var(--hot) 30%, transparent); color: inherit; padding: .05rem .15rem; border-radius: 0;
         -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  /* Depth folds, it does not delete — the same ruled disclosure as the front page. */
  details.more { border-top: 1px solid var(--line); margin-top: 1.2rem; }
  details.more summary { cursor: pointer; list-style: none; font-family: var(--mono);
    font-size: .74rem; text-transform: uppercase; letter-spacing: .08em; color: var(--dim);
    padding: .7rem 0; }
  details.more summary::-webkit-details-marker { display: none; }
  details.more summary::before { content: "+"; margin-right: .5rem; color: var(--gold); }
  details.more[open] summary::before { content: "\\2212"; }
  /* Motion, under the same contract as the rest of the site. */
  /* screen-scoped: print rendering never scrolls, so a reveal print can see leaves
     every below-fold section as blank paper. */
  @media screen and (prefers-reduced-motion: no-preference) {
    .js section > .wrap, .js footer > .wrap {
      opacity: 0; transform: translateY(14px);
      transition: opacity .65s ease-out, transform .65s ease-out; }
    .js section > .wrap.in, .js footer > .wrap.in { opacity: 1; transform: none; }
  }
  pre { font-family: var(--mono); font-size: .78rem; background: var(--card); border: 1px solid var(--line);
        border-radius: 0; padding: 1rem; overflow-x: auto; }
  ul { color: var(--dim); }
  footer { padding: 2.5rem 0 4rem; border-top: 1px solid var(--line); color: var(--dim); font-family: var(--mono); font-size: .78rem; }
</style>
</head>
<body>

<nav>
  <div class="wrap">
    <span class="brand">Ingot</span>
    <a href="index.html#plain">What is this?</a>
    <a href="index.html#trust">Privacy</a>
    <a href="index.html#method">Method</a>
    <a href="registry.html" aria-current="page">Registry</a>
    <a href="about.html">About</a>
    <a href="https://github.com/vaishak-v-nair/Ingot">Source</a>
  </div>
</nav>

<header class="wrap">
  <h1>Which benchmarks appear in which training corpora</h1>
  <p class="lede">A public record, scanned with ${esc(registry.scanner)}. Everything here is
  public, so every number can be re-derived from the same files.</p>
  <!-- The verdict, before the tables. It used to sit three screens down, after two tables
       a reader had to interpret unaided — the page buried its own conclusion. -->
  <p class="plain"><strong>${sft ? 'Three passes' : 'Two passes'} so far.${pretrain ? ` Against ${ptGB} GB of C4 web text:
  ${ptFlagged} distinct items flagged, every retained match inspected, and none is
  contamination.` : ''}${sft ? ` Against a 2023 distillation set where a leak was chronologically
  possible: GSM8K's train split found verbatim, its test split not reproduced.` : ''} Against two
  instruction-tuning sets: ${totalFlagged} distinct items of
  ${num(totalItems)}, all canonical text.</strong> Why a page full of matches and no leaked
  test set is the finding — and not a disappointment — is explained beside the evidence.</p>
  <pre>node scripts/fetch-benchmarks.ts &amp;&amp; node scripts/registry-scan.ts${pretrain ? `
node scripts/fetch-pretraining.ts --shards ${pretrain.corpus.shardCount} &amp;&amp; node scripts/pretraining-scan.ts` : ''}${sft ? `
node scripts/fetch-sft.ts &amp;&amp; node scripts/pretraining-scan.ts --corpus ../corpora/slimorca --out sft-slimorca` : ''}</pre>
</header>

${ptSection}
${sftSection()}
<section>
  <div class="wrap">
    <h2>The instruction-tuning pass at n=${DEFAULT_N}, the Ingot default</h2>
    <p class="plain">In plain words: n=${DEFAULT_N} means ${DEFAULT_N} identical words in a row is
    what counts as a match, and an <em>unscannable</em> item is one too short to ever produce a
    match at that length — named, never silently skipped.</p>
    <p>${registry.benchmarks.length} benchmarks against ${registry.corpora.length} corpora.
    <!-- One line on purpose: this phrase is gated by check-published-numbers.ts, and a
         load-bearing phrase may never line-wrap mid-figure (DESIGN.md, hard constraint 3). -->
    <strong>${totalFlagged} distinct benchmark items flagged out of ${num(totalItems)}</strong>${flagRows !== totalFlagged ? `, appearing as ${flagRows} rows below because an item found in two corpora is one finding, not two` : ''}.</p>
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
    <h2>Evidence from the instruction-tuning pass</h2>
    <p>Every finding below is a verbatim match. Judge them yourself — some overlaps are
    canonical facts with one natural phrasing rather than contamination, and the only way to
    tell is to read the text.</p>
${evidence || '    <p>No findings at this n.</p>'}
  </div>
</section>

<section>
  <div class="wrap">
    <h2>What these findings actually are</h2>
    <p class="plain"><strong>All ${totalFlagged} instruction-set items were inspected and none is
    contamination.</strong> Every one is canonical text: a prime or digit sequence inside a
    HumanEval docstring, the proper noun "I Have a Dream speech", a stock definition of
    capitalism. They match because that text is everywhere, not because a benchmark leaked.</p>
    <p>That is published rather than quietly dropped, because it is the finding. A phrase
    appearing in exactly one benchmark item still carries no evidential weight if the whole
    world writes it. A corpus-side document-frequency filter was added and did not fire —
    these phrases sit in two or three documents of a 26k corpus, below any sane threshold,
    while still being ubiquitous in English.${pretrain ? ` At C4 scale the same filter discarded
    ${ptRows.reduce((a, r) => a + r.droppedGeneric, 0)} matches — it only engages once the corpus
    is enormous, which is why the pretraining pass exists.` : ''}</p>
${cross ? `    <p>Independence across corpora is the stronger signal, and it sharpens with every corpus\n    added. Flagged in two or more independent corpora, and therefore canonical:</p>\n    <ul>\n${cross}\n    </ul>` : ''}
  </div>
</section>

<section>
  <div class="wrap">
    <h2>Limitations, stated first</h2>
    <ul>${pretrain ? `
      <li>The pretraining pass covers ${pretrain.corpus.shardCount} of 1,024 C4 shards — about
      2.5% of one snapshot of one corpus. Every rate is measured on exactly those shards and
      extrapolates to nothing.</li>
      <li>Every benchmark postdates the April 2019 crawl, so no match here is the exam leaking
      into this pile. A match means the item's posing text existed on the public web before the
      benchmark was assembled.</li>
      <li>The pretraining pass has run at n=${pretrain.defaultN} only; the n=${pretrain.legacyN}
      comparability pass is not yet published.</li>` : ''}${sft ? `
      <li>SlimOrca is a derived corpus — ShareGPT turns flattened to text by
      scripts/fetch-sft.ts. The manifest records the source file's SHA-256 beside the derived
      file's, so the derivation is checkable end to end.</li>
      <li>The train-versus-test sibling check was run for GSM8K only; the other benchmarks'
      flagged items were triaged by measured run length, not against a train split.</li>` : ''}
      <li>The instruction-tuning corpora are 2023-era fine-tuning sets of a few million tokens.
      A null result there says almost nothing about pretraining — which is why the pretraining
      pass exists.</li>
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
    Generated from results/registry.json${pretrain ? ', results/pretraining-c4.json' : ''}${canon ? ', results/canonicality.json' : ''}${sft ? ', results/sft-slimorca.json and its triage and train-check companions' : ''}.
    Do not edit this page by hand — rebuild it with
    <strong>node scripts/build-registry-page.ts</strong>.
  </div>
</footer>

<script type="module">
// The same settle-in reveal as the rest of the site: keyed on a .js class this script
// adds, so a script that never runs costs the motion and not the page.
const MOTION = matchMedia('(prefers-reduced-motion: no-preference)').matches;
if (MOTION) {
  document.documentElement.classList.add('js');
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }
  }, { rootMargin: '0px 0px -10% 0px' });
  for (const el of document.querySelectorAll('section > .wrap, footer > .wrap')) io.observe(el);
}
</script>
</body>
</html>
`;

// A results file missing a field renders "undefined" or "NaN" straight into the page,
// and no other gate can see it: check-published-numbers asserts phrases that SHOULD
// exist, not phrases that shouldn't. One dumb tripwire over the finished HTML catches
// every present and future case at once. (The page's own prose says "undetermined",
// never "undefined", so the match is safe.)
const leaked = html.match(/\b(?:undefined|NaN)\b/);
if (leaked) {
  const at = html.indexOf(leaked[0]);
  process.stderr.write(
    `\n  REFUSED — the generated page contains "${leaked[0]}" near ` +
      `…${html.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' ')}…\n` +
      `  A results file is missing a field this generator renders. Not writing the page.\n\n`,
  );
  process.exit(1);
}

writeFileSync(resolve('web/registry.html'), html, 'utf8');
process.stdout.write(
  `\n  wrote web/registry.html — ${registry.results.length} instruction scans` +
    (pretrain ? `, ${ptRows.length} pretraining scans (${ptFlagged} flagged)` : '') +
    `, ${totalFlagged} flagged of ${num(totalItems)} at n=${DEFAULT_N}\n\n`,
);
