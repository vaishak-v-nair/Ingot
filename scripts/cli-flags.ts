/**
 * The one flag parser. Eight scripts carried byte-identical private copies of this
 * function; a fix to any of them would have had to be made eight times. One module,
 * eight imports — the 2026-08-01 eng review's oldest small finding, finally landed.
 *
 * Then three MORE private copies turned up, in `build-index.ts`, `cdx-check.ts` and
 * `fetch-crawl-slice.ts` — the chain that is run by hand against a real writer's published
 * work. Those three had each independently learned not to swallow the next flag as a value,
 * and none of them had learned to refuse a flag they did not recognise: `--nmae cohort`
 * built the index under the default name, wrote it to a different path than the one asked
 * for, and said nothing. A report reaching a person who trusted us is the worst place in
 * this project for a silent wrong answer, so that chain now shares the CLI's parser rather
 * than a fourth approximation of it.
 */
import { parseArgs } from '../src/args.ts';
import type { FlagSpec } from '../src/args.ts';

export type { FlagSpec };

/**
 * Positional lookup for the scripts that only ever read one or two options and have no
 * spec. Prefer parseScriptArgs for anything a person types by hand.
 */
export function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * Parses argv against a spec and exits 2 on anything unrecognised, printing the usage line.
 *
 * Scripts get the same contract the shipped CLI has: an argument nobody understood stops
 * the run instead of quietly changing what it does.
 */
export function parseScriptArgs(
  spec: FlagSpec,
  usage: string,
): { positional: string[]; flags: Map<string, string> } {
  const { positional, flags, errors } = parseArgs(process.argv.slice(2), spec);
  if (errors.length > 0) {
    process.stderr.write(`\n${errors.map((e) => `  ${e}`).join('\n')}\n\n  usage: ${usage}\n\n`);
    process.exit(2);
  }
  return { positional, flags };
}
