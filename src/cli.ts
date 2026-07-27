import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { loadBatch } from './loader.ts';
import { runSignals } from './signals/index.ts';
import { scoreBatch } from './scorer.ts';
import { renderReport } from './report.ts';
import { BaselineMissingError, IngotError } from './errors.ts';
import { SCANNER_VERSION } from './types.ts';
import type { BaselinePair, ScanReport } from './types.ts';

const USAGE = `ingot ${SCANNER_VERSION}
Independent verification of the AI training data supply chain.

  node src/cli.ts scan <batch.jsonl> [options]

Options
  --baselines <path>     reference distributions   (default data/baselines.json)
  --text-field <name>    field holding the response text
  --author-field <name>  field holding the annotator id
  --id-field <name>      field holding the record id
  --out <path>           html report path          (default reports/<batch>.html)
  --json <path>          machine-readable report
  --quiet                suppress the terminal summary

Ingot runs entirely on this machine. No network calls, no data retention.
`;

export function loadBaselines(path: string): BaselinePair {
  if (!existsSync(path)) throw new BaselineMissingError(path);
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as BaselinePair;
  if (!parsed.human?.signals || !parsed.machine?.signals) throw new BaselineMissingError(path);
  return parsed;
}

export function wrapDocument(bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${bodyHtml.slice(0, bodyHtml.indexOf('<div class="wrap">'))}
</head>
<body>
${bodyHtml.slice(bodyHtml.indexOf('<div class="wrap">'))}
</body>
</html>`;
}

function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'quiet') flags.set(key, 'true');
      else flags.set(key, argv[++i] ?? '');
    } else positional.push(a);
  }
  return { positional, flags };
}

function terminalSummary(report: ScanReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`  INGOT PURITY REPORT — ${report.batchName}`);
  lines.push(`  ${'─'.repeat(58)}`);
  lines.push(
    `  purity ${report.purity === null ? 'NO SCORE' : `${report.purity}/100`}   ` +
      `confidence ${report.confidence}   records ${report.records.toLocaleString()}`,
  );
  lines.push(`  ${report.verdict}`);
  lines.push('');
  for (const s of report.signals) {
    const val = s.value === null ? '—' : s.value.toFixed(4);
    const z = s.zVsHuman === null ? '' : ` (${s.zVsHuman > 0 ? '+' : ''}${s.zVsHuman.toFixed(2)}σ vs human)`;
    const state = s.usedInScore ? 'compared' : s.available ? 'not compared' : 'unavailable';
    lines.push(`  ${s.label.padEnd(30)} ${val.padStart(9)}${z}`);
    if (state !== 'compared') lines.push(`    ${state}: ${s.skipReason ?? s.reason ?? ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function runScan(argv: string[]): number {
  const { positional, flags } = parseArgs(argv);
  const batchPath = positional[0];
  if (!batchPath) {
    process.stdout.write(USAGE);
    return 2;
  }

  const pair = loadBaselines(resolve(flags.get('baselines') ?? 'data/baselines.json'));
  const load = loadBatch(batchPath, {
    textField: flags.get('text-field'),
    authorField: flags.get('author-field'),
    idField: flags.get('id-field'),
  });

  const signals = runSignals(load.records);
  const report = scoreBatch(basename(batchPath), load.records, signals, pair, load);

  const outPath = resolve(flags.get('out') ?? `reports/${basename(batchPath).replace(/\.jsonl?$/i, '')}.html`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, wrapDocument(renderReport(report)), 'utf8');

  const jsonPath = flags.get('json');
  if (jsonPath) {
    mkdirSync(dirname(resolve(jsonPath)), { recursive: true });
    writeFileSync(resolve(jsonPath), JSON.stringify(report, null, 2), 'utf8');
  }

  if (!flags.has('quiet')) {
    process.stdout.write(terminalSummary(report));
    if (load.skipped.length > 0) {
      process.stdout.write(`  ${load.skipped.length} line(s) skipped, first few:\n`);
      for (const s of load.skipped.slice(0, 5)) process.stdout.write(`    line ${s.line}: ${s.reason}\n`);
      process.stdout.write('\n');
    }
    process.stdout.write(`  report: ${outPath}\n\n`);
  }
  return 0;
}

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv.find((a) => !a.startsWith('--')) ?? '';

  if (!command || command === 'help') {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  try {
    if (command === 'scan') {
      process.exit(runScan(argv.slice(argv.indexOf('scan') + 1)));
    }
    process.stderr.write(`unknown command "${command}"\n\n${USAGE}`);
    process.exit(2);
  } catch (err) {
    if (err instanceof IngotError) {
      process.stderr.write(`\n  ${err.name}: ${err.userMessage}\n\n`);
      process.exit(1);
    }
    throw err;
  }
}

if (import.meta.filename === process.argv[1]) main();
