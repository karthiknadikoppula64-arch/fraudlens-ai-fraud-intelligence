import React, { useMemo, useState } from 'react';
import { useSessionState } from '../state/useSessionState';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { Sparkles, ArrowUpRight, ArrowDownRight, Info, Search } from 'lucide-react';
import type { Transaction } from '../types/fraud';
import { useChrono } from '../state/ChronoContext';
import { sigmoid } from '../utils/models';
import { toFeatureInput } from '../utils/pipeline';
import { groupLabel } from '../utils/featureSpace';
import { OutcomeBadge, PredictionBadge, ProvenanceBadge, SectionTitle, EmptyState, fmtMoney, fmtDateTimeUtc } from './ui';

interface ShapExplainerViewProps {
  onSelectTransaction: (tx: Transaction) => void;
}

export const ShapExplainerView: React.FC<ShapExplainerViewProps> = ({ onSelectTransaction }) => {
  const { transactions, splits, bundle, activeModelName, decisionThreshold } = useChrono();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useSessionState<string | null>('shap.selectedId', null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  const outputUnit = bundle?.models[activeModelName].outputSpace === 'probability' ? 'probability points' : 'log-odds';

  // Global importance: mean |attribution| over the held-out test split
  const global = useMemo(() => {
    const totals = new Map<string, { sum: number; n: number }>();
    for (const t of splits.test) {
      for (const item of t.shapBreakdown) {
        const cur = totals.get(item.feature) ?? { sum: 0, n: 0 };
        cur.sum += Math.abs(item.shapValue);
        cur.n++;
        totals.set(item.feature, cur);
      }
    }
    return [...totals.entries()]
      .map(([feature, v]) => ({ feature, label: groupLabel(feature), meanAbs: Math.round((v.sum / Math.max(1, v.n)) * 1000) / 1000 }))
      .sort((a, b) => b.meanAbs - a.meanAbs);
  }, [splits.test]);

  // Sample cases: highest-risk test rows, a confirmed fraud and a low-risk row
  const samples = useMemo(() => {
    const test = [...splits.test];
    const byRisk = [...test].sort((a, b) => b.predictedProbability - a.predictedProbability);
    const picks: Transaction[] = [];
    const add = (t?: Transaction) => t && !picks.some((p) => p.id === t.id) && picks.push(t);
    add(byRisk[0]);
    add(byRisk[1]);
    add(test.find((t) => t.groundTruthLabel === 1 && t.predictedProbability < decisionThreshold)); // a missed fraud
    add(test.find((t) => t.groundTruthLabel === 1));
    add(byRisk[byRisk.length - 1]);
    return picks;
  }, [splits.test, decisionThreshold]);

  // Falls back to the first sample case when the remembered id is not in the active dataset
  // (e.g. after loading a different CSV), instead of showing nothing.
  const active = useMemo(() => {
    const hit = selectedId ? transactions.find((t) => t.id === selectedId) : undefined;
    return hit ?? (samples[0] ? transactions.find((t) => t.id === samples[0].id) ?? null : null);
  }, [selectedId, samples, transactions]);

  const baseInfo = useMemo(() => {
    if (!bundle || !active) return null;
    const m = bundle.models[activeModelName];
    const { base } = m.explain(bundle.featureSpace.transform(toFeatureInput(active)));
    return { base, baseProb: m.outputSpace === 'logit' ? sigmoid(base) : base };
  }, [bundle, active, activeModelName]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    // An empty query used to match the first row of the dataset; a miss used to do nothing silently.
    if (!q) {
      setSearchMessage('Enter a transaction ID (or part of one).');
      return;
    }
    const hit = transactions.find((t) => t.id.toLowerCase() === q) ?? transactions.find((t) => t.id.toLowerCase().includes(q));
    if (hit) {
      setSelectedId(hit.id);
      setSearchMessage(`Showing ${hit.id}.`);
    } else {
      setSearchMessage(`No transaction in the active dataset matches “${query.trim()}”.`);
    }
  };

  if (!bundle) return <div className="cs-card p-6"><EmptyState message="Models are training…" /></div>;
  const maxAbs = Math.max(0.001, ...(active?.shapBreakdown.map((s) => Math.abs(s.shapValue)) ?? [0]));

  return (
    <div className="space-y-6 pb-10">
      <section className="cs-card p-5 space-y-3">
        <SectionTitle
          title={`Additive attributions – ${activeModelName}`}
          subtitle={
            bundle.models[activeModelName].outputSpace === 'logit' && activeModelName === 'Logistic Regression'
              ? 'Exact linear SHAP values (w·(x − mean)) in log-odds space, assuming feature independence.'
              : 'Path-based (Saabas) tree attributions – a fast approximation of TreeSHAP – summed across trees. One-hot category columns and hour sin/cos are grouped.'
          }
          right={<ProvenanceBadge kind="predicted" label="Model explanation" />}
        />
        <p className="text-xs flex items-start gap-2 text-amber-800 dark:text-amber-300">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          Attributions describe how the trained model uses its inputs; they do not prove that a feature caused fraud, and they do not establish fairness.
        </p>
      </section>

      <section className="cs-card p-5 space-y-3">
        <SectionTitle title="Global feature importance" subtitle={`Mean |attribution| (${outputUnit}) over ${splits.test.length.toLocaleString()} held-out test transactions.`} />
        <div className="h-72 w-full" role="img" aria-label="Global feature importance bar chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={global} layout="vertical" margin={{ top: 8, right: 24, left: 16, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.25} horizontal={false} />
              <XAxis type="number" stroke="#8494AB" fontSize={12} tickLine={false} tickFormatter={(v) => Number(v).toFixed(2)} />
              <YAxis type="category" dataKey="label" stroke="#8494AB" fontSize={12} tickLine={false} width={160} />
              <Tooltip formatter={(v) => [Number(v).toFixed(3), `Mean |attribution| (${outputUnit})`]} contentStyle={{ background: '#0B1220', border: '1px solid #173B70', borderRadius: 12, fontSize: 12, color: '#F1F5F9' }} />
              <Bar dataKey="meanAbs" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {global.map((g, i) => <Cell key={g.feature} fill={i < 3 ? '#3988FF' : i < 6 ? '#6AA8FF' : '#9CC3FF'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="cs-card p-5 space-y-4">
        <SectionTitle
          title="Local transaction attribution"
          subtitle="Pick a sample case or search any transaction ID."
          right={
            <form onSubmit={onSearch} className="flex items-center gap-2" role="search">
              <label htmlFor="shap-search" className="sr-only">Transaction ID</label>
              <input id="shap-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Transaction ID…" className="cs-input w-44" />
              <button type="submit" className="cs-btn cs-btn-secondary"><Search className="w-3.5 h-3.5" aria-hidden="true" /> Find</button>
            </form>
          }
        />
        <p className="text-xs cs-muted min-h-4" role="status" aria-live="polite">{searchMessage}</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sample cases">
          {samples.map((t) => (
            <button
              type="button"
              key={t.id}
              aria-pressed={active?.id === t.id}
              onClick={() => { setSelectedId(t.id); setSearchMessage(null); }}
              className={`cs-btn !py-1 !px-2.5 font-mono ${active?.id === t.id ? 'cs-btn-primary' : 'cs-btn-secondary'}`}
            >
              {t.id} · {(t.predictedProbability * 100).toFixed(0)}%
            </button>
          ))}
        </div>

        {active && baseInfo && (
          <>
            <div className="cs-inset p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-xs uppercase font-mono cs-subtle block">Transaction</span>
                <span className="font-mono font-bold cs-text block">{active.id}</span>
                <span className="font-mono text-xs cs-subtle">{fmtDateTimeUtc(active.timestamp)}</span>
              </div>
              <div>
                <span className="text-xs uppercase font-mono cs-subtle block">Amount · category</span>
                <span className="font-mono font-bold cs-text block">{fmtMoney(active.amount)}</span>
                <span className="text-xs cs-subtle">{active.category}</span>
              </div>
              <div>
                <span className="text-xs uppercase font-mono cs-subtle block">Prediction</span>
                <span className="font-mono font-bold cs-text block">{(baseInfo.baseProb * 100).toFixed(1)}% → {(active.predictedProbability * 100).toFixed(1)}%</span>
                <PredictionBadge probability={active.predictedProbability} threshold={decisionThreshold} />
              </div>
              <div>
                <span className="text-xs uppercase font-mono cs-subtle block">Actual outcome</span>
                <span className="block mt-1"><OutcomeBadge label={active.groundTruthLabel} /></span>
              </div>
            </div>
            <p className="text-xs cs-subtle font-mono">
              Base value {baseInfo.base.toFixed(3)} ({outputUnit}) + Σ attributions {active.shapBreakdown.reduce((s, x) => s + x.shapValue, 0).toFixed(3)} = model output.
            </p>
            <ul className="space-y-2">
              {active.shapBreakdown.map((item) => {
                const pos = item.shapValue > 0;
                return (
                  <li key={item.feature} className="cs-inset p-3">
                    <div className="flex items-center justify-between text-xs mb-1.5 gap-3">
                      <span className="flex items-center gap-2 font-semibold cs-text">
                        {pos ? <ArrowUpRight className="w-4 h-4 text-red-500" aria-hidden="true" /> : <ArrowDownRight className="w-4 h-4 text-emerald-500" aria-hidden="true" />}
                        {item.label}
                      </span>
                      <span className="flex items-center gap-3 font-mono">
                        <span className="cs-subtle text-xs">{item.value}</span>
                        <span className={`font-bold tabular-nums ${pos ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{pos ? '+' : ''}{item.shapValue.toFixed(3)}</span>
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700/60 overflow-hidden" aria-hidden="true">
                      <div className={`h-full rounded-full ${pos ? 'bg-[#E5484D]' : 'bg-emerald-500'}`} style={{ width: `${(Math.abs(item.shapValue) / maxAbs) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <button type="button" className="cs-btn cs-btn-secondary" onClick={() => onSelectTransaction(active)}>
              <Sparkles className="w-3.5 h-3.5 text-[#3988FF]" aria-hidden="true" /> Open in investigation modal
            </button>
          </>
        )}
      </section>
    </div>
  );
};
