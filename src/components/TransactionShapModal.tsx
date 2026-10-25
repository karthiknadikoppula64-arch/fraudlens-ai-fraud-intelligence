import React, { useRef } from 'react';
import { X, AlertTriangle, CheckCircle, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { ModelName, Transaction } from '../types/fraud';
import { useDialog } from '../state/useDialog';
import { OutcomeBadge, PredictionBadge, OriginBadge, RiskMeter, fmtMoney, fmtDateTimeUtc } from './ui';

interface TransactionShapModalProps {
  transaction: Transaction | null;
  decisionThreshold: number;
  modelName: ModelName;
  onClose: () => void;
  onUpdateStatus: (id: string, newStatus: Transaction['status']) => void;
}

/** Investigation modal with the transaction's additive attribution waterfall. */
export const TransactionShapModal: React.FC<TransactionShapModalProps> = ({ transaction, decisionThreshold, modelName, onClose, onUpdateStatus }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialog(!!transaction, panelRef, closeRef, onClose);

  if (!transaction) return null;
  const t = transaction;
  const maxAbs = Math.max(0.001, ...t.shapBreakdown.map((s) => Math.abs(s.shapValue)));
  const unit = modelName === 'Random Forest' ? 'probability points' : 'log-odds';

  return (
    <div className="fixed inset-0 z-50 flex p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="shap-modal-title">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="relative cs-card max-w-3xl w-full p-6 shadow-2xl m-auto !bg-white dark:!bg-[#0B1220]">
        <div className="flex items-start justify-between pb-4 border-b cs-divider gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono font-bold cs-accent">{t.id}</span>
              <span className="cs-subtle font-mono">{fmtDateTimeUtc(t.timestamp)}</span>
              <OriginBadge origin={t.origin} />
              <span className="cs-subtle">Analyst status: <strong className="cs-text">{t.status}</strong></span>
            </div>
            <h2 id="shap-modal-title" className="text-lg font-bold cs-text mt-1">Investigation & SHAP attribution</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close investigation dialog" className="p-1.5 rounded-xl cs-muted hover:bg-slate-100 dark:hover:bg-[#173B70]/50">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 cs-inset p-4 text-xs">
            <div>
              <span className="text-xs uppercase font-mono cs-subtle block">Amount</span>
              <span className="text-lg font-bold font-mono cs-text tabular-nums">{fmtMoney(t.amount)}</span>
            </div>
            <div>
              <span className="text-xs uppercase font-mono cs-subtle block">Merchant category</span>
              <span className="text-sm font-semibold cs-text block truncate">{t.category}</span>
            </div>
            <div>
              <span className="text-xs uppercase font-mono cs-subtle block">Fraud probability ({modelName})</span>
              <span className="block mt-1"><RiskMeter probability={t.predictedProbability} threshold={decisionThreshold} /></span>
              <span className="block mt-1"><PredictionBadge probability={t.predictedProbability} threshold={decisionThreshold} /></span>
            </div>
            <div>
              <span className="text-xs uppercase font-mono cs-subtle block">Actual outcome</span>
              <span className="block mt-1"><OutcomeBadge label={t.groundTruthLabel} /></span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold cs-text">Additive feature attributions</h3>
              <span className="text-xs cs-subtle">Red raises the fraud score · green lowers it · units: {unit}</span>
            </div>
            {t.shapBreakdown.length === 0 ? (
              <p className="text-xs cs-muted">No attribution available yet (model still training).</p>
            ) : (
              <ul className="space-y-2">
                {t.shapBreakdown.map((item) => {
                  const pos = item.shapValue > 0;
                  return (
                    <li key={item.feature} className="cs-inset p-3">
                      <div className="flex items-center justify-between text-xs mb-1 gap-3">
                        <span className="flex items-center gap-2 font-semibold cs-text">
                          {pos ? <ArrowUpRight className="w-4 h-4 text-red-500" aria-hidden="true" /> : <ArrowDownRight className="w-4 h-4 text-emerald-500" aria-hidden="true" />}
                          {item.label}
                        </span>
                        <span className="flex items-center gap-2 font-mono">
                          <span className="cs-subtle text-xs">{item.value}</span>
                          <span className={`font-bold tabular-nums ${pos ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{pos ? '+' : ''}{item.shapValue.toFixed(3)}</span>
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-700/60 overflow-hidden" aria-hidden="true">
                        <div className={`h-full rounded-full ${pos ? 'bg-[#E5484D]' : 'bg-emerald-500'}`} style={{ width: `${(Math.abs(item.shapValue) / maxAbs) * 100}%` }} />
                      </div>
                      <p className="text-xs cs-subtle mt-1">{item.description}</p>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-xs cs-subtle">Attributions explain model reliance, not real-world causation.</p>
          </div>

          <div className="pt-4 border-t cs-divider flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs cs-muted">Analyst decision (UI workflow only – does not change labels or training):</span>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => { onUpdateStatus(t.id, 'Confirmed Fraud'); onClose(); }} className="cs-btn border border-red-300 text-red-700 hover:bg-red-50 dark:border-[#E5484D]/40 dark:text-red-300 dark:hover:bg-[#E5484D]/10">
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Mark fraud
              </button>
              <button type="button" onClick={() => { onUpdateStatus(t.id, 'Cleared'); onClose(); }} className="cs-btn border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10">
                <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" /> Clear
              </button>
              <button type="button" onClick={() => { onUpdateStatus(t.id, 'Pending Review'); onClose(); }} className="cs-btn cs-btn-secondary">Keep in review</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
