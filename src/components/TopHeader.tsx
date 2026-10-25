import React from 'react';
import { Menu, Download, Play, Pause, Sun, Moon, ChevronRight, Database, Upload, Loader2 } from 'lucide-react';
import { ROUTES, PRODUCT_TITLE, APP_NAME, type NavTabId } from '../routes';
import type { ModelName } from '../types/fraud';

interface TopHeaderProps {
  activeTab: NavTabId;
  onOpenMobileMenu: () => void;
  isMobileOpen: boolean;
  streamRunning: boolean;
  onToggleStream: () => void;
  onExportReport: () => void;
  activeModelName: ModelName;
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
  onOpenUploadModal?: () => void;
  activeDatasetName?: string;
  isSynthetic?: boolean;
  training?: boolean;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  activeTab,
  onOpenMobileMenu,
  isMobileOpen,
  streamRunning,
  onToggleStream,
  onExportReport,
  activeModelName,
  darkMode,
  setDarkMode,
  onOpenUploadModal,
  activeDatasetName = '',
  isSynthetic,
  training,
}) => {
  const meta = ROUTES[activeTab] ?? ROUTES.overview;

  return (
    <header className="sticky top-0 z-30 border-b backdrop-blur-md bg-white/90 border-slate-200 dark:bg-[#0B1220]/90 dark:border-[#173B70]/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onOpenMobileMenu}
              className="md:hidden p-2 rounded-xl border cs-divider cs-muted hover:bg-slate-100 dark:hover:bg-[#173B70]/40"
              aria-label="Open navigation menu"
              aria-controls="app-sidebar"
              aria-expanded={isMobileOpen}
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex items-center gap-1.5 text-xs font-mono cs-subtle min-w-0">
                <li className="hidden sm:block font-semibold cs-muted">{PRODUCT_TITLE}</li>
                <li className="hidden sm:block" aria-hidden="true">/</li>
                <li className="font-semibold cs-accent shrink-0">{APP_NAME}</li>
                <li aria-hidden="true" className="shrink-0"><ChevronRight className="w-3 h-3" /></li>
                <li className="truncate min-w-0 cs-muted" aria-current="page" title={meta.title}>{meta.title}</li>
              </ol>
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenUploadModal && (
              <button
                type="button"
                onClick={onOpenUploadModal}
                className="hidden md:inline-flex cs-btn cs-btn-secondary !py-1.5 font-mono !font-medium hover:border-[#3988FF]/60"
                title="Active dataset – click to upload a CSV or load the synthetic sample"
                aria-label={`Active dataset: ${activeDatasetName}. Open dataset upload`}
              >
                <Database className="w-3.5 h-3.5 text-[#3988FF]" aria-hidden="true" />
                <span className="max-w-[150px] truncate cs-accent font-semibold">{isSynthetic ? 'Synthetic sample' : activeDatasetName}</span>
                <Upload className="w-3 h-3 cs-subtle" aria-hidden="true" />
              </button>
            )}

            <span className="hidden lg:inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono cs-inset border border-slate-200/80 dark:border-[#173B70]/70" title="Active trained model">
              {training ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#3988FF]" aria-hidden="true" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-xs" aria-hidden="true" />
              )}
              <span className="cs-subtle">Model:</span>
              <strong className="cs-accent">{training ? 'training…' : activeModelName}</strong>
            </span>

            <button
              type="button"
              onClick={onToggleStream}
              className={`cs-btn !py-1.5 transition-all shadow-xs ${
                streamRunning
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/40'
                  : 'cs-btn-primary'
              }`}
              aria-label={streamRunning ? 'Pause live stream' : 'Resume live stream'}
            >
              {streamRunning ? <Pause className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <Play className="w-3.5 h-3.5 text-white" aria-hidden="true" />}
              <span className="hidden sm:inline font-semibold">{streamRunning ? 'Pause' : 'Resume'}</span>
            </button>

            <button type="button" onClick={onExportReport} className="cs-btn cs-btn-secondary !py-1.5" aria-label="Export JSON audit report">
              <Download className="w-3.5 h-3.5 cs-subtle" aria-hidden="true" />
              <span className="hidden sm:inline">Export Audit</span>
            </button>

            <button
              type="button"
              onClick={() => setDarkMode(!darkMode)}
              className="hidden sm:inline-flex cs-btn cs-btn-secondary !p-2"
              aria-label="Dark theme"
              aria-pressed={darkMode}
              title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" /> : <Moon className="w-4 h-4 text-slate-700" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
