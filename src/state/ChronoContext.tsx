/**
 * Shared application state: ONE active dataset, ONE trained model bundle, shared by every view.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelName, Transaction } from '../types/fraud';
import type { ChronologicalSplits } from '../types/dataset';
import { EMPTY_SPLIT_SUMMARY } from '../types/dataset';
import { parseAndValidateTransactionCsv, type CsvParseResult } from '../utils/csvParser';
import { generateSampleCsvString, SYNTHETIC_SAMPLE_NAME } from '../data/syntheticSample';
import {
  evaluateModels,
  explainRow,
  scoreRow,
  toFeatureInput,
  trainPipeline,
  tunedThreshold,
  type ModelEvaluation,
  type TrainingBundle,
} from '../utils/pipeline';
import { generateSyntheticStreamTransaction, nextReplayRow, pushToStreamBuffer } from '../utils/syntheticStream';
import {
  appendManualTransaction,
  buildManualFormSpec,
  checkManualTransaction,
  rescoreManual,
  type ManualCheckResult,
  type ManualCheckSuccess,
  type ManualFormSpec,
  type ManualFormValues,
} from '../utils/manualTransaction';
import {
  applyReviewAction,
  EMPTY_REVIEW_STATE,
  undoLastDecision,
  type ReviewAction,
  type ReviewQueueState,
  type ReviewResult,
} from '../utils/reviewQueue';

export type DatasetKind = 'synthetic_sample' | 'uploaded_csv';
export type StreamMode = 'test_cohort' | 'synthetic_stream';
export type TrainingStatus = 'idle' | 'training' | 'ready' | 'error';

export interface ActiveDataset {
  name: string;
  kind: DatasetKind;
  parse: CsvParseResult;
  loadedAt: string;
}

interface ChronoState {
  dataset: ActiveDataset | null;
  isSynthetic: boolean;
  trainingStatus: TrainingStatus;
  trainingError: string | null;
  bundle: TrainingBundle | null;
  /** Dataset transactions scored by the active model (chronological). */
  transactions: Transaction[];
  splits: ChronologicalSplits;
  /** Test-split metrics per model; thresholds tuned on validation with current costs. */
  evaluation: Record<ModelName, ModelEvaluation> | null;
  activeModelName: ModelName;
  setActiveModelName: (m: ModelName) => void;
  decisionThreshold: number;
  setDecisionThreshold: (t: number) => void;
  /** Validation-tuned threshold of the active model at the current costs. */
  recommendedThreshold: number;
  costFP: number;
  setCostFP: (v: number) => void;
  costFNPenalty: number;
  setCostFNPenalty: (v: number) => void;
  loadSample: () => void;
  applyUpload: (result: CsvParseResult, fileName: string) => void;
  updateStatus: (id: string, status: Transaction['status']) => void;
  // stream
  streamRunning: boolean;
  setStreamRunning: React.Dispatch<React.SetStateAction<boolean>>;
  speedMultiplier: number;
  setSpeedMultiplier: (s: number) => void;
  streamMode: StreamMode;
  setStreamMode: (m: StreamMode) => void;
  streamingTransactions: Transaction[];
  testSplitIndex: number;
  processedCount: number;
  simulateSurge: () => void;
  // manual transaction checks (separate slice: never part of the stream buffer, dataset or metrics)
  manualFormSpec: ManualFormSpec | null;
  /** Manual test rows, newest first, re-scored with the active model; label always Pending/Unknown. */
  manualTransactions: Transaction[];
  submitManualTransaction: (values: ManualFormValues) => ManualCheckResult;
  clearManualTransactions: () => void;
  /** Unsubmitted form values and the last successful check, kept across navigation (cleared on dataset change). */
  manualDraft: ManualFormValues | null;
  setManualDraft: React.Dispatch<React.SetStateAction<ManualFormValues | null>>;
  manualLastResult: ManualCheckSuccess | null;
  setManualLastResult: (r: ManualCheckSuccess | null) => void;
  // review-queue workbench (SIMULATED reviewer decisions; UI state only, never labels)
  reviewState: ReviewQueueState;
  applyReview: (id: string, action: ReviewAction, queueIds: ReadonlySet<string>) => ReviewResult;
  undoReview: () => ReviewResult;
  resetReview: () => void;
}

const Ctx = createContext<ChronoState | null>(null);

export function useChrono(): ChronoState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChrono must be used inside <ChronoProvider>');
  return v;
}

const STREAM_BUFFER = 60;

export const ChronoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dataset, setDataset] = useState<ActiveDataset | null>(null);
  const [bundle, setBundle] = useState<TrainingBundle | null>(null);
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatus>('idle');
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [activeModelName, setActiveModelNameState] = useState<ModelName>('LightGBM');
  const [decisionThreshold, setDecisionThreshold] = useState<number>(0.5);
  const [costFP, setCostFP] = useState<number>(20);
  const [costFNPenalty, setCostFNPenalty] = useState<number>(50);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, Transaction['status']>>({});
  const [manualRaw, setManualRaw] = useState<Transaction[]>([]);
  const [manualDraft, setManualDraft] = useState<ManualFormValues | null>(null);
  const [manualLastResult, setManualLastResult] = useState<ManualCheckSuccess | null>(null);
  const [reviewState, setReviewState] = useState<ReviewQueueState>(EMPTY_REVIEW_STATE);
  const reviewRef = useRef<ReviewQueueState>(EMPTY_REVIEW_STATE);

  // ---- dataset loading + training (training deferred a tick so the UI can show "Training…")
  const trainToken = useRef(0);
  const settingsRef = useRef({ model: activeModelName, costFP, costFNPenalty });
  settingsRef.current = { model: activeModelName, costFP, costFNPenalty };
  const activate = useCallback((parse: CsvParseResult, name: string, kind: DatasetKind) => {
    const token = ++trainToken.current;
    setDataset({ name, kind, parse, loadedAt: new Date().toISOString() });
    setBundle(null);
    setStatusOverrides({});
    setManualRaw([]); // manual rows were scored against the previous dataset's feature space
    setManualDraft(null);
    setManualLastResult(null);
    reviewRef.current = EMPTY_REVIEW_STATE;
    setReviewState(EMPTY_REVIEW_STATE); // simulated decisions belong to the previous dataset
    setTrainingStatus('training');
    setTrainingError(null);
    setTimeout(() => {
      try {
        const b = trainPipeline(parse.transactions, parse.featureColumns, [parse.mappedColumns.is_fraud, parse.mappedColumns.transaction_id]);
        if (token !== trainToken.current) return;
        const cfg = settingsRef.current;
        // adopt the validation-tuned threshold in the same render as the new models (no flash of a stale τ)
        setDecisionThreshold(tunedThreshold(b, parse.transactions, cfg.model, cfg.costFP, cfg.costFNPenalty));
        setBundle(b);
        setTrainingStatus('ready');
      } catch (err) {
        if (token !== trainToken.current) return;
        setTrainingStatus('error');
        setTrainingError(err instanceof Error ? err.message : String(err));
      }
    }, 30);
  }, []);

  const loadSample = useCallback(() => {
    const parse = parseAndValidateTransactionCsv(generateSampleCsvString(), { origin: 'synthetic_sample' });
    activate(parse, SYNTHETIC_SAMPLE_NAME, 'synthetic_sample');
  }, [activate]);

  const applyUpload = useCallback((result: CsvParseResult, fileName: string) => {
    if (!result.isValid) return;
    activate(result, fileName, 'uploaded_csv');
  }, [activate]);

  useEffect(() => {
    loadSample();
  }, [loadSample]);

  // ---- scoring with the active model
  const scored = useMemo<Transaction[]>(() => {
    if (!dataset) return [];
    const base = dataset.parse.transactions;
    if (!bundle) return base;
    const probs = bundle.probabilities[activeModelName];
    return base.map((t, i) => ({
      ...t,
      predictedProbability: Math.round(probs[i] * 10000) / 10000,
      shapBreakdown: explainRow(bundle, activeModelName, toFeatureInput(t)),
    }));
  }, [dataset, bundle, activeModelName]);

  const transactions = useMemo<Transaction[]>(
    () =>
      scored.map((t) => ({
        ...t,
        status: statusOverrides[t.id] ?? (t.predictedProbability >= decisionThreshold ? 'Pending Review' : 'Cleared'),
      })),
    [scored, decisionThreshold, statusOverrides]
  );

  const splits = useMemo<ChronologicalSplits>(() => {
    if (!dataset) return { train: [], validation: [], test: [], splitSummary: EMPTY_SPLIT_SUMMARY };
    return {
      train: transactions.filter((t) => t.split === 'train'),
      validation: transactions.filter((t) => t.split === 'validation'),
      test: transactions.filter((t) => t.split === 'test'),
      splitSummary: dataset.parse.splits.summary,
    };
  }, [transactions, dataset]);

  const evaluation = useMemo(() => {
    if (!bundle || !dataset) return null;
    return evaluateModels(bundle, dataset.parse.transactions, costFP, costFNPenalty, 'Test');
  }, [bundle, dataset, costFP, costFNPenalty]);

  const recommendedThreshold = useMemo(() => {
    if (!bundle || !dataset) return 0.5;
    return tunedThreshold(bundle, dataset.parse.transactions, activeModelName, costFP, costFNPenalty);
  }, [bundle, dataset, activeModelName, costFP, costFNPenalty]);

  // When a new model is trained or the active model changes, adopt its validation-tuned threshold.
  const lastAutoKey = useRef('');
  useEffect(() => {
    if (!bundle) return;
    const key = `${bundle.ids.length}-${bundle.trainingMs}-${activeModelName}-${dataset?.loadedAt}`;
    if (key !== lastAutoKey.current) {
      lastAutoKey.current = key;
      setDecisionThreshold(recommendedThreshold);
    }
  }, [bundle, activeModelName, recommendedThreshold, dataset]);

  const setActiveModelName = useCallback((m: ModelName) => setActiveModelNameState(m), []);

  const updateStatus = useCallback((id: string, status: Transaction['status']) => {
    setStatusOverrides((prev) => ({ ...prev, [id]: status }));
    setStreamBuffer((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
  }, []);

  // ---- live stream
  const [streamRunning, setStreamRunning] = useState(true);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [streamMode, setStreamMode] = useState<StreamMode>('test_cohort');
  const [streamBuffer, setStreamBuffer] = useState<Transaction[]>([]);
  const [testSplitIndex, setTestSplitIndex] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const testIndexRef = useRef(0);

  const scoreSynthetic = useCallback((t: Transaction): Transaction => {
    if (!bundle) return t;
    const input = toFeatureInput(t);
    const p = scoreRow(bundle, activeModelName, input);
    return {
      ...t,
      predictedProbability: Math.round(p * 10000) / 10000,
      shapBreakdown: explainRow(bundle, activeModelName, input),
    };
  }, [bundle, activeModelName]);

  // Reset the stream when the dataset/model/mode changes.
  useEffect(() => {
    if (!bundle) {
      setStreamBuffer([]);
      return;
    }
    if (streamMode === 'test_cohort') {
      const seed = Math.min(20, splits.test.length);
      setStreamBuffer(splits.test.slice(0, seed).reverse());
      setTestSplitIndex(seed);
      testIndexRef.current = seed;
      setProcessedCount(seed);
    } else {
      setStreamBuffer([]);
      setProcessedCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, activeModelName, streamMode, dataset]);

  // Keep replayed rows in sync with threshold / analyst status changes.
  const testById = useMemo(() => new Map(splits.test.map((t) => [t.id, t])), [splits.test]);
  const streamingTransactions = useMemo(
    () => streamBuffer.map((t) => {
      if (t.origin === 'synthetic_stream') {
        return { ...t, status: statusOverrides[t.id] ?? (t.predictedProbability >= decisionThreshold ? 'Pending Review' : 'Cleared') };
      }
      return testById.get(t.id) ?? t;
    }),
    [streamBuffer, testById, decisionThreshold, statusOverrides]
  );

  const trainTemplates = useMemo(() => splits.train, [splits.train]);
  const fraudTemplates = useMemo(() => splits.train.filter((t) => t.groundTruthLabel === 1), [splits.train]);

  // The interval reads the latest rows / scorer through a ref. Previously these were effect
  // dependencies, and `splits.test` gets a new identity on every threshold or analyst-status
  // change, so dragging the τ slider restarted the 3.2 s timer and the stream stalled.
  const tickInputs = useRef({ testRows: splits.test, trainTemplates, scoreSynthetic });
  tickInputs.current = { testRows: splits.test, trainTemplates, scoreSynthetic };
  useEffect(() => {
    if (!streamRunning || !bundle) return;
    const interval = setInterval(() => {
      const { testRows, trainTemplates: templates, scoreSynthetic: score } = tickInputs.current;
      if (streamMode === 'test_cohort') {
        if (testRows.length === 0) return;
        const step = nextReplayRow(testRows, testIndexRef.current);
        if (!step) return;
        testIndexRef.current = step.nextIndex;
        setTestSplitIndex(step.nextIndex);
        setStreamBuffer((buf) => pushToStreamBuffer(buf, [step.row], STREAM_BUFFER));
      } else {
        const tx = generateSyntheticStreamTransaction(templates);
        if (!tx) return;
        setStreamBuffer((buf) => pushToStreamBuffer(buf, [score(tx)], STREAM_BUFFER));
      }
      setProcessedCount((c) => c + 1);
    }, 3200 / speedMultiplier);
    return () => clearInterval(interval);
  }, [streamRunning, speedMultiplier, streamMode, bundle]);

  const simulateSurge = useCallback(() => {
    const burst: Transaction[] = [];
    for (let i = 0; i < 3; i++) {
      const tx = generateSyntheticStreamTransaction(fraudTemplates.length ? fraudTemplates : trainTemplates);
      if (tx) burst.push(scoreSynthetic(tx));
    }
    setStreamBuffer((buf) => pushToStreamBuffer(buf, burst, STREAM_BUFFER));
    setProcessedCount((c) => c + burst.length);
  }, [fraudTemplates, trainTemplates, scoreSynthetic]);

  // ---- manual transaction checks. Own state slice: submitting never touches streamBuffer,
  // processedCount, testIndexRef, streamRunning or the interval above.
  const manualFormSpec = useMemo<ManualFormSpec | null>(
    () => (bundle && dataset ? buildManualFormSpec(bundle, dataset.parse.transactions.filter((t) => t.split === 'train')) : null),
    [bundle, dataset]
  );

  const manualTransactions = useMemo<Transaction[]>(() => {
    const rows = bundle ? rescoreManual(bundle, activeModelName, manualRaw) : manualRaw;
    return rows.map((t) => ({ ...t, status: statusOverrides[t.id] ?? (t.predictedProbability >= decisionThreshold ? 'Pending Review' : 'Cleared') }));
  }, [manualRaw, bundle, activeModelName, decisionThreshold, statusOverrides]);

  const submitManualTransaction = useCallback(
    (values: ManualFormValues): ManualCheckResult => {
      const result = checkManualTransaction({ bundle, modelName: activeModelName, threshold: decisionThreshold, values, spec: manualFormSpec });
      if (result.ok) setManualRaw((prev) => appendManualTransaction(prev, result.transaction));
      return result;
    },
    [bundle, activeModelName, decisionThreshold, manualFormSpec]
  );

  const clearManualTransactions = useCallback(() => setManualRaw([]), []);

  // ---- review-queue workbench. A ref holds the latest state so rapid double clicks are
  // evaluated against the already-applied decision (duplicate decisions are rejected).
  const commitReview = useCallback((r: ReviewResult) => {
    if (r.ok) {
      reviewRef.current = r.state;
      setReviewState(r.state);
    }
    return r;
  }, []);
  const applyReview = useCallback(
    (id: string, action: ReviewAction, queueIds: ReadonlySet<string>) => commitReview(applyReviewAction(reviewRef.current, id, action, queueIds)),
    [commitReview]
  );
  const undoReview = useCallback(() => commitReview(undoLastDecision(reviewRef.current)), [commitReview]);
  const resetReview = useCallback(() => {
    reviewRef.current = EMPTY_REVIEW_STATE;
    setReviewState(EMPTY_REVIEW_STATE);
  }, []);

  const value: ChronoState = {
    dataset,
    isSynthetic: dataset?.kind !== 'uploaded_csv',
    trainingStatus,
    trainingError,
    bundle,
    transactions,
    splits,
    evaluation,
    activeModelName,
    setActiveModelName,
    decisionThreshold,
    setDecisionThreshold,
    recommendedThreshold,
    costFP,
    setCostFP,
    costFNPenalty,
    setCostFNPenalty,
    loadSample,
    applyUpload,
    updateStatus,
    streamRunning,
    setStreamRunning,
    speedMultiplier,
    setSpeedMultiplier,
    streamMode,
    setStreamMode,
    streamingTransactions,
    testSplitIndex,
    processedCount,
    simulateSurge,
    manualFormSpec,
    manualTransactions,
    submitManualTransaction,
    clearManualTransactions,
    manualDraft,
    setManualDraft,
    manualLastResult,
    setManualLastResult,
    reviewState,
    applyReview,
    undoReview,
    resetReview,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
