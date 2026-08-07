import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  for (const f of ['index.html', 'site.css', 'ingot.js', 'scan.worker.js', 'sample-corpus.jsonl']) {
    cpSync(join('web', f), join(dir, f));
  }
  cpSync('web/fonts', join(dir, 'fonts'), { recursive: true });
  mkdirSync(join(dir, 'media'), { recursive: true });
  cpSync('web/media/intro-poster.jpg', join(dir, 'media', 'intro-poster.jpg'));

  const items = Array.from({ length: 20 }, (_, i) => ({ id: `e2e-${i}`, text: words(40, 90000 + i) }));
  const index = NgramIndex.build('e2e', items, { n: 10 });
  const bin = await gzipBytes(encodeIndex(index.serialize()));
  mkdirSync(join(dir, 'indexes'), { recursive: true });
  // The page's menu names three real benchmarks; every name resolves to the synthetic
  // index so nothing 404s regardless of what a scenario selects.
  for (const name of ['gsm8k', 'humaneval', 'mmlu']) {
    writeFileSync(join(dir, 'indexes', `${name}.idx.bin.gz`), bin);
  }

  assertLocalRefsExist(dir);
  return { dir, planted: items[0].text };
}

/**
 * Every same-origin file the page asks for must be in the assembled directory.
 *
 * The copy list above is deliberately explicit — a glob would pull the real 5.35 MB
 * indexes in place of the synthetic ones — but an explicit list is a list somebody has to
 * remember, and adding web/site.css to the site without adding it here produced three
 * scenarios failing on "no console errors" with a bare 404 and no clue which file. This
 * turns the next omission into a named failure at assembly time instead of a symptom
 * three scenarios later.
 */
function assertLocalRefsExist(dir: string): void {
  // Deliberately narrow: stylesheets and the faces they name. Those are the refs whose
  // absence changes nothing about whether the page LOADS — it renders, unstyled or with a
  // fallback face, and every scenario still runs. A missing script or index throws or
  // 404s loudly and the suite's console-error assertions already catch it; the video is
  // omitted on purpose and falls back to its poster. Widening this to every src/href
  // flagged nav links to about.html and registry.html, which are navigation targets in a
  // one-page synthetic site and correctly absent.
  const refs = new Set<string>();
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<link\b[^>]*\brel\s*=\s*"stylesheet"[^>]*\bhref\s*=\s*"([^"]+)"/gi)) {
    refs.add(m[1].split('?')[0].replace(/^\.?\//, ''));
  }
  for (const sheet of [...refs]) {
    const p = join(dir, sheet);
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, 'utf8').matchAll(/url\(\s*"([^"]+)"\s*\)/gi)) {
      if (/^(?:https?:|data:)/i.test(m[1])) continue;
      refs.add(m[1].split('?')[0].replace(/^\.?\//, ''));
    }
  }

  const missing = [...refs].filter((r) => !existsSync(join(dir, r)));
  if (missing.length > 0) {
    throw new Error(
      `assembleSite did not copy ${missing.length} stylesheet asset(s) the page references: ` +
        `${missing.join(', ')}. Add them to the copy list in e2e/site.ts.`,
    );
  }
}
