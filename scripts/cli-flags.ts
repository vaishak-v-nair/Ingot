/**
 * The one flag parser. Eight scripts carried byte-identical private copies of this
 * function; a fix to any of them would have had to be made eight times. One module,
 * eight imports — the 2026-08-01 eng review's oldest small finding, finally landed.
 */
export function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
