import React, { useRef } from 'react';
import {
  LayoutDashboard,
  Activity,
  BarChart2,
  Sparkles,
  TrendingUp,
  Clock,
  Users,
  BookOpen,
  Info,
  ShieldCheck,
  Sun,
  Moon,
  X,
  Play,
  Pause,
  Database,
  ClipboardCheck,
} from 'lucide-react';
import { useDialog } from '../state/useDialog';
import { NAV_GROUPS, ROUTES, PRODUCT_TITLE, APP_NAME, TAGLINE, type NavTabId } from '../routes';

export type { NavTabId } from '../routes';

interface SidebarProps {
  activeTab: NavTabId;
  setActiveTab: (tab: NavTabId) => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
  darkMode: boolean;
  setDarkMode: (dark: boolean) => void;
  streamRunning: boolean;
  onToggleStream: () => void;
  alertsCount: number;
}

const ICONS: Record<NavTabId, React.ElementType> = {
  overview: LayoutDashboard,
  dataset: Database,
  stream: Activity,
  manual: ClipboardCheck,
  models: BarChart2,
  shap: Sparkles,
  drift: TrendingUp,
  delayed: Clock,
  queue: Users,
  methodology: BookOpen,
  about: Info,
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  isMobileOpen,
  setIsMobileOpen,
  darkMode,
  setDarkMode,
  streamRunning,
  onToggleStream,
  alertsCount,
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  // Mobile drawer: focus the close button on open, Escape closes, Tab stays inside, focus returns to the menu button.
  useDialog(isMobileOpen, asideRef, closeRef, () => setIsMobileOpen(false));

  const handleSelect = (id: NavTabId) => {
    setActiveTab(id);
    setIsMobileOpen(false);
  };

  return (
    <>
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setIsMobileOpen(false)} aria-hidden="true" />
      )}

      <aside
        ref={asideRef}
        id="app-sidebar"
        aria-label="Primary"
        className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col border-r transition-transform duration-200 ease-out md:translate-x-0 ${
          isMobileOpen ? 'translate-x-0 visible' : '-translate-x-full invisible md:visible'
        } bg-white border-slate-200 dark:bg-[#0B1220] dark:border-[#173B70]/60`}
      >
        {/* Brand */}
        <div className="px-4 py-4 flex items-start justify-between border-b cs-divider">
          <a
            href={ROUTES.overview.path}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              handleSelect('overview');
            }}
            className="flex items-center gap-3 rounded-xl group transition-opacity hover:opacity-95"
          >
            <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-[#102A4E] to-[#0B1220] border border-[#3988FF]/40 shadow-sm flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-[#3988FF]" aria-hidden="true" />
              <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10 pointer-events-none" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-[#3988FF] dark:text-[#6AA8FF]">{PRODUCT_TITLE}</span>
              <span className="block text-lg font-extrabold tracking-tight cs-text leading-tight">{APP_NAME}</span>
              <span className="block text-[10px] cs-subtle leading-tight mt-0.5 truncate">Intelligent · Explainable · Real-Time</span>
            </div>
          </a>
          <button
            ref={closeRef}
            type="button"
            onClick={() => setIsMobileOpen(false)}
            className="md:hidden min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg cs-muted hover:bg-slate-100 dark:hover:bg-[#173B70]/40"
            aria-label="Close navigation menu"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Stream status beacon */}
        <div className="mx-3 mt-3 mb-2 cs-inset px-3 py-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-2">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              {streamRunning && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${streamRunning ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            </span>
            <span className="font-mono text-xs cs-muted" aria-live="polite">
              {streamRunning ? 'Stream: running' : 'Stream: paused'}
            </span>
          </span>
          <button
            type="button"
            onClick={onToggleStream}
            aria-label={streamRunning ? 'Pause live stream' : 'Resume live stream'}
            className="min-w-[44px] min-h-[44px] -my-2 inline-flex items-center justify-center rounded-md cs-muted hover:bg-slate-200 dark:hover:bg-[#173B70]/60 transition-colors"
          >
            {streamRunning ? (
              <Pause className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Play className="w-3.5 h-3.5 text-[#3988FF]" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-1 overflow-y-auto" aria-label="Main navigation">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className={group.secondary ? 'mt-4 pt-3 border-t cs-divider' : 'mt-2 first:mt-0'} role="group" aria-labelledby={`nav-group-${group.id}`}>
              <p id={`nav-group-${group.id}`} className={`px-3 mb-1 font-bold uppercase tracking-[0.12em] cs-subtle ${group.secondary ? 'text-xs' : 'text-xs'}`}>{group.label}</p>
              <ul className="space-y-0.5">
                {group.items.map((id) => {
                  const Icon = ICONS[id];
                  const isActive = activeTab === id;
                  const badge = id === 'stream' && alertsCount > 0 ? `${alertsCount}` : undefined;
                  return (
                    <li key={id}>
                      <a
                        href={ROUTES[id].path}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                          e.preventDefault();
                          handleSelect(id);
                        }}
                        aria-current={isActive ? 'page' : undefined}
                        className={`group flex items-center justify-between px-3 ${group.secondary ? 'py-1.5 text-[12px]' : 'py-2 text-[13px]'} rounded-xl font-medium transition-colors border ${
                          isActive
                            ? 'bg-[#3988FF]/10 border-[#3988FF]/30 text-[#173B70] dark:text-white dark:bg-[#173B70]/45 dark:border-[#3988FF]/40'
                            : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-[#173B70]/25'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`${group.secondary ? 'w-3.5 h-3.5' : 'w-4 h-4'} shrink-0 ${isActive ? 'text-[#3988FF]' : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'}`} aria-hidden="true" />
                          <span className="truncate">{ROUTES[id].navLabel}</span>
                        </span>
                        {badge && (
                          <span className="px-1.5 py-0.5 rounded text-xs font-mono font-semibold bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" aria-label={`${badge} flagged transactions in stream buffer`}>
                            {badge}
                          </span>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t cs-divider space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="cs-muted" id="theme-label">Theme</span>
            <button type="button"
              onClick={() => setDarkMode(!darkMode)}
              className="cs-btn cs-btn-secondary !py-1 !px-2.5"
              aria-label="Dark theme"
              aria-pressed={darkMode}
              title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" /> : <Moon className="w-3.5 h-3.5" aria-hidden="true" />}
              <span className="text-xs">{darkMode ? 'Dark' : 'Light'}</span>
            </button>
          </div>
          <p className="text-xs leading-relaxed cs-subtle">{TAGLINE}</p>
        </div>
      </aside>
    </>
  );
};
