import React from 'react';
import { Layers, Code, Cpu, Terminal, Download } from 'lucide-react';
import { useChrono } from '../state/ChronoContext';

interface AboutViewProps {
  darkMode: boolean;
  onExportReport: () => void;
}

const Card: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
  <section className="cs-card p-5 space-y-3">
    <h2 className="text-sm font-bold cs-text flex items-center gap-2"><Icon className="w-4 h-4 text-[#3988FF]" aria-hidden="true" />{title}</h2>
    <div className="text-xs cs-muted leading-relaxed space-y-2">{children}</div>
  </section>
);

const ARCH: [string, string][] = [
  ['Ingestion', 'src/utils/csvParser.ts, datasetSchema.ts – CSV parsing, validation, privacy filter'],
  ['Split', 'src/utils/chronoSplit.ts – chronological 60/20/20'],
  ['Features', 'src/utils/featureSpace.ts, featureGuard.ts – train-fitted encoding, leakage guard'],
  ['Models', 'src/utils/models.ts, pipeline.ts – training, scoring, attributions'],
  ['Evaluation', 'src/utils/metrics.ts, costSensitivity.ts, driftWindows.ts, delayedLabels.ts, queueSimulation.ts, reviewQueue.ts'],
  ['State', 'src/state/ChronoContext.tsx – one active dataset, trained bundle, threshold, stream'],
  ['Routing', 'src/routes.ts + History API in App.tsx (deep-linkable paths)'],
];

/** Technical details: architecture, stack, models and local setup. */
export const AboutView: React.FC<AboutViewProps> = ({ onExportReport }) => {
  const { bundle } = useChrono();
  return (
    <div className="space-y-5 pb-10">
      <div className="cs-card p-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs cs-muted max-w-3xl leading-relaxed">
          FraudLens is an independent research prototype for time-aware, cost-sensitive fraud detection. Everything – parsing, training, scoring and evaluation – runs client-side in the
          browser; no transaction data is sent to a server. See Methodology &amp; Limitations for the evaluation protocol.
        </p>
        <button type="button" onClick={onExportReport} className="cs-btn cs-btn-primary shrink-0"><Download className="w-4 h-4" aria-hidden="true" /> Export audit report (JSON)</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Architecture" icon={Layers}>
          <p>Single-page React app. Pipeline: CSV → validation → chronological split → train-only feature space → 4 models → validation-tuned threshold → test-split metrics, shared by all views through one context.</p>
          <dl className="space-y-1">
            {ARCH.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[90px_1fr] gap-2"><dt className="cs-text font-semibold">{k}</dt><dd className="font-mono text-xs">{v}</dd></div>
            ))}
          </dl>
        </Card>

        <Card title="Models" icon={Cpu}>
          <ul className="list-disc list-inside space-y-1">
            <li>Logistic Regression (L2, gradient descent) – exact linear SHAP</li>
            <li>LightGBM-style histogram GBDT (80 rounds, depth 4)</li>
            <li>XGBoost-style GBDT (100 rounds, depth 3, λ = 2, subsample 0.8)</li>
            <li>Random Forest (60 trees, depth ≤ 7)</li>
          </ul>
          <p>Compact TypeScript re-implementations, not the official libraries. Tree attributions are Saabas path attributions (an approximation of TreeSHAP).{bundle ? ` Current bundle: ${bundle.featureSpace.names.length} encoded features, trained on ${bundle.trainRowsUsed.toLocaleString()} labelled rows.` : ''}</p>
        </Card>

        <Card title="Technology stack" icon={Code}>
          <ul className="list-disc list-inside space-y-1">
            <li>React 19 + TypeScript, built with Vite 8</li>
            <li>Tailwind CSS v4 (class-based light / dark theme)</li>
            <li>Recharts 3 for charts, lucide-react for icons</li>
            <li>Tests: Node’s built-in test runner (<code className="font-mono">node --test</code>) on the pure utilities</li>
          </ul>
        </Card>

        <Card title="Local setup" icon={Terminal}>
          <pre className="cs-inset p-3 font-mono text-xs cs-text overflow-x-auto">{`npm install
npm run dev     # http://localhost:3000
npm run lint    # tsc --noEmit
npm test        # node --test src/utils/*.test.ts
npm run build   # vite build -> dist/`}</pre>
          <p>Upload a CSV from the top bar or the Dataset page; the expected format is documented there and in CHANGES.md.</p>
        </Card>
      </div>
    </div>
  );
};
