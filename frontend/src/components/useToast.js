import { useState, useCallback, useEffect, useRef } from 'react';

// T19 + T21 — Shared toast hook.
// - Auto-dismisses after `defaultMs` (default 4000).
// - ALWAYS clears its timeout on unmount so we never `setState` after the
//   component is gone (the inline `setTimeout(() => setToast(''), 2500)`
//   pattern leaked across IntegrationsPage / AdminPage / CapTablePage).
// - showToast(msg) and showToast({ kind, msg }) are both supported so the
//   call sites can keep their existing payload shape.
export function useToast(defaultMs = 4000) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showToast = useCallback((payload, ms) => {
    clear();
    setToast(payload);
    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, ms ?? defaultMs);
  }, [clear, defaultMs]);

  const dismissToast = useCallback(() => {
    clear();
    setToast(null);
  }, [clear]);

  // Convenience aliases. Many admin pages were written against an older
  // toast API (`toast.success(msg)` / `toast.error(msg)`); without these,
  // every success/error path threw TypeError, silently breaking reloads
  // (e.g. AdminTelegram aggregator runs left the drafts list stale and
  // channel signature/chat_id saves never re-fetched). These wrap
  // showToast so the toast renderer's shape (`{ kind, msg }`) is preserved.
  const success = useCallback((msg, ms) => {
    showToast({ kind: 'success', msg: typeof msg === 'string' ? msg : msg?.msg ?? '' }, ms);
  }, [showToast]);

  const error = useCallback((msg, ms) => {
    showToast({ kind: 'error', msg: typeof msg === 'string' ? msg : msg?.msg ?? '' }, ms);
  }, [showToast]);

  useEffect(() => clear, [clear]);

  return { toast, showToast, dismissToast, success, error };
}
