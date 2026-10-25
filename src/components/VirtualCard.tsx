import React from 'react';

/**
 * Decorative demo payment card. Generic shapes only – no real card-network logos or names.
 * The number is a fixed masked placeholder; no real card data is ever collected or displayed.
 */
export const VirtualCard: React.FC<{ balanceLabel?: string; balance?: string }> = ({ balanceLabel = 'Demo balance', balance = '$12,480.00' }) => (
  <figure
    className="relative rounded-2xl p-5 sm:p-6 overflow-hidden text-white bg-gradient-to-br from-[#0B1528] via-[#102347] to-[#070D18] border border-[#3988FF]/35 shadow-xl min-h-[220px] flex flex-col justify-between transition-transform duration-200 hover:scale-[1.01]"
    aria-label="Demo card – not a real account. Masked number ending 4242."
  >
    {/* Subtle decorative security guilloche arcs */}
    <svg className="absolute -right-16 -top-16 w-80 h-80 opacity-30 pointer-events-none" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="92" fill="none" stroke="#173B70" strokeWidth="24" />
      <circle cx="100" cy="100" r="65" fill="none" stroke="#3988FF" strokeOpacity="0.45" strokeWidth="2.5" />
      <circle cx="100" cy="100" r="40" fill="none" stroke="#3988FF" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="4 4" />
    </svg>

    <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 pointer-events-none" aria-hidden="true" />

    <div className="relative flex items-start justify-between">
      <div className="flex items-center gap-3.5">
        {/* Precision microchip */}
        <div className="relative">
          <svg width="44" height="34" viewBox="0 0 44 34" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="42" height="32" rx="6" fill="url(#chip-grad)" stroke="#D4AF37" strokeWidth="1" />
            <path d="M1 12h14M1 22h14M29 12h14M29 22h14M15 1v32M29 1v32M15 17h14" stroke="#997A15" strokeWidth="1.2" strokeOpacity="0.8" />
            <rect x="18" y="10" width="8" height="14" rx="2" fill="#D4AF37" fillOpacity="0.3" stroke="#997A15" strokeWidth="0.8" />
            <defs>
              <linearGradient id="chip-grad" x1="0" y1="0" x2="44" y2="34" gradientUnits="userSpaceOnUse">
                <stop stopColor="#F5D77F" />
                <stop offset="1" stopColor="#C49B2C" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        {/* Contactless waves */}
        <svg width="22" height="24" viewBox="0 0 22 24" aria-hidden="true">
          <path d="M5 7c2 3.5 2 7 0 10M9.5 4.5c3.5 5 3.5 11 0 16M14 2c5 6.5 5 14.5 0 21" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      {/* Abstract payment network security glyphs */}
      <div className="flex items-center">
        <svg width="48" height="30" viewBox="0 0 48 30" aria-hidden="true">
          <circle cx="17" cy="15" r="13" fill="#2563EB" fillOpacity="0.9" />
          <circle cx="31" cy="15" r="13" fill="#173B70" fillOpacity="0.95" stroke="#3988FF" strokeOpacity="0.7" strokeWidth="1" />
        </svg>
      </div>
    </div>

    <div className="relative mt-2">
      <span className="inline-block px-2.5 py-0.5 rounded-md bg-amber-400/15 border border-amber-400/35 text-amber-200 text-[11px] font-mono font-bold tracking-wider">
        DEMO CARD — NO REAL ACCOUNT
      </span>
    </div>

    <div className="relative font-mono text-xl sm:text-2xl font-bold tracking-[0.22em] text-white mt-2 drop-shadow-sm">
      •••• •••• •••• 4242
    </div>

    <figcaption className="relative flex items-end justify-between pt-3 mt-2 border-t border-white/10 text-xs">
      <div>
        <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-mono">Cardholder</span>
        <span className="font-semibold text-slate-200 font-mono tracking-wider text-xs">FRAUDLENS DEMO ACCOUNT</span>
      </div>
      <div className="text-right">
        <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-mono">{balanceLabel}</span>
        <span className="font-semibold text-slate-100 font-mono text-xs">{balance}</span>
      </div>
    </figcaption>
  </figure>
);
