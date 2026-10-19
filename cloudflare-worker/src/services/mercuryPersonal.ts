/**
 * D713 (#1778) — a member's own Mercury, read on demand. NOTHING HERE MOVES MONEY.
 *
 * THE USES (decision 4). Each is checked here, on every route that reads or
 * writes, and `GET /api/mercury/personal/status` names them by these keys:
 *
 *   key               who                                    reads                    writes
 *   venture_revenue   a founder, for a project they found    own credits              revenue rows they pick
 *   practice_income   a partner, for their own invoices      own credits              a match; issued → paid
 *   partner_deals     a partner: own payouts and settlements own credits and debits   a match
 *   raise_receipts    a founder, for a project they found    own credits              a match; a prospect's
 *                                                                                    `commit_status` becomes `wired`,
 *                                                                                    a commitment becomes `confirmed` (D752)
 *   capital_attestation  an investor, on HQ: proof of funds  own accounts (#1888)    a statement (#1888)
 *
 * Any other pairing is 403 `purpose_not_allowed`. The uses in `HQ_ONLY_USES`
 * are HQ only (403 `hq_only`): only Management's payments are matched, and only
 * HQ's admins read a proof of funds (D752). A support session
 * is refused on every read and write (`support_session_refused`); disconnect
 * stays with the generic route.
 *
 * READ ON DEMAND (decision 5). No cron reads a personal connection. Each
 * read re-reads the organization and re-runs decision 3's entity check
 * (`providers/mercury.ts`), covers at most 366 days and 1,000 lines, and
 * writes one `integration_logs` row with the use and counts, never a payload.
 * A 401 or 403, a reported permission above read-only, or an Axal entity's
 * organization marks the row `error`.
 *
 * WHAT IS STORED. Only match rows (transaction id, last four, signed cents,
 * posted date, target) and, for imports, the revenue rows a founder picks.
 * Candidate lists, with their counterparty names, are built per request and
 * shown only to the member.
 */
import type { Context } from 'hono';
import type { Env, User } from '../types';
import type { IntegrationRow } from '../integrations/registry';
import { decryptCredentials } from '../integrations/secrets';
import { entityAccountRefusal, isSupportSession, namesAxalEntity, readOnlyRefusal, readOrganization } from '../integrations/providers/mercury';
import { getTransaction, listTransactions, MercuryClientError } from './mercury/client';
import { INTERNAL_KINDS, POSTED_STATUSES, VOID_STATUSES, parseTransaction, parseTransactions, toCents, type ParsedAccount, type ParsedTransaction } from './mercury/parse';
import { branchOf, HQ_ONLY } from '../util/branch';
import { refuse } from '../util/refusal';

type C = Context<{ Bindings: Env }>;

export type PersonalMatchTarget = 'engagement_invoice' | 'payout' | 'partner_deal_settlement' | 'raise_prospect' | 'deal_commitment';
export type BankMatch = { posted_on: string; last_four: string };
export type PersonalUse = 'venture_revenue' | 'practice_income' | 'partner_deals' | 'raise_receipts' | 'capital_attestation';

/** Decision 4's table, by role. A role absent here holds no personal connection. */
export const PERSONAL_USES: Readonly<Record<string, readonly PersonalUse[]>> = Object.freeze({
  founder: ['venture_revenue', 'raise_receipts'],
  partner: ['practice_income', 'partner_deals'],
  investor: ['capital_attestation'],
});
/**
 * D752: the uses that serve Axal's own administration, on HQ only. A personal
 * role whose every use is here sees no Mercury off HQ (the registry's
 * `personal_hq_only_roles`).
 */
export const HQ_ONLY_USES: readonly PersonalUse[] = Object.freeze(['partner_deals', 'capital_attestation'] as const);
export const USE_OF_TARGET: Readonly<Record<PersonalMatchTarget, PersonalUse>> = Object.freeze({
  engagement_invoice: 'practice_income',
  payout: 'partner_deals',
  partner_deal_settlement: 'partner_deals',
  raise_prospect: 'raise_receipts',
  deal_commitment: 'raise_receipts',
});
/** The `?target=` words of `GET /matches`. */
export const TARGET_WORDS: Readonly<Record<string, PersonalMatchTarget>> = Object.freeze({
  invoice: 'engagement_invoice',
  payout: 'payout',
  settlement: 'partner_deal_settlement',
  // D752: `commitment` is always a deal commitment, never an LP commitment.
  raise: 'raise_prospect',
  commitment: 'deal_commitment',
});

export const usesFor = (role: string | null | undefined): readonly PersonalUse[] => PERSONAL_USES[String(role || '').toLowerCase()] ?? [];

/** Decision 5's bounds. */
export const DEFAULT_WINDOW_DAYS = 90;
export const MAX_WINDOW_DAYS = 366;
export const MAX_LINES = 1000;
const PAGE = 500;
/** Decision 7's windows, in days. */
export const INVOICE_WINDOW_DAYS = 180;
export const PAYOUT_WINDOW_DAYS = 60;
export const SETTLEMENT_BEFORE_DAYS = 30;
export const SETTLEMENT_AFTER_DAYS = 90;
/** D752 decision 5: a raise target's window opens 30 days before it was recorded. */
export const RAISE_BEFORE_DAYS = 30;
/** The two D752 kinds, financing rather than revenue. */
export const RAISE_KINDS: readonly PersonalMatchTarget[] = Object.freeze(['raise_prospect', 'deal_commitment']);
export const WITHDRAW_REASON_MIN = 10;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDay(v: unknown): v is string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
  const t = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v;
}
export function plusDays(d: string, n: number): string {
  const t = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const today = () => new Date().toISOString().slice(0, 10);

/** `from` and `to` checked before anything reaches Mercury: calendar days, in order, at most 366 days apart. */
export function readWindow(from: string | undefined, to: string | undefined, now = today()):
  { from: string; to: string } | { error: string; message: string } {
  const end = to ?? now;
  const start = from ?? plusDays(end, -DEFAULT_WINDOW_DAYS);
  if (!isCalendarDay(start) || !isCalendarDay(end)) return { error: 'invalid_window', message: 'Give from and to as calendar dates, YYYY-MM-DD.' };
  if (start > end) return { error: 'invalid_window', message: 'The from date must be on or before the to date.' };
  if (daysBetween(start, end) > MAX_WINDOW_DAYS) return { error: 'window_too_long', message: `A read covers at most ${MAX_WINDOW_DAYS} days.` };
  return { from: start, to: end };
}

// ─────────────────────────────────────────────────────────── policy and the connection

function refused(c: C, status: number, code: string, message: string): Response {
  return refuse(c, status, { code, message });
}

/** Decision 4: the use, the role, the branch and the support session. Null when allowed. */
export async function personalPolicy(c: C, user: User, use: PersonalUse): Promise<Response | null> {
  if (await isSupportSession(c)) return refused(c, 403, 'support_session_refused', 'A support session cannot read or change a member\'s bank account.');
  if (!usesFor(user.role).includes(use)) return refused(c, 403, 'purpose_not_allowed', 'Your Mercury connection cannot be used for this.');
  if (HQ_ONLY_USES.includes(use) && branchOf(c.env)) return refused(c, 403, 'hq_only', HQ_ONLY);
  return null;
}

export interface PersonalConnection {
  row: IntegrationRow;
  token: string;
  accounts: ParsedAccount[];
  use: PersonalUse;
}

async function markError(env: Env, row: IntegrationRow, code: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE integrations SET status = 'error', last_error = ?, last_error_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(code, row.id).run();
}

/** The member's own active connection, re-checked (decisions 2 and 3); a Response when refused. */
export async function personalConnection(c: C, user: User, use: PersonalUse): Promise<PersonalConnection | Response> {
  const policy = await personalPolicy(c, user, use);
  if (policy) return policy;
  const row = await c.env.DB.prepare(
    "SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'mercury' LIMIT 1",
  ).bind(user.id).first<IntegrationRow>();
  if (!row) return refused(c, 409, 'mercury_not_connected', 'Connect your own Mercury account first.');
  if (row.status !== 'active') return refused(c, 409, 'mercury_reconnect_required', 'Your Mercury connection needs attention. Reconnect it with a Read Only token.');
  let token = '';
  try {
    const creds = await decryptCredentials(c.env, row.uid, row.credentials_enc);
    token = typeof creds?.api_key === 'string' ? creds.api_key : '';
  } catch { token = ''; }
  if (!token) return refused(c, 503, 'credentials_unreadable', 'Your Mercury token could not be read. Reconnect it with a Read Only token.');
  let read;
  try {
    read = await readOrganization(token);
  } catch (e) {
    if (e instanceof MercuryClientError && e.code === 'unauthorized') {
      await markError(c.env, row, 'token_rejected');
      return refused(c, 409, 'mercury_reconnect_required', 'Mercury no longer accepts your token. Reconnect it with a Read Only token.');
    }
    return refuse(c, 502, { code: 'mercury_unreadable', message: 'Your Mercury account could not be read. Nothing changed; try again.', raw: e, audience: 'owner' });
  }
  const scope = readOnlyRefusal(read.permission, true);
  if (scope) {
    await markError(c.env, row, scope.code);
    return refused(c, scope.status, scope.code, scope.sentence);
  }
  const entity = await entityAccountRefusal(c.env, read.org, read.accounts);
  if (entity) {
    if (entity.status === 409) await markError(c.env, row, entity.code);
    return refused(c, entity.status, entity.code, entity.sentence);
  }
  return { row, token, accounts: read.accounts, use };
}

/** A Mercury read that failed after the connection was checked: a 401 or 403 marks the row `error`. */
export async function readFailure(c: C, conn: PersonalConnection, e: unknown): Promise<Response> {
  if (e instanceof MercuryClientError && e.code === 'unauthorized') {
    await markError(c.env, conn.row, 'token_rejected');
    return refused(c, 409, 'mercury_reconnect_required', 'Mercury no longer accepts your token. Reconnect it with a Read Only token.');
  }
  return refuse(c, 502, { code: 'mercury_unreadable', message: 'Your Mercury account could not be read. Nothing changed; try again.', raw: e, audience: 'owner' });
}

/** Decision 5: one log row per read, with the use and counts, never a payload. */
export async function logPersonalRead(env: Env, conn: PersonalConnection, user: User, event: string, counts: Record<string, number>): Promise<void> {
  const summary = [`use=${conn.use}`, ...Object.entries(counts).map(([k, v]) => `${k}=${v}`)].join(' ');
  await env.DB.prepare(
    'INSERT INTO integration_logs (integration_id, user_id, provider_key, direction, event_type, status, response_summary) ' +
    "VALUES (?, ?, 'mercury', 'outbound', ?, 'ok', ?)",
  ).bind(conn.row.id, user.id, event, summary).run();
}

// ─────────────────────────────────────────────────────────── bank lines

/** One line as a member's lists and matchers read it. */
export interface BankLine {
  transaction_id: string;
  last_four: string;
  amount_cents: number;
  posted_on: string | null;
  created_on: string | null;
  status: string | null;
  posted: boolean;
  internal: boolean;
  voided: boolean;
  counterparty_name: string | null;
}

function toLine(t: ParsedTransaction, account: ParsedAccount): BankLine {
  return {
    transaction_id: t.mercury_transaction_id,
    last_four: account.last_four,
    amount_cents: t.amount_cents,
    posted_on: t.posted_on,
    created_on: t.created_on,
    status: t.status,
    posted: POSTED_STATUSES.includes(String(t.status || '')),
    internal: INTERNAL_KINDS.includes(String(t.kind || '')),
    voided: VOID_STATUSES.includes(String(t.status || '')),
    counterparty_name: t.counterparty_name,
  };
}

/** The member's lines in a window, oldest first, at most `MAX_LINES` across their accounts. */
export async function listOwnTransactions(conn: PersonalConnection, window: { from: string; to: string }): Promise<{ lines: BankLine[]; capped: boolean }> {
  const lines: BankLine[] = [];
  let capped = false;
  for (const account of conn.accounts) {
    for (let offset = 0; ; offset += PAGE) {
      const limit = Math.min(PAGE, MAX_LINES - lines.length);
      if (limit <= 0) { capped = true; break; }
      const page = parseTransactions(await listTransactions(conn.token, account.mercury_account_id, { start: window.from, limit, offset }));
      for (const t of page.transactions) {
        const day = t.posted_on ?? t.created_on;
        if (day && day >= window.from && day <= window.to) lines.push(toLine(t, account));
      }
      if (page.transactions.length + page.refused < limit) break;
    }
    if (capped) break;
  }
  return { lines, capped };
}

/** One of the member's lines, re-read by id from their own accounts; null when none of them holds it. */
export async function readOwnTransaction(conn: PersonalConnection, transactionId: string): Promise<BankLine | null> {
  for (const account of conn.accounts) {
    try {
      const t = parseTransaction(await getTransaction(conn.token, account.mercury_account_id, transactionId));
      if (t && t.mercury_transaction_id === transactionId) return toLine(t, account);
    } catch (e) {
      if (e instanceof MercuryClientError && e.code === 'http_error' && e.status === 404) continue;
      throw e;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────── stored evidence

/** Read stored evidence only. Callers must first authorize access to the target.
 * Never reads an integration, credential, or bank account. */
export async function matchFor(env: Env, target_kind: PersonalMatchTarget, target_id: number): Promise<BankMatch | null> {
  return await env.DB.prepare(`SELECT posted_on, account_last_four AS last_four
    FROM mercury_personal_matches WHERE target_kind = ? AND target_id = ? AND state = 'confirmed'`)
    .bind(target_kind, target_id).first<BankMatch>();
}

export interface MatchRow {
  id: number; uid: string; user_id: number; integration_id: number; mercury_transaction_id: string;
  account_last_four: string; amount_cents: number; posted_on: string; target_kind: PersonalMatchTarget;
  target_id: number; state: 'confirmed' | 'withdrawn'; confirmed_at: string; withdrawn_at: string | null; withdraw_reason: string | null;
}

export function matchDto(m: MatchRow) {
  return {
    uid: m.uid, target_kind: m.target_kind, target_id: Number(m.target_id), state: m.state,
    posted_on: m.posted_on, last_four: m.account_last_four, amount_cents: Number(m.amount_cents),
    confirmed_at: m.confirmed_at, withdrawn_at: m.withdrawn_at ?? null,
  };
}

// ─────────────────────────────────────────────────────────── the three matchers (decision 7)

/** One open target, with the rule a bank line must meet to settle it. */
export interface MatchTarget {
  kind: PersonalMatchTarget;
  id: number;
  label: string;
  state: string;
  /** Signed: a credit is positive, a debit negative. */
  expected_cents: number;
  window_start: string;
  window_end: string;
  /** The counterparty must name Axal VC Management LLC. */
  management: boolean;
  /** The account the line must be on, when the target names one. */
  last_four: string | null;
  /** D752 decision 4: false when the target's dollars are not a whole, positive number of cents. */
  matchable: boolean;
  unmatchable: 'amount_missing' | 'amount_not_whole_cents' | null;
}

const day10 = (v: unknown) => String(v ?? '').slice(0, 10);

/**
 * The caller's own open targets of one kind, never another member's. A target
 * with a confirmed match is left out, unless `includeMatched`.
 *  - invoice: the partner's, `USD`, a total above 0, issued or paid, credited within 180 days of issue;
 *  - payout: the member's, USD, never `failed`, a credit from Management within 60 days of the request,
 *    on the account ending in `destination_last4` when set;
 *  - settlement: the deal user's, `issued`, a credit (`to_member`) or debit (`from_member`) with
 *    Management, from 30 days before the due date to 90 after.
 */
export async function ownTargets(env: Env, user: User, kind: PersonalMatchTarget, id?: number, includeMatched = false): Promise<MatchTarget[]> {
  // Every filter is bound: ?1 the member, ?2 and ?3 the target's id (or null
  // for all), ?4 1 when a matched target counts, ?5 the kind.
  const binds = [user.id, id ?? null, id ?? null, includeMatched ? 1 : 0, kind];
  if (kind === 'engagement_invoice') {
    const rows = (await env.DB.prepare(
      `SELECT t.id, t.invoice_number, t.total_cents, t.status, t.issued_at FROM engagement_invoices t
        WHERE t.partner_user_id = ?1 AND t.status IN ('issued', 'paid') AND upper(t.currency) = 'USD' AND t.total_cents > 0 AND (?2 IS NULL OR t.id = ?3)
          AND (?4 = 1 OR NOT EXISTS (SELECT 1 FROM mercury_personal_matches m WHERE m.target_kind = ?5 AND m.target_id = t.id AND m.state = 'confirmed'))
        ORDER BY t.issued_at DESC, t.id DESC`,
    ).bind(...binds).all<{ id: number; invoice_number: string; total_cents: number; status: string; issued_at: string }>()).results || [];
    return rows.map((r) => ({
      kind, id: Number(r.id), label: r.invoice_number, state: r.status, expected_cents: Number(r.total_cents),
      window_start: day10(r.issued_at), window_end: plusDays(day10(r.issued_at), INVOICE_WINDOW_DAYS), management: false, last_four: null,
      matchable: true, unmatchable: null,
    }));
  }
  if (kind === 'payout') {
    const rows = (await env.DB.prepare(
      `SELECT t.id, t.amount_cents, t.status, t.created_at, t.destination_last4 FROM payouts t
        WHERE t.user_id = ?1 AND t.status <> 'failed' AND upper(t.currency) = 'USD' AND t.amount_cents > 0 AND (?2 IS NULL OR t.id = ?3)
          AND (?4 = 1 OR NOT EXISTS (SELECT 1 FROM mercury_personal_matches m WHERE m.target_kind = ?5 AND m.target_id = t.id AND m.state = 'confirmed'))
        ORDER BY t.created_at DESC, t.id DESC`,
    ).bind(...binds).all<{ id: number; amount_cents: number; status: string; created_at: string; destination_last4: string | null }>()).results || [];
    return rows.map((r) => ({
      kind, id: Number(r.id), label: `Payout ${r.id}`, state: r.status, expected_cents: Number(r.amount_cents),
      window_start: day10(r.created_at), window_end: plusDays(day10(r.created_at), PAYOUT_WINDOW_DAYS), management: true,
      last_four: r.destination_last4 ? String(r.destination_last4).toUpperCase() : null,
      matchable: true, unmatchable: null,
    }));
  }
  if (kind === 'raise_prospect' || kind === 'deal_commitment') return raiseTargets(env, user, kind, id, includeMatched);
  if (kind === 'partner_deal_settlement') {
    const rows = (await env.DB.prepare(
      `SELECT t.id, t.kind, t.direction, t.amount_cents, t.due_on, t.state FROM partner_deal_settlements t
        WHERE t.user_id = ?1 AND (t.state = 'issued' OR (t.state = 'matched' AND ?4 = 1)) AND (?2 IS NULL OR t.id = ?3)
            AND (?4 = 1 OR NOT EXISTS (SELECT 1 FROM mercury_personal_matches m WHERE m.target_kind = ?5 AND m.target_id = t.id AND m.state = 'confirmed'))
        ORDER BY t.due_on DESC, t.id DESC`,
    ).bind(...binds).all<{ id: number; kind: string; direction: string; amount_cents: number; due_on: string; state: string }>()).results || [];
    return rows.map((r) => ({
      kind, id: Number(r.id), label: `Settlement ${r.id}`, state: r.state,
      expected_cents: r.direction === 'from_member' ? -Number(r.amount_cents) : Number(r.amount_cents),
      window_start: plusDays(r.due_on, -SETTLEMENT_BEFORE_DAYS), window_end: plusDays(r.due_on, SETTLEMENT_AFTER_DAYS), management: true, last_four: null,
      matchable: true, unmatchable: null,
    }));
  }
  return [];
}

/**
 * D752 decisions 2 to 5: the founder's own committed raise prospects, or the
 * pending commitments on their deals. Bound to `user.founder_id`, never
 * `user.id`, and never through `canAccessFounderResource` (which also admits
 * admins and partners). A target whose dollars are not a whole, positive
 * number of cents is listed with `matchable: false` and its reason.
 */
async function raiseTargets(env: Env, user: User, kind: 'raise_prospect' | 'deal_commitment', id?: number, includeMatched = false): Promise<MatchTarget[]> {
  if (user.founder_id == null) return [];
  // ?1 the caller's founder id, ?2 and ?3 the target's id (or null), ?4 1 when a matched target counts, ?5 the kind.
  const binds = [user.founder_id, id ?? null, id ?? null, includeMatched ? 1 : 0, kind];
  type Row = { id: number; label_a: string | null; label_b: string | null; amount: unknown; state: string; created_at: string; project_name: string | null };
  const rows = kind === 'raise_prospect'
    ? (await env.DB.prepare(
      `SELECT t.id, t.name AS label_a, t.firm AS label_b, t.amount, t.stage AS state, t.created_at, p.name AS project_name
         FROM raise_prospects t JOIN projects p ON p.id = t.project_id
        WHERE p.founder_id = ?1 AND t.stage = 'committed' AND (?2 IS NULL OR t.id = ?3)
          AND (?4 = 1 OR NOT EXISTS (SELECT 1 FROM mercury_personal_matches m WHERE m.target_kind = ?5 AND m.target_id = t.id AND m.state = 'confirmed'))
        ORDER BY t.created_at DESC, t.id DESC`,
    ).bind(...binds).all<Row>()).results || []
    : (await env.DB.prepare(
      `SELECT t.id, u.name AS label_a, NULL AS label_b, t.amount, t.status AS state, t.created_at, p.name AS project_name
         FROM commitments t JOIN deals d ON d.id = t.deal_id JOIN projects p ON p.id = d.project_id
         LEFT JOIN users u ON u.id = t.investor_user_id
        WHERE p.founder_id = ?1 AND (t.status = 'pending' OR (t.status = 'confirmed' AND ?4 = 1)) AND (?2 IS NULL OR t.id = ?3)
          AND (?4 = 1 OR NOT EXISTS (SELECT 1 FROM mercury_personal_matches m WHERE m.target_kind = ?5 AND m.target_id = t.id AND m.state = 'confirmed'))
        ORDER BY t.created_at DESC, t.id DESC`,
    ).bind(...binds).all<Row>()).results || [];
  const now = today();
  const floor = plusDays(now, -MAX_WINDOW_DAYS);
  return rows.map((r) => {
    const cents = r.amount == null ? null : toCents(r.amount);
    const unmatchable = r.amount == null ? 'amount_missing' as const : cents == null ? 'amount_not_whole_cents' as const : cents <= 0 ? 'amount_missing' as const : null;
    const opened = plusDays(day10(r.created_at), -RAISE_BEFORE_DAYS);
    const who = r.label_a || r.label_b || (kind === 'raise_prospect' ? `Prospect ${r.id}` : `Commitment ${r.id}`);
    return {
      kind, id: Number(r.id), label: `${who} · ${r.project_name || 'Project'}`, state: r.state,
      expected_cents: unmatchable ? 0 : cents!, window_start: opened < floor ? floor : opened, window_end: now,
      management: false, last_four: null, matchable: !unmatchable, unmatchable,
    };
  });
}

/** Decision 7: does this line settle this target? Posted, not internal, the exact amount, in the window. */
export function lineFits(target: MatchTarget, line: BankLine): boolean {
  if (!target.matchable) return false;
  if (!line.posted || line.internal || line.voided || !line.posted_on) return false;
  if (line.amount_cents !== target.expected_cents) return false;
  if (line.posted_on < target.window_start || line.posted_on > target.window_end) return false;
  if (target.management && !namesAxalEntity(line.counterparty_name, 'management')) return false;
  if (target.last_four && line.last_four !== target.last_four) return false;
  return true;
}

/** The read window that covers every target, clamped to today and to 366 days. */
export function windowFor(all: MatchTarget[], now = today()): { from: string; to: string } | null {
  const targets = all.filter((t) => t.matchable);
  if (!targets.length) return null;
  const to = targets.map((t) => t.window_end).reduce((a, b) => (a > b ? a : b));
  const end = to > now ? now : to;
  let start = targets.map((t) => t.window_start).reduce((a, b) => (a < b ? a : b));
  if (daysBetween(start, end) > MAX_WINDOW_DAYS) start = plusDays(end, -MAX_WINDOW_DAYS);
  return start > end ? null : { from: start, to: end };
}

/** The member's bank lines that already settle one of their targets. */
async function matchedTransactions(env: Env, user: User): Promise<Set<string>> {
  const rows = (await env.DB.prepare(
    "SELECT mercury_transaction_id FROM mercury_personal_matches WHERE user_id = ? AND state = 'confirmed'",
  ).bind(user.id).all<{ mercury_transaction_id: string }>()).results || [];
  return new Set(rows.map((r) => r.mercury_transaction_id));
}

/** D752 decision 10: which of these lines are already rows on the revenue ledger. */
export async function importedAsRevenue(env: Env, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = (await env.DB.prepare(
    "SELECT source_ref FROM revenue_entries WHERE source = 'mercury' AND source_ref IN (SELECT value FROM json_each(?))",
  ).bind(JSON.stringify(ids)).all<{ source_ref: string }>()).results || [];
  return new Set(rows.map((r) => r.source_ref));
}

/** Each open target with every line that fits it; several fit, all are listed, and the member picks one. */
export async function proposals(env: Env, user: User, conn: PersonalConnection, targets: MatchTarget[]) {
  const window = windowFor(targets);
  const { lines, capped } = window ? await listOwnTransactions(conn, window) : { lines: [], capped: false };
  const taken = await matchedTransactions(env, user);
  // A line already on the revenue ledger is never offered as a raise receipt (D752 decision 10).
  const revenue = targets.some((t) => RAISE_KINDS.includes(t.kind)) ? await importedAsRevenue(env, lines.map((l) => l.transaction_id)) : new Set<string>();
  const items = targets.map((t) => ({
    target_kind: t.kind, target_id: t.id, label: t.label, state: t.state, amount_cents: Math.abs(t.expected_cents),
    direction: t.expected_cents < 0 ? 'debit' : 'credit', window: { from: t.window_start, to: t.window_end },
    matchable: t.matchable, unmatchable: t.unmatchable,
    candidates: lines.filter((l) => !taken.has(l.transaction_id) && !(RAISE_KINDS.includes(t.kind) && revenue.has(l.transaction_id)) && lineFits(t, l)).map((l) => ({
      transaction_id: l.transaction_id, posted_on: l.posted_on, amount_cents: l.amount_cents,
      last_four: l.last_four, counterparty_name: l.counterparty_name,
    })),
  }));
  return { items, lines_read: lines.length, capped };
}

export type MatchOutcome = { ok: true; match: MatchRow } | { ok: false; status: number; code: string; message: string };

/**
 * Confirm one line against one of the member's own targets: re-read, re-check, write.
 * An invoice that is `issued` becomes `paid` on the posted date; one already `paid`
 * gains the evidence. A settlement becomes `matched`. A payout's status is the
 * Super Admin's and is never changed here.
 *
 * D752: a raise prospect's `commit_status` becomes `wired` while it is still
 * `committed`; a deal commitment moves from `pending` to `confirmed`
 * (`deals.capital_committed` already counted it). A line already on the
 * revenue ledger is refused `imported_as_revenue`, checked first and again
 * inside the INSERT, and the effect runs only when this confirmation's row
 * exists, so a revenue import racing it cannot leave a prospect `wired`.
 */
export async function confirmMatch(env: Env, user: User, conn: PersonalConnection, kind: PersonalMatchTarget, targetId: number, transactionId: string,
  deps: { importedAsRevenue?: typeof importedAsRevenue } = {}): Promise<MatchOutcome> {
  const raise = RAISE_KINDS.includes(kind);
  const [target] = await ownTargets(env, user, kind, targetId, true);
  if (!target) return { ok: false, status: 404, code: 'target_not_found', message: NOT_FOUND[kind] };
  if (await matchFor(env, kind, targetId)) return { ok: false, status: 409, code: 'target_already_matched', message: 'That is already matched to a bank line. Withdraw the match first.' };
  if (target.state === 'matched' || (kind === 'deal_commitment' && target.state !== 'pending')) {
    return { ok: false, status: 409, code: 'target_already_matched', message: 'That is already matched to a bank line. Withdraw the match first.' };
  }
  if (!target.matchable) return { ok: false, status: 409, code: 'not_matchable', message: 'This commitment has no amount in whole cents, so no bank line can settle it.' };
  const line = await readOwnTransaction(conn, transactionId);
  if (!line) return { ok: false, status: 404, code: 'transaction_not_found', message: 'That line is not in your Mercury account.' };
  if (!lineFits(target, line)) return { ok: false, status: 409, code: 'not_matchable', message: 'That line does not settle this: the amount, date, counterparty or account does not fit.' };
  if (raise && (await (deps.importedAsRevenue ?? importedAsRevenue)(env, [line.transaction_id])).has(line.transaction_id)) return IMPORTED_AS_REVENUE;
  const uid = crypto.randomUUID();
  const stmts = [raise
    ? env.DB.prepare(
      `INSERT INTO mercury_personal_matches (uid, user_id, integration_id, mercury_transaction_id, account_last_four, amount_cents, posted_on, target_kind, target_id, state)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed'
        WHERE NOT EXISTS (SELECT 1 FROM revenue_entries r WHERE r.source = 'mercury' AND r.source_ref = ?)`,
    ).bind(uid, user.id, conn.row.id, line.transaction_id, line.last_four, line.amount_cents, line.posted_on, kind, targetId, line.transaction_id)
    : env.DB.prepare(
      `INSERT INTO mercury_personal_matches (uid, user_id, integration_id, mercury_transaction_id, account_last_four, amount_cents, posted_on, target_kind, target_id, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
    ).bind(uid, user.id, conn.row.id, line.transaction_id, line.last_four, line.amount_cents, line.posted_on, kind, targetId)];
  if (kind === 'engagement_invoice') {
    stmts.push(env.DB.prepare(
      "UPDATE engagement_invoices SET status = 'paid', paid_at = ?, updated_at = datetime('now') WHERE id = ? AND status = 'issued'",
    ).bind(line.posted_on, targetId));
  }
  if (kind === 'partner_deal_settlement') {
    stmts.push(env.DB.prepare(
      "UPDATE partner_deal_settlements SET state = 'matched', updated_at = datetime('now') WHERE id = ? AND state = 'issued'",
    ).bind(targetId));
  }
  if (kind === 'raise_prospect') {
    stmts.push(env.DB.prepare(
      `UPDATE raise_prospects SET commit_status = 'wired', updated_at = datetime('now')
        WHERE id = ? AND stage = 'committed' AND EXISTS (SELECT 1 FROM mercury_personal_matches WHERE uid = ? AND state = 'confirmed')`,
    ).bind(targetId, uid));
  }
  if (kind === 'deal_commitment') {
    stmts.push(env.DB.prepare(
      `UPDATE commitments SET status = 'confirmed'
        WHERE id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM mercury_personal_matches WHERE uid = ? AND state = 'confirmed')`,
    ).bind(targetId, uid));
  }
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message || ''))) {
      return { ok: false, status: 409, code: 'already_matched', message: 'That line or target is already matched.' };
    }
    throw e;
  }
  const match = await env.DB.prepare('SELECT * FROM mercury_personal_matches WHERE uid = ?').bind(uid).first<MatchRow>();
  // No row: a revenue import took the line between the check and the INSERT.
  if (!match) return IMPORTED_AS_REVENUE;
  return { ok: true, match };
}

const NOT_FOUND: Record<PersonalMatchTarget, string> = {
  engagement_invoice: 'That is not one of your open invoices, payouts or settlements.',
  payout: 'That is not one of your open invoices, payouts or settlements.',
  partner_deal_settlement: 'That is not one of your open invoices, payouts or settlements.',
  raise_prospect: 'That is not one of your committed raise prospects.',
  deal_commitment: 'That is not one of your pending deal commitments.',
};
const IMPORTED_AS_REVENUE: MatchOutcome = {
  ok: false, status: 409, code: 'imported_as_revenue',
  message: 'That line is already on your revenue ledger. Delete that entry first, or leave the commitment unmatched.',
};

/**
 * Withdraw a confirmed match, with a reason of at least 10 characters. A
 * settlement returns to `issued`; an invoice stays `paid`, as the partner's
 * own word today; a payout loses its evidence. D752: a deal commitment returns
 * to `pending`; a raise prospect keeps its `commit_status`, the founder's own
 * word. Another member's uid is 404, exactly as a missing one.
 */
export async function withdrawMatch(env: Env, user: User, uid: string, reason: string): Promise<MatchOutcome> {
  const m = await env.DB.prepare('SELECT * FROM mercury_personal_matches WHERE uid = ? AND user_id = ?').bind(uid, user.id).first<MatchRow>();
  if (!m) return { ok: false, status: 404, code: 'match_not_found', message: 'No such match.' };
  if (m.state !== 'confirmed') return { ok: false, status: 409, code: 'match_withdrawn', message: 'That match is already withdrawn.' };
  const stmts = [env.DB.prepare(
    "UPDATE mercury_personal_matches SET state = 'withdrawn', withdrawn_at = datetime('now'), withdraw_reason = ?, updated_at = datetime('now') WHERE id = ? AND state = 'confirmed'",
  ).bind(reason, m.id)];
  if (m.target_kind === 'partner_deal_settlement') {
    stmts.push(env.DB.prepare(
      "UPDATE partner_deal_settlements SET state = 'issued', updated_at = datetime('now') WHERE id = ? AND state = 'matched'",
    ).bind(m.target_id));
  }
  if (m.target_kind === 'deal_commitment') {
    stmts.push(env.DB.prepare("UPDATE commitments SET status = 'pending' WHERE id = ? AND status = 'confirmed'").bind(m.target_id));
  }
  await env.DB.batch(stmts);
  const fresh = await env.DB.prepare('SELECT * FROM mercury_personal_matches WHERE id = ?').bind(m.id).first<MatchRow>();
  return { ok: true, match: fresh! };
}

/** The match row's use, for the policy check before a withdraw. */
export async function matchUse(env: Env, user: User, uid: string): Promise<PersonalUse | null> {
  const m = await env.DB.prepare('SELECT target_kind FROM mercury_personal_matches WHERE uid = ? AND user_id = ?').bind(uid, user.id).first<{ target_kind: PersonalMatchTarget }>();
  return m ? USE_OF_TARGET[m.target_kind] ?? null : null;
}

// ─────────────────────────────────────────────────────────── D752: reads for the revenue ledger

/**
 * The caller's confirmed raise receipts, by Mercury transaction id, optionally
 * narrowed to `ids`. Reads the database only; #1889's financing-in counts them.
 */
export async function raiseReceiptIds(env: Env, userId: number, ids?: string[]): Promise<Set<string>> {
  if (ids && !ids.length) return new Set();
  const rows = (await env.DB.prepare(
    `SELECT mercury_transaction_id FROM mercury_personal_matches
      WHERE user_id = ? AND state = 'confirmed' AND target_kind IN ('raise_prospect', 'deal_commitment')
        AND (? IS NULL OR mercury_transaction_id IN (SELECT value FROM json_each(?)))`,
  ).bind(userId, ids ? 1 : null, JSON.stringify(ids ?? [])).all<{ mercury_transaction_id: string }>()).results || [];
  return new Set(rows.map((r) => r.mercury_transaction_id));
}

/** The caller's open, matchable raise targets of both kinds (decision 11's hint). Reads the database only. */
export async function openRaiseTargets(env: Env, user: User): Promise<MatchTarget[]> {
  const all = [...await ownTargets(env, user, 'raise_prospect'), ...await ownTargets(env, user, 'deal_commitment')];
  return all.filter((t) => t.matchable);
}
