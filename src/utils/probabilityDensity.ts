export interface DensityBin {
  binRange: string;
  binCenter: number; // e.g. 0.05, 0.15, ...
  count: number;
  legitimateCount: number;
  fraudCount: number;
  unknownCount: number;
  densityPct: number;
  density: number; // smoothed density value
}

export interface PolarizationMetrics {
  totalCount: number;
  polarizedCount: number; // P < 0.20 or P >= 0.80
  polarizationRatioPct: number; // percentage in polarized tails
  ambiguityCount: number; // 0.35 <= P < 0.65
  ambiguityRatioPct: number;
  status: 'High Polarization (Strong Discrimination)' | 'Moderate Polarization' | 'Uncertain / Centered (Drift Warning)';
}

/**
 * Computes binned probability density across [0, 1] range with Gaussian smoothing
 * for visualizing model polarization.
 */
export function computeProbabilityDensity(
  probabilities: { predictedProbability: number; groundTruthLabel: 0 | 1 | null }[],
  numBins: number = 20
): {
  bins: DensityBin[];
  metrics: PolarizationMetrics;
} {
  const binWidth = 1 / numBins;
  const rawBins: {
    binCenter: number;
    count: number;
    legitimateCount: number;
    fraudCount: number;
    unknownCount: number;
  }[] = [];

  for (let i = 0; i < numBins; i++) {
    const center = Math.round((i * binWidth + binWidth / 2) * 100) / 100;
    rawBins.push({
      binCenter: center,
      count: 0,
      legitimateCount: 0,
      fraudCount: 0,
      unknownCount: 0,
    });
  }

  const n = probabilities.length;
  let polarizedCount = 0;
  let ambiguityCount = 0;

  for (const item of probabilities) {
    const p = Math.max(0, Math.min(0.999, item.predictedProbability));
    const binIndex = Math.min(numBins - 1, Math.floor(p / binWidth));

    rawBins[binIndex].count++;
    if (item.groundTruthLabel === 1) {
      rawBins[binIndex].fraudCount++;
    } else if (item.groundTruthLabel === 0) {
      rawBins[binIndex].legitimateCount++;
    } else {
      rawBins[binIndex].unknownCount++;
    }

    if (p < 0.20 || p >= 0.80) {
      polarizedCount++;
    }
    if (p >= 0.35 && p < 0.65) {
      ambiguityCount++;
    }
  }

  // Gaussian kernel smoothing across adjacent bins for smooth density curve
  const bins: DensityBin[] = rawBins.map((bin, i) => {
    let smoothedCount = 0;
    let weightSum = 0;

    for (let j = 0; j < numBins; j++) {
      const dist = Math.abs(i - j);
      const weight = Math.exp(-Math.pow(dist, 2) / (2 * Math.pow(1.2, 2))); // sigma = 1.2
      smoothedCount += rawBins[j].count * weight;
      weightSum += weight;
    }

    const smoothed = weightSum > 0 ? smoothedCount / weightSum : bin.count;
    const densityPct = n > 0 ? Math.round((bin.count / n) * 1000) / 10 : 0;
    const density = n > 0 ? Math.round((smoothed / n) * 1000) / 10 : 0;

    const lowerBound = (i * binWidth).toFixed(2);
    const upperBound = ((i + 1) * binWidth).toFixed(2);

    return {
      binRange: `${lowerBound}-${upperBound}`,
      binCenter: bin.binCenter,
      count: bin.count,
      legitimateCount: bin.legitimateCount,
      fraudCount: bin.fraudCount,
      unknownCount: bin.unknownCount,
      densityPct,
      density,
    };
  });

  const polarizationRatioPct = n > 0 ? Math.round((polarizedCount / n) * 1000) / 10 : 0;
  const ambiguityRatioPct = n > 0 ? Math.round((ambiguityCount / n) * 1000) / 10 : 0;

  let status: PolarizationMetrics['status'] = 'Moderate Polarization';
  if (polarizationRatioPct >= 75) {
    status = 'High Polarization (Strong Discrimination)';
  } else if (ambiguityRatioPct >= 35) {
    status = 'Uncertain / Centered (Drift Warning)';
  }

  return {
    bins,
    metrics: {
      totalCount: n,
      polarizedCount,
      polarizationRatioPct,
      ambiguityCount,
      ambiguityRatioPct,
      status,
    },
  };
}
