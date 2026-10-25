/**
 * Synthetic live-stream generator (clearly labelled "Simulated").
 *
 * Kept strictly separate from historical evaluation: generated rows are never added to the
 * dataset, never used for training/threshold tuning/metrics, and always carry label = null
 * ("Pending/Unknown") because no real outcome exists for them.
 *
 * New rows are produced by resampling the feature profile of a random TRAIN-split row and
 * jittering its numeric values. For the "attack surge" button, templates are taken from
 * confirmed-fraud train rows (this only shapes the simulated input – the label is not attached).
 */
import type { Transaction } from '../types/fraud.ts';

let counter = 0;

export function generateSyntheticStreamTransaction(templates: Transaction[], rand: () => number = Math.random): Transaction | null {
  if (templates.length === 0) return null;
  const tpl = templates[Math.floor(rand() * templates.length)];
  const jitter = (v: number) => (Number.isFinite(v) ? Math.round(v * (0.85 + rand() * 0.3) * 100) / 100 : v);
  const features: Record<string, number> = {};
  for (const [k, v] of Object.entries(tpl.features)) {
    // keep binary flags binary
    features[k] = v === 0 || v === 1 ? v : jitter(v);
  }
  counter = (counter + 1) % 100000;
  const id = `SIM-${Date.now().toString(36).toUpperCase()}-${String(counter).padStart(5, '0')}`;
  return {
    id,
    timestamp: new Date().toISOString(),
    amount: Math.max(0.5, jitter(tpl.amount)),
    category: tpl.category,
    merchant: tpl.category,
    features,
    groundTruthLabel: null,
    predictedProbability: 0,
    origin: 'synthetic_stream',
    source: 'simulated',
    labelArrivalDays: tpl.labelArrivalDays,
    status: 'Pending Review',
    shapBreakdown: [],
  };
}

/**
 * Pure live-stream steps (used by ChronoContext's interval and by tests).
 * They only ever see the stream buffer / replay index – manual checks live in a separate list.
 */
export function nextReplayRow<T>(testRows: readonly T[], index: number): { row: T; nextIndex: number } | null {
  if (testRows.length === 0) return null;
  const idx = index % testRows.length;
  return { row: testRows[idx], nextIndex: idx + 1 };
}

/** Prepends rows (newest first), drops older copies of the same ids, caps the buffer. */
export function pushToStreamBuffer<T extends { id: string }>(buffer: readonly T[], rows: readonly T[], cap: number): T[] {
  const ids = new Set(rows.map((r) => r.id));
  return [...rows, ...buffer.filter((b) => !ids.has(b.id))].slice(0, cap);
}
