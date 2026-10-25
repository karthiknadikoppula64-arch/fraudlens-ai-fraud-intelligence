import React, { useId, useState } from 'react';
import { ClipboardCheck, Info, AlertTriangle, ArrowUpRight, ArrowDownRight, Sparkles, RotateCcw, Radio, Loader2 } from 'lucide-react';
import type { Transaction } from '../types/fraud';
import type { NavTabId } from '../routes';
import { useChrono } from '../state/ChronoContext';
import type { ManualCheckSuccess, ManualFieldErrors, ManualFormValues } from '../utils/manualTransaction';
import { EmptyState, OutcomeBadge, PredictionBadge, ProvenanceBadge, RiskMeter, SectionTitle, fmtDateTimeUtc, fmtMoney } from './ui';

interface Props {
  onSelectTransaction: (tx: Transaction) => void;
  onNavigate: (tab: NavTabId) => void;
}

/**
 * Manual Transaction: score ONE hand-entered transaction with the active trained model.
 * Only label-free model inputs are asked for (no card number, CVV, name, e-mail or password fields exist).
 * Submitting never touches the live stream (separate state slice in ChronoContext).
 */
export const ManualTransactionView: React.FC<Props> = ({ onSelectTransaction, onNavigate }) => {
  const {
    bundle,
    trainingStatus,
    activeModelName,
    decisionThreshold,
    recommendedThreshold,
    manualFormSpec: spec,
    manualTransactions,
    submitManualTransaction,
    clearManualTransactions,
    streamRunning,
    processedCount,
    dataset,
    manualDraft,
    setManualDraft,
    manualLastResult: result,
    setManualLastResult: setResult,
  } = useChrono();

  const uid = useId();
  // The draft and the last result live in ChronoContext so typed values and the verdict survive
  // navigating away and back; both are cleared when a new dataset (new feature space) is loaded.
  const values: ManualFormValues | null = manualDraft ?? spec?.defaults ?? null;
  const setValues = (next: ManualFormValues | null | ((prev: ManualFormValues | null) => ManualFormValues | null)) =>
    setManualDraft((prev) => (typeof next === 'function' ? next(prev ?? spec?.defaults ?? null) : next));
  const [errors, setErrors] = useState<ManualFieldErrors>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const fid = (name: string) => `${uid}-${name}`;
  const setField = (name: 'amount' | 'timestamp' | 'category', v: string) => setValues((prev) => (prev ? { ...prev, [name]: v } : prev));
  const setFeature = (col: string, v: string) => setValues((prev) => (prev ? { ...prev, features: { ...prev.features, [col]: v } } : prev));

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!values) return;
    const r = submitManualTransaction(values);
    if (r.ok) {
      setResult(r);
      setErrors({});
      setFormMessage(null);
      setValues(null); // back to the training-median defaults, only after success
    } else {
      setErrors(r.errors); // keep the typed values
      setFormMessage(r.message);
    }
  };

  const fieldError = (name: string) =>
    errors[name] ? (
      <p id={fid(`${name}-err`)} className="text-xs text-red-600 dark:text-red-400 mt-1" role="alert">{errors[name]}</p>
    ) : null;
  const aria = (name: string, hasHint = false) => ({
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': [errors[name] ? fid(`${name}-err`) : '', hasHint ? fid(`${name}-hint`) : ''].filter(Boolean).join(' ') || undefined,
  });

  const modelReady = !!bundle && !!spec && trainingStatus === 'ready';

  return (
    <div className="space-y-6 pb-10">
      {/* Status banner */}
      <section className="cs-card p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="p-2.5 rounded-xl bg-[#3988FF]/10 text-[#3988FF]"><ClipboardCheck className="w-4 h-4" aria-hidden="true" /></span>
          <div className="text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold cs-text">Active model:</span>
              <span className="font-semibold cs-accent">{activeModelName}</span>
              <span className="cs-subtle">· threshold</span>
              <span className="font-mono font-bold cs-text">τ = {decisionThreshold.toFixed(2)}</span>
              {Math.abs(decisionThreshold - recommendedThreshold) < 1e-9 ? (
                <span className="cs-subtle">(validation-tuned)</span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">(manual override; tuned τ* = {recommendedThreshold.toFixed(2)})</span>
              )}
            </div>
            <p className="cs-muted mt-0.5">Trained on “{dataset?.name ?? '—'}”. Change the model or threshold on the Model Benchmarking or Real-Time Stream pages.</p>
          </div>
        </div>
        <div className="cs-inset px-3 py-2 flex items-center gap-2 text-xs" aria-live="polite">
          <Radio className={`w-3.5 h-3.5 ${streamRunning ? 'text-emerald-500' : 'text-amber-500'}`} aria-hidden="true" />
          <span className="cs-muted">Live stream {streamRunning ? 'running' : 'paused'} · {processedCount.toLocaleString()} processed · unaffected by manual checks</span>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Form */}
        <section className="cs-card p-5 space-y-4 lg:col-span-2" aria-labelledby={fid('form-title')}>
          <SectionTitle
            title="Transaction details"
            subtitle="One transaction at a time. Fields match the active model’s input features; times are UTC like the dataset."
            right={<ProvenanceBadge kind="manual" />}
          />
          <h2 id={fid('form-title')} className="sr-only">Manual transaction form</h2>

          {!modelReady || !values || !spec ? (
            <div className="cs-inset p-4 text-xs flex items-start gap-2" role="status">
              {trainingStatus === 'training' ? <Loader2 className="w-4 h-4 animate-spin text-[#3988FF]" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />}
              <span className="cs-text">
                {trainingStatus === 'training'
                  ? 'Models are training on the active dataset. The form appears when training finishes.'
                  : trainingStatus === 'error'
                    ? 'Model training failed, so there is no model to check a transaction with. Load the synthetic sample or a valid CSV first.'
                    : 'No trained model is loaded. Load a dataset to train the models first.'}
              </span>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-3" autoComplete="off">
              <div>
                <label htmlFor={fid('amount')} className="text-xs font-semibold cs-text">Amount (USD)</label>
                <input id={fid('amount')} type="number" inputMode="decimal" min="0.01" step="0.01" className="cs-input w-full mt-1 font-mono" value={values.amount} onChange={(e) => setField('amount', e.target.value)} {...aria('amount', true)} />
                <p id={fid('amount-hint')} className="text-xs cs-subtle mt-0.5">Must be greater than 0. Training median {fmtMoney(spec.amountMedian)}.</p>
                {fieldError('amount')}
              </div>

              <div>
                <label htmlFor={fid('timestamp')} className="text-xs font-semibold cs-text">Date and time (UTC)</label>
                <input id={fid('timestamp')} type="datetime-local" step="60" className="cs-input w-full mt-1 font-mono" value={values.timestamp} onChange={(e) => setField('timestamp', e.target.value)} {...aria('timestamp', true)} />
                <p id={fid('timestamp-hint')} className="text-xs cs-subtle mt-0.5">The model uses the hour of day (UTC), encoded as sin/cos.</p>
                {fieldError('timestamp')}
              </div>

              <div>
                <label htmlFor={fid('category')} className="text-xs font-semibold cs-text">Merchant category</label>
                <select id={fid('category')} className="cs-input w-full mt-1" value={values.category} onChange={(e) => setField('category', e.target.value)} {...aria('category')}>
                  {spec.categories.map((c) => (
                    <option key={c} value={c}>{c}{spec.modelCategories.includes(c) ? '' : ' (scored as “other”)'}</option>
                  ))}
                </select>
                {fieldError('category')}
              </div>

              {spec.numericFields.map((f) => (
                <div key={f.column}>
                  <label htmlFor={fid(f.column)} className="text-xs font-semibold cs-text">{f.label}</label>
                  {f.kind === 'binary' ? (
                    <select id={fid(f.column)} className="cs-input w-full mt-1" value={values.features[f.column] ?? ''} onChange={(e) => setFeature(f.column, e.target.value)} {...aria(f.column, true)}>
                      <option value="0">No</option>
                      <option value="1">Yes</option>
                    </select>
                  ) : (
                    <input
                      id={fid(f.column)}
                      type="number"
                      inputMode={f.kind === 'integer' ? 'numeric' : 'decimal'}
                      step={f.kind === 'integer' ? '1' : 'any'}
                      min={f.nonNegative ? '0' : undefined}
                      className="cs-input w-full mt-1 font-mono"
                      value={values.features[f.column] ?? ''}
                      onChange={(e) => setFeature(f.column, e.target.value)}
                      {...aria(f.column, true)}
                    />
                  )}
                  <p id={fid(`${f.column}-hint`)} className="text-xs cs-subtle mt-0.5">{f.hint}</p>
                  {fieldError(f.column)}
                </div>
              ))}

              {formMessage && (
                <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5" role="alert">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" /> {formMessage}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="submit" className="cs-btn cs-btn-primary">
                  <ClipboardCheck className="w-4 h-4" aria-hidden="true" /> Check Transaction
                </button>
                <button type="button" className="cs-btn cs-btn-secondary" onClick={() => { setValues(null); setErrors({}); setFormMessage(null); }}>
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reset to defaults
                </button>
              </div>
              <p className="text-xs cs-subtle flex items-start gap-1.5">
                <Info className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
                No card numbers, CVV, names, e-mails or passwords are needed or accepted. Defaults are training-split medians.
              </p>
            </form>
          )}
        </section>

        {/* Result */}
        <section className="cs-card p-5 space-y-4 lg:col-span-3" aria-live="polite" aria-labelledby={fid('result-title')}>
          <SectionTitle title="Result" subtitle="Real model output from the same preprocessing and predict function used for dataset rows." right={<ProvenanceBadge kind="predicted" />} />
          <h2 id={fid('result-title')} className="sr-only">Manual check result</h2>
          {!result ? (
            <EmptyState message="Fill in the form and press Check Transaction." />
          ) : (
            <ManualResult result={result} currentModel={activeModelName} currentThreshold={decisionThreshold} onExplain={() => onSelectTransaction(manualTransactions.find((t) => t.id === result.transaction.id) ?? result.transaction)} />
          )}
        </section>
      </div>

      {/* History */}
      <section className="cs-card p-5 space-y-3">
        <SectionTitle
          title={`Manual test history (${manualTransactions.length})`}
          subtitle="Kept separately from the live stream. Scores are refreshed with the current model and threshold. Actual outcome is always Pending / Unknown; these rows are never used for training, threshold tuning or metrics. Cleared when a new dataset is loaded."
          right={
            <div className="flex gap-2">
              <button type="button" className="cs-btn cs-btn-secondary" onClick={() => onNavigate('stream')}>Open stream ledger</button>
              {manualTransactions.length > 0 && <button type="button" className="cs-btn cs-btn-secondary" onClick={clearManualTransactions}>Clear history</button>}
            </div>
          }
        />
        {manualTransactions.length === 0 ? (
          <p className="text-xs cs-muted">No manual checks yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Manual test transactions</caption>
              <thead>
                <tr className="text-left">
                  <th scope="col" className="cs-th py-2 pr-3">ID · time (UTC)</th>
                  <th scope="col" className="cs-th py-2 pr-3">Category</th>
                  <th scope="col" className="cs-th py-2 pr-3 text-right">Amount</th>
                  <th scope="col" className="cs-th py-2 pr-3">Score (uncalibrated)</th>
                  <th scope="col" className="cs-th py-2 pr-3">Predicted</th>
                  <th scope="col" className="cs-th py-2 pr-3">Actual</th>
                  <th scope="col" className="cs-th py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {manualTransactions.map((t) => (
                  <tr key={t.id} className="cs-row border-t cs-divider">
                    <td className="py-2 pr-3 font-mono">
                      <span className="cs-text font-semibold block">{t.id}</span>
                      <span className="cs-subtle text-xs">{fmtDateTimeUtc(t.timestamp)}</span>
                      <span className="block mt-0.5"><ProvenanceBadge kind="manual" /></span>
                    </td>
                    <td className="py-2 pr-3 cs-text">{t.category}</td>
                    <td className="py-2 pr-3 text-right font-mono cs-text">{fmtMoney(t.amount)}</td>
                    <td className="py-2 pr-3"><RiskMeter probability={t.predictedProbability} threshold={decisionThreshold} /></td>
                    <td className="py-2 pr-3"><PredictionBadge probability={t.predictedProbability} threshold={decisionThreshold} compact /></td>
                    <td className="py-2 pr-3"><OutcomeBadge label={null} /></td>
                    <td className="py-2"><button type="button" className="cs-btn cs-btn-secondary !py-1 !px-2" onClick={() => onSelectTransaction(t)} aria-label={`Explain ${t.id}`}>Explain</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

const ManualResult: React.FC<{ result: ManualCheckSuccess; currentModel: string; currentThreshold: number; onExplain: () => void }> = ({ result: r, currentModel, currentThreshold, onExplain }) => {
  const t = r.transaction;
  const stale = r.modelName !== currentModel || Math.abs(r.threshold - currentThreshold) > 1e-9;
  const maxAbs = Math.max(0.001, ...r.explanation.map((s) => Math.abs(s.shapValue)));
  const unit = r.modelName === 'Random Forest' ? 'probability points' : 'log-odds';
  return (
    <div className="space-y-4">
      {stale && (
        <p className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5" role="note">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          This verdict was computed with {r.modelName} at τ = {r.threshold.toFixed(2)}. The active setting is now {currentModel} at τ = {currentThreshold.toFixed(2)}; the history table below shows the re-scored value.
        </p>
      )}
      <div className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${r.flagged ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10' : 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10'}`}>
        <div>
          <p className="text-xs uppercase font-mono cs-subtle">Prediction ({r.modelName})</p>
          <p className={`text-2xl font-bold ${r.flagged ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
            {r.verdict} <span className="text-sm font-semibold">({r.flagged ? 'Fraud' : 'Not fraud'} at τ)</span>
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <PredictionBadge probability={r.probability} threshold={r.threshold} />
            <ProvenanceBadge kind="manual" />
            <OutcomeBadge label={null} />
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase font-mono cs-subtle">Model fraud score (uncalibrated)</p>
          <div className="mt-1"><RiskMeter probability={r.probability} threshold={r.threshold} /></div>
          <p className="text-xs cs-subtle mt-1 font-mono">{r.flagged ? '≥' : '<'} τ = {r.threshold.toFixed(2)} · checked {fmtDateTimeUtc(r.checkedAt)}</p>
        </div>
      </div>
      <p className="text-xs cs-muted flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        The score is the model’s raw output. Class weighting during training inflates it, so it is not a calibrated probability of fraud; the decision uses the threshold tuned on the validation split.
      </p>
      {r.warnings.length > 0 && (
        <ul className="text-xs text-amber-800 dark:text-amber-300 space-y-1">
          {r.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />{w}</li>
          ))}
        </ul>
      )}

      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider cs-muted font-mono mb-2">Submitted details</h3>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
          <div className="cs-inset px-3 py-2"><dt className="text-xs cs-subtle">ID</dt><dd className="cs-text font-semibold truncate">{t.id}</dd></div>
          <div className="cs-inset px-3 py-2"><dt className="text-xs cs-subtle">Amount</dt><dd className="cs-text font-semibold">{fmtMoney(t.amount)}</dd></div>
          <div className="cs-inset px-3 py-2"><dt className="text-xs cs-subtle">Time</dt><dd className="cs-text font-semibold">{fmtDateTimeUtc(t.timestamp)}</dd></div>
          <div className="cs-inset px-3 py-2"><dt className="text-xs cs-subtle">Merchant category</dt><dd className="cs-text font-semibold truncate">{t.category}</dd></div>
          {Object.entries(t.features).map(([k, v]) => (
            <div key={k} className="cs-inset px-3 py-2"><dt className="text-xs cs-subtle truncate">{k}</dt><dd className="cs-text font-semibold">{v}</dd></div>
          ))}
        </dl>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider cs-muted font-mono">Why: additive attributions</h3>
          <span className="text-xs cs-subtle">Red raises the score · green lowers it · units: {unit}</span>
        </div>
        <ul className="space-y-2">
          {r.explanation.map((item) => {
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
        <p className="text-xs cs-subtle">Attributions describe how the model uses its inputs; they do not prove a feature caused fraud.</p>
      </div>

      <details className="cs-inset p-3 text-xs">
        <summary className="cursor-pointer font-semibold cs-text">Derived model inputs ({r.derivedFeatures.length}, in model order)</summary>
        <p className="text-xs cs-subtle mt-1">Computed automatically by the same train-fitted preprocessing: standardised log amount, hour sin/cos, standardised numeric columns, one-hot category.</p>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2 font-mono">
          {r.derivedFeatures.map((d) => (
            <div key={d.name} className="px-2 py-1 rounded border cs-divider">
              <dt className="text-xs cs-subtle truncate" title={d.name}>{d.name}</dt>
              <dd className="cs-text">{d.value.toFixed(3)}</dd>
            </div>
          ))}
        </dl>
      </details>

      <button type="button" className="cs-btn cs-btn-secondary" onClick={onExplain}>
        <Sparkles className="w-3.5 h-3.5 text-[#3988FF]" aria-hidden="true" /> Open in investigation modal
      </button>
    </div>
  );
};
