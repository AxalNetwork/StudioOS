/**
 * #4574 H4: the recording timer and the theme hook, apart from RecordingView.jsx, so `RecordingPill` (mounted on every
 * signed-in page) loads these and not the whole recording view. `RecordingView` re-exports all three.
 */
import { useEffect, useState } from 'react';

/** ms → hh:mm:ss, as the canvas draws it (§5.7.2), the hour always shown. */
export function clock(ms) {
  const t = Math.max(0, Math.floor((ms || 0) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}
/** mm:ss, for a marked moment. */
export const short = (ms) => clock(ms).replace(/^00:/, '');

/** 'dark' or 'light', following the document's class as it changes. */
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
