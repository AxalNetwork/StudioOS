/**
 * D1317 (#2480) — Account › Builder › API keys: the rules the page draws, as
 * pure functions over `GET /api/developer/keys` (D841, `routes/developer_keys.ts`)
 * and its writes. Drawn to `design/incoming/API Keys Page.dc.html` (APIK1–APIK16).
 *
 * THE SECRET IS NOT HERE. Nothing in this file takes, returns or formats a
 * secret: a key is shown everywhere by its public prefix and four dots
 * (`previewOf`). The one place a secret is drawn is the reveal dialog, from
 * the 201 body it was handed (`ApiKeyDialogs.jsx`).
 */
import { parseLimitUsd } from '../limitsModel.js';

/** A secret's shape (services/apiKeys.ts): the tests hold that no log, report or address carries one. */
export const SECRET_RE = /axk_[a-z0-9]{12}_[A-Za-z0-9_-]{43}/;
const PREFIX_RE = /^axk_[a-z0-9]{12}$/;
const DAY_MS = 86_400_000;
/** A live key this close to its expiry reads "Expires in N days", in amber. */
export const SOON_DAYS = 7;

/** The expiry choices (APIK2), 90 days first chosen (owner question 2's recommendation). */
export const EXPIRY_OPTIONS = Object.freeze([
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '365', label: '1 year', days: 365 },
  { id: 'never', label: 'Never', days: null },
]);
export const DEFAULT_EXPIRY = '90';
export const NAME_MAX = 60;

/** Every sentence the page says, in one place. */
export const WORDS = Object.freeze({
  cardTitle: 'API keys',
  create: 'Create a key',
  dialogTitle: 'Create an API key',
  rule: 'A key acts for you. It reaches only the companies and permissions you chose, and never more than you hold. Signing out everywhere ends every key made before it.',
  nameHelp: 'So you can tell your keys apart. Not secret. Up to 60 characters.',
  companiesHelp: 'Only companies you own. If one stops being yours, the key loses it at once.',
  cannot: 'It cannot change a module, delete anything, or see other companies.',
  writeLine: 'Proposals still wait for your review.',
  never: 'A key that never expires stays valid until you revoke it.',
  limitLabel: 'Monthly AI token limit (optional)',
  limitHelp: 'Calls stop for this key when it reaches this. Your account’s own limits still apply.',
  revealWarn: 'This is the only time the secret is shown. StudioOS keeps only a fingerprint and cannot show it again. If you lose it, rotate the key.',
  copiedLine: 'Copied and hidden from view. Paste it into your secret store now.',
  stored: 'I have stored this key somewhere safe',
  closeEarly: 'Close without storing the key? You will not see it again.',
  rotateLines: ['A new secret is made with the same name, companies, permissions and limit.', 'The current key stops working at once. Anything using it fails until you paste the new one.'],
  revokeLines: ['It stops working at once, everywhere.', 'Requests already finished stay in your API usage.', 'This cannot be undone. To use the API again, create a new key.'],
  revokeConfirm: 'Type the key’s name to confirm',
  loading: 'Reading…',
  createWaits: 'Create a key appears once your companies have been read.',
  unreadable: 'Your keys could not be read.',
  unreadableLine: 'That is not the same as having none.',
  off: 'API keys are not available yet.',
  offLine: 'Assistants can still sign in from MCP and services.',
  empty: 'No API keys yet.',
  emptyLine: 'Create a key for a script or tool you run yourself. An assistant can sign in instead, with no key.',
  nothing: 'Nothing a key could reach yet',
  nothingLine: 'StudioOS’s tools today work on companies a founder owns. Your profile owns none, so a key would have nothing to call.',
  explorer: 'API keys open once your profile is set.',
  explorerLine: 'Finish setting up your profile, then come back.',
  hq: 'Platform keys for connectors are set in HQ › Integration keys.',
  foreign: 'This key is not on your account.',
  stillYours: 'Still yours ✓',
  lost: 'You no longer own this company. Calls for it are refused.',
  editLine: 'To change a key’s companies or permissions, create a new key.',
  refusalLine: 'A refusal never says whether a key exists.',
  noCall: 'No call recorded',
  neverExpires: 'Never expires',
  noLimit: 'No limit',
  notMetered: 'Not recorded',
  notMeteredWhy: 'This month’s AI tokens per key could not be read.',
  resets: 'Resets on the 1st',
});

export const supportNotice = (who) => `You are viewing as ${who || 'this member'}. Keys cannot be created, rotated or revoked in a support session.`;

/** What a refused call returns (APIK15), byte for byte from the canvas. */
export const REFUSED_CALLS = Object.freeze([
  ['401', 'invalid_key', 'The key is wrong or unknown.'],
  ['401', 'revoked_key', 'The key was revoked.'],
  ['401', 'expired_key', 'The key has expired.'],
  ['403', 'insufficient_scope', 'The key lacks the permission for this tool.'],
  ['402', 'insufficient_tokens', 'Not enough AI tokens. Add tokens in Usage › AI tokens.'],
  ['429', 'rate_limited', 'Too many calls. Wait for the time in Retry-After.'],
]);

/** A write's refusal codes (routes/developer_keys.ts), in the page's words. */
export const REFUSALS = Object.freeze({
  invalid_body: 'The key was not sent in a form StudioOS could read. Try again.',
  invalid_name: 'Give the key a name of 1 to 60 characters.',
  invalid_scopes: 'Choose at least one permission.',
  invalid_companies: 'That company is not one you own.',
  invalid_expiry: 'Choose an expiry of 1 to 365 days, or Never.',
  invalid_limit: 'A monthly limit must be a positive amount, or none.',
  too_many_keys: 'You have reached the most live keys you can hold. Revoke one first.',
  not_live: 'Only a live key can be changed.',
  session_required: 'Sign in to manage API keys. A key cannot manage keys.',
  support: 'A support session cannot create, rotate or revoke keys.',
});

/** A write's refusal as one sentence: the Worker's code first, then its status, never raw server text. */
export function refusalWords(error, { name = null, fallback = null } = {}) {
  const code = error?.code || error?.data?.code || null;
  if (code && REFUSALS[code]) return REFUSALS[code];
  const status = error?.status;
  if (status === 403) return REFUSALS.support;
  if (status === 429) {
    const s = Number(error?.retryAfter ?? error?.data?.retry_after);
    return Number.isFinite(s) && s > 0 ? `Too many changes. Try again in ${Math.ceil(s)} seconds.` : 'Too many changes. Try again shortly.';
  }
  if (fallback) return fallback;
  return name ? `${name} was not changed. Try again.` : 'The key was not changed. Try again.';
}

/** SQLite `datetime('now')` text, or ISO, as epoch ms; NaN for anything else. */
export function stampMs(s) {
  if (typeof s !== 'string' || !s) return NaN;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `2 Oct` (UTC), or null. */
export function dayOf(s) {
  const ms = stampMs(s);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** `21 Oct · 14:32` (UTC), or null. */
export function dayTimeOf(s) {
  const ms = stampMs(s);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${dayOf(s)} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * A key's state: `revoked`, `expired`, `soon` (live, expiring within SOON_DAYS)
 * or `active`, with the pill's icon and word. Never colour alone.
 */
export function keyState(key, now = new Date()) {
  if (key?.revoked_at) return { id: 'revoked', icon: '×', word: 'Revoked', live: false };
  const exp = stampMs(key?.expires_at);
  if (Number.isFinite(exp) && exp <= now.getTime()) return { id: 'expired', icon: '–', word: 'Expired', live: false };
  if (Number.isFinite(exp)) {
    const days = Math.ceil((exp - now.getTime()) / DAY_MS);
    if (days <= SOON_DAYS) return { id: 'soon', icon: '!', word: `Expires in ${days} ${days === 1 ? 'day' : 'days'}`, live: true };
  }
  return { id: 'active', icon: '✓', word: 'Active', live: true };
}

/** A key as the page shows it: its public prefix and four dots, never more. */
export function previewOf(key) {
  const p = String(key?.prefix ?? '');
  return PREFIX_RE.test(p) ? `${p}_••••` : 'axk_••••';
}

/** `$4.10` from micro-USD; null for a missing value (never $0.00 for "not recorded"). */
export function usd(micro) {
  if (typeof micro !== 'number' || !Number.isFinite(micro)) return null;
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

/**
 * The limit field (`$20.00`, `20`, or empty) as micro-USD: `{ ok, micro }`,
 * where `micro` is null for no limit. Same parser as Usage › Limits.
 */
export function limitFrom(text) {
  const t = String(text ?? '').trim();
  if (!t) return { ok: true, micro: null };
  const n = parseLimitUsd(t);
  if (n === null || n <= 0) return { ok: false, micro: null };
  return { ok: true, micro: Math.round(n * 1_000_000) };
}

/**
 * The create body: exactly the ticked companies and permissions that the read
 * offered, in the read's order (as `approveBody` does for consent). A tick for
 * anything the read did not offer is dropped, never sent.
 */
export function createBody(form, read) {
  const offeredScopes = (read?.scopes_available ?? []).map((s) => s.name);
  const offeredCompanies = (read?.companies_available ?? []).map((c) => c.id);
  const ticked = (list) => new Set((list ?? []).map(String));
  const s = ticked(form?.scopes), c = ticked(form?.companies);
  const exp = EXPIRY_OPTIONS.find((o) => o.id === form?.expiry) ?? EXPIRY_OPTIONS.find((o) => o.id === DEFAULT_EXPIRY);
  return {
    name: String(form?.name ?? '').trim(),
    scopes: offeredScopes.filter((n) => s.has(String(n))),
    companies: offeredCompanies.filter((id) => c.has(String(id))),
    expires_in_days: exp.days,
    monthly_limit_microusd: limitFrom(form?.limit).micro,
  };
}

/** The field errors a create shows before it is sent; an empty object when it may be sent. */
export function createErrors(form, read) {
  const body = createBody(form, read);
  const out = {};
  if (!body.name) out.name = 'Give the key a name.';
  else if (body.name.length > NAME_MAX) out.name = `A name is at most ${NAME_MAX} characters.`;
  if (body.companies.length === 0) out.companies = 'Tick at least one company.';
  if (body.scopes.length === 0) out.scopes = 'Choose at least one permission.';
  if (!limitFrom(form?.limit).ok) out.limit = 'Write an amount in dollars, such as 20.00, or leave it empty.';
  return out;
}

const list = (words) => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/** The summary above Create (APIK2): "[name] can read Validate for [company], until [day], up to [$20.00] of AI tokens a month." */
export function summaryOf(form, read, now = new Date()) {
  const b = createBody(form, read);
  const scopes = (read?.scopes_available ?? []).filter((s) => b.scopes.includes(s.name)).map((s) => s.label.charAt(0).toLowerCase() + s.label.slice(1));
  const companies = (read?.companies_available ?? []).filter((c) => b.companies.includes(c.id)).map((c) => c.name || `company ${c.id}`);
  const who = b.name || 'This key';
  const can = scopes.length ? list(scopes) : 'do nothing yet';
  const forWhom = companies.length ? ` for ${list(companies)}` : '';
  const until = b.expires_in_days ? `until ${dayOf(new Date(now.getTime() + b.expires_in_days * DAY_MS).toISOString())}` : 'with no expiry';
  const cap = b.monthly_limit_microusd ? `up to ${usd(b.monthly_limit_microusd)} of AI tokens a month` : 'with no AI token limit of its own';
  return `${who} can ${can}${forWhom}, ${until}, ${cap}.`;
}

/** A permission's chip and sentence, from the read (`{ name, label, write }`). */
export const scopeOf = (read, name) => (read?.scopes_available ?? []).find((s) => s.name === name) ?? { name, label: name, write: true };

/**
 * What card 1 draws for this member (APIK9–APIK13):
 *   `off`       the routes are 404 (API_KEYS_ENABLED is off);
 *   `explorer`  an Explorer, whose profile is not set;
 *   `nothing`   no company a key could reach, and no key to list;
 *   `empty`     companies to grant, no key yet;
 *   `list`      keys to list (Create only when there is a company to grant).
 */
export function cardFor({ read, httpStatus = null, role = null }) {
  if (httpStatus === 404) return 'off';
  const keys = read?.keys ?? [];
  if (role === 'explorer' && keys.length === 0) return 'explorer';
  const grantable = (read?.companies_available ?? []).length > 0;
  if (keys.length === 0) return grantable ? 'empty' : 'nothing';
  return 'list';
}

/** May this member create a key here: a company to grant, and not a support session. */
export const canCreate = (read, { support = false } = {}) => !support && (read?.companies_available ?? []).length > 0;

export const FILTERS = Object.freeze([
  { id: 'active', label: 'Active', states: ['active', 'soon'] },
  { id: 'expired', label: 'Expired', states: ['expired'] },
  { id: 'revoked', label: 'Revoked', states: ['revoked'] },
]);
export const SORTS = Object.freeze([
  { id: 'last_used', label: 'Last used' },
  { id: 'name', label: 'Name' },
  { id: 'created', label: 'Created' },
  { id: 'expires', label: 'Expires' },
]);

/** The table's rows: searched by name or key id, filtered by state, sorted; a missing date sorts last. */
export function rowsOf(keys, { q = '', filter = null, sort = 'last_used' } = {}, now = new Date()) {
  const needle = String(q).trim().toLowerCase();
  const states = FILTERS.find((f) => f.id === filter)?.states ?? null;
  const by = {
    name: (k) => String(k.name ?? '').toLowerCase(),
    last_used: (k) => -(stampMs(k.last_used_at) || -Infinity),
    created: (k) => -(stampMs(k.created_at) || -Infinity),
    expires: (k) => (Number.isFinite(stampMs(k.expires_at)) ? stampMs(k.expires_at) : Infinity),
  }[sort] ?? ((k) => 0);
  return (keys ?? [])
    .filter((k) => !needle || String(k.name ?? '').toLowerCase().includes(needle) || String(k.key_id ?? '').includes(needle))
    .filter((k) => !states || states.includes(keyState(k, now).id))
    .slice()
    .sort((a, b) => { const x = by(a), y = by(b); return x < y ? -1 : x > y ? 1 : String(a.uid).localeCompare(String(b.uid)); });
}

/** How many keys each filter holds. */
export function filterCounts(keys, now = new Date()) {
  const out = { active: 0, expired: 0, revoked: 0 };
  for (const k of keys ?? []) {
    const id = keyState(k, now).id;
    out[id === 'soon' ? 'active' : id] += 1;
  }
  return out;
}

/** A key's companies as one cell: its single company, "Both companies", or a count. */
export function companiesCell(key) {
  const cs = key?.companies ?? [];
  if (cs.length === 0) return '—';
  if (cs.length === 1) return cs[0].name || `Company ${cs[0].id}`;
  return cs.length === 2 ? 'Both companies' : `${cs.length} companies`;
}

/**
 * This month's AI tokens for a key, from `GET /api/developer/usage/keys`:
 * `{ used, limit, pct }` with `used` null when the read failed or the key has no
 * metered call (never $0.00 for "not recorded").
 */
export function monthOf(key, usage) {
  const row = (usage?.keys ?? []).find((r) => r.uid === key?.uid) ?? null;
  const limit = usd(key?.monthly_limit_microusd);
  const used = row ? usd(row.charged_microusd) : null;
  const pct = row && typeof row.used_percent === 'number' ? Math.max(0, Math.min(100, row.used_percent)) : null;
  return { used, limit, pct, read: !!usage, calls: row ? row.calls : null };
}

/** A rotate's or a create's prefill for "Create a replacement" (APIK8): the settings, never the secret. */
export function replacementForm(key) {
  return {
    name: String(key?.name ?? ''),
    companies: (key?.companies ?? []).filter((c) => c.still_owned !== false).map((c) => String(c.id)),
    scopes: (key?.scopes ?? []).map(String),
    expiry: DEFAULT_EXPIRY,
    limit: typeof key?.monthly_limit_microusd === 'number' ? (key.monthly_limit_microusd / 1_000_000).toFixed(2) : '',
  };
}

export const blankForm = () => ({ name: '', companies: [], scopes: [], expiry: DEFAULT_EXPIRY, limit: '' });
