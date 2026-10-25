/**
 * Manual Transaction checks: score ONE user-entered transaction with the active trained model.
 *
 * Pure, framework-free logic (unit-tested in manualTransaction.test.ts):
 *  - `buildManualFormSpec` derives the form fields from the REAL fitted feature space
 *    (amount, timestamp -> hour of day, merchant category vocabulary, and whatever optional
 *    numeric columns the active dataset/model uses). Defaults are train-split medians.
 *  - `validateManualInput` turns raw form strings into a label-free FeatureInput, with
 *    per-field error messages. It never accepts card numbers, CVV, names, e-mails or passwords:
 *    those fields simply do not exist in the spec.
 *  - `checkManualTransaction` runs the same preprocessing (`featureSpace.transform`) and the
 *    same `predict` / `explainRow` used for dataset rows, at the caller's (tuned) threshold.
 *  - `appendManualTransaction` keeps manual rows in their own list; it never touches the
 *    live-stream buffer, its counters or the dataset.
 *
 * Manual rows carry `origin: 'manual_entry'`, `source: 'manual'` and `groundTruthLabel: null`.
 * They have no `split`, so the training / tuning / evaluation code (which filters on split and
 * on known labels) can never see them.
 */
import type { ModelName, ShapFeatureContribution, Transaction, TransactionSource } from '../types/fraud.ts';
import type { FeatureInput } from './featureSpace.ts';
import { groupLabel } from './featureSpace.ts';
import { explainRow, toFeatureInput, type TrainingBundle } from './pipeline.ts';
import { parseTimestamp } from './csvParser.ts';

export const MAX_MANUAL_HISTORY = 50;
export const MAX_MANUAL_AMOUNT = 10_000_000;

export type ManualFieldKind = 'binary' | 'integer' | 'decimal';

export interface ManualNumericField {
  column: string;
  label: string;
  kind: ManualFieldKind;
  /** Observed range on the TRAIN split (finite values only). */
  trainMin: number;
  trainMax: number;
  trainMedian: number;
  /** True when every train value is >= 0, so negative input is rejected. */
  nonNegative: boolean;
  defaultValue: string;
  hint: string;
}

export interface ManualFormSpec {
  /** Merchant categories known to the dataset's train split, most frequent first. */
  categories: string[];
  /** Categories that have their own one-hot column in the model (others map to "other"). */
  modelCategories: string[];
  numericFields: ManualNumericField[];
  amountMedian: number;
  amountTrainMax: number;
  defaults: ManualFormValues;
  /** Encoded model input names, in model order (for display of derived features). */
  encodedFeatureNames: string[];
}

/** Raw form values exactly as typed (strings), so they can be kept on error. */
export interface ManualFormValues {
  amount: string;
  /** "YYYY-MM-DDTHH:MM" (datetime-local), interpreted as UTC like the dataset timestamps. */
  timestamp: string;
  category: string;
  features: Record<string, string>;
}

export type ManualFieldErrors = Record<string, string>;

export interface ManualValidation {
  ok: boolean;
  errors: ManualFieldErrors;
  warnings: string[];
  input: FeatureInput | null;
}

export interface DerivedFeature {
  name: string;
  value: number;
}

export interface ManualCheckSuccess {
  ok: true;
  transaction: Transaction;
  modelName: ModelName;
  probability: number;
  threshold: number;
  flagged: boolean;
  verdict: 'Suspicious' | 'Legitimate';
  explanation: ShapFeatureContribution[];
  derivedFeatures: DerivedFeature[];
  warnings: string[];
  checkedAt: string;
}

export interface ManualCheckFailure {
  ok: false;
  reason: 'model_unavailable' | 'invalid_input';
  message: string;
  errors: ManualFieldErrors;
  warnings: string[];
}

export type ManualCheckResult = ManualCheckSuccess | ManualCheckFailure;

const FRIENDLY_LABELS: Record<string, string> = {
  distance_km: 'Distance from usual location (km)',
  velocity_1h: 'Transactions in the last hour',
  device_score: 'Device score',
  is_online: 'Online / card-not-present',
  foreign_country: 'Foreign country',
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** "YYYY-MM-DDTHH:MM" in UTC for a datetime-local input. */
export function toUtcInputValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

/**
 * Builds the form from the fitted feature space and the TRAIN split it was fitted on.
 * Only the numeric columns the model actually uses become fields.
 */
export function buildManualFormSpec(bundle: TrainingBundle, trainRows: Pick<Transaction, 'amount' | 'category' | 'features'>[], nowMs: number = Date.now()): ManualFormSpec {
  const fs = bundle.featureSpace;
  const counts = new Map<string, number>();
  for (const r of trainRows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const categories = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);

  const numericFields: ManualNumericField[] = fs.numericColumns.map((column) => {
    const vals = trainRows.map((r) => r.features[column]).filter((v) => Number.isFinite(v));
    const binary = vals.length > 0 && vals.every((v) => v === 0 || v === 1);
    const integer = vals.length > 0 && vals.every((v) => Number.isInteger(v));
    const kind: ManualFieldKind = binary ? 'binary' : integer ? 'integer' : 'decimal';
    const trainMin = vals.length ? Math.min(...vals) : 0;
    const trainMax = vals.length ? Math.max(...vals) : 0;
    const med = median(vals);
    const defaultNum = kind === 'binary' ? (med >= 0.5 ? 1 : 0) : kind === 'integer' ? Math.round(med) : round2(med);
    const label = FRIENDLY_LABELS[column] ?? groupLabel(column);
    const hint = kind === 'binary'
      ? `Yes = 1, No = 0 (column "${column}")`
      : `Column "${column}". Training range ${round2(trainMin)}–${round2(trainMax)}, median ${round2(med)}.`;
    return { column, label, kind, trainMin, trainMax, trainMedian: med, nonNegative: trainMin >= 0, defaultValue: String(defaultNum), hint };
  });

  const amounts = trainRows.map((r) => r.amount).filter((v) => Number.isFinite(v));
  const amountMedian = round2(median(amounts));
  const amountTrainMax = amounts.length ? Math.max(...amounts) : 0;
  const defaults: ManualFormValues = {
    amount: amountMedian > 0 ? amountMedian.toFixed(2) : '',
    timestamp: toUtcInputValue(Math.floor(nowMs / 60000) * 60000),
    category: categories[0] ?? '',
    features: Object.fromEntries(numericFields.map((f) => [f.column, f.defaultValue])),
  };
  return { categories, modelCategories: [...fs.categories], numericFields, amountMedian, amountTrainMax, defaults, encodedFeatureNames: [...fs.names] };
}

/** Validates raw form values. Returns per-field messages; keeps nothing but label-free model inputs. */
export function validateManualInput(values: ManualFormValues, spec: ManualFormSpec): ManualValidation {
  const errors: ManualFieldErrors = {};
  const warnings: string[] = [];

  // amount
  const amountRaw = (values.amount ?? '').trim();
  let amount = NaN;
  if (amountRaw === '') errors.amount = 'Enter an amount.';
  else if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(amountRaw)) errors.amount = 'Amount must be a plain number, e.g. 42.50.';
  else {
    amount = Number(amountRaw);
    if (!(amount > 0)) errors.amount = 'Amount must be greater than 0.';
    else if (amount > MAX_MANUAL_AMOUNT) errors.amount = `Amount must be at most ${MAX_MANUAL_AMOUNT.toLocaleString('en-US')}.`;
    else if (spec.amountTrainMax > 0 && amount > spec.amountTrainMax) warnings.push(`Amount is above the largest training amount (${spec.amountTrainMax.toFixed(2)}); the models have not seen values this high.`);
  }

  // timestamp (UTC)
  const tsRaw = (values.timestamp ?? '').trim();
  let timestampIso = '';
  if (tsRaw === '') errors.timestamp = 'Enter a date and time (UTC).';
  else {
    const ms = parseTimestamp(tsRaw);
    if (ms === null) errors.timestamp = 'Enter a valid date and time between 1970 and 2100 (UTC), e.g. 2025-06-01T14:30.';
    else timestampIso = new Date(ms).toISOString();
  }

  // category
  const category = (values.category ?? '').trim();
  if (category === '') errors.category = 'Choose a merchant category.';
  else if (!spec.categories.includes(category)) errors.category = 'Choose one of the merchant categories known to the active dataset.';
  else if (!spec.modelCategories.includes(category)) warnings.push(`“${category}” is a rare category; the model scores it as “other”.`);

  // numeric model features
  const features: Record<string, number> = {};
  for (const f of spec.numericFields) {
    const raw = (values.features?.[f.column] ?? '').trim();
    if (raw === '') {
      errors[f.column] = `Enter a value for ${f.label}.`;
      continue;
    }
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(raw)) {
      errors[f.column] = `${f.label} must be a number.`;
      continue;
    }
    const v = Number(raw);
    if (f.kind === 'binary' && v !== 0 && v !== 1) { errors[f.column] = `${f.label} must be Yes (1) or No (0).`; continue; }
    if (f.kind === 'integer' && !Number.isInteger(v)) { errors[f.column] = `${f.label} must be a whole number.`; continue; }
    if (f.nonNegative && v < 0) { errors[f.column] = `${f.label} cannot be negative.`; continue; }
    if (f.kind !== 'binary' && (v < f.trainMin || v > f.trainMax)) {
      warnings.push(`${f.label} (${v}) is outside the training range ${round2(f.trainMin)}–${round2(f.trainMax)}; the score is an extrapolation.`);
    }
    features[f.column] = v;
  }

  const ok = Object.keys(errors).length === 0;
  return { ok, errors, warnings, input: ok ? { amount, timestamp: timestampIso, category, features } : null };
}

let manualCounter = 0;
function nextManualId(nowMs: number): string {
  manualCounter = (manualCounter + 1) % 100000;
  return `MAN-${nowMs.toString(36).toUpperCase()}-${String(manualCounter).padStart(5, '0')}`;
}

export interface CheckManualOptions {
  bundle: TrainingBundle | null;
  modelName: ModelName;
  threshold: number;
  values: ManualFormValues;
  spec: ManualFormSpec | null;
  nowMs?: number;
}

/** Validate -> preprocess (same feature space) -> real model predict -> attributions. Never invents a score. */
export function checkManualTransaction(opts: CheckManualOptions): ManualCheckResult {
  const { bundle, modelName, threshold, values, spec } = opts;
  const model = bundle?.models[modelName];
  if (!bundle || !model || !spec) {
    return {
      ok: false,
      reason: 'model_unavailable',
      message: 'No trained model is loaded yet. Wait for training on the active dataset to finish (or load a dataset), then check again.',
      errors: {},
      warnings: [],
    };
  }
  const v = validateManualInput(values, spec);
  if (!v.ok || !v.input) {
    return { ok: false, reason: 'invalid_input', message: 'Fix the highlighted fields and check again.', errors: v.errors, warnings: v.warnings };
  }
  const input = v.input;
  const x = bundle.featureSpace.transform(input);
  const probability = model.predict(x);
  const explanation = explainRow(bundle, modelName, input);
  const nowMs = opts.nowMs ?? Date.now();
  const flagged = probability >= threshold;
  const transaction: Transaction = {
    id: nextManualId(nowMs),
    timestamp: input.timestamp,
    amount: input.amount,
    category: input.category,
    merchant: input.category,
    features: { ...input.features },
    groundTruthLabel: null,
    predictedProbability: Math.round(probability * 10000) / 10000,
    origin: 'manual_entry',
    source: 'manual',
    labelArrivalDays: 0,
    status: flagged ? 'Pending Review' : 'Cleared',
    shapBreakdown: explanation,
  };
  return {
    ok: true,
    transaction,
    modelName,
    probability,
    threshold,
    flagged,
    verdict: flagged ? 'Suspicious' : 'Legitimate',
    explanation,
    derivedFeatures: bundle.featureSpace.names.map((name, i) => ({ name, value: x[i] })),
    warnings: v.warnings,
    checkedAt: new Date(nowMs).toISOString(),
  };
}

/** Newest first, capped. Returns a NEW array; the input list and the stream buffer are untouched. */
export function appendManualTransaction(list: readonly Transaction[], tx: Transaction, cap = MAX_MANUAL_HISTORY): Transaction[] {
  if (tx.origin !== 'manual_entry') throw new Error('appendManualTransaction only accepts manual rows.');
  return [tx, ...list.filter((t) => t.id !== tx.id)].slice(0, cap);
}

/** Where a row came from: manual test, simulated stream, or dataset (historical replay). */
export function transactionSource(t: Pick<Transaction, 'origin' | 'source'>): TransactionSource {
  if (t.source) return t.source;
  if (t.origin === 'manual_entry') return 'manual';
  if (t.origin === 'synthetic_stream') return 'simulated';
  return 'dataset_replay';
}

/** Rows usable where real labels matter (never manual rows). */
export function excludeManual<T extends Pick<Transaction, 'origin' | 'source'>>(rows: T[]): T[] {
  return rows.filter((t) => transactionSource(t) !== 'manual');
}

/** Re-score stored manual rows with the current model (e.g. after the active model changes). */
export function rescoreManual(bundle: TrainingBundle, modelName: ModelName, rows: Transaction[]): Transaction[] {
  return rows.map((t) => {
    const input = toFeatureInput(t);
    const p = bundle.models[modelName].predict(bundle.featureSpace.transform(input));
    return { ...t, predictedProbability: Math.round(p * 10000) / 10000, shapBreakdown: explainRow(bundle, modelName, input) };
  });
}
