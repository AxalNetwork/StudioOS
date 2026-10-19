/**
 * D715 (#1780) — Mercury on Connectors: the words and rows every Mercury
 * surface draws, for the four Axal entity connections (D710, #1775) and for a
 * founder's, partner's or, on HQ, investor's own connection (D713, #1778;
 * D752, #1886). No React, no fetch.
 *
 * It imports nothing from `connectorsModel.js`, so that file can import this
 * one without a cycle; `codeWord`'s test is copied below for that reason.
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
 *
 * The member's use words are keyed exactly as `GET /api/mercury/personal/status`
 * names its uses (`routes/mercury_personal.ts`, D713): `venture_revenue`, `raise_receipts` and `venture_spend` (D752),
 * `practice_income` and `partner_deals` (PR 3b), and `capital_attestation`
 * (D752). The member words below are keyed by role (D752): a role without its
 * own entry reads the founder's.
 */
import { AXAL_ENTITIES } from '../../lib/legalDocFormat.js';
import { NOT_RECORDED } from '../../lib/absence.js';

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

const KIND_WORDS = { checking: 'Checking', savings: 'Savings' };
export const UNREGISTERED_NOTE = 'Not in the bank-account registry, so it feeds no match.';

/** One account as its kind and "ending NNNN", with its nickname. Never a number beyond the last four. */
export function accountLine(account) {
  const kind = Object.hasOwn(KIND_WORDS, account?.kind) ? KIND_WORDS[account.kind] : 'Account';
  const four = typeof account?.last_four === 'string' && /^\d{4}$/.test(account.last_four) ? account.last_four : null;
  const nickname = typeof account?.nickname === 'string' && account.nickname.trim() ? account.nickname.trim() : null;
  return {
    text: four ? `${kind} ending ${four}` : `${kind} · last four not recorded`,
    nickname,
    note: account?.registered === false || account?.registered === 0 ? UNREGISTERED_NOTE : null,
  };
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
export const ENTITY_AUDIT_FOOT = 'Opening this sheet is recorded in the admin audit log.';
export const ADMIN_ONLY = 'Only the Super Admin connects, replaces or disconnects an entity\'s Mercury.';
export const BRANCH_MANAGED = 'Axal\'s entity accounts are managed from HQ.';
export const TOKEN_HELP = 'How to create a Read Only token';
export const OPEN_BANKING = { text: 'Open Banking', href: '/admin/fund-admin?tab=banking' };
/** D752 (#1891): the `capital_attestation` use's door, to the LP workspace's proof of funds. */
export const ATTESTATION_DOOR = { text: 'Show Axal you can fund this', href: '/spinout-lab/investor-workspace#proof-of-funds' };

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

// ── A member's own Mercury (decision 8) ───────────────────────────────────────

export const MEMBER_GROUPS = {
  uses: 'What StudioOS uses it for',
  never: 'What it never does',
  lands: 'Where it lands',
  reads: 'How it reads',
};

/** Decision 8's use words, keyed as `routes/mercury_personal.ts` names the uses. */
export const USE_WORDS = {
  venture_revenue: 'Your venture\'s revenue. StudioOS lists the credits in your own Mercury account, and you pick the ones that are customer revenue. Only those become rows on your revenue ledger, marked Supported, with Mercury\'s amount and date.',
  practice_income: 'Your practice income. Match an engagement invoice you issued to the credit that paid it.',
  partner_deals: 'Your deals with Axal VC Management LLC. Match a payout or a partner-deal settlement to the bank line that settled it.',
  // D752 (#1887): the Worker serves this key now; task raise-match-screens draws its match panel.
  raise_receipts: 'Your venture\'s raise. Match an investor\'s wire to a committed prospect in your raise pipeline, or to a pending commitment on one of your deals.',
  venture_spend: 'Your venture\'s spending, burn, cash and runway. When you ask, StudioOS reads your own Mercury and works out each month\'s money in, money out and net burn, with your cash on hand and your runway. Money from an Axal fund counts as financing, not income. Nothing is kept unless you save a month\'s burn, and your cash only if you tick it.',
  capital_attestation: 'Proof of funds for a commitment you made: a deal commitment, your Fund I application or your Fund I commitment. When you ask, StudioOS checks the checking and savings accounts you pick and shares one dated statement with Axal\'s admins, "at least" an amount you choose. You can revoke it. Your balance is never stored or shown.',
};

/** Why a use is not drawn, in words, from the reason the status route gives. */
export const USE_REASONS = {
  hq_only: 'Your deals with Axal VC Management LLC are matched on HQ only.',
  purpose_not_allowed: 'Your profile uses its own Mercury for nothing StudioOS lists.',
};

/**
 * The uses group from the status read: one row per `available` use the model
 * has words for, in the route's order. With none left, `rows` is empty and
 * `reason` says why: `hq_only` when a held use is withheld off HQ, else that
 * the profile holds none. A key without words is never drawn.
 */
export function usesRows(status) {
  const uses = Array.isArray(status?.uses) ? status.uses : [];
  const rows = uses
    .filter((u) => u && u.available === true && Object.hasOwn(USE_WORDS, u.key))
    .map((u) => ({ key: u.key, text: USE_WORDS[u.key] }));
  if (rows.length) return { rows, reason: null };
  const hqOnly = uses.some((u) => u?.reason === 'hq_only' && Object.hasOwn(USE_WORDS, u.key));
  return { rows: [], reason: hqOnly ? USE_REASONS.hq_only : USE_REASONS.purpose_not_allowed };
}

const FOUNDER_PARTNER_NEVER = Object.freeze([
  'It never sends, transfers or requests money, and never changes anything in Mercury.',
  'It is never used for fund administration and never shows an Axal entity\'s accounts. StudioOS refuses a token from an Axal entity\'s Mercury organization.',
  'It reads your Mercury only when you connect it and while you open an import or a match. It keeps only the lines you import or match, never your balance, memos or counterparty names.',
]);

/** "What it never does", by role (D752). */
export const NEVER_ROWS = Object.freeze({
  founder: Object.freeze([
    FOUNDER_PARTNER_NEVER[0],
    FOUNDER_PARTNER_NEVER[1],
    'It reads your Mercury only when you connect it and while you open an import, a match or your spending. It keeps only the lines you import or match, and the figures you choose to save: a month\'s net burn and, if you tick it, your cash on hand. Never memos or counterparty names.',
  ]),
  partner: FOUNDER_PARTNER_NEVER,
  investor: Object.freeze([
    'It never sends, transfers or requests money, and never changes anything in Mercury.',
    'It never shows Axal\'s own accounts. StudioOS refuses a token from an Axal entity\'s Mercury organization.',
    'It reads your accounts only when you connect it and while you prepare a statement. It keeps only the statements you share: an amount you choose, the date and your organization\'s name. Never a balance, an account number, a transaction or a counterparty.',
  ]),
});

/** The role's "What it never does" rows, else the founder's. */
export function neverRows(role) {
  return Object.hasOwn(NEVER_ROWS, role) ? NEVER_ROWS[role] : NEVER_ROWS.founder;
}

const LANDS = {
  founder: 'Only the venture you import into or save figures for',
  partner: 'Only your own invoices, payouts and settlements',
  investor: 'Only the statements you choose to share with Axal\'s admins',
};

/** "Where it lands" for this role, or null for a role that gets no personal row. */
export function landsWords(role) {
  return Object.hasOwn(LANDS, role) ? LANDS[role] : null;
}

export const READS_ROW = 'Only when you ask. No scheduled sync.';
export const MEMBER_REPLACE = 'Replace the token with a Read Only one from your own Mercury organization.';
const FOUNDER_PARTNER_DISCONNECT = 'Revenue rows you imported and matches you confirmed stay. The stored token is deleted. Delete it in Mercury too.';

/** What disconnecting keeps, by role (D752). */
export const MEMBER_DISCONNECT_NOTE = Object.freeze({
  founder: 'Revenue rows you imported, figures you saved and matches you confirmed stay. The stored token is deleted. Delete it in Mercury too.',
  partner: FOUNDER_PARTNER_DISCONNECT,
  investor: 'Statements you shared stay with Axal\'s admins until you revoke them: disconnecting does not revoke them. The stored token is deleted. Delete it in Mercury too.',
});

/** The role's disconnect note, else the founder's. */
export function memberDisconnectNote(role) {
  return Object.hasOwn(MEMBER_DISCONNECT_NOTE, role) ? MEMBER_DISCONNECT_NOTE[role] : MEMBER_DISCONNECT_NOTE.founder;
}

// ── The personal row in Yours and in Build (decision 9) ──────────────────────

export const PERSONAL_DOES = 'Reads on request';
export const PERSONAL_LAST_SYNC = 'Read on request';
export const PERSONAL_COMPANIES = 'You';
/** Yours' Feeds for a personal row the catalogue names no module for (D752: by role). */
export function personalFeedsFallback(role) {
  return role === 'investor' ? 'Statements you share' : 'Your own payments';
}

/** Decision 9's attention words, matched on the code `last_error` starts with. */
export function personalAttention(lastError) {
  const s = String(lastError || '');
  if (/^mercury_entity_account\b/.test(s)) return 'An Axal entity\'s Mercury';
  if (/^write_scope_refused\b/.test(s)) return 'Token can write';
  if (/^(unauthorized|401)\b/.test(s)) return 'Token refused';
  return 'Last read failed';
}

/** Build's failing-row banner, the attention words as written (not lower-cased). */
export function personalToolBanner(lastError) {
  return `Mercury needs attention: ${personalAttention(lastError)}. Replace its token from its sheet.`;
}

// ── Not offered (decision 10) ─────────────────────────────────────────────────

export const NOT_OFFERED = 'Mercury is not offered to your profile. Axal\'s admins use it for fund administration, founders for their venture\'s revenue and spending, partners for their invoices and partner deals, and investors on HQ to show Axal\'s admins they can fund a commitment.';
/** D752: an investor on a branch. */
export const NOT_OFFERED_HQ_ONLY = 'Investors connect Mercury on HQ only, where Axal\'s admins review commitments.';

/** Whether a search names Mercury: "mercury", or three or more of its first letters, in any case. */
export function isMercurySearch(q) {
  const t = String(q || '').trim().toLowerCase();
  return t.length >= 3 && ('mercury'.startsWith(t) || t.startsWith('mercury'));
}

/**
 * A "mercury" search with no Mercury row: the branch admin's sentence, the
 * HQ-only one for an investor on a branch, else the profile one. Never a request.
 */
export function notOfferedSentence({ branchAdmin = false, role = null, onBranch = false } = {}) {
  if (branchAdmin) return BRANCH_MANAGED;
  if (role === 'investor' && onBranch) return NOT_OFFERED_HQ_ONLY;
  return NOT_OFFERED;
}
