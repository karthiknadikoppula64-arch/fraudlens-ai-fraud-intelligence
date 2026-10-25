import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Shared modal behaviour: initial focus (once per open, not on every parent re-render),
 * Escape to close, Tab / Shift+Tab kept inside the dialog, and focus returned to the
 * element that opened it. Background scrolling is locked while open.
 *
 * `onClose` is read through a ref, so callers can pass an inline arrow without the effect
 * re-running (previously each live-stream tick re-ran the effect and pulled focus back to
 * the close button).
 */
export function useDialog(open: boolean, containerRef: RefObject<HTMLElement | null>, initialFocusRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Lock background scrolling while the dialog is open (restored on close).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (initialFocusRef.current ?? containerRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !containerRef.current) return;
      const nodes = [...containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && containerRef.current.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // Return focus to the opener if it is still in the document.
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
