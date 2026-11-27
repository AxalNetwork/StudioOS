// Task #4 — Axal-branded embedded checkout.
//
// Centralises Stripe.js loading and the Elements *appearance* config so every
// embedded-checkout surface looks like the rest of the app. The publishable
// key is resolved at runtime via GET /api/payments/config (Task #16), falling
// back to the build-time VITE_STRIPE_PUBLISHABLE_KEY. The SECRET key never
// leaves the Worker.
import { loadStripe } from '@stripe/stripe-js';

export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';

// Task #16 — runtime key cache. Fetched once per page load from
// /api/payments/config so a key change takes effect without a frontend
// rebuild. Falls back to STRIPE_PUBLISHABLE_KEY (build-time env) if the
// endpoint is unavailable or returns no key.
let _runtimeKey = null;
let _runtimeKeyFetched = false;
let _runtimeKeyPromise = null;

async function fetchRuntimeKey() {
  if (_runtimeKeyFetched) return _runtimeKey;
  if (_runtimeKeyPromise) return _runtimeKeyPromise;
  _runtimeKeyPromise = (async () => {
    try {
      const res = await fetch('/api/payments/config');
      if (res.ok) {
        const data = await res.json();
        if (data.publishable_key) {
          _runtimeKey = data.publishable_key;
        }
      }
    } catch {
      // Network error — fall back to build-time key silently.
    }
    _runtimeKeyFetched = true;
    _runtimeKeyPromise = null;
    return _runtimeKey;
  })();
  return _runtimeKeyPromise;
}

// Single, lazily-created Stripe.js promise. loadStripe injects js.stripe.com on
// first call; we memoise so it's only ever loaded once per page. Returns null
// when no publishable key is configured so callers can render a graceful
// "checkout unavailable" state instead of throwing.
let _stripePromise = null;
export async function getStripe() {
  const runtimeKey = await fetchRuntimeKey();
  const key = runtimeKey || STRIPE_PUBLISHABLE_KEY;
  if (!key) return null;
  if (!_stripePromise) _stripePromise = loadStripe(key);
  return _stripePromise;
}

/** Read a live CSS custom property off <html>, falling back when unavailable. */
function cssVar(name, fallback) {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Build a Stripe Elements `appearance` object from Axal's CSS variables so the
 * embedded Payment Element matches the surrounding Settings UI (light + dark).
 * Pass `isDark` (from SettingsContext's effectiveTheme) so the base theme and
 * token fallbacks resolve correctly even before the computed styles are read.
 *
 * Stripe re-reads `appearance` only when an <Elements> instance is created, so
 * callers should re-mount <Elements> (e.g. via a `key` that includes the theme)
 * when the theme flips.
 */
export function buildAppearance(isDark) {
  const brand = cssVar('--color-brand', '#8b5cf6');
  const brandDark = cssVar('--color-brand-dark', '#7c3aed');
  const surface = cssVar('--app-input-bg', isDark ? '#1f2937' : '#ffffff');
  const text = cssVar('--app-input-text', isDark ? '#f3f4f6' : '#111827');
  const textMuted = cssVar('--app-text-muted', isDark ? '#9ca3af' : '#6b7280');
  const border = cssVar('--app-input-border', isDark ? '#4b5563' : '#d1d5db');

  return {
    theme: isDark ? 'night' : 'stripe',
    labels: 'floating',
    variables: {
      colorPrimary: brand,
      colorBackground: surface,
      colorText: text,
      colorTextSecondary: textMuted,
      colorTextPlaceholder: textMuted,
      colorDanger: '#dc2626',
      colorIcon: textMuted,
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      fontSizeBase: '14px',
      spacingUnit: '4px',
      borderRadius: '8px',
    },
    rules: {
      '.Input': {
        backgroundColor: surface,
        border: `1px solid ${border}`,
        boxShadow: 'none',
        color: text,
      },
      '.Input:focus': {
        border: `1px solid ${brand}`,
        boxShadow: `0 0 0 1px ${brand}`,
      },
      '.Input--invalid': {
        border: '1px solid #dc2626',
        boxShadow: 'none',
      },
      '.Label': {
        color: textMuted,
        fontWeight: '500',
      },
      '.Tab, .Block': {
        backgroundColor: surface,
        border: `1px solid ${border}`,
      },
      '.Tab:hover': {
        color: text,
      },
      '.Tab--selected': {
        border: `1px solid ${brand}`,
        boxShadow: `0 0 0 1px ${brand}`,
      },
      '.TabLabel--selected, .TabIcon--selected': {
        color: brandDark,
      },
    },
  };
}
