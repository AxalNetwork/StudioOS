import { useEffect, useState } from 'react';

/**
 * #4574 (H4): the two helpers the always-mounted recording pill needs, in a file of their own. The pill used to import
 * them from RecordingView.jsx, which put the whole full-screen Recording View in every visitor's first download.
 * RecordingView.jsx re-exports both, so its importers are unchanged.
 */

/** hh:mm:ss, for the running timer. */
export function clock(ms) {
  const t = Math.max(0, Math.floor((ms || 0) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}

/** 'dark' while the page is in dark mode, following the class on <html>. */
export function useDarkTheme() {
  const read = () => typeof document !== 'undefined' && !!document.documentElement?.classList?.contains?.('dark');
  const [dark, setDark] = useState(read);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const o = new MutationObserver(() => setDark(read()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => o.disconnect();
  }, []);
  return dark ? 'dark' : 'light';
}
