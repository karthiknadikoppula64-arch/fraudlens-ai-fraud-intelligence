import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateShapConfidenceInterval, evaluateExplanationDrift } from './shapDrift.ts';

test('calculateShapConfidenceInterval correctly calculates mean and confidence band', () => {
  const values = [0.45, 0.48, 0.52, 0.49, 0.51, 0.46, 0.50];
  const ci = calculateShapConfidenceInterval(values, 0.95);

  assert.equal(ci.sampleSize, 7);
  assert.ok(ci.mean > 0.45 && ci.mean < 0.55);
  assert.ok(ci.ciLower < ci.mean);
  assert.ok(ci.ciUpper > ci.mean);
  assert.ok(ci.stdError > 0);
});

test('evaluateExplanationDrift flags change only when exceeding expected sampling variation', () => {
  // Scenario 1: Shift is large and statistically significant
  const windowCI = {
    mean: 0.85,
    ciLower: 0.81,
    ciUpper: 0.89,
    sampleSize: 100,
    stdError: 0.02,
  };
  const driftResult = evaluateExplanationDrift(0.40, 0.02, windowCI);
  assert.equal(driftResult.hasDrifted, true);
  assert.ok(driftResult.zScore > 1.96);

  // Scenario 2: Small sample size (low volume) should NOT falsely flag drift
  const lowVolumeCI = {
    mean: 0.70,
    ciLower: 0.40,
    ciUpper: 1.00,
    sampleSize: 3,
    stdError: 0.15,
  };
  const lowVolResult = evaluateExplanationDrift(0.50, 0.02, lowVolumeCI);
  assert.equal(lowVolResult.hasDrifted, false);
});
