/**
 * D710 (#1775) decisions 9 and 10 — reconciliation proposes; a person confirms.
 *
 * No job confirms anything. Only a posted credit that is not an internal
 * transfer, on a `registered = 1` account, is ever proposed, and a match is
 * found by amount and date window, never by a reference in the memo.
 *
 *  - CAPITAL-CALL LINES: a credit on the `fund` entity's account equal to one
 *    open line's outstanding cents, dated from the call's issue (the header's
 *    `created_at`, else the line's) to 90 days after its due date (90 days
 *    after issue when it has none), on Fund I. Two or more qualifying lines:
 *    nothing is proposed. A credit on the GP's or Management's account is
 *    never matched to a line (decision 10).
 *  - FEE PERIODS (#1774): a credit on the `gp` entity's account equal to one
 *    issued or paid period's net total, dated from its window's start to 90
 *    days after its end.
 *
 * WHAT IS NOT ON `main` YET, and so off. Fund I is found through #1773's
 * `fundPayeeOf`, and fee periods are #1774's. Until each lands, its
 * dependency below answers "none": no capital-call match and no fee match is
 * proposed, a manual pair of that kind answers 409, and `collectedFor` reads
 * only confirmed matches. The dependencies are parameters so the matcher's
 * rules are tested now against a fixture fund and fixture periods; the
 * defaults are the production answer today.
 *
 * Confirming a capital-call match writes one receipt through `recordReceipt`,
 * `reference: 'mercury:<transaction id>'`. The unique index on `mercury:`
 * references (migration 474) makes a second receipt for one bank line
 * impossible.
 */
import type { Env, User } from '../../types';
import { readLine, recordReceipt } from '../fundCallLedger';
import { newUid } from './store';

export const WINDOW_DAYS_AFTER = 90;
/** UNVERIFIED: the status Mercury gives a settled line. */
export const POSTED_STATUSES = ['sent'];
/** UNVERIFIED: the kind Mercury gives a move between two accounts of one organization. */
export const INTERNAL_KINDS = ['internalTransfer'];

export interface FeePeriod { id: number; fund_id: number; status: string; net_total_cents: number; window_start: string; window_end: string }

export interface MatchDeps {
  /** Fund I's `vc_funds.id`, the fund `fundPayeeOf` answers `'fund'` for. Null until #1773. */
  fundOneId: (env: Env) => Promise<number | null>;
  /** #1774's issued or paid periods on Fund I. Empty until #1774. */
  feePeriods: (env: Env) => Promise<FeePeriod[]>;
}

export const DEFAULT_MATCH_DEPS: MatchDeps = {
  fundOneId: async () => null,
  feePeriods: async () => [],
};

const deps = (d?: Partial<MatchDeps>): MatchDeps => ({ ...DEFAULT_MATCH_DEPS, ...(d || {}) });

const plusDays = (d: string, n: number) => {
  const t = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** A credit that may be matched at all, the same four conditions in both statements below: posted, a credit, not internal, on a registered account. */
const eligibleBinds = () => [JSON.stringify(POSTED_STATUSES), JSON.stringify(INTERNAL_KINDS)];

interface Credit { id: number; uid: string; mercury_transaction_id: string; amount_cents: number; posted_on: string; entity_key: string; last_four: string }

interface OpenLine { id: number; outstanding_cents: number; from: string; to: string }

/** Fund I's open lines with their outstanding cents and date window. */
async function openLines(env: Env, fundId: number): Promise<OpenLine[]> {
  const r = await env.DB.prepare(
    `SELECT cc.id, cc.due_date, cc.created_at, fcc.created_at AS issued_at,
            COALESCE(cc.amount_cents, CAST(ROUND(cc.amount * 100) AS INTEGER))
              - COALESCE((SELECT SUM(r.amount_cents) FROM capital_call_receipts r WHERE r.capital_call_id = cc.id), 0) AS outstanding_cents
       FROM capital_calls cc
       JOIN limited_partners lp ON lp.id = cc.limited_partner_id
       LEFT JOIN fund_capital_calls fcc ON fcc.id = cc.fund_call_id
      WHERE lp.fund_id = ? AND cc.status <> 'paid'`,
  ).bind(fundId).all<any>();
  return (r.results || []).filter((l) => Number(l.outstanding_cents) > 0).map((l) => {
    const issued = String(l.issued_at || l.created_at || '').slice(0, 10);
    const due = typeof l.due_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(l.due_date) ? l.due_date.slice(0, 10) : null;
    return { id: Number(l.id), outstanding_cents: Number(l.outstanding_cents), from: issued, to: plusDays(due ?? issued, WINDOW_DAYS_AFTER) };
  });
}

async function insertMatch(env: Env, credit: Pick<Credit, 'id'>, kind: 'capital_call_line' | 'fee_period', targetId: number,
  amount: number, origin: 'matcher' | 'manual', by: number | null): Promise<boolean> {
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO mercury_matches (uid, transaction_id, target_kind, target_id, state, origin, amount_cents, proposed_by)
     VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?)`,
  ).bind(newUid(), credit.id, kind, targetId, origin, amount, by).run();
  return Number(r.meta?.changes ?? 0) === 1;
}

/** The matcher: run after each sync. Proposes; writes no receipt. */
export async function proposeMatches(env: Env, d?: Partial<MatchDeps>): Promise<{ proposed: number }> {
  const m = deps(d);
  const credits = (await env.DB.prepare(
    `SELECT t.id, t.uid, t.mercury_transaction_id, t.amount_cents, t.posted_on, a.entity_key, a.last_four
       FROM mercury_transactions t JOIN mercury_accounts a ON a.id = t.account_id
      WHERE t.amount_cents > 0 AND t.posted_on IS NOT NULL
  AND t.status IN (SELECT value FROM json_each(?)) AND COALESCE(t.kind, '') NOT IN (SELECT value FROM json_each(?))
  AND a.registered = 1
        AND NOT EXISTS (SELECT 1 FROM mercury_matches x WHERE x.transaction_id = t.id AND x.state <> 'rejected')
      ORDER BY t.posted_on, t.id`,
  ).bind(...eligibleBinds()).all<Credit>()).results || [];
  let proposed = 0;
  const fundId = await m.fundOneId(env);
  const lines = fundId == null ? [] : await openLines(env, fundId);
  const periods = (await m.feePeriods(env)).filter((p) => p.status === 'issued' || p.status === 'paid');
  for (const c of credits) {
    if (c.entity_key === 'fund' && fundId != null) {
      const fits = lines.filter((l) => l.outstanding_cents === c.amount_cents && c.posted_on >= l.from && c.posted_on <= l.to);
      if (fits.length === 1 && await insertMatch(env, c, 'capital_call_line', fits[0].id, c.amount_cents, 'matcher', null)) proposed += 1;
    } else if (c.entity_key === 'gp') {
      const fits = periods.filter((p) => p.net_total_cents === c.amount_cents && c.posted_on >= p.window_start && c.posted_on <= plusDays(p.window_end, WINDOW_DAYS_AFTER));
      if (fits.length === 1 && await insertMatch(env, c, 'fee_period', fits[0].id, c.amount_cents, 'matcher', null)) proposed += 1;
    }
  }
  return { proposed };
}

export type MatchRefusal = { ok: false; status: 400 | 404 | 409; code: string; detail: string };
const refusal = (status: 400 | 404 | 409, code: string, detail: string): MatchRefusal => ({ ok: false, status, code, detail });

async function creditByUid(env: Env, uid: string): Promise<(Credit & { eligible: number }) | null> {
  return await env.DB.prepare(
    `SELECT t.id, t.uid, t.mercury_transaction_id, t.amount_cents, t.posted_on, a.entity_key, a.last_four,
            CASE WHEN t.amount_cents > 0 AND t.posted_on IS NOT NULL
  AND t.status IN (SELECT value FROM json_each(?)) AND COALESCE(t.kind, '') NOT IN (SELECT value FROM json_each(?))
  AND a.registered = 1 THEN 1 ELSE 0 END AS eligible
       FROM mercury_transactions t JOIN mercury_accounts a ON a.id = t.account_id WHERE t.uid = ?`,
  ).bind(...eligibleBinds(), uid).first<Credit & { eligible: number }>() ?? null;
}

/** An admin's own pair, under the matcher's rules for entity, account and credit. */
export async function proposeManual(env: Env, user: User, body: { transaction_uid?: unknown; target_kind?: unknown; target_id?: unknown }, d?: Partial<MatchDeps>):
  Promise<{ ok: true; uid: string } | MatchRefusal> {
  const m = deps(d);
  const kind = body.target_kind;
  const targetId = Number(body.target_id);
  if ((kind !== 'capital_call_line' && kind !== 'fee_period') || !Number.isSafeInteger(targetId) || targetId <= 0 || typeof body.transaction_uid !== 'string') {
    return refusal(400, 'invalid_match', 'Name a bank line, a target kind and a target id.');
  }
  const credit = await creditByUid(env, body.transaction_uid);
  if (!credit) return refusal(404, 'transaction_not_found', 'No such bank line.');
  if (!credit.eligible) return refusal(409, 'not_matchable', 'Only a posted credit on a registered account, not an internal transfer, can be matched.');
  const prior = await env.DB.prepare(
    'SELECT state FROM mercury_matches WHERE transaction_id = ? AND target_kind = ? AND target_id = ?',
  ).bind(credit.id, kind, targetId).first<{ state: string }>();
  if (prior?.state === 'rejected') return refusal(409, 'pair_rejected', 'This pair was rejected and is not proposed again.');
  if (kind === 'capital_call_line') {
    if (credit.entity_key !== 'fund') return refusal(409, 'wrong_entity', 'A capital-call line is matched only to a credit on the Fund’s account.');
    const fundId = await m.fundOneId(env);
    if (fundId == null) return refusal(409, 'fund_account_unavailable', 'The Fund’s account is not registered yet, so no capital-call line can be matched.');
    const line = await readLine(env, targetId);
    if (!line || Number(line.fund_id) !== fundId) return refusal(404, 'target_not_found', 'No such open capital-call line on the Fund.');
    if (line.status === 'paid' || line.outstanding_cents <= 0) return refusal(409, 'already_paid', 'This line is already paid.');
    // A partial wire may be below the outstanding cents, never above.
    if (credit.amount_cents > line.outstanding_cents) return refusal(409, 'exceeds_outstanding', 'The credit is more than the line still owes.');
  } else {
    if (credit.entity_key !== 'gp') return refusal(409, 'wrong_entity', 'A fee period is matched only to a credit on the GP’s account.');
    const period = (await m.feePeriods(env)).find((p) => p.id === targetId && (p.status === 'issued' || p.status === 'paid'));
    if (!period) return refusal(409, 'fee_periods_unavailable', 'No issued fee period with that id can be matched.');
    if (period.net_total_cents !== credit.amount_cents) return refusal(409, 'amount_differs', 'A fee period’s credit must equal its net total.');
  }
  try {
    if (!await insertMatch(env, credit, kind, targetId, credit.amount_cents, 'manual', user.id)) {
      return refusal(409, 'already_matched', 'This pair is already proposed.');
    }
  } catch {
    // A partial unique index: the line, or the fee period, already has a live match.
    return refusal(409, 'already_matched', 'This bank line or fee period already has a live match.');
  }
  const row = await env.DB.prepare('SELECT uid FROM mercury_matches WHERE transaction_id = ? AND target_kind = ? AND target_id = ?')
    .bind(credit.id, kind, targetId).first<{ uid: string }>();
  return { ok: true, uid: row!.uid };
}

interface MatchRow { id: number; uid: string; transaction_id: number; target_kind: string; target_id: number; state: string; amount_cents: number }

async function matchByUid(env: Env, uid: string): Promise<(MatchRow & { mercury_transaction_id: string; posted_on: string | null }) | null> {
  return await env.DB.prepare(
    `SELECT m.*, t.mercury_transaction_id, t.posted_on FROM mercury_matches m
       JOIN mercury_transactions t ON t.id = m.transaction_id WHERE m.uid = ?`,
  ).bind(uid).first<any>() ?? null;
}

async function linkReceipt(env: Env, user: User, matchId: number, receiptId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE mercury_matches SET state = 'confirmed', receipt_id = ?, confirmed_by = ?, confirmed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND state = 'proposed'`,
  ).bind(receiptId, user.id, matchId).run();
}

/** A person's confirm. A capital-call match writes exactly one receipt. */
export async function confirmMatch(env: Env, user: User, uid: string, d?: Partial<MatchDeps>):
  Promise<{ ok: true; receipt_id: number | null } | MatchRefusal> {
  const m = deps(d);
  const match = await matchByUid(env, uid);
  if (!match) return refusal(404, 'match_not_found', 'No such match.');
  if (match.state === 'needs_review') return refusal(409, 'needs_review', 'The bank line changed after this match; reject it with a reason.');
  if (match.state !== 'proposed') return refusal(409, `match_${match.state}`, `This match is already ${match.state}.`);
  if (match.target_kind === 'fee_period') {
    // The link only: nothing is written to #1774's tables.
    const period = (await m.feePeriods(env)).find((p) => p.id === match.target_id);
    if (!period) return refusal(409, 'fee_periods_unavailable', 'The fee period cannot be read, so this match cannot be confirmed yet.');
    await env.DB.prepare(
      `UPDATE mercury_matches SET state = 'confirmed', confirmed_by = ?, confirmed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND state = 'proposed'`,
    ).bind(user.id, match.id).run();
    return { ok: true, receipt_id: null };
  }
  const reference = `mercury:${match.mercury_transaction_id}`;
  // A receipt already holding this reference: link it when it is this line's
  // for these cents (a confirm whose match update was lost), else refuse.
  const recover = async (): Promise<{ ok: true; receipt_id: number } | MatchRefusal | null> => {
    const held = await env.DB.prepare('SELECT id, capital_call_id, amount_cents FROM capital_call_receipts WHERE reference = ?')
      .bind(reference).first<{ id: number; capital_call_id: number; amount_cents: number }>();
    if (!held) return null;
    if (Number(held.capital_call_id) !== match.target_id || Number(held.amount_cents) !== match.amount_cents) {
      return refusal(409, 'bank_line_already_receipted', 'This bank line is already recorded as a receipt on another line.');
    }
    await linkReceipt(env, user, match.id, held.id);
    return { ok: true, receipt_id: held.id };
  };
  const already = await recover();
  if (already) return already;
  let outcome;
  try {
    outcome = await recordReceipt(env, {
      lineId: match.target_id, amount: match.amount_cents, receivedOn: match.posted_on!,
      reference, source: 'receipt', recordedBy: user.id,
    });
  } catch {
    // The unique index fired between the read above and the insert.
    const after = await recover();
    return after ?? refusal(409, 'bank_line_already_receipted', 'This bank line is already recorded as a receipt.');
  }
  if (outcome.kind === 'already_paid') return refusal(409, 'already_paid', 'This line is already paid.');
  if (outcome.kind === 'exceeds_outstanding') return refusal(409, 'exceeds_outstanding', 'The credit is more than the line still owes.');
  if (outcome.kind === 'not_found') return refusal(404, 'target_not_found', 'The capital-call line no longer exists.');
  await linkReceipt(env, user, match.id, Number(outcome.receipt.id));
  return { ok: true, receipt_id: Number(outcome.receipt.id) };
}

/** Reject with a reason of at least ten characters; the pair is never proposed again. */
export async function rejectMatch(env: Env, user: User, uid: string, reason: unknown): Promise<{ ok: true } | MatchRefusal> {
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (why.length < 10 || why.length > 500) return refusal(400, 'reason_required', 'Give a reason of at least ten characters.');
  const match = await matchByUid(env, uid);
  if (!match) return refusal(404, 'match_not_found', 'No such match.');
  if (match.state !== 'proposed' && match.state !== 'needs_review') return refusal(409, `match_${match.state}`, `This match is already ${match.state}.`);
  await env.DB.prepare(
    `UPDATE mercury_matches SET state = 'rejected', rejected_by = ?, rejected_at = datetime('now'), reason = ?, updated_at = datetime('now')
      WHERE id = ? AND state IN ('proposed', 'needs_review')`,
  ).bind(user.id, why, match.id).run();
  return { ok: true };
}

/**
 * "Collected" for #1774's period read: each period with a confirmed match,
 * its posted date and the account's last four. Derived, never stored.
 */
export async function collectedFor(env: Env, feePeriodIds: number[]): Promise<Map<number, { collected_on: string | null; last_four: string }>> {
  const out = new Map<number, { collected_on: string | null; last_four: string }>();
  const ids = feePeriodIds.filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!ids.length) return out;
  const r = await env.DB.prepare(
    `SELECT m.target_id, t.posted_on, a.last_four FROM mercury_matches m
       JOIN mercury_transactions t ON t.id = m.transaction_id JOIN mercury_accounts a ON a.id = t.account_id
      WHERE m.target_kind = 'fee_period' AND m.state = 'confirmed' AND m.target_id IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(ids)).all<{ target_id: number; posted_on: string | null; last_four: string }>();
  for (const row of r.results || []) out.set(Number(row.target_id), { collected_on: row.posted_on, last_four: row.last_four });
  return out;
}
