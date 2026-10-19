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

// ---------- The body (D753 #1955, F7) ---------------------------------------
//
// About, Tools, Prompts, the trust notice and Details, drawn from the
// connector object the Worker describes (D753 decision 4(b)). Every sentence
// comes from that object; a field it does not carry reads "Not recorded" with
// `DETAIL_MISSING`, never a guess. `capabilities` is never read here: some
// claim more than the code does (decision 5).

/** A link the page may draw: an absolute `https:` URL, else null. */
export function safeHref(u) {
  if (typeof u !== 'string' || !u) return null;
  try { return new URL(u).protocol === 'https:' ? u : null; } catch { return null; }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `added` (`YYYY-MM`) as "October 2026"; null for anything else. */
export function addedLabel(added) {
  const m = typeof added === 'string' ? /^(\d{4})-(\d{2})$/.exec(added) : null;
  const month = m ? Number(m[2]) : 0;
  return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${m[1]}` : null;
}

/** "Automatically" or "Asks first". A pull has no mode: Axal VC reads it on every sync. */
export const modeLabel = (x) => (x?.default_mode === 'ask' ? 'Asks first' : 'Automatically');

export const TOOL_GROUPS = [
  { access: 'read', label: 'Reads' },
  { access: 'write', label: 'Writes' },
  { access: 'account', label: 'Keeps the connection working' },
  { access: 'inbound', label: 'Calls Axal VC' },
];

/** The tools by access, in decision 3's order; empty groups and unknown access values are left out. */
export function toolGroups(tools) {
  const list = Array.isArray(tools) ? tools.filter((t) => t && typeof t.label === 'string' && t.label) : [];
  return TOOL_GROUPS
    .map((g) => ({ ...g, tools: list.filter((t) => t.access === g.access) }))
    .filter((g) => g.tools.length);
}

/** The sign-in kinds that open the service's own sign-in page, so SIGN-IN URL is drawn. */
const SIGNS_IN = new Set(['oauth', 'oauth_or_token', 'oauth_or_key', 'first_party']);

/**
 * Details (decision 3 item 10): MADE BY, SERVICE, CATEGORY, SIGN-IN,
 * CONNECTOR URL (and SIGN-IN URL for a sign-in connector), ADDED, STATUS,
 * PLAN and MORE INFO. Each row is `{ label, value, reason, kind, href?, links? }`.
 * STATUS and PLAN are F1's, from the catalogue row `p`.
 */
export function bodyDetailsRows(connector, p) {
  const c = connector || {};
  const v = (value, extra = {}) => (value ? { value, reason: null, ...extra } : { value: null, reason: DETAIL_MISSING, ...extra });
  const f1 = Object.fromEntries(detailsRows(p).map((r) => [r.label, r]));
  const endpoints = c.endpoints || {};
  const links = c.links || {};
  const more = [
    { label: 'Documentation', href: safeHref(links.help) || safeHref(links.developer_docs) },
    { label: 'Support', href: safeHref(links.support) },
    { label: 'Privacy Policy', href: safeHref(links.privacy) },
  ].filter((l) => l.href);
  const rows = [
    { label: 'Made by', ...v(c.made_by?.name || null) },
    { label: 'Service', ...v(c.service?.name || null, { href: safeHref(c.service?.href) }) },
    { label: 'Category', ...v(c.category || categoryOf(p), { kind: 'chip' }) },
    { label: 'Sign-in', ...v(c.sign_in?.label || null) },
    { label: 'Connector URL', ...v(typeof endpoints.api === 'string' ? endpoints.api : null, { kind: 'mono' }) },
  ];
  if (SIGNS_IN.has(c.sign_in?.kind)) {
    rows.push({ label: 'Sign-in URL', ...v(typeof endpoints.sign_in === 'string' ? endpoints.sign_in : null, { kind: 'mono' }) });
  }
  rows.push(
    { label: 'Added', ...v(addedLabel(c.added)) },
    { label: 'Status', value: f1.Status.value, reason: f1.Status.reason },
    { label: 'Plan', value: f1.Plan.value, reason: f1.Plan.reason },
    { label: 'More info', ...v(more.length ? more.map((l) => l.label).join(', ') : null, { kind: 'links', links: more }) },
  );
  return rows;
}

/** The header's line: the body's tagline when it has one, else F1's (the catalogue description). */
export function headerTagline(p, connector) {
  return (typeof connector?.tagline === 'string' && connector.tagline) || p?.description || '';
}
