import React, { useMemo, useState } from 'react';
import { useSessionState } from '../state/useSessionState';
import { CheckCircle2, ShieldAlert, ShieldCheck, Undo2, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import { useChrono } from '../state/ChronoContext';
import {
  agreementWithGroundTruth,
  buildReviewQueue,
  canUndo,
  countReviewQueue,
  DECISION_LABEL,
  statusOf,
  type ReviewAction,
  type ReviewError,
  type ReviewStatus,
} from '../utils/reviewQueue';
import { EmptyState, fmtDateTimeUtc, fmtMoney, OutcomeBadge, ProvenanceBadge, SectionTitle } from './ui';

const PAGE = 15;
type View = 'pending' | 'decided' | 'all';

const ERROR_TEXT: Record<ReviewError, string> = {
  unknown_item: 'That alert is no longer in the queue (the threshold or model changed).',
  already_decided: 'That alert already has a decision. Undo it first to change it.',
  nothing_to_undo: 'There is no decision to undo.',
  undo_not_clean: 'The last decision can no longer be undone cleanly.',
};

const STATUS_CLS: Record<ReviewStatus, string> = {
  pending: 'border-dashed border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400',
  reviewed: 'border-violet-300 text-violet-700 dark:border-violet-500/40 dark:text-violet-300',
  confirmed_fraud_sim: 'border-violet-300 text-violet-700 bg-violet-50 dark:bg-violet-500/15 dark:border-violet-500/40 dark:text-violet-300',
  legitimate_sim: 'border-violet-300 text-violet-700 bg-violet-50 dark:bg-violet-500/15 dark:border-violet-500/40 dark:text-violet-300',
};

/** Interactive analyst workbench for the test-split alerts (simulated decisions only). */
export const ReviewWorkbench: React.FC = () => {
  const { splits, decisionThreshold, activeModelName, reviewState, applyReview, undoReview, resetReview } = useChrono();
  const [view, setView] = useSessionState<View>('queue.view', 'pending');
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  // Rows decided while the "Awaiting" view is open stay in place (with disabled buttons) until the
  // view changes. Removing them instantly shifted the next alert under the pointer, so a double-click
  // decided two different alerts.
  const [stickyIds, setStickyIds] = useState<ReadonlySet<string>>(() => new Set());

  const items = useMemo(() => buildReviewQueue(splits.test, decisionThreshold), [splits.test, decisionThreshold]);
  const ids = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const counts = useMemo(() => countReviewQueue(reviewState, ids), [reviewState, ids]);
  const agreement = useMemo(() => agreementWithGroundTruth(reviewState, items), [reviewState, items]);
  const shown = useMemo(
    () => items.filter((i) => (view === 'all' ? true : view === 'pending' ? statusOf(reviewState, i.id) === 'pending' || stickyIds.has(i.id) : statusOf(reviewState, i.id) !== 'pending')),
    [items, view, reviewState, stickyIds]
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const visible = shown.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const labelledInQueue = items.filter((i) => i.groundTruth !== null).length;

  const act = (id: string, action: ReviewAction) => {
    const r = applyReview(id, action, ids);
    if (r.ok) setStickyIds((prev) => new Set(prev).add(id));
    setMessage(r.ok ? `${id}: ${DECISION_LABEL[r.state.decisions[id]]}.` : ERROR_TEXT[r.error]);
  };
  const undo = () => {
    const last = reviewState.history[reviewState.history.length - 1];
    const r = undoReview();
    setMessage(r.ok ? `Undid the decision on ${last?.id}; it is awaiting review again.` : ERROR_TEXT[r.error]);
  };

  return (
    <section className="cs-card p-5 space-y-4" aria-labelledby="workbench-title">
      <SectionTitle
        title="Alerts awaiting review"
        subtitle={`Held-out test-split transactions that ${activeModelName} flags at τ = ${decisionThreshold.toFixed(2)}, ordered by expected loss (score × amount). Flag reasons are the top positive attributions from the model’s SHAP / path-attribution utility.`}
        right={<span className="flex gap-1"><ProvenanceBadge kind="simulated" label="Simulation / demo" /><ProvenanceBadge kind="predicted" /></span>}
      />
      <span id="workbench-title" className="sr-only">Review workbench</span>

      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs" aria-live="polite">
        {[
          ['In queue', counts.total, 'cs-text'],
          ['Awaiting review', counts.pending, 'text-amber-700 dark:text-amber-400'],
          ['Reviewed (sim.)', counts.reviewed, 'text-violet-700 dark:text-violet-300'],
          ['Confirmed fraud (sim.)', counts.confirmedFraudSim, 'text-violet-700 dark:text-violet-300'],
          ['Marked legitimate (sim.)', counts.legitimateSim, 'text-violet-700 dark:text-violet-300'],
        ].map(([k, v, cls]) => (
          <div key={k as string} className="cs-inset p-2.5">
            <dt className="cs-subtle text-xs uppercase tracking-wide">{k}</dt>
            <dd className={`font-mono font-bold text-sm ${cls}`}>{(v as number).toLocaleString()}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="cs-seg" role="group" aria-label="Queue view">
          {(['pending', 'decided', 'all'] as View[]).map((v) => (
            <button type="button" key={v} aria-pressed={view === v} onClick={() => { setView(v); setPage(0); setStickyIds(new Set()); }}>
              {v === 'pending' ? `Awaiting (${counts.pending})` : v === 'decided' ? `Decided (${counts.decided})` : `All (${counts.total})`}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className="cs-btn cs-btn-secondary" onClick={undo} disabled={!canUndo(reviewState)}><Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> Undo last</button>
          <button type="button" className="cs-btn cs-btn-secondary" onClick={() => { resetReview(); setStickyIds(new Set()); setMessage('All simulated decisions cleared.'); }} disabled={reviewState.history.length === 0}><RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reset</button>
        </div>
      </div>
      <p className="text-xs cs-muted min-h-4" role="status" aria-live="polite">{message}</p>

      {items.length === 0 ? (
        <EmptyState message="No test-split transactions are flagged at the current threshold. Lower τ on the Stream or Models page." />
      ) : shown.length === 0 ? (
        <EmptyState message={view === 'pending' ? 'Every alert in the queue has a simulated decision.' : 'No decisions yet.'} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Alerts awaiting review</caption>
              <thead>
                <tr className="text-left">
                  {['Transaction', 'Time (UTC)', 'Amount', 'Risk score', 'Flag reasons', 'Reviewer decision (simulated)', 'Dataset ground truth', 'Actions'].map((h) => (
                    <th key={h} scope="col" className="cs-th px-2 py-2 align-bottom">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((it) => {
                  const s = statusOf(reviewState, it.id);
                  const pending = s === 'pending';
                  return (
                    <tr key={it.id} className="cs-row border-t cs-divider align-top">
                      <td className="px-2 py-2"><span className="font-mono cs-text block">{it.id}</span><span className="cs-subtle">{it.category}</span></td>
                      <td className="px-2 py-2 font-mono cs-muted min-w-[6.5rem]">{fmtDateTimeUtc(it.timestamp)}</td>
                      <td className="px-2 py-2 font-mono cs-text tabular-nums">{fmtMoney(it.amount)}</td>
                      <td className="px-2 py-2 font-mono font-bold text-amber-700 dark:text-amber-400">{(it.score * 100).toFixed(1)}%</td>
                      <td className="px-2 py-2">
                        {it.reasons.length === 0 ? <span className="cs-subtle">No positive attribution</span> : (
                          <ul className="space-y-0.5">
                            {it.reasons.map((r) => (
                              <li key={r.label} className="cs-muted"><span className="cs-text">{r.label}</span> = {String(r.value)} <span className="font-mono text-red-600 dark:text-red-400">+{r.shapValue.toFixed(3)}</span></li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-2 py-2"><span className={`inline-flex rounded-md border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${STATUS_CLS[s]}`}>{DECISION_LABEL[s]}</span></td>
                      <td className="px-2 py-2"><OutcomeBadge label={it.groundTruth} /></td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col gap-1 min-w-[9.5rem]" role="group" aria-label={`Actions for ${it.id}`}>
                          <button type="button" className="cs-btn cs-btn-secondary !py-1 !px-2" disabled={!pending} onClick={() => act(it.id, 'review')} aria-label={`Mark ${it.id} reviewed`}><CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Mark reviewed</button>
                          <button type="button" className="cs-btn cs-btn-secondary !py-1 !px-2" disabled={!pending} onClick={() => act(it.id, 'fraud')} aria-label={`Confirm ${it.id} as fraud (simulated)`}><ShieldAlert className="w-3 h-3" aria-hidden="true" /> Confirm fraud</button>
                          <button type="button" className="cs-btn cs-btn-secondary !py-1 !px-2" disabled={!pending} onClick={() => act(it.id, 'legit')} aria-label={`Mark ${it.id} legitimate (simulated)`}><ShieldCheck className="w-3 h-3" aria-hidden="true" /> Mark legitimate</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs cs-muted">
            <span>Showing {(safePage * PAGE + 1).toLocaleString()}–{Math.min(shown.length, safePage * PAGE + PAGE).toLocaleString()} of {shown.length.toLocaleString()}</span>
            <span className="flex items-center gap-2">
              <button type="button" className="cs-btn cs-btn-secondary !py-1 !px-2" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0} aria-label="Previous page"><ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" /></button>
              <span className="font-mono">{safePage + 1} / {pages}</span>
              <button type="button" className="cs-btn cs-btn-secondary !py-1 !px-2" onClick={() => setPage(Math.min(pages - 1, safePage + 1))} disabled={safePage >= pages - 1} aria-label="Next page"><ChevronRight className="w-3.5 h-3.5" aria-hidden="true" /></button>
            </span>
          </div>
        </>
      )}

      <p className="text-xs cs-subtle leading-relaxed">
        Reviewer decisions are simulated UI state: they are never written to the dataset label, never used for training, threshold tuning or metrics, and are cleared when a new dataset loads.
        Ground truth (shown separately) comes from the dataset; {labelledInQueue} of {items.length} queued alerts have one.
        {agreement.compared > 0 && ` Of ${agreement.compared} simulated fraud/legitimate verdicts on labelled alerts, ${agreement.agree} agree with ground truth and ${agreement.disagree} disagree.`}
      </p>
    </section>
  );
};
