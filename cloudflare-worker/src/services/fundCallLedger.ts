/**
 * The fund call ledger (D371): issuing a call, recording a receipt against one
 * LP's line, and reading both back.
 *
 * Migration 312 gives a call a header (`fund_capital_calls`) and a line's
 * money an append-only trail (`capital_call_receipts`). This file is the only
 * writer of either, so the rules below hold on every path that reaches them:
 * the GP's "New call", the queue job an LP's first call enqueues, the GP's
 * "Record receipt", and `POST /api/capital/calls/:id/pay` (D370's "Mark Paid",
 * which is now a receipt for whatever is outstanding).
 *
 * MONEY IS INTEGER CENTS. A line's share comes from `splitCall`, which floors
 * every line and gives the pennies left over to one named line, so the lines
 * sum to the call. The legacy dollar columns (`capital_calls.amount`,
 * `limited_partners.invested_amount`, `vc_funds.deployed_capital`, all REAL)
 * are still written — derived from the cents, never passed alongside them —
 * because every existing reader speaks them.
 *
 * A RECEIPT MOVES MONEY ONCE. The insert, the two credits and the status flip
 * are one D1 batch. The insert only happens while the line is unpaid and the
 * amount fits what is outstanding, both re-checked inside the batch; each
 * credit only happens if THIS request's receipt row exists. Two presses in
 * flight cannot both land a receipt for the same outstanding amount, and
 * neither can credit on the other's receipt.
 */
import type { Env } from '../types';
import { splitCall, type CallSplit } from './fundCallSplit';
import { capitalCallStatement } from '../routes/_capital_call_writes';

/** A line's owed amount in cents: exact where the line carries it, rounded from dollars where it predates 312. */
const OWED_CENTS_SQL = `COALESCE(cc.amount_cents, CAST(ROUND(cc.amount * 100) AS INTEGER))`;
const RECEIVED_CENTS_SQL =
  `COALESCE((SELECT SUM(r.amount_cents) FROM capital_call_receipts r WHERE r.capital_call_id = cc.id), 0)`;

/** The LP statuses a call bills. Unchanged from the job this replaces. */
const BILLED = `lp.status IN ('committed', 'active')`;

// ---------------------------------------------------------------- issuing

export interface IssueInput {
  fundId: number;
  amountCents: number;
  /** Minted by the issuing route; the header's and every line's idempotency key. */
  callUid: string;
  dueDate: string | null;
  purpose: string | null;
  issuedBy: number | null;
}

export interface IssueResult {
  /** The header as stored, or null when there was nobody to bill. */
  call: any | null;
  split: CallSplit;
  /** The LP ids whose line this run wrote (a retry writes none it already has). */
  written: number[];
}

/** Whole dollars print bare; anything else prints its cents. */
function dollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * Write a call's header and one line per billed LP, then log a notice to each
 * LP whose line this run wrote.
 *
 * RE-RUN SAFE. The header and every line are `INSERT OR IGNORE` on uids
 * derived from `callUid`, and they are one batch, so a run either writes the
 * whole call or none of it. A retry of a call already written finds its
 * header, finds every line present, and writes nothing. A retry that finds a
 * header with lines missing (only a hand edit can make that state) fills them
 * only if the register still splits the call exactly as the header records;
 * if it no longer does, it throws rather than bill a different set of shares
 * against a call its LPs were already told about.
 */
export async function issueFundCall(env: Env, input: IssueInput): Promise<IssueResult> {
  const { fundId, amountCents, callUid } = input;
  const lps = (await env.DB.prepare(
    `SELECT lp.id, lp.user_id, lp.commitment_amount
       FROM limited_partners lp
      WHERE lp.fund_id = ? AND ${BILLED}
      ORDER BY lp.id`,
  ).bind(fundId).all<{ id: number; user_id: number | null; commitment_amount: number }>()).results || [];
  const split = splitCall(amountCents, lps);
  if (!split.lines.length) return { call: null, split, written: [] };

  const existing = await env.DB.prepare(
    `SELECT fc.*, (SELECT COUNT(*) FROM capital_calls cc WHERE cc.fund_call_id = fc.id) AS lines_present
       FROM fund_capital_calls fc WHERE fc.uid = ?`,
  ).bind(callUid).first<any>();
  if (existing) {
    if (Number(existing.lines_present) >= Number(existing.line_count)) {
      return { call: existing, split, written: [] };
    }
    const same = Number(existing.fund_id) === fundId
      && Number(existing.amount_cents) === amountCents
      && Number(existing.line_count) === split.lines.length
      && Number(existing.residual_cents) === split.residualCents
      && (existing.residual_lp_id == null ? null : Number(existing.residual_lp_id)) === split.residualLpId;
    if (!same) {
      throw new Error(
        `call ${existing.call_number} of fund ${fundId} is missing lines and the register no longer splits it `
        + 'as issued; the missing lines need a person, not a retry',
      );
    }
  }

  const header = env.DB.prepare(
    `INSERT OR IGNORE INTO fund_capital_calls
       (uid, fund_id, call_number, amount_cents, purpose, due_date,
        residual_cents, residual_lp_id, line_count, issued_by)
     VALUES (?, ?, (SELECT COALESCE(MAX(call_number), 0) + 1 FROM fund_capital_calls WHERE fund_id = ?),
             ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    callUid, fundId, fundId, amountCents, input.purpose, input.dueDate,
    split.residualCents, split.residualLpId, split.lines.length, input.issuedBy,
  );
  const lines = split.lines.map((l) => capitalCallStatement(env, {
    limitedPartnerId: l.lpId,
    amount: l.shareCents / 100,
    amountCents: l.shareCents,
    dueDate: input.dueDate,
    uid: `cc:${callUid}:${l.lpId}`,
    fundCallUid: callUid,
  }));
  const results = await env.DB.batch<any>([header, ...lines]);
  const writtenLines = split.lines.filter((_, i) => Number((results[i + 1] as any)?.meta?.changes ?? 0) > 0);

  const call = await env.DB.prepare(`SELECT * FROM fund_capital_calls WHERE uid = ?`).bind(callUid).first<any>();

  // Notices go ONLY to the LPs whose line this run wrote, so a retry that
  // fills a gap does not tell everyone again. An LP with no platform account
  // gets a log line with no user, as before: nobody is notified in-app.
  const userOf = new Map(lps.map((lp) => [Number(lp.id), lp.user_id ?? null]));
  const notices = writtenLines.map((l) => env.DB.prepare(
    `INSERT INTO activity_logs (action, details, actor, user_id)
     VALUES ('capital_call_notice', ?, 'system', ?)`,
  ).bind(
    `Capital call ${call?.call_number ?? ''} from fund #${fundId}: $${(l.shareCents / 100).toFixed(2)} due `
      + `(pro-rata of $${dollars(amountCents)}).`,
    userOf.get(l.lpId) ?? null,
  ));
  if (notices.length) await env.DB.batch(notices);

  return { call, split, written: writtenLines.map((l) => l.lpId) };
}

// ---------------------------------------------------------------- receipts

export interface ReceiptInput {
  lineId: number;
  /** Cents, or 'outstanding' for "the whole of what is still owed" (Mark Paid). */
  amount: number | 'outstanding';
  /** YYYY-MM-DD; the route validates it. */
  receivedOn: string;
  reference: string | null;
  source: 'receipt' | 'mark_paid';
  recordedBy: number;
}

export type ReceiptOutcome =
  | { kind: 'recorded'; receipt: any; line: any; paid: boolean }
  | { kind: 'already_paid'; line: any }
  | { kind: 'exceeds_outstanding'; line: any; outstandingCents: number }
  | { kind: 'not_found' };

/** One line with its owed, received and outstanding cents, and the fund and LP it belongs to. */
export async function readLine(env: Env, lineId: number): Promise<any | null> {
  const row = await env.DB.prepare(
    `SELECT cc.*, lp.fund_id AS fund_id, lp.user_id AS lp_user_id,
            ${OWED_CENTS_SQL} AS owed_cents,
            ${RECEIVED_CENTS_SQL} AS received_cents
       FROM capital_calls cc
       JOIN limited_partners lp ON lp.id = cc.limited_partner_id
      WHERE cc.id = ?`,
  ).bind(lineId).first<any>();
  if (!row) return null;
  const owed = Number(row.owed_cents);
  const received = Number(row.received_cents);
  return { ...row, owed_cents: owed, received_cents: received, outstanding_cents: Math.max(0, owed - received) };
}

/**
 * Record money received against one LP's line. The caller has already decided
 * the actor may (the route's `requireFundGp`); this decides whether the money
 * fits, and moves it once.
 */
export async function recordReceipt(env: Env, input: ReceiptInput): Promise<ReceiptOutcome> {
  const line = await readLine(env, input.lineId);
  if (!line) return { kind: 'not_found' };
  if (line.status === 'paid' || line.outstanding_cents <= 0) return { kind: 'already_paid', line };
  const cents = input.amount === 'outstanding' ? line.outstanding_cents : input.amount;
  if (cents > line.outstanding_cents) {
    return { kind: 'exceeds_outstanding', line, outstandingCents: line.outstanding_cents };
  }

  const uid = crypto.randomUUID();
  const mine = `EXISTS (SELECT 1 FROM capital_call_receipts WHERE uid = ?)`;
  const results = await env.DB.batch<any>([
    // The receipt, only while the line is unpaid and the amount still fits —
    // both re-checked here, inside the transaction, not trusted from the read.
    env.DB.prepare(
      `INSERT INTO capital_call_receipts
         (uid, capital_call_id, limited_partner_id, fund_id, amount_cents, received_on, reference, source, recorded_by)
       SELECT ?, cc.id, cc.limited_partner_id, lp.fund_id, ?, ?, ?, ?, ?
         FROM capital_calls cc
         JOIN limited_partners lp ON lp.id = cc.limited_partner_id
        WHERE cc.id = ? AND cc.status <> 'paid'
          AND ? <= ${OWED_CENTS_SQL} - ${RECEIVED_CENTS_SQL}`,
    ).bind(uid, cents, input.receivedOn, input.reference, input.source, input.recordedBy, input.lineId, cents),
    // The credits, each only if THIS receipt landed.
    env.DB.prepare(
      `UPDATE limited_partners
          SET invested_amount = invested_amount + ?, updated_at = datetime('now')
        WHERE id = ? AND ${mine}`,
    ).bind(cents / 100, line.limited_partner_id, uid),
    env.DB.prepare(
      `UPDATE vc_funds
          SET deployed_capital = deployed_capital + ?, updated_at = datetime('now')
        WHERE id = ? AND ${mine}`,
    ).bind(cents / 100, line.fund_id, uid),
    // Paid once the receipts reach what the line owes.
    env.DB.prepare(
      `UPDATE capital_calls AS cc
          SET status = 'paid', paid_date = ?
        WHERE cc.id = ? AND cc.status <> 'paid' AND ${mine}
          AND ${RECEIVED_CENTS_SQL} >= ${OWED_CENTS_SQL}`,
    ).bind(input.receivedOn, input.lineId, uid),
  ]);

  const inserted = Number(results[0]?.meta?.changes ?? 0) === 1;
  const after = await readLine(env, input.lineId);
  if (!inserted) {
    // A concurrent receipt got there first. Nothing of this request moved.
    if (!after || after.status === 'paid' || after.outstanding_cents <= 0) return { kind: 'already_paid', line: after };
    return { kind: 'exceeds_outstanding', line: after, outstandingCents: after.outstanding_cents };
  }
  const receipt = await env.DB.prepare(`SELECT * FROM capital_call_receipts WHERE uid = ?`).bind(uid).first<any>();
  return { kind: 'recorded', receipt, line: after, paid: Number(results[3]?.meta?.changes ?? 0) === 1 };
}

// ---------------------------------------------------------------- reading

/** Days a due date is past `today`, or null when it is not a date or not past. */
export function daysOverdue(dueDate: unknown, today: string): number | null {
  const s = String(dueDate ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const due = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const now = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  if (!Number.isFinite(due) || !Number.isFinite(now)) return null;
  const days = Math.round((now - due) / 86_400_000);
  return days > 0 ? days : null;
}

/** A line's state, from its status, receipts and due date. */
export function lineState(line: { status: string; owed_cents: number; received_cents: number; receipt_count: number; due_date?: string | null }, today: string) {
  if (line.status === 'paid') {
    return { state: 'paid', days_overdue: null, receipt_recorded: Number(line.receipt_count) > 0 };
  }
  const overdue = daysOverdue(line.due_date, today);
  if (overdue !== null) return { state: 'overdue', days_overdue: overdue, receipt_recorded: null };
  if (Number(line.received_cents) > 0) return { state: 'part_received', days_overdue: null, receipt_recorded: null };
  return { state: 'pending', days_overdue: null, receipt_recorded: null };
}

export const CALLS_LIMIT = 200;
export const LINES_LIMIT = 2000;
export const ENTRIES_LIMIT = 500;

/** Every call on a fund with its lines, and the fund's call totals. */
export async function readFundCalls(env: Env, fundId: number, today: string) {
  const headers = (await env.DB.prepare(
    `SELECT fc.*, COALESCE(ru.name, rlp.name) AS residual_lp_name, ib.name AS issued_by_name
       FROM fund_capital_calls fc
       LEFT JOIN limited_partners rlp ON rlp.id = fc.residual_lp_id
       LEFT JOIN users ru ON ru.id = rlp.user_id
       LEFT JOIN users ib ON ib.id = fc.issued_by
      WHERE fc.fund_id = ?
      ORDER BY fc.call_number DESC
      LIMIT ?`,
  ).bind(fundId, CALLS_LIMIT + 1).all<any>()).results || [];
  const rawLines = (await env.DB.prepare(
    `SELECT cc.id, cc.fund_call_id, cc.limited_partner_id, cc.status, cc.due_date, cc.paid_date, cc.created_at,
            ${OWED_CENTS_SQL} AS owed_cents,
            ${RECEIVED_CENTS_SQL} AS received_cents,
            (SELECT COUNT(*) FROM capital_call_receipts r WHERE r.capital_call_id = cc.id) AS receipt_count,
            COALESCE(u.name, lp.name) AS lp_name,
            COALESCE(u.email, lp.email) AS lp_email,
            CAST(ROUND(lp.commitment_amount * 100) AS INTEGER) AS commitment_cents,
            lp.user_id AS lp_user_id,
            u.kyc_status AS kyc_status
       FROM capital_calls cc
       JOIN limited_partners lp ON lp.id = cc.limited_partner_id
       LEFT JOIN users u ON u.id = lp.user_id
      WHERE lp.fund_id = ?
      ORDER BY cc.created_at DESC, cc.id DESC
      LIMIT ?`,
  ).bind(fundId, LINES_LIMIT + 1).all<any>()).results || [];
  const committed = await env.DB.prepare(
    `SELECT COALESCE(SUM(CAST(ROUND(lp.commitment_amount * 100) AS INTEGER)), 0) AS cents, COUNT(*) AS lps
       FROM limited_partners lp WHERE lp.fund_id = ? AND ${BILLED}`,
  ).bind(fundId).first<{ cents: number; lps: number }>();

  const truncated = headers.length > CALLS_LIMIT || rawLines.length > LINES_LIMIT;
  const lines = rawLines.slice(0, LINES_LIMIT).map((l: any) => {
    const owed = Number(l.owed_cents);
    const received = Number(l.received_cents);
    return {
      id: l.id,
      fund_call_id: l.fund_call_id ?? null,
      limited_partner_id: l.limited_partner_id,
      lp_name: l.lp_name ?? null,
      lp_email: l.lp_email ?? null,
      has_account: l.lp_user_id != null,
      // No account, no KYC record: the absence is said, never read as "pending".
      kyc_status: l.lp_user_id != null ? (l.kyc_status ?? null) : null,
      commitment_cents: l.commitment_cents == null ? null : Number(l.commitment_cents),
      owed_cents: owed,
      received_cents: received,
      outstanding_cents: l.status === 'paid' ? 0 : Math.max(0, owed - received),
      receipt_count: Number(l.receipt_count),
      due_date: l.due_date ?? null,
      paid_date: l.paid_date ?? null,
      created_at: l.created_at,
      ...lineState({ status: l.status, owed_cents: owed, received_cents: received, receipt_count: l.receipt_count, due_date: l.due_date }, today),
    };
  });

  const byCall = new Map<number, any[]>();
  const unnumbered: any[] = [];
  for (const line of lines) {
    if (line.fund_call_id == null) { unnumbered.push(line); continue; }
    const list = byCall.get(Number(line.fund_call_id)) || [];
    list.push(line);
    byCall.set(Number(line.fund_call_id), list);
  }
  const sum = (list: any[], key: string) => list.reduce((s, l) => s + Number(l[key] || 0), 0);
  const calls = headers.slice(0, CALLS_LIMIT).map((h: any) => {
    const own = (byCall.get(Number(h.id)) || []).sort((a, b) => Number(b.commitment_cents ?? 0) - Number(a.commitment_cents ?? 0));
    return {
      id: h.id,
      call_number: h.call_number,
      amount_cents: Number(h.amount_cents),
      purpose: h.purpose ?? null,
      due_date: h.due_date ?? null,
      created_at: h.created_at,
      issued_by_name: h.issued_by_name ?? null,
      residual_cents: Number(h.residual_cents),
      residual_lp_id: h.residual_lp_id ?? null,
      residual_lp_name: h.residual_lp_name ?? null,
      line_count: Number(h.line_count),
      received_cents: sum(own, 'received_cents'),
      outstanding_cents: sum(own, 'outstanding_cents'),
      lines: own,
    };
  });

  const paidBeforeReceipts = lines.filter((l) => l.state === 'paid' && !l.receipt_recorded);
  return {
    summary: {
      committed_cents: Number(committed?.cents ?? 0),
      committed_lps: Number(committed?.lps ?? 0),
      called_cents: sum(lines, 'owed_cents'),
      received_cents: sum(lines, 'received_cents'),
      // Lines marked paid before receipts existed: paid, with no receipt to show.
      paid_before_receipts_cents: sum(paidBeforeReceipts, 'owed_cents'),
      outstanding_cents: sum(lines, 'outstanding_cents'),
      calls_count: calls.length,
    },
    calls,
    unnumbered,
    truncated,
  };
}

/**
 * The fund's capital ledger, newest first: every call issued and every receipt
 * recorded. Narrowed to one LP (`lpId`) it is that LP's history — their lines
 * on each call and the wires recorded against them.
 */
export async function readFundLedger(env: Env, fundId: number, lpId: number | null) {
  const receipts = (await env.DB.prepare(
    `SELECT r.id, r.uid, r.capital_call_id, r.limited_partner_id, r.amount_cents, r.received_on,
            r.reference, r.source, r.created_at,
            COALESCE(u.name, lp.name) AS lp_name, fc.call_number AS call_number,
            rb.name AS recorded_by_name
       FROM capital_call_receipts r
       JOIN limited_partners lp ON lp.id = r.limited_partner_id
       LEFT JOIN users u ON u.id = lp.user_id
       JOIN capital_calls cc ON cc.id = r.capital_call_id
       LEFT JOIN fund_capital_calls fc ON fc.id = cc.fund_call_id
       LEFT JOIN users rb ON rb.id = r.recorded_by
      WHERE r.fund_id = ? AND (? IS NULL OR r.limited_partner_id = ?)
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ?`,
  ).bind(fundId, lpId, lpId, ENTRIES_LIMIT + 1).all<any>()).results || [];

  // The call side: headers for the fund; for one LP, that LP's own lines
  // (with the header's number where there is one).
  const callRows = lpId == null
    ? (await env.DB.prepare(
      `SELECT fc.id, fc.call_number, fc.amount_cents, fc.due_date, fc.purpose, fc.created_at, fc.line_count
         FROM fund_capital_calls fc WHERE fc.fund_id = ?
        ORDER BY fc.created_at DESC, fc.id DESC LIMIT ?`,
    ).bind(fundId, ENTRIES_LIMIT + 1).all<any>()).results || []
    : [];
  const lineRows = (await env.DB.prepare(
    `SELECT cc.id, cc.status, cc.due_date, cc.created_at, ${OWED_CENTS_SQL} AS owed_cents,
            fc.call_number AS call_number, COALESCE(u.name, lp.name) AS lp_name
       FROM capital_calls cc
       JOIN limited_partners lp ON lp.id = cc.limited_partner_id
       LEFT JOIN users u ON u.id = lp.user_id
       LEFT JOIN fund_capital_calls fc ON fc.id = cc.fund_call_id
      WHERE lp.fund_id = ?
        AND (CASE WHEN ? IS NULL THEN cc.fund_call_id IS NULL ELSE cc.limited_partner_id = ? END)
      ORDER BY cc.created_at DESC, cc.id DESC
      LIMIT ?`,
  ).bind(fundId, lpId, lpId, ENTRIES_LIMIT + 1).all<any>()).results || [];

  const truncated = receipts.length > ENTRIES_LIMIT || callRows.length > ENTRIES_LIMIT || lineRows.length > ENTRIES_LIMIT;
  const entries = [
    ...callRows.slice(0, ENTRIES_LIMIT).map((c: any) => ({
      kind: 'call', id: c.id, at: c.created_at, call_number: c.call_number,
      amount_cents: Number(c.amount_cents), due_date: c.due_date ?? null, purpose: c.purpose ?? null,
      line_count: Number(c.line_count),
    })),
    ...lineRows.slice(0, ENTRIES_LIMIT).map((l: any) => ({
      // For the fund: a line issued before calls were numbered. For one LP:
      // that LP's share of each call.
      kind: 'line', id: l.id, at: l.created_at, call_number: l.call_number ?? null,
      amount_cents: Number(l.owed_cents), due_date: l.due_date ?? null, status: l.status, lp_name: l.lp_name ?? null,
    })),
    ...receipts.slice(0, ENTRIES_LIMIT).map((r: any) => ({
      kind: 'receipt', id: r.id, at: r.created_at, call_number: r.call_number ?? null,
      amount_cents: Number(r.amount_cents), received_on: r.received_on, reference: r.reference ?? null,
      source: r.source, lp_name: r.lp_name ?? null, limited_partner_id: r.limited_partner_id,
      capital_call_id: r.capital_call_id, recorded_by_name: r.recorded_by_name ?? null,
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)) || (b.kind === 'receipt' ? 1 : 0) - (a.kind === 'receipt' ? 1 : 0));

  return { entries, truncated };
}
