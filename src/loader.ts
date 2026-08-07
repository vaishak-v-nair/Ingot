import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { normalizeText } from './text.ts';
import { EmptyBatchError, SchemaMismatchError } from './errors.ts';
import {
  AUTHOR_FIELD_CANDIDATES,
  ID_FIELD_CANDIDATES,
  isUsableText,
  PROMPT_FIELD_CANDIDATES,
  TEXT_FIELD_CANDIDATES,
} from './fields.ts';
import type { DataRecord, LoadResult, SkippedLine } from './types.ts';

export type LoadOptions = {
  textField?: string;
  authorField?: string;
  idField?: string;
  promptField?: string;
};

function pickField(
  row: Record<string, unknown>,
  explicit: string | undefined,
  candidates: readonly string[],
): string | null {
  if (explicit) return explicit in row ? explicit : null;
  for (const c of candidates) {
    if (isUsableText(row[c])) return c;
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

    if (firstRowFields.length === 0) firstRowFields = Object.keys(row);

    // Field detection walks forward until a record actually carries usable text, rather
    // than reading the first record and condemning the file on it.
    //
    // A JSONL whose first row has an empty text field is ordinary — an export with a
    // placeholder header row, a scrape whose first page 404'd — and it used to abort the
    // whole load with "no text field found. Fields present: text", a sentence that
    // contradicts itself. The first row is a sample, not a schema.
    if (textField === null) {
      textField = pickField(row, options.textField, TEXT_FIELD_CANDIDATES);
      if (textField === null) {
        skipped.push({
          line: i + 1,
          reason: options.textField
            ? `no usable "${options.textField}"`
            : 'no field holding usable text',
        });
        continue;
      }
      authorField = pickField(row, options.authorField, AUTHOR_FIELD_CANDIDATES);
      idField = pickField(row, options.idField, ID_FIELD_CANDIDATES);
      promptField = pickField(row, options.promptField, PROMPT_FIELD_CANDIDATES);
    }

    const textValue = row[textField];
    if (!isUsableText(textValue)) {
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

  // No record anywhere in the file carried text. That is a schema problem, and saying so
  // beats "contains no usable records", which sends the reader looking at their data when
  // the fix is a --text-field flag.
  if (textField === null && firstRowFields.length > 0) {
    throw new SchemaMismatchError(options.textField ?? 'text', firstRowFields);
  }
  if (records.length === 0) throw new EmptyBatchError(basename(path));

  return { records, totalLines: lines.filter((l) => l.trim().length > 0).length, skipped, encodingNormalized: changed };
}
