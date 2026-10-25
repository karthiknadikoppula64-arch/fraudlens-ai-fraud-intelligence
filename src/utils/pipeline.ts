/**
 * End-to-end training / evaluation pipeline on the ACTIVE dataset.
 *
 *  1. Rows are already sorted by time and split 60/20/20 chronologically (csvParser).
 *  2. Feature space is fitted on TRAIN rows only (category vocabulary, medians, means, std devs).
 *  3. Every model is trained on LABELLED TRAIN rows only.
 *  4. Decision thresholds are tuned on LABELLED VALIDATION rows only (cost-minimising).
 *  5. Reported metrics come from LABELLED TEST rows only.
 *  Unlabelled rows are scored but never used for training or evaluation.
 */
import type { ModelMetric, ModelName, ShapFeatureContribution, Transaction } from '../types/fraud.ts';
import { MODEL_NAMES } from '../types/fraud.ts';
import { fitFeatureSpace, groupLabel, type FeatureInput, type FeatureSpace } from './featureSpace.ts';
import { classWeights, trainModel, type TrainedModel, type TrainingData } from './models.ts';
import { computeBinaryMetrics, tuneThresholdByCost, type ScoredLabelledRow } from './metrics.ts';
import { assertNoLabelLeakage } from './featureGuard.ts';
import { mulberry32 } from '../data/syntheticSample.ts';

export const MAX_TRAIN_ROWS = 30000;

export interface TrainingBundle {
  featureSpace: FeatureSpace;
  models: Record<ModelName, TrainedModel>;
  /** Predicted probability per model, aligned with `transactions` order passed to trainPipeline. */
  probabilities: Record<ModelName, Float64Array>;
  ids: string[];
  trainRowsUsed: number;
  trainRowsLabelled: number;
  downsampled: boolean;
  trainingMs: number;
}

/** Strips everything except the permitted input fields – the label cannot reach the feature builder. */
export function toFeatureInput(t: Transaction): FeatureInput {
  return { amount: t.amount, timestamp: t.timestamp, category: t.category, features: t.features };
}

export function buildTrainingData(train: Transaction[], fs: FeatureSpace, seed = 42): { data: TrainingData; downsampled: boolean; labelled: number } {
  const labelled = train.filter((t) => t.groundTruthLabel !== null);
  let rows = labelled;
  let legitScale = 1;
  let downsampled = false;
  if (labelled.length > MAX_TRAIN_ROWS) {
    // keep every fraud, randomly sample legitimate rows, re-weight them to preserve the class prior
    const rand = mulberry32(seed);
    const frauds = labelled.filter((t) => t.groundTruthLabel === 1);
    const legit = labelled.filter((t) => t.groundTruthLabel === 0);
    const keep = Math.max(1, MAX_TRAIN_ROWS - frauds.length);
    const sampled = legit.filter(() => rand() < keep / legit.length);
    legitScale = legit.length / Math.max(1, sampled.length);
    rows = [...frauds, ...sampled];
    downsampled = true;
  }
  const y = Uint8Array.from(rows.map((t) => (t.groundTruthLabel === 1 ? 1 : 0)));
  const cw = classWeights(y);
  const w = Float64Array.from(rows.map((_, i) => (y[i] === 1 ? cw.pos : cw.neg * legitScale)));
  const X = rows.map((t) => fs.transform(toFeatureInput(t)));
  return { data: { X, y, w }, downsampled, labelled: labelled.length };
}

export function trainPipeline(transactions: Transaction[], numericColumns: string[], labelAliases: string[] = []): TrainingBundle {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const train = transactions.filter((t) => t.split === 'train');
  assertNoLabelLeakage(numericColumns, labelAliases);
  const fs = fitFeatureSpace(train.map(toFeatureInput), numericColumns, labelAliases);
  const { data, downsampled, labelled } = buildTrainingData(train, fs);

  const models = {} as Record<ModelName, TrainedModel>;
  for (const name of MODEL_NAMES) models[name] = trainModel(name, data);

  const X = transactions.map((t) => fs.transform(toFeatureInput(t)));
  const probabilities = {} as Record<ModelName, Float64Array>;
  for (const name of MODEL_NAMES) probabilities[name] = Float64Array.from(X.map((x) => models[name].predict(x)));

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    featureSpace: fs,
    models,
    probabilities,
    ids: transactions.map((t) => t.id),
    trainRowsUsed: data.X.length,
    trainRowsLabelled: labelled,
    downsampled,
    trainingMs: Math.round(t1 - t0),
  };
}

function labelledRows(transactions: Transaction[], probs: Float64Array, split: Transaction['split']): ScoredLabelledRow[] {
  const out: ScoredLabelledRow[] = [];
  transactions.forEach((t, i) => {
    if (t.split === split && t.groundTruthLabel !== null) out.push({ probability: probs[i], label: t.groundTruthLabel, amount: t.amount });
  });
  return out;
}

export interface ModelEvaluation extends ModelMetric {
  validationCostAtThreshold: number;
}

/** Threshold tuned on validation; metrics on the requested cohort (default: held-out test). */
export function evaluateModels(
  bundle: TrainingBundle,
  transactions: Transaction[],
  costFP: number,
  fnPenalty: number,
  cohort: 'Train' | 'Validation' | 'Test' = 'Test',
  thresholdOverride?: number
): Record<ModelName, ModelEvaluation> {
  const out = {} as Record<ModelName, ModelEvaluation>;
  const splitKey = cohort === 'Train' ? 'train' : cohort === 'Validation' ? 'validation' : 'test';
  for (const name of MODEL_NAMES) {
    const probs = bundle.probabilities[name];
    const tuned = tuneThresholdByCost(labelledRows(transactions, probs, 'validation'), costFP, fnPenalty);
    const threshold = thresholdOverride ?? tuned.threshold;
    const m = computeBinaryMetrics(labelledRows(transactions, probs, splitKey), threshold, costFP, fnPenalty);
    out[name] = {
      name,
      threshold,
      precision: m.precision,
      recall: m.recall,
      prAuc: m.prAuc,
      rocAuc: m.rocAuc,
      mcc: m.mcc,
      f1: m.f1,
      truePositives: m.tp,
      falsePositives: m.fp,
      trueNegatives: m.tn,
      falseNegatives: m.fn,
      totalCost: m.totalCost,
      dollarsSaved: m.dollarsSaved,
      evaluatedCount: m.n,
      evaluatedFrauds: m.frauds,
      cohort,
      description: bundle.models[name].description,
      samplingStrategy: bundle.models[name].samplingStrategy,
      validationCostAtThreshold: tuned.cost,
    };
  }
  return out;
}

/** Validation-tuned threshold for one model. */
export function tunedThreshold(bundle: TrainingBundle, transactions: Transaction[], model: ModelName, costFP: number, fnPenalty: number): number {
  return tuneThresholdByCost(labelledRows(transactions, bundle.probabilities[model], 'validation'), costFP, fnPenalty).threshold;
}

/** Grouped additive attribution for one row, as display-ready SHAP items (sorted by |value|). */
export function explainRow(bundle: TrainingBundle, model: ModelName, input: FeatureInput): ShapFeatureContribution[] {
  const fs = bundle.featureSpace;
  const m = bundle.models[model];
  const { contributions } = m.explain(fs.transform(input));
  const byGroup = new Map<string, number>();
  fs.groups.forEach((g, j) => byGroup.set(g, (byGroup.get(g) ?? 0) + contributions[j]));
  const unit = m.outputSpace === 'logit' ? 'log-odds' : 'probability points';
  return [...byGroup.entries()]
    .map(([group, v]) => ({
      feature: group,
      label: groupLabel(group),
      value: fs.describeValue(input, group),
      shapValue: Math.round(v * 1000) / 1000,
      description: `${v >= 0 ? 'Raises' : 'Lowers'} the ${model} fraud score by ${Math.abs(v).toFixed(3)} ${unit} relative to the average training transaction.`,
    }))
    .sort((a, b) => Math.abs(b.shapValue) - Math.abs(a.shapValue));
}

/** Grouped attribution vectors for many rows (used by the drift monitor). */
export function groupedAttributions(bundle: TrainingBundle, model: ModelName, inputs: FeatureInput[]): { groups: string[]; values: Float64Array[] } {
  const fs = bundle.featureSpace;
  const groups = fs.groupNames;
  const gIndex = new Map(groups.map((g, i) => [g, i]));
  const m = bundle.models[model];
  const values = inputs.map((inp) => {
    const { contributions } = m.explain(fs.transform(inp));
    const v = new Float64Array(groups.length);
    fs.groups.forEach((g, j) => (v[gIndex.get(g) as number] += contributions[j]));
    return v;
  });
  return { groups, values };
}

export function scoreRow(bundle: TrainingBundle, model: ModelName, input: FeatureInput): number {
  return bundle.models[model].predict(bundle.featureSpace.transform(input));
}
