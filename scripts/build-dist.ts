/**
 * Builds the published package.
 *
 * Node executes this repository's TypeScript directly, with no build step — but it refuses
 * to strip types for anything under node_modules, so a package shipping raw .ts is a
 * package that cannot run. That restriction is deliberate on Node's side and not worth
 * fighting: the source stays the source, and publishing bundles it.
 *
 * Deliberately NOT minified. Ingot asks people to check its claims, and a tool whose
 * published artifact is an unreadable single line is asking for trust instead. The whole
 * bundle is about 40 KB.
 *
 * Zero runtime dependencies still holds: esbuild runs here, at build time, through npx.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESBUILD, NPX_OPTS } from './npx.ts';

type Target = { entry: string; out: string; platform: 'node' | 'browser' };

// dist/cli.js keeps its shebang because esbuild preserves the entry point's. Passing it as
// --banner:js instead means handing "#!/usr/bin/env node" to a shell, which mangles it.
const TARGETS: Target[] = [
  { entry: 'src/bin.ts', out: 'dist/cli.js', platform: 'node' },
  { entry: 'src/contamination/scan.ts', out: 'dist/node.js', platform: 'node' },
  { entry: 'src/contamination/browserScan.ts', out: 'dist/browser.js', platform: 'browser' },
];

mkdirSync(resolve('dist'), { recursive: true });
process.stdout.write('\n  building dist\n\n');

for (const t of TARGETS) {
  const args = [
    '--yes', ESBUILD, t.entry,
    '--bundle', '--format=esm', `--outfile=${t.out}`,
    `--platform=${t.platform}`, '--target=node24',
  ];
  execFileSync('npx', args, { stdio: ['ignore', 'ignore', 'inherit'], ...NPX_OPTS });

  const kb = statSync(resolve(t.out)).size / 1024;
  process.stdout.write(`  ${t.out.padEnd(18)} ${kb.toFixed(1).padStart(6)} KB  ${t.platform}\n`);
}

const bundled = readdirSync(resolve('dist'));
process.stdout.write(`\n  ${bundled.length} file(s), no runtime dependencies\n\n`);
