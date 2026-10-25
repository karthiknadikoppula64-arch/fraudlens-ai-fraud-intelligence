import { useMemo } from 'react';
import { useChrono } from './ChronoContext';
import { computeDriftAnalysis, type DriftAnalysis, type DriftPopulation } from '../utils/driftWindows';

/** Drift analysis for the active dataset + model, built from the per-transaction attributions. */
export function useDriftAnalysis(population: DriftPopulation, confidence: 0.95 | 0.99): DriftAnalysis | null {
  const { transactions, bundle } = useChrono();
  const groups = bundle?.featureSpace.groupNames;
  const attributions = useMemo(() => {
    if (!groups) return null;
    return transactions.map((t) => {
      const v = new Float64Array(groups.length);
      for (const item of t.shapBreakdown) {
        const gi = groups.indexOf(item.feature);
        if (gi >= 0) v[gi] = item.shapValue;
      }
      return v;
    });
    // shapBreakdown only changes when the model / dataset changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, transactions.length, transactions[0]?.shapBreakdown, groups]);

  return useMemo(() => {
    if (!groups || !attributions || attributions.length !== transactions.length) return null;
    return computeDriftAnalysis(transactions, attributions, groups, population, confidence);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attributions, groups, population, confidence]);
}
