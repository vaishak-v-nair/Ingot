import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { normalizeText } from './text.ts';
import { EmptyBatchError, SchemaMismatchError } from './errors.ts';
import type { DataRecord, LoadResult, SkippedLine } from './types.ts';

export type LoadOptions = {
  textField?: string;
  authorField?: string;
  idField?: string;
  promptField?: string;
};

const TEXT_FIELD_CANDIDATES = ['text', 'response', 'output', 'completion', 'answer', 'content'];
const AUTHOR_FIELD_CANDIDATES = ['annotator_id', 'annotatorId', 'author_id', 'authorId', 'worker_id', 'contributor'];
const ID_FIELD_CANDIDATES = ['id', '_id', 'record_id', 'uuid'];
const PROMPT_FIELD_CANDIDATES = ['prompt', 'instruction', 'question', 'input'];

function pickField(row: Record<string, unknown>, explicit: string | undefined, candidates: string[]): string | null {
  if (explicit) return explicit in row ? explicit : null;
  for (const c of candidates) {
    const v = row[c];
    if (typeof v === 'string' && v.trim().length > 0) return c;
  }
  return null;
}

/**
 * Reads JSONL. Unparseable lines are counted and reported, never silently dropped.
 * A missing text field is a refusal, not a guess.
 */
export function loadBatch(path: string, options: LoadOptions = {}): LoadResult {
  const raw = readFileSync(path, 'utf8');
  const { text: normalized, changed } = normalizeText(raw);
  const lines = normalized.split('\n');

  const records: DataRecord[] = [];
  const skipped: SkippedLine[] = [];
  const seenIds = new Set<string>();

  let textField: string | null = null;
  let authorField: string | null = null;
  let idField: string | null = null;
  let promptField: string | null = null;
  let firstRowFields: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;

    let row: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        skipped.push({ line: i + 1, reason: 'not a JSON object' });
        continue;
      }
      row = parsed as Record<string, unknown>;
    } catch {
      skipped.push({ line: i + 1, reason: 'unparseable JSON' });
      continue;
    }

    if (textField === null) {
      firstRowFields = Object.keys(row);
      textField = pickField(row, options.textField, TEXT_FIELD_CANDIDATES);
      if (textField === null) {
        throw new SchemaMismatchError(options.textField ?? 'text', firstRowFields);
      }
      authorField = pickField(row, options.authorField, AUTHOR_FIELD_CANDIDATES);
      idField = pickField(row, options.idField, ID_FIELD_CANDIDATES);
      promptField = pickField(row, options.promptField, PROMPT_FIELD_CANDIDATES);
    }

    const textValue = row[textField];
    if (typeof textValue !== 'string' || textValue.trim().length === 0) {
      skipped.push({ line: i + 1, reason: `empty or non-string "${textField}"` });
      continue;
    }

    let id = idField ? String(row[idField] ?? '') : '';
    if (id.length === 0) id = `r${i + 1}`;
    if (seenIds.has(id)) {
      id = `${id}#${i + 1}`;
      skipped.push({ line: i + 1, reason: 'duplicate id, suffixed' });
    }
    seenIds.add(id);

    const authorRaw = authorField ? row[authorField] : undefined;
    const promptRaw = promptField ? row[promptField] : undefined;

    records.push({
      id,
      text: textValue,
      authorId: typeof authorRaw === 'string' && authorRaw.length > 0 ? authorRaw : undefined,
      prompt: typeof promptRaw === 'string' && promptRaw.length > 0 ? promptRaw : undefined,
    });
  }

  if (records.length === 0) throw new EmptyBatchError(basename(path));

  return { records, totalLines: lines.filter((l) => l.trim().length > 0).length, skipped, encodingNormalized: changed };
}
