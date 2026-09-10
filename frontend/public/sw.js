/* Task #57 — StudioOS Service Worker
 *
 * Strategy matrix:
 *   - precache:        app shell (/, /index.html, manifest, icons, offline)
 *   - cache-first:     same-origin static assets (Vite-fingerprinted /assets/*)
 *   - never cached:    /api/auth/*  (who you are is not a cacheable fact)
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
// v16 was a REQUIRED bump, not a routine one: v15's `studioos-api-v15-…` cache
// holds `/api/auth/me` bodies, and every browser that ever ran this app is
// carrying one. Only `activate`'s delete-everything-not-in-this-list pass
// clears them, and that only runs when a name changes.
// v17 is required for the same reason one step further out: v16 still kept
// ONE API bucket for the whole origin, so it holds one signed-in person's
// API bodies where the next signed-in person can be handed them.
const VERSION = 'v17-2026-09-10';
const PRECACHE = `studioos-precache-${VERSION}`;
const RUNTIME_STATIC = `studioos-static-${VERSION}`;

// THE API CACHE IS PER SIGNED-IN ACCOUNT, and the name is where that is
// enforced. There used to be one `studioos-api-<VERSION>` bucket for the whole
// origin, and a Cache Storage entry is keyed by URL alone — `Cache.match`
// does not look at request headers and the worker sends no `Vary`. So on any
// browser two people sign in to, person B could be handed person A's private
// API bodies: `offline.html` promises "your own project data", and the code
// had no idea whose data it was holding.
//
// Splitting the BUCKET rather than the key means sign-out can drop a person's
// cached API data in one call (`clearSessionState` in App.jsx does), instead
// of enumerating entries and hoping the filter is right.
const API_CACHE_PREFIX = `studioos-api-${VERSION}-`;

/**
 * Which bucket a request's response may be read from and written to.
 *
 * The identity travels ON THE REQUEST, set by `api.js` from the signed-in
 * user. That is deliberate over the two obvious alternatives:
 *
 *   - A worker-global set by `postMessage` dies with the worker, and a
 *     service worker is terminated and restarted constantly. It would read
 *     stale or empty on exactly the sign-in and sign-out boundaries that
 *     matter, which is where the bug lives.
 *   - `Vary: Authorization` from the server does not separate the primary
 *     sign-in path at all: `studioos_auth` is an httpOnly cookie (auth.ts
 *     treats it as the freshest sign-in), so two cookie-authenticated people
 *     both send NO Authorization header and would still share a key.
 *
 * A per-request header cannot go stale, has no lifecycle, and is the same
 * fact the server itself uses to decide what to return.
 *
 * Anything without a usable identity — a request the SPA did not make, or a
 * signed-out visitor — gets the `anon` bucket. It never shares one with a
 * signed-in account. The value is checked against a digits-only pattern
 * before it is interpolated so a header can only ever name a bucket, never
 * escape into another cache's name.
 */
function apiCacheName(request) {
  const raw = request.headers.get('X-StudioOS-Identity') || '';
  return API_CACHE_PREFIX + (/^[0-9]{1,15}$/.test(raw) ? raw : 'anon');
}

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
//
// `/api/auth/me` USED TO BE IN THIS LIST AND MUST NEVER GO BACK.
// stale-while-revalidate returns the cached body FIRST, and a Cache Storage
// entry is keyed by URL — `Cache.match` ignores request headers, and the
// worker sends no `Vary`, so the Authorization header is not part of the key.
// One `/api/auth/me` body was therefore replayed to whoever asked next,
// whatever token they were holding: the SPA read the PREVIOUS account's
// identity. That is the same failure the SPA's identity-change purge
// (`useAuthSync`, Task #4) exists to clean up after — the purge was treating
// the symptom while this line kept causing it.
//
// Found by driving a support session end-to-end in Chromium: at hand-back the
// admin's restored session was immediately wiped and replaced by the
// impersonated founder, signed in with no token at all. No request reached the
// server; the worker had answered it 65 seconds earlier and this cache kept
// the answer. See NEVER_CACHE_API below, which is the half that stops
// network-first storing it too.
const OFFLINE_API_PATTERNS = [
  /^\/api\/academy(\/|$)/,
  /^\/api\/projects(\/|$|\?)/,
];

// Who you are is never read from a cache — not stale-while-revalidate, not
// network-first's offline fallback, and never written to Cache Storage in the
// first place. Dropping `/api/auth/me` from the list above is not enough on
// its own: `networkFirst` also `cache.put`s every 200 it sees and replays it
// whenever the network throws, so the same body would still be handed to the
// next account, just on the offline path.
const NEVER_CACHE_API = [
  /^\/api\/auth(\/|$)/,
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
      // The API buckets are one per account, so they cannot be listed — they
      // are kept by prefix. The prefix carries VERSION, so every earlier
      // build's buckets still fall through to the delete, which is what
      // clears the single shared bucket v16 and earlier wrote into.
      if (k === PRECACHE || k === RUNTIME_STATIC || k.startsWith(API_CACHE_PREFIX)) {
        return null;
      }
      return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

function isOfflineCachableApi(url) {
  return OFFLINE_API_PATTERNS.some((re) => re.test(url.pathname));
}

function isNeverCachableApi(url) {
  return NEVER_CACHE_API.some((re) => re.test(url.pathname));
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
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && req.method === 'GET') {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    // `cache.match`, NOT the global `caches.match`. The global one searches
    // EVERY bucket in the origin and returns the first hit, so with one
    // bucket per account it would walk straight into somebody else's and
    // hand their body back — undoing the split above on the exact path the
    // split exists for, the offline one.
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

function isHtmlResponse(res) {
  const ct = (res && res.headers && res.headers.get('content-type')) || '';
  return /text\/html/i.test(ct);
}

async function cacheFirst(req, cacheName) {
  // Task #37 — never serve or store an HTML response for a hashed asset. After
  // a deploy the origin may return the SPA-fallback index.html (or, with the
  // hardened Worker, a 404) for a missing hashed chunk; caching that HTML and
  // replaying it for a .js/.css request renders the page blank on the next
  // visit. Ignoring HTML lets the request surface the real 404 so the page's
  // boot watchdog / stale-chunk recovery can reload onto the current build.
  const cached = await caches.match(req);
  if (cached && !isHtmlResponse(cached)) return cached;
  const res = await fetch(req);
  if (res && res.status === 200 && !isHtmlResponse(res)) {
    const cache = await caches.open(cacheName);
    cache.put(req, res.clone()).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // In dev environments (Replit, localhost) pass every request straight to
  // the network. The SW should never cache Vite dev-server responses —
  // they carry optimizer dep hashes that change on every restart, and
  // caching them here causes stale-module blank pages.
  if (/(localhost|replit\.dev|replit\.app|repl\.co)/.test(self.location.host) ||
      self.location.port === '5000') {
    return; // let browser handle it natively
  }

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
    // Identity first, and straight past every cache. `return` without
    // respondWith hands the request back to the browser untouched, so there
    // is no Cache Storage entry to read and none to write.
    if (isNeverCachableApi(url)) return;
    // One bucket per signed-in account, resolved from this request rather
    // than from any state the worker is holding.
    const apiCache = apiCacheName(request);
    if (isOfflineCachableApi(url)) {
      event.respondWith(staleWhileRevalidate(request, apiCache));
    } else {
      event.respondWith(networkFirst(request, apiCache).catch(() => new Response(
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
