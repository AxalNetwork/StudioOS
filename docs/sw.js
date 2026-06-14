/* Task #57 — StudioOS Service Worker
 *
 * Strategy matrix:
 *   - precache:        app shell (/, /index.html, manifest, icons, offline)
 *   - cache-first:     same-origin static assets (Vite-fingerprinted /assets/*)
 *   - stale-while-revalidate:  /api/academy/*  +  /api/projects/*  (own data, offline read)
 *   - network-first:   every other /api/* (always prefer fresh)
 *   - navigation:      network-first w/ offline.html fallback
 *
 * Push: a `push` event with JSON `{title, body, link}` shows a system
 * notification. Click focuses an existing tab on `link` (or opens a new one).
 */
// Bump VERSION on every deploy that changes precached app-shell files (sw.js,
// offline.html, manifest, icons) so old caches drop on activate. Vite-built
// /assets/* files are content-hashed in their filenames, so the cache-first
// rule is safe across deploys without a version bump.
const VERSION = 'v10-2026-06-10a';
const PRECACHE = `studioos-precache-${VERSION}`;
const RUNTIME_STATIC = `studioos-static-${VERSION}`;
const RUNTIME_API = `studioos-api-${VERSION}`;

// Do NOT precache '/' or '/index.html'. The navigation handler is network-first
// and falls back to '/offline.html' on failure — precaching the SPA shell pins
// users to an old HTML referencing stale hashed JS chunks across deploys,
// which manifests as a blank page on next visit. See Task #57.
const PRECACHE_URLS = [
  '/manifest.webmanifest',
  '/offline.html',
  '/axal-mark.png',
  '/axal-logo.png',
];

// API URL patterns we cache for offline read.
const OFFLINE_API_PATTERNS = [
  /^\/api\/academy(\/|$)/,
  /^\/api\/projects(\/|$|\?)/,
  /^\/api\/auth\/me$/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((c) => c.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (![PRECACHE, RUNTIME_STATIC, RUNTIME_API].includes(k)) {
        return caches.delete(k);
      }
      return null;
    }));
    await self.clients.claim();
  })());
});

function isOfflineCachableApi(url) {
  return OFFLINE_API_PATTERNS.some((re) => re.test(url.pathname));
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.status === 200 && res.type !== 'opaque') {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  }).catch(() => new Response(
    JSON.stringify({ offline: true, error: 'offline_no_cache' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  ));
  return cached || (await network);
}

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && req.method === 'GET') {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.status === 200) {
    const cache = await caches.open(cacheName);
    cache.put(req, res.clone()).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Don't intercept cross-origin (CDN fonts, etc.)
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to offline.html
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        return res;
      } catch (err) {
        const cached = await caches.match('/index.html');
        return cached || (await caches.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  // /api/* routing
  if (url.pathname.startsWith('/api/')) {
    if (isOfflineCachableApi(url)) {
      event.respondWith(staleWhileRevalidate(request, RUNTIME_API));
    } else {
      event.respondWith(networkFirst(request, RUNTIME_API).catch(() => new Response(
        JSON.stringify({ offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } }
      )));
    }
    return;
  }

  // Skip caching Vite dev server internals — these change between restarts
  // and caching them causes stale React bundle versions (invalid hook call).
  if (url.pathname.startsWith('/node_modules/.vite/') || url.pathname.startsWith('/@')) {
    return;
  }

  // Vite fingerprinted assets and other static files: cache-first
  if (/\.(?:js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, RUNTIME_STATIC));
    return;
  }

  // Everything else: network with cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((res) => res || Response.error()))
  );
});

// ---------------- Push ----------------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Axal VC', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Axal VC StudioOS';
  const options = {
    body: data.body || '',
    icon: '/axal-mark.png',
    badge: '/axal-mark.png',
    tag: data.uid || data.type || 'axal-notify',
    renotify: false,
    data: { link: data.link || '/', type: data.type || null, uid: data.uid || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      const u = new URL(c.url);
      if (u.origin === self.location.origin) {
        await c.focus();
        c.postMessage({ type: 'navigate', link: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('message', (event) => {
  // CodeQL js/missing-origin-check: default-DENY. Only honour messages
  // from a same-origin Client (window/worker) — never from null/unknown
  // sources or cross-origin frames embedding the page. We check BOTH
  // event.origin (canonical idiom CodeQL recognises) AND the source
  // Client's URL for defense-in-depth: in ServiceWorker MessageEvents
  // event.origin is populated for cross-origin frames, while same-origin
  // Clients carry their identity on event.source.url.
  if (event.origin && event.origin !== self.location.origin) return;
  const src = event.source;
  if (!src || typeof src.url !== 'string') return;
  let srcOrigin;
  try { srcOrigin = new URL(src.url).origin; } catch { return; }
  if (srcOrigin !== self.location.origin) return;
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
