/**
 * In-browser models trained from scratch on the TRAIN split only.
 *
 *  - Logistic Regression : full-batch gradient descent, L2 penalty, class weights.
 *  - LightGBM-style      : histogram gradient-boosted trees, leaf-wise-ish depth 4, class weights.
 *  - XGBoost-style       : histogram gradient-boosted trees, depth 3, row subsampling, L2 leaf penalty.
 *  - Random Forest       : bagged histogram decision trees with per-node feature subsampling.
 *
 * These are compact TypeScript re-implementations of the algorithm families, not the official
 * LightGBM / XGBoost / scikit-learn libraries. Labels are only used as the training target.
 *
 * Attributions: exact linear SHAP for logistic regression (log-odds, feature independence);
 * path-based "Saabas" attributions for trees (a fast approximation of TreeSHAP).
 */
import type { ModelName } from '../types/fraud.ts';
import { mulberry32 } from '../data/syntheticSample.ts';

export interface Explanation {
  /** Model output for an "average" input in output space. */
  base: number;
  /** Per input-column additive contribution in output space. */
  contributions: Float64Array;
}

export interface TrainedModel {
  name: ModelName;
  outputSpace: 'logit' | 'probability';
  description: string;
  samplingStrategy: string;
  predict: (x: Float64Array) => number;
  explain: (x: Float64Array) => Explanation;
}

export interface TrainingData {
  X: Float64Array[];
  y: Uint8Array; // 0/1, only labelled rows
  w: Float64Array; // sample weights (class weights × downsampling correction)
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));

/** sqrt inverse-frequency class weights: fraud rows weighted by sqrt(nNeg / nPos). */
export function classWeights(y: Uint8Array): { pos: number; neg: number } {
  let pos = 0;
  for (let i = 0; i < y.length; i++) pos += y[i];
  const neg = y.length - pos;
  if (pos === 0 || neg === 0) return { pos: 1, neg: 1 };
  return { pos: Math.sqrt(neg / pos), neg: 1 };
}

// ---------------------------------------------------------------- Logistic regression
export function trainLogisticRegression(data: TrainingData, opts: { epochs?: number; lr?: number; l2?: number } = {}): TrainedModel {
  const { epochs = 400, lr = 0.5, l2 = 1e-3 } = opts;
  const { X, y, w } = data;
  const n = X.length;
  const d = n > 0 ? X[0].length : 0;
  const coef = new Float64Array(d);
  let bias = 0;
  const wSum = w.reduce((s, v) => s + v, 0) || 1;
  // initialise bias at weighted log-odds
  let wp = 0;
  for (let i = 0; i < n; i++) wp += w[i] * y[i];
  bias = Math.log(Math.max(1e-6, wp) / Math.max(1e-6, wSum - wp));

  const grad = new Float64Array(d);
  for (let e = 0; e < epochs; e++) {
    grad.fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const xi = X[i];
      let z = bias;
      for (let j = 0; j < d; j++) z += coef[j] * xi[j];
      const err = (sigmoid(z) - y[i]) * w[i];
      gb += err;
      for (let j = 0; j < d; j++) grad[j] += err * xi[j];
    }
    const step = lr / (1 + e / 200);
    bias -= (step * gb) / wSum;
    for (let j = 0; j < d; j++) coef[j] -= step * (grad[j] / wSum + l2 * coef[j]);
  }

  const mu = new Float64Array(d);
  for (const xi of X) for (let j = 0; j < d; j++) mu[j] += xi[j] / Math.max(1, n);
  let base = bias;
  for (let j = 0; j < d; j++) base += coef[j] * mu[j];

  return {
    name: 'Logistic Regression',
    outputSpace: 'logit',
    description: 'L2-regularised logistic regression trained with full-batch gradient descent on standardised features and one-hot merchant categories.',
    samplingStrategy: 'Class-weighted (√ inverse frequency)',
    predict: (x) => {
      let z = bias;
      for (let j = 0; j < d; j++) z += coef[j] * x[j];
      return sigmoid(z);
    },
    explain: (x) => {
      const c = new Float64Array(d);
      for (let j = 0; j < d; j++) c[j] = coef[j] * (x[j] - mu[j]);
      return { base, contributions: c };
    },
  };
}

// ---------------------------------------------------------------- Histogram trees
interface TreeNode {
  value: number;
  feature: number; // -1 for leaf
  threshold: number; // go left if x[feature] <= threshold
  left: TreeNode | null;
  right: TreeNode | null;
}

interface Binned {
  edges: Float64Array[]; // per feature, sorted thresholds
  bins: Uint8Array[]; // per feature (column-major) bin index per row
}

function binData(X: Float64Array[], maxBins = 32): Binned {
  const n = X.length;
  const d = n > 0 ? X[0].length : 0;
  const edges: Float64Array[] = [];
  const bins: Uint8Array[] = [];
  for (let j = 0; j < d; j++) {
    const col = new Float64Array(n);
    for (let i = 0; i < n; i++) col[i] = X[i][j];
    const sorted = Float64Array.from(col).sort();
    const cand: number[] = [];
    for (let b = 1; b < maxBins; b++) {
      const v = sorted[Math.min(n - 1, Math.floor((b / maxBins) * n))];
      if (cand.length === 0 || v > cand[cand.length - 1]) cand.push(v);
    }
    // remove a trailing edge equal to the max (no rows to its right)
    while (cand.length && cand[cand.length - 1] >= sorted[n - 1]) cand.pop();
    const e = Float64Array.from(cand);
    const bj = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let lo = 0;
      let hi = e.length;
      const v = col[i];
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (v <= e[mid]) hi = mid;
        else lo = mid + 1;
      }
      bj[i] = lo;
    }
    edges.push(e);
    bins.push(bj);
  }
  return { edges, bins };
}

interface TreeParams {
  maxDepth: number;
  lambda: number;
  minHess: number;
  minSamples: number;
  featureFraction: number; // per-node feature sampling
  rand: () => number;
}

function buildTree(rows: Int32Array, g: Float64Array, h: Float64Array, binned: Binned, p: TreeParams, depth = 0): TreeNode {
  let G = 0;
  let H = 0;
  for (let k = 0; k < rows.length; k++) {
    G += g[rows[k]];
    H += h[rows[k]];
  }
  const node: TreeNode = { value: -G / (H + p.lambda), feature: -1, threshold: 0, left: null, right: null };
  if (depth >= p.maxDepth || rows.length < 2 * p.minSamples || H < 2 * p.minHess) return node;

  const d = binned.edges.length;
  const parentScore = (G * G) / (H + p.lambda);
  let bestGain = 1e-9;
  let bestF = -1;
  let bestBin = -1;
  const histG = new Float64Array(33);
  const histH = new Float64Array(33);
  const histN = new Int32Array(33);

  for (let f = 0; f < d; f++) {
    if (p.featureFraction < 1 && p.rand() > p.featureFraction) continue;
    const nb = binned.edges[f].length + 1;
    if (nb < 2) continue;
    histG.fill(0, 0, nb);
    histH.fill(0, 0, nb);
    histN.fill(0, 0, nb);
    const bf = binned.bins[f];
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k];
      const b = bf[r];
      histG[b] += g[r];
      histH[b] += h[r];
      histN[b]++;
    }
    let GL = 0;
    let HL = 0;
    let NL = 0;
    for (let b = 0; b < nb - 1; b++) {
      GL += histG[b];
      HL += histH[b];
      NL += histN[b];
      const GR = G - GL;
      const HR = H - HL;
      const NR = rows.length - NL;
      if (HL < p.minHess || HR < p.minHess || NL < p.minSamples || NR < p.minSamples) continue;
      const gain = (GL * GL) / (HL + p.lambda) + (GR * GR) / (HR + p.lambda) - parentScore;
      if (gain > bestGain) {
        bestGain = gain;
        bestF = f;
        bestBin = b;
      }
    }
  }
  if (bestF < 0) return node;

  const bf = binned.bins[bestF];
  let nLeft = 0;
  for (let k = 0; k < rows.length; k++) if (bf[rows[k]] <= bestBin) nLeft++;
  const leftRows = new Int32Array(nLeft);
  const rightRows = new Int32Array(rows.length - nLeft);
  let li = 0;
  let ri = 0;
  for (let k = 0; k < rows.length; k++) {
    if (bf[rows[k]] <= bestBin) leftRows[li++] = rows[k];
    else rightRows[ri++] = rows[k];
  }
  node.feature = bestF;
  node.threshold = binned.edges[bestF][bestBin];
  node.left = buildTree(leftRows, g, h, binned, p, depth + 1);
  node.right = buildTree(rightRows, g, h, binned, p, depth + 1);
  return node;
}

function treeValue(node: TreeNode, x: Float64Array): number {
  let cur = node;
  while (cur.feature >= 0) cur = (x[cur.feature] <= cur.threshold ? cur.left : cur.right) as TreeNode;
  return cur.value;
}

/** Saabas path attribution: adds (child.value - parent.value) * scale to the split feature. */
function treePathAttribution(node: TreeNode, x: Float64Array, scale: number, out: Float64Array): void {
  let cur = node;
  while (cur.feature >= 0) {
    const next = (x[cur.feature] <= cur.threshold ? cur.left : cur.right) as TreeNode;
    out[cur.feature] += (next.value - cur.value) * scale;
    cur = next;
  }
}

interface GbdtOptions {
  rounds: number;
  learningRate: number;
  maxDepth: number;
  lambda: number;
  subsample: number;
  featureFraction: number;
  seed: number;
}

function trainGbdt(name: ModelName, data: TrainingData, o: GbdtOptions, description: string, samplingStrategy: string): TrainedModel {
  const { X, y, w } = data;
  const n = X.length;
  const d = n > 0 ? X[0].length : 0;
  const rand = mulberry32(o.seed);
  const binned = binData(X);
  let wp = 0;
  let wSum = 0;
  for (let i = 0; i < n; i++) { wp += w[i] * y[i]; wSum += w[i]; }
  const init = Math.log(Math.max(1e-6, wp) / Math.max(1e-6, wSum - wp));
  const F = new Float64Array(n).fill(init);
  const g = new Float64Array(n);
  const h = new Float64Array(n);
  const trees: TreeNode[] = [];
  const minHess = Math.max(1e-3, wSum * 1e-4);

  for (let t = 0; t < o.rounds; t++) {
    for (let i = 0; i < n; i++) {
      const pr = sigmoid(F[i]);
      g[i] = w[i] * (pr - y[i]);
      h[i] = Math.max(1e-6, w[i] * pr * (1 - pr));
    }
    let rows: Int32Array;
    if (o.subsample < 1) {
      const tmp: number[] = [];
      for (let i = 0; i < n; i++) if (rand() < o.subsample) tmp.push(i);
      rows = Int32Array.from(tmp);
    } else {
      rows = new Int32Array(n);
      for (let i = 0; i < n; i++) rows[i] = i;
    }
    const tree = buildTree(rows, g, h, binned, { maxDepth: o.maxDepth, lambda: o.lambda, minHess, minSamples: 5, featureFraction: o.featureFraction, rand });
    trees.push(tree);
    for (let i = 0; i < n; i++) F[i] += o.learningRate * treeValue(tree, X[i]);
  }

  let base = init;
  for (const tr of trees) base += o.learningRate * tr.value;

  return {
    name,
    outputSpace: 'logit',
    description,
    samplingStrategy,
    predict: (x) => {
      let z = init;
      for (const tr of trees) z += o.learningRate * treeValue(tr, x);
      return sigmoid(z);
    },
    explain: (x) => {
      const c = new Float64Array(d);
      for (const tr of trees) treePathAttribution(tr, x, o.learningRate, c);
      return { base, contributions: c };
    },
  };
}

function trainRandomForest(data: TrainingData, opts: { trees?: number; maxDepth?: number; seed?: number } = {}): TrainedModel {
  const { trees: nTrees = 60, maxDepth = 7, seed = 7 } = opts;
  const { X, y, w } = data;
  const n = X.length;
  const d = n > 0 ? X[0].length : 0;
  const rand = mulberry32(seed);
  const binned = binData(X);
  const g = new Float64Array(n);
  const h = new Float64Array(n);
  for (let i = 0; i < n; i++) { g[i] = -w[i] * y[i]; h[i] = w[i]; }
  const featureFraction = Math.min(1, Math.max(2, Math.ceil(Math.sqrt(d) * 1.5)) / Math.max(1, d));
  const forest: TreeNode[] = [];
  for (let t = 0; t < nTrees; t++) {
    const rows = new Int32Array(n);
    for (let i = 0; i < n; i++) rows[i] = Math.floor(rand() * n);
    forest.push(buildTree(rows, g, h, binned, { maxDepth, lambda: 1e-6, minHess: 1e-6, minSamples: 3, featureFraction, rand }));
  }
  const clampP = (v: number) => Math.min(1, Math.max(0, v));
  let base = 0;
  for (const tr of forest) base += tr.value / nTrees;
  return {
    name: 'Random Forest',
    outputSpace: 'probability',
    description: `Bagged ensemble of ${nTrees} histogram decision trees (depth ≤ ${maxDepth}) with bootstrap rows and per-node feature subsampling.`,
    samplingStrategy: 'Class-weighted + bootstrap bagging',
    predict: (x) => {
      let s = 0;
      for (const tr of forest) s += treeValue(tr, x);
      return clampP(s / nTrees);
    },
    explain: (x) => {
      const c = new Float64Array(d);
      for (const tr of forest) treePathAttribution(tr, x, 1 / nTrees, c);
      return { base, contributions: c };
    },
  };
}

export function trainModel(name: ModelName, data: TrainingData): TrainedModel {
  switch (name) {
    case 'Logistic Regression':
      return trainLogisticRegression(data);
    case 'LightGBM':
      return trainGbdt('LightGBM', data, { rounds: 80, learningRate: 0.1, maxDepth: 4, lambda: 1, subsample: 1, featureFraction: 0.8, seed: 11 },
        'LightGBM-style histogram gradient boosting (80 rounds, depth 4, 32 bins, feature fraction 0.8) – in-browser re-implementation.',
        'Class-weighted (√ inverse frequency)');
    case 'XGBoost':
      return trainGbdt('XGBoost', data, { rounds: 100, learningRate: 0.1, maxDepth: 3, lambda: 2, subsample: 0.8, featureFraction: 1, seed: 23 },
        'XGBoost-style regularised gradient boosting (100 rounds, depth 3, λ=2, row subsample 0.8) – in-browser re-implementation.',
        'Class-weighted (√ inverse frequency) + row subsampling');
    case 'Random Forest':
    default:
      return trainRandomForest(data);
  }
}
