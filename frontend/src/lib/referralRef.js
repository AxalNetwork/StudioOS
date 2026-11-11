/**
 * D4289 P2 (#4291) — the first-touch referral the app keeps in the `axal_ref`
 * cookie, read the way the Worker reads it (`services/referrals/handleAttribution.ts`).
 *
 * A handle reference (`h:jane`, `h:jane:yt`, `@jane`, `@jane/yt`) is kept as
 * `h:<handle>[:<channel>]`, lower-cased, never upper-cased into a code: a code
 * normaliser would strip it to `HJANE`, or read `axalfan` as `FAN`. Anything
 * else is a referral code, normalised as before (upper-case, a leading AXAL
 * dropped, letters and digits only).
 *
 * First touch wins: an existing cookie is never replaced. A handle holds 90
 * days, a code 30.
 */
const HANDLE = /^[a-z0-9_]{3,24}$/;
const CHANNEL = /^[a-z0-9_]{1,24}$/;
export const HANDLE_DAYS = 90;
export const CODE_DAYS = 30;

/** The handle reference in `raw`, as `h:<handle>[:<channel>]`, or null. */
export function handleRef(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  let rest;
  if (v.startsWith('h:')) rest = v.slice(2).replace(':', '/');
  else if (v.startsWith('@')) rest = v.slice(1);
  else return null;
  const [handle, channel, extra] = rest.split('/');
  if (extra !== undefined || !HANDLE.test(handle || '')) return null;
  if (channel !== undefined && !CHANNEL.test(channel)) return null;
  return `h:${handle}${channel ? `:${channel}` : ''}`;
}

/** `raw` as the cookie keeps it: a handle reference, or a normalised code; '' for nothing usable. */
export function normaliseRef(raw) {
  const h = handleRef(raw);
  if (h) return h;
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/^AXAL[-_]?/, '').replace(/[^A-Z0-9]/g, '');
}

/** The `axal_ref` cookie's value, or ''. */
export function readRefCookie(cookie = typeof document === 'undefined' ? '' : document.cookie) {
  for (const part of String(cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== 'axal_ref') continue;
    try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return part.slice(eq + 1).trim(); }
  }
  return '';
}

/**
 * Keeps `raw` as the first-touch referral, unless one is already kept. Returns
 * the value kept now, or '' when nothing was written.
 */
export function keepFirstTouch(raw, doc = typeof document === 'undefined' ? null : document, loc = typeof window === 'undefined' ? null : window.location) {
  if (!doc) return '';
  const value = normaliseRef(raw);
  if (!value || readRefCookie(doc.cookie)) return '';
  const days = value.startsWith('h:') ? HANDLE_DAYS : CODE_DAYS;
  const secure = loc && loc.protocol === 'https:' ? '; Secure' : '';
  doc.cookie = `axal_ref=${encodeURIComponent(value)}; path=/; max-age=${days * 86400}; SameSite=Lax${secure}`;
  return value;
}

/** A random id this browser keeps for visit counts; the Worker hashes it with the day and keeps no IP. */
export function visitorId(store = typeof localStorage === 'undefined' ? null : localStorage) {
  try {
    let id = store?.getItem('axal_vid');
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
      store?.setItem('axal_vid', id);
    }
    return id;
  } catch { return null; }
}
