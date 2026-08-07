import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBatch } from '../src/loader.ts';
import { parseCorpusLine } from '../src/contamination/scanSession.ts';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { decodeIndex, encodeIndex } from '../src/contamination/indexCodec.ts';
import { renderContaminationReport } from '../src/contamination/reportHtml.ts';
import { scanCorpus } from '../src/contamination/scan.ts';
import { isUnsegmentedScript, unsegmentedScriptShare } from '../src/text.ts';

const dir = mkdtempSync(join(tmpdir(), 'ingot-coverage-'));

function jsonl(name: string, rows: unknown[]): string {
  const p = join(dir, name);
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return p;
}

// Real prose, not lorem: the point is that these tokenize to almost nothing.
const JAPANESE = '私の文章が人工知能の訓練データに含まれているかどうかを確認したいと思っています。';
const CHINESE = '我想知道我的文章是否被用于训练人工智能模型这是一个很重要的问题';
const ENGLISH = 'The quick brown fox jumps over the lazy dog and then keeps running for miles on end';

test('the two readers of a JSONL record pick the same field', () => {
  // loader.ts ranked `answer` above `content` and scanSession.ts ranked `content` above
  // `answer`, so one record loaded as two different documents depending on which half of
  // the tool read it, and nothing said the two disagreed.
  const row = { answer: 'ANSWER-SIDE', content: 'CONTENT-SIDE' };
  const path = jsonl('dual.jsonl', [row]);

  const fromScanner = parseCorpusLine(JSON.stringify(row), 1)?.text;
  const fromLoader = loadBatch(path).records[0].text;
  assert.equal(fromScanner, fromLoader);
});

test('a whitespace-only record is not a document on either side', () => {
  // The scanner counted it as one more corpus document contributing zero tokens, which
  // pads the denominator of a clean result with a row nobody could have matched.
  assert.equal(parseCorpusLine(JSON.stringify({ text: '   \t  ' }), 1), null);

  const path = jsonl('blank.jsonl', [{ text: '  \t ' }, { text: ENGLISH }]);
  const load = loadBatch(path);
  assert.equal(load.records.length, 1);
  assert.equal(load.skipped.length, 1);
});

test('a blank first record does not condemn the whole file', () => {
  // It used to: field detection read record one, found no usable text, and threw
  // `no "text" field found. Fields present: text` — a sentence that contradicts itself.
  const path = jsonl('blank-first.jsonl', [{ text: '' }, { text: ENGLISH }, { text: ENGLISH }]);
  const load = loadBatch(path);
  assert.equal(load.records.length, 2);
  assert.equal(load.skipped.length, 1);
});

test('a file where no record anywhere has text is a schema error, not an empty batch', () => {
  const path = jsonl('wrong-schema.jsonl', [{ body: 'a' }, { body: 'b' }]);
  assert.throws(() => loadBatch(path), /no "text" field found/);
});

test('unsegmented-script share separates prose from the tokenizer that cannot read it', () => {
  assert.equal(unsegmentedScriptShare(ENGLISH), 0);
  assert.ok(unsegmentedScriptShare(JAPANESE) > 0.9);
  assert.ok(isUnsegmentedScript(CHINESE));
  assert.equal(isUnsegmentedScript(ENGLISH), false);
  // Korean is written with spaces, so it is genuinely segmentable and must not be flagged.
  assert.equal(isUnsegmentedScript('제 글이 인공지능 학습 데이터에 포함되었는지 확인하고 싶습니다'), false);
});

test('an index names the items whose script it could not segment', () => {
  const index = NgramIndex.build(
    'mixed',
    [
      { id: 'en', text: ENGLISH },
      { id: 'ja', text: JAPANESE },
      { id: 'zh', text: CHINESE },
      { id: 'short', text: 'too short' },
    ],
    { disableStoplist: true },
  );

  assert.ok(index.uncheckableItemIds.includes('ja'));
  assert.deepEqual(index.unsegmentedItemIds.sort(), ['ja', 'zh']);
  // "short" is uncheckable for an unrelated reason and must not be swept in with them.
  assert.ok(index.uncheckableItemIds.includes('short'));
  assert.equal(index.unsegmentedItemIds.includes('short'), false);
});

test('the reason survives a round trip through the published wire format', () => {
  const index = NgramIndex.build('mixed', [
    { id: 'en', text: ENGLISH },
    { id: 'ja', text: JAPANESE },
  ]);
  const restored = NgramIndex.load(decodeIndex(encodeIndex(index.serialize())));
  assert.deepEqual(restored.unsegmentedItemIds, ['ja']);
});

test('an index with nothing to disclose encodes exactly as it did before the field existed', () => {
  // The overwhelmingly common case. An English benchmark must not carry an empty array in
  // every published artifact just because the field exists.
  const data = NgramIndex.build('english', [
    { id: 'a', text: ENGLISH },
    { id: 'b', text: ENGLISH.split(' ').reverse().join(' ') },
  ]).serialize();
  assert.equal(data.unsegmentedItemIds, undefined);
  assert.equal(JSON.stringify(data).includes('unsegmentedItemIds'), false);
});

test('the report says it could not look, rather than that it looked and found nothing', async () => {
  const index = NgramIndex.build(
    'writer',
    [
      { id: 'essay-ja', text: JAPANESE },
      { id: 'essay-en', text: ENGLISH },
    ],
    { disableStoplist: true },
  );
  const corpus = jsonl('corpus.jsonl', [{ text: 'entirely unrelated words about other subjects', id: 'd1' }]);
  const report = await scanCorpus(index, corpus);

  assert.deepEqual(report.unsegmentedItemIds, ['essay-ja']);

  const html = renderContaminationReport(report);
  assert.match(html, /a script\s+Ingot does not split into words/);
  assert.match(html, /could not have looked for them/);
  // The old wording described the tokenizer while appearing to describe the writing.
  assert.equal(/essay-ja[^<]*shorter than/.test(html), false);
});

test('a clean English scan still reports nothing unchecked', async () => {
  const index = NgramIndex.build('english', [{ id: 'a', text: ENGLISH }], { disableStoplist: true });
  const corpus = jsonl('other.jsonl', [{ text: 'completely different material with no overlap at all here' }]);
  const report = await scanCorpus(index, corpus);

  assert.equal(report.unsegmentedItemIds, undefined);
  assert.match(renderContaminationReport(report), /Nothing\. Every benchmark item produced/);
});
