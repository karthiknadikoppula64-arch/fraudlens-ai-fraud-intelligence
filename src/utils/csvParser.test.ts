import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsvRows,
  parseAndValidateTransactionCsv,
  parseTimestamp,
  parseFraudLabel,
  generateSampleCsvString,
} from './csvParser.ts';

const iso = (day: number, hour = 12) => new Date(Date.UTC(2025, 0, 1 + day, hour, 0, 0)).toISOString();

/** Builds a valid CSV with `n` rows (every 5th row fraud) plus optional extra columns. */
function makeCsv(n: number, extraHeader = '', extraValue: (i: number) => string = () => ''): string {
  const header = `transaction_id,timestamp,amount,merchant_category,is_fraud,distance_km${extraHeader ? ',' + extraHeader : ''}`;
  const lines = [header];
  for (let i = 0; i < n; i++) {
    lines.push(`TX-${i},${iso(i)},${(10 + i).toFixed(2)},${i % 2 ? 'Grocery' : 'Electronics'},${i % 5 === 0 ? 1 : 0},${i}${extraHeader ? ',' + extraValue(i) : ''}`);
  }
  return lines.join('\n');
}

test('parseCsvRows handles quotes, escaped quotes and CRLF', () => {
  const rows = parseCsvRows('id,name,amount\r\n1,"Smith, ""J""",120.50\r\n2,"Normal",50.00\r\n');
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1], 'Smith, "J"');
  assert.equal(rows[2][2], '50.00');
});

test('missing required columns are reported as file-level errors', () => {
  const result = parseAndValidateTransactionCsv('id,merchant,amount\n1,Store,100');
  assert.equal(result.isValid, false);
  const fields = result.headerErrors.map((e) => e.field);
  for (const f of ['timestamp', 'merchant_category', 'is_fraud']) assert.ok(fields.includes(f), `expected error for ${f}`);
  assert.equal(result.transactions.length, 0);
});

test('timestamp parsing: ISO, naive UTC, epoch; rejects garbage and impossible dates', () => {
  assert.equal(parseTimestamp('2025-03-01 10:00:00'), Date.UTC(2025, 2, 1, 10));
  assert.equal(parseTimestamp(iso(0)), Date.parse(iso(0)));
  assert.equal(parseTimestamp('1735732800'), 1735732800 * 1000);
  assert.equal(parseTimestamp('not a date'), null);
  assert.equal(parseTimestamp('2025-02-31 10:00'), null);
  assert.equal(parseTimestamp('7'), null);
  assert.equal(parseTimestamp(''), null);
});

test('fraud labels accept {0,1,true,false}; blank = unlabelled; others invalid', () => {
  assert.equal(parseFraudLabel('1'), 1);
  assert.equal(parseFraudLabel('TRUE'), 1);
  assert.equal(parseFraudLabel('0'), 0);
  assert.equal(parseFraudLabel('false'), 0);
  assert.equal(parseFraudLabel(''), null);
  assert.equal(parseFraudLabel('  '), null);
  assert.equal(parseFraudLabel('2'), 'invalid');
  assert.equal(parseFraudLabel('maybe'), 'invalid');
});

test('bad rows are skipped and counted per field; unlabelled rows are kept', () => {
  const lines = makeCsv(40).split('\n');
  lines.push(`BAD-TS,yesterday,10.00,Grocery,0,1`);
  lines.push(`BAD-AMT-NEG,${iso(41)},-5,Grocery,0,1`);
  lines.push(`BAD-AMT-TXT,${iso(42)},abc,Grocery,0,1`);
  lines.push(`BAD-AMT-ZERO,${iso(43)},0,Grocery,0,1`);
  lines.push(`BAD-LABEL,${iso(44)},10,Grocery,2,1`);
  lines.push(`TX-1,${iso(45)},10,Grocery,0,1`); // duplicate id
  lines.push(`UNLAB,${iso(46)},10,Grocery,,1`);
  const r = parseAndValidateTransactionCsv(lines.join('\n'));
  assert.equal(r.totalRowsRead, 47);
  assert.equal(r.validRowsCount, 41);
  assert.equal(r.invalidRowsCount, 6);
  assert.deepEqual(r.skippedByField, { timestamp: 1, amount: 3, is_fraud: 1, transaction_id: 1 });
  assert.equal(r.unlabelledCount, 1);
  assert.equal(r.transactions.find((t) => t.id === 'UNLAB')?.groundTruthLabel, null);
  assert.ok(r.errors.every((e) => e.row >= 2 && e.message.length > 0));
  assert.equal(r.isValid, true);
});

test('chronological 60/20/20 split is time-ordered even if rows are shuffled', () => {
  const lines = makeCsv(50).split('\n');
  const header = lines.shift() as string;
  lines.reverse();
  const r = parseAndValidateTransactionCsv([header, ...lines].join('\n'));
  assert.equal(r.splits.train.length, 30);
  assert.equal(r.splits.validation.length, 10);
  assert.equal(r.splits.test.length, 10);
  const lastTrain = Date.parse(r.splits.train[29].timestamp);
  const firstVal = Date.parse(r.splits.validation[0].timestamp);
  const lastVal = Date.parse(r.splits.validation[9].timestamp);
  const firstTest = Date.parse(r.splits.test[0].timestamp);
  assert.ok(lastTrain <= firstVal && lastVal <= firstTest);
  assert.equal(r.transactions[0].id, 'TX-0');
  assert.ok(r.transactions.every((t, i) => i === 0 || Date.parse(t.timestamp) >= Date.parse(r.transactions[i - 1].timestamp)));
});

test('sensitive columns (card number, CVV, name, email, phone, address) are dropped and never kept', () => {
  const header = 'transaction_id,timestamp,amount,merchant_category,is_fraud,cc_num,cvv,first,email,phone,street,velocity_1h';
  const lines = [header];
  for (let i = 0; i < 30; i++) {
    lines.push(`T${i},${iso(i)},12.5,Gas,${i % 4 === 0 ? 1 : 0},4111111111111111,123,Alice,a${i}@ex.com,+1 (555) 010-${String(1000 + i)},1 Main St,${i % 3}`);
  }
  const r = parseAndValidateTransactionCsv(lines.join('\n'));
  assert.equal(r.isValid, true);
  const dropped = r.droppedColumns.filter((d) => d.reason === 'sensitive').map((d) => d.column).sort();
  assert.deepEqual(dropped, ['cc_num', 'cvv', 'email', 'first', 'phone', 'street'].sort());
  assert.deepEqual(r.featureColumns, ['velocity_1h']);
  assert.ok(!r.detectedColumns.includes('cc_num'));
  const serialised = JSON.stringify(r.transactions);
  assert.ok(!serialised.includes('4111111111111111') && !serialised.includes('@ex.com') && !serialised.includes('Main St'));
  assert.ok(r.warnings.some((w) => w.startsWith('Privacy')));
});

test('unnamed column holding card numbers is detected by value (Luhn) and dropped', () => {
  const r = parseAndValidateTransactionCsv(makeCsv(30, 'ref', () => '4242 4242 4242 4242'));
  assert.ok(r.droppedColumns.some((d) => d.column === 'ref' && d.reason === 'sensitive'));
  assert.ok(!r.featureColumns.includes('ref'));
});

test('card numbers used as transaction_id are rejected', () => {
  const lines = ['transaction_id,timestamp,amount,merchant_category,is_fraud'];
  for (let i = 0; i < 30; i++) lines.push(`4111111111111111,${iso(i)},10,Gas,0`);
  const r = parseAndValidateTransactionCsv(lines.join('\n'));
  assert.equal(r.isValid, false);
  assert.ok(r.headerErrors.some((e) => e.field === 'transaction_id'));
});

test('label-derived columns are excluded from features', () => {
  const r = parseAndValidateTransactionCsv(makeCsv(30, 'fraud_score_v2', (i) => String(i % 5 === 0 ? 0.99 : 0.01)));
  assert.ok(!r.featureColumns.includes('fraud_score_v2'));
  assert.ok(r.droppedColumns.some((d) => d.column === 'fraud_score_v2' && d.reason === 'label_derived'));
});

test('training split must contain both classes', () => {
  const lines = ['transaction_id,timestamp,amount,merchant_category,is_fraud'];
  for (let i = 0; i < 30; i++) lines.push(`T${i},${iso(i)},10,Gas,${i > 25 ? 1 : 0}`);
  const r = parseAndValidateTransactionCsv(lines.join('\n'));
  assert.equal(r.isValid, false);
  assert.ok(r.headerErrors.some((e) => e.field === 'is_fraud'));
});

test('bundled synthetic sample is valid, deterministic and has unlabelled recent rows', () => {
  const csv = generateSampleCsvString();
  assert.equal(csv, generateSampleCsvString(), 'seeded generator must be deterministic');
  const r = parseAndValidateTransactionCsv(csv, { origin: 'synthetic_sample' });
  assert.equal(r.isValid, true);
  assert.equal(r.validRowsCount, 8000);
  assert.equal(r.invalidRowsCount, 0);
  assert.equal(r.splits.train.length, 4800);
  assert.equal(r.splits.validation.length, 1600);
  assert.equal(r.splits.test.length, 1600);
  assert.ok(r.fraudCount > 100);
  assert.ok(r.unlabelledCount > 0);
  assert.deepEqual(r.featureColumns, ['distance_km', 'velocity_1h', 'device_score', 'is_online', 'foreign_country']);
  assert.ok(r.transactions.every((t) => t.origin === 'synthetic_sample'));
});

test('the CSV example shown in the "Expected CSV format" help panel parses as documented', async () => {
  const { EXAMPLE_CSV } = await import('./datasetSchema.ts');
  const r = parseAndValidateTransactionCsv(EXAMPLE_CSV);
  // Too few rows to train on (< 20) is a file-level error, but every example row itself must be valid.
  assert.equal(r.totalRowsRead, 3);
  assert.equal(r.validRowsCount, 3);
  assert.equal(r.invalidRowsCount, 0);
  assert.equal(r.labelledCount, 2);
  assert.equal(r.unlabelledCount, 1);
  assert.deepEqual([...r.featureColumns].sort(), ['distance_km', 'velocity_1h']);
});
