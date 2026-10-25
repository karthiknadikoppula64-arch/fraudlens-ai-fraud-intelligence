export interface FeatureShapSample {
  feature: string;
  shapValue: number;
}

export interface ConfidenceInterval {
  mean: number;
  ciLower: number;
  ciUpper: number;
  sampleSize: number;
  stdError: number;
}

/**
 * Calculates Student-t or Normal 95% confidence interval for mean SHAP value.
 * Standard error = stdDev / sqrt(N).
 * Margin of error = 1.96 * stdError (for alpha = 0.05).
 */
export function calculateShapConfidenceInterval(
  values: number[],
  confidenceLevel: number = 0.95
): ConfidenceInterval {
  const n = values.length;
  if (n === 0) {
    return { mean: 0, ciLower: 0, ciUpper: 0, sampleSize: 0, stdError: 0 };
  }

  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  if (n === 1) {
    return { mean, ciLower: mean, ciUpper: mean, sampleSize: 1, stdError: 0 };
  }

  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  const stdError = stdDev / Math.sqrt(n);

  // Z-score approximation: 1.96 for 95%, 2.576 for 99%
  const z = confidenceLevel === 0.99 ? 2.576 : 1.96;
  const marginOfError = z * stdError;

  return {
    mean: Math.round(mean * 1000) / 1000,
    ciLower: Math.round((mean - marginOfError) * 1000) / 1000,
    ciUpper: Math.round((mean + marginOfError) * 1000) / 1000,
    sampleSize: n,
    stdError: Math.round(stdError * 1000) / 1000,
  };
}

/**
 * Evaluates whether a time window exhibits statistically significant explanation drift
 * compared to the reference baseline, beyond expected sampling noise.
 *
 * Proposal constraint:
 * Flag a change ONLY when the baseline mean falls outside the window's confidence interval
 * (or window CI does not overlap baseline CI), preventing low-volume months from triggering false drift alarms!
 */
export function evaluateExplanationDrift(
  baselineMean: number,
  baselineStdError: number,
  windowCI: ConfidenceInterval,
  zCritical: number = 1.96
): {
  hasDrifted: boolean;
  driftMagnitude: number;
  zScore: number;
  pValue: number;
  explanation: string;
} {
  const delta = windowCI.mean - baselineMean;
  const combinedSE = Math.sqrt(Math.pow(windowCI.stdError, 2) + Math.pow(baselineStdError, 2));

  if (combinedSE === 0 || windowCI.sampleSize < 5) {
    return {
      hasDrifted: false,
      driftMagnitude: Math.round(delta * 1000) / 1000,
      zScore: 0,
      pValue: 1,
      explanation: 'Insufficient observations in time window to confirm drift beyond random variation.',
    };
  }

  const zScore = delta / combinedSE;
  // If absolute Z-score >= 1.96 (p < 0.05), change exceeds expected sampling variation
  const hasDrifted = Math.abs(zScore) >= zCritical;
  const pValue = twoSidedPValue(zScore);

  let explanation = '';
  if (hasDrifted) {
    explanation = `Significant explanation drift detected (Z=${zScore.toFixed(2)}, |Δ|=${Math.abs(delta).toFixed(3)}). Feature importance shifted outside the sampling confidence band.`;
  } else {
    explanation = `Within expected sampling variation (Z=${zScore.toFixed(2)}). Shift (|Δ|=${Math.abs(delta).toFixed(3)}) is bounded within noise interval.`;
  }

  return {
    hasDrifted,
    driftMagnitude: Math.round(delta * 1000) / 1000,
    zScore: Math.round(zScore * 100) / 100,
    pValue,
    explanation,
  };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 approximation of erf). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export function twoSidedPValue(z: number): number {
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
}
