import React, { useRef } from 'react';
import { X, Eye, ShieldCheck } from 'lucide-react';
import type { Transaction } from '../types/fraud';
import { useDialog } from '../state/useDialog';
import { OutcomeBadge, PredictionBadge, OriginBadge, RiskMeter, categoryIcon, fmtMoney, fmtDateTimeUtc } from './ui';

interface Props {
  transaction: Transaction;
  decisionThreshold: number;
  onClose: () => void;
  onExplain: (tx: Transaction) => void;
}

/** Slide-over detail panel for one transaction. */
export const TransactionDetailDrawer: React.FC<Props> = ({ transaction: t, decisionThreshold, onClose, onExplain }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialog(true, panelRef, closeRef, onClose);
  const Icon = categoryIcon(t.category);
  const features = Object.entries(t.features);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="relative w-full max-w-md h-full overflow-y-auto bg-white dark:bg-[#0B1220] border-l cs-divider shadow-2xl p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider cs-accent font-bold">Transaction detail</p>
            <h2 id="drawer-title" className="text-lg font-bold cs-text font-mono">{t.id}</h2>
            <p className="text-xs cs-subtle font-mono">{fmtDateTimeUtc(t.timestamp)}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="p-1.5 rounded-lg cs-muted hover:bg-slate-100 dark:hover:bg-[#173B70]/40" aria-label="Close details">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <OriginBadge origin={t.origin} />
          {t.split && <span className="text-xs font-mono uppercase px-1.5 py-0.5 rounded border cs-divider cs-muted">{t.split} split</span>}
        </div>

        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div className="cs-inset p-3">
            <dt className="text-xs uppercase font-mono cs-subtle">Amount</dt>
            <dd className="text-lg font-bold font-mono cs-text">{fmtMoney(t.amount)} <span className="text-xs cs-subtle">USD</span></dd>
          </div>
          <div className="cs-inset p-3">
            <dt className="text-xs uppercase font-mono cs-subtle">Merchant category</dt>
            <dd className="text-sm font-semibold cs-text inline-flex items-center gap-1.5 mt-1"><Icon className="w-4 h-4 cs-subtle" aria-hidden="true" />{t.category}</dd>
            {t.merchant !== t.category && <dd className="text-xs cs-subtle">{t.merchant}</dd>}
          </div>
          <div className="cs-inset p-3">
            <dt className="text-xs uppercase font-mono cs-subtle">Fraud probability</dt>
            <dd className="mt-1"><RiskMeter probability={t.predictedProbability} threshold={decisionThreshold} /></dd>
            <dd className="mt-1.5"><PredictionBadge probability={t.predictedProbability} threshold={decisionThreshold} /></dd>
          </div>
          <div className="cs-inset p-3">
            <dt className="text-xs uppercase font-mono cs-subtle">Actual outcome</dt>
            <dd className="mt-1"><OutcomeBadge label={t.groundTruthLabel} /></dd>
            <dd className="text-xs cs-subtle mt-1">Analyst status: {t.status}</dd>
          </div>
        </dl>

        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider cs-muted font-mono mb-2">Model input features (label-free)</h3>
          {features.length === 0 ? (
            <p className="text-xs cs-subtle">This dataset has no optional numeric feature columns; the model uses amount, hour of day and merchant category.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-2 text-xs font-mono">
              {features.map(([k, v]) => (
                <div key={k} className="cs-inset px-3 py-2">
                  <dt className="text-xs cs-subtle truncate">{k}</dt>
                  <dd className="cs-text font-semibold">{Number.isFinite(v) ? v : 'missing'}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <p className="text-xs cs-subtle flex items-start gap-1.5 leading-relaxed">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          No card numbers, CVVs, names, emails, phones or addresses are stored or shown. Columns that looked like such data were dropped at upload.
        </p>

        <button type="button" onClick={() => onExplain(t)} className="cs-btn cs-btn-primary w-full justify-center">
          <Eye className="w-4 h-4" aria-hidden="true" /> Explain (SHAP attribution)
        </button>
      </div>
    </div>
  );
};
