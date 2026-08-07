import { CONTAMINATION_CLAIM_SCOPE } from './types.ts';
import type { ContaminationReport } from './types.ts';

/**
 * Renders a contamination report as one self-contained HTML file.
 *
 * This is the artifact. Ingot's whole argument is that a scan should leave you something
 * you can hand to a reviewer, a customer or a regulator — and a result that only exists
 * inside a browser tab is not that.
 *
 * Shared between the browser and the command line so a downloaded report and a `--out`
 * report are the same document. Two renderers would drift, and a reviewer comparing two
 * Ingot reports must not have to wonder which one they are reading.
 *
 * Self-contained on purpose: inline styles, no scripts, no external requests. It has to
 * open correctly from an email attachment on a machine with no network, years from now.
 */

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const num = (n: number): string => n.toLocaleString('en-US');

/** Safe for a filename on every platform, and it names what it contains. */
export function reportFileName(report: ContaminationReport, extension: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `ingot-${clean(report.benchmark)}-vs-${clean(report.corpus)}-${report.corpusHash.slice(0, 8)}.${extension}`;
}

export function renderContaminationReport(report: ContaminationReport): string {
  const exact = report.tiers.find((t) => t.tier === 'exact')!;
  const near = report.tiers.find((t) => t.tier === 'near');
  const r = report.receipt;
  const clean = exact.itemsHit === 0;
  const uncheckable = report.uncheckableItemIds.length;

  const evidence =
    exact.hits.length > 0
      ? exact.hits
          .map(
            (h) => `      <div class="hit">
        <code>${esc(h.benchmarkItemId)} &rarr; ${esc(h.corpusDocId)}</code>
        <p class="quote">…${esc(h.contextBefore)}<mark>${esc(h.matchedText)}</mark>${esc(h.contextAfter)}…</p>
      </div>`,
          )
          .join('\n')
      : '';

  // Truthful at the cap: the JSON report is this same object, so matches whose text was
  // never retained are in neither artifact. Saying "the full list is in the JSON" past
  // the cap was a lie this template used to tell.
  const truncated =
    exact.totalHits > exact.hits.length
      ? `    <p class="note">${num(exact.totalHits - exact.hits.length)} further match(es) were counted beyond the
      ${num(exact.hits.length)} whose text is stored here. They are in every total above; their text was not
      retained. The JSON report carries the same ${num(exact.hits.length)} stored matches.</p>`
      : '';

  const droppedSection =
    (exact.droppedGeneric ?? 0) > 0 && exact.droppedSamples?.length
      ? `
  <h2>Dropped as ordinary language — read them</h2>
  <p class="note">${
    exact.droppedSamples.length < (exact.droppedGeneric ?? 0)
      ? `The first ${num(exact.droppedSamples.length)} of ${num(exact.droppedGeneric ?? 0)} discards; the rest are counted but their text was not retained.`
      : `All ${num(exact.droppedGeneric ?? 0)} discards, in full.`
  } "Dropped" is itself a judgement, and this section is how you check it.</p>
${exact.droppedSamples
  .map(
    (h) => `      <div class="hit">
        <code>${esc(h.benchmarkItemId)} &rarr; ${esc(h.corpusDocId)}${h.corpusDocFrequency ? ` &middot; in ${num(h.corpusDocFrequency)} docs` : ''}</code>
        <p class="quote">…${esc(h.contextBefore)}<mark>${esc(h.matchedText)}</mark>${esc(h.contextAfter)}…</p>
      </div>`,
  )
  .join('\n')}`
      : '';

  /** Ids, capped, with the remainder counted rather than dropped in silence. */
  const idList = (ids: string[]): string =>
    `    <p class="ids">${ids.slice(0, 60).map(esc).join(', ')}${
      ids.length > 60 ? `, and ${num(ids.length - 60)} more` : ''
    }</p>`;

  // Two reasons an item can be unmatchable, and they mean opposite things.
  //
  // One is a fact about the item: it is short, or its every gram was so widely shared that
  // the filter took it for boilerplate. The other is a fact about Ingot: its tokenizer
  // splits on word boundaries, and Chinese, Japanese and Thai are not written with any.
  // A 400-character Japanese essay tokenizes to one token and cannot form a 10-gram, which
  // the old wording reported as "shorter than 10 tokens" — a sentence that describes the
  // token count accurately and the writing falsely. Merging the two cases let the report
  // present a limit of the scanner as a property of the text.
  const unsegmentedIds = report.unsegmentedItemIds ?? [];
  const shortIds = report.uncheckableItemIds.filter((id) => !unsegmentedIds.includes(id));

  const notChecked =
    uncheckable === 0
      ? `    <h2>What was not checked</h2>
    <p>Nothing. Every benchmark item produced at least one ${report.n}-gram, so every one of them
    was genuinely examined.</p>`
      : `    <h2>What was not checked</h2>${
          unsegmentedIds.length > 0
            ? `
    <p>${num(unsegmentedIds.length)} item${unsegmentedIds.length === 1 ? ' is' : 's are'} written in a script
    Ingot does not split into words — Chinese, Japanese, Thai and the other scripts written without
    spaces between words. ${unsegmentedIds.length === 1 ? 'It produced' : 'They produced'} too few tokens to
    form a single ${report.n}-gram, so nothing could have matched ${unsegmentedIds.length === 1 ? 'it' : 'them'}
    whatever this corpus contains.</p>
    <p><strong>This is a limit of the scanner, not a finding about the text.</strong> &ldquo;We did not find
    these words&rdquo; and &ldquo;we could not have looked for them&rdquo; are different sentences, and for
    ${unsegmentedIds.length === 1 ? 'this item' : 'these items'} this report is making the second one.</p>
${idList(unsegmentedIds)}`
            : ''
        }${
          shortIds.length > 0
            ? `
    <p>${num(shortIds.length)} ${unsegmentedIds.length > 0 ? 'further ' : ''}item${
      shortIds.length === 1 ? '' : 's'
    } produced no surviving ${report.n}-gram: either ${shortIds.length === 1 ? 'it is' : 'they are'} shorter
    than ${report.n} tokens, or every gram ${shortIds.length === 1 ? 'it' : 'they'} had was shared with enough
    of the benchmark to be filtered as boilerplate. Nothing could ever match
    ${shortIds.length === 1 ? 'it' : 'them'} either.</p>
${idList(shortIds)}`
            : ''
        }
    <p class="note">A clean result that stayed silent about any of this would be hiding the part of the
    benchmark nobody looked at.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ingot — ${esc(report.benchmark)} in ${esc(report.corpus)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    --ink: #16150f; --paper: #fbfaf7; --dim: #6d6a5c; --line: #ddd9cc; --card: #fff;
    --gold: #9a6a00; --hot: #ff9d1f; --ok: #2f6b34; --bad: #8f2f22;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #f2efe4; --paper: #0e0d09; --dim: #9a968a; --line: #2b281f; --card: #16150f;
            --gold: #e0aa3e; --ok: #7fbf85; --bad: #e2887a; }
  }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.55 var(--sans); }
  .wrap { max-width: 50rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
  .brand { font-family: var(--mono); font-size: .74rem; letter-spacing: .2em; text-transform: uppercase; color: var(--gold); }
  h1 { font-size: clamp(1.5rem, 4vw, 2.1rem); line-height: 1.15; margin: .5rem 0 .3rem; letter-spacing: -.02em; }
  .sub { color: var(--dim); margin: 0 0 2rem; font-size: .95rem; }
  h2 { font-size: .78rem; text-transform: uppercase; letter-spacing: .1em; color: var(--dim);
       margin: 2.4rem 0 .7rem; font-weight: 600; }
  p { max-width: 62ch; }
  .verdict { border: 1px solid var(--line); border-radius: 14px; background: var(--card); padding: 1.6rem; }
  .big { font-family: var(--mono); font-size: 2.8rem; line-height: 1; font-weight: 600; }
  .big.clean { color: var(--ok); } .big.dirty { color: var(--bad); }
  .label { color: var(--dim); font-size: .76rem; text-transform: uppercase; letter-spacing: .1em; margin-top: .45rem; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .88rem; }
  th, td { text-align: left; padding: .5rem .7rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); font-weight: 600; white-space: nowrap; }
  td { font-family: var(--mono); word-break: break-word; }
  .hit { border: 1px solid var(--line); border-radius: 10px; padding: .9rem 1rem; margin-bottom: .6rem; background: var(--card); }
  .hit code { font-family: var(--mono); font-size: .76rem; color: var(--dim); }
  .quote { margin: .45rem 0 0; font-size: .93rem; }
  mark { background: color-mix(in srgb, var(--hot) 35%, transparent); color: inherit; padding: .05rem .15rem; border-radius: 3px; }
  pre { font-family: var(--mono); font-size: .76rem; background: var(--card); border: 1px solid var(--line);
        border-radius: 10px; padding: 1rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
  .note, .ids { color: var(--dim); font-size: .86rem; }
  .ids { font-family: var(--mono); word-break: break-word; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--dim); font-size: .82rem; }
  @media print {
    :root { --paper: #fff; --card: #fff; --ink: #000; }
    body { font-size: 11pt; }
    .hit, .verdict, pre { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">Ingot</div>
  <h1>${esc(report.benchmark)} in ${esc(report.corpus)}</h1>
  <p class="sub">Contamination scan · ${esc(r.generatedAt)} · ${esc(r.scannerVersion)}</p>

  ${
    report.corpusDocs === 0
      ? `<div class="verdict" style="border-color: var(--bad)">
    <div class="big dirty">refused</div>
    <div class="label">this corpus was not scanned</div>
    <p style="margin:.9rem 0 0">${
      (report.load?.totalLines ?? 0) === 0
        ? 'The file is empty — there were no lines to read.'
        : `None of its ${num(report.load?.totalLines ?? 0)} line(s) could be read as a JSONL record
    (one {&quot;text&quot;: …} object per line); ${num(report.load?.skipped ?? 0)} were skipped.`
    } Nothing was checked, so this is not a clean result.</p>
  </div>`
      : `<div class="verdict">
    <div class="big ${clean ? 'clean' : 'dirty'}">${num(exact.itemsHit)}</div>
    <div class="label">of ${num(exact.itemsTotal)} benchmark items appear in this corpus</div>
    <p style="margin:.9rem 0 0">${
      clean
        ? 'No verbatim overlap was found. That is a result rather than the absence of one: every item that could be checked was checked, and the ones that could not are named below.'
        : 'Read the matches below before concluding anything. Canonical text with one natural phrasing looks identical to leakage in any count, and only the words tell you which this is.'
    }</p>
  </div>`
  }

  <h2>What was checked</h2>
  <div class="scroll"><table>
    <tr><th>benchmark</th><td>${esc(report.benchmark)}, ${num(exact.itemsTotal)} items at n=${report.n}</td></tr>
    <tr><th>corpus</th><td>${esc(report.corpus)} · ${num(report.corpusDocs)} documents · ${num(report.corpusTokens)} tokens</td></tr>
    <tr><th>matches kept</th><td>${num(exact.totalHits)}</td></tr>
    <tr><th>dropped as ordinary language</th><td>${num(exact.droppedGeneric ?? 0)}</td></tr>
    <tr><th>could not be checked</th><td>${num(uncheckable)} item${uncheckable === 1 ? '' : 's'}${
      unsegmentedIds.length > 0
        ? ` &middot; ${num(unsegmentedIds.length)} of them in a script this scanner cannot segment`
        : ''
    }</td></tr>${
      report.load && report.load.skipped > 0
        ? `\n    <tr><th>lines skipped</th><td>${num(report.load.skipped)} of ${num(report.load.totalLines)} — unreadable as records, reported rather than silently dropped</td></tr>`
        : ''
    }
    <tr><th>scan time</th><td>${(report.elapsedMs / 1000).toFixed(1)}s</td></tr>${
      near?.unavailableReason ? `\n    <tr><th>near-duplicate tier</th><td>${esc(near.unavailableReason)}</td></tr>` : ''
    }
  </table></div>
${
  evidence
    ? `
  <h2>Evidence — judge it yourself</h2>
  <p>Every match below is verbatim. Some overlaps are canonical facts with one natural
  phrasing rather than contamination, and the only way to tell is to read the text.</p>
${evidence}
${truncated}`
    : ''
}
${droppedSection}
${notChecked}

  <h2>Receipt — reproduce this without asking anyone</h2>
  <pre>scanner        ${esc(r.scannerVersion)}, index format ${r.indexFormatVersion}
index          ${esc(r.benchmark)} · n=${r.n} · stride ${r.stride} · ${num(r.indexGrams)} grams
benchmark hash ${esc(r.benchmarkHash)}
corpus         ${esc(r.corpus)} · ${num(r.corpusBytes)} bytes · ${num(r.corpusDocs)} docs
corpus hash    ${esc(r.corpusHash)}${r.corpusHashFull ? `\ncorpus sha256  ${esc(r.corpusHashFull)}` : ''}
generated      ${esc(r.generatedAt)}

${esc(r.command)}</pre>
  <p class="note">The corpus hash covers the first 64 lines, every thousandth line after that,
  and the exact line and byte counts${
    r.corpusHashFull
      ? '. The full SHA-256 above covers every line'
      : '. A full SHA-256 is available from the command line, which the browser cannot compute'
  }. Neither stops someone who edits their own corpus to pass a scan.</p>

  <footer>
    ${esc(CONTAMINATION_CLAIM_SCOPE)}<br><br>
    Generated by Ingot, Apache-2.0. This file is self-contained: no scripts, no external
    requests, nothing loaded from a network. Nothing about the scanned corpus was uploaded
    anywhere to produce it.
  </footer>
</div>
</body>
</html>
`;
}
