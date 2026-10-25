import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAndValidateTransactionCsv, generateSampleCsvString, simulatedLabelLagDays } from './csvParser.ts';
import { trainPipeline } from './pipeline.ts';
import { computeDelayHorizons, selectDelayedPeriod, filterDelayedRows, type DelayedTxInput } from './delayedLabels.ts';

// Real sample + real LightGBM-style scores, the same inputs the /delayed page uses.
const parse = parseAndValidateTransactionCsv(generateSampleCsvString(), { origin: 'synthetic_sample' });
const bundle = trainPipeline(parse.transactions, parse.featureColumns, ['is_fraud', 'transaction_id']);
const probs = bundle.probabilities.LightGBM;
const test_: DelayedTxInput[] = parse.transactions
  .map((t, i) => ({ ...t, predictedProbability: probs[i] }))
  .filter((t) => t.split === 'test');
const TAU = 0.5;
const HORIZONS = [7, 14, 30, 60];
const labelled = test_.filter((t) => t.groundTruthLabel !== null);
const sel = Object.fromEntries(HORIZONS.map((h) => [h, selectDelayedPeriod(test_, h, TAU)])) as Record<number, ReturnType<typeof selectDelayedPeriod>>;
const availableIds = (h: number) => new Set(sel[h].rows.filter((r) => r.labelStatus === 'available').map((r) => r.id));

test('every horizon (7/14/30/60) selects the same labelled test cohort, chronologically', () => {
  assert.ok(labelled.length > 100);
  for (const h of HORIZONS) {
    const s = sel[h];
    assert.equal(s.counts.total, labelled.length);
    assert.deepEqual(new Set(s.rows.map((r) => r.id)), new Set(labelled.map((t) => t.id)));
    assert.equal(s.excludedUnlabelled, test_.length - labelled.length);
    assert.ok(s.excludedUnlabelled > 0, 'sample has blank-label tail rows in test');
    for (let i = 1; i < s.rows.length; i++) assert.ok(s.rows[i - 1].timestamp <= s.rows[i].timestamp);
    const ts = labelled.map((t) => t.timestamp).sort();
    assert.deepEqual(s.dateRange, { start: ts[0], end: ts[ts.length - 1] });
  }
});

test('label availability per row follows the simulated lag: available iff lag <= H', () => {
  for (const h of HORIZONS) {
    for (const r of sel[h].rows) {
      assert.equal(r.lagDays, simulatedLabelLagDays(r.id));
      assert.equal(r.labelStatus, r.lagDays <= h ? 'available' : 'pending');
      assert.equal(r.predicted, r.score >= TAU ? 'Suspicious' : 'Legitimate');
    }
  }
});

test('7 vs 14 vs 30 vs 60: available sets are strictly nested and distinct; newly-matured sets are disjoint', () => {
  for (let i = 1; i < HORIZONS.length; i++) {
    const a = availableIds(HORIZONS[i - 1]);
    const b = availableIds(HORIZONS[i]);
    for (const id of a) assert.ok(b.has(id), `Day ${HORIZONS[i - 1]} row ${id} must stay available at Day ${HORIZONS[i]}`);
    assert.ok(b.size > a.size, `Day ${HORIZONS[i]} must reveal more labels than Day ${HORIZONS[i - 1]}`);
  }
  // 60 days is the max lag: every label is available, nothing pending
  assert.equal(sel[60].counts.pending, 0);
  assert.equal(sel[60].counts.available, labelled.length);
  // newly matured buckets partition the cohort
  const seen = new Set<string>();
  let sum = 0;
  for (const h of HORIZONS) {
    const newly = filterDelayedRows(sel[h].rows, 'newly');
    assert.equal(newly.length, sel[h].counts.newlyMatured);
    const prev = sel[h].previousHorizon;
    for (const r of newly) {
      assert.ok(!seen.has(r.id));
      seen.add(r.id);
      assert.equal(r.lagDays, h, 'lags are exactly 7/14/30/60, so the newly matured rows have lag = H');
      if (prev !== null) assert.ok(r.lagDays > prev);
    }
    sum += newly.length;
  }
  assert.equal(sum, labelled.length);
  assert.equal(sel[7].previousHorizon, null);
  assert.equal(sel[14].previousHorizon, 7);
  assert.equal(sel[30].previousHorizon, 14);
  assert.equal(sel[60].previousHorizon, 30);
});

test('detail counts and metrics agree with the chart data for all four bars', () => {
  const chart = computeDelayHorizons(labelled.map((t) => ({ probability: t.predictedProbability, label: t.groundTruthLabel as 0 | 1, lagDays: t.labelArrivalDays })), TAU, HORIZONS);
  chart.forEach((bar, i) => {
    const s = sel[HORIZONS[i]];
    assert.equal(s.counts.availableFraud, bar.confirmedFraud);
    assert.equal(s.counts.availableLegit, bar.confirmedLegit);
    assert.equal(s.counts.pending, bar.unconfirmedLatent);
    assert.equal(s.counts.available + s.counts.pending, s.counts.total);
    assert.equal(bar.total, s.counts.total);
    assert.deepEqual(s.metrics, bar);
    // pending frauds are exactly the apparent false negatives/positives the naive convention hides
    assert.equal(s.counts.pendingFraud, labelled.filter((t) => t.groundTruthLabel === 1 && t.labelArrivalDays > HORIZONS[i]).length);
    assert.equal(filterDelayedRows(s.rows, 'available').length, s.counts.available);
    assert.equal(filterDelayedRows(s.rows, 'pending').length, s.counts.pending);
  });
  // with every label known, apparent recall is the true recall at τ
  const tp = labelled.filter((t) => t.groundTruthLabel === 1 && t.predictedProbability >= TAU).length;
  const pos = labelled.filter((t) => t.groundTruthLabel === 1).length;
  assert.equal(sel[60].metrics.apparentRecall, tp / pos);
});

test('empty period / empty dataset is handled without fabricating rows', () => {
  const empty = selectDelayedPeriod([], 14, TAU);
  assert.equal(empty.counts.total, 0);
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.dateRange, null);
  assert.equal(empty.metrics.apparentPrAuc, 0);
  const onlyUnlabelled = selectDelayedPeriod(test_.filter((t) => t.groundTruthLabel === null), 30, TAU);
  assert.equal(onlyUnlabelled.counts.total, 0);
  assert.ok(onlyUnlabelled.excludedUnlabelled > 0);
  // a horizon shorter than every lag: all labelled rows pending
  const early = selectDelayedPeriod(test_, 1, TAU, [1, 7]);
  assert.equal(early.counts.available, 0);
  assert.equal(early.counts.pending, labelled.length);
});
