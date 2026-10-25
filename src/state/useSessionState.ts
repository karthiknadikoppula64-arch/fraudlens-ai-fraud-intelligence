import { useCallback, useState } from 'react';

/**
 * In-memory UI state that survives a page component unmounting (navigating away and back)
 * but not a reload. Used for view selections such as the chosen delayed-label horizon,
 * analytics tab or ledger source. Never used for data, labels or anything that feeds a model.
 */
const store = new Map<string, unknown>();

export function useSessionState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        store.set(key, next);
        return next;
      });
    },
    [key]
  );
  return [value, set];
}

/** Clears every stored view selection (used when a new dataset is activated). */
export function clearSessionState(prefix = '') {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
