/**
 * CSV parsing + validation for historical transaction datasets.
 *
 * Required columns : transaction_id, timestamp, amount, merchant_category, is_fraud (aliases accepted)
 * Optional columns : any numeric feature column (e.g. distance_km, velocity_1h, device_score, is_online)
 * Labels           : is_fraud in {0, 1, true, false}; blank = unlabelled (kept, never used for training/eval)
 * Privacy          : card-number / CVV / name / email / phone / address / credential columns are DROPPED
 * Leakage          : label-derived and identifier columns are never used as features (see featureGuard.ts)
 */
import type { Transaction, FraudLabel } from '../types/fraud.ts';
import type { SplitSummary } from '../types/dataset.ts';
import {
  resolveRequiredColumns,
  sensitiveKindFromName,
  sensitiveKindFromValues,
  SENSITIVE_KIND_LABEL,
  FIELD_ALIASES,
  REQUIRED_FIELDS,
  type RequiredField,
  type SensitiveKind,
} from './datasetSchema.ts';
import { forbiddenFeatureReason, assertNoLabelLeakage } from './featureGuard.ts';
import { chronologicalSplit, formatDateRange } from './chronoSplit.ts';

export { generateSampleCsvString } from '../data/syntheticSample.ts';

export interface CsvValidationIssue {
  row: number; // 1-based CSV line (header = 1); 0 = file-level
  field: string;
  message: string;
  sampleValue?: string;
}

export interface DroppedColumn {
  column: string;
  reason: 'sensitive' | 'label_derived' | 'identifier' | 'non_numeric';
  detail: string;
}

export interface CsvParseOptions {
  origin?: Transaction['origin'];
  /** Max individual row issues retained (counts are always exact). */
  maxIssues?: number;
  /** Minimum valid rows required for the dataset to be usable. */
  minValidRows?: number;
}

export interface CsvParseResult {
  isValid: boolean;
  totalRowsRead: number;
  validRowsCount: number;
  invalidRowsCount: number;
  /** Rows skipped, by field that failed. */
  skippedByField: Record<string, number>;
  labelledCount: number;
  unlabelledCount: number;
  fraudCount: number;
  legitimateCount: number;
  fraudRatePercent: number;
  dateRange: { start: string; end: string; durationDays: number };
  detectedColumns: string[];
  mappedColumns: Record<string, string>;
  featureColumns: string[];
  droppedColumns: DroppedColumn[];
  /** File-level problems (missing required columns, empty file, too few rows). */
  headerErrors: CsvValidationIssue[];
  /** Row-level problems (bad rows are skipped). */
  errors: CsvValidationIssue[];
  warnings: string[];
  /** Valid transactions, sorted chronologically, with `split` assigned (60/20/20 by time). */
  transactions: Transaction[];
  splits: { train: Transaction[]; validation: Transaction[]; test: Transaction[]; summary: SplitSummary };
}

/** RFC-4180-ish CSV tokenizer (quotes, escaped quotes, CRLF). */
export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;
  const text = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText; // strip BOM

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (insideQuotes && text[i + 1] === '"') {
        currentField += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      currentRow.push(currentField.trim());
      if (currentRow.length > 1 || currentRow[0] !== '') rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.length > 1 || currentRow[0] !== '') rows.push(currentRow);
  }
  return rows;
}

const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})([ T](\d{1,2}):(\d{2})(:(\d{2})(\.\d+)?)?)?$/;

/** Parses ISO-8601, "YYYY-MM-DD HH:MM[:SS]" (treated as UTC) and epoch seconds/milliseconds. */
export function parseTimestamp(raw: string): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let ms: number;
  if (/^\d{9,13}(\.\d+)?$/.test(s)) {
    const num = Number(s);
    ms = s.split('.')[0].length >= 12 ? num : num * 1000;
  } else {
    const m = NAIVE_DATETIME.exec(s);
    if (m) {
      ms = Date.UTC(+m[1], +m[2] - 1, +m[3], m[5] ? +m[5] : 0, m[6] ? +m[6] : 0, m[8] ? +m[8] : 0);
      // reject impossible dates such as 2025-02-31
      const d = new Date(ms);
      if (d.getUTCDate() !== +m[3] || d.getUTCMonth() !== +m[2] - 1) return null;
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(s) || /^[A-Za-z]{3},? /.test(s) || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
      ms = Date.parse(s);
    } else {
      return null;
    }
  }
  if (!Number.isFinite(ms)) return null;
  const year = new Date(ms).getUTCFullYear();
  if (year < 1970 || year > 2100) return null;
  return ms;
}

export function parseAmount(raw: string): number | null {
  const s = (raw ?? '').trim().replace(/[$€£₹,\s]/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** Fraud label: 1/0/true/false (case-insensitive); blank => null (unlabelled); anything else => 'invalid'. */
export function parseFraudLabel(raw: string | undefined): FraudLabel | 'invalid' {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === '') return null;
  if (s === '1' || s === 'true' || s === '1.0') return 1;
  if (s === '0' || s === 'false' || s === '0.0') return 0;
  return 'invalid';
}

/** Numeric feature value: numbers, or booleans (true/false/yes/no) -> 1/0. Blank -> NaN (missing). */
export function parseFeatureValue(raw: string | undefined): number | 'invalid' {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === '' || s === 'na' || s === 'nan' || s === 'null') return NaN;
  if (s === 'true' || s === 'yes') return 1;
  if (s === 'false' || s === 'no') return 0;
  const v = Number(s);
  return Number.isFinite(v) ? v : 'invalid';
}

/** Deterministic simulated dispute lag (days) from the transaction id – independent of the label. */
export function simulatedLabelLagDays(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = ((h >>> 0) % 1000) / 1000;
  if (u < 0.3) return 7;
  if (u < 0.65) return 14;
  if (u < 0.9) return 30;
  return 60;
}

function emptyResult(headers: string[], headerErrors: CsvValidationIssue[], totalRows: number): CsvParseResult {
  return {
    isValid: false,
    totalRowsRead: totalRows,
    validRowsCount: 0,
    invalidRowsCount: totalRows,
    skippedByField: {},
    labelledCount: 0,
    unlabelledCount: 0,
    fraudCount: 0,
    legitimateCount: 0,
    fraudRatePercent: 0,
    dateRange: { start: '', end: '', durationDays: 0 },
    detectedColumns: headers,
    mappedColumns: {},
    featureColumns: [],
    droppedColumns: [],
    headerErrors,
    errors: [],
    warnings: [],
    transactions: [],
    splits: {
      train: [],
      validation: [],
      test: [],
      summary: {
        trainCount: 0, trainFrauds: 0, trainDateRange: 'N/A',
        valCount: 0, valFrauds: 0, valDateRange: 'N/A',
        testCount: 0, testFrauds: 0, testDateRange: 'N/A',
      },
    },
  };
}

/**
 * Parses, validates and chronologically partitions a transaction CSV.
 * Bad rows are skipped and reported; sensitive columns are dropped and reported.
 */
export function parseAndValidateTransactionCsv(csvContent: string, options: CsvParseOptions = {}): CsvParseResult {
  const { origin = 'uploaded_csv', maxIssues = 500, minValidRows = 20 } = options;
  const rawRows = parseCsvRows(csvContent);
  if (rawRows.length < 2) {
    return emptyResult(rawRows[0] ?? [], [{ row: 0, field: 'file', message: 'CSV file is empty or has no data rows below the header.' }], Math.max(0, rawRows.length - 1));
  }

  const headers = rawRows[0].map((h) => h.trim());
  const dataRows = rawRows.slice(1);
  const resolution = resolveRequiredColumns(headers);
  const headerErrors: CsvValidationIssue[] = [];

  const dupHeaders = headers.filter((h, i) => h && headers.findIndex((x) => x.toLowerCase() === h.toLowerCase()) !== i);
  if (dupHeaders.length) {
    headerErrors.push({ row: 1, field: 'header', message: `Duplicate column name(s): ${[...new Set(dupHeaders)].join(', ')}.` });
  }
  for (const missing of resolution.missingRequired) {
    headerErrors.push({
      row: 1,
      field: missing,
      message: `Required column "${missing}" is missing. Accepted header names: ${FIELD_ALIASES[missing].join(', ')}.`,
    });
  }

  // Required columns must not smuggle personal/card data (e.g. card numbers used as transaction ids).
  for (const field of REQUIRED_FIELDS) {
    const idx = resolution.required[field];
    if (idx === undefined || field === 'amount' || field === 'is_fraud' || field === 'timestamp') continue;
    const kind = sensitiveKindFromValues(dataRows.slice(0, 300).map((r) => r[idx] ?? ''));
    if (kind) {
      headerErrors.push({
        row: 1,
        field,
        message: `Column "${headers[idx]}" (${field}) appears to contain ${SENSITIVE_KIND_LABEL[kind]} values. Replace them with anonymous identifiers – real card or personal data must not be uploaded.`,
      });
    }
  }

  // ---- Classify every non-required column: sensitive (drop), label-derived/id (exclude), numeric feature, or ignored.
  const droppedColumns: DroppedColumn[] = [];
  const requiredIdx = new Set(Object.values(resolution.required) as number[]);
  const featureIdx: number[] = [];
  const sensitiveIdx = new Set<number>();

  headers.forEach((h, idx) => {
    if (requiredIdx.has(idx)) return;
    const colValues = dataRows.slice(0, 300).map((r) => r[idx] ?? '');
    const sensitive: SensitiveKind | null = sensitiveKindFromName(h) ?? sensitiveKindFromValues(colValues);
    if (sensitive) {
      sensitiveIdx.add(idx);
      droppedColumns.push({ column: h, reason: 'sensitive', detail: `Looks like ${SENSITIVE_KIND_LABEL[sensitive]} – dropped and never displayed.` });
      return;
    }
    if (idx === resolution.merchantNameIndex) return; // display-only
    const forbidden = forbiddenFeatureReason(h);
    if (forbidden) {
      droppedColumns.push({
        column: h,
        reason: forbidden === 'identifier' ? 'identifier' : 'label_derived',
        detail: forbidden === 'identifier' ? 'Identifier column – excluded from model features.' : 'Label or label-derived column – excluded from model features to prevent leakage.',
      });
      return;
    }
    const nonBlank = colValues.filter((v) => v.trim() !== '');
    const numericShare = nonBlank.length ? nonBlank.filter((v) => parseFeatureValue(v) !== 'invalid').length / nonBlank.length : 0;
    if (nonBlank.length > 0 && numericShare >= 0.95) {
      featureIdx.push(idx);
    } else {
      droppedColumns.push({ column: h, reason: 'non_numeric', detail: 'Non-numeric optional column – ignored (only numeric feature columns are used).' });
    }
  });

  // The merchant name column is display-only; also double check it does not hold PII-like values.
  let merchantIdx = resolution.merchantNameIndex;
  if (merchantIdx !== null && sensitiveIdx.has(merchantIdx)) merchantIdx = null;

  const featureColumns = featureIdx.map((i) => headers[i]);
  // Hard guard: the label / id columns can never be features, whatever they were called.
  assertNoLabelLeakage(featureColumns, [
    headers[resolution.required.is_fraud ?? -1],
    headers[resolution.required.transaction_id ?? -1],
  ]);

  if (headerErrors.length > 0) {
    const r = emptyResult(headers, headerErrors, dataRows.length);
    r.droppedColumns = droppedColumns;
    return r;
  }

  const col = resolution.required as Record<RequiredField, number>;
  const errors: CsvValidationIssue[] = [];
  const skippedByField: Record<string, number> = {};
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  const valid: Transaction[] = [];
  let invalidFeatureCells = 0;
  let invalidRows = 0;

  const fail = (row: number, field: string, message: string, sampleValue?: string) => {
    invalidRows++;
    skippedByField[field] = (skippedByField[field] ?? 0) + 1;
    if (errors.length < maxIssues) {
      // Never echo values from sensitive columns; required-field samples are truncated.
      errors.push({ row, field, message, sampleValue: sampleValue === undefined ? undefined : sampleValue.slice(0, 40) });
    }
  };

  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    const line = r + 2;
    if (row.length !== headers.length) {
      fail(line, 'row', `Row has ${row.length} fields but the header has ${headers.length}.`);
      continue;
    }
    const id = (row[col.transaction_id] ?? '').trim();
    if (!id) { fail(line, 'transaction_id', 'transaction_id is blank.'); continue; }
    if (seenIds.has(id)) { fail(line, 'transaction_id', 'Duplicate transaction_id – row skipped.', id); continue; }

    const rawTs = row[col.timestamp] ?? '';
    const ts = parseTimestamp(rawTs);
    if (ts === null) { fail(line, 'timestamp', 'Unparseable timestamp (use ISO-8601, "YYYY-MM-DD HH:MM:SS" UTC, or epoch seconds).', rawTs); continue; }

    const rawAmount = row[col.amount] ?? '';
    const amount = parseAmount(rawAmount);
    if (amount === null) { fail(line, 'amount', 'Amount is not a number.', rawAmount); continue; }
    if (!(amount > 0)) { fail(line, 'amount', 'Amount must be a positive number (> 0).', rawAmount); continue; }

    const category = (row[col.merchant_category] ?? '').trim();
    if (!category) { fail(line, 'merchant_category', 'merchant_category is blank.'); continue; }

    const rawLabel = row[col.is_fraud];
    const label = parseFraudLabel(rawLabel);
    if (label === 'invalid') { fail(line, 'is_fraud', 'is_fraud must be 0, 1, true, false or blank (unlabelled).', rawLabel); continue; }

    const features: Record<string, number> = {};
    for (const fi of featureIdx) {
      const v = parseFeatureValue(row[fi]);
      if (v === 'invalid') {
        invalidFeatureCells++;
        features[headers[fi]] = NaN; // treated as missing, imputed from train medians
      } else {
        features[headers[fi]] = v;
      }
    }

    seenIds.add(id);
    const merchantRaw = merchantIdx !== null ? (row[merchantIdx] ?? '').trim() : '';
    valid.push({
      id,
      timestamp: new Date(ts).toISOString(),
      amount: Math.round(amount * 100) / 100,
      category,
      merchant: merchantRaw || category,
      features,
      groundTruthLabel: label,
      predictedProbability: 0,
      origin,
      labelArrivalDays: simulatedLabelLagDays(id),
      status: 'Pending Review',
      shapBreakdown: [],
      sourceRow: line,
    });
  }

  if (invalidFeatureCells > 0) {
    warnings.push(`${invalidFeatureCells} non-numeric value(s) in optional feature columns were treated as missing and imputed with training-split medians.`);
  }
  const sensitiveDropped = droppedColumns.filter((d) => d.reason === 'sensitive');
  if (sensitiveDropped.length) {
    warnings.push(`Privacy: ${sensitiveDropped.length} column(s) that look like personal or card data were dropped and will not be displayed or used (${sensitiveDropped.map((d) => d.column).join(', ')}). FraudLens never needs card numbers, CVVs, names, emails, phones or addresses.`);
  }

  // ---- Chronological 60/20/20 split
  const split = chronologicalSplit(valid);
  split.train.forEach((t) => (t.split = 'train'));
  split.validation.forEach((t) => (t.split = 'validation'));
  split.test.forEach((t) => (t.split = 'test'));
  const transactions = [...split.train, ...split.validation, ...split.test];

  const labelled = transactions.filter((t) => t.groundTruthLabel !== null);
  const fraudCount = labelled.filter((t) => t.groundTruthLabel === 1).length;
  const legitimateCount = labelled.length - fraudCount;
  const unlabelledCount = transactions.length - labelled.length;
  if (unlabelledCount > 0) {
    warnings.push(`${unlabelledCount} row(s) have a blank is_fraud label. They are kept and scored, shown as "Pending/Unknown", and excluded from training and evaluation.`);
  }

  if (transactions.length < minValidRows) {
    headerErrors.push({ row: 0, field: 'file', message: `Only ${transactions.length} valid row(s); at least ${minValidRows} are needed for a chronological 60/20/20 split.` });
  }
  const trainLabelled = split.train.filter((t) => t.groundTruthLabel !== null);
  const trainFrauds = trainLabelled.filter((t) => t.groundTruthLabel === 1).length;
  if (transactions.length >= minValidRows && (trainFrauds === 0 || trainFrauds === trainLabelled.length)) {
    headerErrors.push({ row: 0, field: 'is_fraud', message: 'The training split (earliest 60% by time) must contain both fraud (1) and legitimate (0) labelled rows.' });
  }

  const startStamp = transactions[0]?.timestamp ?? '';
  const endStamp = transactions[transactions.length - 1]?.timestamp ?? '';
  const durationDays = startStamp && endStamp
    ? Math.max(1, Math.round((Date.parse(endStamp) - Date.parse(startStamp)) / 86400000))
    : 0;

  const fraudsIn = (xs: Transaction[]) => xs.filter((t) => t.groundTruthLabel === 1).length;

  return {
    isValid: headerErrors.length === 0 && transactions.length > 0,
    totalRowsRead: dataRows.length,
    validRowsCount: transactions.length,
    invalidRowsCount: invalidRows,
    skippedByField,
    labelledCount: labelled.length,
    unlabelledCount,
    fraudCount,
    legitimateCount,
    fraudRatePercent: labelled.length > 0 ? Math.round((fraudCount / labelled.length) * 10000) / 100 : 0,
    dateRange: { start: startStamp.slice(0, 10), end: endStamp.slice(0, 10), durationDays },
    detectedColumns: headers.filter((_, i) => !sensitiveIdx.has(i)),
    mappedColumns: Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, headers[col[f]]])),
    featureColumns,
    droppedColumns,
    headerErrors,
    errors,
    warnings,
    transactions,
    splits: {
      train: split.train,
      validation: split.validation,
      test: split.test,
      summary: {
        trainCount: split.train.length,
        trainFrauds: fraudsIn(split.train),
        trainDateRange: formatDateRange(split.train),
        valCount: split.validation.length,
        valFrauds: fraudsIn(split.validation),
        valDateRange: formatDateRange(split.validation),
        testCount: split.test.length,
        testFrauds: fraudsIn(split.test),
        testDateRange: formatDateRange(split.test),
      },
    },
  };
}
