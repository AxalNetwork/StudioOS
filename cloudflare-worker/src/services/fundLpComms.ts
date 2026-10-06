/**
 * D553 (#1146, migration 387) — an LP's type, and the log of what was sent to
 * which LP.
 *
 * The two closed sets live here so the routes, the draft surface and the
 * tests read one list, and so the migration's CHECK and the API cannot drift
 * apart without a test noticing (`fund_lp_comms_d553.test.ts` reads both).
 *
 * THE LOG STORES NO MESSAGE BODY. `addCommunication` takes the fields it
 * writes and nothing else, so a `body` (or `message`, or `html`) a client
 * sends has no column to land in.
 */
import type { Env } from '../types';

export const LP_TYPES = ['individual', 'family_office', 'institution', 'fund_of_funds', 'corporate'] as const;
export type LpType = typeof LP_TYPES[number];

export const COMM_KINDS = ['call_reminder', 'call_notice', 'update', 'other'] as const;
export type CommKind = typeof COMM_KINDS[number];

export const SUBJECT_MAX = 200;

/** A bad input. `reason` is a sentence this file wrote, safe for a refusal body (D278). */
export class CommsInputError extends Error {
  code: string;
  reason: string;
  constructor(code: string, reason: string) { super(reason); this.code = code; this.reason = reason; }
}

/** `lp_type` from a request: one of LP_TYPES, or null to clear it. Anything else is refused. */
export function parseLpType(raw: unknown): LpType | null {
  if (raw === null || raw === '') return null;
  if (typeof raw === 'string' && (LP_TYPES as readonly string[]).includes(raw)) return raw as LpType;
  throw new CommsInputError('lp_type_invalid', `An LP's type is one of: ${LP_TYPES.join(', ')}, or empty to clear it.`);
}

/** `sent_at` from a request: an ISO date or date-time, not in the future; absent means now. */
export function parseSentAt(raw: unknown, now = new Date()): string {
  if (raw === undefined || raw === null || raw === '') return now.toISOString().slice(0, 19).replace('T', ' ');
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?(\.\d+)?Z?$/.test(s)) {
    throw new CommsInputError('sent_at_invalid', 'When it was sent must be a date (YYYY-MM-DD) or a date and time.');
  }
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
  if (!Number.isFinite(t)) throw new CommsInputError('sent_at_invalid', 'When it was sent must be a real date.');
  if (t > now.getTime() + 5 * 60_000) throw new CommsInputError('sent_at_future', 'A message cannot be logged as sent in the future.');
  return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
}

export interface CommInput {
  lp_id: number;
  kind: CommKind;
  subject: string;
  sent_at: string;
  capital_call_id: number | null;
}

/** A log entry from a request body. Only these five fields are read. */
export function parseCommInput(body: any, now = new Date()): CommInput {
  const lpId = Number(body?.lp_id);
  if (!Number.isInteger(lpId) || lpId <= 0) throw new CommsInputError('lp_required', 'Say which LP it was sent to.');
  const kind = String(body?.kind ?? '');
  if (!(COMM_KINDS as readonly string[]).includes(kind)) {
    throw new CommsInputError('kind_invalid', `The kind is one of: ${COMM_KINDS.join(', ')}.`);
  }
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
  if (!subject) throw new CommsInputError('subject_required', 'A logged message needs its subject, so the log says what was sent.');
  if (subject.length > SUBJECT_MAX) throw new CommsInputError('subject_too_long', `The subject is at most ${SUBJECT_MAX} characters.`);
  const rawCall = body?.capital_call_id;
  let callId: number | null = null;
  if (rawCall !== undefined && rawCall !== null && rawCall !== '') {
    callId = Number(rawCall);
    if (!Number.isInteger(callId) || callId <= 0) throw new CommsInputError('call_invalid', 'The call link must be a call line id.');
  }
  return { lp_id: lpId, kind: kind as CommKind, subject, sent_at: parseSentAt(body?.sent_at, now), capital_call_id: callId };
}

/**
 * Write one entry for `fundId`, logged by `actorId`.
 *
 * The LP must be on this fund, and a linked call line must be that LP's own,
 * both checked inside the INSERT's SELECT so a row can never reference an LP
 * or a call from another fund. Returns the new id, or null when either check
 * failed (the route answers 404, as it does for any record the caller cannot
 * operate).
 */
export async function addCommunication(env: Env, fundId: number, actorId: number, input: CommInput): Promise<number | null> {
  const r = await env.DB.prepare(
    `INSERT INTO fund_lp_communications (fund_id, lp_id, kind, subject, sent_at, logged_by, capital_call_id)
     SELECT ?, lp.id, ?, ?, ?, ?, ?
       FROM limited_partners lp
      WHERE lp.id = ? AND lp.fund_id = ?
        AND (? IS NULL OR EXISTS (SELECT 1 FROM capital_calls cc WHERE cc.id = ? AND cc.limited_partner_id = lp.id))`,
  ).bind(
    fundId, input.kind, input.subject, input.sent_at, actorId, input.capital_call_id,
    input.lp_id, fundId, input.capital_call_id, input.capital_call_id,
  ).run();
  const changes = Number((r as any)?.meta?.changes ?? 0);
  return changes > 0 ? Number((r as any)?.meta?.last_row_id) : null;
}

export const COMMS_PAGE = 100;

/** The fund's log, newest first; `lpId` narrows it to one LP of this fund. */
export async function listCommunications(env: Env, fundId: number, lpId: number | null) {
  const r = await env.DB.prepare(
    `SELECT c.id, c.lp_id, c.kind, c.subject, c.sent_at, c.capital_call_id, c.created_at,
            COALESCE(u.name, lp.name) AS lp_name, COALESCE(u.email, lp.email) AS lp_email,
            c.logged_by, lb.name AS logged_by_name
       FROM fund_lp_communications c
       JOIN limited_partners lp ON lp.id = c.lp_id AND lp.fund_id = c.fund_id
       LEFT JOIN users u ON u.id = lp.user_id
       LEFT JOIN users lb ON lb.id = c.logged_by
      WHERE c.fund_id = ? AND (? IS NULL OR c.lp_id = ?)
      ORDER BY c.sent_at DESC, c.id DESC
      LIMIT ?`,
  ).bind(fundId, lpId, lpId, COMMS_PAGE + 1).all<any>();
  const rows = r.results || [];
  return { items: rows.slice(0, COMMS_PAGE), truncated: rows.length > COMMS_PAGE };
}

// ---------------------------------------------------------------------------
// The `funds/calls` draft surface: a reminder to ONE LP about ONE call line.
// ---------------------------------------------------------------------------

export const CALL_REMINDER_INSTRUCTION = [
  'Draft one short, courteous reminder to the limited partner below about the capital call line described.',
  'State the amount still owed, the due date and the call it belongs to, exactly as given. Use only the facts listed.',
  'Where a fact is marked "not recorded", leave it out rather than guess it.',
  'Do not threaten, do not cite the LPA or any penalty, do not mention other LPs, and do not say the message has been sent: this is a draft for the general partner to review.',
].join(' ');

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The material for one reminder, or [] when the caller may not draft it.
 *
 * THIS LICENCE ONLY. The caller must be an investor who is the GP of record for
 * the call line's fund (`vc_funds.gp_user_id`), or an admin. `/research/drafts`
 * authorises on sign-in alone and leaves the scoping to each surface, so this
 * is the whole of what keeps one fund's LP out of another GP's draft. The
 * scope is the call line id (`capital_calls.id`); a scope that is not one, or
 * names another fund's line, gives nothing to draft.
 */
export async function callReminderMaterial(env: Env, userId: number, scope: string): Promise<string[]> {
  // A scope that was sent must BE a line id, written as one: "900.0" or " 900"
  // is not quietly read as line 900 (the lesson `founderProject` records).
  if (!/^[1-9]\d*$/.test(scope)) return [];
  const lineId = Number(scope);
  const me = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role: string | null }>();
  const role = String(me?.role || '');
  if (role !== 'admin' && role !== 'investor') return [];
  const row = await env.DB.prepare(
    `SELECT cc.id, cc.due_date, cc.status,
            COALESCE(cc.amount_cents, CAST(ROUND(cc.amount * 100) AS INTEGER)) AS owed_cents,
            COALESCE((SELECT SUM(r.amount_cents) FROM capital_call_receipts r WHERE r.capital_call_id = cc.id), 0) AS received_cents,
            COALESCE(u.name, lp.name) AS lp_name, f.name AS fund_name,
            fc.call_number, fc.purpose, fc.due_date AS call_due_date
       FROM capital_calls cc
       JOIN limited_partners lp ON lp.id = cc.limited_partner_id
       JOIN vc_funds f ON f.id = lp.fund_id
       LEFT JOIN users u ON u.id = lp.user_id
       LEFT JOIN fund_capital_calls fc ON fc.id = cc.fund_call_id
      WHERE cc.id = ? AND (? = 'admin' OR f.gp_user_id = ?)`,
  ).bind(lineId, role, userId).first<any>();
  if (!row) return [];
  const owed = Number(row.owed_cents) || 0;
  const received = Number(row.received_cents) || 0;
  const outstanding = owed - received;
  if (outstanding <= 0) return [];
  const logged = await env.DB.prepare(
    `SELECT COUNT(*) AS n, MAX(sent_at) AS last FROM fund_lp_communications
      WHERE capital_call_id = ? AND kind = 'call_reminder'`,
  ).bind(lineId).first<{ n: number; last: string | null }>();
  const due = row.due_date || row.call_due_date;
  return [
    `LP: ${row.lp_name || 'name not recorded'}`,
    `Fund: ${row.fund_name || 'name not recorded'}`,
    `Call: ${row.call_number ? `call ${row.call_number}` : 'call number not recorded'}${row.purpose ? `, for ${row.purpose}` : ''}`,
    `This LP's share: ${usd(owed)}; received so far: ${usd(received)}; still owed: ${usd(outstanding)}`,
    `Due: ${due || 'not recorded'}`,
    `Reminders already logged for this line: ${Number(logged?.n) || 0}${logged?.last ? `, the last sent ${logged.last}` : ''}`,
  ];
}
