import React from 'react';
import { Database, ShieldCheck, Cpu, CalendarClock, Gauge, Clock, AlertTriangle, Download } from 'lucide-react';
import { useChrono } from '../state/ChronoContext';
import { ProvenanceBadge } from './ui';

interface ResearchMethodologyProps {
  onExportReport: () => void;
  darkMode?: boolean;
}

const Section: React.FC<{ n: number; title: string; icon: React.ElementType; badge?: React.ReactNode; children: React.ReactNode }> = ({ n, title, icon: Icon, badge, children }) => (
  <section className="cs-card p-5 space-y-3" aria-labelledby={`meth-${n}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id={`meth-${n}`} className="text-sm font-bold cs-text flex items-center gap-2">
        <Icon className="w-4 h-4 text-[#3988FF]" aria-hidden="true" />
        <span>{n}. {title}</span>
      </h2>
      {badge}
    </div>
    <div className="text-xs cs-muted leading-relaxed space-y-2">{children}</div>
  </section>
);

const Facts: React.FC<{ rows: [string, React.ReactNode][] }> = ({ rows }) => (
  <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 cs-inset p-3">
    {rows.map(([k, v]) => (
      <div key={k} className="flex justify-between gap-3">
        <dt className="cs-subtle">{k}</dt>
        <dd className="font-mono cs-text text-right">{v}</dd>
      </div>
    ))}
  </dl>
);

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Methodology & limitations. Every number shown is read live from the active dataset / trained bundle. */
export const ResearchMethodology: React.FC<ResearchMethodologyProps> = ({ onExportReport }) => {
  const { dataset, isSynthetic, bundle, splits, evaluation, activeModelName, decisionThreshold, recommendedThreshold, costFP, costFNPenalty } = useChrono();
  const parse = dataset?.parse;
  const s = splits.splitSummary;
  const ev = evaluation?.[activeModelName];

  return (
    <div className="space-y-5 pb-10">
      <div className="cs-card p-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs cs-muted max-w-3xl leading-relaxed">
          How FraudLens ingests data, trains and evaluates its models, and where its results should not be trusted. Figures marked <ProvenanceBadge kind="measured" label="Live" /> are read
          from the currently active dataset and models, so they change when you upload a CSV or switch model.
        </p>
        <button type="button" onClick={onExportReport} className="cs-btn cs-btn-primary shrink-0"><Download className="w-4 h-4" aria-hidden="true" /> Export audit report (JSON)</button>
      </div>

      <Section n={1} title="Data source & synthetic status" icon={Database} badge={isSynthetic ? <ProvenanceBadge kind="synthetic" /> : <ProvenanceBadge kind="historical" label="Uploaded" />}>
        <p>
          {isSynthetic
            ? 'The active dataset is the bundled synthetic sample: a seeded, deterministic generator (mulberry32, seed 20250101) producing about 8,000 transactions over 240 days with about 3 % fraud. Fraud tactics drift from high-value cross-border fraud towards low-value card testing, and the last 4 days have blank labels to represent chargebacks that have not matured. It contains no real transactions.'
            : 'The active dataset is a user-uploaded CSV, processed locally in the browser.'}{' '}
          Both paths go through the same parser, validation, privacy filter, split and training code.
        </p>
        <p>Rows with a blank label are kept and scored but never used to train, tune or evaluate. Card-number, CVV, name, e-mail, phone, address and similar columns are dropped by header and by content.</p>
        {parse && (
          <Facts
            rows={[
              ['Dataset', dataset?.name ?? '–'],
              ['Valid rows', parse.validRowsCount.toLocaleString()],
              ['Skipped rows', parse.invalidRowsCount.toLocaleString()],
              ['Labelled / unlabelled', `${parse.labelledCount.toLocaleString()} / ${parse.unlabelledCount.toLocaleString()}`],
              ['Fraud rate (labelled)', `${parse.fraudRatePercent.toFixed(2)}%`],
              ['Span', `${parse.dateRange.durationDays} days`],
              ['Dropped columns', parse.droppedColumns.length.toString()],
            ]}
          />
        )}
      </Section>

      <Section n={2} title="Features & leakage guard" icon={ShieldCheck}>
        <p>
          Model inputs are only amount (log, standardised), hour of day (UTC, sin/cos), one-hot merchant category (top 12 train categories plus “other”) and any optional numeric columns
          (train-median imputed, standardised). All statistics are fitted on the train split only.
        </p>
        <p>
          <code className="font-mono cs-text">assertNoLabelLeakage()</code> rejects label, label-derived (fraud, chargeback, dispute, label, target, ground_truth) and identifier columns as features; it runs in
          the parser, the feature-space fit and the training pipeline. <code className="font-mono cs-text">toFeatureInput()</code> passes only amount, timestamp, category and numeric features to the
          feature builder. Unit tests check that flipping every validation and test label leaves all four models’ predictions unchanged.
        </p>
        {bundle && (
          <Facts
            rows={[
              ['Source columns', bundle.featureSpace.sourceColumns.length.toString()],
              ['Encoded features', bundle.featureSpace.names.length.toString()],
              ['Numeric columns', bundle.featureSpace.numericColumns.join(', ') || 'none'],
            ]}
          />
        )}
      </Section>

      <Section n={3} title="Models & training" icon={Cpu}>
        <ul className="list-disc list-inside space-y-1">
          <li><strong className="cs-text">Logistic Regression</strong>: full-batch gradient descent with an L2 penalty.</li>
          <li><strong className="cs-text">LightGBM-style</strong>: histogram gradient boosting, 80 rounds, depth 4.</li>
          <li><strong className="cs-text">XGBoost-style</strong>: gradient boosting, 100 rounds, depth 3, λ = 2, row subsampling 0.8.</li>
          <li><strong className="cs-text">Random Forest</strong>: 60 bagged histogram trees, depth ≤ 7, per-node feature sampling.</li>
        </ul>
        <p>
          These are compact TypeScript re-implementations that run in the browser, not the official LightGBM / XGBoost / scikit-learn libraries. They train on labelled train rows only with √
          inverse-frequency class weights (no oversampling). Above 30,000 labelled train rows, legitimate rows are down-sampled and re-weighted.
        </p>
        {bundle && (
          <Facts
            rows={[
              ['Labelled train rows used', bundle.trainRowsUsed.toLocaleString()],
              ['Down-sampled', bundle.downsampled ? 'yes' : 'no'],
              ['Training time (this browser)', `${Math.round(bundle.trainingMs).toLocaleString()} ms`],
            ]}
          />
        )}
      </Section>

      <Section n={4} title="Time-aware split & evaluation" icon={CalendarClock}>
        <p>
          Rows are sorted by timestamp (ties broken by id) and cut into contiguous 60 / 20 / 20 train / validation / test blocks, so the model is always evaluated on transactions that happen after
          everything it was trained on. The decision threshold τ* is the cost-minimising threshold on labelled validation rows (review cost per alert; amount plus penalty per missed fraud) and is
          adopted automatically; reported metrics come from labelled test rows only.
        </p>
        <Facts
          rows={[
            ['Train', `${s.trainCount.toLocaleString()} rows · ${s.trainFrauds} frauds`],
            ['Validation', `${s.valCount.toLocaleString()} rows · ${s.valFrauds} frauds`],
            ['Test', `${s.testCount.toLocaleString()} rows · ${s.testFrauds} frauds`],
            ['Train dates', s.trainDateRange],
            ['Validation dates', s.valDateRange],
            ['Test dates', s.testDateRange],
            ['τ* (validation)', recommendedThreshold.toFixed(2)],
            ['τ in use', decisionThreshold.toFixed(2)],
            ['Costs', `$${costFP} / alert · amount + $${costFNPenalty} / miss`],
          ]}
        />
      </Section>

      <Section n={5} title="Metrics" icon={Gauge} badge={<ProvenanceBadge kind="measured" label="Live · test split" />}>
        <p>
          PR-AUC (average precision) is the headline metric because fraud is rare; ROC-AUC, precision, recall, F1, MCC and the confusion counts are reported at τ. Cost and estimated saving versus
          a no-model baseline depend on your cost settings and are not clamped, so a model can show a loss.
        </p>
        {ev ? (
          <Facts
            rows={[
              ['Model', activeModelName],
              ['PR-AUC', ev.prAuc.toFixed(3)],
              ['ROC-AUC', ev.rocAuc.toFixed(3)],
              ['Precision / recall', `${pct(ev.precision)} / ${pct(ev.recall)}`],
              ['F1 / MCC', `${ev.f1.toFixed(3)} / ${ev.mcc.toFixed(3)}`],
              ['TP / FP / FN', `${ev.truePositives} / ${ev.falsePositives} / ${ev.falseNegatives}`],
              ['Evaluated rows / frauds', `${ev.evaluatedCount.toLocaleString()} / ${ev.evaluatedFrauds}`],
              ['Threshold (validation τ*)', ev.threshold.toFixed(2)],
            ]}
          />
        ) : (
          <p className="cs-subtle">Models are training…</p>
        )}
      </Section>

      <Section n={6} title="Delayed labels & drift" icon={Clock} badge={<ProvenanceBadge kind="simulated" label="Simulated lags" />}>
        <p>
          <strong className="cs-text">Delayed labels.</strong> Each labelled test row gets a simulated dispute lag of 7, 14, 30 or 60 days (about 30 / 35 / 25 / 10 % of rows), derived from a hash
          of its id and independent of its label. At horizon H only labels with lag ≤ H are known; “apparent” metrics treat the rest as legitimate. Horizons are cumulative over the same rows.
        </p>
        <p>
          <strong className="cs-text">Explanation drift.</strong> Mean |attribution| per window (calendar months, or 12 equal windows when the data spans under 300 days) is compared with a
          train-period baseline by a Z-test at 95 % or 99 %. Windows with fewer than 5 rows are never flagged.
        </p>
      </Section>

      <Section n={7} title="Assumptions, limitations & weaknesses" icon={AlertTriangle}>
        <ul className="list-disc list-inside space-y-1">
          <li>The models are untuned re-implementations; their probabilities are not calibrated (class weighting inflates them), which is why τ is tuned on validation.</li>
          <li>Tree attributions are Saabas path attributions, an approximation of TreeSHAP, not exact Shapley values. Attributions describe how the model uses inputs, not causal fraud mechanisms.</li>
          <li>Delayed-label lags, the review-queue capacity and reviewer decisions are simulations; they test evaluation methodology, not a bank’s real confirmation pipeline or staffing.</li>
          <li>Cost savings are estimates driven by the user’s cost settings and cannot prove operational savings without production data.</li>
          <li>The drift tests apply no multiple-comparison correction, so some flags are expected by chance.</li>
          <li>{ev ? `The test split here has ${ev.evaluatedFrauds} labelled frauds in ${ev.evaluatedCount.toLocaleString()} rows, so metrics carry wide uncertainty (no confidence intervals are reported).` : 'Small test-split fraud counts give metrics wide uncertainty.'}</li>
          <li>Training runs on the browser main thread; very large uploads freeze the UI for several seconds. Data stays in memory and is lost on reload.</li>
          {isSynthetic && <li>Results on the synthetic sample reflect the generator’s assumptions, not real-world fraud.</li>}
        </ul>
      </Section>
    </div>
  );
};
