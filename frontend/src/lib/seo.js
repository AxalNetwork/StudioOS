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

function setMeta(doc, selector, attr, value) {
  if (!doc?.head) return null;
  let el = doc.head.querySelector(selector);
  const created = !el;
  if (!el) {
    el = doc.createElement('meta');
    const [, kind, name] = selector.match(/meta\[(name|property)="([^"]+)"\]/) || [];
    if (kind && name) el.setAttribute(kind, name);
    doc.head.appendChild(el);
  }
  const prev = el.getAttribute(attr) || '';
  el.setAttribute(attr, value);
  return { el, prev, created };
}

export function fireAnalytics(path) {
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

/** Set `<link rel="canonical">` on `doc`, creating it when the shell has none. Returns what is needed to put it back. */
function setCanonical(doc, href) {
  if (!doc?.head) return null;
  let el = doc.head.querySelector('link[rel="canonical"]');
  const created = !el;
  if (!el) {
    el = doc.createElement('link');
    el.setAttribute('rel', 'canonical');
    doc.head.appendChild(el);
  }
  const prev = el.getAttribute('href') || '';
  el.setAttribute('href', href);
  return { el, prev, created, attr: 'href' };
}

/**
 * D4582 (#4582): write one route's head onto `doc` and return the function that
 * puts it back. It sets the same tags `scripts/prerender-og.mjs` bakes into the
 * route's HTML, including the canonical link and, when the route has one, the
 * robots directive. A visit reached by client-side navigation (for example
 * /grow redirecting to /login) carries the destination's head, never the page
 * it came from. A route with no robots directive leaves the shell's robots tag
 * alone and does not invent `index, follow`.
 */
export function applyHeadTags(doc, tags) {
  if (!doc) return () => {};
  const { title: fullTitle, description: desc, url, image: ogImage } = tags;
  const prevTitle = doc.title;
  doc.title = fullTitle;
  const refs = [
    setMeta(doc, 'meta[name="description"]', 'content', desc),
    tags.robots ? setMeta(doc, 'meta[name="robots"]', 'content', tags.robots) : null,
    setMeta(doc, 'meta[property="og:title"]', 'content', fullTitle),
    setMeta(doc, 'meta[property="og:description"]', 'content', desc),
    setMeta(doc, 'meta[property="og:type"]', 'content', tags.type),
    setMeta(doc, 'meta[property="og:url"]', 'content', url),
    setMeta(doc, 'meta[property="og:image"]', 'content', ogImage),
    setMeta(doc, 'meta[property="og:image:alt"]', 'content', tags.imageAlt),
    setMeta(doc, 'meta[property="og:site_name"]', 'content', tags.siteName),
    setMeta(doc, 'meta[name="twitter:card"]', 'content', tags.card),
    setMeta(doc, 'meta[name="twitter:title"]', 'content', fullTitle),
    setMeta(doc, 'meta[name="twitter:description"]', 'content', desc),
    setMeta(doc, 'meta[name="twitter:image"]', 'content', ogImage),
    setMeta(doc, 'meta[name="twitter:image:alt"]', 'content', tags.imageAlt),
    setCanonical(doc, url),
  ].filter(Boolean);
  return () => {
    doc.title = prevTitle;
    // Restore previous values; if we created the tag, remove it.
    refs.forEach((r) => {
      if (r.created) r.el.remove();
      else r.el.setAttribute(r.attr || 'content', r.prev);
    });
  };
}

/**
 * D4582: write a route's resolved tags into `document.head` and return a function that puts the head back.
 * `applyHeadTags` is the same writer with the document passed in, so a test can drive it against a fake document.
 * A route with no robots directive leaves the shell's robots tag alone.
 */
export function applyPageMeta(tags) {
  if (typeof document === 'undefined') return () => {};
  return applyHeadTags(document, tags);
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
 * registry entry. `analytics: false` skips the pageview beacon (the sign-in and
 * sign-up pages set their head without adding a new beacon, D4582).
 */
export function usePageMeta({ title, description, path, image, type, analytics = true } = {}) {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const pathname =
      path || (typeof window !== 'undefined' ? window.location.pathname : '/');
    const restore = applyPageMeta(ogTagsFor(pathname, { title, description, image, type }));
    // Fire pageview beacon once per mount.
    if (analytics) fireAnalytics(path || window.location.pathname);
    return restore;
  }, [title, description, path, image, type, analytics]);
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
