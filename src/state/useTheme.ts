import { useCallback, useEffect, useState } from 'react';

const KEY = 'fraudlens_theme';
const LEGACY_KEY = 'chronosentry_theme';

function readStored(): 'dark' | 'light' | null {
  try {
    const v = window.localStorage.getItem(KEY) || window.localStorage.getItem(LEGACY_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null; // storage unavailable (privacy mode, sandboxed iframe)
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

/** Class-based theme: persisted in localStorage when available, otherwise follows prefers-color-scheme. */
export function useTheme(): [boolean, (dark: boolean) => void] {
  const [darkMode, setDarkModeState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = readStored();
    return stored ? stored === 'dark' : systemPrefersDark();
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Follow OS changes until the user picks a theme explicitly.
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => {
      if (!readStored()) setDarkModeState(e.matches);
    };
    mq.addEventListener?.('change', onChange);
    return () => mq?.removeEventListener?.('change', onChange);
  }, []);

  const setDarkMode = useCallback((dark: boolean) => {
    setDarkModeState(dark);
    try {
      window.localStorage.setItem(KEY, dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, []);

  return [darkMode, setDarkMode];
}
