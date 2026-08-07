/**
 * Every failure Ingot can hit has a name and a message a buyer can act on.
 * Nothing is swallowed, and nothing degrades into a silent 0.0.
 */

export class IngotError extends Error {
  readonly userMessage: string;

  constructor(name: string, userMessage: string) {
    super(userMessage);
    this.name = name;
    this.userMessage = userMessage;
  }
}

export class BatchParseError extends IngotError {
  readonly line: number;

  constructor(line: number, reason: string) {
    super('BatchParseError', `line ${line}: ${reason}`);
    this.line = line;
  }
}

export class EmptyBatchError extends IngotError {
  constructor(path: string) {
    super('EmptyBatchError', `${path} contains no usable records`);
  }
}

export class SchemaMismatchError extends IngotError {
  constructor(field: string, seen: string[]) {
    super(
      'SchemaMismatchError',
      `no "${field}" field found. Fields present: ${seen.slice(0, 12).join(', ')}. ` +
        `Pass --text-field to point at the response column.`,
    );
  }
}

export class InsufficientBatchError extends IngotError {
  constructor(have: number, need: number) {
    super(
      'InsufficientBatchError',
      `batch has ${have} records, ${need} required for a batch-level statistic. ` +
        `Ingot does not score batches this small.`,
    );
  }
}

export class DegenerateBatchError extends IngotError {
  constructor(detail: string) {
    super('DegenerateBatchError', `batch has no usable variance: ${detail}`);
  }
}

export class BaselineMissingError extends IngotError {
  constructor(path: string) {
    super(
      'BaselineMissingError',
      `no reference baselines at ${path}. Ingot refuses to score against absolute ` +
        `thresholds. Run: npm run fetch && npm run baselines`,
    );
  }
}

export class ScoreComputationError extends IngotError {
  constructor(signalKey: string, detail: string) {
    super('ScoreComputationError', `signal "${signalKey}" produced ${detail}`);
  }
}

export class BenchmarkEmptyError extends IngotError {
  constructor(path: string) {
    super('BenchmarkEmptyError', `${path} yielded no benchmark items with usable text`);
  }
}

export class CorpusStreamError extends IngotError {
  constructor(path: string, detail: string) {
    super('CorpusStreamError', `could not stream ${path}: ${detail}`);
  }
}

export class IndexMissingError extends IngotError {
  constructor(path: string, available: string[] = []) {
    super(
      'IndexMissingError',
      `no index at ${path}` +
        (available.length > 0
          ? `. Bundled benchmarks: ${available.join(', ')} — pass one by name, e.g. --index ${available[0]}.`
          : `. Build one with "node scripts/build-web.ts", or point --index at a published .idx.bin.gz.`) +
        ` Ingot will not guess which benchmark you meant.`,
    );
  }
}

/**
 * The bytes at --index are not an index this build can read.
 *
 * Separate from IndexMissingError because "there is nothing there" and "there is something
 * there and it is not an index" send the user to different places. This used to escape as
 * a bare Error and print a Node stack trace over eight frames of module loader, which tells
 * a buyer nothing they can act on.
 */
export class IndexUnreadableError extends IngotError {
  /** Kept separately so a caller that knows the filename can re-issue this with the path. */
  readonly detail: string;

  constructor(path: string, detail: string) {
    super(
      'IndexUnreadableError',
      `${path} is not a readable Ingot index: ${detail}. Published indexes are the ` +
        `.idx.bin.gz files built by "node scripts/build-web.ts"; a partial download or an ` +
        `HTML error page saved under that name looks exactly like this.`,
    );
    this.detail = detail;
  }
}

/**
 * The report could not be written where it was asked to go.
 *
 * A scan that finished and then failed to save is the most expensive failure the tool has —
 * the work is done and the artifact is gone — so it gets its own name and says which path
 * refused.
 */
export class ReportWriteError extends IngotError {
  constructor(path: string, detail: string) {
    super('ReportWriteError', `could not write the report to ${path}: ${detail}`);
  }
}

export class IndexVersionError extends IngotError {
  constructor(found: number, expected: number) {
    super(
      'IndexVersionError',
      `index format version ${found}, this build expects ${expected}. Rebuild the index; ` +
        `comparing against a stale index silently produces a wrong answer.`,
    );
  }
}

export class IndexMismatchError extends IngotError {
  constructor(detail: string) {
    super('IndexMismatchError', detail);
  }
}

export class IndexTruncatedError extends IngotError {
  constructor(detail: string) {
    super(
      'IndexTruncatedError',
      `${detail}. A truncated index decodes into a smaller one that scans "clean" — ` +
        `refusing to load it is the only honest answer. Re-download or rebuild the index.`,
    );
  }
}

export class PartitionTooSmallError extends IngotError {
  constructor(partition: string, have: number, need: number) {
    super(
      'PartitionTooSmallError',
      `the ${partition} partition has ${have} items, ${need} required. ` +
        `Ingot does not report a score delta across a partition this small.`,
    );
  }
}
