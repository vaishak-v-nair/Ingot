#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { loadBatch } from './loader.ts';
import { runSignals } from './signals/index.ts';
import { scoreBatch } from './scorer.ts';
import { renderReport } from './report.ts';
import { BaselineMissingError, CorpusStreamError, IndexMissingError, IngotError } from './errors.ts';
import { SCANNER_VERSION } from './types.ts';
import { NgramIndex } from './contamination/ngramIndex.ts';
import { loadIndexFromBytes } from './contamination/browserScan.ts';
import { scanCorpus } from './contamination/scan.ts';
import { renderContaminationReport } from './contamination/reportHtml.ts';
import { CONTAMINATION_CLAIM_SCOPE } from './contamination/types.ts';
import type { ContaminationReport } from './contamination/types.ts';
import type { BaselinePair, ScanReport } from './types.ts';

const USAGE = `ingot ${SCANNER_VERSION}
Independent verification of the AI training data supply chain.

  ingot contaminate --index <benchmark|path> --corpus <corpus.jsonl> [options]
      Is a benchmark inside this training corpus? Every match is printed with the
      text around it, because a match you cannot read is not evidence.

  ingot scan <batch.jsonl> [options]
      Was this batch written by a human or generated? Batch-level, against named
      reference corpora.

contaminate options
  --index <name|path>    a bundled benchmark by name (humaneval, gsm8k), or a
                         path to any published .idx.bin.gz or .idx.json
  --corpus <path>        JSONL corpus to scan, any size — it streams
  --bench <path>         benchmark JSONL; enables the near-duplicate tier
  --text-field <name>    field holding the document text
  --id-field <name>      field holding the document id
  --max-doc-freq <n>     a matched gram in more than n corpus documents is
                         ordinary language, not evidence   (default 5)
  --out <path>           self-contained HTML report you can hand to a reviewer
  --json <path>          machine-readable report, including the receipt

scan options
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

/** Indexes shipped with the package, so `--index humaneval` works from a bare npx. */
const BUNDLED_INDEX_DIR = resolve(import.meta.dirname, '../web/indexes');

/**
 * Resolves --index as a file path, or as the name of a bundled benchmark.
 *
 * A stranger running this through npx has no idea where the package unpacked to, so
 * requiring a path into node_modules would make the one-command promise a lie.
 */
function resolveIndexPath(value: string): string {
  if (existsSync(value)) return value;

  const bundled = resolve(BUNDLED_INDEX_DIR, `${value}.idx.bin.gz`);
  if (existsSync(bundled)) return bundled;

  const available = existsSync(BUNDLED_INDEX_DIR)
    ? readdirSync(BUNDLED_INDEX_DIR)
        .filter((f) => f.endsWith('.idx.bin.gz'))
        .map((f) => f.replace(/\.idx\.bin\.gz$/, ''))
    : [];
  throw new IndexMissingError(value, available);
}

function loadIndexFile(path: string): Promise<NgramIndex> {
  const bytes = readFileSync(path);
  // The binary form is what ships; JSON stays supported because it is the specification
  // and because someone will inevitably hand-build one.
  if (path.endsWith('.json')) return Promise.resolve(NgramIndex.load(JSON.parse(bytes.toString('utf8'))));
  return loadIndexFromBytes(bytes);
}

function contaminationSummary(report: ContaminationReport, indexLabel: string): string {
  const exact = report.tiers.find((t) => t.tier === 'exact')!;
  const near = report.tiers.find((t) => t.tier === 'near')!;
  const r = report.receipt;
  const lines: string[] = [];

  lines.push('');
  lines.push(`  INGOT CONTAMINATION — ${r.benchmark} in ${r.corpus}`);
  lines.push(`  ${'─'.repeat(64)}`);
  lines.push(
    `  ${exact.itemsHit} of ${exact.itemsTotal.toLocaleString()} benchmark items appear in this corpus` +
      ` (${(exact.rate * 100).toFixed(2)}%)`,
  );
  lines.push(
    `  ${report.corpusDocs.toLocaleString()} documents · ${report.corpusTokens.toLocaleString()} tokens · ` +
      `${(report.elapsedMs / 1000).toFixed(1)}s`,
  );
  lines.push('');

  if (exact.hits.length > 0) {
    lines.push('  EVIDENCE — judge it yourself');
    for (const h of exact.hits.slice(0, 10)) {
      lines.push(`    ${h.benchmarkItemId} in ${h.corpusDocId}`);
      lines.push(`      …${h.contextBefore}[[${h.matchedText}]]${h.contextAfter}…`);
    }
    if (exact.totalHits > 10) lines.push(`    … ${exact.totalHits - 10} more, see --json`);
    lines.push('');
  }

  lines.push('  WHAT WAS NOT CHECKED');
  if (report.uncheckableItemIds.length === 0) {
    lines.push('    nothing: every benchmark item produced at least one n-gram');
  } else {
    lines.push(
      `    ${report.uncheckableItemIds.length} item(s) produced no n-gram at n=${report.n}, so nothing`,
    );
    lines.push('    could ever match them. They are named in the JSON report.');
  }
  if (exact.droppedGeneric) {
    lines.push(`    ${exact.droppedGeneric} match(es) dropped as ordinary language by corpus frequency`);
  }
  if (near.unavailableReason) lines.push(`    near-duplicate tier: ${near.unavailableReason}`);
  lines.push('');

  lines.push('  RECEIPT — everything needed to reproduce this');
  lines.push(`    scanner        ${r.scannerVersion}, index format ${r.indexFormatVersion}`);
  lines.push(`    index          ${indexLabel}`);
  lines.push(`                   ${r.benchmark} · n=${r.n} · stride ${r.stride} · ${r.indexGrams.toLocaleString()} grams`);
  lines.push(`    benchmark hash ${r.benchmarkHash}`);
  lines.push(`    corpus         ${r.corpus} · ${r.corpusBytes.toLocaleString()} bytes · ${r.corpusDocs.toLocaleString()} docs`);
  lines.push(`    corpus hash    ${r.corpusHash}  (sampled, matches the browser)`);
  if (r.corpusHashFull) lines.push(`    corpus sha256  ${r.corpusHashFull}`);
  lines.push(`    generated      ${r.generatedAt}`);
  lines.push(`    command        ${r.command}`);
  lines.push('');
  lines.push(`  ${CONTAMINATION_CLAIM_SCOPE}`);
  lines.push('');
  return lines.join('\n');
}

export async function runContaminate(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv);
  const indexArg = flags.get('index');
  const corpusPath = flags.get('corpus');

  if (!indexArg || !corpusPath) {
    process.stdout.write(USAGE);
    return 2;
  }
  const indexPath = resolveIndexPath(indexArg);
  if (!existsSync(corpusPath)) throw new CorpusStreamError(basename(corpusPath), 'file not found');

  const index = await loadIndexFile(indexPath);

  // Benchmark text is optional and stays optional: a published index carries hashes only,
  // and the near-duplicate tier needs the text. Absent, that tier reports why rather than
  // reporting zero.
  const benchPath = flags.get('bench');
  const benchmarkItems = benchPath
    ? loadBatch(benchPath).records.map((r) => ({ id: r.id, text: r.text }))
    : undefined;

  const maxDocFreq = flags.has('max-doc-freq') ? Number(flags.get('max-doc-freq')) : undefined;
  if (maxDocFreq !== undefined && !Number.isFinite(maxDocFreq)) {
    process.stderr.write(`--max-doc-freq must be a number\n`);
    return 2;
  }

  const command =
    `npx ingot-scan contaminate --index ${indexArg} --corpus ${corpusPath}` +
    (benchPath ? ` --bench ${benchPath}` : '') +
    (maxDocFreq !== undefined ? ` --max-doc-freq ${maxDocFreq}` : '');

  const report = await scanCorpus(index, corpusPath, {
    textField: flags.get('text-field'),
    idField: flags.get('id-field'),
    benchmarkItems,
    maxCorpusDocFrequency: maxDocFreq,
    command,
  });

  const jsonPath = flags.get('json');
  if (jsonPath) {
    mkdirSync(dirname(resolve(jsonPath)), { recursive: true });
    writeFileSync(resolve(jsonPath), JSON.stringify(report, null, 2), 'utf8');
  }

  const htmlPath = flags.get('out');
  if (htmlPath) {
    mkdirSync(dirname(resolve(htmlPath)), { recursive: true });
    writeFileSync(resolve(htmlPath), renderContaminationReport(report), 'utf8');
  }

  if (!flags.has('quiet')) {
    // The argument, not the resolved path: an absolute path into node_modules is noise in
    // a receipt whose whole job is to be re-typed by someone else.
    const label = indexPath === indexArg ? indexArg : `${indexArg} (bundled)`;
    process.stdout.write(contaminationSummary(report, label));
    if (htmlPath) process.stdout.write(`  report: ${resolve(htmlPath)}\n`);
    if (jsonPath) process.stdout.write(`  json:   ${resolve(jsonPath)}\n`);
    if (htmlPath || jsonPath) process.stdout.write('\n');
  }
  return 0;
}

export async function main(): Promise<void> {
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
    if (command === 'contaminate') {
      process.exit(await runContaminate(argv.slice(argv.indexOf('contaminate') + 1)));
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

if (import.meta.filename === process.argv[1]) await main();
