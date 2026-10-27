/**
 * #2479 — Account › Builder › MCP and services (`/account/builder`), the
 * canvas "Account · Builder · MCP and services" (`design/incoming/MCP Services
 * Page.dc.html`, MCPX1–MCPX13), as pure rules. No React and no fetch, so
 * `frontend/test/mcp_services_model.test.mjs` holds them.
 *
 * EVERY VALUE IS A WORKER READ THAT HAS LANDED:
 *   GET /api/connectors/assistants   the member's assistant grants (D666); 404 = the MCP server is off
 *   GET /api/developer/keys          the member's API keys (D841); 404 = keys are off
 *   GET /api/developer/limits        the limits in force (D849)
 *   GET /api/connectors              the member's connections (D751)
 *   GET /api/connectors/available    the catalogue, for each connection's name (D753)
 *   GET /api/connectors/health       each connection's health and its last ten checks (D848)
 * The tool list (D846's tool read) has not landed, so Tools and a service's
 * tools say so; nothing here copies a tool, a price or a limit.
 */
import { MCP_SERVER_URL } from '../assistantSetup';
import { agoLabel, attentionReason, connectionStatus, connectorPagePath } from '../connectorsModel';

export { MCP_SERVER_URL };

/** A read as the page holds it: `{ status: 'loading' | 'ready' | 'off' | 'unreadable' | 'refused', data }`. */
export function readOf(promiseResult) {
  if (!promiseResult) return { status: 'loading', data: null };
  if (promiseResult.ok) return { status: 'ready', data: promiseResult.value };
  const e = promiseResult.error;
  if (e?.status === 404) return { status: 'off', data: null };
  if (e?.status === 403) return { status: 'refused', data: null };
  return { status: 'unreadable', data: null };
}

// ─────────────────────────────────────────────── who is reading

/**
 * What this account can do here (MCPX1, MCPX6, MCPX7). Today's StudioOS tools
 * work on a founder's own companies, so only an owner has anything to approve:
 *   - `owner`    a Founder, or any profile with an admitted Spin-Out Lab project;
 *   - `none`     an Investor, Advisor, Operating Partner or Admin;
 *   - `explorer` no profile yet: connectors open once it is set.
 * `superAdmin` adds MCPX7's line about platform keys.
 */
export function audienceOf(role, user) {
  const r = String(role || user?.role || '').toLowerCase();
  const lab = Number(user?.spinout_lab_active ?? 0) === 1 && user?.founder_id != null;
  const superAdmin = r === 'super_admin' || (r === 'admin' && Number(user?.is_super_admin ?? 0) === 1);
  if (r === 'exploring' || r === 'explorer') return { kind: lab ? 'owner' : 'explorer', superAdmin: false, lab };
  if (r === 'founder' || lab) return { kind: 'owner', superAdmin, lab: lab && r !== 'founder' };
  return { kind: 'none', superAdmin, lab: false };
}

export const NOTHING_TO_APPROVE = 'StudioOS’s tools today read and write a founder’s Validate work, for companies the founder owns. Your profile owns none, so an assistant or key could connect but reach nothing.';
export const EXPLORER_SERVICES = 'Connectors open once your profile is set.';
export const SUPER_ADMIN_KEYS = 'Platform keys for connectors are set in HQ › Integration keys.';
export const LAB_NOTE = 'You see this for your Spin-Out Lab project only.';

// ─────────────────────────────────────────────── Card 1, the endpoint

export const SERVER_WORDS = Object.freeze({
  on: 'On',
  off: 'Switched off',
  offLine: 'Connecting to StudioOS is switched off for now.',
  assistantSignIn: 'Assistant sign-in: your assistant opens StudioOS, you approve the companies. Nothing to paste.',
  checkedLine: 'Every call is checked again on the server: your account, the company, the permission and the limit.',
  keysOff: 'API keys are not available yet.',
});

/** The server's state, from the grants read: the Worker answers 404 while MCP_SERVER_ENABLED is off. */
export const serverState = (grants) => (grants.status === 'off' ? 'off' : grants.status === 'loading' ? 'loading' : 'on');

/**
 * The API key row and Card 2's key line: how many keys are live and how many
 * expire within `soonDays`. A switched-off or unread read is said, never 0.
 */
export function keysSummary(keys, now = Date.now(), soonDays = 14) {
  if (keys.status === 'loading') return { state: 'loading' };
  if (keys.status === 'off' || keys.data?.enabled === false) return { state: 'off', line: SERVER_WORDS.keysOff };
  if (keys.status !== 'ready') return { state: 'unreadable', line: 'Your API keys could not be read. That is not the same as having none.' };
  const time = (v) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${String(v).replace(' ', 'T')}Z`);
  const live = (Array.isArray(keys.data?.keys) ? keys.data.keys : [])
    .filter((k) => !k?.revoked_at && !(k?.expires_at && !(time(k.expires_at) > now)));
  const soon = live.filter((k) => k.expires_at && time(k.expires_at) - now <= soonDays * 86_400_000);
  const days = soon.length ? Math.max(0, Math.ceil(Math.min(...soon.map((k) => time(k.expires_at) - now)) / 86_400_000)) : null;
  return {
    state: 'ready', active: live.length, expiring: soon.length, days,
    line: `${live.length} active${soon.length ? ` · ${soon.length} expires in ${days} ${days === 1 ? 'day' : 'days'}` : ''}`,
  };
}

// ─────────────────────────────────────────────── Card 2, who can call

/**
 * One connected assistant (MCPX1's row, DEV1). Its name is self-declared
 * (D668) and the grants read carries no verification yet, so the host leads
 * and every row reads "Unrecognised assistant". A missing last call is "No
 * call recorded", never a claim that it went unused: the record expires after 31 days.
 */
export function assistantRow(g) {
  const day = (v) => (v ? String(v).slice(0, 10) : null);
  const companies = (Array.isArray(g?.companies) ? g.companies : []).map((c) => c?.name || `Company #${c?.id}`);
  return {
    id: g?.id == null ? null : String(g.id),
    host: String(g?.redirect_host || '').trim() || null,
    calledItself: String(g?.client_name || '').trim() || null,
    recognised: false,
    recognition: 'Unrecognised assistant',
    companies,
    companiesLine: companies.length ? companies.join(', ') : 'No company recorded',
    connected: day(g?.connected_at),
    lastCall: day(g?.last_used_at),
    lastCallLine: day(g?.last_used_at) ? `Last call ${day(g.last_used_at)}` : 'No call recorded',
    // D846's scopes are not on the grants read yet.
    permissions: Array.isArray(g?.scopes) ? g.scopes : null,
  };
}

export const NO_CALLERS = 'No assistant or API key can call StudioOS yet.';

// ─────────────────────────────────────────────── Health (D848)

const CATEGORY_WORDS = Object.freeze({
  auth: 'sign-in refused', rate_limited: 'rate limited', not_found: 'not found',
  invalid_input: 'request refused', provider_down: 'service down', unknown: 'unknown error',
});

/**
 * A connection's health, separate from its state: "Healthy", "Slow",
 * "Failing: [reason]", or "Not checked yet" when no check has run (a connector
 * without the contract, or one not yet reached). `unreadable` when the health
 * read failed: the state pill still shows.
 */
export function healthPill(health, { unreadable = false } = {}) {
  if (unreadable) return { label: 'Health unreadable', tone: 'muted', key: 'unreadable' };
  const s = health?.state ?? null;
  if (s === 'ok') return { label: 'Healthy', tone: 'positive', key: 'ok' };
  if (s === 'degraded') return { label: 'Slow', tone: 'amber', key: 'degraded' };
  if (s === 'expired') return { label: 'Failing: sign-in expired', tone: 'destructive', key: 'failing' };
  if (s === 'disconnected') return { label: 'Failing: disconnected', tone: 'destructive', key: 'failing' };
  if (s === 'error') return { label: `Failing: ${CATEGORY_WORDS[health?.error_category] || CATEGORY_WORDS.unknown}`, tone: 'destructive', key: 'failing' };
  return { label: 'Not checked yet', tone: 'muted', key: 'unchecked' };
}

/** "checked 12 min ago", or null when no check has run. */
export const checkedLine = (health, now = Date.now()) => {
  const ago = agoLabel(health?.checked_at, now);
  return ago ? `checked ${ago}` : null;
};

/**
 * MCPX3's strip: the last ten checks, oldest left. A slot with no check is an
 * outline (`unchecked`), never a filled square, and the line counts only the
 * checks that ran.
 */
export function checkStrip(checks, slots = 10) {
  const ran = (Array.isArray(checks) ? checks : []).slice(0, slots).reverse();
  const cells = [...Array.from({ length: Math.max(0, slots - ran.length) }, () => ({ key: 'unchecked', label: 'Not checked' })),
    ...ran.map((c) => { const p = healthPill(c); return { key: p.key, label: p.label }; })];
  const passed = ran.filter((c) => c?.state === 'ok').length;
  return { cells, passed, ran: ran.length, line: ran.length ? `${passed} of the last ${ran.length} checks passed.` : 'No check has run yet.' };
}

// ─────────────────────────────────────────────── Card 4 and MCPX2, the services

export const SERVICES_EMPTY = 'No service connected. StudioOS’s own tools still work.';
export const SERVICE_TOOLS_WAIT = 'The tools a service gives axal.vc/mcp come from the tool read (D846), which is being built.';
export const CONNECT_ELSEWHERE = 'Connecting and disconnecting happen on each service’s own page in Connectors.';
export const SERVICE_FILTERS = Object.freeze([
  { key: 'all', label: 'All' }, { key: 'connected', label: 'Connected' }, { key: 'attention', label: 'Needs attention' },
]);

/**
 * The member's connections as rows: the catalogue's name, the state pill from
 * Connectors (`connectionStatus`, unchanged), the health pill from D848, and
 * the drawer's address. A connection the catalogue does not name keeps its key.
 */
export function serviceRows({ connections, catalogue, health }, now = Date.now()) {
  const conns = connections.status === 'ready' ? (Array.isArray(connections.data?.items) ? connections.data.items : []) : [];
  const providers = Array.isArray(catalogue.data?.items) ? catalogue.data.items : Array.isArray(catalogue.data?.providers) ? catalogue.data.providers : [];
  const byKey = new Map(providers.map((p) => [p?.key, p]));
  const healthBy = new Map((health.status === 'ready' && Array.isArray(health.data?.connections) ? health.data.connections : []).map((h) => [h?.uid, h]));
  return conns.filter((c) => c && c.status !== 'disconnected').map((c) => {
    const p = byKey.get(c.provider_key) || null;
    const h = healthBy.get(c.uid) || null;
    const state = connectionStatus(c, p) || { label: 'Connected', tone: 'ok', why: '' };
    return {
      uid: c.uid,
      key: c.provider_key,
      name: p?.display_name || c.provider_key,
      category: p?.category || null,
      state,
      attention: !!attentionReason(c),
      health: healthPill(h?.health, { unreadable: health.status !== 'ready' && health.status !== 'loading' }),
      checked: checkedLine(h?.health, now),
      checks: h?.checks || [],
      companies: Array.isArray(c.company_ids) ? c.company_ids.length : null,
      scopes: Array.isArray(c.scopes) ? c.scopes : null,
      lastSync: agoLabel(c.last_synced_at, now),
      lastError: attentionReason(c) || null,
      drawer: `/account/builder/services/${encodeURIComponent(c.provider_key)}`,
      page: connectorPagePath(c.provider_key),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** MCPX2's search and filter chips over the rows. */
export function filterServices(rows, { q = '', filter = 'all' } = {}) {
  const needle = String(q).trim().toLowerCase();
  return rows.filter((r) => (!needle || r.name.toLowerCase().includes(needle) || String(r.category || '').toLowerCase().includes(needle))
    && (filter === 'all' || (filter === 'attention' ? r.attention || r.health.key === 'failing' : !r.attention)));
}

/** Card 4 shows the first four; "See all services" opens the rest. */
export const SERVICES_SHOWN = 4;

// ─────────────────────────────────────────────── Card 5, the limits

/**
 * Card 5's rows from D849's limits read. A limit the read does not send is
 * said, never a number this page invented.
 */
export function limitRows(limits) {
  if (limits.status !== 'ready') return null;
  const d = limits.data || {};
  const rate = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? `${Number(n)} a minute` : null);
  const keyRates = (Array.isArray(d.keys) ? d.keys : []).map((k) => Number(k?.rate_per_minute)).filter((n) => Number.isFinite(n) && n > 0);
  return [
    { key: 'connection', label: 'Calls per assistant connection', value: rate(d.connection?.calls_per_minute) },
    { key: 'key', label: 'Calls per API key', value: d.keys_enabled === false ? null : keyRates.length ? `${[...new Set(keyRates)].join(' or ')} a minute` : null,
      reason: d.keys_enabled === false ? SERVER_WORDS.keysOff : 'No live key, so no key limit is in force.' },
    { key: 'member', label: 'All your callers together', value: rate(d.member?.calls_per_minute) },
    { key: 'spend', label: 'Spend', value: 'Your AI token limits apply', link: { to: '/account/usage/ai-tokens', label: 'See AI tokens' } },
  ];
}
export const LIMITS_FOOT = 'These are StudioOS’s limits. Your assistant may set its own.';

/** MCPX11: a drawer address for something not on this account says only that. */
export const NOT_YOURS = Object.freeze({
  service: 'This service is not connected on your account.',
  assistant: 'This connection is not on your account.',
});
