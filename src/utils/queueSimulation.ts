export interface SimTransaction {
  id: string;
  amount: number;
  predictedProbability: number;
  groundTruthLabel: 0 | 1;
}

export type AlertOrderingStrategy =
  | 'Highest Risk Score'
  | 'Highest Expected Dollar Loss'
  | 'Cost-Utility Net Value'
  | 'Random Exploration';

export interface QueueSimulationResult {
  strategy: AlertOrderingStrategy;
  capacity: number; // reviews per day
  totalAlertsGenerated: number;
  totalReviewed: number;
  trueFraudsFound: number;
  falseAlertsReviewed: number;
  fraudDollarsCaptured: number;
  fraudDollarsMissed: number;
  investigationCostSpent: number;
  netValueSaved: number;
  workloadSaturationPct: number;
}

function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function runQueueCapacitySimulation(
  alerts: SimTransaction[],
  capacityLimit: number,
  strategy: AlertOrderingStrategy,
  costPerReview: number = 20
): QueueSimulationResult {
  if (alerts.length === 0) {
    return {
      strategy,
      capacity: capacityLimit,
      totalAlertsGenerated: 0,
      totalReviewed: 0,
      trueFraudsFound: 0,
      falseAlertsReviewed: 0,
      fraudDollarsCaptured: 0,
      fraudDollarsMissed: 0,
      investigationCostSpent: 0,
      netValueSaved: 0,
      workloadSaturationPct: 0,
    };
  }

  // Sort alerts according to the chosen ordering strategy
  const sorted = [...alerts].sort((a, b) => {
    if (strategy === 'Highest Risk Score') {
      return b.predictedProbability - a.predictedProbability;
    }
    if (strategy === 'Highest Expected Dollar Loss') {
      const expA = a.predictedProbability * a.amount;
      const expB = b.predictedProbability * b.amount;
      return expB - expA;
    }
    if (strategy === 'Cost-Utility Net Value') {
      // Expected captured amount minus investigation cost
      const netA = (a.predictedProbability * a.amount) - costPerReview;
      const netB = (b.predictedProbability * b.amount) - costPerReview;
      return netB - netA;
    }
    // Random Exploration: deterministic pseudo-random order from a hash of the full id
    return idHash(a.id) - idHash(b.id);
  });

  const reviewed = sorted.slice(0, capacityLimit);
  const unreviewed = sorted.slice(capacityLimit);

  let trueFraudsFound = 0;
  let falseAlertsReviewed = 0;
  let fraudDollarsCaptured = 0;
  let fraudDollarsMissed = 0;

  for (const t of reviewed) {
    if (t.groundTruthLabel === 1) {
      trueFraudsFound++;
      fraudDollarsCaptured += t.amount;
    } else {
      falseAlertsReviewed++;
    }
  }

  for (const t of unreviewed) {
    if (t.groundTruthLabel === 1) {
      fraudDollarsMissed += t.amount;
    }
  }

  const totalReviewed = reviewed.length;
  const investigationCostSpent = totalReviewed * costPerReview;
  const netValueSaved = Math.max(0, fraudDollarsCaptured - investigationCostSpent);
  const workloadSaturationPct = Math.min(100, Math.round((totalReviewed / Math.max(1, capacityLimit)) * 100));

  return {
    strategy,
    capacity: capacityLimit,
    totalAlertsGenerated: alerts.length,
    totalReviewed,
    trueFraudsFound,
    falseAlertsReviewed,
    fraudDollarsCaptured: Math.round(fraudDollarsCaptured * 100) / 100,
    fraudDollarsMissed: Math.round(fraudDollarsMissed * 100) / 100,
    investigationCostSpent,
    netValueSaved: Math.round(netValueSaved * 100) / 100,
    workloadSaturationPct,
  };
}

export interface DailyAlert extends SimTransaction {
  /** Calendar day key (e.g. "2025-07-14"); capacity applies per day. */
  day: string;
}

/**
 * Runs the capacity-limited queue day by day (capacity = reviews per day) and aggregates the results.
 * Unlabelled alerts should be passed with groundTruthLabel 0 only if the caller wants them counted as
 * non-fraud; callers here pass labelled alerts only.
 */
export function runDailyQueueSimulation(
  alerts: DailyAlert[],
  dailyCapacity: number,
  strategy: AlertOrderingStrategy,
  costPerReview: number = 20
): QueueSimulationResult & { days: number } {
  const byDay = new Map<string, DailyAlert[]>();
  for (const a of alerts) {
    const list = byDay.get(a.day);
    if (list) list.push(a);
    else byDay.set(a.day, [a]);
  }
  const total: QueueSimulationResult & { days: number } = {
    strategy,
    capacity: dailyCapacity,
    totalAlertsGenerated: 0,
    totalReviewed: 0,
    trueFraudsFound: 0,
    falseAlertsReviewed: 0,
    fraudDollarsCaptured: 0,
    fraudDollarsMissed: 0,
    investigationCostSpent: 0,
    netValueSaved: 0,
    workloadSaturationPct: 0,
    days: byDay.size,
  };
  for (const list of byDay.values()) {
    const r = runQueueCapacitySimulation(list, dailyCapacity, strategy, costPerReview);
    total.totalAlertsGenerated += r.totalAlertsGenerated;
    total.totalReviewed += r.totalReviewed;
    total.trueFraudsFound += r.trueFraudsFound;
    total.falseAlertsReviewed += r.falseAlertsReviewed;
    total.fraudDollarsCaptured += r.fraudDollarsCaptured;
    total.fraudDollarsMissed += r.fraudDollarsMissed;
    total.investigationCostSpent += r.investigationCostSpent;
  }
  total.fraudDollarsCaptured = Math.round(total.fraudDollarsCaptured * 100) / 100;
  total.fraudDollarsMissed = Math.round(total.fraudDollarsMissed * 100) / 100;
  total.netValueSaved = Math.round((total.fraudDollarsCaptured - total.investigationCostSpent) * 100) / 100;
  total.workloadSaturationPct = byDay.size > 0 ? Math.min(100, Math.round((total.totalReviewed / (dailyCapacity * byDay.size)) * 100)) : 0;
  return total;
}
