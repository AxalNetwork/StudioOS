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
const DEFAULTS = { theme: 'system', density: 'comfy', sidebar_default: 'expanded' };

const SettingsContext = createContext({
  appearance: DEFAULTS,
  effectiveTheme: 'light',
  loading: true,
  refresh: async () => {},
  setAppearance: async () => {},
});

function applyTheme(theme) {
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effective = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = effective;
  document.documentElement.classList.toggle('dark', effective === 'dark');
  return effective;
}
function applyDensity(density) {
  document.documentElement.dataset.density = density === 'compact' ? 'compact' : 'comfy';
}

export function SettingsProvider({ children }) {
  const cached = safeReadJSON(STORAGE_KEY, DEFAULTS);
  const [appearance, setAppearanceState] = useState({ ...DEFAULTS, ...cached });
  const [effectiveTheme, setEffectiveTheme] = useState(() => applyTheme(cached.theme || 'system'));
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  // Apply on every change.
  useEffect(() => {
    setEffectiveTheme(applyTheme(appearance.theme || 'system'));
    applyDensity(appearance.density || 'comfy');
  }, [appearance.theme, appearance.density]);

  // Live OS-theme follow when theme=system.
  useEffect(() => {
    if (appearance.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setEffectiveTheme(applyTheme('system'));
    try { mq.addEventListener('change', onChange); }
    catch { mq.addListener(onChange); } // Safari < 14
    return () => {
      try { mq.removeEventListener('change', onChange); }
      catch { mq.removeListener(onChange); }
    };
  }, [appearance.theme]);

  const refresh = useCallback(async () => {
    try {
      const res = await api.getAppearanceSettings();
      if (!mountedRef.current) return;
      const next = { ...DEFAULTS, ...res };
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
