import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoLabelLeakage, isForbiddenFeatureName, LabelLeakageError, forbiddenFeatureReason } from './featureGuard.ts';
import { fitFeatureSpace } from './featureSpace.ts';
import { parseAndValidateTransactionCsv, generateSampleCsvString } from './csvParser.ts';
import { trainPipeline, buildTrainingData, toFeatureInput } from './pipeline.ts';
import type { Transaction } from '../types/fraud.ts';

test('guard flags labels, label-derived columns and identifiers', () => {
  for (const c of ['is_fraud', 'Is Fraud', 'label', 'Class', 'target', 'chargeback_flag', 'fraud_rate_merchant', 'dispute_date', 'transaction_id', 'customer_id']) {
    assert.ok(isForbiddenFeatureName(c), `${c} should be forbidden`);
  }
  for (const c of ['amount', 'distance_km', 'velocity_1h', 'device_score', 'is_online', 'merchant_category']) {
    assert.equal(isForbiddenFeatureName(c), false, `${c} should be allowed`);
  }
  assert.equal(forbiddenFeatureReason('is_fraud'), 'label');
  assert.equal(forbiddenFeatureReason('txn_id'), 'identifier');
});

test('assertNoLabelLeakage throws LabelLeakageError for label features (incl. custom label names)', () => {
  assert.throws(() => assertNoLabelLeakage(['amount', 'is_fraud']), LabelLeakageError);
  assert.throws(() => assertNoLabelLeakage(['amount', 'outcome_flag_x'], ['outcome_flag_x']), LabelLeakageError);
  assert.doesNotThrow(() => assertNoLabelLeakage(['amount', 'distance_km']));
});

test('fitFeatureSpace refuses label columns as numeric features', () => {
  const rows = [{ amount: 1, timestamp: new Date(Date.UTC(2025, 0, 1)).toISOString(), category: 'A', features: { is_fraud: 1 } }];
  assert.throws(() => fitFeatureSpace(rows, ['is_fraud']), LabelLeakageError);
});

test('feature vectors never depend on the label: flipping every label leaves X unchanged', () => {
  const r = parseAndValidateTransactionCsv(generateSampleCsvString({ rows: 600, days: 60 }));
  const fs = fitFeatureSpace(r.splits.train.map(toFeatureInput), r.featureColumns);
  const flipped: Transaction[] = r.transactions.map((t) => ({ ...t, groundTruthLabel: t.groundTruthLabel === 1 ? 0 : 1 }));
  for (let i = 0; i < r.transactions.length; i++) {
    assert.deepEqual(Array.from(fs.transform(toFeatureInput(r.transactions[i]))), Array.from(fs.transform(toFeatureInput(flipped[i]))));
  }
  assert.ok(!fs.names.some((n) => /fraud|label/i.test(n)), 'no encoded feature may be named after the label');
});

test('test-split labels cannot influence predictions (train only on train labels)', () => {
  const r = parseAndValidateTransactionCsv(generateSampleCsvString({ rows: 1500, days: 90 }));
  const a = trainPipeline(r.transactions, r.featureColumns, ['is_fraud', 'transaction_id']);
  // Flip every validation + test label and retrain: predictions must be identical.
  const tampered = r.transactions.map((t) => (t.split === 'train' ? t : { ...t, groundTruthLabel: (t.groundTruthLabel === 1 ? 0 : 1) as 0 | 1 }));
  const b = trainPipeline(tampered, r.featureColumns, ['is_fraud', 'transaction_id']);
  for (const m of ['Logistic Regression', 'LightGBM', 'XGBoost', 'Random Forest'] as const) {
    assert.deepEqual(Array.from(a.probabilities[m]), Array.from(b.probabilities[m]), `${m} predictions changed when non-train labels changed`);
  }
});

test('unlabelled rows are excluded from training data', () => {
  const r = parseAndValidateTransactionCsv(generateSampleCsvString({ rows: 600, days: 60, unlabelledTailDays: 0 }));
  const train = r.splits.train.map((t, i) => (i % 10 === 0 ? { ...t, groundTruthLabel: null } : t));
  const fs = fitFeatureSpace(train.map(toFeatureInput), r.featureColumns);
  const { data } = buildTrainingData(train, fs);
  assert.equal(data.X.length, train.filter((t) => t.groundTruthLabel !== null).length);
});
