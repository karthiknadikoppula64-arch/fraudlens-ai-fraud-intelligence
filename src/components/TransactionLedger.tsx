import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, ArrowDown, ArrowUp, ArrowUpDown, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Transaction } from '../types/fraud';
import {
  OutcomeBadge,
  PredictionBadge,
  OriginBadge,
  RiskMeter,
  EmptyState,
  categoryIcon,
  fmtMoney,
  fmtDateTimeUtc,
} from './ui';

type SortKey = 'timestamp' | 'amount' | 'risk';
type RiskFilter = 'All' | 'High' | 'Medium' | 'Low';
type StatusFilter = 'All' | 'Suspicious' | 'Legitimate' | 'Confirmed Fraud' | 'Confirmed Legitimate' | 'Unknown';

interface TransactionLedgerProps {
  transactions: Transaction[];
  decisionThreshold: number;
  onInspect: (tx: Transaction) => void;
  onExplain: (tx: Transaction) => void;
  caption: string;
  pageSize?: number;
  /** Changing this (e.g. the ledger source tab) returns to page 1. */
  resetKey?: string;
}

/** Searchable, filterable, sortable transaction ledger (no PII columns exist to display). */
export const TransactionLedger: React.FC<TransactionLedgerProps> = ({ transactions, decisionThreshold, onInspect, onExplain, caption, pageSize = 25, resetKey }) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [risk, setRisk] = useState<RiskFilter>('All');
  const [status, setStatus] = useState<StatusFilter>('All');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('timestamp');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const categories = useMemo(() => [...new Set(transactions.map((t) => t.category))].sort(), [transactions]);
  const bounds = useMemo(() => {
    if (transactions.length === 0) return { min: '', max: '' };
    let min = Infinity;
    let max = -Infinity;
    for (const t of transactions) {
      const v = Date.parse(t.timestamp);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min: new Date(min).toISOString().slice(0, 10), max: new Date(max).toISOString().slice(0, 10) };
  }, [transactions]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = from ? Date.parse(`${from}T00:00:00Z`) : -Infinity;
    const toMs = to ? Date.parse(`${to}T23:59:59Z`) : Infinity;
    const out = transactions.filter((t) => {
      if (q) {
        const hay = `${t.id} ${t.category} ${t.merchant} ${t.amount.toFixed(2)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (category !== 'All' && t.category !== category) return false;
      const p = t.predictedProbability;
      if (risk === 'High' && p < 0.7) return false;
      if (risk === 'Medium' && (p < 0.3 || p >= 0.7)) return false;
      if (risk === 'Low' && p >= 0.3) return false;
      if (status === 'Suspicious' && p < decisionThreshold) return false;
      if (status === 'Legitimate' && p >= decisionThreshold) return false;
      if (status === 'Confirmed Fraud' && t.groundTruthLabel !== 1) return false;
      if (status === 'Confirmed Legitimate' && t.groundTruthLabel !== 0) return false;
      if (status === 'Unknown' && t.groundTruthLabel !== null) return false;
      const ts = Date.parse(t.timestamp);
      if (ts < fromMs || ts > toMs) return false;
      return true;
    });
    out.sort((a, b) => {
      const d = sortBy === 'timestamp' ? Date.parse(a.timestamp) - Date.parse(b.timestamp) : sortBy === 'amount' ? a.amount - b.amount : a.predictedProbability - b.predictedProbability;
      return order === 'asc' ? d : -d;
    });
    return out;
  }, [transactions, search, category, risk, status, from, to, sortBy, order, decisionThreshold]);

  // Back to page 1 when a filter, the sort or the source changes. Not on every live-buffer tick
  // (previously keyed on transactions.length, which bounced the user to page 1 every 3.2 s).
  useEffect(() => setPage(0), [search, category, risk, status, from, to, sortBy, order, resetKey]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const visible = rows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  // Keep a selected category visible in the dropdown even when the current source has no such rows,
  // so an active filter is never hidden behind an "All categories" label.
  const categoryOptions = category !== 'All' && !categories.includes(category) ? [...categories, category].sort() : categories;

  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setOrder(order === 'desc' ? 'asc' : 'desc');
    else { setSortBy(k); setOrder('desc'); }
  };
  const sortIcon = (k: SortKey) => (sortBy !== k ? <ArrowUpDown className="w-3 h-3 opacity-50" aria-hidden="true" /> : order === 'desc' ? <ArrowDown className="w-3 h-3 text-[#3988FF]" aria-hidden="true" /> : <ArrowUp className="w-3 h-3 text-[#3988FF]" aria-hidden="true" />);
  const ariaSort = (k: SortKey): React.AriaAttributes['aria-sort'] => (sortBy === k ? (order === 'desc' ? 'descending' : 'ascending') : 'none');
  const clearFilters = () => { setSearch(''); setCategory('All'); setRisk('All'); setStatus('All'); setFrom(''); setTo(''); };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
        <label className="col-span-2 md:col-span-3 relative block">
          <span className="sr-only">Search transactions</span>
          <Search className="w-4 h-4 cs-subtle absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ID, category, merchant, amount…" className="cs-input w-full !pl-9" />
        </label>
        <label className="md:col-span-2 text-xs cs-subtle block">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="cs-input w-full mt-0.5">
            <option value="All">All categories</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="md:col-span-2 text-xs cs-subtle block">
          Risk level
          <select value={risk} onChange={(e) => setRisk(e.target.value as RiskFilter)} className="cs-input w-full mt-0.5">
            <option value="All">All risk levels</option>
            <option value="High">High (≥ 70%)</option>
            <option value="Medium">Medium (30–70%)</option>
            <option value="Low">Low (&lt; 30%)</option>
          </select>
        </label>
        <label className="md:col-span-2 text-xs cs-subtle block">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="cs-input w-full mt-0.5">
            <option value="All">All statuses</option>
            <option value="Suspicious">Predicted · Suspicious</option>
            <option value="Legitimate">Predicted · Legitimate</option>
            <option value="Confirmed Fraud">Confirmed Fraud</option>
            <option value="Confirmed Legitimate">Confirmed Legitimate</option>
            <option value="Unknown">Pending / Unknown</option>
          </select>
        </label>
        <label className="md:col-span-1 text-xs cs-subtle block">
          From (UTC)
          <input type="date" value={from} min={bounds.min} max={bounds.max} onChange={(e) => setFrom(e.target.value)} className="cs-input w-full mt-0.5 !px-2" />
        </label>
        <label className="md:col-span-1 text-xs cs-subtle block">
          To (UTC)
          <input type="date" value={to} min={bounds.min} max={bounds.max} onChange={(e) => setTo(e.target.value)} className="cs-input w-full mt-0.5 !px-2" />
        </label>
        <button type="button" onClick={clearFilters} className="md:col-span-1 cs-btn cs-btn-secondary justify-center" aria-label="Clear all filters">
          <X className="w-3.5 h-3.5" aria-hidden="true" /> Clear
        </button>
      </div>

      <div className="flex items-center justify-between text-xs font-mono cs-subtle" aria-live="polite">
        <span>Showing {visible.length} of {rows.length.toLocaleString()} matching ({transactions.length.toLocaleString()} total)</span>
        <span>Amounts in USD · times in UTC</span>
      </div>

      <div className="overflow-x-auto rounded-xl border cs-divider">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="cs-th text-xs uppercase tracking-wider">
            <tr>
              <th scope="col" className="py-2.5 px-3" aria-sort={ariaSort('timestamp')}>
                <button type="button" onClick={() => toggleSort('timestamp')} className="inline-flex items-center gap-1 hover:underline">Transaction ID & time {sortIcon('timestamp')}</button>
              </th>
              <th scope="col" className="py-2.5 px-3">Merchant category</th>
              <th scope="col" className="py-2.5 px-3 text-right" aria-sort={ariaSort('amount')}>
                <button type="button" onClick={() => toggleSort('amount')} className="inline-flex items-center gap-1 hover:underline">Amount {sortIcon('amount')}</button>
              </th>
              <th scope="col" className="py-2.5 px-3" aria-sort={ariaSort('risk')}>
                <button type="button" onClick={() => toggleSort('risk')} className="inline-flex items-center gap-1 hover:underline">Fraud probability {sortIcon('risk')}</button>
              </th>
              <th scope="col" className="py-2.5 px-3">Predicted status</th>
              <th scope="col" className="py-2.5 px-3">Actual outcome</th>
              <th scope="col" className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y cs-divider">
            {visible.length === 0 ? (
              <tr><td colSpan={7}><EmptyState message="No transactions match the current filters." /></td></tr>
            ) : (
              visible.map((t) => {
                const Icon = categoryIcon(t.category);
                return (
                  <tr key={t.id} className="cs-row">
                    <td className="py-2.5 px-3 align-top">
                      <span className="font-mono font-semibold cs-text block">{t.id}</span>
                      <span className="font-mono text-xs cs-subtle block">{fmtDateTimeUtc(t.timestamp)}</span>
                      <span className="mt-1 inline-block"><OriginBadge origin={t.origin} /></span>
                    </td>
                    <td className="py-2.5 px-3 align-top">
                      <span className="inline-flex items-center gap-2">
                        <Icon className="w-4 h-4 cs-subtle" aria-hidden="true" />
                        <span className="cs-text">{t.category}</span>
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right align-top font-mono font-semibold tabular-nums cs-text whitespace-nowrap">
                      {fmtMoney(t.amount)} <span className="text-xs cs-subtle font-normal">USD</span>
                    </td>
                    <td className="py-2.5 px-3 align-top"><RiskMeter probability={t.predictedProbability} threshold={decisionThreshold} /></td>
                    <td className="py-2.5 px-3 align-top"><PredictionBadge probability={t.predictedProbability} threshold={decisionThreshold} compact /></td>
                    <td className="py-2.5 px-3 align-top"><OutcomeBadge label={t.groundTruthLabel} /></td>
                    <td className="py-2.5 px-3 align-top text-right">
                      <span className="inline-flex flex-wrap justify-end gap-1">
                      <button type="button" onClick={() => onInspect(t)} className="cs-btn cs-btn-secondary !py-1 !px-2" aria-label={`Details for ${t.id}`}>Details</button>
                      <button type="button" onClick={() => onExplain(t)} className="cs-btn !py-1 !px-2 border border-[#3988FF]/40 cs-accent hover:bg-[#3988FF]/10" aria-label={`Explain ${t.id}`}>
                        <Eye className="w-3 h-3" aria-hidden="true" /> Explain
                      </button>
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav className="flex items-center justify-end gap-2 text-xs" aria-label="Ledger pagination">
          <button type="button" className="cs-btn cs-btn-secondary !py-1 !px-2" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0} aria-label="Previous page">
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <span className="font-mono cs-muted">Page {safePage + 1} / {pages}</span>
          <button type="button" className="cs-btn cs-btn-secondary !py-1 !px-2" onClick={() => setPage(Math.min(pages - 1, safePage + 1))} disabled={safePage >= pages - 1} aria-label="Next page">
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
};
