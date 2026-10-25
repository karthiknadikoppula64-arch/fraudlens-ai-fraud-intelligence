import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAndValidateTransactionCsv, generateSampleCsvString } from './csvParser.ts';
import { trainPipeline, explainRow, toFeatureInput, evaluateModels } from './pipeline.ts';
import {
  agreementWithGroundTruth,
  applyReviewAction,
  buildReviewQueue,
  canUndo,
  countReviewQueue,
  EMPTY_REVIEW_STATE,
  statusOf,
  undoLastDecision,
  type ReviewQueueState,
} from './reviewQueue.ts';

const parse = parseAndValidateTransactionCsv(generateSampleCsvString(), { origin: 'synthetic_sample' });
const bundle = trainPipeline(parse.transactions, parse.featureColumns, ['is_fraud', 'transaction_id']);
const probs = bundle.probabilities.LightGBM;
const testRows = parse.transactions
  .map((t, i) => ({ ...t, predictedProbability: probs[i] }))
  .filter((t) => t.split === 'test')
  .map((t) => ({ ...t, shapBreakdown: explainRow(bundle, 'LightGBM', toFeatureInput(t)) }));
const TAU = 0.5;
const items = buildReviewQueue(testRows, TAU);
const ids = new Set(items.map((i) => i.id));

const ok = (r: ReturnType<typeof applyReviewAction>): ReviewQueueState => {
  assert.equal(r.ok, true, r.ok ? '' : r.error);
  return r.state;
};

test('queue = test rows flagged at τ by the real model, ordered by expected loss, with positive SHAP reasons', () => {
  const flagged = testRows.filter((t) => t.predictedProbability >= TAU);
  assert.ok(flagged.length > 0);
  assert.equal(items.length, flagged.length);
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].expectedLoss >= items[i].expectedLoss);
  for (const it of items) {
    assert.ok(it.score >= TAU);
    assert.ok(it.reasons.length <= 3);
    for (const r of it.reasons) assert.ok(r.shapValue > 0);
    const src = testRows.find((t) => t.id === it.id)!;
    assert.equal(it.groundTruth, src.groundTruthLabel);
    const top = src.shapBreakdown.filter((s) => s.shapValue > 0).sort((a, b) => b.shapValue - a.shapValue)[0];
    if (top) assert.equal(it.reasons[0].label, top.label);
  }
});

test('valid transitions: pending → exactly one terminal decision, counts stay consistent', () => {
  const [a, b, c] = items.map((i) => i.id);
  let s = EMPTY_REVIEW_STATE;
  assert.deepEqual(countReviewQueue(s, ids), { total: items.length, pending: items.length, reviewed: 0, confirmedFraudSim: 0, legitimateSim: 0, decided: 0 });
  s = ok(applyReviewAction(s, a, 'review', ids));
  s = ok(applyReviewAction(s, b, 'fraud', ids));
  s = ok(applyReviewAction(s, c, 'legit', ids));
  assert.equal(statusOf(s, a), 'reviewed');
  assert.equal(statusOf(s, b), 'confirmed_fraud_sim');
  assert.equal(statusOf(s, c), 'legitimate_sim');
  const n = countReviewQueue(s, ids);
  assert.deepEqual(n, { total: items.length, pending: items.length - 3, reviewed: 1, confirmedFraudSim: 1, legitimateSim: 1, decided: 3 });
  assert.equal(n.pending + n.decided, n.total);
});

test('duplicate and invalid transitions are rejected without changing state', () => {
  const [a] = items.map((i) => i.id);
  const s1 = ok(applyReviewAction(EMPTY_REVIEW_STATE, a, 'fraud', ids));
  for (const action of ['fraud', 'legit', 'review'] as const) {
    const r = applyReviewAction(s1, a, action, ids);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error, 'already_decided');
    assert.equal(r.state, s1);
  }
  const unknown = applyReviewAction(s1, 'NOT-IN-QUEUE', 'review', ids);
  assert.equal(!unknown.ok && unknown.error, 'unknown_item');
  assert.equal(countReviewQueue(s1, ids).decided, 1);
  // immutability
  assert.deepEqual(EMPTY_REVIEW_STATE, { decisions: {}, history: [] });
});

test('undo only reverts the most recent clean decision', () => {
  const [a, b] = items.map((i) => i.id);
  assert.equal(canUndo(EMPTY_REVIEW_STATE), false);
  const none = undoLastDecision(EMPTY_REVIEW_STATE);
  assert.equal(!none.ok && none.error, 'nothing_to_undo');
  let s = ok(applyReviewAction(EMPTY_REVIEW_STATE, a, 'fraud', ids));
  s = ok(applyReviewAction(s, b, 'legit', ids));
  assert.equal(canUndo(s), true);
  s = ok(undoLastDecision(s));
  assert.equal(statusOf(s, b), 'pending');
  assert.equal(statusOf(s, a), 'confirmed_fraud_sim');
  s = ok(undoLastDecision(s));
  assert.equal(statusOf(s, a), 'pending');
  assert.equal(countReviewQueue(s, ids).decided, 0);
  // tampered (not clean) history cannot be undone
  const dirty: ReviewQueueState = { decisions: { [a]: 'legitimate_sim' }, history: [{ id: a, decision: 'confirmed_fraud_sim' }] };
  assert.equal(canUndo(dirty), false);
  const r = undoLastDecision(dirty);
  assert.equal(!r.ok && r.error, 'undo_not_clean');
  // after undo, a fresh decision is allowed again
  s = ok(applyReviewAction(s, a, 'legit', ids));
  assert.equal(statusOf(s, a), 'legitimate_sim');
});

test('simulated decisions stay separate from ground truth and never change labels or metrics', () => {
  const before = evaluateModels(bundle, parse.transactions, 20, 50, 'Test');
  const labelsBefore = parse.transactions.map((t) => t.groundTruthLabel);
  // decide every alert the "wrong" way
  let s = EMPTY_REVIEW_STATE;
  for (const it of items) s = ok(applyReviewAction(s, it.id, it.groundTruth === 1 ? 'legit' : 'fraud', ids));
  assert.deepEqual(parse.transactions.map((t) => t.groundTruthLabel), labelsBefore);
  for (const it of items) assert.equal(it.groundTruth, testRows.find((t) => t.id === it.id)!.groundTruthLabel);
  assert.deepEqual(evaluateModels(bundle, parse.transactions, 20, 50, 'Test'), before);
  const ag = agreementWithGroundTruth(s, items);
  assert.equal(ag.compared, items.filter((i) => i.groundTruth !== null).length);
  assert.equal(ag.agree, 0);
  // unlabelled alerts and 'reviewed' decisions are not compared
  let r = EMPTY_REVIEW_STATE;
  for (const it of items) r = ok(applyReviewAction(r, it.id, 'review', ids));
  assert.equal(agreementWithGroundTruth(r, items).compared, 0);
});

test('counts ignore decisions on alerts that left the queue (threshold raised)', () => {
  const [a] = items.map((i) => i.id);
  const last = items[items.length - 1].id;
  let s = ok(applyReviewAction(EMPTY_REVIEW_STATE, a, 'fraud', ids));
  s = ok(applyReviewAction(s, last, 'legit', ids));
  const higher = buildReviewQueue(testRows, Math.min(0.999, items[0].score));
  const hIds = new Set(higher.map((i) => i.id));
  const c = countReviewQueue(s, hIds);
  assert.equal(c.total, higher.length);
  assert.equal(c.pending + c.decided, c.total);
  assert.equal(buildReviewQueue(testRows, 1.01).length, 0);
  assert.equal(countReviewQueue(s, []).total, 0);
});
