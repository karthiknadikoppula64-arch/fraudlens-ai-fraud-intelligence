/**
 * Builds confidence-bounded explanation-drift windows from the active dataset and model.
 * Statistic per window and feature group: mean |attribution| with a normal-approximation CI.
 * Reference (baseline) = all rows of the TRAIN split in the chosen population.
 */
import type { DriftTimeWindow, Transaction } from '../types/fraud.ts';
import { calculateShapConfidenceInterval, evaluateExplanationDrift } from './shapDrift.ts';

export type DriftPopulation = 'Confirmed Frauds' | 'Full Stream';

export interface DriftAnalysis {
  windows: DriftTimeWindow[];
  groups: string[];
  baseline: Record<string, { mean: number; stdError: number; n: number }>;
  granularity: 'month' | 'equal-time';
  /** Share of (post-reference window × feature) tests that stayed within expected variation. */
  stabilityPct: number | null;
  testsRun: number;
  driftCount: number;
}

export function computeDriftAnalysis(
  transactions: Transaction[],
  attributions: Float64Array[],
  groups: string[],
  population: DriftPopulation,
  confidence: 0.95 | 0.99 = 0.95
): DriftAnalysis {
  const z = confidence === 0.99 ? 2.576 : 1.96;
  const inPop = (t: Transaction) => (population === 'Confirmed Frauds' ? t.groundTruthLabel === 1 : true);

  // Baseline from train split
  const baseline: DriftAnalysis['baseline'] = {};
  const trainIdx = transactions.map((t, i) => (t.split === 'train' && inPop(t) ? i : -1)).filter((i) => i >= 0);
  groups.forEach((g, gi) => {
    const ci = calculateShapConfidenceInterval(trainIdx.map((i) => Math.abs(attributions[i][gi])), confidence);
    baseline[g] = { mean: ci.mean, stdError: ci.stdError, n: ci.sampleSize };
  });

  if (transactions.length === 0) {
    return { windows: [], groups, baseline, granularity: 'equal-time', stabilityPct: null, testsRun: 0, driftCount: 0 };
  }
  const tMin = Date.parse(transactions[0].timestamp);
  const tMax = Date.parse(transactions[transactions.length - 1].timestamp);
  const spanDays = (tMax - tMin) / 86400000;
  const firstNonTrain = transactions.find((t) => t.split !== 'train');
  const refEnd = firstNonTrain ? Date.parse(firstNonTrain.timestamp) : tMax + 1;

  // Window boundaries
  const bounds: { start: number; end: number }[] = [];
  let granularity: DriftAnalysis['granularity'];
  if (spanDays >= 300) {
    granularity = 'month';
    const d0 = new Date(tMin);
    let y = d0.getUTCFullYear();
    let m = d0.getUTCMonth();
    while (Date.UTC(y, m, 1) <= tMax) {
      bounds.push({ start: Date.UTC(y, m, 1), end: Date.UTC(y, m + 1, 1) });
      m++;
      if (m > 11) { m = 0; y++; }
    }
  } else {
    granularity = 'equal-time';
    const k = 12;
    const width = Math.max(1, (tMax - tMin + 1) / k);
    for (let i = 0; i < k; i++) bounds.push({ start: tMin + i * width, end: i === k - 1 ? tMax + 1 : tMin + (i + 1) * width });
  }

  let testsRun = 0;
  let driftCount = 0;
  const windows: DriftTimeWindow[] = [];
  let cursor = 0;
  bounds.forEach((b, wi) => {
    const rows: number[] = [];
    while (cursor < transactions.length && Date.parse(transactions[cursor].timestamp) < b.end) {
      rows.push(cursor);
      cursor++;
    }
    if (rows.length === 0) return;
    const popRows = rows.filter((i) => inPop(transactions[i]));
    const isReference = b.end <= refEnd;
    const featureMeans: DriftTimeWindow['featureMeans'] = {};
    groups.forEach((g, gi) => {
      const ci = calculateShapConfidenceInterval(popRows.map((i) => Math.abs(attributions[i][gi])), confidence);
      const ev = evaluateExplanationDrift(baseline[g].mean, baseline[g].stdError, ci, z);
      const hasDrifted = !isReference && ev.hasDrifted;
      if (!isReference && ci.sampleSize >= 5) {
        testsRun++;
        if (hasDrifted) driftCount++;
      }
      featureMeans[g] = {
        meanShap: ci.mean,
        ciLower: ci.ciLower,
        ciUpper: ci.ciUpper,
        baselineMean: baseline[g].mean,
        hasDrifted,
        pValue: ev.pValue,
        zScore: ev.zScore,
      };
    });
    const start = new Date(b.start).toISOString().slice(0, 10);
    const end = new Date(Math.min(b.end - 1, tMax)).toISOString().slice(0, 10);
    const id = `${granularity === 'month' ? 'M' : 'W'}${String(wi + 1).padStart(2, '0')}`;
    windows.push({
      windowId: id,
      windowLabel: `${id}${isReference ? ' (reference)' : ''}`,
      startDate: start,
      endDate: end,
      totalTransactions: rows.length,
      confirmedFrauds: rows.filter((i) => transactions[i].groundTruthLabel === 1).length,
      sampleSize: popRows.length,
      isReference,
      featureMeans,
    });
  });

  return {
    windows,
    groups,
    baseline,
    granularity,
    stabilityPct: testsRun > 0 ? Math.round(((testsRun - driftCount) / testsRun) * 1000) / 10 : null,
    testsRun,
    driftCount,
  };
}
