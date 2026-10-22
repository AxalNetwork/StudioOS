/**
 * D880 (#2553) — Axal VC's own Mercury, the four entity connections (D710,
 * #1775; D715, #1780), as HQ draws them: the rows, their state and error
 * words, and the sheet's sentences. Moved here from `pages/account/
 * mercuryModel.js`, so no member page ships them. No React, no fetch.
 *
 * WHAT IT NEVER READS. An entity row is built from the five columns of
 * migration 474 that `GET /api/admin/mercury/connections` serves (`status`,
 * `mercury_org_name`, `last_synced_at`, `last_error`, `token_preview`) and the
 * accounts' kind, last four, nickname and `registered`. A balance, a
 * transaction, a Mercury account id or a token beyond the preview is never
 * read, so no caller can draw one from here.
 *
 * A missing value is null with a reason ("Not recorded"), never 0
 * (`D686.md:554`). `last_synced_at` is returned raw so the sheet formats it
 * with `agoLabel`.
 */
import { AXAL_ENTITIES } from '../../../lib/legalDocFormat.js';
import { NOT_RECORDED } from '../../../lib/absence.js';
import { accountLine } from '../../account/mercuryModel.js';

/** Decision 4's order: Holdings, Management, GP, Fund. */
export const ENTITY_KEYS = ['holdings', 'management', 'gp', 'fund'];

const WORD = /^[a-z0-9_]+$/;

/** A Worker code safe to print, else ''. `connectorsModel.js`'s `codeWord`, copied. */
function codeWord(v) {
  const s = String(v || '');
  return WORD.test(s) ? s : '';
}

const STATE_WORDS = {
  active: { text: 'Connected', tone: 'ok' },
  error: { text: 'Needs attention', tone: 'warn' },
  disconnected: { text: 'Disconnected', tone: 'neutral' },
};

/** A connection's state in words: null is "Not connected"; a status #1775 does not write is Not recorded. */
export function entityState(connection) {
  if (!connection) return { text: 'Not connected', tone: 'neutral', reason: null };
  const known = Object.hasOwn(STATE_WORDS, connection.status) ? STATE_WORDS[connection.status] : null;
  return known ? { ...known, reason: null } : { text: NOT_RECORDED, tone: 'neutral', reason: 'The connection reported no state StudioOS knows.' };
}

/** The codes D710 writes to `last_error` (`services/mercury/client.ts`). */
export const ENTITY_ERROR_WORDS = {
  unauthorized: 'Mercury refused the token. Only the Super Admin can replace it.',
  rate_limited: 'Mercury did not answer the last sync. The next hourly sync tries again.',
  timeout: 'Mercury did not answer the last sync. The next hourly sync tries again.',
};

/** The last sync's error in words, or null when there is none. A sentence is never printed. */
export function entityErrorWords(lastError) {
  if (lastError == null || lastError === '') return null;
  const code = codeWord(lastError);
  if (code && Object.hasOwn(ENTITY_ERROR_WORDS, code)) return ENTITY_ERROR_WORDS[code];
  return code ? `The last sync failed (${code}).` : 'The last sync failed.';
}

export const FUND_NOTE = 'Connect the Fund once its own Mercury account is open. Until then, nothing on the GP\'s or Management\'s accounts is booked as Fund cash.';

/** "Mercury names this organization <name>. StudioOS matched it to <entity> by its account endings." */
export function orgNameDiffersSentence(orgName, entityName) {
  return `Mercury names this organization ${orgName}. StudioOS matched it to ${entityName} by its account endings.`;
}

/**
 * One entity's row from its connection (or null). Only the columns the module
 * header names are read. `accounts` is null with its reason until the
 * connections read carries them (D715 decision 4).
 */
export function entityRow(key, connection = null) {
  const entity = Object.hasOwn(AXAL_ENTITIES, key) ? AXAL_ENTITIES[key] : null;
  if (!entity || !ENTITY_KEYS.includes(key)) return null;
  const c = connection && typeof connection === 'object' ? connection : null;
  const orgName = typeof c?.mercury_org_name === 'string' && c.mercury_org_name.trim() ? c.mercury_org_name : null;
  const accounts = Array.isArray(c?.accounts) ? c.accounts.map(accountLine) : null;
  return {
    key,
    name: entity.name,
    connected: !!c && c.status !== 'disconnected',
    state: entityState(c),
    orgName,
    orgNameReason: c && !orgName ? NOT_RECORDED : null,
    orgNameDiffers: c?.org_name_differs === true && orgName ? orgNameDiffersSentence(orgName, entity.name) : null,
    accounts,
    accountsReason: c && !accounts ? NOT_RECORDED : null,
    lastSyncedAt: typeof c?.last_synced_at === 'string' && c.last_synced_at ? c.last_synced_at : null,
    error: c ? entityErrorWords(c.last_error) : null,
    tokenPreview: typeof c?.token_preview === 'string' && c.token_preview ? c.token_preview : null,
    note: key === 'fund' ? FUND_NOTE : null,
  };
}

/** The four rows, in decision 4's order, from `GET /connections`'s `entities`. */
export function entityRows(read) {
  const byKey = new Map((Array.isArray(read?.entities) ? read.entities : []).map((e) => [e?.entity_key, e?.connection ?? null]));
  return ENTITY_KEYS.map((k) => entityRow(k, byKey.get(k) ?? null));
}

// ── The entity sheet's fixed sentences (decisions 4 to 7, 12) ─────────────────

export const ENTITY_FEEDS = 'What it feeds: balances and transactions for reconciliation, and the monthly cash and reconciliation drafts. Drafts wait in the review queue. Nothing reaches an LP from here.';
/** The audit record the sheet's foot names (the Bank accounts console). */
export const ENTITY_SHEET_AUDIT_FOOT = 'Opening this sheet is recorded in the admin audit log.';
export const ADMIN_ONLY = 'Only the Super Admin connects, replaces or disconnects an entity\'s Mercury.';
export const TOKEN_HELP = 'How to create a Read Only token';
export const OPEN_BANKING = { text: 'Open Banking', href: '/admin/fund-admin?tab=banking' };
/** A branch admin's sentence: the entity connections are HQ's. */
export const ENTITY_BRANCH_MANAGED = 'Axal\'s entity accounts are managed from HQ.';

/** The Connect box's label: "This is a Read Only token from <entity>'s Mercury organization." */
export function confirmReadOnlyLabel(entityName) {
  return `This is a Read Only token from ${entityName}'s Mercury organization.`;
}

export const DISCONNECT_REASON_MIN = 10;
export const ENTITY_DISCONNECT_NOTE = 'Transactions already read stay. The stored token is erased. Delete the token in Mercury too: StudioOS never calls Mercury\'s token endpoints.';

/** Sync now's 429: "Try again in N minutes.", N from `Retry-After` (seconds), at least 1; '' when unknown. */
export function retryAfterSentence(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '';
  const n = Math.max(1, Math.ceil(s / 60));
  return `Try again in ${n} ${n === 1 ? 'minute' : 'minutes'}.`;
}
