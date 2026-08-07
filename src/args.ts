/**
 * Command-line parsing, built on one rule: an argument Ingot does not understand is an
 * error, never a shrug.
 *
 * The old parser accepted anything beginning with `--` and stored it. That is the ordinary
 * convention and it is wrong for this tool specifically. `--maxdocfreq 1000` — a plausible
 * typo for `--max-doc-freq` — was silently discarded, the scan ran at the default threshold
 * of 5, and it exited 0 with a confident report of a DIFFERENT experiment than the one that
 * was asked for. No message said so. For a scanner whose entire claim is that nothing
 * degrades into a silent wrong answer, an ignored flag is the purest form of the failure it
 * exists to refuse.
 *
 * The same applies to a flag whose value went missing. `--out` at the end of the line used
 * to store the empty string, `if (htmlPath)` read it as falsy, and the report the user
 * asked for was never written — exit 0, no complaint. The old comment in the parser claimed
 * these empty values "survive to the per-flag checks, which refuse them loudly"; exactly one
 * flag had such a check. This module makes the claim true for all of them.
 *
 * Three further conventions, each chosen for the same reason:
 *
 *   - `--flag=value` is accepted, because people type it and being told "unknown option
 *     --index=humaneval" for a spelling of the right flag is a bad way to learn a tool.
 *   - a repeated flag is an error rather than last-one-wins. Someone writing
 *     `--corpus a.jsonl --corpus b.jsonl` means to scan both; silently scanning only the
 *     second is a wrong answer that looks like a right one.
 *   - an unrecognised flag close to a real one is named in the error, because the point of
 *     refusing is to get the user to the working command, not to be correct at them.
 */

export type FlagKind = 'value' | 'boolean';
export type FlagSpec = Record<string, FlagKind>;

export type ParsedArgs = {
  positional: string[];
  flags: Map<string, string>;
  /** Empty when the invocation is usable. Never partially applied: the caller refuses first. */
  errors: string[];
};

/** Levenshtein, bounded by the short strings involved. Only used to write a better error. */
function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/**
 * The closest known flag, when one is close enough to be worth naming.
 *
 * The threshold scales with length so that short names do not attract every typo:
 * `--out` should not suggest `--json`, but `--maxdocfreq` should certainly suggest
 * `--max-doc-freq`, which is four edits away.
 */
export function suggestFlag(name: string, known: string[]): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of known) {
    const d = editDistance(name, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  if (best === null) return null;
  const budget = Math.max(2, Math.floor(Math.max(name.length, best.length) / 3));
  return bestDistance <= budget ? best : null;
}

/**
 * Parses argv against a spec of the flags a subcommand actually has.
 *
 * Errors are collected rather than thrown so that a single run can report every problem
 * with an invocation at once. Someone who mistyped two flags should learn both on the first
 * attempt.
 */
export function parseArgs(argv: string[], spec: FlagSpec): ParsedArgs {
  const known = Object.keys(spec);
  const flags = new Map<string, string>();
  const positional: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    // `--` alone is the conventional end-of-flags marker: everything after it is a value,
    // even if it looks like a flag.
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }

    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const name = eq === -1 ? body : body.slice(0, eq);
    const inlineValue = eq === -1 ? null : body.slice(eq + 1);

    const kind = spec[name];
    if (kind === undefined) {
      const near = suggestFlag(name, known);
      errors.push(`unknown option --${name}${near === null ? '' : ` — did you mean --${near}?`}`);
      // Consume a value-looking token so one unknown flag does not also produce a
      // confusing "unexpected argument" for its own value.
      if (inlineValue === null && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) i++;
      continue;
    }

    if (seen.has(name)) {
      errors.push(`--${name} was given more than once; Ingot will not guess which one you meant`);
    }
    seen.add(name);

    if (kind === 'boolean') {
      if (inlineValue !== null) errors.push(`--${name} takes no value, got "${inlineValue}"`);
      flags.set(name, 'true');
      continue;
    }

    let value: string;
    if (inlineValue !== null) {
      value = inlineValue;
    } else {
      const next = argv[i + 1];
      // A missing value must NOT eat the next flag. `--out --quiet` means someone forgot
      // the path, not that the report should be written to a file called "--quiet".
      if (next === undefined || next.startsWith('--')) value = '';
      else value = argv[++i];
    }

    if (value === '') {
      errors.push(`--${name} needs a value`);
      continue;
    }
    flags.set(name, value);
  }

  return { positional, flags, errors };
}

/** Renders collected errors as the block the CLI prints before exiting 2. */
export function formatArgErrors(errors: string[]): string {
  return `\n${errors.map((e) => `  ${e}`).join('\n')}\n\n  Nothing was scanned. Run "ingot help" for the full list of options.\n\n`;
}
