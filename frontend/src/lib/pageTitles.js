/**
 * D8681 (#8681): the browser tab title of every in-app screen, decided in one place.
 *
 * Before this, a workspace screen had a title only if its page set one: Deals, Portfolio and a few
 * account pages did, Approvals, Contracts, Help's tickets and Research did not, so they kept the
 * shell's "StudioOS, the founder workspace — Axal VC StudioOS". And Deals set its title with no
 * cleanup, so a later screen that set none (HQ) kept "Deal flow · Axal VC".
 *
 * `routeTitleFor(pathname)` answers, in this order:
 *   1. a workspace screen this table names (`WORKSPACE_SCREENS`, longest path prefix wins);
 *   2. a public route in `ogRegistry.js` — its own `ogTagsFor()` title, so a client-side visit
 *      says exactly what `scripts/prerender-og.mjs` baked into that route's HTML;
 *   3. a workspace bucket or zone of `workspaces/shellConfig.js` ("Companies · Research · Axal VC");
 *   4. a sidebar row of `sidebarConfig.js` (its `to`, then the longest `to` the path sits under);
 *   5. otherwise `SAFE_TITLE`, which names no screen.
 * Titles are built from these static labels only: never a member's name, a company's or a record's.
 *
 * `useRouteTitle()` applies it on every pathname change (App.jsx mounts it beside `<Routes>`, before
 * them, so a page that sets a narrower title of its own still runs after it and wins). It is the
 * reset: whatever a previous page left in the tab, the next navigation replaces it.
 */
import { useEffect, useRef } from 'react';
import { ogEntryFor, ogTagsFor, normalisePath } from './ogRegistry.js';
import { SHELLS } from '../workspaces/shellConfig.js';
import { SIDEBAR_GROUPS } from '../sidebarConfig.js';

/** The brand every workspace title ends with, as Deals' titles already did ("Deal flow · Axal VC"). */
export const TITLE_BRAND = 'Axal VC';

/** The title while the destination is unknown, still loading or failed: the brand and nothing else. */
export const SAFE_TITLE = TITLE_BRAND;

/** `screenTitle('Companies', 'Research')` → "Companies · Research · Axal VC". */
export const screenTitle = (...parts) => [...parts.filter(Boolean), TITLE_BRAND].join(' · ');

/**
 * Screens named here before anything else. Each is a static label; a path's sub-pages take the
 * entry they sit under, so `/admin/contracts/<id>` is still "Contracts", never the record's title.
 */
export const WORKSPACE_SCREENS = Object.freeze([
  // Each licence's landing page (ROLE_DEFAULT_PATH in App.jsx): every licence lands on Studio,
  // a Super Admin on HQ, an exploring account on its Studio, a pending one on onboarding.
  ['/studio', 'Studio'],
  ['/exploring', 'Studio'],
  ['/onboarding', 'Onboarding'],
  ['/hq', 'HQ'],
  ['/hq/ai-agents', 'AI agents · HQ'],
  ['/hq/review', 'Review queue · HQ'],
  // The Super Admin's Team row is /admin/hq-team (D941); /team is the public About page.
  ['/admin/hq-team', 'Team · HQ'],
  ['/admin/hq-support', 'Support · HQ'],
  ['/admin/contracts', 'Contracts'],
  ['/admin/contracts/closings', 'Closings · Contracts'],
  ['/branch/contracts', 'Contracts'],
  ['/admin/security', 'Security'],
  ['/admin/security/obligations', 'Obligations · Security'],
  ['/admin/security/trust-center', 'Trust center · Security'],
  ['/admin/approvals', 'Approvals'],
  ['/branch/approvals', 'Approvals'],
  // /help itself is public (the registry's Help Center); a member's tickets are not.
  ['/help/tickets', 'Support tickets · Help'],
  // Deals' own model (dealFlowModel.js) names each tab after this; a deal room names nothing more.
  ['/deals', 'Deal flow'],
  ['/trust/me', 'Trust'],
  ['/account', 'Settings'],
]);

/** True when `path` is `base` or sits under it as a whole segment (`/hqx` is not under `/hq`). */
const under = (path, base) => path === base || path.startsWith(`${base}/`);

/** The longest entry of `[path, label]` pairs that `path` sits under, or null. */
function longest(pairs, path) {
  let best = null;
  for (const pair of pairs) if (under(path, pair[0]) && (!best || pair[0].length > best[0].length)) best = pair;
  return best;
}

/** Every shell bucket and zone, role by role, the first label for a path winning. */
const SHELL_SCREENS = (() => {
  const seen = new Map();
  for (const shell of Object.values(SHELLS)) {
    for (const row of shell.rows) {
      if (row.kind !== 'bucket') continue;
      if (!seen.has(row.prefix)) seen.set(row.prefix, screenTitle(row.label));
      for (const zone of row.zones) {
        const at = `${row.prefix}/${zone.slug}`;
        if (!seen.has(at)) seen.set(at, screenTitle(zone.label, row.label));
      }
    }
  }
  return [...seen.entries()];
})();

/** Every sidebar row (and its children) of every role, the first label for a path winning. */
const SIDEBAR_SCREENS = (() => {
  const seen = new Map();
  const add = (item) => {
    const to = typeof item?.to === 'string' ? normalisePath(item.to) : null;
    if (to && to !== '/' && item.label && !seen.has(to)) seen.set(to, screenTitle(item.label));
    (item?.children || []).forEach(add);
  };
  for (const groups of Object.values(SIDEBAR_GROUPS)) for (const group of groups || []) (group.items || []).forEach(add);
  return [...seen.entries()];
})();

/** True when the public route registry (and so the prerender) owns this path's title. */
export const isPublicTitlePath = (pathname) => {
  const path = normalisePath(pathname);
  return !longest(WORKSPACE_SCREENS, path) && !!ogEntryFor(path);
};

/** The tab title for a pathname. Pure: a test reads it directly. */
export function routeTitleFor(pathname) {
  const path = normalisePath(pathname);
  const named = longest(WORKSPACE_SCREENS, path);
  if (named) return screenTitle(named[1]);
  if (ogEntryFor(path)) return ogTagsFor(path).title;
  const zone = longest(SHELL_SCREENS, path);
  if (zone) return zone[1];
  const row = longest(SIDEBAR_SCREENS, path);
  if (row) return row[1];
  return SAFE_TITLE;
}

/**
 * The title to show now. A workspace path whose session is still loading shows `SAFE_TITLE`: the
 * screen it ends on (the page, a refusal or a redirect) is not known yet. A public path's title
 * does not depend on the session.
 */
export function titleNow(pathname, { loading = false } = {}) {
  if (loading && !isPublicTitlePath(pathname)) return SAFE_TITLE;
  return routeTitleFor(pathname);
}

/**
 * Sets `document.title` on every pathname change. On the first render of a public path it leaves
 * the title alone: the prerendered HTML already carries that route's own title (a Help guide's or a
 * program's, which only the page itself knows), and replacing it would flash the registry's.
 */
export function useRouteTitle(pathname, { loading = false } = {}) {
  const first = useRef(true);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const cold = first.current;
    first.current = false;
    if (cold && isPublicTitlePath(pathname)) return;
    document.title = titleNow(pathname, { loading });
  }, [pathname, loading]);
}
