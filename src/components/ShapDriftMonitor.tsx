import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionState } from '../state/useSessionState';
import { TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useChrono } from '../state/ChronoContext';
import { useDriftAnalysis } from '../state/useDrift';
import type { DriftPopulation } from '../utils/driftWindows';
import { groupLabel } from '../utils/featureSpace';
import { ProvenanceBadge, SectionTitle, EmptyState } from './ui';

export const ShapDriftMonitor: React.FC = () => {
  const { activeModelName, bundle } = useChrono();
  const [population, setPopulation] = useSessionState<DriftPopulation>('drift.population', 'Confirmed Frauds');
  const [confidence, setConfidence] = useSessionState<0.95 | 0.99>('drift.confidence', 0.95);
  const drift = useDriftAnalysis(population, confidence);
  // The trajectory SVG is laid out in real pixels (viewBox = rendered size). It used a fixed 720×200
  // viewBox with preserveAspectRatio="none", which stretched the labels and shrank them below 12 px on phones.
  const plotRef = useRef<HTMLDivElement>(null);
  const [plot, setPlot] = useState({ w: 720, h: 200 });
  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setPlot({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [drift]);
  const [feature, setFeature] = useSessionState<string>('drift.feature', '');

  useEffect(() => {
    if (drift && (!feature || !drift.groups.includes(feature))) {
      // default to the feature group with the largest baseline importance
      const top = [...drift.groups].sort((a, b) => drift.baseline[b].mean - drift.baseline[a].mean)[0];
      setFeature(top ?? '');
    }
  }, [drift, feature]);

  const windows = drift?.windows ?? [];
  const stats = windows.map((w) => w.featureMeans[feature]).filter(Boolean);

  const callouts = useMemo(() => {
    if (!drift || !feature) return null;
    const post = windows.filter((w) => !w.isReference && w.featureMeans[feature] && w.sampleSize >= 5);
    const suppressed = post
      .filter((w) => !w.featureMeans[feature].hasDrifted)
      .sort((a, b) => Math.abs(b.featureMeans[feature].meanShap - b.featureMeans[feature].baselineMean) - Math.abs(a.featureMeans[feature].meanShap - a.featureMeans[feature].baselineMean))[0];
    const drifted = post.filter((w) => w.featureMeans[feature].hasDrifted).sort((a, b) => Math.abs(b.featureMeans[feature].zScore) - Math.abs(a.featureMeans[feature].zScore))[0];
    return { suppressed, drifted };
  }, [drift, feature, windows]);

  if (!bundle || !drift) return <div className="cs-card p-6"><EmptyState message="Models are training…" /></div>;

  const lowers = stats.map((s) => s.ciLower);
  const uppers = stats.map((s) => s.ciUpper);
  const base = drift.baseline[feature]?.mean ?? 0;
  const minVal = Math.max(0, Math.min(base, ...lowers) * 0.9);
  const maxVal = Math.max(base, ...uppers) * 1.1 || 1;
  const range = maxVal - minVal || 1;
  const n = windows.length;
  const W = plot.w;
  const H = plot.h;
  const left = 50;
  const right = W - 20;
  const top = H * 0.17;
  const bottom = H - 30;
  const xAt = (i: number) => left + (n > 1 ? (i / (n - 1)) * (right - left) : (right - left) / 2);
  const yAt = (v: number) => bottom - ((v - minVal) / range) * (bottom - top);
  // Show every k-th window label so 12 px labels never overlap.
  const labelEvery = Math.max(1, Math.ceil((n * 34) / Math.max(1, right - left)));
  const zLabel = confidence === 0.99 ? '99% CI (Z = 2.58)' : '95% CI (Z = 1.96)';

  return (
    <div className="space-y-6 pb-10">
      <section className="cs-card p-5 space-y-4">
        <SectionTitle
          title="Confidence-bounded explanation drift"
          subtitle={`Statistic: mean |attribution| of each feature group (${activeModelName}) per time window. Baseline = the training period. A window is flagged only when a two-sided Z-test against the baseline exceeds the chosen confidence level; windows with < 5 rows are never flagged.`}
          right={<span className="flex gap-1"><ProvenanceBadge kind="measured" />{population === 'Confirmed Frauds' && <ProvenanceBadge kind="confirmed" />}</span>}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 text-xs">
          <label className="block">
            <span className="cs-muted block mb-1.5 font-medium">Feature group</span>
            <select aria-label="Feature group" value={feature} onChange={(e) => setFeature(e.target.value)} className="cs-input w-full">
              {drift.groups.map((g) => <option key={g} value={g}>{groupLabel(g)}</option>)}
            </select>
          </label>
          <div>
            <span className="cs-muted block mb-1.5 font-medium" id="pop-label">Population</span>
            <div className="cs-seg w-full" role="group" aria-labelledby="pop-label">
              <button type="button" className="flex-1" aria-pressed={population === 'Full Stream'} onClick={() => setPopulation('Full Stream')}>All transactions</button>
              <button type="button" className="flex-1" aria-pressed={population === 'Confirmed Frauds'} onClick={() => setPopulation('Confirmed Frauds')}>Confirmed frauds</button>
            </div>
          </div>
          <div>
            <span className="cs-muted block mb-1.5 font-medium" id="ci-label">Confidence level</span>
            <div className="cs-seg w-full" role="group" aria-labelledby="ci-label">
              <button type="button" className="flex-1" aria-pressed={confidence === 0.95} onClick={() => setConfidence(0.95)}>95% (Z = 1.96)</button>
              <button type="button" className="flex-1" aria-pressed={confidence === 0.99} onClick={() => setConfidence(0.99)}>99% (Z = 2.58)</button>
            </div>
          </div>
        </div>
        <p className="text-xs cs-subtle">
          {drift.granularity === 'month' ? 'Calendar-month windows.' : `12 equal-length time windows (dataset spans < 300 days).`} Stability: {drift.stabilityPct ?? '—'}% of {drift.testsRun} post-training window×feature tests within expected variation.
        </p>
      </section>

      <section className="cs-card p-5 space-y-4">
        <SectionTitle
          title={`Trajectory – ${groupLabel(feature)}`}
          subtitle={`Points: window mean |attribution|; bars: ${zLabel}; dashed line: training-period baseline. Reference windows (training period) are grey.`}
          right={
            <span className="flex flex-wrap items-center gap-3 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Within variation</span>
              <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400"><span className="w-2.5 h-2.5 rounded-full bg-[#E5484D] inline-block" /> Drift</span>
              <span className="flex items-center gap-1.5 cs-subtle"><span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" /> Reference</span>
            </span>
          }
        />
        <div className="h-64 w-full cs-inset p-3" role="img" aria-label={`Drift trajectory for ${groupLabel(feature)}`}>
          <div ref={plotRef} className="w-full h-full">
          <svg className="w-full h-full block" viewBox={`0 0 ${W} ${H}`}>
            {[0, 1, 2, 3].map((k) => { const y = top + ((bottom - top) * k) / 3; return <line key={k} x1={left - 10} y1={y} x2={right} y2={y} stroke="#94A3B8" strokeOpacity="0.25" strokeDasharray="3 3" />; })}
            <line x1={left - 10} y1={yAt(base)} x2={right} y2={yAt(base)} stroke="#3988FF" strokeWidth="1.5" strokeDasharray="4 4" />
            <text x="45" y={yAt(base) - 6} fill="#3988FF" className="cs-svg-blue" fontSize="12" fontFamily="monospace">Baseline {base.toFixed(3)}</text>
            {n > 1 && (
              <polyline fill="none" stroke="#3988FF" strokeWidth="2" points={windows.map((w, i) => `${xAt(i)},${yAt(w.featureMeans[feature]?.meanShap ?? 0)}`).join(' ')} />
            )}
            {windows.map((w, i) => {
              const st = w.featureMeans[feature];
              if (!st) return null;
              const color = w.isReference ? '#94A3B8' : st.hasDrifted ? '#E5484D' : '#10B981';
              return (
                <g key={w.windowId}>
                  <line x1={xAt(i)} y1={yAt(st.ciUpper)} x2={xAt(i)} y2={yAt(st.ciLower)} stroke={color} strokeWidth="1.5" />
                  <circle cx={xAt(i)} cy={yAt(st.meanShap)} r={st.hasDrifted ? 5.5 : 4} fill={color} />
                  {i % labelEvery === 0 && <text x={xAt(i)} y={H - 8} fill="#8494AB" className="cs-svg-subtle" fontSize="12" textAnchor="middle" fontFamily="monospace">{w.windowId}</text>}
                </g>
              );
            })}
          </svg>
          </div>
        </div>
        {callouts && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/25">
              <p className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300 mb-1"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Largest shift that stayed within variation</p>
              {callouts.suppressed ? (
                <p className="cs-muted leading-relaxed">
                  {callouts.suppressed.windowId} ({callouts.suppressed.startDate} – {callouts.suppressed.endDate}, n = {callouts.suppressed.sampleSize}): mean {callouts.suppressed.featureMeans[feature].meanShap.toFixed(3)} vs baseline {base.toFixed(3)}, CI [{callouts.suppressed.featureMeans[feature].ciLower.toFixed(3)}, {callouts.suppressed.featureMeans[feature].ciUpper.toFixed(3)}], Z = {callouts.suppressed.featureMeans[feature].zScore.toFixed(2)}. A point-estimate monitor might alarm here; the confidence bound does not.
                </p>
              ) : <p className="cs-muted">No post-training window is within expected variation for this feature.</p>}
            </div>
            <div className="p-3.5 rounded-xl border border-red-200 bg-red-50 dark:bg-[#E5484D]/10 dark:border-[#E5484D]/25">
              <p className="flex items-center gap-2 font-bold text-red-700 dark:text-red-300 mb-1"><AlertTriangle className="w-4 h-4" aria-hidden="true" /> Strongest confirmed drift</p>
              {callouts.drifted ? (
                <p className="cs-muted leading-relaxed">
                  {callouts.drifted.windowId} ({callouts.drifted.startDate} – {callouts.drifted.endDate}, n = {callouts.drifted.sampleSize}): mean {callouts.drifted.featureMeans[feature].meanShap.toFixed(3)} vs baseline {base.toFixed(3)}, Z = {callouts.drifted.featureMeans[feature].zScore.toFixed(2)}, p = {callouts.drifted.featureMeans[feature].pValue < 0.0001 ? '< 0.0001' : callouts.drifted.featureMeans[feature].pValue.toFixed(4)}.
                </p>
              ) : <p className="cs-muted">No window exceeds expected sampling variation for this feature at {Math.round(confidence * 100)}% confidence.</p>}
            </div>
          </div>
        )}
      </section>

      <section className="cs-card overflow-hidden">
        <div className="px-5 py-4 border-b cs-divider">
          <SectionTitle title="Window-level significance table" subtitle={`Feature: ${groupLabel(feature)} · population: ${population === 'Full Stream' ? 'all transactions' : 'confirmed frauds'}`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Drift statistics per time window</caption>
            <thead className="cs-th text-xs uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-3 px-4">Window</th>
                <th scope="col" className="py-3 px-4 text-right">n (frauds / total)</th>
                <th scope="col" className="py-3 px-4 text-right">Mean |attr.|</th>
                <th scope="col" className="py-3 px-4 text-center">{zLabel}</th>
                <th scope="col" className="py-3 px-4 text-right">Δ baseline</th>
                <th scope="col" className="py-3 px-4 text-right">p-value</th>
                <th scope="col" className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y cs-divider font-mono">
              {windows.map((w) => {
                const st = w.featureMeans[feature];
                if (!st) return null;
                const delta = st.meanShap - st.baselineMean;
                return (
                  <tr key={w.windowId} className="cs-row">
                    <td className="py-2.5 px-4 font-sans">
                      <span className="font-semibold cs-text block">{w.windowLabel}</span>
                      <span className="text-xs cs-subtle font-mono">{w.startDate} – {w.endDate}</span>
                    </td>
                    <td className="py-2.5 px-4 text-right cs-muted tabular-nums">{w.sampleSize} ({w.confirmedFrauds} / {w.totalTransactions.toLocaleString()})</td>
                    <td className="py-2.5 px-4 text-right font-bold cs-text tabular-nums">{st.meanShap.toFixed(3)}</td>
                    <td className="py-2.5 px-4 text-center cs-muted tabular-nums">[{st.ciLower.toFixed(3)}, {st.ciUpper.toFixed(3)}]</td>
                    <td className="py-2.5 px-4 text-right cs-muted tabular-nums">{delta >= 0 ? '+' : ''}{delta.toFixed(3)}</td>
                    <td className="py-2.5 px-4 text-right cs-muted tabular-nums">{w.isReference ? '—' : st.pValue < 0.0001 ? '< 0.0001' : st.pValue.toFixed(4)}</td>
                    <td className="py-2.5 px-4 text-center font-sans">
                      {w.isReference ? (
                        <span className="text-xs cs-subtle">Reference</span>
                      ) : w.sampleSize < 5 ? (
                        <span className="text-xs cs-subtle">Too few rows</span>
                      ) : st.hasDrifted ? (
                        <span className="text-xs font-semibold text-red-600 dark:text-red-400">Drift</span>
                      ) : (
                        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Within variation</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs cs-subtle flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" aria-hidden="true" /> Many windows × features are tested; with no multiple-comparison correction some flags are expected by chance.</p>
    </div>
  );
};
