/**
 * Task #4 (ID) — Per-page SEO + OpenGraph helper.
 *
 * Lightweight document.head meta manager — no react-helmet dependency.
 * Mount via the `usePageMeta()` hook in any public marketing page; it
 * sets <title>, description, OG, and Twitter Card tags on mount and
 * restores the previous values on unmount so navigating between pages
 * leaves the head clean for SSR/crawler snapshots.
 *
 * Also fires a privacy-friendly first-party analytics beacon via
 * navigator.sendBeacon to /api/public/analytics/pageview. The endpoint
 * is best-effort: failures are swallowed so analytics never block the
 * render. No third-party trackers, no cookies, no PII.
 */
import { useEffect } from 'react';

const SITE_NAME = 'Axal StudioOS';
const SITE_URL = 'https://axal.vc';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

function setMeta(selector, attr, value) {
  if (typeof document === 'undefined') return null;
  let el = document.head.querySelector(selector);
  const created = !el;
  if (!el) {
    el = document.createElement('meta');
    const [, kind, name] = selector.match(/meta\[(name|property)="([^"]+)"\]/) || [];
    if (kind && name) el.setAttribute(kind, name);
    document.head.appendChild(el);
  }
  const prev = el.getAttribute(attr) || '';
  el.setAttribute(attr, value);
  return { el, prev, created };
}

function fireAnalytics(path) {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  try {
    const body = JSON.stringify({
      path,
      referrer: document.referrer || '',
      ts: Date.now(),
    });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/public/analytics/pageview', blob);
    } else {
      // Fallback for environments without sendBeacon — fire-and-forget fetch.
      fetch('/api/public/analytics/pageview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* analytics is best-effort; swallow all errors */
  }
}

export function usePageMeta({ title, description, path, image }) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const prevTitle = document.title;
    const fullTitle = title ? `${title} — ${SITE_NAME}` : SITE_NAME;
    const url = `${SITE_URL}${path || (typeof window !== 'undefined' ? window.location.pathname : '/')}`;
    const ogImage = image || DEFAULT_OG_IMAGE;

    document.title = fullTitle;
    const refs = [
      setMeta('meta[name="description"]', 'content', description || ''),
      setMeta('meta[property="og:title"]', 'content', fullTitle),
      setMeta('meta[property="og:description"]', 'content', description || ''),
      setMeta('meta[property="og:type"]', 'content', 'website'),
      setMeta('meta[property="og:url"]', 'content', url),
      setMeta('meta[property="og:image"]', 'content', ogImage),
      setMeta('meta[property="og:site_name"]', 'content', SITE_NAME),
      setMeta('meta[name="twitter:card"]', 'content', 'summary_large_image'),
      setMeta('meta[name="twitter:title"]', 'content', fullTitle),
      setMeta('meta[name="twitter:description"]', 'content', description || ''),
      setMeta('meta[name="twitter:image"]', 'content', ogImage),
    ].filter(Boolean);

    // Fire pageview beacon once per mount.
    fireAnalytics(path || window.location.pathname);

    return () => {
      document.title = prevTitle;
      // Restore previous values; if we created the tag, remove it.
      refs.forEach((r) => {
        if (!r) return;
        if (r.created) r.el.remove();
        else r.el.setAttribute('content', r.prev);
      });
    };
  }, [title, description, path, image]);
}

export function injectJsonLd(id, payload) {
  if (typeof document === 'undefined') return () => {};
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = id;
  script.textContent = JSON.stringify(payload);
  document.head.appendChild(script);
  return () => script.remove();
}
