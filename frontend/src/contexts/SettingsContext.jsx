/**
 * Global Light/Dark appearance preference.
 *
 * Cached locally for the first paint, then refreshed from
 * /api/settings/appearance. Legacy density and sidebar fields returned by
 * older clients/the API are deliberately excluded from browser state.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { safeReadJSON, safeWriteJSON } from '../lib/storage';

const STORAGE_KEY = 'axal_appearance_v1';
const DEFAULTS = { theme: 'light' };

// Legacy 'system' values from the previous tri-state picker collapse to
// 'light' so we never re-apply OS-theme follow after the option was removed.
function normalizeTheme(t) {
  return t === 'dark' ? 'dark' : 'light';
}

const SettingsContext = createContext({
  appearance: DEFAULTS,
  effectiveTheme: 'light',
  loading: true,
  refresh: async () => {},
  setAppearance: async () => {},
});

function applyTheme(theme) {
  // Auth/marketing surfaces that call useForcedLightTheme() pin light mode for
  // their mount lifetime. Without this guard SettingsContext re-applies the
  // user's saved dark theme on every appearance refresh — a DOM flip on /login
  // that Safari treats as instability when stacked with reload recovery.
  if (document.documentElement.dataset.axalForcedTheme === 'light') {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.classList.remove('dark');
    return 'light';
  }
  const effective = normalizeTheme(theme);
  document.documentElement.dataset.theme = effective;
  document.documentElement.classList.toggle('dark', effective === 'dark');
  return effective;
}
export function SettingsProvider({ children }) {
  const cachedRaw = safeReadJSON(STORAGE_KEY, DEFAULTS);
  const cached = { theme: normalizeTheme(cachedRaw?.theme) };
  const [appearance, setAppearanceState] = useState(cached);
  const [effectiveTheme, setEffectiveTheme] = useState(() => applyTheme(cached.theme));
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  // Apply on every change.
  useEffect(() => {
    setEffectiveTheme(applyTheme(appearance.theme));
  }, [appearance.theme]);

  const refresh = useCallback(async () => {
    try {
      const res = await api.getAppearanceSettings();
      if (!mountedRef.current) return;
      const next = { theme: normalizeTheme(res?.theme) };
      setAppearanceState(next);
      safeWriteJSON(STORAGE_KEY, next);
    } catch {
      // Unauthenticated / network — keep cached values.
    } finally {
      if (mountedRef.current) setLoading(false);
    }
    // Task #15 — hydrate the page-explainer dismiss-list from the server.
    // localStorage is a read cache; server is source of truth so dismissals
    // roam across devices. Failure is silent (unauth / offline).
    try {
      const ex = await api.getExplainersDismissed();
      if (!mountedRef.current) return;
      const list = Array.isArray(ex?.dismissed) ? ex.dismissed : [];
      try { localStorage.setItem('dismissed_explainers', JSON.stringify(list)); } catch {}
      try { window.dispatchEvent(new CustomEvent('axal:explainers_synced')); } catch {}
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const setAppearance = useCallback(async (delta) => {
    const next = { theme: normalizeTheme(delta?.theme ?? appearance.theme) };
    setAppearanceState(next);
    safeWriteJSON(STORAGE_KEY, next);
    try {
      const res = await api.updateAppearanceSettings(next);
      const merged = { theme: normalizeTheme(res?.theme ?? next.theme) };
      setAppearanceState(merged);
      safeWriteJSON(STORAGE_KEY, merged);
      return merged;
    } catch (e) {
      // Roll back on failure so the UI matches what's actually persisted.
      setAppearanceState(appearance);
      safeWriteJSON(STORAGE_KEY, appearance);
      throw e;
    }
  }, [appearance]);

  return (
    <SettingsContext.Provider value={{ appearance, effectiveTheme, loading, refresh, setAppearance }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
