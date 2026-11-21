/** D6397 (#6397): page-owned recorded tasks in the existing shared Ask panel. */
import { useEffect, useSyncExternalStore } from 'react';
const bodies = new Map();
const listeners = new Set();
const emit = () => listeners.forEach(listener => listener());
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
/** Registration follows the page's lifetime; a stale cleanup cannot remove its replacement. */
export function useRegisterAskPageBody(page, body) {
  useEffect(() => {
    if (!page || !body) return undefined;
    bodies.set(page, body); emit();
    return () => { if (bodies.get(page) === body) { bodies.delete(page); emit(); } };
  }, [page, body]);
}
export function useAskPageBody(page) {
  return useSyncExternalStore(subscribe, () => bodies.get(page) || null, () => null);
}
