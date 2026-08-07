import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface UseOverlayDialogOptions {
  rootRef: RefObject<HTMLElement | null>;
  onClose?: () => void;
  /** Optional trap container; defaults to rootRef.current. Useful for nested dialogs. */
  getTrapRoot?: () => HTMLElement | null;
}

/**
 * Modal overlay keyboard behavior:
 * - Escape closes the overlay (and skips closing when the user is in a nested dialog).
 * - Focus moves into the overlay on open and returns to the trigger on close.
 * - Tab / Shift+Tab are trapped inside the overlay (or the nested trap root).
 */
export function useOverlayDialog({ rootRef, onClose, getTrapRoot }: UseOverlayDialogOptions) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const getTrapRootRef = useRef(getTrapRoot);
  getTrapRootRef.current = getTrapRoot;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusable = (container: HTMLElement) =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((el) => el.getClientRects().length > 0 || el === document.activeElement);

    const first = focusable(root)[0];
    if (first) first.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const trapRoot = getTrapRootRef.current?.() ?? rootRef.current;
      if (!trapRoot) return;
      const items = focusable(trapRoot);
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const activeInside = trapRoot.contains(document.activeElement);
      if (event.shiftKey && (!activeInside || document.activeElement === firstEl)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && (!activeInside || document.activeElement === lastEl)) {
        event.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [rootRef]);
}
