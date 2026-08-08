import { CONTAMINATION_CLAIM_SCOPE, DEFAULT_ITEM_NOUN } from './types.ts';
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
  // The registry indexes benchmark items; the personal check indexes somebody’s essays.
  // One renderer serves both, so the noun travels with the index rather than being wired in.
  const noun = report.itemNoun ?? DEFAULT_ITEM_NOUN;
  const nounFor = (count: number): string => (count === 1 ? noun.one : noun.many);
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
    <p>Nothing. Every ${esc(noun.one)} produced at least one ${report.n}-gram, so every one of them
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
  /* PAPER, the system in web/site.css — same ground, same ink, same one accent, same
     spacing scale, same 16px radius, same struck highlight. This is the only artifact that
     leaves the building, and it spent two systems looking like neither of them: it was
     warm-paper-and-gold while the site was dark graphite, then dark graphite while the
     site turned to paper. It follows the site now, and the three rules PAPER is built on
     apply here too — space separates rather than lines, every gap is a step on one scale,
     and content that needs setting apart sits on a surface rather than inside a fence.

     Three deliberate departures, all forced by this file's older and stronger constraint —
     it must open correctly from an email attachment, on a machine with no network, years
     from now:

       1. System faces, not Archivo/Public Sans/JetBrains Mono. Embedding three subsetted
          woff2 files as data URIs would multiply a 6 KB report by fifty to carry the brand
          into a document whose job is evidence. The stack below keeps the register —
          neo-grotesque UI face, real mono for hashes — without a byte of payload.
       2. No color-mix(). A report read in 2031 by whatever browser is to hand should not
          depend on a 2023 colour function to render its evidence legibly. Every value
          below is a literal.
       3. Light only, following the site's decision of 2026-08-07. A designed dark inverse
          is a second document to keep true; an inferred one is a document nobody looked
          at. The print block below is the one variant that is genuinely different, and it
          exists because these get printed. */
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    color-scheme: light;
    --paper: #FBFAF8; --white: #FFFFFF; --ink: #12100E; --dim: #6F6A63;
    --line: #E7E3DC; --wash: #F3F0EA;
    --accent: #D4541E; --accent-ink: #B84413; --accent-wash: #FBD9C7; --accent-soft: #FCEFE8;
    --ok: #1F6B3E; --bad: #B3261E; --bad-soft: #FBEDEC;
    --s1: .5rem; --s2: 1rem; --s3: 1.5rem; --s4: 2.5rem; --s5: 3.5rem; --s6: 5rem;
    --r: 16px;
    --shadow: 0 1px 2px rgba(18,16,14,.04), 0 12px 32px -16px rgba(18,16,14,.16);
    --mono: ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  body { margin: 0; background: var(--paper); color: var(--ink);
         font: 400 17px/1.6 var(--sans); letter-spacing: -.005em; }
  .wrap { max-width: 58rem; margin: 0 auto; padding: var(--s6) var(--s3); }
  /* The wordmark carries the product's own gesture — the name is marked the way a match
     is marked. Same mark as the site's nav, drawn without the site's fonts. */
  .brand { display: inline-block; font-weight: 700; font-size: 1.35rem; line-height: 1;
           letter-spacing: -.035em; color: var(--ink);
           background-image: linear-gradient(var(--accent-wash), var(--accent-wash));
           background-repeat: no-repeat; background-position: 0 100%;
           background-size: 100% .3em; padding: 0 .12em .06em; }
  h1 { font-size: clamp(1.9rem, 5vw, 2.7rem); line-height: 1.08; margin: var(--s3) 0 0;
       letter-spacing: -.035em; font-weight: 700; max-width: 20ch; }
  .sub { color: var(--dim); margin: var(--s2) 0 var(--s5); font-size: .95rem; }
  /* Real headings, not labels. These were .78rem uppercase grey, which made the section
     that holds the evidence quieter than the evidence's own filenames. */
  h2 { font-size: 1.3rem; line-height: 1.25; letter-spacing: -.025em; color: var(--ink);
       margin: var(--s5) 0 var(--s2); font-weight: 700; max-width: 26ch; }
  p { max-width: 64ch; }
  /* A surface, not a pair of rules. The verdict is the answer the reader opened the file
     for: the figure at the left, what it means beside it. */
  .verdict { background: var(--white); border-radius: var(--r); box-shadow: var(--shadow);
             padding: var(--s4); display: grid; gap: .3rem var(--s4);
             grid-template-columns: auto minmax(0, 1fr); align-items: start; }
  .verdict .big { grid-row: span 2; align-self: center; }
  .verdict .label { align-self: end; }
  .verdict p { margin: 0; max-width: 58ch; }
  /* The one place a colour fills a surface. A refusal is the machine declining to answer,
     and it must not be possible to skim past it as though it were a low number. */
  .verdict.refused { background: var(--bad-soft); }
  .big { font-family: var(--mono); font-size: clamp(2.6rem, 6vw, 3.6rem); line-height: .95;
         font-weight: 400; letter-spacing: -.045em; }
  /* Colour is testimony. Green is the only green and means verified-clean; the accent
     marks findings that have to be read; red is refusals and errors only, never a verdict.
     A count of matches used to render red, which told the reader "error" about a
     measurement. */
  .big.clean { color: var(--ok); } .big.dirty { color: var(--accent); } .big.refused { color: var(--bad); }
  .label { color: var(--dim); font-size: .74rem; text-transform: uppercase; letter-spacing: .12em; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  th, td { text-align: left; padding: .8rem 1rem .8rem 0; vertical-align: top; }
  /* One rule per row, and only between rows — a table is the one thing space cannot
     divide, because the eye has to track across it. */
  tr + tr th, tr + tr td { border-top: 1px solid var(--line); }
  th { font-size: .72rem; text-transform: uppercase; letter-spacing: .1em; color: var(--dim);
       font-weight: 500; white-space: nowrap; }
  td { font-family: var(--mono); word-break: break-word; }
  .hit { background: var(--white); border-radius: var(--r); box-shadow: var(--shadow);
         padding: var(--s3); margin: 0 0 var(--s2); }
  .hit code { font-family: var(--mono); font-size: .74rem; color: var(--dim); letter-spacing: .02em; }
  .quote { margin: var(--s2) 0 0; font-size: 1rem; line-height: 1.65; }
  /* The struck highlight, the same gesture the site performs: the matched words marked
     the way a reader marks them. On paper it becomes an underline instead — see the print
     block, where a pale wash prints as nothing legible and a rule prints as a rule. */
  /* background-color: transparent is load-bearing. A <mark> carries a yellow UA background
     by default, and setting only background-image leaves that yellow showing through the
     gradient's transparent top 60% — the evidence in every report came out highlighter
     yellow, which is not this product's colour and is not any colour it chose. */
  mark { background-color: transparent;
         background-image: linear-gradient(transparent 60%, var(--accent-wash) 60%);
         background-repeat: no-repeat; background-size: 100% 100%;
         color: inherit; padding-bottom: .05em;
         -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  pre { font-family: var(--mono); font-size: .78rem; line-height: 1.6; background: var(--wash);
        border-radius: var(--r); padding: var(--s3); overflow-x: auto;
        white-space: pre-wrap; word-break: break-word; }
  .note, .ids { color: var(--dim); font-size: .88rem; }
  .ids { font-family: var(--mono); word-break: break-word; }
  /* Used by web/sample-report.html, which is this renderer's output published as a page.
     A sample report that is not labelled a sample is a fabricated finding. */
  .illustration { display: inline-block; font-family: var(--mono); font-size: .68rem;
                  letter-spacing: .15em; text-transform: uppercase; color: var(--accent-ink);
                  background: var(--accent-soft); border-radius: 999px;
                  padding: .4rem .75rem; margin: var(--s3) 0 0; }
  footer { margin-top: var(--s6); color: var(--dim); font-size: .85rem; }
  @media print {
    :root { --paper: #fff; --white: #fff; --ink: #000; --dim: #444; --line: #bbb;
            --wash: #f4f4f4; --accent: #8a3410; --ok: #0f5c26; --bad: #8f1515;
            --bad-soft: #fff; --shadow: none; }
    body { font-size: 11pt; }
    .verdict, .hit { border: 1px solid #ccc; box-shadow: none; }
    .verdict.refused { border-color: #8f1515; border-width: 2px; }
    /* A 12% wash prints as an indistinguishable grey and takes the evidence with it. */
    mark { background-image: none; border-bottom: 2px solid #8a3410; }
    .hit, .verdict, pre, table { break-inside: avoid; }
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
      ? `<div class="verdict refused">
    <div class="big refused">refused</div>
    <div class="label">this corpus was not scanned</div>
    <p>${
      (report.load?.totalLines ?? 0) === 0
        ? 'The file is empty — there were no lines to read.'
        : `None of its ${num(report.load?.totalLines ?? 0)} line(s) could be read as a JSONL record
    (one {&quot;text&quot;: …} object per line); ${num(report.load?.skipped ?? 0)} were skipped.`
    } Nothing was checked, so this is not a clean result.</p>
  </div>`
      : `<div class="verdict">
    <div class="big ${clean ? 'clean' : 'dirty'}">${num(exact.itemsHit)}</div>
    <div class="label">of ${num(exact.itemsTotal)} ${esc(nounFor(exact.itemsTotal))} appear in this corpus</div>
    <p>${
      clean
        ? 'No verbatim overlap was found. That is a result rather than the absence of one: every item that could be checked was checked, and the ones that could not are named below.'
        : 'Read the matches below before concluding anything. Canonical text with one natural phrasing looks identical to leakage in any count, and only the words tell you which this is.'
    }</p>
  </div>`
  }

  <h2>What was checked</h2>
  <div class="scroll"><table>
    <tr><th>indexed</th><td>${esc(report.benchmark)}, ${num(exact.itemsTotal)} ${esc(nounFor(exact.itemsTotal))} at n=${report.n}</td></tr>
    <tr><th>corpus</th><td>${esc(report.corpus)} · ${num(report.corpusDocs)} documents · ${num(report.corpusTokens)} tokens</td></tr>
    <tr><th>matches kept</th><td>${num(exact.totalHits)}</td></tr>
    <tr><th>dropped as ordinary language</th><td>${num(exact.droppedGeneric ?? 0)}</td></tr>
    <tr><th>could not be checked</th><td>${num(uncheckable)} ${esc(nounFor(uncheckable))}${
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
