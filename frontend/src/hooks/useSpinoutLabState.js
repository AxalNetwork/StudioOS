import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { spinoutLab } from '../lib/api';
import { reportError } from '../lib/log';

// Routes that can advance a Spin-Out Lab milestone — landing on any of
// these re-pulls state so a freshly-completed milestone (and any
// auto-advanced week unlocks) appear without a hard refresh. Match by
// pathname prefix to cover nested routes like /projects/123,
// /build/discovery, /incorporate/wizard, etc.
const MILESTONE_ROUTE_PREFIXES = [
  '/spinout-lab',
  '/projects',
  '/build/discovery',
  '/build/roadmap',
  '/build/brand',
  '/build/deck',
  '/build/captable',
  '/scoring',
  '/mentors',
  '/office-hours',
  '/cofounder',
  '/incorporate',
];

/**
 * useSpinoutLabState
 * ------------------
 * Loads the Spin-Out Lab state (`/api/spinout-lab/state`) on mount and
 * exposes `{ state, loading, error, refresh }`. Used by `<SpinoutLabSidebar />`
 * so the unlocked-feature list re-renders the moment a milestone API
 * advances the founder's week — no hard refresh required.
 *
 * Refresh contract
 * ----------------
 * Other code (the milestone-hooks task) signals "a milestone just landed,
 * please re-pull state" by dispatching a window event:
 *
 *     window.dispatchEvent(new Event('spinout-lab:advanced'));
 *
 * This hook listens for that event and re-fetches. Callers can also call
 * the returned `refresh()` directly when they have the new state in hand
 * already and just want to push it through.
 */
export function useSpinoutLabState({ enabled = true } = {}) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(null);
  const location = useLocation();

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    setLoading(true);
    const p = (async () => {
      try {
        const next = await spinoutLab.state();
        setState(next);
        setError(null);
        return next;
      } catch (e) {
        reportError('useSpinoutLabState:refresh', e);
        setError(e);
        return null;
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = p;
    return p;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState(null);
      setLoading(false);
      return;
    }
    refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onAdvanced = () => { refresh(); };
    window.addEventListener('spinout-lab:advanced', onAdvanced);
    return () => window.removeEventListener('spinout-lab:advanced', onAdvanced);
  }, [enabled, refresh]);

  // Re-pull state when the founder lands on a route that can advance a
  // milestone (e.g. logging an interview on /build/discovery, running
  // scoring on /scoring, finishing /incorporate). Pathname-only — query
  // changes don't burn a refresh.
  useEffect(() => {
    if (!enabled) return;
    const path = location.pathname || '';
    if (MILESTONE_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
      refresh();
    }
  }, [enabled, location.pathname, refresh]);

  return { state, loading, error, refresh };
}
