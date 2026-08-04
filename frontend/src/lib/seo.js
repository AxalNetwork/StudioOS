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
import { ogTagsFor, SITE_NAME, SITE_URL } from './ogRegistry';

export { SITE_NAME, SITE_URL };

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

/**
 * Apply a route's metadata to document.head.
 *
 * IMPORTANT — this is a progressive enhancement, NOT the fix for link previews.
 * Crawlers (WhatsApp, iMessage, Facebook, LinkedIn, Slack) do not execute
 * JavaScript, so nothing this hook does is ever visible to them. What they read
 * is the prerendered `<head>` that `scripts/prerender-og.mjs` bakes into each
 * route at build time.
 *
 * The hook still matters for humans: it keeps the browser tab title and the
 * in-app history correct during client-side navigation, where no new document
 * is fetched. It resolves through the same `ogTagsFor()` the prerender uses, so
 * a client-side visit and a cold load advertise identical values.
 *
 * All arguments are optional overrides; anything omitted comes from the route's
 * registry entry.
 */
export function usePageMeta({ title, description, path, image, type } = {}) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const prevTitle = document.title;

    const pathname =
      path || (typeof window !== 'undefined' ? window.location.pathname : '/');
    const tags = ogTagsFor(pathname, { title, description, image, type });
    const { title: fullTitle, description: desc, url, image: ogImage } = tags;

    document.title = fullTitle;
    const refs = [
      setMeta('meta[name="description"]', 'content', desc),
      setMeta('meta[property="og:title"]', 'content', fullTitle),
      setMeta('meta[property="og:description"]', 'content', desc),
      setMeta('meta[property="og:type"]', 'content', tags.type),
      setMeta('meta[property="og:url"]', 'content', url),
      setMeta('meta[property="og:image"]', 'content', ogImage),
      setMeta('meta[property="og:image:alt"]', 'content', tags.imageAlt),
      setMeta('meta[property="og:site_name"]', 'content', tags.siteName),
      setMeta('meta[name="twitter:card"]', 'content', tags.card),
      setMeta('meta[name="twitter:title"]', 'content', fullTitle),
      setMeta('meta[name="twitter:description"]', 'content', desc),
      setMeta('meta[name="twitter:image"]', 'content', ogImage),
      setMeta('meta[name="twitter:image:alt"]', 'content', tags.imageAlt),
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
  }, [title, description, path, image, type]);
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
