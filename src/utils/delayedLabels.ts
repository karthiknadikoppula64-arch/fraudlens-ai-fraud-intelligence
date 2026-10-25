/**
 * Delayed-label evaluation (simulation).
 *
 * Each labelled test transaction gets a SIMULATED dispute/settlement lag (7/14/30/60 days, derived
 * deterministically from its id – independent of the label). At horizon H, only labels whose lag
 * is <= H are known. "Apparent" metrics use the naive convention of treating not-yet-known labels as
 * legitimate, which is exactly the bias the protocol exposes. Predictions come from the trained model.
 */
import { averagePrecision } from './metrics.ts';

export interface DelayedRow {
  probability: number;
  label: 0 | 1;
  lagDays: number;
}

export interface DelayHorizon {
  days: number;
  dayLabel: string;
  confirmedFraud: number;
  confirmedLegit: number;
  unconfirmedLatent: number;
  apparentPrecision: number;
  apparentRecall: number;
  apparentPrAuc: number;
  /** Apparent confusion counts at τ (pending labels counted as legitimate). */
  apparentTp: number;
  apparentFp: number;
  apparentFn: number;
  /** Rows the horizon was computed on (all labelled test rows; identical for every horizon). */
  total: number;
}

export function computeDelayHorizons(rows: DelayedRow[], threshold: number, horizons: number[] = [7, 14, 30, 60]): DelayHorizon[] {
  return horizons.map((H) => {
    let cf = 0, cl = 0, latent = 0, tp = 0, fp = 0, fn = 0;
    const apparent: { probability: number; label: 0 | 1 }[] = [];
    for (const r of rows) {
      const known = r.lagDays <= H;
      if (!known) latent++;
      else if (r.label === 1) cf++;
      else cl++;
      const apparentLabel: 0 | 1 = known && r.label === 1 ? 1 : 0;
      apparent.push({ probability: r.probability, label: apparentLabel });
      const alert = r.probability >= threshold;
      if (alert && apparentLabel === 1) tp++;
      else if (alert) fp++;
      else if (apparentLabel === 1) fn++;
    }
    return {
      days: H,
      dayLabel: `Day ${H}`,
      confirmedFraud: cf,
      confirmedLegit: cl,
      unconfirmedLatent: latent,
      apparentPrecision: tp + fp > 0 ? tp / (tp + fp) : 0,
      apparentRecall: tp + fn > 0 ? tp / (tp + fn) : 0,
      apparentPrAuc: averagePrecision(apparent),
      apparentTp: tp,
      apparentFp: fp,
      apparentFn: fn,
      total: rows.length,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Period (horizon) drill-down: which ACTUAL transactions sit behind one bar of the chart.
//
// The horizons are CUMULATIVE, not disjoint time windows: every horizon is evaluated on the SAME
// cohort (all labelled held-out test rows). A horizon H only changes which of those rows have a
// label available ("lag <= H days after the transaction's own timestamp") and which are still
// pending. Consequently Day 7 ⊂ Day 14 ⊂ Day 30 ⊂ Day 60 for the "label available" subset, and the
// rows that became available between the previous horizon and H are reported as "newly matured".
// ---------------------------------------------------------------------------------------------

export interface DelayedTxInput {
  id: string;
  timestamp: string;
  amount: number;
  category: string;
  predictedProbability: number;
  groundTruthLabel: 0 | 1 | null;
  labelArrivalDays: number;
}

export type LabelAvailability = 'available' | 'pending';

export interface DelayedPeriodRow {
  id: string;
  timestamp: string;
  amount: number;
  category: string;
  score: number;
  predicted: 'Suspicious' | 'Legitimate';
  lagDays: number;
  labelStatus: LabelAvailability;
  /** Ground truth label – only meaningful when labelStatus is 'available'. */
  label: 0 | 1;
  /** Label became available in (previous horizon, H]. */
  newlyMatured: boolean;
}

export interface DelayedPeriodSelection {
  horizon: number;
  previousHorizon: number | null;
  rows: DelayedPeriodRow[];
  counts: {
    total: number;
    available: number;
    pending: number;
    newlyMatured: number;
    availableFraud: number;
    availableLegit: number;
    /** Frauds whose label is still pending – look legitimate under the naive convention. */
    pendingFraud: number;
    flagged: number;
  };
  /** Earliest / latest transaction timestamp in the cohort (UTC ISO), null when empty. */
  dateRange: { start: string; end: string } | null;
  /** Same object computeDelayHorizons() returns for this horizon (what the chart plots). */
  metrics: DelayHorizon;
  /** Unlabelled rows supplied in the input – excluded because their label never arrives. */
  excludedUnlabelled: number;
}

/**
 * Selects the transactions behind one horizon bar. Unlabelled rows (blank label in the dataset)
 * are excluded, exactly as the chart does. Rows keep chronological order (timestamp, then id).
 */
export function selectDelayedPeriod(
  input: DelayedTxInput[],
  horizon: number,
  threshold: number,
  horizons: number[] = [7, 14, 30, 60]
): DelayedPeriodSelection {
  const labelled = input.filter((t) => t.groundTruthLabel !== null);
  const sortedH = [...horizons].sort((a, b) => a - b);
  const prev = sortedH.filter((h) => h < horizon).pop() ?? null;
  const rows: DelayedPeriodRow[] = labelled
    .map((t) => {
      const available = t.labelArrivalDays <= horizon;
      return {
        id: t.id,
        timestamp: t.timestamp,
        amount: t.amount,
        category: t.category,
        score: t.predictedProbability,
        predicted: (t.predictedProbability >= threshold ? 'Suspicious' : 'Legitimate') as DelayedPeriodRow['predicted'],
        lagDays: t.labelArrivalDays,
        labelStatus: (available ? 'available' : 'pending') as LabelAvailability,
        label: t.groundTruthLabel as 0 | 1,
        newlyMatured: available && (prev === null || t.labelArrivalDays > prev),
      };
    })
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const counts = { total: rows.length, available: 0, pending: 0, newlyMatured: 0, availableFraud: 0, availableLegit: 0, pendingFraud: 0, flagged: 0 };
  for (const r of rows) {
    if (r.labelStatus === 'available') {
      counts.available++;
      if (r.label === 1) counts.availableFraud++;
      else counts.availableLegit++;
    } else {
      counts.pending++;
      if (r.label === 1) counts.pendingFraud++;
    }
    if (r.newlyMatured) counts.newlyMatured++;
    if (r.predicted === 'Suspicious') counts.flagged++;
  }
  const metrics = computeDelayHorizons(
    labelled.map((t) => ({ probability: t.predictedProbability, label: t.groundTruthLabel as 0 | 1, lagDays: t.labelArrivalDays })),
    threshold,
    [horizon]
  )[0];
  return {
    horizon,
    previousHorizon: prev,
    rows,
    counts,
    dateRange: rows.length ? { start: rows[0].timestamp, end: rows[rows.length - 1].timestamp } : null,
    metrics,
    excludedUnlabelled: input.length - labelled.length,
  };
}

export type DelayedRowFilter = 'all' | 'available' | 'pending' | 'newly';

export function filterDelayedRows(rows: DelayedPeriodRow[], filter: DelayedRowFilter): DelayedPeriodRow[] {
  if (filter === 'available') return rows.filter((r) => r.labelStatus === 'available');
  if (filter === 'pending') return rows.filter((r) => r.labelStatus === 'pending');
  if (filter === 'newly') return rows.filter((r) => r.newlyMatured);
  return rows;
}
