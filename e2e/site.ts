import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NgramIndex } from '../src/contamination/ngramIndex.ts';
import { encodeIndex, gzipBytes } from '../src/contamination/indexCodec.ts';
import { mulberry32 } from '../src/text.ts';

export function words(count: number, seed = 0): string {
  const rand = mulberry32((seed * 2654435761) >>> 0);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(`w${Math.floor(rand() * 100000)}`);
  return out.join(' ');
}

/**
 * Assembles the real site into a temp directory with SYNTHETIC benchmark indexes, so the
 * suite runs the exact shipped page and bundles — index.html, ingot.js, scan.worker.js —
 * against deterministic data. No benchmark downloads, no network, exact expected numbers
 * on any machine including CI.
 */
export async function assembleSite(): Promise<{ dir: string; planted: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'ingot-e2e-site-'));
  for (const f of ['index.html', 'ingot.js', 'scan.worker.js', 'sample-corpus.jsonl']) {
    cpSync(join('web', f), join(dir, f));
  }
  cpSync('web/fonts', join(dir, 'fonts'), { recursive: true });
  mkdirSync(join(dir, 'media'), { recursive: true });
  cpSync('web/media/guide-poster.jpg', join(dir, 'media', 'guide-poster.jpg'));

  const items = Array.from({ length: 20 }, (_, i) => ({ id: `e2e-${i}`, text: words(40, 90000 + i) }));
  const index = NgramIndex.build('e2e', items, { n: 10 });
  const bin = await gzipBytes(encodeIndex(index.serialize()));
  mkdirSync(join(dir, 'indexes'), { recursive: true });
  // The page's menu names three real benchmarks; every name resolves to the synthetic
  // index so nothing 404s regardless of what a scenario selects.
  for (const name of ['gsm8k', 'humaneval', 'mmlu']) {
    writeFileSync(join(dir, 'indexes', `${name}.idx.bin.gz`), bin);
  }
  return { dir, planted: items[0].text };
}
