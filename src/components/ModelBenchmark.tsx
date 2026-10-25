import React, { useMemo } from 'react';
import { useSessionState } from '../state/useSessionState';
import { legendText } from './chartTheme';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend } from 'recharts';
import { Layers, Sliders, Award, Info } from 'lucide-react';
import { MODEL_NAMES, type ModelName } from '../types/fraud';
import { useChrono } from '../state/ChronoContext';
import { evaluateModels } from '../utils/pipeline';
import { computeBinaryMetrics, type ScoredLabelledRow } from '../utils/metrics';
import { ProvenanceBadge, SectionTitle, EmptyState, fmtMoney } from './ui';

type Cohort = 'Train' | 'Validation' | 'Test';

export const ModelBenchmark: React.FC = () => {
  const {
    bundle,
    dataset,
    splits,
    activeModelName,
    setActiveModelName,
    decisionThreshold,
    setDecisionThreshold,
    recommendedThreshold,
    costFP,
    setCostFP,
    costFNPenalty,
    setCostFNPenalty,
  } = useChrono();
  const [cohort, setCohort] = useSessionState<Cohort>('models.cohort', 'Test');

  const rows = useMemo(() => {
    if (!bundle || !dataset) return null;
    return evaluateModels(bundle, dataset.parse.transactions, costFP, costFNPenalty, cohort);
  }, [bundle, dataset, costFP, costFNPenalty, cohort]);

  const bestPrAuc = rows ? Math.max(...MODEL_NAMES.map((n) => rows[n].prAuc)) : 0;

  // Cost curves for the active model: validation (used for tuning) and test (reported)
  const curve = useMemo(() => {
    if (!bundle || !dataset) return [];
    const probs = bundle.probabilities[activeModelName];
    const collect = (split: string): ScoredLabelledRow[] =>
      dataset.parse.transactions
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.split === split && t.groundTruthLabel !== null)
        .map(({ t, i }) => ({ probability: probs[i], label: t.groundTruthLabel as 0 | 1, amount: t.amount }));
    const val = collect('validation');
    const test = collect('test');
    const out: { threshold: number; validation: number; test: number }[] = [];
    for (let k = 1; k <= 99; k++) {
      const th = k / 100;
      out.push({
        threshold: th,
        validation: computeBinaryMetrics(val, th, costFP, costFNPenalty).totalCost,
        test: computeBinaryMetrics(test, th, costFP, costFNPenalty).totalCost,
      });
    }
    return out;
  }, [bundle, dataset, activeModelName, costFP, costFNPenalty]);

  // Active model at the CURRENT deployment threshold τ on the selected cohort (same computeBinaryMetrics
  // as everywhere else), so moving the τ slider visibly updates precision / recall / cost.
  const atTau = useMemo(() => {
    if (!bundle || !dataset) return null;
    const probs = bundle.probabilities[activeModelName];
    const split = cohort === 'Train' ? 'train' : cohort === 'Validation' ? 'validation' : 'test';
    const rowsAt: ScoredLabelledRow[] = [];
    dataset.parse.transactions.forEach((t, i) => {
      if (t.split === split && t.groundTruthLabel !== null) rowsAt.push({ probability: probs[i], label: t.groundTruthLabel, amount: t.amount });
    });
    return computeBinaryMetrics(rowsAt, decisionThreshold, costFP, costFNPenalty);
  }, [bundle, dataset, activeModelName, cohort, decisionThreshold, costFP, costFNPenalty]);

  const s = splits.splitSummary;
  const splitCards: { key: Cohort; title: string; text: string; range: string; role: string }[] = [
    { key: 'Train', title: 'Train (first 60% by time)', text: `${s.trainCount.toLocaleString()} txns · ${s.trainFrauds} frauds`, range: s.trainDateRange, role: 'Model fitting + feature statistics only' },
    { key: 'Validation', title: 'Validation (next 20%)', text: `${s.valCount.toLocaleString()} txns · ${s.valFrauds} frauds`, range: s.valDateRange, role: 'Threshold tuning only' },
    { key: 'Test', title: 'Held-out test (final 20%)', text: `${s.testCount.toLocaleString()} txns · ${s.testFrauds} frauds`, range: s.testDateRange, role: 'Reported metrics' },
  ];

  if (!rows) return <div className="cs-card p-6"><EmptyState message="Models are training…" /></div>;

  return (
    <div className="space-y-6 pb-10">
      <section className="cs-card p-5 space-y-4">
        <SectionTitle
          title="Chronological split protocol"
          subtitle={`Rows are sorted by timestamp and cut into contiguous blocks – no shuffling, no look-ahead. ${bundle?.trainRowsUsed.toLocaleString()} labelled train rows used${bundle?.downsampled ? ' (legitimate rows down-sampled and re-weighted)' : ''}; training took ${bundle?.trainingMs} ms in the browser.`}
          right={
            <div className="cs-seg" role="group" aria-label="Evaluation cohort">
              {(['Train', 'Validation', 'Test'] as const).map((c) => (
                <button type="button" key={c} aria-pressed={cohort === c} onClick={() => setCohort(c)}>{c}</button>
              ))}
            </div>
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {splitCards.map((c) => (
            <button
              type="button"
              key={c.key}
              onClick={() => setCohort(c.key)}
              aria-pressed={cohort === c.key}
              className={`text-left p-3.5 rounded-xl border transition-colors ${cohort === c.key ? 'border-[#3988FF] bg-[#3988FF]/10' : 'cs-inset hover:border-[#3988FF]/50'}`}
            >
              <span className="text-xs font-bold cs-accent block">{c.title}</span>
              <span className="text-xs font-mono cs-text block mt-0.5">{c.text}</span>
              <span className="text-xs font-mono cs-subtle block mt-1">{c.range}</span>
              <span className="text-xs cs-muted block mt-1">{c.role}</span>
            </button>
          ))}
        </div>
        {cohort !== 'Test' && (
          <p className="text-xs flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            {cohort === 'Train'
              ? 'Train-split metrics are in-sample and optimistic – shown for diagnosis only. Headline results always use the held-out test split.'
              : 'Validation was used to tune the thresholds, so these metrics are mildly optimistic. Headline results use the held-out test split.'}
          </p>
        )}
      </section>

      <section className="cs-card overflow-hidden">
        <div className="px-5 py-4 border-b cs-divider">
          <SectionTitle
            title={`Model performance – ${cohort} split`}
            subtitle="Each model trained from scratch in the browser on the train split. Threshold τ* = cost-minimising threshold on validation. Unlabelled rows excluded."
            right={<span className="flex gap-1"><ProvenanceBadge kind="measured" /><ProvenanceBadge kind="estimated" label="Est. $ saved" /></span>}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Model metrics on the {cohort} split</caption>
            <thead className="cs-th text-xs uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-3 px-4">Model</th>
                <th scope="col" className="py-3 px-4">Imbalance handling</th>
                <th scope="col" className="py-3 px-4 text-right">PR-AUC</th>
                <th scope="col" className="py-3 px-4 text-right">ROC-AUC</th>
                <th scope="col" className="py-3 px-4 text-right">τ*</th>
                <th scope="col" className="py-3 px-4 text-right">Precision</th>
                <th scope="col" className="py-3 px-4 text-right">Recall</th>
                <th scope="col" className="py-3 px-4 text-right">MCC</th>
                <th scope="col" className="py-3 px-4 text-right">FP / FN</th>
                <th scope="col" className="py-3 px-4 text-right">Est. saved vs no model</th>
                <th scope="col" className="py-3 px-4 text-center">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y cs-divider font-mono">
              {MODEL_NAMES.map((name: ModelName) => {
                const m = rows[name];
                const active = name === activeModelName;
                return (
                  <tr key={name} className={active ? 'bg-[#3988FF]/10' : 'cs-row'}>
                    <td className="py-3 px-4 font-sans">
                      <span className="font-semibold cs-text flex items-center gap-1.5">
                        {m.prAuc === bestPrAuc && <Award className="w-4 h-4 text-amber-500" aria-label="Best PR-AUC" />}
                        {name}
                      </span>
                      <span className="text-xs cs-subtle block max-w-xs">{m.description}</span>
                    </td>
                    <td className="py-3 px-4 font-sans text-xs cs-muted">{m.samplingStrategy}</td>
                    <td className="py-3 px-4 text-right font-bold cs-text tabular-nums">{m.prAuc.toFixed(3)}</td>
                    <td className="py-3 px-4 text-right cs-muted tabular-nums">{m.rocAuc.toFixed(3)}</td>
                    <td className="py-3 px-4 text-right cs-muted tabular-nums">{m.threshold.toFixed(2)}</td>
                    <td className="py-3 px-4 text-right cs-text tabular-nums">{(m.precision * 100).toFixed(1)}%</td>
                    <td className="py-3 px-4 text-right cs-text tabular-nums">{(m.recall * 100).toFixed(1)}%</td>
                    <td className="py-3 px-4 text-right cs-muted tabular-nums">{m.mcc.toFixed(3)}</td>
                    <td className="py-3 px-4 text-right tabular-nums"><span className="text-amber-700 dark:text-amber-400">{m.falsePositives}</span> / <span className="text-red-600 dark:text-red-400">{m.falseNegatives}</span></td>
                    <td className={`py-3 px-4 text-right font-bold tabular-nums ${m.dollarsSaved >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{fmtMoney(m.dollarsSaved, 0)}</td>
                    <td className="py-3 px-4 text-center font-sans">
                      <button
                        type="button"
                        onClick={() => setActiveModelName(name)}
                        aria-label={active ? `${name} is the active model` : `Select ${name} as the active model`}
                        aria-pressed={active}
                        className={`cs-btn !py-1 !px-2.5 ${active ? 'cs-btn-primary' : 'cs-btn-secondary'}`}
                      >
                        {active ? 'Active' : 'Select'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-xs cs-subtle border-t cs-divider">
          Evaluated on {rows[activeModelName].evaluatedCount.toLocaleString()} labelled rows containing {rows[activeModelName].evaluatedFrauds} frauds. With few frauds, metrics have wide uncertainty.
        </p>
      </section>

      <section className="cs-card p-5 space-y-5">
        <SectionTitle
          title="Cost-sensitive decision threshold"
          subtitle="Expected cost = $C_FP per alert reviewed + (amount + penalty) per missed fraud. τ* minimises cost on the validation split; the test curve shows how that choice generalises."
          right={<span className="text-xs cs-muted">Validation-tuned τ* = <strong className="font-mono text-emerald-700 dark:text-emerald-400">{recommendedThreshold.toFixed(2)}</strong> ({activeModelName})</span>}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 cs-inset p-4">
          <label className="block text-xs">
            <span className="flex justify-between mb-1.5 cs-muted">Review cost per alert (C_FP) <strong className="font-mono text-amber-700 dark:text-amber-400">${costFP}</strong></span>
            <input type="range" min="1" max="100" step="1" value={costFP} onChange={(e) => setCostFP(Number(e.target.value))} className="w-full accent-amber-500" />
          </label>
          <label className="block text-xs">
            <span className="flex justify-between mb-1.5 cs-muted">Penalty per missed fraud <strong className="font-mono text-red-600 dark:text-red-400">${costFNPenalty}</strong></span>
            <input type="range" min="0" max="200" step="5" value={costFNPenalty} onChange={(e) => setCostFNPenalty(Number(e.target.value))} className="w-full accent-rose-500" />
          </label>
          <div className="text-xs">
            <label htmlFor="bench-threshold" className="flex justify-between mb-1.5 cs-muted">Deployment threshold τ <strong className="font-mono cs-accent">{decisionThreshold.toFixed(2)}</strong></label>
            <input id="bench-threshold" type="range" min="0.01" max="0.99" step="0.01" value={decisionThreshold} onChange={(e) => setDecisionThreshold(Number(e.target.value))} className="w-full accent-[#3988FF]" />
            <button type="button" onClick={() => setDecisionThreshold(recommendedThreshold)} disabled={Math.abs(decisionThreshold - recommendedThreshold) < 1e-9} className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline disabled:opacity-60 disabled:no-underline disabled:cursor-default">
              Apply validation-tuned τ* ({recommendedThreshold.toFixed(2)})
            </button>
          </div>
        </div>
        {atTau && (
          <div className="cs-inset px-4 py-3 text-xs" aria-live="polite">
            <p className="cs-muted mb-1.5">
              <strong className="cs-text">{activeModelName}</strong> at the current τ = <span className="font-mono cs-text">{decisionThreshold.toFixed(2)}</span> on the {cohort.toLowerCase()} split
              ({atTau.n.toLocaleString()} labelled rows){cohort !== 'Test' && ' – optimistic, see note above'}:
            </p>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 font-mono">
              <div><dt className="cs-subtle inline">Precision </dt><dd className="cs-text inline font-semibold">{(atTau.precision * 100).toFixed(1)}%</dd></div>
              <div><dt className="cs-subtle inline">Recall </dt><dd className="cs-text inline font-semibold">{(atTau.recall * 100).toFixed(1)}%</dd></div>
              <div><dt className="cs-subtle inline">F1 </dt><dd className="cs-text inline font-semibold">{atTau.f1.toFixed(3)}</dd></div>
              <div><dt className="cs-subtle inline">TP / FP / FN </dt><dd className="cs-text inline font-semibold">{atTau.tp} / {atTau.fp} / {atTau.fn}</dd></div>
              <div><dt className="cs-subtle inline">Est. cost </dt><dd className="cs-text inline font-semibold">{fmtMoney(atTau.totalCost, 0)}</dd></div>
            </dl>
          </div>
        )}
        <div className="h-64 w-full" role="img" aria-label="Expected cost versus threshold on validation and test splits">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={curve} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.25} />
              <XAxis dataKey="threshold" type="number" domain={[0, 1]} stroke="#8494AB" fontSize={12} tickLine={false} tickFormatter={(v) => v.toFixed(1)} />
              <YAxis stroke="#8494AB" fontSize={12} tickLine={false} tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
              <Tooltip formatter={(v) => fmtMoney(Number(v), 0)} labelFormatter={(l) => `τ = ${Number(l).toFixed(2)}`} contentStyle={{ background: '#0B1220', border: '1px solid #173B70', borderRadius: 12, fontSize: 12, color: '#F1F5F9' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
              <ReferenceLine x={recommendedThreshold} stroke="#10B981" strokeDasharray="4 4" label={{ value: 'τ*', fill: '#10B981', fontSize: 12, position: 'top', className: 'cs-svg-green' }} />
              <ReferenceLine x={decisionThreshold} stroke="#F59E0B" label={{ value: 'τ', fill: '#F59E0B', fontSize: 12, position: 'insideTopRight', className: 'cs-svg-amber' }} />
              <Line type="monotone" dataKey="validation" name="Validation cost (tuning)" stroke="#3988FF" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="test" name="Test cost (reported)" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs cs-subtle flex items-center gap-1.5"><Sliders className="w-3.5 h-3.5" aria-hidden="true" /> Cost figures are estimates that depend entirely on the assumptions above.</p>
      </section>

      <p className="text-xs cs-subtle flex items-start gap-1.5"><Layers className="w-3.5 h-3.5 mt-0.5" aria-hidden="true" /> “LightGBM” and “XGBoost” here are compact in-browser TypeScript re-implementations of those gradient-boosting algorithm families, not the official libraries.</p>
    </div>
  );
};
