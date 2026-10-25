import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { HomeOverview } from './components/HomeOverview';
import { DatasetManagerView } from './components/DatasetManagerView';
import { DatasetUploaderModal } from './components/DatasetUploaderModal';
import { RealtimeStream } from './components/RealtimeStream';
import { ModelBenchmark } from './components/ModelBenchmark';
import { ShapExplainerView } from './components/ShapExplainerView';
import { ShapDriftMonitor } from './components/ShapDriftMonitor';
import { DelayedLabelQueueSimulator } from './components/DelayedLabelQueueSimulator';
import { ResearchMethodology } from './components/ResearchMethodology';
import { AboutView } from './components/AboutView';
import { ManualTransactionView } from './components/ManualTransactionView';
import { TransactionShapModal } from './components/TransactionShapModal';
import { ProvenanceBadge } from './components/ui';
import type { Transaction } from './types/fraud';
import { ChronoProvider, useChrono } from './state/ChronoContext';
import { useTheme } from './state/useTheme';
import { ROUTES, PRODUCT_TITLE, APP_NAME, TAGLINE, documentTitle, pathToTab, type NavTabId } from './routes';

export default function App() {
  return (
    <ChronoProvider>
      <AppShell />
    </ChronoProvider>
  );
}

function initialTab(): NavTabId {
  if (typeof window === 'undefined') return 'overview';
  return pathToTab(window.location.pathname) ?? 'overview';
}

function AppShell() {
  const chrono = useChrono();
  const {
    dataset,
    isSynthetic,
    trainingStatus,
    trainingError,
    transactions,
    splits,
    evaluation,
    activeModelName,
    decisionThreshold,
    recommendedThreshold,
    costFP,
    costFNPenalty,
    streamRunning,
    setStreamRunning,
    streamingTransactions,
    manualTransactions,
    bundle,
    loadSample,
    applyUpload,
    updateStatus,
  } = chrono;

  const [activeTab, setActiveTabState] = useState<NavTabId>(initialTab);
  const [darkMode, setDarkMode] = useTheme();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<Transaction | null>(null);

  // ---- URL path <-> tab sync (History API). Unknown paths fall back to /overview.
  useEffect(() => {
    const current = window.location.pathname;
    const tab = pathToTab(current);
    if (!tab || current === '/' || current.toLowerCase() === '/transactions') {
      window.history.replaceState({ tab: tab ?? 'overview' }, '', ROUTES[tab ?? 'overview'].path + window.location.search);
    }
    const onPop = () => setActiveTabState(pathToTab(window.location.pathname) ?? 'overview');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setActiveTab = useCallback((tab: NavTabId) => {
    setActiveTabState(tab);
    if (window.location.pathname !== ROUTES[tab].path) {
      window.history.pushState({ tab }, '', ROUTES[tab].path);
    }
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    document.title = documentTitle(activeTab);
  }, [activeTab]);

  // A CSV dropped anywhere outside the upload drop zone must not make the browser open the file
  // (that navigates away and discards the trained models, manual tests and review decisions).
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  // Selected transaction: look up the latest version (current model/threshold); fall back to snapshot.
  const selectedTransaction = useMemo(() => {
    if (!selectedId) return null;
    return (
      transactions.find((t) => t.id === selectedId) ??
      streamingTransactions.find((t) => t.id === selectedId) ??
      manualTransactions.find((t) => t.id === selectedId) ??
      selectedSnapshot
    );
  }, [selectedId, transactions, streamingTransactions, manualTransactions, selectedSnapshot]);

  const onSelectTransaction = useCallback((tx: Transaction) => {
    setSelectedId(tx.id);
    setSelectedSnapshot(tx);
  }, []);

  const alertsCount = useMemo(
    () => streamingTransactions.filter((t) => t.predictedProbability >= decisionThreshold).length,
    [streamingTransactions, decisionThreshold]
  );

  const handleExportReport = useCallback(() => {
    const parse = dataset?.parse;
    const report = {
      product: PRODUCT_TITLE,
      application: APP_NAME,
      exportTimestamp: new Date().toISOString(),
      dataProvenance: {
        activeDataset: dataset?.name ?? null,
        kind: dataset?.kind ?? null,
        note: isSynthetic ? 'Synthetic sample – seeded, deterministic demonstration data. Not real transactions.' : 'User-uploaded historical CSV (processed locally in the browser).',
        totalRowsRead: parse?.totalRowsRead ?? 0,
        validRows: parse?.validRowsCount ?? 0,
        skippedRows: parse?.invalidRowsCount ?? 0,
        skippedByField: parse?.skippedByField ?? {},
        labelledRows: parse?.labelledCount ?? 0,
        unlabelledRows: parse?.unlabelledCount ?? 0,
        droppedColumns: parse?.droppedColumns ?? [],
        warnings: parse?.warnings ?? [],
      },
      chronologicalSplits: splits.splitSummary,
      antiLeakage: {
        modelInputSourceColumns: bundle?.featureSpace.sourceColumns ?? [],
        encodedFeatureNames: bundle?.featureSpace.names ?? [],
        labelColumn: parse?.mappedColumns.is_fraud ?? null,
        guard: 'assertNoLabelLeakage() throws if any label, label-derived or identifier column is used as a feature.',
        protocol: 'Feature statistics fitted on train only; models trained on labelled train rows only; thresholds tuned on validation only; metrics reported on held-out test only.',
      },
      training: bundle
        ? { trainRowsUsed: bundle.trainRowsUsed, trainRowsLabelled: bundle.trainRowsLabelled, downsampled: bundle.downsampled, trainingMs: bundle.trainingMs }
        : null,
      activeModel: activeModelName,
      decisionThreshold,
      validationTunedThreshold: recommendedThreshold,
      costAssumptionsUSD: { reviewCostPerAlert: costFP, missedFraudPenalty: costFNPenalty, missedFraudLoss: 'transaction amount' },
      testSplitMetrics: evaluation
        ? Object.values(evaluation).map((m) => ({
            model: m.name,
            measured: { prAuc: m.prAuc, rocAuc: m.rocAuc, precision: m.precision, recall: m.recall, f1: m.f1, mcc: m.mcc, tp: m.truePositives, fp: m.falsePositives, tn: m.trueNegatives, fn: m.falseNegatives, evaluatedRows: m.evaluatedCount, evaluatedFrauds: m.evaluatedFrauds },
            estimated: { threshold: m.threshold, totalCost: m.totalCost, savingsVsNoModel: m.dollarsSaved },
          }))
        : null,
      manualTestTransactions: {
        count: manualTransactions.length,
        note: 'Entered by hand on /manual. Label always Pending/Unknown; never used for training, threshold tuning or metrics.',
      },
      simulatedComponents: ['Synthetic live stream (labels always unknown)', 'Delayed-label dispute lags (7/14/30/60 days, id-hashed)', 'Review queue capacity', 'Review-queue reviewer decisions (UI state only, never labels)'],
      sampleStreamTransactions: streamingTransactions.slice(0, 15).map((t) => ({
        id: t.id,
        timestamp: t.timestamp,
        amount: t.amount,
        merchantCategory: t.category,
        origin: t.origin,
        predictedProbability: t.predictedProbability,
        predictedStatus: t.predictedProbability >= decisionThreshold ? 'Suspicious' : 'Legitimate',
        actualLabel: t.groundTruthLabel === null ? 'Pending/Unknown' : t.groundTruthLabel === 1 ? 'Confirmed Fraud' : 'Confirmed Legitimate',
      })),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fraudlens-audit-${Date.now()}.json`;
    // Attach before clicking (Firefox ignores clicks on detached anchors) and revoke only after the
    // click has been handled (a synchronous revoke can cancel the download).
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [dataset, isSynthetic, splits, bundle, activeModelName, decisionThreshold, recommendedThreshold, costFP, costFNPenalty, evaluation, streamingTransactions, manualTransactions]);

  const meta = ROUTES[activeTab];
  const training = trainingStatus === 'training';

  return (
    <div className="min-h-screen flex font-sans antialiased bg-[#F5F7FB] text-slate-900 dark:bg-[#0B1220] dark:text-slate-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] cs-btn cs-btn-primary">
        Skip to content
      </a>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isMobileOpen={isMobileOpen}
        setIsMobileOpen={setIsMobileOpen}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        streamRunning={streamRunning}
        onToggleStream={() => setStreamRunning((p) => !p)}
        alertsCount={alertsCount}
      />

      <div className="flex-1 flex flex-col md:pl-64 min-w-0">
        <TopHeader
          activeTab={activeTab}
          onOpenMobileMenu={() => setIsMobileOpen(true)}
          isMobileOpen={isMobileOpen}
          streamRunning={streamRunning}
          onToggleStream={() => setStreamRunning((p) => !p)}
          onExportReport={handleExportReport}
          activeModelName={activeModelName}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          onOpenUploadModal={() => setIsUploadModalOpen(true)}
          activeDatasetName={dataset?.name ?? ''}
          isSynthetic={isSynthetic}
          training={training}
        />

        <main id="main" className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6" tabIndex={-1}>
          {/* Consistent page header across all routes */}
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.14em] cs-accent">
                {PRODUCT_TITLE} <span className="cs-subtle font-medium normal-case tracking-normal">· {APP_NAME}</span>
              </p>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight cs-text mt-0.5">{meta.title}</h1>
              <p className="text-xs cs-muted mt-1 max-w-3xl">{meta.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {isSynthetic ? <ProvenanceBadge kind="synthetic" /> : <ProvenanceBadge kind="historical" label="Uploaded dataset" />}
              <span className="font-mono cs-subtle truncate max-w-[320px]" title={dataset?.name}>{dataset?.name}</span>
            </div>
          </header>

          {training && (
            <div className="cs-card p-4 flex items-center gap-3 text-sm" role="status" aria-live="polite">
              <Loader2 className="w-4 h-4 animate-spin text-[#3988FF]" aria-hidden="true" />
              <span className="cs-text">Training 4 models on the chronological train split of “{dataset?.name}”…</span>
            </div>
          )}
          {trainingStatus === 'error' && (
            <div className="cs-card p-4 flex items-start gap-3 text-sm border-red-300 dark:border-red-500/40" role="alert">
              <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold cs-text">Model training failed</p>
                <p className="text-xs cs-muted">{trainingError}</p>
                <button type="button" className="cs-btn cs-btn-secondary mt-2" onClick={loadSample}>Load synthetic sample instead</button>
              </div>
            </div>
          )}

          {activeTab === 'overview' && <HomeOverview onNavigate={setActiveTab} onSelectTransaction={onSelectTransaction} />}
          {activeTab === 'dataset' && (
            <DatasetManagerView onOpenUploadModal={() => setIsUploadModalOpen(true)} onSelectTransaction={onSelectTransaction} />
          )}
          {activeTab === 'stream' && <RealtimeStream onSelectTransaction={onSelectTransaction} />}
          {activeTab === 'manual' && <ManualTransactionView onSelectTransaction={onSelectTransaction} onNavigate={setActiveTab} />}
          {activeTab === 'models' && <ModelBenchmark />}
          {activeTab === 'shap' && <ShapExplainerView onSelectTransaction={onSelectTransaction} />}
          {activeTab === 'drift' && <ShapDriftMonitor />}
          {activeTab === 'delayed' && <DelayedLabelQueueSimulator mode="delayed" />}
          {activeTab === 'queue' && <DelayedLabelQueueSimulator mode="queue" />}
          {activeTab === 'methodology' && <ResearchMethodology onExportReport={handleExportReport} darkMode={darkMode} />}
          {activeTab === 'about' && <AboutView darkMode={darkMode} onExportReport={handleExportReport} />}
        </main>

        {selectedTransaction && (
          <TransactionShapModal
            transaction={selectedTransaction}
            decisionThreshold={decisionThreshold}
            modelName={activeModelName}
            onClose={() => setSelectedId(null)}
            onUpdateStatus={updateStatus}
          />
        )}

        <DatasetUploaderModal
          isOpen={isUploadModalOpen}
          onClose={() => setIsUploadModalOpen(false)}
          onDatasetLoaded={applyUpload}
          onLoadSyntheticSample={loadSample}
          activeDatasetName={dataset?.name ?? ''}
        />

        <footer className="border-t py-4 text-xs bg-white border-slate-200 dark:bg-[#0B1220] dark:border-[#173B70]/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold cs-text">{PRODUCT_TITLE}</span>
              <span className="cs-subtle">·</span>
              <span className="font-semibold cs-accent">{APP_NAME}</span>
              <span className="hidden sm:inline cs-subtle">· {TAGLINE}</span>
            </div>
            <div className="flex items-center gap-3 font-mono text-xs cs-subtle">
              <span>Independent research prototype · not affiliated with any card network</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
