/**
 * Task #20 — Phase B · Prompt 6 — global appearance settings.
 *
 * Reads from /api/settings/appearance once on mount (and again whenever a
 * tab calls `refresh()` after saving). Applies theme/density/sidebar via:
 *
 *   - <html data-theme="light|dark"> (Tailwind .dark class also toggled)
 *   - <html data-density="comfy|compact">
 *
 * Theme=`system` follows `prefers-color-scheme` and updates live as the
 * OS toggles. Cached to localStorage so the first paint matches the
 * user's last-saved choice (avoids the flash of unstyled theme on cold
 * page-load before /api/settings/appearance returns).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { safeReadJSON, safeWriteJSON } from '../lib/storage';

const STORAGE_KEY = 'axal_appearance_v1';
const DEFAULTS = { theme: 'light', density: 'comfy', sidebar_default: 'expanded' };

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
  const effective = normalizeTheme(theme);
  document.documentElement.dataset.theme = effective;
  document.documentElement.classList.toggle('dark', effective === 'dark');
  return effective;
}
function applyDensity(density) {
  document.documentElement.dataset.density = density === 'compact' ? 'compact' : 'comfy';
}

export function SettingsProvider({ children }) {
  const cachedRaw = safeReadJSON(STORAGE_KEY, DEFAULTS);
  const cached = { ...DEFAULTS, ...cachedRaw, theme: normalizeTheme(cachedRaw?.theme) };
  const [appearance, setAppearanceState] = useState(cached);
  const [effectiveTheme, setEffectiveTheme] = useState(() => applyTheme(cached.theme));
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  // Apply on every change.
  useEffect(() => {
    setEffectiveTheme(applyTheme(appearance.theme));
    applyDensity(appearance.density || 'comfy');
  }, [appearance.theme, appearance.density]);

  const refresh = useCallback(async () => {
    try {
      const res = await api.getAppearanceSettings();
      if (!mountedRef.current) return;
      const next = { ...DEFAULTS, ...res, theme: normalizeTheme(res?.theme) };
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
    const next = { ...appearance, ...delta };
    setAppearanceState(next);
    safeWriteJSON(STORAGE_KEY, next);
    try {
      const res = await api.updateAppearanceSettings(delta);
      const merged = { ...next, ...res };
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
