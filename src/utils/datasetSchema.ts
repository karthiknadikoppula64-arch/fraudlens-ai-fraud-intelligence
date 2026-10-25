/**
 * Column schema, aliases and privacy rules for historical transaction CSVs.
 */
import { forbiddenFeatureReason, normaliseColumnName } from './featureGuard.ts';

export type RequiredField = 'transaction_id' | 'timestamp' | 'amount' | 'merchant_category' | 'is_fraud';

export const REQUIRED_FIELDS: RequiredField[] = ['transaction_id', 'timestamp', 'amount', 'merchant_category', 'is_fraud'];

/** Accepted header aliases (normalised: lower-case, spaces/dashes -> underscores). First entry is canonical. */
export const FIELD_ALIASES: Record<RequiredField, string[]> = {
  transaction_id: ['transaction_id', 'id', 'txn_id', 'tx_id', 'trans_num', 'trans_id', 'transactionid'],
  timestamp: ['timestamp', 'trans_date_trans_time', 'datetime', 'transaction_time', 'txn_time', 'date', 'time'],
  amount: ['amount', 'amt', 'trans_amount', 'transaction_amount', 'tx_amount'],
  merchant_category: ['merchant_category', 'category', 'merchant_cat', 'mcc_category', 'category_name'],
  is_fraud: ['is_fraud', 'isfraud', 'fraud', 'label', 'class', 'target', 'ground_truth_label'],
};

/** Optional display-only merchant name column (not a model feature). */
export const MERCHANT_NAME_ALIASES = ['merchant', 'merchant_name'];

export type SensitiveKind = 'card_number' | 'cvv' | 'name' | 'email' | 'phone' | 'address' | 'government_id' | 'credential' | 'date_of_birth';

const SENSITIVE_NAME_RULES: { kind: SensitiveKind; test: (n: string) => boolean }[] = [
  { kind: 'card_number', test: (n) => /(^|_)(cc_?num|card_?num(ber)?|card_?no|pan|credit_?card(_?number)?|debit_?card|account_?number|acct_?num|iban)($|_)/.test(n) },
  { kind: 'cvv', test: (n) => /(^|_)(cvv2?|cvc2?|cid|security_?code|card_?verification)($|_)/.test(n) },
  { kind: 'credential', test: (n) => /(^|_)(password|passwd|pwd|pin|otp|secret|username|login)($|_)/.test(n) },
  { kind: 'email', test: (n) => /e_?mail/.test(n) },
  { kind: 'phone', test: (n) => /(^|_)(phone|mobile|cell|tel|telephone|msisdn)($|_)/.test(n) },
  { kind: 'name', test: (n) => /(^|_)(first|last|full|given|family|middle|sur)?_?name($|_)/.test(n) && !/(merchant|category|cat|feature|file)_?name/.test(n) || /(^|_)(cardholder|card_holder|customer|holder|first|last|surname)($|_)/.test(n) },
  { kind: 'address', test: (n) => /(^|_)(address|addr|street|zip|zipcode|zip_code|postcode|postal_?code|house_?number|apartment)($|_)/.test(n) },
  { kind: 'address', test: (n) => !n.startsWith('merch') && /(^|_)(lat|long|lng|latitude|longitude|city|geo_?location|ip_?address|ip)($|_)/.test(n) },
  { kind: 'government_id', test: (n) => /(^|_)(ssn|social_security|passport|national_id|tax_id|aadhaar|pan_card|driver_?license)($|_)/.test(n) },
  { kind: 'date_of_birth', test: (n) => /(^|_)(dob|date_of_birth|birth_?date|birthday)($|_)/.test(n) },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[\d\s().-]{10,16}$/;

/** Luhn checksum – used to detect values that look like real card numbers. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function looksLikeCardNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  return /^\d{13,19}$/.test(digits) && passesLuhn(digits);
}

/** Detect a sensitive column from its header name. */
export function sensitiveKindFromName(header: string): SensitiveKind | null {
  const n = normaliseColumnName(header);
  for (const rule of SENSITIVE_NAME_RULES) if (rule.test(n)) return rule.kind;
  return null;
}

/** Detect a sensitive column from a sample of its values (card numbers / emails / phone numbers). */
export function sensitiveKindFromValues(values: string[]): SensitiveKind | null {
  const sample = values.filter((v) => v && v.trim() !== '').slice(0, 200);
  if (sample.length < 3) return null;
  const share = (pred: (v: string) => boolean) => sample.filter(pred).length / sample.length;
  if (share(looksLikeCardNumber) >= 0.5) return 'card_number';
  if (share((v) => EMAIL_RE.test(v.trim())) >= 0.5) return 'email';
  if (share((v) => PHONE_RE.test(v.trim()) && /[\s()+-]/.test(v) && v.replace(/\D/g, '').length >= 10) >= 0.6) return 'phone';
  return null;
}

export const SENSITIVE_KIND_LABEL: Record<SensitiveKind, string> = {
  card_number: 'card / account number',
  cvv: 'card security code (CVV/CVC)',
  name: 'personal name',
  email: 'email address',
  phone: 'phone number',
  address: 'postal address',
  government_id: 'government ID',
  credential: 'password / PIN / credential',
  date_of_birth: 'date of birth',
};

export interface ColumnResolution {
  headers: string[];
  required: Partial<Record<RequiredField, number>>;
  merchantNameIndex: number | null;
  missingRequired: RequiredField[];
}

export function resolveRequiredColumns(headers: string[]): ColumnResolution {
  const norm = headers.map(normaliseColumnName);
  const required: Partial<Record<RequiredField, number>> = {};
  const used = new Set<number>();
  for (const field of REQUIRED_FIELDS) {
    for (const alias of FIELD_ALIASES[field]) {
      const idx = norm.findIndex((h, i) => h === alias && !used.has(i));
      if (idx >= 0) {
        required[field] = idx;
        used.add(idx);
        break;
      }
    }
  }
  let merchantNameIndex: number | null = null;
  for (const alias of MERCHANT_NAME_ALIASES) {
    const idx = norm.findIndex((h, i) => h === alias && !used.has(i));
    if (idx >= 0) {
      merchantNameIndex = idx;
      break;
    }
  }
  return {
    headers,
    required,
    merchantNameIndex,
    missingRequired: REQUIRED_FIELDS.filter((f) => required[f] === undefined),
  };
}

export { forbiddenFeatureReason };

/**
 * Example rows shown in the "Expected CSV format" help panel. Kept here (not inline in the
 * component) so a unit test can assert that the documented example really parses.
 */
export const EXAMPLE_CSV = `transaction_id,timestamp,amount,merchant_category,is_fraud,distance_km,velocity_1h
TX-0001,2025-03-01T09:15:00Z,42.50,Grocery,0,3.2,1
TX-0002,2025-03-01T09:17:30Z,1899.00,Electronics,1,412.8,5
TX-0003,2025-03-01T09:21:05Z,18.75,Restaurant,,6.1,1`;
