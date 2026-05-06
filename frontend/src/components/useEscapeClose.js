import { useEffect } from 'react';

// T21 — Bind window keydown so Escape calls onClose. Cleans up on unmount,
// so opening + closing the same modal repeatedly never accumulates listeners.
// Pass a stable onClose (useCallback-wrapped) to avoid re-binding on every
// render.
export function useEscapeClose(onClose) {
  useEffect(() => {
    if (typeof onClose !== 'function') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}
