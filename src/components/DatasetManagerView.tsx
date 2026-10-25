import React, { useState } from 'react';
import { useSessionState } from '../state/useSessionState';
import { Upload, Download, RefreshCw, ShieldCheck, ShieldAlert, Layers } from 'lucide-react';
import type { Transaction } from '../types/fraud';
import { useChrono } from '../state/ChronoContext';
import { TransactionLedger } from './TransactionLedger';
import { TransactionDetailDrawer } from './TransactionDetailDrawer';
import { ExpectedFormat, downloadSampleCsv } from './DatasetUploaderModal';
import { DataLegend, ProvenanceBadge, SectionTitle, fmtMoney } from './ui';

interface DatasetManagerViewProps {
  onOpenUploadModal: () => void;
  onSelectTransaction: (tx: Transaction) => void;
}

export const DatasetManagerView: React.FC<DatasetManagerViewProps> = ({ onOpenUploadModal, onSelectTransaction }) => {
  const { dataset, transactions, splits, decisionThreshold, loadSample, isSynthetic, bundle } = useChrono();
  const [split, setSplit] = useSessionState<'all' | 'train' | 'validation' | 'test'>('dataset.split', 'all');
  const [inspected, setInspected] = useState<Transaction | null>(null);
  const parse = dataset?.parse;
  const rows = split === 'all' ? transactions : split === 'train' ? splits.train : split === 'validation' ? splits.validation : splits.test;
  const volume = transactions.reduce((s, t) => s + t.amount, 0);
  const s = splits.splitSummary;
  const sensitive = parse?.droppedColumns.filter((d) => d.reason === 'sensitive') ?? [];

  return (
    <div className="space-y-6 pb-10">
      <section className="cs-card p-5 space-y-4">
        <SectionTitle
          title="Active dataset"
          subtitle="One dataset is active at a time; every page (models, stream, drift, queue) uses it and the models trained on it."
          right={
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onOpenUploadModal} className="cs-btn cs-btn-primary"><Upload className="w-4 h-4" aria-hidden="true" /> Upload CSV</button>
              <button
                type="button"
                onClick={loadSample}
                className="cs-btn cs-btn-secondary"
                title={isSynthetic ? 'Re-trains the models on the synthetic sample. Manual tests and simulated review decisions are cleared.' : 'Replaces the uploaded dataset with the synthetic sample and re-trains. Manual tests and simulated review decisions are cleared.'}
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#3988FF]" aria-hidden="true" /> {isSynthetic ? 'Reload synthetic sample' : 'Load synthetic sample'}
              </button>
              <button type="button" onClick={downloadSampleCsv} className="cs-btn cs-btn-secondary"><Download className="w-3.5 h-3.5 text-[#3988FF]" aria-hidden="true" /> Download sample CSV</button>
            </div>
          }
        />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <div className="cs-inset p-3">
            <span className="cs-subtle block">Dataset</span>
            <span className="font-semibold cs-text block truncate" title={dataset?.name}>{dataset?.name}</span>
            <span className="mt-1 inline-block">{isSynthetic ? <ProvenanceBadge kind="synthetic" /> : <ProvenanceBadge kind="historical" label="Uploaded" />}</span>
          </div>
          <div className="cs-inset p-3">
            <span className="cs-subtle block">Valid rows</span>
            <span className="font-mono font-bold text-lg cs-text">{(parse?.validRowsCount ?? 0).toLocaleString()}</span>
            <span className="cs-subtle block">{(parse?.invalidRowsCount ?? 0).toLocaleString()} skipped of {(parse?.totalRowsRead ?? 0).toLocaleString()}</span>
          </div>
          <div className="cs-inset p-3">
            <span className="cs-subtle block">Confirmed fraud</span>
            <span className="font-mono font-bold text-lg text-red-600 dark:text-red-400">{parse?.fraudCount ?? 0}</span>
            <span className="cs-subtle block">{parse?.fraudRatePercent ?? 0}% of {(parse?.labelledCount ?? 0).toLocaleString()} labelled</span>
          </div>
          <div className="cs-inset p-3">
            <span className="cs-subtle block">Unlabelled</span>
            <span className="font-mono font-bold text-lg cs-text">{parse?.unlabelledCount ?? 0}</span>
            <span className="cs-subtle block">scored, never trained/evaluated on</span>
          </div>
          <div className="cs-inset p-3">
            <span className="cs-subtle block">Volume · span</span>
            <span className="font-mono font-bold text-lg cs-text">{fmtMoney(volume, 0)}</span>
            <span className="cs-subtle block font-mono">{parse?.dateRange.start} → {parse?.dateRange.end}</span>
          </div>
        </div>
      </section>

      <section className="cs-card p-5 space-y-4">
        <SectionTitle title="Validation & privacy report" subtitle="What was accepted, skipped, dropped and used as model input." />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="cs-inset p-4 space-y-2">
            <p className="font-semibold cs-text flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> Anti-leakage</p>
            <p className="cs-muted">Model inputs (source columns): <span className="font-mono cs-text">{bundle?.featureSpace.sourceColumns.join(', ') ?? '…'}</span></p>
            <p className="cs-muted">The label column <code className="font-mono cs-text">{parse?.mappedColumns.is_fraud}</code>, the id column <code className="font-mono cs-text">{parse?.mappedColumns.transaction_id}</code> and any label-derived columns are blocked by a runtime guard.</p>
            <p className="cs-muted">Feature statistics (medians, scaling, category vocabulary) are fitted on the train split only.</p>
          </div>
          <div className="cs-inset p-4 space-y-2">
            <p className="font-semibold cs-text flex items-center gap-1.5"><ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" aria-hidden="true" /> Dropped / excluded columns</p>
            {parse && parse.droppedColumns.length > 0 ? (
              <ul className="space-y-1 cs-muted">
                {parse.droppedColumns.map((d) => (
                  <li key={d.column}><code className="font-mono cs-text">{d.column}</code> – {d.detail}</li>
                ))}
              </ul>
            ) : (
              <p className="cs-muted">None. {isSynthetic ? 'The synthetic sample contains no personal data.' : ''}</p>
            )}
            {sensitive.length > 0 && <p className="text-amber-800 dark:text-amber-300 font-semibold">{sensitive.length} sensitive-looking column(s) were removed and are never displayed.</p>}
            {parse && Object.keys(parse.skippedByField).length > 0 && (
              <p className="cs-muted">Skipped rows: {Object.entries(parse.skippedByField).map(([f, c]) => `${f} ${c}`).join(' · ')}</p>
            )}
            {parse?.warnings.filter((w) => !w.startsWith('Privacy')).map((w, i) => <p key={i} className="text-amber-800 dark:text-amber-300">{w}</p>)}
          </div>
        </div>
      </section>

      <section className="cs-card p-5 space-y-4">
        <SectionTitle
          title="Chronological 60 / 20 / 20 partitions"
          subtitle="Sorted by timestamp and cut into contiguous blocks. Click a card to filter the records below."
          right={<Layers className="w-5 h-5 text-[#3988FF]" aria-hidden="true" />}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {([
            ['train', 'Train (60%)', s.trainCount, s.trainFrauds, s.trainDateRange, 'Model fitting'],
            ['validation', 'Validation (20%)', s.valCount, s.valFrauds, s.valDateRange, 'Threshold tuning'],
            ['test', 'Held-out test (20%)', s.testCount, s.testFrauds, s.testDateRange, 'Reported metrics + stream replay'],
          ] as const).map(([key, label, n, f, range, role]) => (
            <button type="button" key={key} onClick={() => setSplit(split === key ? 'all' : key)} aria-pressed={split === key} className={`text-left p-4 rounded-xl border transition-colors ${split === key ? 'border-[#3988FF] bg-[#3988FF]/10' : 'cs-inset hover:border-[#3988FF]/50'}`}>
              <span className="text-xs font-bold cs-accent block">{label}</span>
              <span className="text-xl font-bold font-mono cs-text block mt-1">{n.toLocaleString()}</span>
              <span className="text-xs cs-muted block">{f} confirmed frauds · {role}</span>
              <span className="text-xs font-mono cs-subtle block mt-1">{range}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="cs-card p-5 space-y-4">
        <SectionTitle
          title={`Records${split === 'all' ? '' : ` – ${split} split`}`}
          subtitle="Transaction ID, timestamp, amount, merchant category, predicted probability (active model), predicted status and actual label."
          right={
            <div className="cs-seg" role="group" aria-label="Split filter">
              {(['all', 'train', 'validation', 'test'] as const).map((k) => (
                <button type="button" key={k} aria-pressed={split === k} onClick={() => setSplit(k)} className="capitalize">{k}</button>
              ))}
            </div>
          }
        />
        <DataLegend />
        <TransactionLedger transactions={rows} decisionThreshold={decisionThreshold} onInspect={setInspected} onExplain={onSelectTransaction} caption="Dataset records" resetKey={split} />
      </section>

      <ExpectedFormat />

      {inspected && (
        <TransactionDetailDrawer
          transaction={rows.find((t) => t.id === inspected.id) ?? inspected}
          decisionThreshold={decisionThreshold}
          onClose={() => setInspected(null)}
          onExplain={(tx) => { setInspected(null); onSelectTransaction(tx); }}
        />
      )}
    </div>
  );
};
