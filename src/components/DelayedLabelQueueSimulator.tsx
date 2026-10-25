import React, { useMemo } from 'react';
import { useSessionState } from '../state/useSessionState';
import { legendText } from './chartTheme';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Clock, Users, Info, CheckCircle2 } from 'lucide-react';
import { useChrono } from '../state/ChronoContext';
import { computeDelayHorizons, selectDelayedPeriod, type DelayHorizon } from '../utils/delayedLabels';
import { DelayedPeriodDetail } from './DelayedPeriodDetail';
import { ReviewWorkbench } from './ReviewWorkbench';
import { runDailyQueueSimulation, type AlertOrderingStrategy, type DailyAlert } from '../utils/queueSimulation';
import { averagePrecision } from '../utils/metrics';
import { ProvenanceBadge, SectionTitle, EmptyState, fmtMoney } from './ui';

interface Props {
  mode?: 'all' | 'delayed' | 'queue';
}

const STRATEGIES: AlertOrderingStrategy[] = ['Highest Expected Dollar Loss', 'Cost-Utility Net Value', 'Highest Risk Score', 'Random Exploration'];
const BAR_SERIES: { key: keyof DelayHorizon; name: string; fill: string }[] = [
  { key: 'confirmedFraud', name: 'Confirmed fraud', fill: '#E5484D' },
  { key: 'confirmedLegit', name: 'Confirmed legitimate', fill: '#10B981' },
  { key: 'unconfirmedLatent', name: 'Not yet labelled', fill: '#F59E0B' },
];

/** Tooltip built from the same DelayHorizon object as the bars and the detail panel. */
const HorizonTooltip: React.FC<{ active?: boolean; payload?: { payload?: DelayHorizon }[]; selected: number }> = ({ active, payload, selected }) => {
  const h = active ? payload?.[0]?.payload : undefined;
  if (!h) return null;
  return (
    <div style={tooltipStyle} className="px-3 py-2 space-y-0.5">
      <p className="font-bold">{h.dayLabel} horizon{h.days === selected ? ' (selected)' : ''}</p>
      <p>Confirmed fraud: {h.confirmedFraud}</p>
      <p>Confirmed legitimate: {h.confirmedLegit}</p>
      <p>Not yet labelled: {h.unconfirmedLatent}</p>
      <p>Total: {h.total} · apparent PR-AUC {h.apparentPrAuc.toFixed(3)}</p>
      <p style={{ color: '#8494AB' }}>{h.days === selected ? 'Details below' : 'Click to list these transactions'}</p>
    </div>
  );
};

const tooltipStyle = { background: '#0B1220', border: '1px solid #173B70', borderRadius: 12, fontSize: 12, color: '#F1F5F9' };

export const DelayedLabelQueueSimulator: React.FC<Props> = ({ mode = 'all' }) => {
  const { splits, decisionThreshold, activeModelName, costFP, bundle } = useChrono();
  // Selected horizon / strategy / capacity persist when navigating away and back.
  const [delay, setDelay] = useSessionState<number>('delayed.horizon', 14);
  const [strategy, setStrategy] = useSessionState<AlertOrderingStrategy>('queue.strategy', 'Highest Expected Dollar Loss');
  const [costPerReview, setCostPerReview] = useSessionState<number>('queue.costPerReview', costFP);

  const labelledTest = useMemo(() => splits.test.filter((t) => t.groundTruthLabel !== null), [splits.test]);

  // ---------------- delayed labels
  const horizons = useMemo(
    () => computeDelayHorizons(labelledTest.map((t) => ({ probability: t.predictedProbability, label: t.groundTruthLabel as 0 | 1, lagDays: t.labelArrivalDays })), decisionThreshold),
    [labelledTest, decisionThreshold]
  );
  const selection = useMemo(() => selectDelayedPeriod(splits.test, delay, decisionThreshold), [splits.test, delay, decisionThreshold]);
  const finalPrAuc = useMemo(() => averagePrecision(labelledTest.map((t) => ({ probability: t.predictedProbability, label: t.groundTruthLabel as 0 | 1 }))), [labelledTest]);

  // ---------------- queue
  const alerts = useMemo<DailyAlert[]>(
    () =>
      labelledTest
        .filter((t) => t.predictedProbability >= decisionThreshold)
        .map((t) => ({ id: t.id, amount: t.amount, predictedProbability: t.predictedProbability, groundTruthLabel: t.groundTruthLabel as 0 | 1, day: t.timestamp.slice(0, 10) })),
    [labelledTest, decisionThreshold]
  );
  const maxDaily = useMemo(() => {
    const m = new Map<string, number>();
    alerts.forEach((a) => m.set(a.day, (m.get(a.day) ?? 0) + 1));
    return Math.max(1, ...m.values());
  }, [alerts]);
  const [capacityRaw, setCapacity] = useSessionState<number | null>('queue.capacity', null);
  const capacity = Math.min(capacityRaw ?? Math.max(1, Math.ceil(maxDaily / 2)), maxDaily);

  const results = useMemo(() => STRATEGIES.map((s) => runDailyQueueSimulation(alerts, capacity, s, costPerReview)), [alerts, capacity, costPerReview]);
  const activeResult = results.find((r) => r.strategy === strategy) ?? results[0];
  const curve = useMemo(() => {
    const out: Record<string, number>[] = [];
    for (let c = 1; c <= maxDaily; c++) {
      const row: Record<string, number> = { capacity: c };
      STRATEGIES.forEach((s) => (row[s] = runDailyQueueSimulation(alerts, c, s, costPerReview).fraudDollarsCaptured));
      out.push(row);
    }
    return out;
  }, [alerts, maxDaily, costPerReview]);

  if (!bundle) return <div className="cs-card p-6"><EmptyState message="Models are training…" /></div>;
  const showDelayed = mode !== 'queue';
  const showQueue = mode !== 'delayed';

  return (
    <div className="space-y-6 pb-10">
      {showDelayed && (
        <section className="cs-card p-5 space-y-5">
          <SectionTitle
            title="Delayed-label evaluation protocol"
            subtitle={`Predictions: ${activeModelName} on ${labelledTest.length.toLocaleString()} labelled held-out test transactions at τ = ${decisionThreshold.toFixed(2)}. Each bar is a cumulative horizon over the same transactions: Day H shows how many labels are known H days after each transaction, given a simulated dispute lag (7/14/30/60 days, deterministic per transaction id and independent of the label). Labels not yet revealed are treated as legitimate – the naive practice this protocol exposes.`}
            right={<span className="flex gap-1"><ProvenanceBadge kind="simulated" label="Simulated lags" /><ProvenanceBadge kind="predicted" /></span>}
          />
          <div className="h-64 w-full" role="img" aria-label={`Label maturation by horizon. Selected: Day ${delay}. Click a bar, or use the horizon buttons below, to list its transactions.`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={horizons} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} style={{ cursor: 'pointer' }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.25} />
                <XAxis dataKey="dayLabel" stroke="#8494AB" fontSize={12} tickLine={false} />
                <YAxis stroke="#8494AB" fontSize={12} tickLine={false} />
                <Tooltip content={<HorizonTooltip selected={delay} />} cursor={{ fill: '#3988FF', fillOpacity: 0.08 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
                {BAR_SERIES.map((b, bi) => (
                  <Bar
                    key={b.key}
                    dataKey={b.key}
                    name={b.name}
                    stackId="a"
                    fill={b.fill}
                    isAnimationActive={false}
                    // A transparent full-height background on the first series makes the whole column
                    // clickable (thin segments, e.g. a handful of confirmed frauds, are 1–2 px tall).
                    // The index comes from the clicked element itself, never from hover state.
                    background={bi === 0 ? { fill: 'transparent' } : undefined}
                    onClick={(_d, index) => { const h = horizons[index]; if (h) setDelay(h.days); }}
                  >
                    {horizons.map((h) => (
                      <Cell key={h.days} fillOpacity={h.days === delay ? 1 : 0.35} stroke={h.days === delay ? '#3988FF' : 'none'} strokeWidth={h.days === delay ? 2 : 0} />
                    ))}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs cs-muted">Select a horizon (click a bar or a card) to list the transactions behind it.</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4" role="group" aria-label="Evaluation horizon">
            {horizons.map((h) => {
              const sel = delay === h.days;
              return (
                <button
                  type="button"
                  key={h.days}
                  onClick={() => setDelay(h.days)}
                  aria-pressed={sel}
                  aria-label={`Day ${h.days} horizon: ${h.confirmedFraud} confirmed fraud, ${h.confirmedLegit} confirmed legitimate, ${h.unconfirmedLatent} not yet labelled`}
                  className={`text-left p-4 rounded-xl border transition-colors ${sel ? 'border-[#3988FF] bg-[#3988FF]/10' : 'cs-inset hover:border-[#3988FF]/50'}`}
                >
                  <span className="flex items-center justify-between text-xs font-bold cs-text mb-2">{h.dayLabel} {sel && <CheckCircle2 className="w-4 h-4 text-[#3988FF]" aria-hidden="true" />}</span>
                  <dl className="space-y-1 text-xs font-mono">
                    <div className="flex justify-between cs-muted"><dt>Confirmed fraud</dt><dd className="text-red-600 dark:text-red-400 font-bold">{h.confirmedFraud}</dd></div>
                    <div className="flex justify-between cs-muted"><dt>Confirmed legit</dt><dd className="text-emerald-700 dark:text-emerald-400 font-bold">{h.confirmedLegit}</dd></div>
                    <div className="flex justify-between cs-muted"><dt>Not yet labelled</dt><dd className="text-amber-700 dark:text-amber-400 font-bold">{h.unconfirmedLatent}</dd></div>
                    <div className="flex justify-between border-t cs-divider pt-1 cs-accent font-bold"><dt>Apparent PR-AUC</dt><dd>{h.apparentPrAuc.toFixed(3)}</dd></div>
                    <div className="flex justify-between cs-muted"><dt>Apparent recall</dt><dd>{(h.apparentRecall * 100).toFixed(1)}%</dd></div>
                    <div className="flex justify-between cs-muted"><dt>Apparent precision</dt><dd>{(h.apparentPrecision * 100).toFixed(1)}%</dd></div>
                  </dl>
                </button>
              );
            })}
          </div>
          <p className="text-xs cs-muted flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#3988FF]" aria-hidden="true" />
            Fully matured test PR-AUC (all labels known): <strong className="font-mono cs-text">{finalPrAuc.toFixed(3)}</strong>. At day {delay}, apparent precision is biased down (true frauds not yet confirmed look like false alarms).
          </p>
          <DelayedPeriodDetail selection={selection} threshold={decisionThreshold} modelName={activeModelName} />
        </section>
      )}

      {showQueue && (
        <section className="cs-card p-5 space-y-2" aria-label="About this page">
          <div className="flex flex-wrap items-center gap-2">
            <ProvenanceBadge kind="simulated" label="Simulation / demo" />
            <h2 className="text-sm font-bold cs-text">What this page is for</h2>
          </div>
          <p className="text-xs cs-muted leading-relaxed max-w-4xl">
            A fraud team cannot review every alert. This page uses the real trained model’s alerts on the held-out test split to show (1) a workbench where you can step through flagged
            transactions and record <em>simulated</em> reviewer decisions, and (2) a capacity simulation of how much fraud a team recovers when it can only review N alerts per day under different
            ordering strategies. Nothing here changes dataset labels, training or reported metrics.
          </p>
        </section>
      )}
      {showQueue && <ReviewWorkbench />}
      {showQueue && (
        <section className="cs-card p-5 space-y-5">
          <SectionTitle
            title="Capacity simulation: limited human-review queue"
            subtitle={`Alerts: ${alerts.length.toLocaleString()} labelled test-split transactions flagged by ${activeModelName} at τ = ${decisionThreshold.toFixed(2)}, grouped by calendar day (busiest day: ${maxDaily}). Each day only the top-N alerts under the chosen ordering are reviewed; reviewed true frauds are recovered.`}
            right={<span className="flex gap-1"><ProvenanceBadge kind="simulated" label="Simulated capacity" /><ProvenanceBadge kind="estimated" /></span>}
          />
          {alerts.length === 0 ? (
            <EmptyState message="No test-split alerts at the current threshold. Lower τ on the Stream or Models page." />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 cs-inset p-4 text-xs">
                <label className="block">
                  <span className="flex justify-between mb-1.5 cs-muted">Reviews per day <strong className="font-mono cs-accent">{capacity}</strong></span>
                  <input type="range" aria-label="Reviews per day" min="1" max={maxDaily} step="1" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} className="w-full accent-[#3988FF]" />
                </label>
                <label className="block">
                  <span className="flex justify-between mb-1.5 cs-muted">Cost per review <strong className="font-mono text-amber-700 dark:text-amber-400">${costPerReview}</strong></span>
                  <input type="range" aria-label="Cost per review in dollars" min="1" max="100" step="1" value={costPerReview} onChange={(e) => setCostPerReview(Number(e.target.value))} className="w-full accent-amber-500" />
                </label>
              </div>

              <div className="h-72 w-full" role="img" aria-label="Fraud dollars captured by daily capacity and strategy">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={curve} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.25} />
                    <XAxis dataKey="capacity" stroke="#8494AB" fontSize={12} tickLine={false} label={{ value: 'reviews / day', position: 'insideBottomRight', offset: -2, fontSize: 12, fill: '#8494AB' }} />
                    <YAxis stroke="#8494AB" fontSize={12} tickLine={false} tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                    <Tooltip formatter={(v) => fmtMoney(Number(v), 0)} contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
                    <Line type="monotone" dataKey="Highest Expected Dollar Loss" stroke="#3988FF" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="Cost-Utility Net Value" stroke="#10B981" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="Highest Risk Score" stroke="#F59E0B" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="Random Exploration" stroke="#8494AB" strokeWidth={1.5} strokeDasharray="2 2" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {results.map((r) => {
                  const sel = r.strategy === strategy;
                  return (
                    <button type="button" key={r.strategy} onClick={() => setStrategy(r.strategy)} aria-pressed={sel} className={`text-left p-4 rounded-xl border transition-colors ${sel ? 'border-[#3988FF] bg-[#3988FF]/10' : 'cs-inset hover:border-[#3988FF]/50'}`}>
                      <span className="text-xs font-bold cs-text block">{r.strategy}</span>
                      <span className="text-xs cs-subtle block mt-2">Fraud $ captured</span>
                      <span className="text-base font-bold font-mono cs-accent tabular-nums">{fmtMoney(r.fraudDollarsCaptured, 0)}</span>
                      <dl className="mt-2 space-y-1 text-xs border-t cs-divider pt-2">
                        <div className="flex justify-between cs-muted"><dt>Frauds found</dt><dd className="font-mono cs-text">{r.trueFraudsFound}</dd></div>
                        <div className="flex justify-between cs-muted"><dt>False alerts reviewed</dt><dd className="font-mono text-amber-700 dark:text-amber-400">{r.falseAlertsReviewed}</dd></div>
                        <div className="flex justify-between cs-muted"><dt>Net value</dt><dd className={`font-mono font-semibold ${r.netValueSaved >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(r.netValueSaved, 0)}</dd></div>
                      </dl>
                    </button>
                  );
                })}
              </div>

              <div className="cs-inset p-4 text-xs space-y-2">
                <div className="flex flex-wrap gap-6 font-mono">
                  <span><span className="cs-subtle block">Reviewed</span><strong className="cs-text">{activeResult.totalReviewed} / {activeResult.totalAlertsGenerated} alerts over {activeResult.days} days</strong></span>
                  <span><span className="cs-subtle block">Utilisation</span><strong className="cs-text">{activeResult.workloadSaturationPct}%</strong></span>
                  <span><span className="cs-subtle block">Review cost</span><strong className="text-amber-700 dark:text-amber-400">{fmtMoney(activeResult.investigationCostSpent, 0)}</strong></span>
                  <span><span className="cs-subtle block">Fraud $ missed</span><strong className="text-red-600 dark:text-red-400">{fmtMoney(activeResult.fraudDollarsMissed, 0)}</strong></span>
                </div>
                <p className="cs-muted leading-relaxed">
                  {strategy === 'Highest Expected Dollar Loss' && 'Orders alerts by P(fraud) × amount, so high-value attacks are reviewed first even if their probability is slightly lower.'}
                  {strategy === 'Highest Risk Score' && 'Orders by model probability only. Maximises expected fraud count but may spend capacity on low-value alerts.'}
                  {strategy === 'Cost-Utility Net Value' && `Orders by expected recovery minus the $${costPerReview} review cost.`}
                  {strategy === 'Random Exploration' && 'Deterministic pseudo-random order – a control to measure the lift from ML prioritisation.'}
                </p>
              </div>
            </>
          )}
          <p className="text-xs cs-subtle flex items-center gap-1.5"><Users className="w-3.5 h-3.5" aria-hidden="true" /> Unreviewed alerts are counted as missed. Unlabelled test rows are excluded. <Clock className="w-3.5 h-3.5 ml-2" aria-hidden="true" /> Days are UTC calendar days.</p>
        </section>
      )}
    </div>
  );
};
