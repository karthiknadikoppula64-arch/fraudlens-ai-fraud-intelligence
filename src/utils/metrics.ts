/**
 * Classification + cost metrics for fraud models. Only LABELLED rows are ever passed in.
 */

export interface ScoredLabelledRow {
  probability: number;
  label: 0 | 1;
  amount: number;
}

export interface BinaryMetrics {
  threshold: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  mcc: number;
  prAuc: number; // average precision
  rocAuc: number;
  totalCost: number;
  /** Cost with no model (every fraud is lost: amount + penalty). */
  baselineCost: number;
  /** baselineCost - totalCost (can be negative). */
  dollarsSaved: number;
  n: number;
  frauds: number;
}

/** Average precision (area under the precision–recall step curve). */
export function averagePrecision(rows: { probability: number; label: 0 | 1 }[]): number {
  const pos = rows.reduce((s, r) => s + r.label, 0);
  if (pos === 0) return 0;
  const sorted = [...rows].sort((a, b) => b.probability - a.probability);
  let tp = 0;
  let fp = 0;
  let ap = 0;
  let i = 0;
  while (i < sorted.length) {
    // handle ties as a block
    let j = i;
    let blockTp = 0;
    let blockFp = 0;
    while (j < sorted.length && sorted[j].probability === sorted[i].probability) {
      if (sorted[j].label === 1) blockTp++;
      else blockFp++;
      j++;
    }
    tp += blockTp;
    fp += blockFp;
    if (blockTp > 0) ap += (blockTp / pos) * (tp / (tp + fp));
    i = j;
  }
  return ap;
}

/** ROC-AUC via the Mann–Whitney U statistic with average ranks for ties. */
export function rocAuc(rows: { probability: number; label: 0 | 1 }[]): number {
  const sorted = [...rows].sort((a, b) => a.probability - b.probability);
  let nPos = 0;
  let sumRanks = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].probability === sorted[i].probability) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (sorted[k].label === 1) { nPos++; sumRanks += avgRank; }
    i = j;
  }
  const nNeg = sorted.length - nPos;
  if (nPos === 0 || nNeg === 0) return 0.5;
  return (sumRanks - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

/**
 * Cost model (USD): every alert costs `costReview` to investigate; every missed fraud loses its
 * amount plus `fnPenalty`. A no-model baseline loses every fraud.
 */
export function computeBinaryMetrics(rows: ScoredLabelledRow[], threshold: number, costReview: number, fnPenalty: number): BinaryMetrics {
  let tp = 0, fp = 0, tn = 0, fn = 0, cost = 0, baseline = 0;
  for (const r of rows) {
    const alert = r.probability >= threshold;
    if (r.label === 1) baseline += r.amount + fnPenalty;
    if (alert) {
      cost += costReview;
      if (r.label === 1) tp++;
      else fp++;
    } else if (r.label === 1) {
      fn++;
      cost += r.amount + fnPenalty;
    } else tn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const den = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
  const mcc = den > 0 ? (tp * tn - fp * fn) / den : 0;
  return {
    threshold,
    tp, fp, tn, fn,
    precision, recall, f1, mcc,
    prAuc: averagePrecision(rows),
    rocAuc: rocAuc(rows),
    totalCost: Math.round(cost * 100) / 100,
    baselineCost: Math.round(baseline * 100) / 100,
    dollarsSaved: Math.round((baseline - cost) * 100) / 100,
    n: rows.length,
    frauds: tp + fn,
  };
}

/** Finds the cost-minimising threshold on a (validation) cohort. Ties -> higher threshold (fewer alerts). */
export function tuneThresholdByCost(rows: ScoredLabelledRow[], costReview: number, fnPenalty: number, step = 0.01): { threshold: number; cost: number } {
  let best = { threshold: 0.5, cost: Infinity };
  for (let t = step; t < 1 - 1e-9; t += step) {
    const th = Math.round(t * 1000) / 1000;
    const m = computeBinaryMetrics(rows, th, costReview, fnPenalty);
    if (m.totalCost <= best.cost) best = { threshold: th, cost: m.totalCost };
  }
  return best;
}
