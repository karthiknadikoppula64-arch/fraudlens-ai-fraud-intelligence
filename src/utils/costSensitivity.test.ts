import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCostAtThreshold,
  findOptimalCostThreshold,
  computeDetectionAccuracy,
  computeStreamErrorCosts,
} from './costSensitivity.ts';

test('computeCostAtThreshold accurately tallies TP, FP, TN, FN and metrics', () => {
  const sample = [
    { probability: 0.9, label: 1 as const, amount: 500 },
    { probability: 0.8, label: 0 as const, amount: 50 }, // FP
    { probability: 0.1, label: 1 as const, amount: 1000 }, // FN
    { probability: 0.05, label: 0 as const, amount: 20 }, // TN
  ];

  const result = computeCostAtThreshold(sample, 0.5, 20, 1.0, 50);

  assert.equal(result.tp, 1);
  assert.equal(result.fp, 1);
  assert.equal(result.fn, 1);
  assert.equal(result.tn, 1);
  assert.equal(result.precision, 0.5);
  assert.equal(result.recall, 0.5);
  assert.equal(result.dollarsCaptured, 500);
  assert.equal(result.dollarsLost, 1000);
  // Cost: TP review ($20) + FP review ($20) + FN loss ($1000 + $50) = $1090
  assert.equal(result.totalCost, 1090);
});

test('findOptimalCostThreshold identifies minimum cost point', () => {
  const sample = [
    { probability: 0.95, label: 1 as const, amount: 2000 },
    { probability: 0.85, label: 1 as const, amount: 800 },
    { probability: 0.65, label: 0 as const, amount: 50 },
    { probability: 0.20, label: 0 as const, amount: 30 },
  ];

  const { optimalThreshold, minCost, curve } = findOptimalCostThreshold(sample, 25, 1.0, 50, 0.1);

  assert.ok(curve.length > 0);
  assert.ok(optimalThreshold > 0.5); // Threshold above 0.65 eliminates FP without missing high-prob frauds
  assert.ok(minCost > 0);
});

test('computeDetectionAccuracy computes TP over total positives accurately', () => {
  const flagged = [
    { groundTruthLabel: 1 as const },
    { groundTruthLabel: 1 as const },
    { groundTruthLabel: 0 as const },
    { groundTruthLabel: 1 as const },
  ];

  const result = computeDetectionAccuracy(flagged);
  assert.equal(result.truePositives, 3);
  assert.equal(result.falsePositives, 1);
  assert.equal(result.totalPositives, 4);
  assert.equal(result.detectionAccuracyPct, 75.0);
});

test('computeStreamErrorCosts calculates comparative cost breakdown accurately', () => {
  const sample = [
    { predictedProbability: 0.9, groundTruthLabel: 1 as const, amount: 1500 }, // TP -> $1500 protected
    { predictedProbability: 0.8, groundTruthLabel: 0 as const, amount: 100 },  // FP -> $25 review cost
    { predictedProbability: 0.2, groundTruthLabel: 1 as const, amount: 600 },  // FN -> $600 lost + $50 penalty = $650
    { predictedProbability: 0.1, groundTruthLabel: 0 as const, amount: 50 },   // TN -> $0
  ];

  const breakdown = computeStreamErrorCosts(sample, 0.5, 25, 50);

  assert.equal(breakdown.tpCount, 1);
  assert.equal(breakdown.fpCount, 1);
  assert.equal(breakdown.fnCount, 1);
  assert.equal(breakdown.tnCount, 1);
  assert.equal(breakdown.costFalsePositives, 25);
  assert.equal(breakdown.costMissedFraudAmounts, 600);
  assert.equal(breakdown.costMissedFraudPenalties, 50);
  assert.equal(breakdown.totalCostMissedFraud, 650);
  assert.equal(breakdown.totalOperationalCost, 675);
  assert.equal(breakdown.dollarsProtected, 1500);
  assert.equal(breakdown.netFinancialSavings, 825);
});

