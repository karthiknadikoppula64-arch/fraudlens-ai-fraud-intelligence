/**
 * Review-queue workbench (SIMULATION / DEMO).
 *
 * Pure state machine for analyst decisions on alerts the trained model flagged at the current
 * threshold. Decisions are SIMULATED reviewer actions held in UI state only: they are never
 * written to `groundTruthLabel`, never used for training, threshold tuning or metrics, and are
 * kept strictly apart from the dataset's own ground-truth labels.
 *
 *   pending ──review──▶ reviewed
 *           ──fraud───▶ confirmed_fraud_sim
 *           ──legit───▶ legitimate_sim
 *
 * Every decided state is terminal. A second decision on the same alert is rejected
 * ('already_decided'). Undo is allowed only for the most recent decision and only while that
 * alert is still in the state that decision produced ("clean" history); it returns it to pending.
 */

export type ReviewDecision = 'reviewed' | 'confirmed_fraud_sim' | 'legitimate_sim';
export type ReviewStatus = 'pending' | ReviewDecision;
export type ReviewAction = 'review' | 'fraud' | 'legit';

export const ACTION_TO_DECISION: Record<ReviewAction, ReviewDecision> = {
  review: 'reviewed',
  fraud: 'confirmed_fraud_sim',
  legit: 'legitimate_sim',
};

export const DECISION_LABEL: Record<ReviewStatus, string> = {
  pending: 'Awaiting review',
  reviewed: 'Reviewed (simulated)',
  confirmed_fraud_sim: 'Confirmed fraud (simulated)',
  legitimate_sim: 'Marked legitimate (simulated)',
};

export interface ReviewQueueState {
  /** Decision per alert id. Absent = pending. */
  decisions: Readonly<Record<string, ReviewDecision>>;
  /** Decision history, most recent last (used for undo). */
  history: ReadonlyArray<{ id: string; decision: ReviewDecision }>;
}

export const EMPTY_REVIEW_STATE: ReviewQueueState = { decisions: {}, history: [] };

export type ReviewError = 'unknown_item' | 'already_decided' | 'nothing_to_undo' | 'undo_not_clean';

export type ReviewResult = { ok: true; state: ReviewQueueState } | { ok: false; error: ReviewError; state: ReviewQueueState };

export function statusOf(state: ReviewQueueState, id: string): ReviewStatus {
  return state.decisions[id] ?? 'pending';
}

/** Applies one reviewer action to an alert in the queue (`queueIds`). Never mutates `state`. */
export function applyReviewAction(state: ReviewQueueState, id: string, action: ReviewAction, queueIds: ReadonlySet<string>): ReviewResult {
  if (!queueIds.has(id)) return { ok: false, error: 'unknown_item', state };
  if (state.decisions[id] !== undefined) return { ok: false, error: 'already_decided', state };
  const decision = ACTION_TO_DECISION[action];
  return {
    ok: true,
    state: { decisions: { ...state.decisions, [id]: decision }, history: [...state.history, { id, decision }] },
  };
}

/** Whether the most recent decision can be undone cleanly. */
export function canUndo(state: ReviewQueueState): boolean {
  const last = state.history[state.history.length - 1];
  return !!last && state.decisions[last.id] === last.decision;
}

export function undoLastDecision(state: ReviewQueueState): ReviewResult {
  const last = state.history[state.history.length - 1];
  if (!last) return { ok: false, error: 'nothing_to_undo', state };
  if (state.decisions[last.id] !== last.decision) return { ok: false, error: 'undo_not_clean', state };
  const decisions = { ...state.decisions };
  delete decisions[last.id];
  return { ok: true, state: { decisions, history: state.history.slice(0, -1) } };
}

export interface ReviewCounts {
  total: number;
  pending: number;
  reviewed: number;
  confirmedFraudSim: number;
  legitimateSim: number;
  decided: number;
}

/** Counts over the CURRENT queue only (decisions on alerts no longer flagged are ignored). */
export function countReviewQueue(state: ReviewQueueState, queueIds: Iterable<string>): ReviewCounts {
  const c: ReviewCounts = { total: 0, pending: 0, reviewed: 0, confirmedFraudSim: 0, legitimateSim: 0, decided: 0 };
  for (const id of queueIds) {
    c.total++;
    const s = statusOf(state, id);
    if (s === 'pending') c.pending++;
    else {
      c.decided++;
      if (s === 'reviewed') c.reviewed++;
      else if (s === 'confirmed_fraud_sim') c.confirmedFraudSim++;
      else c.legitimateSim++;
    }
  }
  return c;
}

export interface QueueCandidate {
  id: string;
  timestamp: string;
  amount: number;
  category: string;
  predictedProbability: number;
  groundTruthLabel: 0 | 1 | null;
  shapBreakdown?: { feature: string; label: string; shapValue: number; value: number | string }[];
}

export interface QueueItem {
  id: string;
  timestamp: string;
  amount: number;
  category: string;
  score: number;
  expectedLoss: number;
  /** Top positive attributions (features that pushed the score up) from the existing SHAP utility. */
  reasons: { label: string; value: number | string; shapValue: number }[];
  /** Dataset ground truth – shown separately, never derived from reviewer decisions. */
  groundTruth: 0 | 1 | null;
}

/** Builds the queue: rows flagged at τ (score ≥ τ), highest expected loss (score × amount) first. */
export function buildReviewQueue(rows: QueueCandidate[], threshold: number, topReasons = 3): QueueItem[] {
  return rows
    .filter((t) => t.predictedProbability >= threshold)
    .map((t) => ({
      id: t.id,
      timestamp: t.timestamp,
      amount: t.amount,
      category: t.category,
      score: t.predictedProbability,
      expectedLoss: t.predictedProbability * t.amount,
      reasons: (t.shapBreakdown ?? [])
        .filter((s) => s.shapValue > 0)
        .sort((a, b) => b.shapValue - a.shapValue)
        .slice(0, topReasons)
        .map((s) => ({ label: s.label, value: s.value, shapValue: s.shapValue })),
      groundTruth: t.groundTruthLabel,
    }))
    .sort((a, b) => b.expectedLoss - a.expectedLoss || (a.id < b.id ? -1 : 1));
}

/**
 * Compares simulated decisions with dataset ground truth (for display only). Rows without a
 * ground-truth label and 'reviewed' (no verdict) decisions are not compared.
 */
export function agreementWithGroundTruth(state: ReviewQueueState, items: QueueItem[]): { compared: number; agree: number; disagree: number } {
  let compared = 0, agree = 0;
  for (const it of items) {
    const s = statusOf(state, it.id);
    if (it.groundTruth === null || (s !== 'confirmed_fraud_sim' && s !== 'legitimate_sim')) continue;
    compared++;
    if ((s === 'confirmed_fraud_sim') === (it.groundTruth === 1)) agree++;
  }
  return { compared, agree, disagree: compared - agree };
}
