/**
 * Bundled "Synthetic sample" dataset.
 *
 * A seeded (fully deterministic) generator that produces a CSV in exactly the format users upload.
 * It goes through the same parser / validator / chronological split / training pipeline as uploads.
 * Everything in it is synthetic – no real cardholders, cards or merchants.
 *
 * Design: ~8,000 transactions over 240 days, ~3% fraud. Fraud tactics shift over time
 * (high-value cross-border fraud early, low-value high-velocity card testing later) so that
 * chronological evaluation and the explanation-drift monitor have something real to detect.
 * The most recent 4 days have blank labels (chargebacks not yet matured) to demonstrate "Pending/Unknown".
 */

export const SYNTHETIC_SAMPLE_NAME = 'Synthetic sample (8,000 txns · seeded)';
export const SYNTHETIC_SAMPLE_SEED = 20250101;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const SAMPLE_CATEGORIES: { name: string; weight: number; medianAmount: number; onlineShare: number; fraudLift: number }[] = [
  { name: 'Grocery', weight: 0.22, medianAmount: 45, onlineShare: 0.15, fraudLift: 0.4 },
  { name: 'Restaurant', weight: 0.16, medianAmount: 38, onlineShare: 0.25, fraudLift: 0.5 },
  { name: 'Gas', weight: 0.12, medianAmount: 52, onlineShare: 0.02, fraudLift: 0.7 },
  { name: 'Digital Goods', weight: 0.12, medianAmount: 25, onlineShare: 0.98, fraudLift: 1.8 },
  { name: 'Electronics', weight: 0.1, medianAmount: 240, onlineShare: 0.55, fraudLift: 1.9 },
  { name: 'Travel', weight: 0.09, medianAmount: 420, onlineShare: 0.8, fraudLift: 1.4 },
  { name: 'Jewelry', weight: 0.05, medianAmount: 380, onlineShare: 0.35, fraudLift: 2.3 },
  { name: 'ATM Withdrawal', weight: 0.08, medianAmount: 180, onlineShare: 0.0, fraudLift: 1.2 },
  { name: 'Pharmacy', weight: 0.06, medianAmount: 30, onlineShare: 0.2, fraudLift: 0.5 },
];

export const SAMPLE_HEADERS = [
  'transaction_id', 'timestamp', 'amount', 'merchant_category', 'merchant',
  'distance_km', 'velocity_1h', 'device_score', 'is_online', 'foreign_country', 'is_fraud',
];

export interface SampleOptions {
  rows?: number;
  days?: number;
  seed?: number;
  baseFraudRate?: number;
  unlabelledTailDays?: number;
}

/** Generates the bundled synthetic sample as CSV text. Deterministic for a given seed. */
export function generateSampleCsvString(opts: SampleOptions = {}): string {
  const { rows = 8000, days = 240, seed = SYNTHETIC_SAMPLE_SEED, baseFraudRate = 0.03, unlabelledTailDays = 4 } = opts;
  const rand = mulberry32(seed);
  const start = Date.UTC(2025, 0, 1, 0, 0, 0);
  const totalWeight = SAMPLE_CATEGORIES.reduce((s, c) => s + c.weight, 0);
  const lines: string[] = [SAMPLE_HEADERS.join(',')];

  for (let i = 0; i < rows; i++) {
    // Time: roughly uniform over the window, with a day/night activity profile
    const day = Math.floor((i / rows) * days);
    let hour = clamp(Math.round(13 + gaussian(rand) * 4.5), 0, 23);
    let pick = rand() * totalWeight;
    let cat = SAMPLE_CATEGORIES[0];
    for (const c of SAMPLE_CATEGORIES) {
      pick -= c.weight;
      if (pick <= 0) { cat = c; break; }
    }

    const fraudProb = baseFraudRate * cat.fraudLift;
    const isFraud = rand() < fraudProb;
    // Attack-tactic mix shifts over time: share of "card-testing" fraud grows from day 110 onward
    const cardTestingShare = day < 110 ? 0.1 : clamp(0.1 + ((day - 110) / (days - 110)) * 0.75, 0, 0.85);
    const cardTesting = isFraud && rand() < cardTestingShare;

    let amount: number;
    let distance: number;
    let velocity: number;
    let device: number;
    let online: number;
    let foreign: number;

    if (!isFraud) {
      amount = cat.medianAmount * Math.exp(gaussian(rand) * 0.6);
      distance = rand() < 0.08 ? Math.exp(4.0 + gaussian(rand) * 1.0) : Math.exp(1.6 + gaussian(rand) * 0.9);
      velocity = 1 + (rand() < 0.3 ? 1 : 0) + (rand() < 0.1 ? 1 : 0) + (rand() < 0.05 ? 2 + Math.floor(rand() * 3) : 0);
      device = clamp(Math.round(78 + gaussian(rand) * 16), 1, 100);
      online = rand() < cat.onlineShare ? 1 : 0;
      foreign = rand() < 0.06 ? 1 : 0;
    } else if (!cardTesting) {
      // High-value, geographically anomalous fraud
      hour = rand() < 0.45 ? Math.floor(rand() * 6) : hour;
      amount = cat.medianAmount * 1.9 * Math.exp(gaussian(rand) * 0.8);
      distance = Math.exp(3.4 + gaussian(rand) * 1.4);
      velocity = 1 + Math.floor(rand() * 4);
      device = clamp(Math.round(60 + gaussian(rand) * 20), 1, 100);
      online = rand() < Math.max(0.5, cat.onlineShare) ? 1 : 0;
      foreign = rand() < 0.3 ? 1 : 0;
    } else {
      // Card testing: small amounts, bursts of attempts, untrusted devices
      hour = rand() < 0.35 ? Math.floor(rand() * 6) : hour;
      amount = 2 + rand() * 60;
      distance = Math.exp(2.4 + gaussian(rand) * 1.2);
      velocity = 2 + Math.floor(rand() * 6);
      device = clamp(Math.round(50 + gaussian(rand) * 20), 1, 100);
      online = rand() < 0.85 ? 1 : 0;
      foreign = rand() < 0.18 ? 1 : 0;
    }

    const minute = Math.floor(rand() * 60);
    const second = Math.floor(rand() * 60);
    const ts = new Date(start + day * 86400000 + hour * 3600000 + minute * 60000 + second * 1000).toISOString();
    const label = day >= days - unlabelledTailDays ? '' : isFraud ? '1' : '0';
    const merchant = `${cat.name} Merchant ${String(1 + Math.floor(rand() * 40)).padStart(2, '0')}`;

    lines.push([
      `TXN-${String(100000 + i)}`,
      ts,
      Math.max(0.5, amount).toFixed(2),
      cat.name,
      merchant,
      distance.toFixed(1),
      String(velocity),
      String(device),
      String(online),
      String(foreign),
      label,
    ].join(','));
  }
  return lines.join('\n');
}
