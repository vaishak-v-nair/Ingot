import { tokenize } from '../text.ts';
import type { DataRecord, SignalResult } from '../types.ts';

const NGRAM = 4;
const SHARED_MIN_RATIO = 0.01;
const SCAFFOLD_LINE_RE = /^\s*(?:[-*•]|\d+[.)]|#{1,6}\s|\*\*)/;

function edgeNgram(text: string, from: 'start' | 'end'): string | null {
  const toks = tokenize(text);
  if (toks.length < NGRAM) return null;
  return from === 'start' ? toks.slice(0, NGRAM).join(' ') : toks.slice(-NGRAM).join(' ');
}

function repetitionRate(records: DataRecord[], from: 'start' | 'end'): { rate: number; top: [string, number][]; ids: string[] } {
  const groups = new Map<string, string[]>();
  let counted = 0;
  for (const r of records) {
    const g = edgeNgram(r.text, from);
    if (!g) continue;
    counted++;
    const arr = groups.get(g);
    if (arr) arr.push(r.id);
    else groups.set(g, [r.id]);
  }
  if (counted === 0) return { rate: 0, top: [], ids: [] };

  const threshold = Math.max(2, Math.ceil(counted * SHARED_MIN_RATIO));
  let shared = 0;
  const ids: string[] = [];
  for (const [, memberIds] of groups) {
    if (memberIds.length >= threshold) {
      shared += memberIds.length;
      ids.push(...memberIds);
    }
  }
  const top = [...groups.entries()]
    .filter(([, v]) => v.length >= threshold)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)
    .map(([g, v]) => [g, v.length] as [string, number]);

  return { rate: shared / counted, top, ids };
}

/**
 * Structural repetition: shared openings, shared closings, and markdown scaffolding.
 *
 * This is deliberately structural rather than a list of phrases models like to
 * say. Phrase blocklists go stale with every model release; "how often does this
 * batch reuse the same skeleton" does not.
 */
export function templateSignal(records: DataRecord[]): SignalResult {
  const opener = repetitionRate(records, 'start');
  const closer = repetitionRate(records, 'end');

  let scaffolded = 0;
  for (const r of records) {
    const lines = r.text.split('\n');
    if (lines.some((l) => SCAFFOLD_LINE_RE.test(l))) scaffolded++;
  }
  const scaffoldRate = scaffolded / records.length;

  const score = 0.5 * opener.rate + 0.3 * closer.rate + 0.2 * scaffoldRate;

  const topOpeners = opener.top.map(([g, c]) => `"${g}..." x${c}`).join(', ');

  return {
    key: 'template',
    label: 'Structural repetition',
    strength: 'medium',
    available: true,
    value: score,
    detail:
      `openers reused ${(opener.rate * 100).toFixed(1)}%, closers ${(closer.rate * 100).toFixed(1)}%, ` +
      `markdown scaffolding in ${(scaffoldRate * 100).toFixed(1)}% of records` +
      (topOpeners ? `. Most reused openings: ${topOpeners}` : ''),
    flagged: [...new Set([...opener.ids, ...closer.ids])].slice(0, 50),
  };
}
