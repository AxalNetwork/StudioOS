import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { safeReadJSON } from '../lib/storage';

/**
 * T20 — Auth re-sync on navigation.
 *
 * The React app holds the signed-in user in memory; without a refresh path
 * a server-side role change (admin promotes a partner to investor, KYC
 * is approved, access_level flips, etc.) is invisible until the next hard
 * reload. AuthProvider owns the canonical `user` (mirrored to localStorage
 * for cross-tab continuity and the legacy `safeReadJSON('user')` reads
 * scattered through the codebase) and re-fetches `/api/auth/me` on route
 * changes, throttled to once per `THROTTLE_MS`. Callers that know they
 * just mutated the session (impersonation start/stop, login, KYC submit)
 * can call `refresh({ force: true })` to bypass the throttle.
 *
 * What this is *not*: a real-time push of role changes (that would need
 * a WebSocket subscription) and not a tab-focus refresher (could be a
 * follow-up). Those are explicitly out of scope per the task spec.
 */

const THROTTLE_MS = 5 * 60 * 1000;

const AuthCtx = createContext({
  user: null,
  role: null,
  loading: false,
  refresh: async () => {},
  setUser: () => {},
});

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(() => safeReadJSON('user'));
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(null);
  const location = useLocation();

  // Wrap setUser so localStorage stays consistent. Callers like
  // handleImpersonate / login still write to localStorage themselves
  // (legacy behaviour) — this also accepts a plain object so context
  // and storage stay in lock-step when the caller goes through here.
  const setUser = useCallback((next) => {
    setUserState(next);
    try {
      if (next) localStorage.setItem('user', JSON.stringify(next));
      else localStorage.removeItem('user');
    } catch { /* quota / disabled storage — context still updates */ }
  }, []);

  const refresh = useCallback(async ({ force = false } = {}) => {
    // Gate on cached `user` presence rather than token/cookie readability.
    // T6 makes `studioos_auth` an httpOnly cookie (not visible to JS), so
    // checking `document.cookie` would skip /me for every cookie-auth
    // session. Pages that load *without* any cached user are either
    // public (no /me needed) or the route guard will redirect to /login
    // before this fires; if /me 401s anyway, api.request bounces to
    // /login on its own.
    const hasCachedUser = !!safeReadJSON('user');
    if (!hasCachedUser) return;

    const now = Date.now();
    if (!force && now - lastFetchRef.current < THROTTLE_MS) return;

    // Coalesce concurrent calls (e.g. two route changes inside the
    // same React tick) so we don't fire a flood of /me requests.
    if (inFlightRef.current) return inFlightRef.current;

    lastFetchRef.current = now;
    setLoading(true);
    const p = (async () => {
      try {
        const me = await api.getMe();
        const stored = safeReadJSON('user', {}) || {};
        const merged = { ...stored, ...me };
        try { localStorage.setItem('user', JSON.stringify(merged)); } catch { /* ignore */ }
        setUserState(merged);
      } catch {
        // 401 is already handled by api.request (redirects to /login).
        // Other errors are transient — keep the cached user.
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = p;
    return p;
  }, []);

  // Re-sync on every route change (throttled). Using pathname as the key
  // is intentional — query-only changes (e.g. ?status=open filter swaps)
  // shouldn't burn a /me call.
  useEffect(() => {
    refresh();
  }, [location.pathname, refresh]);

  // Cross-tab sync: another tab logging in/out updates localStorage; mirror
  // it here so tabs stay consistent without a reload.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'user') {
        setUserState(safeReadJSON('user'));
        // Reset the throttle so a freshly-restored session re-validates
        // against the server on the next navigation.
        lastFetchRef.current = 0;
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = {
    user,
    role: user?.role || null,
    loading,
    refresh,
    setUser,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
