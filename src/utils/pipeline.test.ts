import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chronologicalSplit, isChronologicallyOrdered } from './chronoSplit.ts';
import { averagePrecision, rocAuc, computeBinaryMetrics, tuneThresholdByCost } from './metrics.ts';
import { parseAndValidateTransactionCsv, generateSampleCsvString } from './csvParser.ts';
import { trainPipeline, evaluateModels, explainRow, toFeatureInput } from './pipeline.ts';
import { computeDelayHorizons } from './delayedLabels.ts';
import { runDailyQueueSimulation } from './queueSimulation.ts';
import { computeDriftAnalysis } from './driftWindows.ts';

const at = (d: number) => new Date(Date.UTC(2025, 0, 1) + d * 3600000).toISOString();

test('chronologicalSplit sorts by time and cuts 60/20/20 contiguous blocks', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, timestamp: at((i * 37) % 100) }));
  const s = chronologicalSplit(rows);
  assert.equal(s.train.length, 60);
  assert.equal(s.validation.length, 20);
  assert.equal(s.test.length, 20);
  assert.ok(isChronologicallyOrdered(s));
  assert.equal(s.train[0].timestamp, at(0));
  assert.equal(s.test[19].timestamp, at(99));
});

test('metrics: AP, ROC-AUC and confusion counts', () => {
  const perfect = [
    { probability: 0.9, label: 1 as const },
    { probability: 0.8, label: 1 as const },
    { probability: 0.2, label: 0 as const },
    { probability: 0.1, label: 0 as const },
  ];
  assert.equal(averagePrecision(perfect), 1);
  assert.equal(rocAuc(perfect), 1);
  const m = computeBinaryMetrics(perfect.map((p) => ({ ...p, amount: 100 })), 0.5, 20, 50);
  assert.deepEqual([m.tp, m.fp, m.tn, m.fn], [2, 0, 2, 0]);
  assert.equal(m.totalCost, 40);
  assert.equal(m.baselineCost, 300);
  assert.equal(m.dollarsSaved, 260);
});

test('threshold tuning minimises validation cost', () => {
  const rows = [
    { probability: 0.95, label: 1 as const, amount: 1000 },
    { probability: 0.6, label: 0 as const, amount: 10 },
    { probability: 0.55, label: 0 as const, amount: 10 },
    { probability: 0.1, label: 0 as const, amount: 10 },
  ];
  const t = tuneThresholdByCost(rows, 20, 50);
  assert.ok(t.threshold > 0.6 && t.threshold <= 0.95, `got ${t.threshold}`);
  assert.equal(t.cost, 20);
});

test('pipeline trains on train only and reports test metrics better than chance on the sample', () => {
  const r = parseAndValidateTransactionCsv(generateSampleCsvString());
  const b = trainPipeline(r.transactions, r.featureColumns, ['is_fraud', 'transaction_id']);
  assert.equal(b.trainRowsUsed, r.splits.train.filter((t) => t.groundTruthLabel !== null).length);
  const ev = evaluateModels(b, r.transactions, 20, 50, 'Test');
  const testLabelled = r.splits.test.filter((t) => t.groundTruthLabel !== null);
  const fraudRate = testLabelled.filter((t) => t.groundTruthLabel === 1).length / testLabelled.length;
  for (const m of Object.values(ev)) {
    assert.equal(m.evaluatedCount, testLabelled.length, 'metrics must use labelled test rows only');
    assert.ok(m.rocAuc > 0.75, `${m.name} ROC-AUC ${m.rocAuc}`);
    assert.ok(m.prAuc > fraudRate * 3, `${m.name} PR-AUC ${m.prAuc} vs base rate ${fraudRate}`);
    assert.ok(m.threshold > 0 && m.threshold < 1);
  }
  // attributions are additive and reference real feature groups
  const shap = explainRow(b, 'Logistic Regression', toFeatureInput(r.splits.test[0]));
  assert.ok(shap.some((s) => s.feature === 'amount'));
  assert.ok(shap.every((s) => Number.isFinite(s.shapValue)));
});

test('delayed-label horizons converge to fully matured labels at day 60', () => {
  const rows = [
    { probability: 0.9, label: 1 as const, lagDays: 7 },
    { probability: 0.8, label: 1 as const, lagDays: 30 },
    { probability: 0.2, label: 0 as const, lagDays: 14 },
    { probability: 0.1, label: 0 as const, lagDays: 60 },
  ];
  const h = computeDelayHorizons(rows, 0.5);
  assert.deepEqual(h.map((x) => x.unconfirmedLatent), [3, 2, 1, 0]);
  assert.equal(h[0].apparentPrecision, 0.5); // second fraud not yet confirmed looks like a false alarm
  assert.equal(h[3].apparentPrecision, 1);
  assert.equal(h[3].apparentPrAuc, 1);
});

test('daily queue simulation applies capacity per day', () => {
  const alerts = [
    { id: 'a', amount: 100, predictedProbability: 0.9, groundTruthLabel: 1 as const, day: 'd1' },
    { id: 'b', amount: 50, predictedProbability: 0.8, groundTruthLabel: 0 as const, day: 'd1' },
    { id: 'c', amount: 500, predictedProbability: 0.7, groundTruthLabel: 1 as const, day: 'd2' },
  ];
  const r = runDailyQueueSimulation(alerts, 1, 'Highest Risk Score', 10);
  assert.equal(r.days, 2);
  assert.equal(r.totalReviewed, 2);
  assert.equal(r.trueFraudsFound, 2);
  assert.equal(r.fraudDollarsCaptured, 600);
  assert.equal(r.netValueSaved, 580);
});

test('drift analysis: reference windows never flagged; stability reported', () => {
  const r = parseAndValidateTransactionCsv(generateSampleCsvString());
  const b = trainPipeline(r.transactions, r.featureColumns, ['is_fraud', 'transaction_id']);
  const groups = b.featureSpace.groupNames;
  const attrs = r.transactions.map((t) => {
    const v = new Float64Array(groups.length);
    for (const s of explainRow(b, 'LightGBM', toFeatureInput(t))) v[groups.indexOf(s.feature)] = s.shapValue;
    return v;
  });
  const d = computeDriftAnalysis(r.transactions, attrs, groups, 'Full Stream');
  assert.ok(d.windows.length >= 10);
  assert.ok(d.windows.filter((w) => w.isReference).every((w) => Object.values(w.featureMeans).every((f) => !f.hasDrifted)));
  assert.ok(d.stabilityPct !== null && d.stabilityPct >= 0 && d.stabilityPct <= 100);
});
