/* Task #57 — PWA helpers: SW registration, install prompt, push subscribe.
 *
 * `registerServiceWorker()` is called once from main.jsx.
 * `getInstallPromptState()` + `triggerInstall()` back the install banner.
 * `enablePush()` / `disablePush()` / `getPushState()` back the bell's
 *  "Enable push" toggle.
 */
import { api } from './api';
import { reloadWithinBudget } from './reloadGuard';

// The service-worker update reload's budget. One is the whole intent — "reload
// once when a new worker takes control" — and the point of a stored count
// rather than an in-memory flag is that it still says one after the reload.
const SW_RELOAD_KEY = 'axal:sw-reload-attempts';
const SW_RELOAD_PARAM = '__swreload';
const MAX_SW_RELOADS = 1;
// How long to wait before asking the network again whether the worker is stale.
const UPDATE_THROTTLE_MS = 5 * 60 * 1000;

let _deferredInstall = null;
const _installListeners = new Set();

function _emitInstall() {
  for (const cb of _installListeners) {
    try { cb({ canInstall: !!_deferredInstall, installed: isStandalone() }); }
    catch {}
  }
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  );
}

export function isPushSupported() {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
}

export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  // Skip SW registration in Vite dev — the SW precaches '/' and serves
  // stale HTML referencing old optimizer dep hashes, which causes
  // "Outdated Optimize Dep" 504s on reload. Also unregister any leftover
  // SW from a prior session so it stops intercepting requests.
  if (import.meta.env && import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister().catch(() => {}));
    }).catch(() => {});
    if (window.caches && caches.keys) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k).catch(() => {}))).catch(() => {});
    }
    return;
  }
  // Auto-reload when a NEWLY activated service worker takes control of the
  // page. Without this, a freshly deployed build leaves an open/cached tab
  // running the old in-memory bundle, which can reference asset chunks the new
  // deploy removed → a site-wide blank page that survives normal refreshes. We
  // only arm this when a controller already exists (i.e. this is an UPDATE, not
  // the first-ever install, which would otherwise reload every brand-new
  // visitor).
  //
  // THE GUARD USED TO BE A CLOSURE FLAG, AND THAT IS NOT A GUARD. It read:
  //
  //     let _reloadingForUpdate = false;
  //     ... if (_reloadingForUpdate) return; _reloadingForUpdate = true;
  //
  // and its comment claimed it "guard[s] against any reload loop with a
  // one-shot flag". A `let` in this closure dies with the document, so every
  // reload re-armed it with a fresh `false`: it bounded one reload PER PAGE
  // LOAD, which bounds nothing at all. This was the only reload in the app with
  // no guard that outlived the reload it triggered.
  //
  // It closed a cycle with the worker itself. `sw.js` calls `skipWaiting()` on
  // every install and `clients.claim()` in `activate` — and `claim()` fires
  // `controllerchange` on pages that already have a controller. So:
  // reload → register → update → install → skipWaiting → claim →
  // controllerchange → reload, with nothing counting.
  //
  // Now it uses the same counter-plus-URL-marker the rest of the app settled
  // on (`lib/reloadGuard.js`), so the bound survives both the reload and a
  // browser that refuses `sessionStorage` writes.
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      reloadWithinBudget(SW_RELOAD_KEY, SW_RELOAD_PARAM, MAX_SW_RELOADS);
    });
  }
  // Register after first paint to avoid blocking LCP.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Nudge an update check when the tab comes back to the foreground —
        // THROTTLED, because unthrottled it ran on every single tab switch and
        // fed the cycle described above. The throttle is not the bound (it is
        // in-memory and dies with the document, like the flag this replaced);
        // the counter above is. This just stops the app asking the network
        // whether it is stale every time someone glances at another tab.
        let lastUpdate = 0;
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible') return;
          const now = Date.now();
          if (now - lastUpdate < UPDATE_THROTTLE_MS) return;
          lastUpdate = now;
          reg.update().catch(() => {});
        });
      })
      .catch((err) => {
        console.warn('SW registration failed:', err);
      });

    // Listen for in-page navigation requests posted from the SW (push click).
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'navigate' && typeof e.data.link === 'string') {
        try { window.history.pushState({}, '', e.data.link); }
        catch { window.location.href = e.data.link; }
        // Notify React Router to re-evaluate
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    });
  });

  // Capture the install prompt for later.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredInstall = e;
    _emitInstall();
  });
  window.addEventListener('appinstalled', () => {
    _deferredInstall = null;
    _emitInstall();
  });
}

export function onInstallStateChange(cb) {
  _installListeners.add(cb);
  cb({ canInstall: !!_deferredInstall, installed: isStandalone() });
  return () => _installListeners.delete(cb);
}

export async function triggerInstall() {
  if (!_deferredInstall) return { ok: false, reason: 'no_prompt' };
  _deferredInstall.prompt();
  const choice = await _deferredInstall.userChoice;
  const accepted = choice && choice.outcome === 'accepted';
  _deferredInstall = null;
  _emitInstall();
  return { ok: accepted, outcome: choice?.outcome };
}

// ---------------- Push subscription ----------------

function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function getPushState() {
  if (!isPushSupported()) return { supported: false, subscribed: false, permission: 'denied' };
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) return { supported: false, subscribed: false, permission: Notification.permission };
  const sub = await reg.pushManager.getSubscription();
  return { supported: true, subscribed: !!sub, permission: Notification.permission };
}

export async function enablePush() {
  if (!isPushSupported()) throw new Error('Push not supported in this browser');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission denied');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { public_key } = await api.pushVapidKey();
    if (!public_key) throw new Error('Server has no VAPID key configured');
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    });
  }
  const json = sub.toJSON();
  await api.pushSubscribe({
    endpoint: json.endpoint,
    keys: json.keys,
    expirationTime: json.expirationTime || null,
    user_agent: navigator.userAgent,
  });
  return { ok: true, endpoint: json.endpoint };
}

export async function disablePush() {
  if (!isPushSupported()) return { ok: true };
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) return { ok: true };
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    try { await api.pushUnsubscribe({ endpoint: sub.endpoint }); } catch {}
    try { await sub.unsubscribe(); } catch {}
  }
  return { ok: true };
}

export async function sendPushTest() {
  return api.pushTest();
}
