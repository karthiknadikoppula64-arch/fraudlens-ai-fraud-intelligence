/**
 * Chronological (time-ordered, non-shuffled) train / validation / test partitioning.
 */
import type { SplitName } from '../types/fraud.ts';

export interface TimedRow {
  id: string;
  timestamp: string;
}

export interface ChronoSplitResult<T> {
  train: T[];
  validation: T[];
  test: T[];
}

export const DEFAULT_SPLIT_RATIOS: [number, number, number] = [0.6, 0.2, 0.2];

/** Stable time sort (ties broken by id) – returns a new array. */
export function sortByTimestamp<T extends TimedRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const d = Date.parse(a.timestamp) - Date.parse(b.timestamp);
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Sorts by timestamp, then cuts contiguous blocks: the first `ratios[0]` share of rows is train,
 * the next `ratios[1]` is validation, the rest is test. Every validation row is at or after every
 * train row, and every test row is at or after every validation row (no look-ahead).
 */
export function chronologicalSplit<T extends TimedRow>(
  rows: T[],
  ratios: [number, number, number] = DEFAULT_SPLIT_RATIOS
): ChronoSplitResult<T> {
  const total = ratios[0] + ratios[1] + ratios[2];
  if (!(total > 0) || ratios.some((r) => r < 0)) throw new Error('Invalid split ratios');
  const sorted = sortByTimestamp(rows);
  const n = sorted.length;
  const trainEnd = Math.floor((n * ratios[0]) / total);
  const valEnd = Math.floor((n * (ratios[0] + ratios[1])) / total);
  return {
    train: sorted.slice(0, trainEnd),
    validation: sorted.slice(trainEnd, valEnd),
    test: sorted.slice(valEnd),
  };
}

/** Returns true if the three blocks are strictly time-ordered (max(train) <= min(val) <= ... ). */
export function isChronologicallyOrdered<T extends TimedRow>(split: ChronoSplitResult<T>): boolean {
  const t = (r: T) => Date.parse(r.timestamp);
  const maxOf = (xs: T[]) => xs.reduce((m, r) => Math.max(m, t(r)), -Infinity);
  const minOf = (xs: T[]) => xs.reduce((m, r) => Math.min(m, t(r)), Infinity);
  return maxOf(split.train) <= minOf(split.validation) && maxOf(split.validation) <= minOf(split.test);
}

export function formatDateRange(rows: { timestamp: string }[]): string {
  if (rows.length === 0) return 'N/A';
  return `${rows[0].timestamp.slice(0, 10)} to ${rows[rows.length - 1].timestamp.slice(0, 10)}`;
}

export function splitOf(index: number, n: number, ratios: [number, number, number] = DEFAULT_SPLIT_RATIOS): SplitName {
  const total = ratios[0] + ratios[1] + ratios[2];
  if (index < Math.floor((n * ratios[0]) / total)) return 'train';
  if (index < Math.floor((n * (ratios[0] + ratios[1])) / total)) return 'validation';
  return 'test';
}
