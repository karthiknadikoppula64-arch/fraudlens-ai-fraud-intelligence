/**
 * Core domain types for FraudLens.
 *
 * Privacy note: there is intentionally NO field for card numbers, CVVs, cardholder names,
 * emails, phone numbers or addresses. Such columns are dropped at ingestion (see datasetSchema.ts).
 */

export type ModelName = 'Logistic Regression' | 'Random Forest' | 'XGBoost' | 'LightGBM';

export const MODEL_NAMES: ModelName[] = ['LightGBM', 'XGBoost', 'Random Forest', 'Logistic Regression'];

/** Where a transaction came from. Used to visually separate simulated data from historical data. */
export type DataOrigin = 'synthetic_sample' | 'uploaded_csv' | 'synthetic_stream' | 'manual_entry';

/**
 * Coarse source of a row: a user-entered manual test, the simulated stream, or a dataset row
 * (historical / test-split replay). Optional for backward compatibility; derive it with
 * `transactionSource()` (utils/manualTransaction.ts) when absent.
 */
export type TransactionSource = 'manual' | 'simulated' | 'dataset_replay';

export type SplitName = 'train' | 'validation' | 'test';

/** 1 = confirmed fraud, 0 = confirmed legitimate, null = label not available (unlabelled / pending). */
export type FraudLabel = 0 | 1 | null;

export interface ModelMetric {
  name: ModelName;
  /** Threshold tuned on the validation split (cost-minimising). */
  threshold: number;
  precision: number;
  recall: number;
  prAuc: number;
  rocAuc: number;
  mcc: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  /** Expected operating cost on the evaluated cohort at `threshold` (review cost + missed fraud + penalties). */
  totalCost: number;
  /** Estimated saving vs. a no-model baseline (all fraud lost). Never negative-clamped: a model can lose money. */
  dollarsSaved: number;
  /** Number of labelled rows the metric was computed on. */
  evaluatedCount: number;
  evaluatedFrauds: number;
  cohort: 'Train' | 'Validation' | 'Test';
  description: string;
  samplingStrategy: string;
}

export interface ShapFeatureContribution {
  feature: string;
  label: string;
  value: number | string;
  /** Additive contribution in the model's output space (log-odds, or probability points for Random Forest). */
  shapValue: number;
  description: string;
}

export interface Transaction {
  id: string;
  timestamp: string; // ISO string (UTC)
  amount: number;
  /** Merchant category as supplied in the data (free text, e.g. "Electronics", "grocery_pos"). */
  category: string;
  /** Display-only merchant label (never PII). Falls back to the category. */
  merchant: string;
  /** Optional numeric feature columns (label-free model inputs), keyed by column name. NaN = missing. */
  features: Record<string, number>;
  groundTruthLabel: FraudLabel;
  /** Predicted fraud probability from the active trained model (0..1). */
  predictedProbability: number;
  split?: SplitName;
  origin: DataOrigin;
  /** See TransactionSource. Manual rows are never labelled, trained on or evaluated. */
  source?: TransactionSource;
  /** Simulated chargeback / dispute lag (days) used only by the delayed-label simulator. */
  labelArrivalDays: number;
  /** Analyst workflow status (UI only). */
  status: 'Pending Review' | 'Cleared' | 'Confirmed Fraud' | 'False Positive';
  shapBreakdown: ShapFeatureContribution[];
  /** 1-based source row in the uploaded CSV (header = row 1). */
  sourceRow?: number;
}

export interface DriftTimeWindow {
  windowId: string;
  windowLabel: string;
  startDate: string;
  endDate: string;
  totalTransactions: number;
  confirmedFrauds: number;
  /** Number of rows in the selected population that fed the statistics. */
  sampleSize: number;
  isReference: boolean;
  featureMeans: Record<string, {
    meanShap: number;
    ciLower: number;
    ciUpper: number;
    baselineMean: number;
    hasDrifted: boolean;
    pValue: number;
    zScore: number;
  }>;
}

export interface QueueSimulationResult {
  strategy: 'Highest Risk Score' | 'Highest Expected Dollar Loss' | 'Cost-Utility Net Value' | 'Random Exploration';
  capacity: number;
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
