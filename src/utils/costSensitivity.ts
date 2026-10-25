export interface ThresholdCostPoint {
  threshold: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  mcc: number;
  totalCost: number;
  dollarsCaptured: number;
  dollarsLost: number;
}

export function computeCostAtThreshold(
  predictions: { probability: number; label: 0 | 1; amount: number }[],
  threshold: number,
  costFP: number, // Operational cost of investigating a false alert (e.g. $20)
  costFNAmountMultiplier: number = 1.0, // 100% of transaction amount lost if FN
  fixedFNPenalty: number = 50 // Fixed regulatory / chargeback fee per undetected fraud
): ThresholdCostPoint {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let totalCost = 0;
  let dollarsCaptured = 0;
  let dollarsLost = 0;

  for (const p of predictions) {
    const isAlert = p.probability >= threshold;
    if (isAlert) {
      if (p.label === 1) {
        tp++;
        dollarsCaptured += p.amount;
        // Review cost for TP is also spent
        totalCost += costFP;
      } else {
        fp++;
        // Review cost + customer friction for false alarm
        totalCost += costFP;
      }
    } else {
      if (p.label === 1) {
        fn++;
        dollarsLost += p.amount;
        // Direct financial loss from chargeback + penalty
        totalCost += (p.amount * costFNAmountMultiplier) + fixedFNPenalty;
      } else {
        tn++;
      }
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // Matthews Correlation Coefficient
  const numerator = (tp * tn) - (fp * fn);
  const denominator = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
  const mcc = denominator > 0 ? numerator / denominator : 0;

  return {
    threshold: Math.round(threshold * 100) / 100,
    tp,
    fp,
    tn,
    fn,
    precision,
    recall,
    f1,
    mcc,
    totalCost,
    dollarsCaptured,
    dollarsLost,
  };
}

export function findOptimalCostThreshold(
  predictions: { probability: number; label: 0 | 1; amount: number }[],
  costFP: number,
  costFNAmountMultiplier: number = 1.0,
  fixedFNPenalty: number = 50,
  step: number = 0.02
): {
  optimalThreshold: number;
  curve: ThresholdCostPoint[];
  minCost: number;
} {
  const curve: ThresholdCostPoint[] = [];
  let minCost = Infinity;
  let optimalThreshold = 0.5;

  for (let t = 0.02; t <= 0.98; t += step) {
    const point = computeCostAtThreshold(predictions, t, costFP, costFNAmountMultiplier, fixedFNPenalty);
    curve.push(point);
    if (point.totalCost < minCost) {
      minCost = point.totalCost;
      optimalThreshold = point.threshold;
    }
  }

  return {
    optimalThreshold,
    curve,
    minCost,
  };
}

export function computeDetectionAccuracy(
  flaggedTransactions: { groundTruthLabel: 0 | 1 | null }[]
): {
  truePositives: number;
  falsePositives: number;
  totalPositives: number;
  detectionAccuracyPct: number;
} {
  // Only flagged rows with a known label can be judged (unlabelled rows are excluded).
  const judged = flaggedTransactions.filter((t) => t.groundTruthLabel !== null);
  const totalPositives = judged.length;
  if (totalPositives === 0) {
    return {
      truePositives: 0,
      falsePositives: 0,
      totalPositives: 0,
      detectionAccuracyPct: 0,
    };
  }

  const truePositives = judged.filter((t) => t.groundTruthLabel === 1).length;
  const falsePositives = totalPositives - truePositives;
  const detectionAccuracyPct = Math.round((truePositives / totalPositives) * 1000) / 10;

  return {
    truePositives,
    falsePositives,
    totalPositives,
    detectionAccuracyPct,
  };
}

export interface ErrorCostBreakdownData {
  fpCount: number;
  fnCount: number;
  tpCount: number;
  tnCount: number;
  costFalsePositives: number;
  costMissedFraudAmounts: number;
  costMissedFraudPenalties: number;
  totalCostMissedFraud: number;
  totalOperationalCost: number;
  dollarsProtected: number;
  netFinancialSavings: number;
  /** Rows without a label (excluded from the cost tally). */
  unlabelledCount: number;
}

export function computeStreamErrorCosts(
  transactions: { predictedProbability: number; groundTruthLabel: 0 | 1 | null; amount: number }[],
  threshold: number,
  costFP: number,
  fixedFNPenalty: number = 50
): ErrorCostBreakdownData {
  let fpCount = 0;
  let fnCount = 0;
  let tpCount = 0;
  let tnCount = 0;
  let costMissedFraudAmounts = 0;
  let dollarsProtected = 0;
  let unlabelledCount = 0;

  for (const t of transactions) {
    if (t.groundTruthLabel === null) {
      unlabelledCount++;
      continue;
    }
    const isAlert = t.predictedProbability >= threshold;
    if (isAlert) {
      if (t.groundTruthLabel === 1) {
        tpCount++;
        dollarsProtected += t.amount;
      } else {
        fpCount++;
      }
    } else {
      if (t.groundTruthLabel === 1) {
        fnCount++;
        costMissedFraudAmounts += t.amount;
      } else {
        tnCount++;
      }
    }
  }

  const costFalsePositives = fpCount * costFP;
  const costMissedFraudPenalties = fnCount * fixedFNPenalty;
  const totalCostMissedFraud = Math.round((costMissedFraudAmounts + costMissedFraudPenalties) * 100) / 100;
  const totalOperationalCost = Math.round((costFalsePositives + totalCostMissedFraud) * 100) / 100;
  const netFinancialSavings = Math.round((dollarsProtected - totalOperationalCost) * 100) / 100;

  return {
    fpCount,
    fnCount,
    tpCount,
    tnCount,
    costFalsePositives,
    costMissedFraudAmounts: Math.round(costMissedFraudAmounts * 100) / 100,
    costMissedFraudPenalties,
    totalCostMissedFraud,
    totalOperationalCost,
    dollarsProtected: Math.round(dollarsProtected * 100) / 100,
    netFinancialSavings,
    unlabelledCount,
  };
}
