import test from 'node:test';
import assert from 'node:assert/strict';
import { computeProbabilityDensity } from './probabilityDensity.ts';

test('computeProbabilityDensity bins probabilities and detects high bimodal polarization', () => {
  // Strongly polarized sample: 7 legitimate at ~0.02, 3 frauds at ~0.95
  const sample = [
    { predictedProbability: 0.01, groundTruthLabel: 0 as const },
    { predictedProbability: 0.02, groundTruthLabel: 0 as const },
    { predictedProbability: 0.03, groundTruthLabel: 0 as const },
    { predictedProbability: 0.05, groundTruthLabel: 0 as const },
    { predictedProbability: 0.08, groundTruthLabel: 0 as const },
    { predictedProbability: 0.12, groundTruthLabel: 0 as const },
    { predictedProbability: 0.15, groundTruthLabel: 0 as const },
    { predictedProbability: 0.92, groundTruthLabel: 1 as const },
    { predictedProbability: 0.96, groundTruthLabel: 1 as const },
    { predictedProbability: 0.98, groundTruthLabel: 1 as const },
  ];

  const result = computeProbabilityDensity(sample, 20);

  assert.equal(result.bins.length, 20);
  assert.equal(result.metrics.totalCount, 10);
  // All 10 are < 0.20 or >= 0.80 -> 100% polarized
  assert.equal(result.metrics.polarizedCount, 10);
  assert.equal(result.metrics.polarizationRatioPct, 100);
  assert.equal(result.metrics.ambiguityCount, 0);
  assert.equal(result.metrics.status, 'High Polarization (Strong Discrimination)');
});

test('computeProbabilityDensity flags unpolarized ambiguity drift', () => {
  // Unpolarized ambiguous sample centered near 0.50
  const sample = [
    { predictedProbability: 0.45, groundTruthLabel: 0 as const },
    { predictedProbability: 0.50, groundTruthLabel: 1 as const },
    { predictedProbability: 0.52, groundTruthLabel: 0 as const },
    { predictedProbability: 0.55, groundTruthLabel: 1 as const },
    { predictedProbability: 0.60, groundTruthLabel: 0 as const },
  ];

  const result = computeProbabilityDensity(sample, 20);

  assert.equal(result.metrics.ambiguityCount, 5);
  assert.equal(result.metrics.ambiguityRatioPct, 100);
  assert.equal(result.metrics.status, 'Uncertain / Centered (Drift Warning)');
});
