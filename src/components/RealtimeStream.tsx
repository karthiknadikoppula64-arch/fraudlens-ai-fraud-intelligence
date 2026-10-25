import React, { useMemo, useState } from 'react';
import { useSessionState } from '../state/useSessionState';
import { Play, Pause, Zap, Target, DollarSign, AlertOctagon, ShieldCheck, Radio, Gauge, LineChart as LineChartIcon, BarChart3, Activity } from 'lucide-react';
import type { Transaction } from '../types/fraud';
import { useChrono } from '../state/ChronoContext';
import { FraudSpikeChart } from './FraudSpikeChart';
import { ErrorCostBreakdown } from './ErrorCostBreakdown';
import { ProbabilityDensityPlot } from './ProbabilityDensityPlot';
import { TransactionLedger } from './TransactionLedger';
import { TransactionDetailDrawer } from './TransactionDetailDrawer';
import { DataLegend, ProvenanceBadge, SectionTitle, fmtMoney } from './ui';

interface RealtimeStreamProps {
  onSelectTransaction: (tx: Transaction) => void;
}

type LedgerSource = 'stream' | 'test' | 'all' | 'manual';

export const RealtimeStream: React.FC<RealtimeStreamProps> = ({ onSelectTransaction }) => {
  const {
    streamingTransactions: transactions,
    streamRunning,
    setStreamRunning,
    speedMultiplier,
    setSpeedMultiplier,
    simulateSurge,
    decisionThreshold,
    setDecisionThreshold,
    recommendedThreshold,
    costFP,
    setCostFP,
    costFNPenalty,
    setCostFNPenalty,
    streamMode,
    setStreamMode,
    splits,
    transactions: allTransactions,
    testSplitIndex,
    dataset,
    isSynthetic,
    activeModelName,
    bundle,
    manualTransactions,
  } = useChrono();

  // View selections survive navigating away and back.
  const [view, setView] = useSessionState<'all' | 'spikes' | 'costs' | 'density'>('stream.view', 'all');
  const [ledgerSource, setLedgerSource] = useSessionState<LedgerSource>('stream.ledgerSource', 'stream');
  const [inspected, setInspected] = useState<Transaction | null>(null);

  const flagged = useMemo(() => transactions.filter((t) => t.predictedProbability >= decisionThreshold), [transactions, decisionThreshold]);
  const judged = flagged.filter((t) => t.groundTruthLabel !== null);
  const tp = judged.filter((t) => t.groundTruthLabel === 1).length;
  const totalVolume = transactions.reduce((s, t) => s + t.amount, 0);
  const flaggedDollars = flagged.reduce((s, t) => s + t.amount, 0);
  const cleared = transactions.length - flagged.length;

  // Measured scoring latency for the active model (browser-side, per transaction)
  const latencyMs = useMemo(() => {
    if (!bundle || splits.test.length === 0) return null;
    const sample = splits.test.slice(0, 200);
    const m = bundle.models[activeModelName];
    const fs = bundle.featureSpace;
    const t0 = performance.now();
    for (const t of sample) m.predict(fs.transform({ amount: t.amount, timestamp: t.timestamp, category: t.category, features: t.features }));
    return (performance.now() - t0) / sample.length;
  }, [bundle, activeModelName, splits.test]);

  // Manual tests are a separate list: shown on their own ledger tab, never mixed into the live buffer or its analytics.
  const ledgerRows = ledgerSource === 'stream' ? transactions : ledgerSource === 'test' ? splits.test : ledgerSource === 'manual' ? manualTransactions : allTransactions;

  const kpi = (label: string, value: React.ReactNode, sub: React.ReactNode, Icon: React.ElementType, badge?: React.ReactNode) => (
    <div className="cs-card p-4">
      <div className="flex items-center justify-between text-xs cs-muted mb-1">
        <span>{label}</span>
        <Icon className="w-4 h-4 text-[#3988FF]" aria-hidden="true" />
      </div>
      <div className="text-2xl font-bold font-mono tabular-nums cs-text">{value}</div>
      <div className="text-xs cs-subtle mt-1 flex items-center justify-between gap-2"><span>{sub}</span>{badge}</div>
    </div>
  );

  return (
    <div className="space-y-6 pb-10">
      {/* Source banner */}
      <section className="cs-card p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="p-2.5 rounded-xl bg-[#3988FF]/10 text-[#3988FF]"><Radio className="w-4 h-4" aria-hidden="true" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold cs-text">Stream source:</span>
              {streamMode === 'test_cohort' ? (
                <>
                  <span className="text-xs font-semibold cs-accent">Replay of held-out test split</span>
                  <ProvenanceBadge kind={isSynthetic ? 'synthetic' : 'historical'} label={isSynthetic ? 'Synthetic sample' : 'Historical'} />
                </>
              ) : (
                <>
                  <span className="text-xs font-semibold cs-accent">Synthetic stream</span>
                  <ProvenanceBadge kind="simulated" />
                </>
              )}
            </div>
            <p className="text-xs cs-muted mt-0.5 max-w-2xl">
              {streamMode === 'test_cohort'
                ? `Replaying ${dataset?.name ?? ''} test split in timestamp order (position ${Math.min(testSplitIndex, splits.test.length)} of ${splits.test.length}, loops at the end). Actual labels are shown only where the dataset has them.`
                : 'Generated by resampling and jittering training-split feature profiles. Simulated rows have no real outcome (always “Pending / Unknown”) and are never used for training or evaluation.'}
            </p>
          </div>
        </div>
        <div className="cs-seg" role="group" aria-label="Stream source">
          <button type="button" aria-pressed={streamMode === 'test_cohort'} onClick={() => setStreamMode('test_cohort')}>Replay test split</button>
          <button type="button" aria-pressed={streamMode === 'synthetic_stream'} onClick={() => setStreamMode('synthetic_stream')}>Synthetic stream</button>
        </div>
      </section>

      {/* KPIs over the stream buffer */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {kpi('Alert precision (labelled)', judged.length ? `${((tp / judged.length) * 100).toFixed(1)}%` : '—', `${tp} confirmed / ${judged.length} labelled alerts`, Target, <ProvenanceBadge kind="confirmed" />)}
        {kpi('Buffer volume', fmtMoney(totalVolume, 0), `${transactions.length} transactions in buffer`, DollarSign)}
        {kpi(`Alerts (τ ≥ ${decisionThreshold.toFixed(2)})`, <span className="text-amber-700 dark:text-amber-400">{flagged.length}</span>, `${fmtMoney(flaggedDollars, 0)} flagged`, AlertOctagon, <ProvenanceBadge kind="predicted" />)}
        {kpi('Cleared', <span className="text-emerald-700 dark:text-emerald-400">{cleared}</span>, `${transactions.length ? ((cleared / transactions.length) * 100).toFixed(1) : 0}% straight-through`, ShieldCheck)}
        {kpi('Scoring latency', latencyMs === null ? '—' : `${latencyMs.toFixed(2)} ms`, `${activeModelName}, measured in-browser`, Gauge, <ProvenanceBadge kind="measured" />)}
      </div>

      {/* Controls */}
      <section className="cs-card p-4 flex flex-wrap items-center justify-between gap-4" aria-label="Stream controls">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setStreamRunning((p) => !p)} className={`cs-btn ${streamRunning ? 'cs-btn-secondary' : 'cs-btn-primary'}`}>
            {streamRunning ? <Pause className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
            {streamRunning ? 'Pause stream' : 'Resume stream'}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs cs-muted" id="speed-label">Speed</span>
            <div className="cs-seg" role="group" aria-labelledby="speed-label">
              {[1, 2, 5].map((s) => (
                <button type="button" key={s} aria-pressed={speedMultiplier === s} onClick={() => setSpeedMultiplier(s)}>{s}×</button>
              ))}
            </div>
          </div>
          <button type="button" onClick={simulateSurge} className="cs-btn border border-red-300 text-red-700 hover:bg-red-50 dark:border-[#E5484D]/40 dark:text-red-300 dark:hover:bg-[#E5484D]/10" title="Adds 3 simulated transactions resampled from fraud-like training profiles. Their outcome stays unknown.">
            <Zap className="w-4 h-4" aria-hidden="true" /> Simulate attack surge (+3 simulated)
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="stream-threshold" className="text-xs cs-muted">
            Threshold <strong className="font-mono cs-accent">τ = {decisionThreshold.toFixed(2)}</strong>
          </label>
          <input id="stream-threshold" type="range" min="0.01" max="0.99" step="0.01" value={decisionThreshold} onChange={(e) => setDecisionThreshold(parseFloat(e.target.value))} className="w-36 accent-[#3988FF]" />
          <button type="button" onClick={() => setDecisionThreshold(recommendedThreshold)} disabled={Math.abs(decisionThreshold - recommendedThreshold) < 1e-9} className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline disabled:opacity-60 disabled:no-underline disabled:cursor-default">
            Use validation-tuned τ* = {recommendedThreshold.toFixed(2)}
          </button>
        </div>
      </section>

      {/* Analytics */}
      <section className="space-y-4">
        <SectionTitle
          title="Stream analytics & error modelling"
          subtitle="Computed over the current stream buffer. Cost figures use only rows with a known label."
          right={
            <div className="cs-seg" role="group" aria-label="Analytics view">
              <button type="button" aria-pressed={view === 'all'} onClick={() => setView('all')}>All</button>
              <button type="button" aria-pressed={view === 'spikes'} onClick={() => setView('spikes')}><LineChartIcon className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />Spikes</button>
              <button type="button" aria-pressed={view === 'costs'} onClick={() => setView('costs')}><BarChart3 className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />Costs</button>
              <button type="button" aria-pressed={view === 'density'} onClick={() => setView('density')}><Activity className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />Density</button>
            </div>
          }
        />
        {(view === 'all' || view === 'spikes') && <FraudSpikeChart transactions={transactions} decisionThreshold={decisionThreshold} />}
        {(view === 'all' || view === 'costs') && (
          <ErrorCostBreakdown transactions={transactions} decisionThreshold={decisionThreshold} costFP={costFP} setCostFP={setCostFP} costFNPenalty={costFNPenalty} setCostFNPenalty={setCostFNPenalty} />
        )}
        {(view === 'all' || view === 'density') && <ProbabilityDensityPlot transactions={transactions} decisionThreshold={decisionThreshold} />}
      </section>

      {/* Ledger */}
      <section className="cs-card p-5 space-y-4">
        <SectionTitle
          title="Transaction ledger"
          subtitle="Transaction ID, timestamp, amount, merchant category, fraud probability, predicted status and actual outcome (only when a label exists)."
          right={
            <div className="cs-seg" role="group" aria-label="Ledger source">
              <button type="button" aria-pressed={ledgerSource === 'stream'} onClick={() => setLedgerSource('stream')}>Live buffer ({transactions.length})</button>
              <button type="button" aria-pressed={ledgerSource === 'test'} onClick={() => setLedgerSource('test')}>Test split ({splits.test.length.toLocaleString()})</button>
              <button type="button" aria-pressed={ledgerSource === 'all'} onClick={() => setLedgerSource('all')}>All ({allTransactions.length.toLocaleString()})</button>
              <button type="button" aria-pressed={ledgerSource === 'manual'} onClick={() => setLedgerSource('manual')}>Manual tests ({manualTransactions.length})</button>
            </div>
          }
        />
        <DataLegend />
        <TransactionLedger
          transactions={ledgerRows}
          decisionThreshold={decisionThreshold}
          onInspect={setInspected}
          onExplain={onSelectTransaction}
          caption="Scored transactions"
          resetKey={ledgerSource}
        />
      </section>

      {inspected && (
        <TransactionDetailDrawer
          transaction={ledgerRows.find((t) => t.id === inspected.id) ?? inspected}
          decisionThreshold={decisionThreshold}
          onClose={() => setInspected(null)}
          onExplain={(tx) => {
            setInspected(null);
            onSelectTransaction(tx);
          }}
        />
      )}
    </div>
  );
};
