/**
 * Anti-leakage guard.
 *
 * Fraud labels (and anything derived from them) must NEVER be used as model input features.
 * Transaction identifiers are also excluded: they carry no causal signal and can leak
 * ordering / label information in synthetic or exported datasets.
 */

/** Exact (normalised) column names that are labels or label-derived. */
const LABEL_EXACT = new Set([
  'is_fraud', 'isfraud', 'fraud', 'fraud_flag', 'fraud_label', 'label', 'labels', 'class', 'target', 'y',
  'ground_truth', 'ground_truth_label', 'groundtruthlabel', 'outcome', 'actual', 'actual_label',
  'is_chargeback', 'chargeback', 'chargeback_flag', 'dispute', 'disputed', 'is_disputed',
  'confirmed_fraud', 'fraud_confirmed', 'status', 'review_status', 'investigation_result',
]);

/** Substrings that mark a column as label-derived (e.g. "fraud_rate_by_merchant", "chargeback_date"). */
const LABEL_SUBSTRINGS = ['fraud', 'chargeback', 'dispute', 'ground_truth', 'groundtruth', 'label', 'target'];

/** Identifier columns – excluded from features. */
const ID_EXACT = new Set([
  'id', 'transaction_id', 'transactionid', 'txn_id', 'tx_id', 'trans_num', 'trans_id', 'transaction_number', 'row_id', 'index', 'unnamed: 0',
]);

export const normaliseColumnName = (name: string): string =>
  name.trim().toLowerCase().replace(/[\s\-.]+/g, '_');

export type ForbiddenReason = 'label' | 'label_derived' | 'identifier';

export function forbiddenFeatureReason(columnName: string): ForbiddenReason | null {
  const n = normaliseColumnName(columnName);
  if (LABEL_EXACT.has(n)) return 'label';
  if (LABEL_SUBSTRINGS.some((s) => n.includes(s))) return 'label_derived';
  if (ID_EXACT.has(n) || n.endsWith('_id') || n.endsWith('_uuid')) return 'identifier';
  return null;
}

export function isForbiddenFeatureName(columnName: string): boolean {
  return forbiddenFeatureReason(columnName) !== null;
}

export class LabelLeakageError extends Error {
  readonly offendingColumns: string[];
  constructor(offendingColumns: string[]) {
    super(`Label leakage blocked: forbidden feature column(s) ${offendingColumns.join(', ')}`);
    this.offendingColumns = offendingColumns;
    this.name = 'LabelLeakageError';
  }
}

/**
 * Throws LabelLeakageError if any feature/column name is a label, label-derived or an identifier.
 * `extraForbidden` lets callers add the dataset's own label / id column names (whatever they were called).
 */
export function assertNoLabelLeakage(featureColumns: string[], extraForbidden: string[] = []): void {
  const extra = new Set(extraForbidden.filter(Boolean).map(normaliseColumnName));
  const offending = featureColumns.filter(
    (c) => isForbiddenFeatureName(c) || extra.has(normaliseColumnName(c))
  );
  if (offending.length > 0) throw new LabelLeakageError(offending);
}
