// On-demand Cloudflare Turnstile loader.
//
// Task #20 (mobile landing speed) — the Turnstile API script used to live as a
// global <script> in index.html, so it loaded on EVERY page (landing included)
// as a render-competing third-party request even though only a handful of forms
// render a widget. This helper injects the script lazily, exactly once, and
// resolves when `window.turnstile` is ready. Call it from the effect that
// renders a Turnstile widget; the page's existing poll then picks up the global.
//
// Idempotent: repeated calls share one promise / one <script> tag.

let promise = null;

export function loadTurnstile() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('turnstile: no window'));
  }
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (promise) return promise;

  promise = new Promise((resolve, reject) => {
    const finish = () => {
      // The script's own async init can lag its load event slightly, so poll
      // briefly for the global (mirrors the pages' existing 50-attempt cap).
      let attempts = 0;
      const t = setInterval(() => {
        if (window.turnstile) {
          clearInterval(t);
          resolve(window.turnstile);
        } else if (++attempts > 50) {
          clearInterval(t);
          reject(new Error('turnstile: init timeout'));
        }
      }, 100);
    };

    const existing = document.querySelector('script[data-turnstile]');
    if (existing) {
      if (window.turnstile) return finish();
      existing.addEventListener('load', finish);
      existing.addEventListener('error', () => reject(new Error('turnstile: load failed')));
      return;
    }

    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.defer = true;
    s.setAttribute('data-turnstile', '');
    s.onload = finish;
    s.onerror = () => { promise = null; reject(new Error('turnstile: load failed')); };
    document.head.appendChild(s);
  });

  return promise;
}
