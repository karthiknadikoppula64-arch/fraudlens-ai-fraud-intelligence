import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from 'recharts';
import {
  Award,
  DollarSign,
  CheckCircle2,
  TrendingUp,
  ArrowRight,
  Activity,
  AlertTriangle,
  Clock,
  Users,
  Radio,
  HelpCircle,
  BarChart2,
} from 'lucide-react';
import { ROUTES, type NavTabId } from '../routes';
import { legendText } from './chartTheme';
import type { Transaction } from '../types/fraud';
import { useChrono } from '../state/ChronoContext';
import { useDriftAnalysis } from '../state/useDrift';
import { computeBinaryMetrics } from '../utils/metrics';
import { VirtualCard } from './VirtualCard';
import {
  ProvenanceBadge,
  PredictionBadge,
  OutcomeBadge,
  OriginBadge,
  DataLegend,
  RiskMeter,
  SectionTitle,
  EmptyState,
  categoryIcon,
  fmtMoney,
  fmtDateTimeUtc,
  type ProvenanceKind,
} from './ui';

interface HomeOverviewProps {
  onNavigate: (tab: NavTabId) => void;
  onSelectTransaction: (tx: Transaction) => void;
}

export const HomeOverview: React.FC<HomeOverviewProps> = ({ onNavigate, onSelectTransaction }) => {
  const {
    transactions,
    splits,
    evaluation,
    activeModelName,
    decisionThreshold,
    streamingTransactions,
    streamRunning,
    streamMode,
    processedCount,
    isSynthetic,
    costFP,
    costFNPenalty,
  } = useChrono();
  const drift = useDriftAnalysis('Confirmed Frauds', 0.95);

  // ---- KPI computations (all from real model / data logic)
  const best = useMemo(() => {
    if (!evaluation) return null;
    return Object.values(evaluation).reduce((a, b) => (b.prAuc > a.prAuc ? b : a));
  }, [evaluation]);
  const activeEval = evaluation?.[activeModelName] ?? null;

  const testAtCurrentThreshold = useMemo(() => {
    const rows = splits.test
      .filter((t) => t.groundTruthLabel !== null)
      .map((t) => ({ probability: t.predictedProbability, label: t.groundTruthLabel as 0 | 1, amount: t.amount }));
    if (rows.length === 0) return null;
    return computeBinaryMetrics(rows, decisionThreshold, costFP, costFNPenalty);
  }, [splits.test, decisionThreshold, costFP, costFNPenalty]);

  const kpis: { label: string; value: string; sub: string; icon: React.ElementType; kind: ProvenanceKind; tip: string; to: NavTabId }[] = [
    {
      label: 'PR-AUC (best model)',
      value: best ? best.prAuc.toFixed(3) : '—',
      sub: best ? `${best.name} · held-out test, ${best.evaluatedFrauds} frauds / ${best.evaluatedCount} rows` : 'Awaiting training',
      icon: Award,
      kind: 'measured',
      tip: 'Average precision on the labelled held-out test split (latest 20% by time). Models never saw these rows.',
      to: 'models',
    },
    {
      label: 'Estimated cost savings',
      value: activeEval ? fmtMoney(activeEval.dollarsSaved, 0) : '—',
      sub: activeEval ? `${activeModelName} at validation-tuned τ=${activeEval.threshold.toFixed(2)} vs. no model` : 'Awaiting training',
      icon: DollarSign,
      kind: 'estimated',
      tip: `Test-split cost with no model (all fraud lost + $${costFNPenalty} penalty each) minus cost with the model ($${costFP} per review + missed fraud + penalties). Depends on your cost assumptions.`,
      to: 'models',
    },
    {
      label: 'Fraud catch rate (recall)',
      value: testAtCurrentThreshold ? `${(testAtCurrentThreshold.recall * 100).toFixed(1)}%` : '—',
      sub: testAtCurrentThreshold ? `${activeModelName} at τ=${decisionThreshold.toFixed(2)} · ${testAtCurrentThreshold.tp}/${testAtCurrentThreshold.frauds} test frauds caught` : 'Awaiting training',
      icon: CheckCircle2,
      kind: 'measured',
      tip: 'Share of confirmed test-split frauds whose predicted probability is at or above the current threshold.',
      to: 'stream',
    },
    {
      label: 'Explanation stability',
      value: drift?.stabilityPct != null ? `${drift.stabilityPct.toFixed(1)}%` : '—',
      sub: drift ? `${drift.testsRun - drift.driftCount}/${drift.testsRun} window×feature tests within 95% CI (confirmed-fraud attributions)` : 'Awaiting training',
      icon: TrendingUp,
      kind: 'measured',
      tip: 'Share of post-training time windows × feature groups whose mean |attribution| over confirmed-fraud transactions stays within expected sampling variation of the training-period baseline (Z-test, 95%).',
      to: 'drift',
    },
  ];

  // ---- Spend summary from the dataset (most recent 30 days of data)
  const spend = useMemo(() => {
    if (transactions.length === 0) return null;
    const end = Date.parse(transactions[transactions.length - 1].timestamp);
    const recent = transactions.filter((t) => Date.parse(t.timestamp) > end - 30 * 86400000);
    const total = recent.reduce((s, t) => s + t.amount, 0);
    const byCat = new Map<string, number>();
    recent.forEach((t) => byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount));
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    return { total, count: recent.length, top, endDate: new Date(end).toISOString().slice(0, 10) };
  }, [transactions]);

  // ---- Fraud trend: weekly buckets over the whole dataset
  const trend = useMemo(() => {
    if (transactions.length === 0) return { data: [] as Record<string, number | string>[], valStart: '', testStart: '' };
    const t0 = Date.parse(transactions[0].timestamp);
    const week = 7 * 86400000;
    const buckets = new Map<number, { confirmed: number; flagged: number; total: number; labelled: number }>();
    for (const t of transactions) {
      const k = Math.floor((Date.parse(t.timestamp) - t0) / week);
      const b = buckets.get(k) ?? { confirmed: 0, flagged: 0, total: 0, labelled: 0 };
      b.total++;
      if (t.groundTruthLabel !== null) b.labelled++;
      if (t.groundTruthLabel === 1) b.confirmed++;
      if (t.predictedProbability >= decisionThreshold) b.flagged++;
      buckets.set(k, b);
    }
    const label = (k: number) => new Date(t0 + k * week).toISOString().slice(5, 10);
    const data = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => ({
      week: label(k),
      'Confirmed fraud': b.confirmed,
      'Flagged by model': b.flagged,
      'Fraud rate %': b.labelled ? Math.round((b.confirmed / b.labelled) * 1000) / 10 : 0,
    }));
    const keyOf = (rows: Transaction[]) => (rows[0] ? label(Math.floor((Date.parse(rows[0].timestamp) - t0) / week)) : '');
    return { data, valStart: keyOf(splits.validation), testStart: keyOf(splits.test) };
  }, [transactions, decisionThreshold, splits.validation, splits.test]);

  const highPriority = useMemo(
    () =>
      streamingTransactions
        .filter((t) => t.predictedProbability >= decisionThreshold)
        .sort((a, b) => b.predictedProbability * b.amount - a.predictedProbability * a.amount)
        .slice(0, 4),
    [streamingTransactions, decisionThreshold]
  );
  const flaggedInBuffer = streamingTransactions.filter((t) => t.predictedProbability >= decisionThreshold).length;
  const recent = streamingTransactions.slice(0, 6);

  const contributions: { id: NavTabId; title: string; tag: string; text: string; icon: React.ElementType }[] = [
    { id: 'drift', title: 'Confidence-bounded SHAP drift', tag: 'Pillar 1', icon: TrendingUp, text: 'Flags explanation drift only when the shift in mean attribution exceeds expected sampling variation, suppressing false alarms in low-volume windows.' },
    { id: 'delayed', title: 'Delayed-label evaluation', tag: 'Pillar 2', icon: Clock, text: 'Shows how apparent recall and PR-AUC are biased while 7–60 day chargeback labels are still maturing (simulated lags on real test predictions).' },
    { id: 'queue', title: 'Limited review queue', tag: 'Pillar 3', icon: Users, text: 'Applies a daily analyst capacity to test-split alerts and compares expected-dollar-loss ranking with probability ranking.' },
  ];

  return (
    <div className="space-y-6 pb-8">
      {/* KPI tiles */}
      <section className="space-y-3">
        <SectionTitle
          title="Core performance benchmarks"
          subtitle="Computed from the active dataset: models trained on the train split, thresholds tuned on validation, metrics on the held-out test split."
          right={<DataLegend />}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <button
                type="button"
                key={k.label}
                onClick={() => onNavigate(k.to)}
                className="cs-card p-4 text-left border border-slate-200/90 dark:border-[#173B70]/60 hover:border-[#3988FF]/70 hover:shadow-md transition-all duration-150 focus-visible:outline-2 group"
                aria-label={`${k.label}: ${k.value}. ${k.sub}. Open details`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium cs-muted">{k.label}</span>
                  <span title={k.tip} className="cs-subtle opacity-70 group-hover:opacity-100 transition-opacity"><HelpCircle className="w-3.5 h-3.5" aria-hidden="true" /></span>
                </div>
                <div className="flex items-baseline justify-between mt-2.5">
                  <span className="text-2xl font-bold font-mono tracking-tight tabular-nums cs-text">{k.value}</span>
                  <span className="p-2 rounded-xl bg-blue-500/10 text-[#3988FF] border border-blue-500/20 group-hover:scale-105 transition-transform"><Icon className="w-4 h-4" aria-hidden="true" /></span>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2 pt-2 border-t cs-divider">
                  <span className="text-[11px] cs-subtle truncate">{k.sub}</span>
                  <span className="shrink-0 flex gap-1">
                    <ProvenanceBadge kind={k.kind} />
                    {isSynthetic && <ProvenanceBadge kind="synthetic" label="Synthetic" />}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Banking + command center */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 space-y-3">
          <SectionTitle title="Monitored demo account" subtitle="Decorative demo card. No real card numbers, CVVs or credentials are collected or displayed." />
          <VirtualCard balanceLabel="Demo balance (not real)" balance="$12,480.00" />
          <div className="cs-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold cs-text">Spend summary · last 30 days of data</span>
              <span className="text-xs font-mono cs-subtle">to {spend?.endDate ?? '—'}</span>
            </div>
            {spend ? (
              <>
                <div className="flex items-baseline gap-3">
                  <span className="text-xl font-bold font-mono cs-text tabular-nums">{fmtMoney(spend.total, 0)}</span>
                  <span className="text-xs cs-muted">{spend.count.toLocaleString()} transactions</span>
                </div>
                <ul className="space-y-1.5">
                  {spend.top.map(([cat, amt]) => {
                    const Icon = categoryIcon(cat);
                    return (
                      <li key={cat} className="flex items-center gap-2 text-xs">
                        <Icon className="w-3.5 h-3.5 cs-subtle" aria-hidden="true" />
                        <span className="w-28 truncate cs-muted">{cat}</span>
                        <span className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" aria-hidden="true">
                          <span className="block h-full bg-[#3988FF]" style={{ width: `${(amt / spend.total) * 100}%` }} />
                        </span>
                        <span className="font-mono tabular-nums cs-text w-20 text-right">{fmtMoney(amt, 0)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <EmptyState message="No data loaded yet." />
            )}
          </div>
        </section>

        <section className="lg:col-span-7 space-y-3">
          <SectionTitle
            title="Live stream operations & alerts"
            subtitle={streamMode === 'test_cohort' ? 'Chronological replay of held-out test transactions.' : 'Synthetic stream – simulated transactions with no real outcome.'}
            right={
              <button type="button" onClick={() => onNavigate('stream')} className="text-xs font-semibold cs-accent hover:underline inline-flex items-center gap-1">
                Open ledger <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            }
          />
          <div className="cs-card p-4 grid grid-cols-3 gap-3">
            <div>
              <span className="text-xs uppercase font-mono cs-subtle block">Stream status</span>
              <span className={`text-sm font-bold inline-flex items-center gap-1.5 mt-1 ${streamRunning ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                <Radio className="w-4 h-4" aria-hidden="true" /> {streamRunning ? 'Running' : 'Paused'}
              </span>
              <span className="block mt-1">{streamMode === 'synthetic_stream' ? <ProvenanceBadge kind="simulated" /> : <ProvenanceBadge kind={isSynthetic ? 'synthetic' : 'historical'} label="Test replay" />}</span>
            </div>
            <div>
              <span className="text-xs uppercase font-mono cs-subtle block">Processed</span>
              <span className="text-lg font-bold font-mono cs-text tabular-nums">{processedCount.toLocaleString()}</span>
              <span className="text-xs cs-subtle block">events this session</span>
            </div>
            <div>
              <span className="text-xs uppercase font-mono cs-subtle block">Flagged in buffer</span>
              <span className="text-lg font-bold font-mono text-amber-700 dark:text-amber-400 tabular-nums">{flaggedInBuffer}</span>
              <span className="text-xs cs-subtle block">of {streamingTransactions.length} · τ ≥ {decisionThreshold.toFixed(2)}</span>
            </div>
          </div>

          <div className="cs-card p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-400 inline-flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> High-priority alerts
              </h3>
              <span className="text-xs font-mono cs-subtle">ranked by expected loss (P × amount)</span>
            </div>
            {highPriority.length === 0 ? (
              <EmptyState message="No transactions in the stream buffer exceed the threshold." />
            ) : (
              <ul className="space-y-2">
                {highPriority.map((t) => {
                  const Icon = categoryIcon(t.category);
                  return (
                    <li key={t.id} className="cs-inset p-2.5 flex items-center justify-between gap-3 text-xs">
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Icon className="w-4 h-4 cs-subtle shrink-0" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="font-mono font-semibold cs-text block truncate">{t.id}</span>
                          <span className="cs-subtle text-xs">{fmtMoney(t.amount)} · {t.category}</span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <RiskMeter probability={t.predictedProbability} threshold={decisionThreshold} />
                        <OutcomeBadge label={t.groundTruthLabel} />
                        <button type="button" onClick={() => onSelectTransaction(t)} className="cs-btn cs-btn-secondary !py-1 !px-2">Investigate</button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Fraud trend */}
      <section className="cs-card p-5 space-y-3">
        <SectionTitle
          as="h2"
          title="Fraud trend over time"
          subtitle="Weekly confirmed fraud (dataset labels) vs. transactions flagged by the active model at the current threshold. Dashed lines mark where validation and test periods begin."
          right={<span className="flex gap-1"><ProvenanceBadge kind="confirmed" /><ProvenanceBadge kind="predicted" /></span>}
        />
        <div className="h-64 w-full" role="img" aria-label="Weekly confirmed fraud and model-flagged transaction counts">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trend.data} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.25} />
              <XAxis dataKey="week" stroke="#8494AB" fontSize={12} tickLine={false} minTickGap={24} />
              <YAxis yAxisId="left" stroke="#8494AB" fontSize={12} tickLine={false} allowDecimals={false} />
              <YAxis yAxisId="right" orientation="right" stroke="#8494AB" fontSize={12} tickLine={false} unit="%" />
              <Tooltip contentStyle={{ background: '#0B1220', border: '1px solid #173B70', borderRadius: 12, fontSize: 12, color: '#F1F5F9' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
              {trend.valStart && <ReferenceLine yAxisId="left" x={trend.valStart} stroke="#3988FF" strokeDasharray="4 4" label={{ value: 'Validation', fill: '#3988FF', fontSize: 12, position: 'insideTopLeft', className: 'cs-svg-blue' }} />}
              {trend.testStart && <ReferenceLine yAxisId="left" x={trend.testStart} stroke="#3988FF" strokeDasharray="4 4" label={{ value: 'Test', fill: '#3988FF', fontSize: 12, position: 'insideTopLeft', className: 'cs-svg-blue' }} />}
              <Bar yAxisId="left" dataKey="Confirmed fraud" fill="#E5484D" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line yAxisId="left" type="monotone" dataKey="Flagged by model" stroke="#F59E0B" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="right" type="monotone" dataKey="Fraud rate %" stroke="#3988FF" strokeWidth={1.5} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Recent activity */}
      <section className="cs-card p-5 space-y-3">
        <SectionTitle
          title="Recent activity"
          subtitle="Latest events from the live stream buffer with model predictions and confirmed outcomes."
          right={
            <button type="button" onClick={() => onNavigate('stream')} className="cs-btn cs-btn-secondary !py-1.5">
              <Activity className="w-3.5 h-3.5 text-[#3988FF]" aria-hidden="true" /> Open ledger
            </button>
          }
        />
        {recent.length === 0 ? (
          <EmptyState message="Stream buffer is empty." />
        ) : (
          <ul className="divide-y cs-divider">
            {recent.map((t) => {
              const Icon = categoryIcon(t.category);
              return (
                <li key={t.id} className="py-2.5 flex flex-wrap items-center gap-3 justify-between">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="p-2 rounded-xl cs-inset"><Icon className="w-4 h-4 cs-muted" aria-hidden="true" /></span>
                    <span className="min-w-0">
                      <span className="text-sm font-medium cs-text block truncate">{t.merchant}</span>
                      <span className="text-xs font-mono cs-subtle">{t.id} · {fmtDateTimeUtc(t.timestamp)}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold tabular-nums cs-text w-24 text-right">{fmtMoney(t.amount)}</span>
                    <OriginBadge origin={t.origin} />
                    <PredictionBadge probability={t.predictedProbability} threshold={decisionThreshold} compact />
                    <OutcomeBadge label={t.groundTruthLabel} />
                    <button type="button" onClick={() => onSelectTransaction(t)} className="cs-btn cs-btn-secondary !py-1 !px-2" aria-label={`Explain ${t.id}`}>Explain</button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Research contributions */}
      <section className="space-y-3">
        <SectionTitle title="Research contributions" subtitle="Each module runs on the active dataset and trained models." />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {contributions.map((c) => {
            const Icon = c.icon;
            return (
              <article key={c.id} className="cs-card p-5 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="p-2 rounded-xl bg-[#3988FF]/10 text-[#3988FF]"><Icon className="w-5 h-5" aria-hidden="true" /></span>
                    <span className="text-xs font-mono cs-subtle">{c.tag}</span>
                  </div>
                  <h3 className="text-sm font-bold cs-text">{c.title}</h3>
                  <p className="text-xs cs-muted leading-relaxed">{c.text}</p>
                </div>
                <a
                  href={ROUTES[c.id].path}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // allow open-in-new-tab
                    e.preventDefault();
                    onNavigate(c.id);
                  }}
                  className="mt-4 text-xs font-semibold cs-accent hover:underline inline-flex items-center gap-1"
                >
                  Open {c.title.toLowerCase()} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              </article>
            );
          })}
        </div>
        <button type="button" onClick={() => onNavigate('models')} className="cs-btn cs-btn-secondary">
          <BarChart2 className="w-3.5 h-3.5 text-[#3988FF]" aria-hidden="true" /> Compare models & cost curves
        </button>
      </section>
    </div>
  );
};
