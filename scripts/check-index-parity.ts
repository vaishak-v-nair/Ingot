/**
 * Asserts the committed indexes are what the current code builds from the current benchmarks.
 *
 * Two indexes ship inside the npm tarball — HumanEval and GSM8K — so `npx ingot-scan
 * contaminate --index gsm8k` works with nothing else downloaded. The site does not use
 * those files: the Vercel build regenerates all three from data/bench on every deploy. That
 * makes two distribution surfaces fed by two different artifacts, and nothing compared them.
 *
 * On 2026-08-03 they were provably different. The committed pair still recorded
 * `"scannerVersion":"ingot-0.1.0"` after the 0.1.3 bump — one byte inside the header, the
 * grams identical — so every install from npm carried an index naming a scanner three
 * releases stale while the deployed site was correct. It was found by hand. This is the
 * gate that would have found it instead.
 *
 * The comparison is on the ENCODED bytes, before gzip, deliberately. Gzip output depends on
 * the zlib build doing the compressing, so comparing compressed files would eventually go
 * red on a runner whose Node ships a different zlib — a failure that says nothing about the
 * index and trains everyone to ignore the gate. Every difference that matters survives
 * decompression.
 *
 * MMLU is absent on purpose: at 5.35 MB it is deliberately not committed (.gitignore says
 * so), so there is no second copy to disagree with.
 *
 *   node scripts/check-index-parity.ts        # needs data/bench
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { encodeIndex } from '../src/contamination/indexCodec.ts';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { DEFAULT_N } from '../src/contamination/types.ts';
import { loadBatch } from '../src/loader.ts';

/** Exactly the set that .gitignore negates back in — the ones a stranger receives from npm. */
const SHIPPED = ['humaneval', 'gsm8k'];

let failures = 0;
process.stdout.write('\n  checking the committed indexes against a fresh build\n\n');

for (const name of SHIPPED) {
  const benchPath = resolve(`data/bench/${name}.jsonl`);
  const items = loadBatch(benchPath).records.map((r) => ({ id: r.id, text: r.text }));
  const rebuilt = encodeIndex(NgramIndex.build(name, items, { n: DEFAULT_N }).serialize());
  const committed = gunzipSync(readFileSync(resolve(`web/indexes/${name}.idx.bin.gz`)));

  if (rebuilt.length === committed.length) {
    let diffAt = -1;
    for (let i = 0; i < rebuilt.length; i++) {
      if (rebuilt[i] !== committed[i]) {
        diffAt = i;
        break;
      }
    }
    if (diffAt === -1) {
      process.stdout.write(`  ok    ${name.padEnd(12)} ${committed.length.toLocaleString('en-US').padStart(10)} bytes\n`);
      continue;
    }
    // One byte apart is the version-stamp case, and saying so beats a hex dump: the header
    // is JSON, so the surrounding text names the field that moved.
    const window = (b: Uint8Array): string =>
      Buffer.from(b.subarray(Math.max(0, diffAt - 48), diffAt + 24)).toString('latin1');
    process.stdout.write(
      `  FAIL  ${name}: differs at byte ${diffAt.toLocaleString('en-US')} of ${committed.length.toLocaleString('en-US')}\n` +
        `        committed  …${window(committed)}…\n` +
        `        rebuilt    …${window(rebuilt)}…\n`,
    );
  } else {
    process.stdout.write(
      `  FAIL  ${name}: committed ${committed.length.toLocaleString('en-US')} bytes, ` +
        `rebuild ${rebuilt.length.toLocaleString('en-US')} bytes\n`,
    );
  }
  failures++;
}

if (failures > 0) {
  process.stdout.write(
    `\n  ${failures} index/indexes no longer match a fresh build.\n` +
      `  Either the benchmark moved, the encoder changed, or the committed file was never\n` +
      `  regenerated after a version bump. Run 'node scripts/build-web.ts' and commit the\n` +
      `  result — after checking which of the three it was, because the third is the only\n` +
      `  one that is safe to just re-commit.\n\n`,
  );
  process.exit(1);
}

process.stdout.write('\n  the npm tarball and the deployed site build the same indexes\n\n');
