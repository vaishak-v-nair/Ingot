/**
 * Which field of a JSONL record holds its text, and its id.
 *
 * One list, because there used to be two. `loader.ts` ranked `answer` above `content` and
 * `contamination/scanSession.ts` ranked `content` above `answer`, so a record carrying both
 * fields loaded as two different documents depending on which side of the tool read it —
 * the scanner saw one text, the batch reader saw another, and nothing anywhere said the two
 * disagreed. That is the same class of defect as an index and a scan tokenizing
 * differently, and it is fixed the same way: by there being only one of the thing.
 *
 * The order is a preference, not a guess about meaning. `text` first because it is the
 * near-universal convention; `content` above `answer` because a document's body is the
 * common case for a corpus and a QA answer is the narrow one. When a record carries several
 * of these, the first match wins and the choice is deterministic — which is the property
 * that actually matters, since a reader comparing two Ingot reports must never have to
 * wonder which field each one read.
 *
 * Explicit --text-field always overrides this list, and a --text-field naming an absent
 * field is refused rather than silently falling back to the list.
 */
export const TEXT_FIELD_CANDIDATES = ['text', 'response', 'output', 'completion', 'content', 'answer'] as const;

export const ID_FIELD_CANDIDATES = ['id', '_id', 'record_id', 'uuid'] as const;

export const AUTHOR_FIELD_CANDIDATES = [
  'annotator_id',
  'annotatorId',
  'author_id',
  'authorId',
  'worker_id',
  'contributor',
] as const;

export const PROMPT_FIELD_CANDIDATES = ['prompt', 'instruction', 'question', 'input'] as const;

/**
 * True when a record's text is worth scanning at all.
 *
 * Whitespace-only is not a document. The two readers disagreed here too: the batch loader
 * skipped such a record and the scanner counted it as a scanned document contributing zero
 * tokens, which inflates the denominator of a "clean" result with rows nobody could have
 * matched. Counting an empty row as examined is a small lie in exactly the place this tool
 * refuses to tell one.
 */
export function isUsableText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
