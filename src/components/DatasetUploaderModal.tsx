import React, { useRef, useState } from 'react';
import { Upload, CheckCircle2, AlertTriangle, Download, X, ShieldCheck, RefreshCw, ArrowRight, ShieldAlert, Loader2 } from 'lucide-react';
import { useDialog } from '../state/useDialog';
import { EXAMPLE_CSV } from '../utils/datasetSchema';
import { parseAndValidateTransactionCsv, generateSampleCsvString, type CsvParseResult } from '../utils/csvParser';

interface DatasetUploaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDatasetLoaded: (result: CsvParseResult, sourceName: string) => void;
  onLoadSyntheticSample: () => void;
  activeDatasetName: string;
}

const MAX_BYTES = 60 * 1024 * 1024;

export function downloadSampleCsv() {
  const blob = new Blob([generateSampleCsvString()], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'fraudlens_synthetic_sample.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoke after the click has been handled; revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const ExpectedFormat: React.FC = () => (
  <div className="cs-inset p-4 text-xs space-y-2">
    <p className="font-semibold cs-text">Expected CSV format</p>
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 cs-muted">
      <li><code className="font-mono cs-text">transaction_id</code> – required, unique, anonymous ID</li>
      <li><code className="font-mono cs-text">timestamp</code> – required, ISO-8601 / “YYYY-MM-DD HH:MM:SS” (UTC) / epoch s</li>
      <li><code className="font-mono cs-text">amount</code> – required, positive number</li>
      <li><code className="font-mono cs-text">merchant_category</code> – required, text</li>
      <li><code className="font-mono cs-text">is_fraud</code> – required column; 0, 1, true, false, or blank = unlabelled</li>
      <li><span className="font-mono cs-text">optional</span> – any numeric feature columns (e.g. distance_km, velocity_1h)</li>
    </ul>
    <pre className="font-mono text-xs cs-text overflow-x-auto bg-white/50 dark:bg-black/20 rounded-lg p-2">{EXAMPLE_CSV}</pre>
    <p className="cs-subtle">Never include card numbers, CVVs, names, emails, phone numbers or addresses – such columns are detected, dropped and never displayed.</p>
  </div>
);

export const DatasetUploaderModal: React.FC<DatasetUploaderModalProps> = ({ isOpen, onClose, onDatasetLoaded, onLoadSyntheticSample, activeDatasetName }) => {
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<CsvParseResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialog(isOpen, panelRef, closeRef, onClose);

  if (!isOpen) return null;

  /** Clears the validation report once it has been acted on, so reopening starts fresh. */
  const resetReport = () => {
    setResult(null);
    setFileError(null);
    setFileName('');
    if (inputRef.current) inputRef.current.value = '';
  };
  /** Any file dropped on the dialog (not only the drop zone) must not make the browser navigate away. */
  const blockFileDrop = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  };

  const processFile = (file: File) => {
    setFileError(null);
    setResult(null);
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      setFileError('Please choose a .csv file.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setFileError(`File is ${(file.size / 1048576).toFixed(1)} MB; the in-browser limit is ${MAX_BYTES / 1048576} MB.`);
      return;
    }
    setParsing(true);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      setTimeout(() => {
        try {
          setResult(parseAndValidateTransactionCsv(String(e.target?.result ?? ''), { origin: 'uploaded_csv' }));
        } catch (err) {
          setFileError(err instanceof Error ? err.message : 'Could not parse this file.');
        } finally {
          setParsing(false);
        }
      }, 10);
    };
    reader.onerror = () => {
      setParsing(false);
      setFileError('Could not read the file.');
    };
    reader.readAsText(file);
  };

  const sensitive = result?.droppedColumns.filter((d) => d.reason === 'sensitive') ?? [];
  const excluded = result?.droppedColumns.filter((d) => d.reason !== 'sensitive') ?? [];

  return (
    <div className="fixed inset-0 z-50 flex p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="upload-title" onDragOver={blockFileDrop} onDrop={blockFileDrop}>
      <div className="fixed inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="relative w-full max-w-3xl m-auto cs-card !bg-white dark:!bg-[#0B1220] shadow-2xl">
        <div className="p-5 border-b cs-divider flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-[#3988FF]/10 flex items-center justify-center"><Upload className="w-5 h-5 text-[#3988FF]" aria-hidden="true" /></span>
            <div>
              <h2 id="upload-title" className="text-base font-bold cs-text">Upload historical transactions (CSV)</h2>
              <p className="text-xs cs-muted">Processed locally in your browser. Active: <strong className="cs-accent">{activeDatasetName}</strong></p>
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="p-2 rounded-lg cs-muted hover:bg-slate-100 dark:hover:bg-[#173B70]/40" aria-label="Close upload dialog">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/25 text-xs flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="cs-muted"><strong className="cs-text">Privacy:</strong> FraudLens never needs or stores real card numbers, CVVs, passwords or personal details. Columns that look like them are dropped automatically and you are warned.</p>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]); }}
            className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors ${dragOver ? 'border-[#3988FF] bg-[#3988FF]/10' : 'border-slate-300 dark:border-[#173B70] hover:border-[#3988FF]/60'}`}
          >
            <input
              ref={inputRef}
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only peer"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processFile(f);
                e.target.value = ''; // allow re-selecting the same file after fixing it
              }}
            />
            <Upload className="w-7 h-7 text-[#3988FF] mx-auto mb-2" aria-hidden="true" />
            <label htmlFor="csv-file" className="cs-btn cs-btn-primary cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#3988FF]">Choose CSV file</label>
            <p className="text-xs cs-muted mt-2">…or drag and drop it here (max {MAX_BYTES / 1048576} MB)</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { onLoadSyntheticSample(); resetReport(); onClose(); }} className="cs-btn cs-btn-secondary">
              <RefreshCw className="w-3.5 h-3.5 text-[#3988FF]" aria-hidden="true" /> Use synthetic sample
            </button>
            <button type="button" onClick={downloadSampleCsv} className="cs-btn cs-btn-secondary">
              <Download className="w-3.5 h-3.5 text-[#3988FF]" aria-hidden="true" /> Download sample CSV
            </button>
          </div>

          <div aria-live="polite">
            {parsing && <p className="text-xs cs-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Validating {fileName}…</p>}
            {fileError && <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-2" role="alert"><AlertTriangle className="w-4 h-4" aria-hidden="true" /> {fileError}</p>}
          </div>

          {result && (
            <div className={`p-4 rounded-xl border space-y-4 ${result.isValid ? 'border-emerald-300 dark:border-emerald-500/40' : 'border-red-300 dark:border-red-500/40'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  {result.isValid ? <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" aria-hidden="true" />}
                  <div>
                    <h3 className="text-sm font-bold cs-text">
                      {result.isValid ? `Ready: ${result.validRowsCount.toLocaleString()} valid transactions` : 'This file cannot be used yet'}
                    </h3>
                    <p className="text-xs cs-muted font-mono">
                      {fileName} · {result.totalRowsRead.toLocaleString()} rows read · {result.validRowsCount.toLocaleString()} valid · {result.invalidRowsCount.toLocaleString()} skipped · {result.labelledCount.toLocaleString()} labelled ({result.fraudCount} fraud, {result.fraudRatePercent}%) · {result.unlabelledCount} unlabelled
                    </p>
                  </div>
                </div>
                {result.isValid && (
                  <button type="button" onClick={() => { onDatasetLoaded(result, fileName || 'Uploaded CSV'); resetReport(); onClose(); }} className="cs-btn cs-btn-primary">
                    Train on this dataset <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>

              {result.headerErrors.length > 0 && (
                <ul className="space-y-1.5 text-xs" aria-label="File-level errors">
                  {result.headerErrors.map((e, i) => (
                    <li key={i} className="p-2 rounded-lg bg-red-50 text-red-800 border border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/25">{e.message}</li>
                  ))}
                </ul>
              )}

              {sensitive.length > 0 && (
                <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 text-xs" role="alert">
                  <p className="font-semibold text-amber-900 dark:text-amber-300 flex items-center gap-1.5"><ShieldAlert className="w-4 h-4" aria-hidden="true" /> {sensitive.length} sensitive-looking column(s) dropped</p>
                  <ul className="mt-1 space-y-0.5 cs-muted">
                    {sensitive.map((d) => <li key={d.column}><code className="font-mono cs-text">{d.column}</code> – {d.detail}</li>)}
                  </ul>
                </div>
              )}

              {Object.keys(result.skippedByField).length > 0 && (
                <div className="text-xs space-y-1.5">
                  <p className="font-semibold cs-text">Skipped rows by reason</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(result.skippedByField).map(([f, c]) => (
                      <span key={f} className="px-2 py-0.5 rounded-md border cs-divider font-mono cs-muted">{f}: {c}</span>
                    ))}
                  </div>
                  <ul className="space-y-1 max-h-40 overflow-y-auto">
                    {result.errors.slice(0, 8).map((e, i) => (
                      <li key={i} className="font-mono text-xs cs-muted">
                        Row {e.row} · {e.field}: {e.message}{e.sampleValue !== undefined && e.sampleValue !== '' ? ` (got “${e.sampleValue}”)` : ''}
                      </li>
                    ))}
                    {result.errors.length > 8 && <li className="text-xs cs-subtle">…and {(result.invalidRowsCount - 8).toLocaleString()} more skipped rows.</li>}
                  </ul>
                </div>
              )}

              {result.warnings.filter((w) => !w.startsWith('Privacy')).map((w, i) => (
                <p key={i} className="text-xs text-amber-800 dark:text-amber-300">{w}</p>
              ))}

              <div className="text-xs grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="cs-inset p-3">
                  <p className="font-semibold cs-text mb-1">Model feature columns ({result.featureColumns.length})</p>
                  <p className="font-mono text-xs cs-muted">{['amount (log)', 'hour of day', 'merchant_category', ...result.featureColumns].join(', ')}</p>
                </div>
                <div className="cs-inset p-3">
                  <p className="font-semibold cs-text mb-1">Excluded from features ({excluded.length + 2})</p>
                  <p className="font-mono text-xs cs-muted">{[result.mappedColumns.is_fraud ? `${result.mappedColumns.is_fraud} (label)` : 'label', result.mappedColumns.transaction_id ? `${result.mappedColumns.transaction_id} (id)` : 'id', ...excluded.map((d) => `${d.column} (${d.reason.replace('_', ' ')})`)].join(', ')}</p>
                </div>
              </div>

              {result.isValid && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  {[
                    ['Train (60%)', result.splits.summary.trainCount, result.splits.summary.trainFrauds, result.splits.summary.trainDateRange],
                    ['Validation (20%)', result.splits.summary.valCount, result.splits.summary.valFrauds, result.splits.summary.valDateRange],
                    ['Test (20%)', result.splits.summary.testCount, result.splits.summary.testFrauds, result.splits.summary.testDateRange],
                  ].map(([label, n, f, range]) => (
                    <div key={String(label)} className="cs-inset p-3">
                      <span className="cs-subtle block text-xs">{label}</span>
                      <span className="font-mono font-bold cs-text block">{Number(n).toLocaleString()} txns · {f} frauds</span>
                      <span className="font-mono text-xs cs-subtle">{range}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <ExpectedFormat />
        </div>
      </div>
    </div>
  );
};
