import { nearDupSignal } from './nearDup.ts';
import { lexicalClusterSignal } from './lexicalCluster.ts';
import { stylometrySignal } from './stylometry.ts';
import { templateSignal } from './template.ts';
import { lengthShapeSignal, lexicalVarietySignal } from './lengthShape.ts';
import { DegenerateBatchError, ScoreComputationError } from '../errors.ts';
import type { DataRecord, SignalResult } from '../types.ts';

export const SIGNAL_ORDER = [
  'near_dup',
  'lexical_cluster',
  'stylometry',
  'template',
  'length_shape',
  'lexical_variety',
];

export function runSignals(records: DataRecord[]): SignalResult[] {
  const distinct = new Set(records.map((r) => r.text)).size;
  if (distinct < 2) {
    throw new DegenerateBatchError(`all ${records.length} records share ${distinct} distinct text value(s)`);
  }

  const results = [
    nearDupSignal(records),
    lexicalClusterSignal(records),
    stylometrySignal(records),
    templateSignal(records),
    lengthShapeSignal(records),
    lexicalVarietySignal(records),
  ];

  for (const r of results) {
    if (r.available && (r.value === null || !Number.isFinite(r.value))) {
      throw new ScoreComputationError(r.key, `a non-finite value (${r.value})`);
    }
  }

  return results;
}
