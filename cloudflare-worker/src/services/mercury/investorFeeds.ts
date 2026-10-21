/**
 * D840 part 4 (#2349) — an investor's own Mercury feeds their sections.
 * READ-ONLY: every Mercury read goes through `reads.ts`; nothing here asks
 * Mercury to send, transfer, request or change anything.
 *
 * FACTS ARE WRITTEN; JUDGEMENT IS PROPOSED (D782).
 *
 *   section            from Mercury                        lands as
 *   Deals · Commit     available balances, picked accounts FACT  mercury_investor_capacity
 *   Deals · Closing    outgoing wires and ACH payments     PROPOSAL → the investor's own commitment
 *   Fund · Calls       incoming credits                    PROPOSAL → an open line; Accept records the receipt
 *   Fund · Accounting  transactions and their categories   PROPOSAL → a ledger entry, through a confirmed category map
 *   Fund · Reporting   statements                          FACT  fund_month_end_cash; PROPOSAL → attach the statement
 *
 * THE LEDGER. Every item lands through `connector_fed_items` keyed
 * `<kind>:<Mercury id>` (one Mercury line can be a Closing proposal and a
 * ledger proposal at once, and the ledger keeps one row per id). A sync
 * updates a fact it made and adds what is new; an id the ledger already holds
 * whose row is gone — a deleted fact, a dismissed proposal — is skipped, so a
 * sync never brings it back (D655, #1906).
 *
 * ONLY THE INVESTOR, ONLY ON THEIR OWN PAGES. Every read and write here is
 * keyed by the caller's own user id: their commitments, the funds they are GP
 * of (`vc_funds.gp_user_id`) or administer (`fund_admin_user_id`). Nothing
 * here is read by a founder, admin or LP route, and the capacity figure is
 * never added to a commitment, a deal or a notification.
 *
 * NO FIGURE IN A LOG. A failed read is the code alone; the route's log row
 * holds counts (`logPersonalRead`).
 *
 * The capital-call rule is D710's (`match.ts` `callLineFits`), applied to the
 * investor's own fund. When more than one line fits by amount and date, the
 * payer decides: the line whose LP name is the counterparty's. Otherwise no
 * proposal is made, as the entity matcher does.
 */
import type { Env, User } from '../../types';
import type { ParsedAccount } from './parse';
import { INTERNAL_KINDS, POSTED_STATUSES, VOID_STATUSES } from './parse';
import type { McpTransaction, MercuryReads, Statement, StatementPdf } from './reads';
import { callLineFits, openLines, type OpenLine } from './match';
import { recordReceipt } from '../fundCallLedger';
import { LedgerRefusal, postLedgerEntry } from '../fundLedger';
import { newUid } from './store';

/** A reader of the investor's own Mercury: what this file uses. */
export type InvestorReader = Pick<MercuryReads, 'accounts' | 'transactions' | 'statements' | 'statementPdf'>;

export type ProposalKind = 'closing' | 'call' | 'ledger' | 'statement';
export type InvestorSection = 'commit' | 'closing' | 'calls' | 'ledger' | 'reporting';

/** The ledger's module for each kind (`connector_fed_items.module`). */
export const INVESTOR_MODULES = Object.freeze({
  capacity: 'deals_commit',
  closing: 'deals_closing',
  call: 'fund_calls',
  ledger: 'fund_ledger',
  cash: 'fund_reporting',
  statement: 'fund_reporting',
} as const);

/** Decision 5 of D713, kept: a read covers at most 366 days and 1,000 lines. */
export const MAX_LINES = 1000;
export const MAX_PAGES = 10;
/** A commitment's wire is looked for from 30 days before it was recorded to 180 days after. */
export const CLOSING_BEFORE_DAYS = 30;
export const CLOSING_AFTER_DAYS = 180;
/** UNVERIFIED (D840.md): the kinds Mercury gives card spending, which never funds a deal. */
export const CARD_KINDS: readonly string[] = Object.freeze(['debitCardTransaction', 'creditCardTransaction']);

const plusDays = (d: string, n: number) => {
  const t = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** One posted line of the investor's own accounts, with the last four of its account. */
export interface InvestorLine {
  id: string;
  amount_cents: number;
  posted_on: string;
  last_four: string;
  counterparty: string | null;
  category: string | null;
  kind: string | null;
}

/** Posted, not voided, not a move between their own accounts, on one of their checking or savings accounts. */
export function usableLine(t: McpTransaction, byAccount: Map<string, ParsedAccount>): InvestorLine | null {
  const day = t.posted_on;
  const account = t.mercury_account_id ? byAccount.get(t.mercury_account_id) : undefined;
  if (!day || !account) return null;
  if (!POSTED_STATUSES.includes(String(t.status || '')) || VOID_STATUSES.includes(String(t.status || ''))) return null;
  if (INTERNAL_KINDS.includes(String(t.kind || ''))) return null;
  return { id: t.mercury_transaction_id, amount_cents: t.amount_cents, posted_on: day, last_four: account.last_four,
    counterparty: t.counterparty_name, category: t.category, kind: t.kind };
}

/** The investor's lines posted in a window, oldest first, at most `MAX_LINES`. */
export async function readLines(reader: InvestorReader, window: { from: string; to: string }, accountIds: string[] | null = null):
  Promise<{ accounts: ParsedAccount[]; lines: InvestorLine[]; capped: boolean }> {
  // The accounts the investor picked for this section, else every one of theirs.
  const accounts = (await reader.accounts()).filter((a) => !accountIds?.length || accountIds.includes(a.mercury_account_id));
  const byAccount = new Map(accounts.map((a) => [a.mercury_account_id, a]));
  const lines: InvestorLine[] = [];
  let cursor: string | null = null;
  let capped = false;
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await reader.transactions({ accountIds: accounts.map((a) => a.mercury_account_id), postedStart: window.from, postedEnd: window.to, startAfter: cursor });
    for (const t of page.transactions) {
      const line = usableLine(t, byAccount);
      if (line && line.posted_on >= window.from && line.posted_on <= window.to) lines.push(line);
      if (lines.length >= MAX_LINES) { capped = true; break; }
    }
    cursor = page.next;
    if (capped || !cursor) break;
    if (p === MAX_PAGES - 1) capped = true;
  }
  return { accounts, lines, capped };
}

// ─────────────────────────────────────────────────────────── the ledger

export interface LedgerState { linked: boolean }

/** What the ledger holds for these ids: linked (a live row) or not (its row was deleted or dismissed). */
export async function ledgerOf(env: Env, integrationId: number, externalIds: string[]): Promise<Map<string, LedgerState>> {
  if (!externalIds.length) return new Map();
  const r = await env.DB.prepare(
    'SELECT external_id, local_id FROM connector_fed_items WHERE integration_id = ? AND external_id IN (SELECT value FROM json_each(?))',
  ).bind(integrationId, JSON.stringify(externalIds)).all<{ external_id: string; local_id: number | null }>();
  return new Map((r.results || []).map((x) => [x.external_id, { linked: x.local_id != null }]));
}

const LEDGER_NEW = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
  VALUES (?, NULL, ?, ?, ?, ?, ?)
  ON CONFLICT (integration_id, external_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP`;

// ─────────────────────────────────────────────────────────── Deals · Commit (fact)

export type CapacityRefusal = 'invalid_accounts' | 'account_not_found' | 'balance_unreadable';

/** The available cash across the accounts picked by id; fails closed on a balance Mercury did not give. */
export function capacityOf(accounts: ParsedAccount[], accountIds: string[]):
  { ok: true; available_cents: number; last_fours: string[] } | { ok: false; code: CapacityRefusal } {
  const ids = [...new Set(accountIds)];
  if (!ids.length || ids.length > 20) return { ok: false, code: 'invalid_accounts' };
  let sum = 0;
  const fours: string[] = [];
  for (const id of ids) {
    const a = accounts.find((x) => x.mercury_account_id === id);
    if (!a) return { ok: false, code: 'account_not_found' };
    if (a.available_cents == null || !Number.isSafeInteger(a.available_cents)) return { ok: false, code: 'balance_unreadable' };
    sum += Math.max(0, a.available_cents);
    fours.push(a.last_four);
  }
  return { ok: true, available_cents: sum, last_fours: fours.sort() };
}

/**
 * The capacity fact, written or refreshed: by the investor's own pick, or by a
 * sync of a live row (a sync after Delete finds no row and writes nothing).
 */
export async function writeCapacity(env: Env, user: User, integrationId: number,
  fact: { available_cents: number; last_fours: string[] }, asOf: string): Promise<void> {
  const key = `capacity:${user.id}`;
  await env.DB.prepare(
    `INSERT INTO mercury_investor_capacity (user_id, integration_id, available_cents, account_last_fours, as_of)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET integration_id = excluded.integration_id, available_cents = excluded.available_cents,
       account_last_fours = excluded.account_last_fours, as_of = excluded.as_of, updated_at = CURRENT_TIMESTAMP`,
  ).bind(user.id, integrationId, fact.available_cents, JSON.stringify(fact.last_fours), asOf).run();
  const row = await env.DB.prepare('SELECT id FROM mercury_investor_capacity WHERE user_id = ?').bind(user.id).first<{ id: number }>();
  await env.DB.prepare(LEDGER_NEW).bind(integrationId, INVESTOR_MODULES.capacity, 'capacity', key, 'mercury_investor_capacity', row!.id).run();
  await env.DB.prepare(
    "UPDATE connector_fed_items SET local_table = 'mercury_investor_capacity', local_id = ? WHERE integration_id = ? AND external_id = ?",
  ).bind(row!.id, integrationId, key).run();
}

/** The investor's own capacity, for their own page only. */
export async function readCapacity(env: Env, user: User) {
  const r = await env.DB.prepare(
    'SELECT available_cents, account_last_fours, as_of, updated_at FROM mercury_investor_capacity WHERE user_id = ?',
  ).bind(user.id).first<{ available_cents: number; account_last_fours: string; as_of: string; updated_at: string }>();
  if (!r) return null;
  let fours: string[] = [];
  try { fours = JSON.parse(r.account_last_fours); } catch { fours = []; }
  return { available_cents: Number(r.available_cents), account_last_fours: fours, as_of: r.as_of, updated_at: r.updated_at };
}

/** Delete the capacity fact; the ledger keeps its id unlinked, so a sync does not bring it back. */
export async function deleteCapacity(env: Env, user: User): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM mercury_investor_capacity WHERE user_id = ?').bind(user.id).run();
  await env.DB.prepare(
    "UPDATE connector_fed_items SET local_id = NULL WHERE external_id = ? AND local_table = 'mercury_investor_capacity'",
  ).bind(`capacity:${user.id}`).run();
  return Number(r.meta?.changes ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────── proposals

export interface ProposalDraft {
  kind: ProposalKind;
  mercury_id: string;
  target_kind: 'deal_commitment' | 'capital_call_line' | 'fund_ledger' | 'fund_report_period';
  target_id: number;
  fund_id: number | null;
  amount_cents: number | null;
  posted_on: string | null;
  account_last_four: string | null;
  counterparty: string | null;
  category: string | null;
}

export const externalIdOf = (d: Pick<ProposalDraft, 'kind' | 'mercury_id' | 'target_kind' | 'target_id'>) =>
  d.kind === 'statement' ? `statement:${d.mercury_id}:${d.target_id}` : `${d.kind}:${d.mercury_id}`;

/** Insert each new proposal and its ledger row; an id the ledger already holds is left as it is. */
export async function writeProposals(env: Env, user: User, integrationId: number, drafts: ProposalDraft[]): Promise<{ proposed: number; skipped: number }> {
  const ids = drafts.map(externalIdOf);
  const held = await ledgerOf(env, integrationId, ids);
  let proposed = 0, skipped = 0;
  for (const d of drafts) {
    const ext = externalIdOf(d);
    if (held.has(ext)) { skipped += 1; continue; }
    const r = await env.DB.prepare(
      `INSERT OR IGNORE INTO mercury_investor_proposals
         (uid, user_id, integration_id, kind, external_id, mercury_id, target_kind, target_id, fund_id, amount_cents, posted_on, account_last_four, counterparty, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newUid(), user.id, integrationId, d.kind, ext, d.mercury_id, d.target_kind, d.target_id, d.fund_id,
      d.amount_cents, d.posted_on, d.account_last_four, d.counterparty, d.category).run();
    if (Number(r.meta?.changes ?? 0) !== 1) { skipped += 1; continue; }
    const row = await env.DB.prepare('SELECT id FROM mercury_investor_proposals WHERE user_id = ? AND external_id = ?').bind(user.id, ext).first<{ id: number }>();
    await env.DB.prepare(LEDGER_NEW).bind(integrationId, INVESTOR_MODULES[d.kind], d.kind, ext, 'mercury_investor_proposals', row!.id).run();
    proposed += 1;
  }
  return { proposed, skipped };
}

export interface ProposalRow extends ProposalDraft { id: number; uid: string; user_id: number; integration_id: number; external_id: string; state: string; result_ref: string | null; decided_at: string | null; created_at: string }

/** The caller's own proposals of a kind (and fund), every state; a dismissed one is not listed. */
export async function listProposals(env: Env, user: User, kind: ProposalKind, fundId: number | null = null): Promise<ProposalRow[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM mercury_investor_proposals WHERE user_id = ? AND kind = ? AND state <> 'dismissed'
        AND (? IS NULL OR fund_id = ?) ORDER BY posted_on DESC, id DESC LIMIT 200`,
  ).bind(user.id, kind, fundId, fundId).all<ProposalRow>();
  return r.results || [];
}

export async function ownProposal(env: Env, user: User, uid: string): Promise<ProposalRow | null> {
  return await env.DB.prepare('SELECT * FROM mercury_investor_proposals WHERE uid = ? AND user_id = ?').bind(uid, user.id).first<ProposalRow>() ?? null;
}

/** Dismiss: the row stays, unlinked in the ledger, so the same item is never proposed again. */
export async function dismissProposal(env: Env, user: User, p: ProposalRow): Promise<boolean> {
  const r = await env.DB.prepare(
    "UPDATE mercury_investor_proposals SET state = 'dismissed', decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND state = 'proposed'",
  ).bind(p.id, user.id).run();
  if (Number(r.meta?.changes ?? 0) !== 1) return false;
  await env.DB.prepare("UPDATE connector_fed_items SET local_id = NULL WHERE integration_id = ? AND external_id = ? AND local_table = 'mercury_investor_proposals'")
    .bind(p.integration_id, p.external_id).run();
  return true;
}

async function markAccepted(env: Env, user: User, p: ProposalRow, ref: string | null): Promise<boolean> {
  const r = await env.DB.prepare(
    "UPDATE mercury_investor_proposals SET state = 'accepted', result_ref = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND state = 'proposed'",
  ).bind(ref, p.id, user.id).run();
  return Number(r.meta?.changes ?? 0) === 1;
}

// ─────────────────────────────────────────────────────────── Deals · Closing (proposal)

interface OwnCommitment { id: number; amount_cents: number; created_on: string; deal_label: string | null }

/** The caller's own commitments that a wire could fund: not withdrawn, with a whole-cent amount. */
export async function ownCommitments(env: Env, user: User): Promise<OwnCommitment[]> {
  const r = await env.DB.prepare(
    `SELECT c.id, c.amount, c.created_at, p.name AS project_name
       FROM commitments c JOIN deals d ON d.id = c.deal_id LEFT JOIN projects p ON p.id = d.project_id
      WHERE c.investor_user_id = ? AND c.status <> 'withdrawn' ORDER BY c.id`,
  ).bind(user.id).all<{ id: number; amount: number | null; created_at: string | null; project_name: string | null }>();
  return (r.results || []).flatMap((c) => {
    const cents = c.amount == null ? NaN : Math.round(Number(c.amount) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0 || !c.created_at) return [];
    return [{ id: Number(c.id), amount_cents: cents, created_on: String(c.created_at).slice(0, 10), deal_label: c.project_name }];
  });
}

/** An outgoing payment (not card spending) funds a commitment of exactly its amount, posted in its window. */
export function closingFits(c: OwnCommitment, line: InvestorLine): boolean {
  return line.amount_cents < 0 && !CARD_KINDS.includes(String(line.kind || '')) && -line.amount_cents === c.amount_cents
    && line.posted_on >= plusDays(c.created_on, -CLOSING_BEFORE_DAYS) && line.posted_on <= plusDays(c.created_on, CLOSING_AFTER_DAYS);
}

/** One proposal per line that fits exactly one commitment, and per commitment that exactly one line fits. */
export function closingDrafts(commitments: OwnCommitment[], lines: InvestorLine[]): ProposalDraft[] {
  const out: ProposalDraft[] = [];
  for (const c of commitments) {
    const fits = lines.filter((l) => closingFits(c, l));
    if (fits.length !== 1) continue;
    const l = fits[0];
    if (commitments.filter((x) => closingFits(x, l)).length !== 1) continue;
    out.push({ kind: 'closing', mercury_id: l.id, target_kind: 'deal_commitment', target_id: c.id, fund_id: null,
      amount_cents: -l.amount_cents, posted_on: l.posted_on, account_last_four: l.last_four, counterparty: l.counterparty, category: null });
  }
  return out;
}

// ─────────────────────────────────────────────────────────── Fund · Calls (proposal)

/** The funds the caller is GP of (never an admin's view: these are their own). */
export async function gpFunds(env: Env, user: User, fundId: number | null = null): Promise<{ id: number; name: string | null }[]> {
  const r = await env.DB.prepare('SELECT id, name FROM vc_funds WHERE gp_user_id = ? AND (? IS NULL OR id = ?) ORDER BY id')
    .bind(user.id, fundId, fundId).all<{ id: number; name: string | null }>();
  return (r.results || []).map((f) => ({ id: Number(f.id), name: f.name }));
}

/** The LP names of a fund's open lines, for the payer check. */
async function lineNames(env: Env, ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const r = await env.DB.prepare(
    `SELECT cc.id, COALESCE(u.name, lp.name) AS name FROM capital_calls cc JOIN limited_partners lp ON lp.id = cc.limited_partner_id
       LEFT JOIN users u ON u.id = lp.user_id WHERE cc.id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(ids)).all<{ id: number; name: string | null }>();
  return new Map((r.results || []).map((x) => [Number(x.id), norm(x.name)]));
}

/** D710's rule per credit; when several lines fit, the payer's name picks one, or none is proposed. */
export function callDrafts(fundId: number, lines: OpenLine[], names: Map<number, string>, credits: InvestorLine[]): ProposalDraft[] {
  const out: ProposalDraft[] = [];
  const taken = new Set<number>();
  for (const c of credits) {
    if (c.amount_cents <= 0) continue;
    // Counted over every open line, as the entity matcher counts them; only then does the payer pick.
    let fits = lines.filter((l) => callLineFits(l, c));
    if (fits.length > 1) {
      const payer = norm(c.counterparty);
      fits = payer ? fits.filter((l) => names.get(l.id) === payer) : [];
    }
    if (fits.length !== 1 || taken.has(fits[0].id)) continue;
    taken.add(fits[0].id);
    out.push({ kind: 'call', mercury_id: c.id, target_kind: 'capital_call_line', target_id: fits[0].id, fund_id: fundId,
      amount_cents: c.amount_cents, posted_on: c.posted_on, account_last_four: c.last_four, counterparty: c.counterparty, category: null });
  }
  return out;
}

export async function callProposalsFor(env: Env, fundId: number, credits: InvestorLine[]): Promise<ProposalDraft[]> {
  const lines = await openLines(env, fundId);
  return callDrafts(fundId, lines, await lineNames(env, lines.map((l) => l.id)), credits);
}

// ─────────────────────────────────────────────────────────── Fund · Accounting (proposal)

/** The funds the caller administers. */
export async function adminFunds(env: Env, user: User, fundId: number | null = null): Promise<{ id: number; name: string | null }[]> {
  const r = await env.DB.prepare('SELECT id, name FROM vc_funds WHERE fund_admin_user_id = ? AND (? IS NULL OR id = ?) ORDER BY id')
    .bind(user.id, fundId, fundId).all<{ id: number; name: string | null }>();
  return (r.results || []).map((f) => ({ id: Number(f.id), name: f.name }));
}

/** One ledger proposal per line; the category is Mercury's, mapped on Accept. */
export function ledgerDrafts(fundId: number, lines: InvestorLine[]): ProposalDraft[] {
  return lines.filter((l) => l.amount_cents !== 0).map((l) => ({
    kind: 'ledger', mercury_id: l.id, target_kind: 'fund_ledger', target_id: fundId, fund_id: fundId,
    amount_cents: l.amount_cents, posted_on: l.posted_on, account_last_four: l.last_four, counterparty: l.counterparty, category: l.category,
  }));
}

export const UNCATEGORISED = 'Uncategorised';

export async function categoryMap(env: Env, user: User, fundId: number): Promise<{ category: string; ledger_account_id: number; cash_account_id: number }[]> {
  const r = await env.DB.prepare('SELECT category, ledger_account_id, cash_account_id FROM mercury_investor_category_map WHERE user_id = ? AND fund_id = ? ORDER BY category')
    .bind(user.id, fundId).all<{ category: string; ledger_account_id: number; cash_account_id: number }>();
  return r.results || [];
}

// ─────────────────────────────────────────────────────────── Fund · Reporting (fact and proposal)

/** Month-end cash per month: the ending balances of every picked account's statement that ends in it. */
export function monthEndCash(statements: (Statement & { last_four: string })[]): { month: string; cash_cents: number; last_fours: string[] }[] {
  const by = new Map<string, { cash: number; fours: Set<string>; unreadable: boolean }>();
  for (const s of statements) {
    if (!s.period_end) continue;
    const month = s.period_end.slice(0, 7);
    const m = by.get(month) ?? { cash: 0, fours: new Set<string>(), unreadable: false };
    if (s.ending_balance_cents == null) m.unreadable = true; else m.cash += s.ending_balance_cents;
    m.fours.add(s.last_four);
    by.set(month, m);
  }
  // A month with an unreadable balance is not written: a partial sum would be a figure nobody measured.
  return [...by.entries()].filter(([, m]) => !m.unreadable).map(([month, m]) => ({ month, cash_cents: m.cash, last_fours: [...m.fours].sort() }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function writeMonthEndCash(env: Env, user: User, integrationId: number, fundId: number,
  months: { month: string; cash_cents: number; last_fours: string[] }[]): Promise<{ written: number; deleted: number }> {
  const keys = months.map((m) => `cash:${fundId}:${m.month}`);
  const held = await ledgerOf(env, integrationId, keys);
  let written = 0, deleted = 0;
  for (const m of months) {
    const key = `cash:${fundId}:${m.month}`;
    const h = held.get(key);
    if (h && !h.linked) { deleted += 1; continue; }
    await env.DB.prepare(
      `INSERT INTO fund_month_end_cash (fund_id, user_id, integration_id, month, cash_cents, account_last_fours) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (fund_id, month) DO UPDATE SET cash_cents = excluded.cash_cents, account_last_fours = excluded.account_last_fours,
         integration_id = excluded.integration_id, updated_at = CURRENT_TIMESTAMP
       WHERE fund_month_end_cash.user_id = excluded.user_id`,
    ).bind(fundId, user.id, integrationId, m.month, m.cash_cents, JSON.stringify(m.last_fours)).run();
    const row = await env.DB.prepare('SELECT id FROM fund_month_end_cash WHERE fund_id = ? AND month = ? AND user_id = ?').bind(fundId, m.month, user.id).first<{ id: number }>();
    if (!row) continue;
    await env.DB.prepare(LEDGER_NEW).bind(integrationId, INVESTOR_MODULES.cash, 'cash', key, 'fund_month_end_cash', row.id).run();
    written += 1;
  }
  return { written, deleted };
}

export async function readMonthEndCash(env: Env, user: User, fundId: number) {
  const r = await env.DB.prepare('SELECT id, month, cash_cents, account_last_fours, updated_at FROM fund_month_end_cash WHERE fund_id = ? AND user_id = ? ORDER BY month DESC LIMIT 36')
    .bind(fundId, user.id).all<{ id: number; month: string; cash_cents: number; account_last_fours: string; updated_at: string }>();
  return (r.results || []).map((m) => {
    let fours: string[] = [];
    try { fours = JSON.parse(m.account_last_fours); } catch { fours = []; }
    return { id: Number(m.id), month: m.month, cash_cents: Number(m.cash_cents), account_last_fours: fours, updated_at: m.updated_at };
  });
}

export async function deleteMonthEndCash(env: Env, user: User, id: number): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM fund_month_end_cash WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (Number(r.meta?.changes ?? 0) !== 1) return false;
  await env.DB.prepare("UPDATE connector_fed_items SET local_id = NULL WHERE local_table = 'fund_month_end_cash' AND local_id = ?").bind(id).run();
  return true;
}

/** A statement proposal per report period whose end falls in the statement's month. */
export async function statementDrafts(env: Env, fundId: number, statements: (Statement & { last_four: string })[]): Promise<ProposalDraft[]> {
  const r = await env.DB.prepare('SELECT id, period_end FROM fund_report_periods WHERE fund_id = ? AND period_end IS NOT NULL')
    .bind(fundId).all<{ id: number; period_end: string }>();
  const periods = r.results || [];
  const out: ProposalDraft[] = [];
  for (const s of statements) {
    if (!s.period_end) continue;
    for (const p of periods) {
      if (String(p.period_end).slice(0, 7) !== s.period_end.slice(0, 7)) continue;
      out.push({ kind: 'statement', mercury_id: s.id, target_kind: 'fund_report_period', target_id: Number(p.id), fund_id: fundId,
        amount_cents: null, posted_on: s.period_end, account_last_four: s.last_four, counterparty: null, category: null });
    }
  }
  return out;
}

/** Every statement of the investor's accounts in a window, with each account's last four. */
export async function readStatements(reader: InvestorReader, window: { from: string; to: string }, accountIds: string[] | null = null): Promise<(Statement & { last_four: string })[]> {
  const accounts = (await reader.accounts()).filter((a) => !accountIds?.length || accountIds.includes(a.mercury_account_id));
  const out: (Statement & { last_four: string })[] = [];
  for (const a of accounts) {
    for (const s of await reader.statements(a.mercury_account_id, { start: window.from, end: window.to })) {
      out.push({ ...s, last_four: a.last_four });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────── Accept

export type AcceptOutcome =
  | { ok: true; result_ref: string | null }
  | { ok: false; status: 400 | 404 | 409; code: string; message: string };

const no = (status: 400 | 404 | 409, code: string, message: string): AcceptOutcome => ({ ok: false, status, code, message });

/**
 * Accept one proposal: the only place a proposal writes. Each kind re-checks
 * that its target is still the caller's own before writing anything.
 */
export async function acceptProposal(env: Env, user: User, p: ProposalRow, body: Record<string, unknown> = {},
  extras: { statementPdf?: StatementPdf | null } = {}): Promise<AcceptOutcome> {
  if (p.state !== 'proposed') return no(409, 'already_decided', 'This proposal was already accepted or dismissed.');
  if (p.kind === 'closing') {
    const own = await env.DB.prepare("SELECT 1 AS x FROM commitments WHERE id = ? AND investor_user_id = ? AND status <> 'withdrawn'")
      .bind(p.target_id, user.id).first();
    if (!own) return no(404, 'target_not_found', 'That is not one of your open commitments.');
    // The accepted proposal is the funded record, citing the transaction.
    return await markAccepted(env, user, p, `mercury:${p.mercury_id}`) ? { ok: true, result_ref: `mercury:${p.mercury_id}` } : no(409, 'already_decided', 'This proposal was already accepted or dismissed.');
  }
  if (p.kind === 'call') {
    if (!p.fund_id || !(await gpFunds(env, user, p.fund_id)).length) return no(404, 'target_not_found', 'That is not a fund you are GP of.');
    const line = await env.DB.prepare('SELECT 1 AS x FROM capital_calls cc JOIN limited_partners lp ON lp.id = cc.limited_partner_id WHERE cc.id = ? AND lp.fund_id = ?')
      .bind(p.target_id, p.fund_id).first();
    if (!line) return no(404, 'target_not_found', 'No such open capital-call line on this fund.');
    const out = await recordReceipt(env, { lineId: p.target_id, amount: Number(p.amount_cents), receivedOn: String(p.posted_on),
      reference: `mercury:${p.mercury_id}`, source: 'receipt', recordedBy: user.id });
    if (out.kind === 'not_found') return no(404, 'target_not_found', 'No such open capital-call line on this fund.');
    if (out.kind === 'already_paid') return no(409, 'already_paid', 'This line is already paid.');
    if (out.kind === 'exceeds_outstanding') return no(409, 'exceeds_outstanding', 'The credit is more than the line still owes.');
    const ref = String(out.receipt?.uid ?? '') || null;
    await markAccepted(env, user, p, ref);
    return { ok: true, result_ref: ref };
  }
  if (p.kind === 'ledger') {
    if (!p.fund_id || !(await adminFunds(env, user, p.fund_id)).length) return no(404, 'target_not_found', 'That is not a fund you administer.');
    const category = p.category || UNCATEGORISED;
    const periodId = Number(body.period_id);
    if (!Number.isSafeInteger(periodId) || periodId <= 0) return no(400, 'invalid_period', 'Pick the accounting period to post into.');
    let map = (await categoryMap(env, user, p.fund_id)).find((m) => m.category === category);
    if (!map) {
      const ledger = Number(body.ledger_account_id), cash = Number(body.cash_account_id);
      if (!Number.isSafeInteger(ledger) || ledger <= 0 || !Number.isSafeInteger(cash) || cash <= 0 || ledger === cash) {
        return no(400, 'category_unmapped', `Confirm which ledger account "${category}" posts to, and the cash account it moves.`);
      }
      const owned = await env.DB.prepare('SELECT COUNT(*) AS n FROM fund_ledger_accounts WHERE fund_id = ? AND id IN (?, ?)').bind(p.fund_id, ledger, cash).first<{ n: number }>();
      if (Number(owned?.n ?? 0) !== 2) return no(400, 'invalid_accounts', 'Both accounts must belong to this fund.');
      await env.DB.prepare(
        `INSERT INTO mercury_investor_category_map (user_id, fund_id, category, ledger_account_id, cash_account_id) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, fund_id, category) DO NOTHING`,
      ).bind(user.id, p.fund_id, category, ledger, cash).run();
      map = { category, ledger_account_id: ledger, cash_account_id: cash };
    }
    const cents = Math.abs(Number(p.amount_cents));
    const inflow = Number(p.amount_cents) > 0;
    const lines = inflow
      ? [{ account_id: map.cash_account_id, debit_cents: cents, credit_cents: 0 }, { account_id: map.ledger_account_id, debit_cents: 0, credit_cents: cents }]
      : [{ account_id: map.ledger_account_id, debit_cents: cents, credit_cents: 0 }, { account_id: map.cash_account_id, debit_cents: 0, credit_cents: cents }];
    try {
      const entry = await postLedgerEntry(env, user, p.fund_id, periodId,
        { entry_date: String(p.posted_on), description: `Mercury ••${p.account_last_four ?? '????'}: ${category}`, lines });
      await markAccepted(env, user, p, entry.uid);
      return { ok: true, result_ref: entry.uid };
    } catch (e) {
      if (e instanceof LedgerRefusal) return no(409, 'ledger_refused', e.message);
      throw e;
    }
  }
  // statement
  if (!p.fund_id || !(await gpFunds(env, user, p.fund_id)).length) return no(404, 'target_not_found', 'That is not a fund you are GP of.');
  const period = await env.DB.prepare('SELECT 1 AS x FROM fund_report_periods WHERE id = ? AND fund_id = ?').bind(p.target_id, p.fund_id).first();
  if (!period) return no(404, 'target_not_found', 'No such report period on this fund.');
  // The PDF itself, read by the route from the investor's own Mercury, is what is attached.
  const pdf = extras.statementPdf;
  if (!pdf) return no(409, 'statement_unavailable', 'Mercury gave no PDF for that statement, so nothing was attached.');
  if (!env.FILES) return no(409, 'statement_unavailable', 'Statements cannot be stored in this environment, so nothing was attached.');
  const key = statementKeyOf(user, p);
  await env.FILES.put(key, pdf.bytes, { httpMetadata: { contentType: 'application/pdf' } });
  if (!await markAccepted(env, user, p, key)) {
    await env.FILES.delete(key);
    return no(409, 'already_decided', 'This proposal was already accepted or dismissed.');
  }
  return { ok: true, result_ref: key };
}

/** Where an attached statement lives: under its owner, in the private FILES bucket, read only through the owner's route. */
export const statementKeyOf = (user: User, p: Pick<ProposalRow, 'uid'>) => `mercury-statements/${Number(user.id)}/${p.uid}.pdf`;
