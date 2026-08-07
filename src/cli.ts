#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { formatArgErrors, parseArgs } from './args.ts';
import { loadBatch } from './loader.ts';
import { runSignals } from './signals/index.ts';
import { scoreBatch } from './scorer.ts';
import { renderReport } from './report.ts';
import {
  BaselineMissingError,
  CorpusStreamError,
  IndexMissingError,
  IndexUnreadableError,
  IngotError,
  ReportWriteError,
} from './errors.ts';
import type { FlagSpec } from './args.ts';
import { SCANNER_VERSION } from './types.ts';
import { NgramIndex } from './contamination/ngramIndex.ts';
import { loadIndexFromBytes } from './contamination/browserScan.ts';
import { scanCorpus } from './contamination/scan.ts';
import { renderContaminationReport } from './contamination/reportHtml.ts';
import { CONTAMINATION_CLAIM_SCOPE } from './contamination/types.ts';
import type { ContaminationReport } from './contamination/types.ts';
import type { BaselinePair, ScanReport } from './types.ts';

const USAGE = `${SCANNER_VERSION}
Independent verification of the AI training data supply chain.

  ingot contaminate --index <benchmark|path> --corpus <corpus.jsonl> [options]
      Is a benchmark inside this training corpus? Every match is printed with the
      text around it, because a match you cannot read is not evidence.

  ingot scan <batch.jsonl> [options]
      EXPERIMENTAL. Was this batch written by a human or generated? Batch-level,
      against named reference corpora. Its measured floor is 50% contamination at
      a 13% false-positive rate — read docs/measurements.md before trusting it.

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
  --quiet                suppress the terminal summary

scan options (experimental)
  --baselines <path>     reference distributions   (default data/baselines.json)
  --text-field <name>    field holding the response text
  --author-field <name>  field holding the annotator id
  --id-field <name>      field holding the record id
  --out <path>           html report path          (default reports/<batch>.html)
  --json <path>          machine-readable report
  --quiet                suppress the terminal summary

  ingot --version        print the scanner version and exit

Ingot runs entirely on this machine. No network calls, no data retention.
`;

/**
 * The flags each subcommand has. Anything else is refused rather than ignored — see args.ts
 * for why an ignored flag is the worst failure mode this tool can have.
 */
const CONTAMINATE_FLAGS: FlagSpec = {
  index: 'value',
  corpus: 'value',
  bench: 'value',
  'text-field': 'value',
  'id-field': 'value',
  'max-doc-freq': 'value',
  out: 'value',
  json: 'value',
  quiet: 'boolean',
};

const SCAN_FLAGS: FlagSpec = {
  baselines: 'value',
  'text-field': 'value',
  'author-field': 'value',
  'id-field': 'value',
  out: 'value',
  json: 'value',
  quiet: 'boolean',
};

/**
 * Writes an artifact, naming the path when the write fails.
 *
 * A scan that completes and then dies on `mkdir EEXIST` because the parent of --out is a
 * regular file used to print a Node stack trace, having thrown away several minutes of
 * work. The failure is the same; what the user is told about it is not.
 */
function writeArtifact(path: string, contents: string): string {
  const full = resolve(path);
  try {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  } catch (err) {
    throw new ReportWriteError(full, err instanceof Error ? err.message : String(err));
  }
  return full;
}

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
  const { positional, flags, errors } = parseArgs(argv, SCAN_FLAGS);
  if (errors.length > 0) {
    process.stderr.write(formatArgErrors(errors));
    return 2;
  }
  if (positional.length > 1) {
    process.stderr.write(
      formatArgErrors([`scan takes one batch file, got ${positional.length}: ${positional.join(', ')}`]),
    );
    return 2;
  }
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

  const outPath = writeArtifact(
    flags.get('out') ?? `reports/${basename(batchPath).replace(/\.jsonl?$/i, '')}.html`,
    wrapDocument(renderReport(report)),
  );

  const jsonPath = flags.get('json');
  if (jsonPath) writeArtifact(jsonPath, JSON.stringify(report, null, 2));

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
  // A directory that happens to share a benchmark's name used to reach readFileSync and
  // exit on a raw EISDIR stack. An index is a file; anything else is not one.
  if (existsSync(value)) {
    if (statSync(value).isDirectory()) {
      throw new IndexUnreadableError(value, 'it is a directory, not an index file');
    }
    return value;
  }

  const bundled = resolve(BUNDLED_INDEX_DIR, `${value}.idx.bin.gz`);
  if (existsSync(bundled)) return bundled;

  const available = existsSync(BUNDLED_INDEX_DIR)
    ? readdirSync(BUNDLED_INDEX_DIR)
        .filter((f) => f.endsWith('.idx.bin.gz'))
        .map((f) => f.replace(/\.idx\.bin\.gz$/, ''))
    : [];
  throw new IndexMissingError(value, available);
}

/**
 * Reads an index, turning every way that can fail into a sentence.
 *
 * A truncated .gz reached this as a bare `TypeError` carrying no message at all — thrown
 * from inside Node's webstreams adapter, eight frames deep, with nothing naming the file or
 * the problem. A partial download is the single likeliest thing to go wrong with a 5 MB
 * artifact fetched over a flaky connection, so it is the last failure that should be
 * undiagnosable. Errors that already know how to describe themselves pass through untouched.
 */
async function loadIndexFile(path: string): Promise<NgramIndex> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    throw new IndexUnreadableError(path, err instanceof Error ? err.message : String(err));
  }

  // Whether the bytes even claim to be what they are named tells us which failure to
  // describe. A gzip member that starts correctly and then fails to inflate is a cut-short
  // download; that is by far the likeliest thing to go wrong with a 5 MB artifact, and it
  // used to surface as a TypeError carrying no message at all.
  const looksGzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

  try {
    // The binary form is what ships; JSON stays supported because it is the specification
    // and because someone will inevitably hand-build one.
    if (path.endsWith('.json')) return NgramIndex.load(JSON.parse(bytes.toString('utf8')));
    return await loadIndexFromBytes(bytes);
  } catch (err) {
    // Re-issued around the real path: the codec runs in the browser too and cannot know
    // what the file was called, so it names the reason and leaves the subject to us.
    if (err instanceof IndexUnreadableError) throw new IndexUnreadableError(path, err.detail);
    // Errors that already describe themselves completely — a truncated body, a version
    // mismatch — pass through rather than being wrapped in a second sentence.
    if (err instanceof IngotError) throw err;
    throw new IndexUnreadableError(
      path,
      err instanceof Error && err.message
        ? err.message
        : looksGzipped
          ? `the gzip data is corrupt or the download was cut short — ${bytes.length.toLocaleString('en-US')} bytes were read`
          : 'the bytes could not be decoded',
    );
  }
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
    // Called out on its own line because it is the one case where "not checked" is a fact
    // about Ingot rather than about the text. See reportHtml.
    const unsegmented = report.unsegmentedItemIds?.length ?? 0;
    if (unsegmented > 0) {
      lines.push(
        `    ${unsegmented} of those are written in a script this scanner cannot split into`,
      );
      lines.push('    words (Chinese, Japanese, Thai and the other unspaced scripts). For those,');
      lines.push('    a clean result means we could not look, not that we looked and found nothing.');
    }
  }
  if (exact.droppedGeneric) {
    lines.push(`    ${exact.droppedGeneric} match(es) dropped as ordinary language by corpus frequency`);
  }
  if (report.load && report.load.skipped > 0) {
    lines.push(
      `    ${report.load.skipped.toLocaleString()} of ${report.load.totalLines.toLocaleString()} line(s)` +
        ` skipped as unreadable — reported rather than silently dropped`,
    );
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
  // Named for what it is: SHA-256 over the trimmed non-empty lines joined by \n — a
  // canonicalized-line digest, not the digest of the file's raw bytes. `sha256sum` on the
  // file will not reproduce it; re-running the scanner will.
  if (r.corpusHashFull) lines.push(`    corpus digest  ${r.corpusHashFull}  (sha-256, trimmed lines \\n-joined)`);
  lines.push(`    generated      ${r.generatedAt}`);
  lines.push(`    command        ${r.command}`);
  lines.push('');
  lines.push(`  ${CONTAMINATION_CLAIM_SCOPE}`);
  lines.push('');
  return lines.join('\n');
}

export async function runContaminate(argv: string[]): Promise<number> {
  const { positional, flags, errors } = parseArgs(argv, CONTAMINATE_FLAGS);
  if (positional.length > 0) {
    errors.push(
      `contaminate takes no positional arguments, got ${positional.map((p) => `"${p}"`).join(', ')}` +
        ` — the corpus goes after --corpus`,
    );
  }
  if (errors.length > 0) {
    process.stderr.write(formatArgErrors(errors));
    return 2;
  }

  const indexArg = flags.get('index');
  const corpusPath = flags.get('corpus');

  if (!indexArg || !corpusPath) {
    process.stdout.write(USAGE);
    return 2;
  }

  // Flags are validated before any file is touched, so a malformed invocation gets usage
  // and exit 2 — never a scan configured by accident. The threshold must be a positive
  // integer: 0 would drop every match as ordinary language and print a manufactured
  // green verdict, the exact silent failure this tool exists to refuse.
  const maxDocFreq = flags.has('max-doc-freq') ? Number(flags.get('max-doc-freq')) : undefined;
  if (maxDocFreq !== undefined && (!Number.isInteger(maxDocFreq) || maxDocFreq < 1)) {
    process.stderr.write(`--max-doc-freq must be a positive integer, got "${flags.get('max-doc-freq')}"\n`);
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

  // Zero readable documents is a refusal, never a clean result — the same contract the
  // browser enforces. This is the path that feeds the published registry, so exiting 0
  // here with "0 of N items appear" would be the exact silent failure the report
  // documents. Refuse loudly and exit non-zero.
  if (report.corpusDocs === 0) {
    const load = report.load ?? { totalLines: 0, skipped: 0 };
    process.stderr.write(
      `\n  REFUSED — this corpus was not scanned.\n` +
        (load.totalLines === 0
          ? `  The file is empty: no lines to read.\n`
          : `  None of its ${load.totalLines.toLocaleString()} line(s) could be read as a JSONL record` +
            ` (one {"text": …} object per line); ${load.skipped.toLocaleString()} were skipped.\n`) +
        `  Nothing was checked, so this is not a clean result.\n\n`,
    );
    process.exit(2);
  }

  const jsonPath = flags.get('json');
  if (jsonPath) writeArtifact(jsonPath, JSON.stringify(report, null, 2));

  const htmlPath = flags.get('out');
  if (htmlPath) writeArtifact(htmlPath, renderContaminationReport(report));

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
  // The subcommand is the first token, not the first token that happens not to be a flag.
  // Scanning argv for it meant `--corpus contaminate` could nominate a flag's own value as
  // the command, and the old `indexOf(command)` slice then cut argv in the wrong place.
  const command = argv[0] ?? '';

  if (command === '' || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${SCANNER_VERSION}\n`);
    process.exit(0);
  }

  try {
    if (command === 'scan') process.exit(runScan(argv.slice(1)));
    if (command === 'contaminate') process.exit(await runContaminate(argv.slice(1)));
    process.stderr.write(`unknown command "${command}"\n\n${USAGE}`);
    process.exit(2);
  } catch (err) {
    if (err instanceof IngotError) {
      process.stderr.write(`\n  ${err.name}: ${err.userMessage}\n\n`);
      process.exit(1);
    }
    // Anything reaching here is a bug in Ingot rather than a problem with the invocation,
    // and it must read as one. A bare stack trace invites the user to believe they held it
    // wrong; the trace is still printed, because a bug report without one is unactionable.
    process.stderr.write(
      `\n  Ingot hit an internal error and stopped. This is a bug in ${SCANNER_VERSION}, not\n` +
        `  a problem with your command. Please report it with the trace below:\n` +
        `  https://github.com/vaishak-v-nair/Ingot/issues\n\n`,
    );
    throw err;
  }
}

if (import.meta.filename === process.argv[1]) await main();
