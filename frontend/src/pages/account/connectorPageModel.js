/**
 * D753 (#1876, F1) — the rules of a connector's own page at
 * `/account/connectors/<key>` (`ConnectorPage.jsx`). Pure: no React, no fetch,
 * so `frontend/test/connector_page_d753.test.mjs` holds every rule.
 *
 * A key is drawn only if the catalogue holds it (D651's rule for crafted
 * links). The row is found with `Array.find` and the alias map read with
 * `Object.hasOwn`, so `__proto__`, `constructor` and `toString` read as
 * unknown keys.
 */
import {
  REGISTRY_ALIAS, TIER_LABEL, authKind, cardAction, categoryOf, connectorPagePath, oauthReturn,
} from './connectorsModel.js';

export { connectorPagePath };

/** `google_calendar` and `microsoft_365` are pages of `google` and `microsoft` (D753 decision 1). */
export const PAGE_ALIAS = REGISTRY_ALIAS;

/**
 * What the page draws for a key: an alias to follow, a read state, the row,
 * Mercury withheld from this profile, or a key the catalogue does not hold.
 */
export function pageEntry({ data, key } = {}) {
  if (Object.hasOwn(PAGE_ALIAS, key)) return { state: 'alias', to: connectorPagePath(PAGE_ALIAS[key]) };
  const catalogue = Array.isArray(data?.catalogue) ? data.catalogue : [];
  if (data?.status === 'loading' && !catalogue.length) return { state: 'loading' };
  if (data?.status === 'forbidden') return { state: 'forbidden', message: data.message || 'Your role cannot manage connectors.' };
  if (data?.status === 'unreadable' && !catalogue.length) return { state: 'unreadable' };
  const p = catalogue.find((x) => x && x.key === key);
  if (p) return { state: 'ready', p };
  if (key === 'mercury') return { state: 'not_offered' };
  return { state: 'unknown' };
}

/**
 * The sign-in return the page reads: only one naming its own key, and never
 * Mercury's (D715 decision 3). `{ ret, strip }`; `{ ret: null, strip }` for
 * any other return, which is stripped and ignored; null when there is none.
 */
export function pageReturn(search, key) {
  const ret = oauthReturn(search);
  if (!ret) return null;
  return ret.key === key && key !== 'mercury' ? { ret, strip: ret.strip } : { ret: null, strip: ret.strip };
}

/** What the Connect and manage region holds until F2 (D753 decision 8). */
export function interimMode(p, ret = null) {
  if (ret) return 'panel';
  const act = cardAction(p);
  if (act === 'notify' || act === 'joined') return 'waitlist';
  if (act === 'unavailable') return 'unavailable';
  return 'panel';
}

const TABS = new Set(['yours', 'discover']);

/** The hub's tab from its address: `?tab=discover` or `?tab=yours`, else the fallback. */
export function hubTabFor(search, fallback = 'yours') {
  const t = new URLSearchParams(search || '').get('tab');
  return TABS.has(t) ? t : fallback;
}

/** The hub's search with its tab written (`discover`) or removed (`yours`), every other key kept. */
export function hubSearchFor(search, tab) {
  const p = new URLSearchParams(search || '');
  if (tab === 'discover') p.set('tab', 'discover');
  else p.delete('tab');
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function hubPathFor(tab) {
  return tab === 'discover' ? '/account/connectors?tab=discover' : '/account/connectors';
}

/** "← Connectors" returns to the tab the reader came from; only this app's two tab words are read. */
export function backHrefFor(state) {
  const t = state && typeof state === 'object' ? state.connectorsTab : null;
  return hubPathFor(TABS.has(t) ? t : 'yours');
}

/** How a connector signs in, in the sheet's own words. */
export function signInLabel(p) {
  const name = p?.display_name || 'the service';
  switch (authKind(p)) {
    case 'first_party':
    case 'oauth': return `Sign in with ${name}`;
    case 'token_first': return `Private App token, or sign in with ${name}`;
    default: return p?.key === 'mercury' ? 'Read Only API token' : 'API key';
  }
}

export const DETAIL_MISSING = 'The connector registry does not describe this yet.';
const STATUS_WORDS = { live: 'Live', beta: 'Beta', coming_soon: 'Coming soon' };

/** Details: Category, Status, Plan, Sign-in and Documentation. A missing value carries its reason, never a blank. */
export function detailsRows(p) {
  const v = (value) => (value ? { value, reason: null } : { value: null, reason: DETAIL_MISSING });
  const docs = typeof p?.docs_url === 'string' && p.docs_url.startsWith('https://') ? p.docs_url : null;
  return [
    { label: 'Category', ...v(categoryOf(p)) },
    { label: 'Status', ...v(Object.hasOwn(STATUS_WORDS, p?.status || '') ? STATUS_WORDS[p.status] : null) },
    { label: 'Plan', value: Object.hasOwn(TIER_LABEL, p?.tier || '') ? TIER_LABEL[p.tier] : 'Free', reason: null },
    { label: 'Sign-in', value: signInLabel(p), reason: null },
    { label: 'Documentation', ...v(docs), href: docs },
  ];
}

export function pageTitle(entry) {
  return entry?.state === 'ready' && entry.p?.display_name ? `${entry.p.display_name} · Connectors · Axal VC` : 'Connectors · Axal VC';
}
