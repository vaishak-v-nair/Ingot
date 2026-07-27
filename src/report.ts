import { CLAIM_SCOPE } from './scorer.ts';
import type { ScanReport, ScoredSignal } from './types.ts';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function fmt(v: number | null, digits = 4): string {
  return v === null || !Number.isFinite(v) ? '—' : v.toFixed(digits);
}

function bar(likeness: number | null): string {
  if (likeness === null) return '<span class="muted">not compared</span>';
  const pct = Math.max(0, Math.min(1, likeness)) * 100;
  return `<span class="bar" style="--fill:${pct.toFixed(1)}%" aria-label="${pct.toFixed(0)}% toward machine reference"></span>`;
}

function signalRow(s: ScoredSignal): string {
  const status = s.available
    ? s.usedInScore
      ? '<span class="tag ok">compared</span>'
      : '<span class="tag skip">not compared</span>'
    : '<span class="tag na">unavailable</span>';
  const why = s.usedInScore ? '' : `<div class="why">${esc(s.skipReason ?? s.reason ?? '')}</div>`;
  return `<tr>
    <td class="k">${esc(s.label)}<div class="sub">${s.strength} signal ${status}</div></td>
    <td class="num">${fmt(s.value)}</td>
    <td class="num">${s.zVsHuman === null ? '—' : `${s.zVsHuman > 0 ? '+' : ''}${s.zVsHuman.toFixed(2)}σ`}</td>
    <td class="num">${s.separationSd === null ? '—' : `${s.separationSd.toFixed(2)}σ`}</td>
    <td class="lean">${bar(s.machineLikeness)}</td>
    <td class="det">${esc(s.detail)}${why}</td>
  </tr>`;
}

export function renderReport(report: ScanReport): string {
  const flagged = report.signals.flatMap((s) => s.flagged);
  const uniqueFlagged = [...new Set(flagged)];
  const purityText = report.purity === null ? 'NO SCORE' : String(report.purity);

  const refusalBlock = report.refusal
    ? `<div class="refusal"><strong>Ingot declined to score this batch.</strong> ${esc(report.refusal)}</div>`
    : '';

  const flaggedBlock = uniqueFlagged.length
    ? `<section>
        <h2>Flagged records <span class="muted">${uniqueFlagged.length} distinct, showing ${Math.min(50, uniqueFlagged.length)}</span></h2>
        <div class="chips">${uniqueFlagged.slice(0, 50).map((id) => `<code>${esc(id)}</code>`).join('')}</div>
      </section>`
    : `<section><h2>Flagged records</h2><p class="empty">No records flagged. Every signal that ran sits inside its reference range.</p></section>`;

  const authorNote =
    report.authors.count === 0
      ? 'no annotator ids in this batch'
      : `${report.authors.count} annotators, ${report.authors.withEnoughRecords} with enough records to profile`;

  return `<title>Ingot report — ${esc(report.batchName)}</title>
<style>
  :root {
    --bg: #fbfaf7; --fg: #16150f; --muted: #6d6a5c; --line: #ddd9cc;
    --card: #ffffff; --accent: #9a6a00; --ok: #2f6b34; --warn: #8a5a00; --bad: #8f2f22;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14140f; --fg: #f2efe4; --muted: #9a968a; --line: #2e2c24;
      --card: #1c1b15; --accent: #e0aa3e; --ok: #7fbf85; --warn: #e0aa3e; --bad: #e2887a;
    }
  }
  :root[data-theme="light"] {
    --bg: #fbfaf7; --fg: #16150f; --muted: #6d6a5c; --line: #ddd9cc;
    --card: #ffffff; --accent: #9a6a00; --ok: #2f6b34; --warn: #8a5a00; --bad: #8f2f22;
  }
  :root[data-theme="dark"] {
    --bg: #14140f; --fg: #f2efe4; --muted: #9a968a; --line: #2e2c24;
    --card: #1c1b15; --accent: #e0aa3e; --ok: #7fbf85; --warn: #e0aa3e; --bad: #e2887a;
  }
  body {
    margin: 0; padding: 2.5rem 1.25rem 4rem; background: var(--bg); color: var(--fg);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 60rem; margin: 0 auto; }
  header { border-bottom: 1px solid var(--line); padding-bottom: 1.25rem; margin-bottom: 2rem; }
  .brand { font-weight: 620; letter-spacing: .14em; text-transform: uppercase; font-size: .78rem; color: var(--accent); }
  h1 { font-size: 1.5rem; margin: .4rem 0 .2rem; font-weight: 600; }
  .meta { color: var(--muted); font-size: .82rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .verdict-card {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 1.5rem; display: flex; gap: 1.75rem; align-items: baseline; flex-wrap: wrap;
    margin-bottom: 1rem;
  }
  .purity { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 3.4rem; line-height: 1; font-weight: 600; }
  .purity.good { color: var(--ok); } .purity.mid { color: var(--warn); } .purity.bad { color: var(--bad); }
  .purity-label { color: var(--muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .1em; }
  .verdict-text { flex: 1 1 18rem; min-width: 0; }
  .scope { color: var(--muted); font-size: .8rem; margin-top: .5rem; }
  h2 { font-size: .82rem; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); margin: 2.25rem 0 .75rem; font-weight: 600; }
  h2 .muted { text-transform: none; letter-spacing: 0; }
  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
  table { border-collapse: collapse; width: 100%; min-width: 44rem; }
  th, td { text-align: left; padding: .7rem .85rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 600; }
  tr:last-child td { border-bottom: 0; }
  .k { font-weight: 550; }
  .sub { color: var(--muted); font-size: .74rem; font-weight: 400; margin-top: .2rem; }
  .num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
  .det { color: var(--muted); font-size: .82rem; max-width: 24rem; }
  .why { color: var(--warn); font-size: .78rem; margin-top: .3rem; }
  .lean { min-width: 7rem; }
  .bar { display: block; height: .55rem; border-radius: 99px; background: color-mix(in srgb, var(--fg) 12%, transparent); position: relative; }
  .bar::after { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--fill); border-radius: 99px; background: var(--accent); }
  .tag { font-size: .68rem; padding: .1rem .38rem; border-radius: 4px; border: 1px solid var(--line); margin-left: .35rem; }
  .tag.ok { color: var(--ok); } .tag.skip { color: var(--warn); } .tag.na { color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: .35rem; }
  .chips code { font-size: .74rem; padding: .18rem .4rem; border: 1px solid var(--line); border-radius: 4px; background: var(--card); }
  .empty { color: var(--muted); }
  .refusal { border: 1px solid var(--bad); border-radius: 10px; padding: 1rem; margin-bottom: 1rem; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .76rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  img, table { max-width: 100%; }
</style>
<div class="wrap">
  <header>
    <div class="brand">Ingot · purity report</div>
    <h1>${esc(report.batchName)}</h1>
    <div class="meta">${report.records.toLocaleString()} records · ${esc(authorNote)} · ${report.load.skipped} lines skipped of ${report.load.totalLines.toLocaleString()}</div>
  </header>

  ${refusalBlock}

  <div class="verdict-card">
    <div>
      <div class="purity ${report.purity === null ? '' : report.purity >= 85 ? 'good' : report.purity >= 55 ? 'mid' : 'bad'}">${purityText}</div>
      <div class="purity-label">purity / 100 · ${esc(report.confidence)} confidence</div>
    </div>
    <div class="verdict-text">
      <div>${esc(report.verdict)}</div>
      <div class="scope">${esc(CLAIM_SCOPE)}</div>
    </div>
  </div>

  <h2>Signals</h2>
  <div class="scroll">
    <table>
      <thead><tr>
        <th>Signal</th><th>Value</th><th>vs human</th><th>separating power</th><th>human → machine</th><th>Evidence</th>
      </tr></thead>
      <tbody>${report.signals.map(signalRow).join('')}</tbody>
    </table>
  </div>

  ${flaggedBlock}

  <footer>
    ${esc(report.scannerVersion)} · human reference: ${esc(report.baselineNames.human)} · machine reference: ${esc(report.baselineNames.machine)} · generated ${esc(report.generatedAt)}<br>
    Runs entirely on this machine. No network calls, no data retention.
  </footer>
</div>`;
}
