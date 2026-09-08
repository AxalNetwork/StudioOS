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
  // KEPT after task #101 retired /projects: /projects/:id is still live
  // (ProjectDetail is deep-linked from six surfaces), and this is a pathname
  // PREFIX, so dropping it would stop refreshing lab state on the detail route
  // that survived.
  '/projects',
  // WAS five separate /build/* entries. /projects redirected to /build, which
  // was NOT among them — so creating a startup on the Build desk, where task
  // #101 moved the form, would have marked the `project_created` milestone and
  // then not refreshed the lab state that milestone advances. The bucket root
  // covers the desk and every zone under it, which is the same thing the five
  // entries were reaching for one route at a time.
  '/build',
  '/scoring',
  '/advisors',
  // /office-hours is retired and redirects to /practice/opportunities, which
  // is listed here in its place. A prefix that no longer resolves would stop
  // refreshing lab state on the surface that replaced it.
  '/practice',
  '/cofounder',
  '/incorporate',
];

/**
 * useSpinoutLabState
 * ------------------
 * Loads the Spin-Out Lab state (`/api/spinout-lab/state`) on mount and
 * exposes `{ state, loading, error, refresh }`. Used by lab surfaces
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
