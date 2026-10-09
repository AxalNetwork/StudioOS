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
 * connectors (Google, Microsoft, LinkedIn) are not in the registry, so a field
 * they do not carry still says "Not recorded" rather than inventing one. Their
 * category is the one field filled in here.
 */

export const PAGE_SIZE = 10;

export const CATEGORY_ORDER = ['CRM', 'Payments', 'Calendar', 'Messaging', 'Signing', 'Cap table', 'Data', 'Code', 'Design', 'Docs'];

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
    key: 'google', display_name: 'Google Calendar', by: 'Google', category: 'Calendar',
    description: 'Your Google Calendar and Gmail invites, and "Continue with Google" sign-in.',
    capabilities: ['Calendar', 'Gmail invites', 'Sign in with Google'],
    status: 'live', tier: 'free', auth_type: 'oauth2', has_implementation: true, first_party: true,
  },
  {
    key: 'microsoft', display_name: 'Microsoft 365', by: 'Microsoft', category: 'Calendar',
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
 */
export function buildCatalogue({ providers = [], items = [], waitlist = [], firstParty = {}, companies = null } = {}) {
  const byKey = new Map();
  for (const it of items || []) if (it && !byKey.has(it.provider_key)) byKey.set(it.provider_key, withCompanies(it, companies));
  const joined = new Set((waitlist || []).map((w) => w.provider_key));
  const out = [];
  const seen = new Set();
  for (const p of providers || []) {
    if (!p?.key || seen.has(p.key)) continue;
    seen.add(p.key);
    out.push({
      ...p,
      by: p.by || p.display_name,
      category: categoryOf(p),
      connection: byKey.get(p.key) || null,
      joined: joined.has(p.key),
      locked: !!(p.locked_for_user ?? p.tier_locked),
      available: p.status !== 'coming_soon' && p.has_implementation !== false,
    });
  }
  for (const fp of FIRST_PARTY) {
    if (seen.has(fp.key)) continue;
    const status = firstParty[fp.key];
    out.push({
      ...fp,
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

/** The modules a connector fills, from the registry's `feeds`; null when it names none. */
export function feedsLabel(p) {
  if (!Array.isArray(p?.feeds) || !p.feeds.length) return null;
  return p.feeds.map((f) => (typeof f === 'string' ? humanKey(f) : f?.label || humanKey(f?.key))).filter(Boolean).join(', ') || null;
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

/** Relative time, as the canvas writes it: "12 min ago", "3 h ago", "2 days ago". */
export function agoLabel(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${String(iso).replace(' ', 'T')}Z`);
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

/** A connection's last sync; "Not recorded · never ran" when it has none. */
export function lastSyncLabel(conn, now = Date.now()) {
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

/** The chips: All, Suggested for you, then each category the catalogue holds, in the canvas's order. */
export function discoverChips(catalogue) {
  const present = new Set((catalogue || []).map((p) => p.category).filter(Boolean));
  return ['All', SUGGESTED, ...CATEGORY_ORDER.filter((c) => present.has(c))];
}

/** The button in a card's corner: "+", a check mark, "Notify me" or "We'll tell you". */
export function cardAction(p) {
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
  // OAuth app, or one whose status could not be read) stays in Top, with its
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
  return { pathname: '/account/connectors', search, hash };
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
 *   ?oauth=error&provider=…&reason=access_denied → cancelled
 *   ?oauth=error&provider=…&reason=overreach     → overreach (D650's scope check)
 *   ?oauth=error&provider=…&reason=…      → refused
 *   ?oauth=rolling_out&provider=…         → refused, "rolling out"
 *   ?google=connected | ?microsoft=connected | ?linkedin=connected → connected
 *   ?google=error&reason=…  | ?microsoft=error&reason=… | ?linkedin=error&linkedin_error=… → cancelled or refused
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
    if (oauth === 'ok') return { key, view: 'connected', reason: '', banner: '', strip };
    if (oauth === 'rolling_out') return { key, view: 'refused', reason: 'rolling_out', banner: 'rolling_out', strip };
    if (CANCELLED.has(reason)) return { key, view: 'cancelled', reason, banner: '', strip };
    if (reason === 'overreach') return { key, view: 'overreach', reason, banner: '', strip };
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
    return { key: 'linkedin', view: 'refused', reason, banner: '', strip };
  }
  return null;
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
 * The view a failed connect lands on. 402 is the plan refusing it (`pro`); a
 * key the provider rejected is `badkey`; anything else is `refused`. The
 * overreach case arrives as the sign-in's return (`oauthReturn`), never here.
 */
export function connectFailure(e, p) {
  const code = e?.code || '';
  if (e?.status === 402) return 'pro';
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
    case 'overreach': return 'This sign-in asked for more than StudioOS uses. Nothing was connected. Report it, or try again.';
    case 'pro': return null;
    default: return null;
  }
}

/** What a disconnect does, said before the click. */
export function disconnectNote(p) {
  if (p?.first_party) {
    if (p.key === 'google') return 'Calendar and Gmail access stop, and "Continue with Google" sign-in is unlinked. Events already in StudioOS stay.';
    if (p.key === 'linkedin') return 'Contacts you already imported stay in Refer & Earn.';
    return 'Calendar sync stops. Events already in StudioOS stay.';
  }
  return 'Data already in StudioOS stays. The stored credentials are deleted.';
}

// ---------- Build › Connect a tool -----------------------------------------

export const TOOL_FILTERS = ['All', 'Connected', 'Not connected', 'Failing'];

/** A tool's state in Build's sheet: connected, failing, not connected, coming soon, or not set up here. */
export function toolState(p) {
  if (p.connection) return attentionReason(p.connection) ? 'failing' : 'connected';
  if (p.status === 'coming_soon') return 'soon';
  if (!p.available) return 'unavailable';
  return 'not_connected';
}

/** Build's list: grouped by category in the canvas's order, searched and filtered. */
export function toolGroups(catalogue, { q = '', filter = 'All' } = {}) {
  const keep = (p) => {
    const s = toolState(p);
    if (filter === 'Connected') return s === 'connected';
    if (filter === 'Not connected') return s === 'not_connected' || s === 'soon' || s === 'unavailable';
    if (filter === 'Failing') return s === 'failing';
    return true;
  };
  const list = (catalogue || []).filter((p) => matches(p, q) && keep(p));
  const groups = [];
  for (const cat of [...CATEGORY_ORDER, null]) {
    const rows = list.filter((p) => (cat === null ? !CATEGORY_ORDER.includes(p.category) : p.category === cat))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    if (rows.length) groups.push({ label: cat || 'Other', rows });
  }
  return { groups, total: list.length };
}

/** The banner above Build's list: a failing tool first, then a locked one; null when neither. */
export function toolBanner(catalogue) {
  const failing = (catalogue || []).find((p) => toolState(p) === 'failing');
  if (failing) {
    const when = agoLabel(failing.connection.last_synced_at);
    return {
      tone: 'danger',
      view: 'failed',
      text: `${failing.display_name}: ${attentionReason(failing.connection).toLowerCase()}. ${when ? `The last good sync was ${when}; ` : ''}what it feeds keeps the last good data.`,
    };
  }
  const locked = (catalogue || []).find((p) => p.locked && p.available && !p.connection);
  if (locked) {
    return {
      tone: 'neutral',
      view: 'locked',
      text: `${locked.category ? `${locked.category} connections` : locked.display_name} ${locked.category ? 'are' : 'is'} part of the ${TIER_LABEL[locked.tier] || 'paid'} plan.`,
    };
  }
  return null;
}
