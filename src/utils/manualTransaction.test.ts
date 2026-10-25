import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAndValidateTransactionCsv, generateSampleCsvString } from './csvParser.ts';
import { trainPipeline, evaluateModels, explainRow, buildTrainingData } from './pipeline.ts';
import {
  appendManualTransaction,
  buildManualFormSpec,
  checkManualTransaction,
  excludeManual,
  transactionSource,
  validateManualInput,
  type ManualFormValues,
} from './manualTransaction.ts';
import { generateSyntheticStreamTransaction, nextReplayRow, pushToStreamBuffer } from './syntheticStream.ts';
import { mulberry32 } from '../data/syntheticSample.ts';
import { MODEL_NAMES, type Transaction } from '../types/fraud.ts';

// One real training run on the bundled sample, shared by all tests (same path as the app).
const parse = parseAndValidateTransactionCsv(generateSampleCsvString(), { origin: 'synthetic_sample' });
const bundle = trainPipeline(parse.transactions, parse.featureColumns, ['is_fraud', 'transaction_id']);
const train = parse.transactions.filter((t) => t.split === 'train');
const spec = buildManualFormSpec(bundle, train, Date.UTC(2025, 5, 1, 14, 30));

const validValues = (): ManualFormValues => ({
  amount: '1899.00',
  timestamp: '2025-06-01T03:15',
  category: 'Electronics',
  features: { distance_km: '412.8', velocity_1h: '5', device_score: '30', is_online: '1', foreign_country: '1' },
});

test('form spec mirrors the real fitted feature space (no guessed fields)', () => {
  assert.deepEqual(spec.numericFields.map((f) => f.column), bundle.featureSpace.numericColumns);
  assert.deepEqual(bundle.featureSpace.numericColumns, ['distance_km', 'velocity_1h', 'device_score', 'is_online', 'foreign_country']);
  const kinds = Object.fromEntries(spec.numericFields.map((f) => [f.column, f.kind]));
  assert.equal(kinds.is_online, 'binary');
  assert.equal(kinds.foreign_country, 'binary');
  assert.equal(kinds.velocity_1h, 'integer');
  assert.deepEqual(spec.encodedFeatureNames, bundle.featureSpace.names);
  for (const c of bundle.featureSpace.categories) assert.ok(spec.categories.includes(c));
  // No sensitive / identity fields anywhere in the form
  const all = ['amount', 'timestamp', 'category', ...spec.numericFields.map((f) => f.column)].join(' ');
  assert.doesNotMatch(all, /card|cvv|cvc|name|email|password|pin|fraud|label/i);
  // Defaults are themselves valid
  assert.equal(validateManualInput(spec.defaults, spec).ok, true);
  assert.equal(spec.defaults.amount, spec.amountMedian.toFixed(2));
});

test('valid input -> prediction via the real pipeline equals calling the model directly', () => {
  for (const name of MODEL_NAMES) {
    const r = checkManualTransaction({ bundle, modelName: name, threshold: 0.42, values: validValues(), spec });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const input = {
      amount: 1899,
      timestamp: '2025-06-01T03:15:00.000Z',
      category: 'Electronics',
      features: { distance_km: 412.8, velocity_1h: 5, device_score: 30, is_online: 1, foreign_country: 1 },
    };
    const direct = bundle.models[name].predict(bundle.featureSpace.transform(input));
    assert.equal(r.probability, direct, `${name}: manual path must equal direct predict`);
    assert.equal(r.flagged, direct >= 0.42);
    assert.equal(r.verdict, direct >= 0.42 ? 'Suspicious' : 'Legitimate');
    assert.deepEqual(r.explanation, explainRow(bundle, name, input));
    assert.deepEqual(r.derivedFeatures.map((d) => d.name), bundle.featureSpace.names);
    assert.deepEqual(Float64Array.from(r.derivedFeatures.map((d) => d.value)), bundle.featureSpace.transform(input));
    assert.equal(r.transaction.origin, 'manual_entry');
    assert.equal(r.transaction.source, 'manual');
    assert.equal(r.transaction.groundTruthLabel, null);
    assert.equal(r.transaction.split, undefined);
  }
});

test('timestamp is read as UTC and only its hour reaches the model', () => {
  const a = checkManualTransaction({ bundle, modelName: 'LightGBM', threshold: 0.5, values: { ...validValues(), timestamp: '2025-06-01T03:15' }, spec });
  const b = checkManualTransaction({ bundle, modelName: 'LightGBM', threshold: 0.5, values: { ...validValues(), timestamp: '2025-09-17T03:15' }, spec });
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) {
    assert.equal(a.transaction.timestamp, '2025-06-01T03:15:00.000Z');
    assert.equal(a.probability, b.probability);
  }
});

test('invalid input -> useful per-field messages, no prediction', () => {
  const bad: ManualFormValues = {
    amount: '-5',
    timestamp: '2025-02-31T10:00',
    category: 'Not a category',
    features: { distance_km: 'abc', velocity_1h: '2.5', device_score: '', is_online: '3', foreign_country: '-1' },
  };
  const r = checkManualTransaction({ bundle, modelName: 'LightGBM', threshold: 0.5, values: bad, spec });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'invalid_input');
  assert.match(r.errors.amount, /greater than 0/);
  assert.match(r.errors.timestamp, /valid date and time/);
  assert.match(r.errors.category, /known to the active dataset/);
  assert.match(r.errors.distance_km, /must be a number/);
  assert.match(r.errors.velocity_1h, /whole number/);
  assert.match(r.errors.device_score, /Enter a value/);
  assert.match(r.errors.is_online, /Yes \(1\) or No \(0\)/);
  assert.match(r.errors.foreign_country, /Yes \(1\) or No \(0\)/);
  assert.match(validateManualInput({ ...validValues(), amount: '' }, spec).errors.amount, /Enter an amount/);
  assert.match(validateManualInput({ ...validValues(), amount: '0' }, spec).errors.amount, /greater than 0/);
  assert.match(validateManualInput({ ...validValues(), timestamp: '' }, spec).errors.timestamp, /Enter a date/);
  assert.match(validateManualInput({ ...validValues(), timestamp: '1900-01-01T00:00' }, spec).errors.timestamp, /between 1970 and 2100/);
  assert.match(validateManualInput({ ...validValues(), features: { ...validValues().features, distance_km: '-3' } }, spec).errors.distance_km, /cannot be negative/);
  // out-of-range but plausible values are allowed with a warning, not silently clamped
  const w = validateManualInput({ ...validValues(), features: { ...validValues().features, distance_km: '99999' } }, spec);
  assert.equal(w.ok, true);
  assert.ok(w.warnings.some((m) => /outside the training range/.test(m)));
});

test('missing model -> clear error, never a fabricated score', () => {
  const r = checkManualTransaction({ bundle: null, modelName: 'LightGBM', threshold: 0.5, values: validValues(), spec: null });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'model_unavailable');
  assert.match(r.message, /No trained model is loaded/);
  assert.equal('probability' in r, false);
});

// ---- stream isolation. Replays the same interval steps ChronoContext uses (nextReplayRow / pushToStreamBuffer).
interface StreamState { buffer: Transaction[]; testIndex: number; processed: number }
const CAP = 60;
const testRows = parse.transactions.filter((t) => t.split === 'test');
function tickReplay(s: StreamState): StreamState {
  const step = nextReplayRow(testRows, s.testIndex);
  if (!step) return s;
  return { buffer: pushToStreamBuffer(s.buffer, [step.row], CAP), testIndex: step.nextIndex, processed: s.processed + 1 };
}
function tickSynthetic(s: StreamState, rand: () => number): StreamState {
  const tx = generateSyntheticStreamTransaction(train, rand);
  return tx ? { ...s, buffer: pushToStreamBuffer(s.buffer, [tx], CAP), processed: s.processed + 1 } : s;
}
const seed: StreamState = { buffer: testRows.slice(0, 20).reverse(), testIndex: 20, processed: 20 };
const submit = (manual: Transaction[], i: number) => {
  const r = checkManualTransaction({ bundle, modelName: 'XGBoost', threshold: 0.5, values: { ...validValues(), amount: String(10 + i) }, spec, nowMs: Date.UTC(2025, 5, 1) + i });
  assert.ok(r.ok);
  return r.ok ? appendManualTransaction(manual, r.transaction) : manual;
};

test('manual submission while the stream is STOPPED leaves stream state identical', () => {
  const frozen = structuredClone(seed);
  let manual: Transaction[] = [];
  for (let i = 0; i < 5; i++) manual = submit(manual, i);
  assert.equal(manual.length, 5);
  assert.deepEqual(seed, frozen, 'stream buffer / index / processed count untouched');
  assert.ok(seed.buffer.every((t) => t.origin !== 'manual_entry'));
});

test('manual submission while the stream is RUNNING does not reset, restart, duplicate or interrupt it', () => {
  // reference run: 150 replay ticks (wraps past the buffer cap), no manual input
  let ref = seed;
  for (let i = 0; i < 150; i++) ref = tickReplay(ref);
  // same run with a manual check between every few ticks
  let s = seed;
  let manual: Transaction[] = [];
  for (let i = 0; i < 150; i++) {
    s = tickReplay(s);
    if (i % 7 === 0) manual = submit(manual, i);
  }
  assert.deepEqual(s.buffer.map((t) => t.id), ref.buffer.map((t) => t.id));
  assert.equal(s.testIndex, ref.testIndex);
  assert.equal(s.processed, ref.processed);
  assert.equal(new Set(s.buffer.map((t) => t.id)).size, s.buffer.length, 'no duplicate ids in the buffer');
  assert.ok(s.buffer.every((t) => t.origin !== 'manual_entry'), 'manual rows never enter the stream buffer');
  assert.equal(manual.length, 22);
  assert.equal(new Set(manual.map((t) => t.id)).size, manual.length, 'each manual check recorded exactly once');

  // synthetic stream mode: identical sequence with or without manual checks (same seed)
  let a: StreamState = { buffer: [], testIndex: 0, processed: 0 };
  let b: StreamState = { buffer: [], testIndex: 0, processed: 0 };
  const ra = mulberry32(7);
  const rb = mulberry32(7);
  let m2: Transaction[] = [];
  for (let i = 0; i < 40; i++) {
    a = tickSynthetic(a, ra);
    b = tickSynthetic(b, rb);
    if (i % 5 === 0) m2 = submit(m2, i);
  }
  assert.deepEqual(b.buffer.map((t) => [t.amount, t.category, t.features]), a.buffer.map((t) => [t.amount, t.category, t.features]));
  assert.equal(b.processed, a.processed);
});

test('appendManualTransaction is immutable, newest-first, capped and manual-only', () => {
  const r1 = checkManualTransaction({ bundle, modelName: 'LightGBM', threshold: 0.5, values: validValues(), spec });
  const r2 = checkManualTransaction({ bundle, modelName: 'LightGBM', threshold: 0.5, values: validValues(), spec });
  assert.ok(r1.ok && r2.ok);
  if (!r1.ok || !r2.ok) return;
  assert.notEqual(r1.transaction.id, r2.transaction.id);
  const empty: Transaction[] = [];
  const l1 = appendManualTransaction(empty, r1.transaction);
  const l2 = appendManualTransaction(l1, r2.transaction);
  assert.equal(empty.length, 0);
  assert.equal(l1.length, 1);
  assert.deepEqual(l2.map((t) => t.id), [r2.transaction.id, r1.transaction.id]);
  assert.equal(appendManualTransaction(l2, r2.transaction).length, 2, 're-adding the same id does not duplicate');
  assert.equal(appendManualTransaction(l2, r1.transaction, 1).length, 1);
  assert.throws(() => appendManualTransaction(l2, testRows[0]), /only accepts manual rows/);
});

test('manual vs simulated vs dataset rows are distinguishable, and manual rows never reach training or metrics', () => {
  const r = checkManualTransaction({ bundle, modelName: 'LightGBM', threshold: 0.5, values: validValues(), spec });
  assert.ok(r.ok);
  if (!r.ok) return;
  const sim = generateSyntheticStreamTransaction(train, mulberry32(1));
  assert.ok(sim);
  assert.equal(transactionSource(r.transaction), 'manual');
  assert.equal(transactionSource(sim!), 'simulated');
  assert.equal(transactionSource(testRows[0]), 'dataset_replay');
  assert.deepEqual(excludeManual([r.transaction, sim!, testRows[0]]).map((t) => t.id), [sim!.id, testRows[0].id]);

  // Even if a manual row were mixed into the rows handed to training/evaluation, it is ignored:
  // it has no split and no label.
  const mixed = [...parse.transactions, { ...r.transaction }];
  const td = buildTrainingData(mixed.filter((t) => t.split === 'train'), bundle.featureSpace);
  assert.equal(td.data.X.length, bundle.trainRowsUsed);
  const evBase = evaluateModels(bundle, parse.transactions, 20, 50, 'Test');
  const bundleMixed = { ...bundle, probabilities: Object.fromEntries(MODEL_NAMES.map((n) => [n, Float64Array.from([...bundle.probabilities[n], 0.99])])) as typeof bundle.probabilities };
  const evMixed = evaluateModels(bundleMixed, mixed, 20, 50, 'Test');
  for (const n of MODEL_NAMES) {
    assert.equal(evMixed[n].evaluatedCount, evBase[n].evaluatedCount);
    assert.equal(evMixed[n].prAuc, evBase[n].prAuc);
    assert.equal(evMixed[n].threshold, evBase[n].threshold);
  }
});
