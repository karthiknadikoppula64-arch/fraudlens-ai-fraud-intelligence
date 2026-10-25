import type { Transaction } from './fraud';

export type DatasetSourceType = 'sample' | 'custom_csv';

export interface SplitSummary {
  trainCount: number;
  trainFrauds: number;
  trainDateRange: string;
  valCount: number;
  valFrauds: number;
  valDateRange: string;
  testCount: number;
  testFrauds: number;
  testDateRange: string;
}

export interface ChronologicalSplits {
  train: Transaction[];       // first ~60% by time
  validation: Transaction[];  // next ~20% by time
  test: Transaction[];        // final ~20% by time
  splitSummary: SplitSummary;
}

export const EMPTY_SPLIT_SUMMARY: SplitSummary = {
  trainCount: 0,
  trainFrauds: 0,
  trainDateRange: 'N/A',
  valCount: 0,
  valFrauds: 0,
  valDateRange: 'N/A',
  testCount: 0,
  testFrauds: 0,
  testDateRange: 'N/A',
};
