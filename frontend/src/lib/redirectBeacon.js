/**
 * #2301 — one first-party beacon each time an old address on the redirect list
 * is opened, so the 2027-01-19 review can see which are still used. A redirect
 * runs here, in the browser; the Worker never sees the old address.
 *
 * The list is the Worker's (`services/redirectRoutes.ts`), which also decides
 * what the pageview route will count. The beacon carries `redirect:<pattern>`
 * only (the route's pattern, never the visited path with its ids, query or
 * hash, except its fixed allowlisted admin tab): no IP, user agent or cookie,
 * as every pageview beacon.
 */
import { useEffect } from 'react';
import { matchPath } from 'react-router-dom';
import { ADMIN_TAB_REDIRECTS, REDIRECT_ROUTES, redirectKey } from '../../../cloudflare-worker/src/services/redirectRoutes.ts';
import { fireAnalytics } from './seo';

/** The redirect pattern an address opens, or null when it is not on the list. */
export function redirectPatternFor(pathname, search = '') {
  if (typeof pathname !== 'string' || !pathname) return null;
  if (matchPath({ path: '/admin', end: true }, pathname)) {
    const tab = new URLSearchParams(search).get('tab');
    return ADMIN_TAB_REDIRECTS.find((r) => r.path === `/admin?tab=${tab}`)?.path || '/admin';
  }
  // The list names each exact pattern before its splat (`/notifications`, then `/notifications/*`).
  const hit = REDIRECT_ROUTES.find((r) => !r.path.includes('?') && matchPath({ path: r.path, end: true }, pathname));
  return hit ? hit.path : null;
}

/** Called once by the router shell: one beacon per opening of a listed address. */
export function useRedirectBeacon(pathname, search = '', send = fireAnalytics) {
  const pattern = redirectPatternFor(pathname, search);
  useEffect(() => {
    if (pattern) send(redirectKey(pattern));
  }, [pathname, pattern, send]);
}
