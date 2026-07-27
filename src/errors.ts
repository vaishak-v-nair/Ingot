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
