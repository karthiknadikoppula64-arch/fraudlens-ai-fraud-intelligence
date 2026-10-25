/**
 * Builds the model input matrix from transactions.
 *
 * Inputs used: amount (log), hour of day (sin/cos), merchant category (one-hot, top categories
 * from TRAIN only), and the dataset's optional numeric feature columns (median-imputed and
 * standardised with TRAIN statistics only). The fraud label is never read here.
 */
import type { Transaction } from '../types/fraud.ts';
import { assertNoLabelLeakage } from './featureGuard.ts';

/** The only fields of a transaction the feature builder is allowed to see (no label!). */
export type FeatureInput = Pick<Transaction, 'amount' | 'timestamp' | 'category' | 'features'>;

export interface FeatureSpace {
  /** Names of the model input columns (after encoding). */
  names: string[];
  /** For each input column, the human-level group it belongs to (used to aggregate attributions). */
  groups: string[];
  /** Distinct groups, in display order. */
  groupNames: string[];
  /** Source columns the features are derived from (all checked by the leakage guard). */
  sourceColumns: string[];
  numericColumns: string[];
  categories: string[];
  transform: (row: FeatureInput) => Float64Array;
  /** Human readable value of a group for a row (for explanations). */
  describeValue: (row: FeatureInput, group: string) => string;
}

const MAX_CATEGORIES = 12;
const OTHER = '__other__';

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const GROUP_LABELS: Record<string, string> = {
  amount: 'Transaction amount',
  hour_of_day: 'Hour of day (UTC)',
  merchant_category: 'Merchant category',
};

export function groupLabel(group: string): string {
  return GROUP_LABELS[group] ?? group.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Fit the feature space on the TRAIN split only.
 * @param labelColumnAliases names the label / id columns had in the source file (extra leakage guard)
 */
export function fitFeatureSpace(train: FeatureInput[], numericColumns: string[], labelColumnAliases: string[] = []): FeatureSpace {
  const sourceColumns = ['amount', 'timestamp', 'merchant_category', ...numericColumns];
  assertNoLabelLeakage(sourceColumns, labelColumnAliases);

  // Category vocabulary from train only
  const counts = new Map<string, number>();
  for (const r of train) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const categories = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CATEGORIES).map(([c]) => c);
  const hasOther = counts.size > categories.length;

  // Numeric stats from train only
  const stats = numericColumns.map((c) => {
    const vals = train.map((r) => r.features[c]).filter((v) => Number.isFinite(v));
    const med = median(vals);
    const filled = train.map((r) => (Number.isFinite(r.features[c]) ? r.features[c] : med));
    const mean = filled.reduce((s, v) => s + v, 0) / Math.max(1, filled.length);
    const sd = Math.sqrt(filled.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, filled.length - 1)) || 1;
    return { c, med, mean, sd };
  });
  const logAmounts = train.map((r) => Math.log1p(r.amount));
  const laMean = logAmounts.reduce((s, v) => s + v, 0) / Math.max(1, logAmounts.length);
  const laSd = Math.sqrt(logAmounts.reduce((s, v) => s + (v - laMean) ** 2, 0) / Math.max(1, logAmounts.length - 1)) || 1;

  const names: string[] = ['log_amount', 'hour_sin', 'hour_cos'];
  const groups: string[] = ['amount', 'hour_of_day', 'hour_of_day'];
  for (const s of stats) { names.push(s.c); groups.push(s.c); }
  for (const c of categories) { names.push(`category=${c}`); groups.push('merchant_category'); }
  if (hasOther) { names.push(`category=${OTHER}`); groups.push('merchant_category'); }

  const catIndex = new Map(categories.map((c, i) => [c, i]));
  const catOffset = 3 + stats.length;

  const transform = (row: FeatureInput): Float64Array => {
    const x = new Float64Array(names.length);
    x[0] = (Math.log1p(row.amount) - laMean) / laSd;
    const hour = new Date(row.timestamp).getUTCHours() + new Date(row.timestamp).getUTCMinutes() / 60;
    x[1] = Math.sin((2 * Math.PI * hour) / 24);
    x[2] = Math.cos((2 * Math.PI * hour) / 24);
    for (let j = 0; j < stats.length; j++) {
      const s = stats[j];
      const v = row.features[s.c];
      x[3 + j] = ((Number.isFinite(v) ? v : s.med) - s.mean) / s.sd;
    }
    const ci = catIndex.get(row.category);
    if (ci !== undefined) x[catOffset + ci] = 1;
    else if (hasOther) x[catOffset + categories.length] = 1;
    return x;
  };

  const describeValue = (row: FeatureInput, group: string): string => {
    if (group === 'amount') return `$${row.amount.toFixed(2)}`;
    if (group === 'hour_of_day') return `${String(new Date(row.timestamp).getUTCHours()).padStart(2, '0')}:00 UTC`;
    if (group === 'merchant_category') return row.category;
    const v = row.features[group];
    return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : 'missing (imputed)';
  };

  const groupNames = [...new Set(groups)];
  return { names, groups, groupNames, sourceColumns, numericColumns, categories, transform, describeValue };
}
