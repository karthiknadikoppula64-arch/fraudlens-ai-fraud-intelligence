import React, { useEffect, useMemo, useState } from 'react';
import { Info, ChevronLeft, ChevronRight } from 'lucide-react';
import { filterDelayedRows, type DelayedPeriodSelection, type DelayedRowFilter } from '../utils/delayedLabels';
import { EmptyState, fmtDateTimeUtc, fmtMoney, ProvenanceBadge } from './ui';

const PAGE = 25;

const FILTERS: { id: DelayedRowFilter; label: (s: DelayedPeriodSelection) => string }[] = [
  { id: 'all', label: (s) => `All (${s.counts.total})` },
  { id: 'available', label: (s) => `Label available (${s.counts.available})` },
  { id: 'pending', label: (s) => `Still pending (${s.counts.pending})` },
  { id: 'newly', label: (s) => `Newly matured (${s.counts.newlyMatured})` },
];

/** Detail panel + transaction table for one selected delayed-label horizon (one chart bar). */
export const DelayedPeriodDetail: React.FC<{ selection: DelayedPeriodSelection; threshold: number; modelName: string }> = ({ selection, threshold, modelName }) => {
  const [filter, setFilter] = useState<DelayedRowFilter>('all');
  const [page, setPage] = useState(0);
  const rows = useMemo(() => filterDelayedRows(selection.rows, filter), [selection.rows, filter]);
  useEffect(() => setPage(0), [selection.horizon, filter]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const visible = rows.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const { counts, metrics: m, horizon: H, previousHorizon: prev } = selection;

  if (counts.total === 0) {
    return (
      <section className="cs-inset p-4" aria-live="polite" aria-label={`Day ${H} horizon details`}>
        <EmptyState message={`No labelled held-out test transactions are available for the Day ${H} horizon on this dataset.`} />
      </section>
    );
  }

  return (
    <section className="cs-inset p-4 space-y-4" aria-live="polite" aria-labelledby="delayed-detail-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="delayed-detail-title" className="text-sm font-bold cs-text">Day {H} horizon · transactions behind this bar</h3>
          <p className="text-xs cs-muted mt-0.5">
            Cohort: labelled held-out test transactions from{' '}
            <strong className="font-mono cs-text">{selection.dateRange ? fmtDateTimeUtc(selection.dateRange.start) : '–'}</strong> to{' '}
            <strong className="font-mono cs-text">{selection.dateRange ? fmtDateTimeUtc(selection.dateRange.end) : '–'}</strong>. Scores: {modelName} at τ = {threshold.toFixed(2)}.
          </p>
        </div>
        <span className="flex gap-1"><ProvenanceBadge kind="simulated" label="Simulated lag" /><ProvenanceBadge kind="predicted" /></span>
      </div>

      <p className="text-xs cs-muted flex items-start gap-1.5 leading-relaxed">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#3988FF]" aria-hidden="true" />
        <span>
          Horizons are <strong className="cs-text">cumulative</strong>, not separate time windows: every bar uses the same {counts.total.toLocaleString()} transactions. Day {H} means
          “{H} days after each transaction’s own timestamp”; a label is available when its simulated dispute lag is ≤ {H} days. The label-available set at Day {H} contains every row available at
          earlier horizons{prev !== null ? `; ${counts.newlyMatured.toLocaleString()} labels matured between Day ${prev} and Day ${H}` : ''}.
          {selection.excludedUnlabelled > 0 && ` ${selection.excludedUnlabelled.toLocaleString()} test rows with a blank label in the dataset are excluded (their label never arrives).`}
        </span>
      </p>

      <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-xs">
        {[
          ['Transactions', counts.total, 'cs-text'],
          ['Label available', counts.available, 'cs-text'],
          ['Confirmed fraud', counts.availableFraud, 'text-red-600 dark:text-red-400'],
          ['Confirmed legit', counts.availableLegit, 'text-emerald-700 dark:text-emerald-400'],
          ['Still pending', counts.pending, 'text-amber-700 dark:text-amber-400'],
          ['Newly matured', counts.newlyMatured, 'cs-accent'],
          ['Flagged at τ', counts.flagged, 'cs-text'],
          ['Pending frauds', counts.pendingFraud, 'text-amber-700 dark:text-amber-400'],
        ].map(([k, v, cls]) => (
          <div key={k as string} className="cs-card p-2.5">
            <dt className="cs-subtle text-xs uppercase tracking-wide">{k}</dt>
            <dd className={`font-mono font-bold text-sm ${cls}`}>{(v as number).toLocaleString()}</dd>
          </div>
        ))}
      </dl>

      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs font-mono">
        <div><dt className="cs-subtle">Apparent PR-AUC</dt><dd className="cs-accent font-bold">{m.apparentPrAuc.toFixed(3)}</dd></div>
        <div><dt className="cs-subtle">Apparent precision</dt><dd className="cs-text">{(m.apparentPrecision * 100).toFixed(1)}%</dd></div>
        <div><dt className="cs-subtle">Apparent recall</dt><dd className="cs-text">{(m.apparentRecall * 100).toFixed(1)}%</dd></div>
        <div><dt className="cs-subtle">Apparent TP / FP / FN</dt><dd className="cs-text">{m.apparentTp} / {m.apparentFp} / {m.apparentFn}</dd></div>
      </dl>
      <p className="text-xs cs-subtle">“Apparent” metrics treat still-pending labels as legitimate (the naive practice the protocol exposes). {counts.pendingFraud > 0 ? `${counts.pendingFraud} true fraud(s) still look legitimate at Day ${H}.` : `No fraud labels are still pending at Day ${H}.`}</p>

      <div className="cs-seg flex-wrap" role="group" aria-label="Filter transactions by label status">
        {FILTERS.map((f) => (
          <button type="button" key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label(selection)}</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState message="No transactions match this filter for the selected horizon." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Transactions for the Day {H} horizon ({filter})</caption>
              <thead>
                <tr className="text-left">
                  {['Transaction ID', 'Timestamp (UTC)', 'Amount', 'Category', 'Score', 'Predicted', 'Lag (sim.)', `Label status at Day ${H}`].map((h) => (
                    <th key={h} scope="col" className="cs-th px-2 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="cs-row border-t cs-divider">
                    <td className="px-2 py-1.5 font-mono cs-text">{r.id}</td>
                    <td className="px-2 py-1.5 font-mono cs-muted whitespace-nowrap">{fmtDateTimeUtc(r.timestamp)}</td>
                    <td className="px-2 py-1.5 font-mono cs-text tabular-nums">{fmtMoney(r.amount)}</td>
                    <td className="px-2 py-1.5 cs-muted">{r.category}</td>
                    <td className="px-2 py-1.5 font-mono tabular-nums cs-text">{(r.score * 100).toFixed(1)}%</td>
                    <td className={`px-2 py-1.5 font-semibold ${r.predicted === 'Suspicious' ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{r.predicted}</td>
                    <td className="px-2 py-1.5 font-mono cs-muted">{r.lagDays} d</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {r.labelStatus === 'available' ? (
                        <span className={r.label === 1 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-emerald-700 dark:text-emerald-400 font-semibold'}>
                          Available · {r.label === 1 ? 'Fraud' : 'Legitimate'}{r.newlyMatured && prev !== null ? ' (new)' : ''}
                        </span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400 font-semibold">Pending (arrives day {r.lagDays})</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs cs-muted">
            <span>Showing {(safePage * PAGE + 1).toLocaleString()}–{Math.min(rows.length, safePage * PAGE + PAGE).toLocaleString()} of {rows.length.toLocaleString()} transactions</span>
            <span className="flex items-center gap-2">
              <button type="button" className="cs-btn cs-btn-secondary !py-1 !px-2" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0} aria-label="Previous page"><ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" /></button>
              <span className="font-mono">{safePage + 1} / {pages}</span>
              <button type="button" className="cs-btn cs-btn-secondary !py-1 !px-2" onClick={() => setPage(Math.min(pages - 1, safePage + 1))} disabled={safePage >= pages - 1} aria-label="Next page"><ChevronRight className="w-3.5 h-3.5" aria-hidden="true" /></button>
            </span>
          </div>
        </>
      )}
    </section>
  );
};
