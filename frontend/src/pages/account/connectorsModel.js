/**
 * D651 (#1463) — the Connectors page's pure rules: what each connector is
 * called, where it sits, what its status says, which rows a search keeps, and
 * where a return from a provider's sign-in lands. No React and no fetch, so
 * every rule here is held by `frontend/test/connectors_page_d651.test.mjs`.
 *
 * THE PAGE READS `/api/connectors` (D650, through `lib/api/connectors.js`).
 * The registry carries the fields the canvas draws beside each row:
 * `category`, `verified`, `pulls`, `sends`, `feeds` and `permissions`; a
 * connection carries the `company_ids` it serves. The three first-party
 * connectors (Google, Microsoft, LinkedIn) connect through their own routes.
 * Google Calendar and Microsoft 365 are also in the registry, as
 * `google_calendar` and `microsoft_365` (D650 lists them in `/available`):
 * those two entries are not drawn as rows of their own (`REGISTRY_ALIAS`,
 * D686 §5.4), their description fields fill the first-party rows instead.
 * A field none of them carries still says "Not recorded".
 */

import {
  memberDisconnectNote, PERSONAL_DOES, personalFeedsFallback, PERSONAL_LAST_SYNC, personalAttention, personalToolBanner,
} from './mercuryModel.js';

export const PAGE_SIZE = 10;

/**
 * D715 (#1780) decision 9: a member's own Mercury, the `mercury` row the
 * Worker serves a founder or a partner (`connection_source: 'integrations'`).
 * It reads only when asked and never syncs, so its words differ from every
 * other connector's. The connection-only rules test `provider_key`, because
 * the entity row never carries a member's connection.
 */
export const isPersonalMercury = (p) => p?.key === 'mercury' && !isEntityRow(p);
const isMercuryConn = (conn) => conn?.provider_key === 'mercury';

export const CATEGORY_ORDER = ['CRM', 'Payments', 'Accounting and banking', 'Calendar', 'Calendar and workspace', 'Messaging', 'Signing', 'Cap table', 'Data', 'Code', 'Design', 'Docs'];

/**
 * Build's own group order (D686 §5.4): the canvas's Code, Design, Payments,
 * Accounting and banking, Payroll, CRM, Calendar and workspace, then the rest.
 * The Connectors page keeps `CATEGORY_ORDER` for its chips.
 */
export const BUILD_CATEGORY_ORDER = ['Code', 'Design', 'Payments', 'Accounting and banking', 'Payroll', 'CRM', 'Calendar and workspace', 'Calendar', 'Messaging', 'Signing', 'Cap table', 'Data', 'Docs'];

/**
 * Registry entries that describe a first-party connector (D686 §5.4). The
 * registry's entry is not listed; its description fields merge into the
 * first-party row, which keeps its own key, name, status and connection.
 */
export const REGISTRY_ALIAS = Object.freeze({ google_calendar: 'google', microsoft_365: 'microsoft' });
const ALIAS_FIELDS = ['category', 'verified', 'pulls', 'sends', 'feeds', 'feed_modules', 'permissions'];

// The registry's `integration_type`, in the canvas's category words. Stripe is
// a `data_feed` in the registry and Payments on the canvas; it is the one key
// the type does not settle. D650's `category` replaces both maps.
const TYPE_CATEGORY = { crm: 'CRM', scheduling: 'Calendar', cap_table: 'Cap table', messaging: 'Messaging', e_sign: 'Signing', data_feed: 'Data' };
const KEY_CATEGORY = { stripe: 'Payments' };

export const TIER_LABEL = { growth: 'Growth', studio: 'Studio', pro: 'Pro' };

export function categoryOf(p) {
  return p?.category || KEY_CATEGORY[p?.key] || TYPE_CATEGORY[p?.integration_type] || null;
}

/**
 * The three connectors that live outside the registry. Each connects through
 * its own first-party route (`/api/calendar/google`, `/api/calendar/microsoft`,
 * `/api/linkedin`), whose token store stays the only one (D650 reads it rather
 * than copying it). They are drawn as connectors with the same row and sheet.
 */
export const FIRST_PARTY = [
  {
    key: 'google', display_name: 'Google Calendar', by: 'Google', category: 'Calendar and workspace',
    description: 'Your Google Calendar and Gmail invites, and "Continue with Google" sign-in.',
    capabilities: ['Calendar', 'Gmail invites', 'Sign in with Google'],
    status: 'live', tier: 'free', auth_type: 'oauth2', has_implementation: true, first_party: true,
  },
  {
    key: 'microsoft', display_name: 'Microsoft 365', by: 'Microsoft', category: 'Calendar and workspace',
    description: 'Two-way sync with your Outlook calendar, so sessions land on your work calendar.',
    capabilities: ['Calendar', 'Two-way sync'],
    status: 'live', tier: 'free', auth_type: 'oauth2', has_implementation: true, first_party: true,
  },
  {
    key: 'linkedin', display_name: 'LinkedIn', by: 'LinkedIn', category: 'Data',
    description: 'Sign in with LinkedIn to confirm who you are, then import your connections for referrals.',
    capabilities: ['Sign in with LinkedIn', 'Import connections (CSV)'],
    status: 'live', tier: 'free', auth_type: 'oauth2', has_implementation: true, first_party: true,
  },
];

const FIRST_PARTY_EMAIL = { google: 'google_email', microsoft: 'microsoft_email', linkedin: 'linkedin_email' };

/**
 * A registry connection with the companies it can serve: every company the
 * member belongs to, each marked by whether the connection's `company_ids`
 * holds it. When the member's companies could not be read (`companies` is
 * null), the connection carries none and the page says "Not recorded".
 */
export function withCompanies(conn, companies) {
  if (!conn || !Array.isArray(companies) || !Array.isArray(conn.company_ids)) return conn;
  const on = new Set(conn.company_ids.map(Number));
  return {
    ...conn,
    companies: companies
      .filter((c) => Number.isSafeInteger(Number(c?.id)))
      .map((c) => ({ company_id: Number(c.id), name: c.company_name || c.name || null, enabled: on.has(Number(c.id)) })),
  };
}

/** A first-party status read, as a connection row; null when not connected. */
export function firstPartyConnection(key, status) {
  if (!status || !status.connected) return null;
  return {
    uid: null,
    provider_key: key,
    first_party: true,
    status: 'active',
    external_account_name: status[FIRST_PARTY_EMAIL[key]] || null,
    last_synced_at: status.last_synced_at || null,
    last_error: null,
  };
}

/**
 * The catalogue the page draws: every registry provider, then the first-party
 * three, each with the member's connection (if any), whether they asked to be
 * told when it ships, and whether their plan locks it.
 *
 * `firstParty` is `{ google, microsoft, linkedin }`, each a status read or
 * null. A first-party connector whose status could not be read, or that is
 * not configured on this deployment, is still listed but cannot be connected.
 *
 * D751 (#1881): a registry OAuth connector whose client the Worker reports
 * unset (`configured: false`) is `oauthOff`. It is listed but cannot be
 * connected, unless it also takes a personal access token (Calendly,
 * HubSpot), which then becomes its only way in (`patOnly`). `true`, `null`
 * (unreadable) and a missing field keep today's behaviour, and an `api_key`
 * connector is never `oauthOff`: the member brings that key.
 */
export function buildCatalogue({ providers = [], items = [], waitlist = [], firstParty = {}, companies = null } = {}) {
  const byKey = new Map();
  for (const it of items || []) if (it && !byKey.has(it.provider_key)) byKey.set(it.provider_key, withCompanies(it, companies));
  const joined = new Set((waitlist || []).map((w) => w.provider_key));
  const out = [];
  const seen = new Set();
  const aliased = {};
  for (const p of providers || []) {
    if (!p?.key || seen.has(p.key)) continue;
    if (Object.hasOwn(REGISTRY_ALIAS, p.key)) {
      // Described here, connected by its first-party row: one row each.
      const into = REGISTRY_ALIAS[p.key];
      aliased[into] = { ...(aliased[into] || {}) };
      for (const f of ALIAS_FIELDS) if (p[f] !== undefined && p[f] !== null) aliased[into][f] = p[f];
      continue;
    }
    seen.add(p.key);
    const oauthOff = p.auth_type === 'oauth2' && p.configured === false;
    out.push({
      ...p,
      oauthOff,
      by: p.by || p.display_name,
      category: categoryOf(p),
      connection: byKey.get(p.key) || null,
      joined: joined.has(p.key),
      locked: !!(p.locked_for_user ?? p.tier_locked),
      available: p.status !== 'coming_soon' && p.has_implementation !== false && !(oauthOff && !p.supports_pat),
    });
  }
  for (const fp of FIRST_PARTY) {
    if (seen.has(fp.key)) continue;
    const status = firstParty[fp.key];
    out.push({
      ...fp,
      ...(aliased[fp.key] || {}),
      connection: firstPartyConnection(fp.key, status),
      joined: false,
      locked: false,
      // `configured: false` is the deployment saying it has no OAuth app for
      // this provider; an unread status is unknown, and neither can connect.
      available: !!status && status.configured !== false,
      unreadable: !status,
    });
  }
  return out;
}

/** Why a connection needs attention, in the canvas's words; '' when it does not. */
export function attentionReason(conn) {
  if (!conn) return '';
  const e = String(conn.last_error || '');
  // Decision 9: a member's Mercury says what is wrong with its token, never "sync".
  if (isMercuryConn(conn)) return e || (conn.status && conn.status !== 'active' && conn.status !== 'paused') ? personalAttention(e) : '';
  if (e.startsWith('rate_limited')) return 'Daily limit reached';
  if (/expired|invalid_grant|unauthori[sz]ed|\b401\b|revoked/i.test(e)) return 'Sign-in expired';
  if (e) return 'Last sync failed';
  if (conn.status && conn.status !== 'active' && conn.status !== 'paused') return 'Last sync failed';
  return '';
}

/**
 * The status a row and a sheet show. Syncing is the page's own knowledge (it
 * asked for a sync and the answer has not landed); the rest is the Worker's.
 */
export function connectionStatus(conn, p, { syncing = false } = {}) {
  if (!conn) return null;
  if (syncing) return { label: 'Syncing', tone: 'info', why: '' };
  const why = attentionReason(conn);
  if (why) return { label: 'Needs attention', tone: 'warn', why };
  if (conn.status === 'paused') return { label: 'Paused', tone: 'neutral', why: '' };
  if (p?.status === 'beta') return { label: 'Beta', tone: 'info', why: '' };
  return { label: 'Connected', tone: 'ok', why: '' };
}

/** "Pulls in", "Sends out" or "Both", from the registry's `pulls` and `sends`; null when it carries neither. */
export function doesLabel(p) {
  if (isPersonalMercury(p)) return PERSONAL_DOES;
  if (!Array.isArray(p?.pulls) && !Array.isArray(p?.sends)) return null;
  const pulls = (p.pulls || []).length > 0;
  const sends = (p.sends || []).length > 0;
  if (pulls && sends) return 'Both';
  if (pulls) return 'Pulls in';
  if (sends) return 'Sends out';
  return null;
}

function humanKey(k) {
  const s = String(k || '').replace(/[_-]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/**
 * The modules a connector fills: the Worker's `feed_modules` labels when it
 * sends them (D686 S18-A), else the registry's `feeds` keys made readable;
 * null when it names none.
 */
export function feedsLabel(p) {
  if (Array.isArray(p?.feed_modules) && p.feed_modules.length) {
    const labels = p.feed_modules.map((m) => (typeof m === 'string' ? m : m?.label || humanKey(m?.key))).filter(Boolean);
    if (labels.length) return labels.join(', ');
  }
  if (!Array.isArray(p?.feeds) || !p.feeds.length) return null;
  return p.feeds.map((f) => (typeof f === 'string' ? humanKey(f) : f?.label || humanKey(f?.key))).filter(Boolean).join(', ') || null;
}

/** Yours' Feeds: the Worker's feeds; for a member's Mercury that names none, its role's words (decision 9, D752). */
export function yoursFeedsLabel(p, role = null) {
  return feedsLabel(p) || (isPersonalMercury(p) ? personalFeedsFallback(role) : null);
}

/** One module a connector fills, named as the Worker names it (`feed_modules`), else its key made readable. */
export function moduleLabel(p, key) {
  const hit = Array.isArray(p?.feed_modules) ? p.feed_modules.find((m) => m && typeof m === 'object' && m.key === key) : null;
  return hit?.label || humanKey(key) || null;
}

/** "All", "2 of 3" or "None", from the connection's per-company scope; null when it is not known. */
export function companiesLabel(conn) {
  const list = conn?.companies;
  if (!Array.isArray(list)) return null;
  if (!list.length) return 'No company';
  const on = list.filter((c) => c.enabled !== false).length;
  if (on === list.length) return 'All';
  if (on === 0) return 'None';
  return `${on} of ${list.length}`;
}

/** A Worker time in ms: UTC whether or not it carries its zone (D1 writes `YYYY-MM-DD HH:MM:SS`). */
function utcTime(iso) {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${String(iso).replace(' ', 'T')}Z`);
}

/** Relative time, as the canvas writes it: "12 min ago", "3 h ago", "2 days ago". */
export function agoLabel(iso, now = Date.now()) {
  if (!iso) return null;
  const t = utcTime(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

/** A connection's last sync; "Not recorded · never ran" when it has none. A member's Mercury never syncs: "Read on request". */
export function lastSyncLabel(conn, now = Date.now()) {
  if (isMercuryConn(conn)) return PERSONAL_LAST_SYNC;
  return agoLabel(conn?.last_synced_at, now) || 'Not recorded · never ran';
}

// ---------- Yours ----------------------------------------------------------

export const YOURS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'connected', label: 'Connected' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'paused', label: 'Paused' },
];

export const YOURS_SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'sync', label: 'Last sync' },
  { id: 'status', label: 'Status' },
];

const STATUS_RANK = { 'Needs attention': 0, Syncing: 1, Connected: 2, Beta: 2, Paused: 3 };

/**
 * Whether a connector answers a search: its name, maker, category,
 * description, capabilities, what it pulls and sends, and the modules it
 * feeds. One rule for every list and for the "No connector called…" check,
 * so a query never finds a card while the page says it found nothing.
 */
export function matchesQuery(p, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  return [
    p.display_name, p.by, p.category, p.description, ...(p.capabilities || []),
    ...(p.pulls || []).map((x) => x?.what), ...(p.sends || []).map((x) => x?.what),
    feedsLabel(p),
  ].some((v) => String(v || '').toLowerCase().includes(needle));
}
const matches = matchesQuery;

/** The member's connectors, searched, filtered and sorted. */
export function yoursRows(catalogue, { q = '', filter = 'all', sort = 'name', syncing = {} } = {}) {
  const rows = (catalogue || [])
    .filter((p) => p.connection)
    .map((p) => ({ p, status: connectionStatus(p.connection, p, { syncing: !!syncing[p.key] }) }))
    .filter(({ p }) => matches(p, q))
    .filter(({ status }) => {
      if (filter === 'connected') return status.label === 'Connected' || status.label === 'Beta' || status.label === 'Syncing';
      if (filter === 'attention') return status.label === 'Needs attention';
      if (filter === 'paused') return status.label === 'Paused';
      return true;
    });
  const byName = (a, b) => a.p.display_name.localeCompare(b.p.display_name);
  if (sort === 'sync') {
    const t = (r) => Date.parse(r.p.connection.last_synced_at || '') || 0;
    rows.sort((a, b) => t(b) - t(a) || byName(a, b));
  } else if (sort === 'status') {
    rows.sort((a, b) => (STATUS_RANK[a.status.label] ?? 9) - (STATUS_RANK[b.status.label] ?? 9) || byName(a, b));
  } else {
    rows.sort(byName);
  }
  return rows;
}

/** One page of rows and the count line: "1–6 of 6". */
export function pageOf(rows, page) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(1, page || 1), pages);
  const from = total ? (p - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, p * PAGE_SIZE);
  return { rows: rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), page: p, pages, count: total ? `${from}–${to} of ${total}` : '0 of 0' };
}

// ---------- Discover -------------------------------------------------------

export const SUGGESTED = 'Suggested for you';

/**
 * D715 (#1780): the Axal entities' Mercury row, which the Worker serves an
 * admin on HQ only (`connection_source`, #1775). It is never a member's own
 * connector: it opens the entity sheet, and Build never shows it.
 */
export const ENTITY_SOURCE = 'mercury_entity_connections';
export const isEntityRow = (p) => p?.connection_source === ENTITY_SOURCE;

/** The button in a card's corner: "+", a check mark, "Notify me" or "We'll tell you"; Open for the entity row. */
export function cardAction(p) {
  // The entity row opens its sheet whatever `available`, `status` or `locked` say (D715 decision 2).
  if (isEntityRow(p)) return 'entity';
  if (!p.available && p.status === 'coming_soon') return p.joined ? 'joined' : 'notify';
  if (p.connection) return 'connected';
  if (!p.available) return 'unavailable';
  return 'add';
}

/** The pill at a card's foot. */
export function cardPill(p) {
  if (p.status === 'coming_soon') return { label: 'Coming soon', tone: 'neutral' };
  if (p.locked) return { label: TIER_LABEL[p.tier] || 'Paid plan', tone: 'info' };
  if (p.status === 'beta') return { label: 'Beta', tone: 'info' };
  return null;
}

/**
 * Discover's sections for the chosen chip. "All" draws Top connectors (those
 * that can be connected) and Coming soon; a category draws its own connectors.
 * "Suggested for you" is the `/suggestions` read for the active company,
 * handed in as `suggestions` (null when it could not be read). Each item
 * names its connector by `provider_key`.
 */
export function discoverSections(catalogue, chip = 'All', { q = '', suggestions = null } = {}) {
  const list = (catalogue || []).filter((p) => matches(p, q));
  if (chip === SUGGESTED) {
    if (!Array.isArray(suggestions)) return [{ title: SUGGESTED, cards: null }];
    const keyed = new Map(list.map((p) => [p.key, p]));
    const cards = suggestions.map((s) => {
      const p = keyed.get(s?.provider_key || s?.key);
      return p && { ...p, why: s.reason || '' };
    }).filter(Boolean);
    return [{ title: SUGGESTED, cards }];
  }
  if (chip !== 'All') {
    const cards = list.filter((p) => p.category === chip);
    return [{ title: chip, cards }];
  }
  // A connector this deployment cannot connect (a first-party one with no
  // OAuth app, a registry one whose OAuth client is unset (D751), or one whose
  // status could not be read) stays in Top, with its
  // reason in the corner; only the registry's own coming_soon is "Coming soon".
  const top = list.filter((p) => p.status !== 'coming_soon');
  const soon = list.filter((p) => p.status === 'coming_soon');
  const out = [{ title: 'Top connectors', cards: top }];
  if (soon.length) out.push({ title: 'Coming soon', cards: soon });
  return out;
}

// ---------- Getting here ---------------------------------------------------

/**
 * `/integrations` and `/account/integrations` both land here. The query and
 * the hash travel with the reader, because every provider's sign-in still
 * returns to `/integrations?…` and the page reads that query to say how the
 * sign-in went.
 */
export function connectorsRedirect({ search = '', hash = '' } = {}) {
  const ret = oauthReturn(search);
  if (!ret) return { pathname: '/account/connectors', search, hash };
  // D715 decision 3: Mercury has no sign-in. A return naming it is crafted and never reaches the Mercury page, whose mount makes the audited read.
  if (ret.key === 'mercury') return { pathname: '/account/connectors', search: stripReturn(search, ret.strip), hash };
  // D753 — a sign-in comes back to its own connector's page.
  return { pathname: connectorPagePath(ret.key), search, hash };
}

/** D753 — a connector's own page, for a valid key; the hub otherwise. */
export function connectorPagePath(key) {
  const k = codeWord(String(key || '').toLowerCase());
  return k && k.length <= 40 ? `/account/connectors/${k}` : '/account/connectors';
}

/** The once-only notice about the rename is remembered under this key. */
export const MOVED_SEEN_KEY = 'axal.connectors.movedSeen';

const CANCELLED = new Set(['access_denied', 'cancelled', 'canceled', 'user_cancelled', 'user_canceled', 'oauth_denied', 'consent_required']);

const GOOGLE_ERRORS = {
  email_mismatch: (ge) => `That Google account${ge ? ` (${ge})` : ''} doesn't match your StudioOS email. Sign in to Google with the same email and try again. Nothing was saved.`,
  google_already_linked_other_user: (ge) => `That Google account${ge ? ` (${ge})` : ''} is already connected to another Axal VC member. Disconnect it there first, then try again.`,
  email_unverified: (ge) => `Google reports ${ge || 'your account email'} as unverified. Verify it with Google, then try again. Nothing was saved.`,
};

/**
 * Where a return from a provider's sign-in lands: which connector's sheet
 * opens, on which view, with which banner, and which query keys to strip so a
 * reload does not replay it. null when the query carries no return.
 *
 *   ?oauth=ok&provider=hubspot            → hubspot, connected
 *   ?oauth=ok&provider=github             → github, sync (choose the repositories)
 *   ?oauth=error&provider=…&reason=access_denied → cancelled
 *   ?oauth=error&provider=…&reason=scope_overreach → overreach (D650's scope check; `overreach` too)
 *   ?oauth=error&provider=…&reason=not_configured | <key>_oauth_unconfigured → unconfigured (D751)
 *   ?oauth=error&provider=…&reason=company_not_linked → company (D751)
 *   ?oauth=error&provider=…&reason=…      → refused
 *   ?oauth=rolling_out&provider=…         → refused, "rolling out"
 *   ?google=connected | ?microsoft=connected | ?linkedin=connected → connected
 *   ?google=error&reason=…  | ?microsoft=error&reason=… | ?linkedin=error&linkedin_error=… → cancelled or refused
 *   ?linkedin=error&linkedin_error=not_configured → unconfigured (D751)
 */
const WORD = /^[a-z0-9_]+$/;
/** A query value the page may print: a lowercase code word, else nothing (a link-maker's sentence never reaches the sheet). */
export function codeWord(v) {
  const s = String(v || '');
  return WORD.test(s) ? s : '';
}

export function oauthReturn(search) {
  const p = new URLSearchParams(search || '');
  const oauth = p.get('oauth');
  if (oauth) {
    const key = codeWord((p.get('provider') || '').toLowerCase());
    const reason = codeWord(p.get('reason'));
    const strip = ['oauth', 'provider', 'reason'];
    if (!key) return null;
    // GitHub reads nothing until its repositories are chosen: its sign-in lands on that choice (D686 §5.4).
    if (oauth === 'ok') return { key, view: key === 'github' ? 'sync' : 'connected', reason: '', banner: '', strip };
    if (oauth === 'rolling_out') return { key, view: 'refused', reason: 'rolling_out', banner: 'rolling_out', strip };
    if (CANCELLED.has(reason)) return { key, view: 'cancelled', reason, banner: '', strip };
    // The Worker's word is `scope_overreach` (integrations.ts); `overreach` is kept for older links.
    if (reason === 'overreach' || reason === 'scope_overreach') return { key, view: 'overreach', reason, banner: '', strip };
    // D751: Axal holds no client, or the company is gone. Neither is the provider refusing.
    if (isUnconfigured(reason)) return { key, view: 'unconfigured', reason, banner: '', strip };
    if (reason === 'company_not_linked') return { key, view: 'company', reason, banner: '', strip };
    return { key, view: 'refused', reason, banner: '', strip };
  }
  for (const key of ['google', 'microsoft']) {
    const v = p.get(key);
    if (!v) continue;
    const strip = [key, 'warn', 'google_email', 'reason'];
    // The Google address is printed in the banner, so only an address-shaped value is.
    const ge = /^[^\s<>"'`]{1,254}@[^\s<>"'`]{1,254}$/.test(p.get('google_email') || '') ? p.get('google_email') : '';
    if (v === 'connected') {
      const banner = p.get('warn') === 'google_email_mismatch'
        ? `Connected, but the Google account${ge ? ` ${ge}` : ''} doesn't match your StudioOS email, so "Continue with Google" sign-in was not linked.`
        : '';
      return { key, view: 'connected', reason: '', banner, strip };
    }
    const reason = codeWord(p.get('reason')) || 'unknown';
    if (CANCELLED.has(reason)) return { key, view: 'cancelled', reason, banner: '', strip };
    // `reason` comes from the address: only the map's own keys are called, so
    // `?reason=constructor` or `toString` cannot reach Object's methods.
    const words = key === 'google' && Object.hasOwn(GOOGLE_ERRORS, reason) ? GOOGLE_ERRORS[reason](ge) : '';
    return { key, view: 'refused', reason, banner: words, strip };
  }
  const li = p.get('linkedin');
  if (li) {
    const strip = ['linkedin', 'linkedin_error'];
    if (li === 'connected') return { key: 'linkedin', view: 'connected', reason: '', banner: '', strip };
    const reason = codeWord(p.get('linkedin_error')) || 'unknown';
    if (CANCELLED.has(reason)) return { key: 'linkedin', view: 'cancelled', reason, banner: '', strip };
    if (isUnconfigured(reason)) return { key: 'linkedin', view: 'unconfigured', reason, banner: '', strip };
    return { key: 'linkedin', view: 'refused', reason, banner: '', strip };
  }
  return null;
}

/**
 * Build's venture across a provider's sign-in (D686 §5.4). Before the
 * redirect the project id is kept in `sessionStorage`, a per-viewer
 * convenience read in try/catch; `/build/connect` with no `?project_id=`
 * takes it back once.
 */
export const BUILD_PROJECT_KEY = 'studioos:build-connect-project';
const sess = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };
export function keepBuildProject(projectId, store = sess()) {
  const id = Number(projectId);
  if (!store || !Number.isSafeInteger(id) || id <= 0) return;
  try { store.setItem(BUILD_PROJECT_KEY, String(id)); } catch { /* storage off: the first venture is used */ }
}
export function takeBuildProject(store = sess()) {
  if (!store) return null;
  try {
    const id = Number(store.getItem(BUILD_PROJECT_KEY));
    store.removeItem(BUILD_PROJECT_KEY);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch { return null; }
}

/**
 * The panel `/build/connect` opens on (D686 §5.4): a sign-in's return
 * (`oauthReturn`), else `?tool=<key>`, which opens that tool where its list
 * row would (failing → `pre`, connected → `detail`, else `pre`). Only a key
 * the catalogue holds opens anything (D651's crafted-link rule). `strip` names
 * the query keys to remove, so a reload does not replay it.
 */
export function toolDeepLink(search, catalogue) {
  const ret = oauthReturn(search);
  // A venture has no use for Axal's own accounts (D715 decision 2).
  const list = (Array.isArray(catalogue) ? catalogue : []).filter((p) => !isEntityRow(p));
  if (ret) {
    // Mercury has no sign-in, so a return that names it is crafted, and opens nothing (D715 decision 3).
    const known = ret.key !== 'mercury' && list.some((p) => p.key === ret.key);
    return { panel: known ? { key: ret.key, view: ret.view, ret } : null, strip: ret.strip };
  }
  const p = new URLSearchParams(search || '');
  const key = codeWord((p.get('tool') || '').toLowerCase());
  if (!p.has('tool')) return null;
  const tool = key ? list.find((x) => x.key === key) : null;
  if (!tool) return { panel: null, strip: ['tool'] };
  // Where its row would open it (#1597): a failing tool's reconnect, a connected
  // one's detail, a locked one's plan; a tool that is coming soon or not set up
  // here has no step to open, so nothing opens.
  const state = toolRow(tool).state;
  const view = state === 'failing' ? 'pre' : tool.connection ? 'detail' : state === 'locked' ? 'pro'
    : state === 'soon' || state === 'unavailable' ? null : 'pre';
  return { panel: view ? { key: tool.key, view, ret: {} } : null, strip: ['tool'] };
}

/**
 * The success view's "Use as your <kind>" (D686 §5.4), from Build's
 * `GET /cycles/build/systems/choices`: offered only when exactly one core
 * system's choices hold this connection and the Worker says that kind names
 * no connector yet (`mapped: false`; a read without it offers nothing). The
 * body is the PUT's, keeping the row's Used by.
 */
const WORKSPACE_OF = Object.fromEntries(Object.entries(REGISTRY_ALIAS).map(([provider, key]) => [key, provider]));
export function coreSystemOffer(read, p, conn) {
  const workspace = WORKSPACE_OF[p?.key] || null;
  const uid = conn?.uid || null;
  if (!uid && !workspace) return null;
  const holds = (c) => (uid && c?.uid === uid) || (workspace && !c?.uid && c?.provider_key === workspace);
  const fits = (Array.isArray(read?.kinds) ? read.kinds : []).filter((k) => typeof k?.kind === 'string' && Array.isArray(k.choices) && k.choices.some(holds));
  if (fits.length !== 1 || fits[0].mapped !== false) return null;
  const k = fits[0];
  const used = typeof k.used_by === 'string' ? k.used_by : null;
  return {
    kind: k.kind,
    label: k.label || k.kind,
    body: k.kind === 'workspace' ? { provider_key: workspace, used_by: used } : { integration_uid: uid, used_by: used },
  };
}

/** The query left once a return has been read, so a reload does not replay it. */
export function stripReturn(search, keys) {
  const p = new URLSearchParams(search || '');
  for (const k of keys || []) p.delete(k);
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---------- The connect flow -----------------------------------------------

/**
 * How a connector is connected, which decides the flow's middle step:
 *   'oauth'       — sign in at the provider (the `signin` view, then a redirect);
 *   'key'         — paste an API key (the `key` view);
 *   'token_first' — HubSpot: a Private App token is the working path while its
 *                   public app waits on Marketplace review; OAuth is offered beside it;
 *   'first_party' — Google, Microsoft or LinkedIn's own sign-in route.
 */
export function authKind(p) {
  if (p?.first_party) return 'first_party';
  if (p?.auth_type === 'api_key') return 'key';
  if (p?.key === 'hubspot' && p?.supports_pat) return 'token_first';
  return 'oauth';
}

/**
 * D751 — Axal holds no client for this connector: `oauth_unconfigured`, any
 * `<key>_oauth_unconfigured`, the first-party starts' `oauth_config_missing`,
 * and the `not_configured` return. The match is on the code, never the
 * status: a 503 is also `provider_rolling_out`, and that one is `refused`.
 */
export function isUnconfigured(code) {
  const c = String(code || '');
  return c === 'oauth_unconfigured' || /_oauth_unconfigured$/.test(c) || c === 'oauth_config_missing' || c === 'not_configured';
}

/** Where a Super Admin sets a connector's keys (D751 decision 6). */
export const INTEGRATION_KEYS_HREF = '/admin?tab=integration-keys';

/** D751 (#1881): Axal holds no OAuth client, but the connector takes a personal access token, so the token is its only way in. */
export const patOnly = (p) => !!(p?.oauthOff && p?.supports_pat);

/**
 * D751 (#1881): the way to a connector's keys, for the one person who can set
 * them. A fixed same-app path, never a value from the Worker; null for anyone
 * who is not a Super Admin, a connector Axal is not missing a client for, a
 * coming-soon one, or the Axal entities' Mercury row.
 */
export function keysHref(p, { superAdmin = false } = {}) {
  if (!superAdmin || !p?.oauthOff || p.status === 'coming_soon' || isEntityRow(p)) return null;
  return INTEGRATION_KEYS_HREF;
}

/**
 * The Integration keys link for an `unconfigured` failure: the Worker's
 * `admin_href` when it is one of this app's admin tabs, else the console. A
 * crafted value (another host, `//`, a quote) never becomes a link (D651).
 */
export function adminKeysHref(data) {
  const h = data?.admin_href;
  return typeof h === 'string' && /^\/admin\?tab=[a-z0-9-]+$/.test(h) ? h : INTEGRATION_KEYS_HREF;
}

/**
 * The view a failed connect lands on, checked in this order:
 *   `pro`              — 402, the plan refusing it;
 *   `company`          — `active_company_required`: the connector writes project data and no company is chosen (D751);
 *   `unconfigured`     — Axal holds no client for it (`isUnconfigured`, D751);
 *   `setup_unreadable` — Axal could not read whether it does (#1880's 503; a retry can work);
 *   `badkey`           — a key the provider rejected;
 *   `refused`          — anything else, the provider's own refusal among them.
 * The overreach case arrives as the sign-in's return (`oauthReturn`), never here.
 */
export function connectFailure(e, p) {
  const code = e?.code || '';
  if (e?.status === 402) return 'pro';
  if (code === 'active_company_required') return 'company';
  if (isUnconfigured(code)) return 'unconfigured';
  if (code === 'oauth_setup_unreadable') return 'setup_unreadable';
  const kind = authKind(p);
  if ((kind === 'key' || kind === 'token_first') && (e?.status === 400 || code === 'connect_failed')) return 'badkey';
  return 'refused';
}

/** The sentence each state of the flow shows, in the canvas's words, with the connector's name. */
export function flowBanner(view, name, { reason = '', banner = '' } = {}) {
  if (banner && banner !== 'rolling_out') return banner;
  switch (view) {
    case 'cancelled': return 'The sign-in was cancelled. Nothing was connected.';
    case 'refused':
      if (banner === 'rolling_out') return `${name} is still rolling out. Nothing was connected.`;
      return `${name} refused access.${reason ? ` (${reason})` : ''} Ask your ${name} admin to allow Axal StudioOS, or try again.`;
    case 'badkey': return `That key is not valid. Check it at ${name} and paste it again.`;
    // D751: Axal's side, so never "refused" and never the provider's admin. On a
    // return the member did visit the provider, so nothing "was sent" is not said.
    case 'unconfigured':
      return reason
        ? `${name} isn't set up on Axal yet, so it can't be connected. Nothing was connected.`
        : `${name} isn't set up on Axal yet, so it can't be connected. Nothing was sent to ${name}.`;
    case 'company': return `${name} connects for one company. Choose a company in the sidebar, then connect again. Nothing was connected.`;
    case 'setup_unreadable': return `Axal couldn't check whether ${name} is set up. Nothing was sent to ${name}. Try again in a minute.`;
    case 'overreach': return 'This sign-in asked for more than StudioOS uses. Nothing was connected. Report it, or try again.';
    case 'pro': return null;
    default: return null;
  }
}

/** What a disconnect does, said before the click; a member's Mercury in their role's words (D752). */
export function disconnectNote(p, role = null) {
  if (isPersonalMercury(p)) return memberDisconnectNote(role);
  if (p?.first_party) {
    if (p.key === 'google') return 'Calendar and Gmail access stop, and "Continue with Google" sign-in is unlinked. Events already in StudioOS stay.';
    if (p.key === 'linkedin') return 'Contacts you already imported stay in Refer & Earn.';
    return 'Calendar sync stops. Events already in StudioOS stay.';
  }
  return 'Data already in StudioOS stays. The stored credentials are deleted.';
}

// ---------- Build › Connect a tool -----------------------------------------

export const TOOL_FILTERS = ['All', 'Connected', 'Not connected', 'Failing'];

/**
 * A tool's state in Build's sheet: connected, failing, not connected, coming
 * soon, or not set up here (a first-party connector with no OAuth app, or a
 * registry one whose OAuth client is unset, D751).
 */
export function toolState(p) {
  if (p.connection) return attentionReason(p.connection) ? 'failing' : 'connected';
  if (p.status === 'coming_soon') return 'soon';
  if (!p.available) return 'unavailable';
  return 'not_connected';
}

/**
 * Build's list: grouped by category in Build's order, searched and filtered.
 * `pin` names a category to draw first: the failing tool's, while the failed
 * banner shows, so the tool the banner names is in view.
 */
export function toolGroups(catalogue, { q = '', filter = 'All', pin = null } = {}) {
  const keep = (p) => {
    const s = toolState(p);
    if (filter === 'Connected') return s === 'connected';
    if (filter === 'Not connected') return s === 'not_connected' || s === 'soon' || s === 'unavailable';
    if (filter === 'Failing') return s === 'failing';
    return true;
  };
  const list = (catalogue || []).filter((p) => !isEntityRow(p) && matches(p, q) && keep(p));
  const groups = [];
  for (const cat of [...BUILD_CATEGORY_ORDER, null]) {
    const rows = list.filter((p) => (cat === null ? !BUILD_CATEGORY_ORDER.includes(p.category) : p.category === cat))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    if (rows.length) groups.push({ label: cat || 'Other', rows });
  }
  if (pin) {
    const at = groups.findIndex((g) => g.label === pin || (pin === 'Other' && g.label === 'Other'));
    if (at > 0) groups.unshift(...groups.splice(at, 1));
  }
  return { groups, total: list.length };
}

/**
 * Whose company Build's connections serve (D686 §5.4): the project's own,
 * not the sidebar's. `project` is `GET /projects/:id` (or null when it could
 * not be read); `companies` the member's memberships (or null).
 *   none      the project has no company: nothing a tool reads can feed it.
 *   outside   the member is not in that company: they cannot connect for it.
 *   unreadable the project or the memberships could not be read.
 *   ok        connect, sign-in, teammate and suggestions send this company.
 */
export function projectCompany(project, companies) {
  if (project === undefined) return { state: 'loading', companyId: null, name: null };
  if (!project) return { state: 'unreadable', companyId: null, name: null };
  const id = Number(project.company_id);
  if (!Number.isSafeInteger(id) || id <= 0) return { state: 'none', companyId: null, name: null };
  if (!Array.isArray(companies)) return { state: 'unreadable', companyId: id, name: null };
  const mine = companies.find((c) => Number(c?.id) === id);
  if (!mine) return { state: 'outside', companyId: id, name: null };
  return { state: 'ok', companyId: id, name: mine.company_name || mine.name || null };
}

/** The sentence above Build's list for a company it cannot connect for; null when it can. */
export function companyBanner(scope) {
  if (scope.state === 'none') return 'This project has no company, so connected tools cannot feed it.';
  if (scope.state === 'outside') return 'You are not a member of this project\u2019s company, so you cannot connect tools for it.';
  if (scope.state === 'unreadable') return 'This project\u2019s company could not be read. Connected tools are listed, but connecting waits until it can be.';
  return null;
}

/** Whether a registry connection already serves the project's company; null when it cannot be told. */
export function servesCompany(conn, companyId) {
  if (!conn || conn.first_party || !companyId || !Array.isArray(conn.company_ids)) return null;
  return conn.company_ids.map(Number).includes(Number(companyId));
}

/** The company set `PUT /:uid/companies` takes to add the project's: the route replaces the set, so the enabled ones go too. */
export function companiesWith(conn, companyId) {
  const ids = (Array.isArray(conn?.company_ids) ? conn.company_ids : []).map(Number).filter(Number.isSafeInteger);
  return [...new Set([...ids, Number(companyId)])];
}

/** The plan a locked tool needs, in the Worker's tier words; never the canvas's placeholder "Pro". */
export const UPGRADE_TIER = Object.freeze({ growth: 'Growth', studio: 'Studio' });

/**
 * One row of Build's list (D686 §3.1 items 2 and 5): its line under the name,
 * its pill, and the one action it offers.
 *   failing   "Sign-in expired" → reconnect; "Last sync failed" → retry
 *             (a sync); "Daily limit reached" → none: waiting is the fix.
 *   connected → disconnect (with an inline confirm); the name opens its detail.
 *   locked    → the real tier's pill and "Upgrade to Growth" / "to Studio".
 *   soon      → "Will feed …", no action.
 */
export function toolRow(p) {
  const s = toolState(p);
  const feeds = feedsLabel(p);
  const tier = UPGRADE_TIER[p.tier] || null;
  if (p.locked && !p.connection && p.available) {
    return { state: 'locked', pill: [tier || 'Paid plan', 'info'], detail: feeds ? `Feeds ${feeds}` : (p.capabilities || []).slice(0, 2).join(', '),
      action: 'upgrade', actionLabel: tier ? `Upgrade to ${tier}` : 'See plans' };
  }
  // Decision 9: a member's Mercury has no sync to try again; its fix is a new token.
  if (s === 'failing' && isPersonalMercury(p)) {
    return { state: s, pill: ['Failing', 'danger'], detail: attentionReason(p.connection), action: 'reconnect', actionLabel: 'Reconnect' };
  }
  if (s === 'failing') {
    const why = attentionReason(p.connection);
    const action = why === 'Sign-in expired' ? 'reconnect' : why === 'Last sync failed' ? 'retry' : null;
    return { state: s, pill: ['Failing', 'danger'], detail: `${why} · last good sync ${lastSyncLabel(p.connection)}`,
      action, actionLabel: action === 'reconnect' ? 'Reconnect' : action === 'retry' ? 'Try again' : null };
  }
  if (s === 'connected') {
    const synced = isPersonalMercury(p) ? ` · ${PERSONAL_LAST_SYNC.toLowerCase()}` : p.connection.last_synced_at ? ` · synced ${lastSyncLabel(p.connection)}` : ' · last sync not recorded';
    return { state: s, pill: ['Connected', 'ok'], detail: `${feeds ? `Feeds ${feeds}` : (p.capabilities || []).slice(0, 2).join(', ')}${synced}`, action: 'disconnect', actionLabel: 'Disconnect' };
  }
  if (s === 'soon') return { state: s, pill: ['Coming soon', 'neutral'], detail: feeds ? `Will feed ${feeds}` : 'What it will feed is not recorded', action: null, actionLabel: null };
  if (s === 'unavailable') return { state: s, pill: [p.unreadable ? 'Status unreadable' : 'Not set up here', 'neutral'], detail: feeds ? `Feeds ${feeds}` : (p.capabilities || []).slice(0, 2).join(', '), action: null, actionLabel: null };
  return { state: s, pill: ['Not connected', 'neutral'], detail: feeds ? `Feeds ${feeds}` : (p.capabilities || []).slice(0, 2).join(', '), action: 'connect', actionLabel: 'Connect' };
}

/**
 * "Try again"'s answer, in words: the Worker's sentence for a refusal it can
 * explain, Reconnect when the tool has no sync of its own (422).
 */
export function retryOutcome(e) {
  if (!e) return { tone: 'ok', text: 'Synced.', reconnect: false };
  const code = e?.code || e?.data?.error || e?.data?.detail || '';
  if (e?.status === 422 || code === 'sync_not_supported') return { tone: 'warn', text: 'This tool has no sync of its own. Reconnect it instead.', reconnect: true };
  return { tone: 'danger', text: e?.message || 'The sync failed.', reconnect: false };
}

/**
 * "3 Oct · 14:05": when a sync failed, from the Worker's `last_error_at`
 * (UTC, with or without its zone, as `agoLabel` reads it), drawn in the
 * viewer's zone. Null when it is not a time.
 */
export function failedAt(iso, timeZone = undefined) {
  if (!iso) return null;
  const t = utcTime(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  try {
    const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(d);
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(d);
    return `${day} · ${time}`;
  } catch { return null; }
}

/** The locked banner's and the paid-plan panel's promise (D686 §3.1 item 3): a manual sync is not tier-gated since #1611. */
export const FREE_KEEPS_TOOLS = 'Free keeps every tool you have already connected.';
export const FREE_KEEPS_CONNECTORS = 'Free keeps every connector you already have.';

/** The banner above Build's list: a failing tool first, then a locked one; null when neither. */
export function toolBanner(catalogue, { timeZone } = {}) {
  const failing = (catalogue || []).find((p) => toolState(p) === 'failing');
  if (failing && isPersonalMercury(failing)) {
    return { tone: 'danger', view: 'failed', key: failing.key, text: personalToolBanner(failing.connection.last_error) };
  }
  if (failing) {
    // "<Name> sync failed at <D Mon> · <HH:MM>. <feeds> shows the last good data." (D686 §5.4);
    // without the Worker's failure time, the last good sync is the sentence.
    const at = failedAt(failing.connection.last_error_at, timeZone);
    const feeds = feedsLabel(failing);
    const when = agoLabel(failing.connection.last_synced_at);
    return {
      tone: 'danger',
      view: 'failed',
      key: failing.key,
      text: at
        ? `${failing.display_name} sync failed at ${at}. ${feeds ? `${feeds} ${feeds.includes(',') ? 'show' : 'shows'}` : 'What it feeds shows'} the last good data.`
        : `${failing.display_name}: ${attentionReason(failing.connection).toLowerCase()}. ${when ? `The last good sync was ${when}; ` : ''}what it feeds keeps the last good data.`,
    };
  }
  const locked = (catalogue || []).find((p) => p.locked && p.available && !p.connection);
  if (locked) {
    return {
      tone: 'neutral',
      view: 'locked',
      text: `${locked.category ? `${locked.category} connections` : locked.display_name} ${locked.category ? 'are' : 'is'} part of the ${TIER_LABEL[locked.tier] || 'paid'} plan. ${FREE_KEEPS_TOOLS}`,
    };
  }
  return null;
}
