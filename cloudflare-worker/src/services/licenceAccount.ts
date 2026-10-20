/**
 * D798 (#2231) — what a licence's own Administrator reads of their contract and
 * their statements, the payment instructions for what they owe, and the
 * dispute they may raise. Every read is scoped by the caller's own licence
 * (`licence_admins`, a principal or a delegate): the routes in
 * `routes/licence.ts` resolve that licence first and pass it in, and nothing
 * here takes a licence from the request.
 *
 * THE CONTRACT IS THE STORED BODY, never re-rendered: `licence_contracts.body_md`
 * is the instrument as instantiated (migration 259), and re-rendering it from
 * today's licence would show a contract nobody signed. Its status follows the
 * envelope, as HQ's console reads it (`enrichContractFromEnvelope`, D451). The
 * PDF prints that same stored body. A contract HQ has drafted and not sent is
 * HQ's work in progress and is never shown, as a draft statement is not.
 *
 * IN FORCE AND PENDING. `in_force` is the latest signed contract and `pending`
 * the latest sent, unsigned one. HQ's draft supersedes every earlier row the
 * moment it is drawn (`admin_licences.ts`), so a signed contract stays in force
 * until a later one is SIGNED, superseded or not: otherwise the canvas's
 * "Sent v6.1 · waiting / In force: v6.0" could never be drawn.
 *
 * `sign_url` IS THE CALLER'S OWN SIGNING LINK ONLY: the recipient row of the
 * contract's envelope whose `user_id` is the caller, still pending and not
 * expired, as the Trust Center's "Sign" reads it (`routes/trust.ts`). Any other
 * caller gets `null` and the reason.
 *
 * STATEMENTS ARE HQ'S RECORD. A `draft` is not shown; `issued`, `paid` and
 * `void` are. The fields HQ alone writes about itself (`drawn_by_user_id`,
 * `paid_by_user_id`) and its free-text notes are never sent. A dispute is a
 * request to HQ, an escalation, and never writes `disputed_cents`, which stays
 * HQ's to record (migration 260, D.8).
 *
 * THE PAYMENT INSTRUCTIONS are the licensor's account for the territory licence
 * fee, masked as a fund notice prints them (`paymentBlock`: the last four
 * digits, never the full number), with the warning, or the resolver's refusal
 * sentence in their place. The payee is the licence's IP licensor (D797's
 * `licensor_ip_entity`), Holdings until D797 records one.
 */
import type { Env } from '../types';
import { enrichContractFromEnvelope, type LicenceRow } from '../routes/admin_licences';
import { paymentBlock, sha256Hex } from './fundNotices';
import { PAYMENT_PURPOSES, PAY_WARNING } from './payInstructions';
import { AXAL_ENTITIES, type AxalEntityKey } from './legalDocFormat';
import { SLA_HOURS } from '../rpc/hqOps';
import { stripTrailingSlashes } from '../util/url';
import { paperModel } from './legalPaper';
import { renderLegalPdf } from './legalPaperRender';

/** The statuses a licensee sees. A `draft` is HQ's work in progress. */
export const LICENSEE_STATEMENT_STATUSES = ['issued', 'paid', 'void'] as const;

/** On a branch the contract and the statements live on HQ, and no RPC reads them yet. */
export const BRANCH_UNAVAILABLE = { available: false as const, reason: 'Read on HQ; this branch has no copy yet' };

/** `AXAL-LIC-<licence_ref>-<period>`: the reference a licensee quotes on a statement's payment. Computed, never stored. */
export function licenceFeeReference(licenceRef: string, period: string): string {
  const ref = String(licenceRef ?? '').trim();
  const p = String(period ?? '').trim();
  if (!ref || !p) throw new TypeError('A licence-fee reference needs the licence reference and the period.');
  return `AXAL-LIC-${ref}-${p}`;
}

/**
 * Why no payment instructions are given for this licensor, or null when they
 * may be. The territory licence fee's purpose has one payee
 * (`PAYMENT_PURPOSES.territory_licence_fee`, Holdings); a licence whose terms
 * name another IP licensor (D797's `licensor_ip_entity`) is refused rather
 * than shown an account that is not its licensor's.
 */
export function licensorRefusal(licensor: string | null | undefined): { refusal: string; refusal_code: string } | null {
  const payee = PAYMENT_PURPOSES.territory_licence_fee.payee;
  if (licensor == null || licensor === '' || licensor === payee) return null;
  const name = AXAL_ENTITIES[licensor as AxalEntityKey]?.name ?? 'another entity';
  return {
    refusal_code: 'licensor_not_payee',
    refusal: `This licence's terms name ${name} as the licensor, but the territory licence fee is paid to ${AXAL_ENTITIES[payee].name}, so no payment instructions are given. Ask HQ to correct the terms before you pay.`,
  };
}

type ContractView = {
  uid: string; template_title: string; template_version: number; status: string;
  sent_at: string | null; signed_at: string | null; unfilled_fields: string[]; body_md: string;
};

/** The caller's own signing link for a contract that is sent, or why there is none. */
async function signing(env: Env, row: { envelope_uid: string | null }, userId: number):
  Promise<{ sign_url: string | null; sign_reason: string | null }> {
  // A contract marked sent before envelopes carried it (D451) has no link to give.
  if (!row.envelope_uid) return { sign_url: null, sign_reason: 'HQ has sent no signing link for it. Ask HQ.' };
  const recipients = await env.DB.prepare(
    `SELECT r.user_id, r.recipient_name, r.signing_token, r.token_expires_at, r.status
       FROM esign_recipients r JOIN esign_envelopes e ON e.id = r.envelope_id
      WHERE e.envelope_uuid = ? ORDER BY r.id`,
  ).bind(row.envelope_uid).all<{ user_id: number | null; recipient_name: string | null; signing_token: string; token_expires_at: string; status: string }>();
  const all = recipients.results || [];
  const mine = all.find((r) => Number(r.user_id) === userId);
  if (!mine) {
    const to = all.map((r) => r.recipient_name).find((n) => n && n.trim());
    return { sign_url: null, sign_reason: to ? `HQ sent it to ${to}` : 'HQ sent it to another administrator' };
  }
  if (mine.status === 'signed') return { sign_url: null, sign_reason: 'Signed' };
  const exp = Date.parse(mine.token_expires_at);
  if (Number.isFinite(exp) && exp < Date.now()) return { sign_url: null, sign_reason: 'The signing link has expired. Ask HQ to send it again.' };
  const appUrl = stripTrailingSlashes(env.APP_URL || 'https://axal.vc');
  return { sign_url: `${appUrl}/esign/${mine.signing_token}`, sign_reason: null };
}

/**
 * The licence's contracts as the licensee may see them: every row HQ has sent,
 * newest first, with its status following the envelope. A row still `draft`
 * (never sent) is left out; `draftWaiting` says one exists, for the reason.
 */
async function visibleContracts(env: Env, licence: LicenceRow) {
  const q = await env.DB.prepare(
    `SELECT uid, template_slug, template_title, template_version, status, envelope_uid, superseded_at,
            sent_at, signed_at, unfilled_fields, body_md, created_at
       FROM licence_contracts WHERE licence_uid = ?
      ORDER BY created_at DESC, id DESC`,
  ).bind(licence.uid).all<any>();
  const rows = await Promise.all((q.results || []).map((row) => enrichContractFromEnvelope(env, row))) as any[];
  const draftWaiting = rows.some((row) => !row.superseded_at && row.status === 'draft');
  return { rows: rows.filter((row) => row.status !== 'draft'), draftWaiting };
}

function contractView(row: any): ContractView {
  let unfilled: string[] = [];
  try { const v = JSON.parse(String(row.unfilled_fields || '[]')); if (Array.isArray(v)) unfilled = v.map(String); } catch { /* left empty */ }
  return {
    uid: row.uid, template_title: row.template_title, template_version: Number(row.template_version),
    status: String(row.status), sent_at: row.sent_at ?? null, signed_at: row.signed_at ?? null,
    unfilled_fields: unfilled, body_md: String(row.body_md ?? ''),
  };
}

/**
 * GET /api/licence/mine/contract's body: the contract in force, the one sent
 * and waiting, the earlier ones, and the caller's own signing link for the one
 * waiting.
 */
export async function licenseeContracts(env: Env, licence: LicenceRow, userId: number) {
  const { rows, draftWaiting } = await visibleContracts(env, licence);
  const inForce = rows.find((row) => row.status === 'signed') ?? null;
  const pending = rows.find((row) => !row.superseded_at && row.status === 'sent') ?? null;
  const earlier = rows
    .filter((row) => row !== inForce && row !== pending)
    .map((row) => ({ ...contractView(row), superseded_at: row.superseded_at ?? null }));
  const base = {
    available: true as const,
    in_force: inForce ? contractView(inForce) : null,
    pending: pending ? contractView(pending) : null,
    earlier,
  };
  if (pending) return { ...base, ...await signing(env, pending, userId) };
  const sign_reason = draftWaiting ? 'Not sent yet'
    : inForce ? 'Signed'
      : rows.length ? 'Nothing is waiting for your signature'
        : 'HQ has not drawn a contract for this licence yet';
  return { ...base, sign_url: null, sign_reason };
}

/**
 * One of the licence's contracts the licensee may see, as a PDF printed from
 * its stored body, or null for a uid that is not one of them (another
 * licence's, a draft, or none). Never re-rendered from the template.
 */
export async function licenseeContractPdf(env: Env, licence: LicenceRow, uid: string):
  Promise<{ ok: true; bytes: Uint8Array; renderer: string; filename: string } | { ok: false; status: 404 | 503 }> {
  const { rows } = await visibleContracts(env, licence);
  const row = rows.find((r) => r.uid === uid);
  if (!row) return { ok: false, status: 404 };
  const current = rows.find((r) => !r.superseded_at);
  const body = String(row.body_md ?? '');
  const model = paperModel({
    title: row.template_title, body, slug: row.template_slug, version: Number(row.template_version),
    bodySha256: await sha256Hex(body),
    envelopeUuid: row.envelope_uid ?? null,
    state: row.superseded_at && current
      ? { kind: 'superseded', by: Number(current.template_version) }
      : { kind: 'issued' },
    preserveBody: true,
  });
  const rendered = await renderLegalPdf(env, model, { pageSize: 'a4', cover: 'light' });
  if (!rendered.ok) return { ok: false, status: 503 };
  const filename = `${licence.licence_ref}-contract-v${Number(row.template_version)}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');
  return { ok: true, bytes: rendered.bytes, renderer: rendered.renderer, filename };
}

/** A statement's streams, as HQ stored them: `streams_json` passes through, so a stream added later (D802) arrives as drawn. */
function streamsOf(json: unknown): unknown[] {
  try {
    const raw = JSON.parse(String(json ?? '[]'));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

/** The day after a period ends, at UTC midnight: `2026-Q3` → 1 October, `2026-09` → 1 October. Null for a period it cannot read. */
export function periodEnds(period: string): Date | null {
  let m = /^(\d{4})-Q([1-4])$/.exec(period);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) * 3, 1));
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
  return null;
}

export const USAGE_REASON = {
  no_report_day: 'The day a usage report is due is not recorded in this licence\'s terms yet, so a missing report is not called late.',
  hq_send: 'Usage reports are sent by your branch, which reports to HQ on its own every morning. There is nothing to send from HQ.',
} as const;

/**
 * Each period's usage report as the licensee reads it: `sent` with the date
 * HQ last received it; else `late` once `reportDay` of the month after the
 * period has passed; else `due`. With no report day recorded, an unsent
 * period is `not_sent` and `late` is null, never guessed.
 */
export function usageReportStatus(period: string, sentAt: string | null, reportDay: number | null, now: Date) {
  if (sentAt) return { period, status: 'sent' as const, sent_at: sentAt, due_on: null as string | null, late: false as boolean | null };
  const end = periodEnds(period);
  if (reportDay == null || !end) return { period, status: 'not_sent' as const, sent_at: null, due_on: null, late: null };
  const due = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), reportDay));
  const late = now.getTime() >= due.getTime() + 24 * 3600_000;
  return { period, status: late ? 'late' as const : 'due' as const, sent_at: null, due_on: due.toISOString().slice(0, 10), late };
}

export type LicenseeTermsInput = {
  /** D797's `licensor_ip_entity`, when recorded. */
  licensorIpEntity?: string | null;
  /** D797's `usage_report_day`, when recorded. */
  usageReportDay?: number | null;
};

/**
 * GET /api/licence/mine/statements's body: the licensee's statements, the usage
 * reports by period with whether each was sent, and the payment block for the
 * territory licence fee. `terms` is what D797's schedule records, when known.
 */
export async function licenseeStatements(env: Env, licence: LicenceRow, terms: LicenseeTermsInput = {}, now = new Date()) {
  const s = await env.DB.prepare(
    `SELECT uid, period, gross_cents, revenue_share_bps, owed_cents, paid_cents, paid_at, disputed_cents,
            status, currency, streams_json, estimated_streams, unreported_streams, reports_as_of
       FROM subsidiary_statements
      WHERE licence_uid = ? AND status IN ('issued', 'paid', 'void')
      ORDER BY period DESC, id DESC`,
  ).bind(licence.uid).all<any>();
  const statements = (s.results || []).map((row) => ({
    uid: row.uid, period: row.period, status: row.status, currency: row.currency,
    gross_cents: Number(row.gross_cents), revenue_share_bps: Number(row.revenue_share_bps),
    owed_cents: Number(row.owed_cents), paid_cents: Number(row.paid_cents), paid_at: row.paid_at ?? null,
    disputed_cents: Number(row.disputed_cents),
    streams: streamsOf(row.streams_json),
    estimated_streams: Number(row.estimated_streams), unreported_streams: Number(row.unreported_streams),
    reports_as_of: row.reports_as_of ?? null,
    payment_reference: licenceFeeReference(licence.licence_ref, row.period),
  }));

  const u = await env.DB.prepare(
    `SELECT period, stream, gross_cents, currency, is_estimate, estimate_basis, reported_at
       FROM subsidiary_usage_reports WHERE licence_uid = ?
      ORDER BY period DESC, stream`,
  ).bind(licence.uid).all<any>();
  const byPeriod = new Map<string, { streams: any[]; sent_at: string | null }>();
  for (const row of u.results || []) {
    const entry = byPeriod.get(row.period) ?? { streams: [], sent_at: null };
    entry.streams.push({
      stream: row.stream, gross_cents: row.gross_cents == null ? null : Number(row.gross_cents), currency: row.currency,
      is_estimate: row.is_estimate === 1, estimate_basis: row.estimate_basis ?? null, reported_at: row.reported_at,
    });
    if (row.reported_at && (!entry.sent_at || row.reported_at > entry.sent_at)) entry.sent_at = row.reported_at;
    byPeriod.set(row.period, entry);
  }
  const usage_reports = [...byPeriod.entries()].map(([period, e]) => ({ period, streams: e.streams }));

  // Every period a statement covers or a report was sent for, newest first.
  const periods = [...new Set([...statements.map((st) => String(st.period)), ...byPeriod.keys()])].sort().reverse();
  const reportDay = terms.usageReportDay ?? null;
  const usage = {
    report_day: reportDay,
    report_day_reason: reportDay == null ? USAGE_REASON.no_report_day : null,
    periods: periods.map((p) => usageReportStatus(p, byPeriod.get(p)?.sent_at ?? null, reportDay, now)),
    send_now: false as const,
    send_now_reason: USAGE_REASON.hq_send,
  };

  const refused = licensorRefusal(terms.licensorIpEntity);
  let payment: Record<string, unknown>;
  if (refused) payment = refused;
  else {
    const payee = PAYMENT_PURPOSES.territory_licence_fee.payee;
    const block = await paymentBlock(env, payee, 'territory_licence_fee', null, false);
    payment = block.refusal ? block.payment
      : { method: 'Bank transfer', payee_entity: payee, payee_name: AXAL_ENTITIES[payee].name, ...block.payment, warning: PAY_WARNING };
  }
  return { available: true as const, statements, usage_reports, usage, payment };
}

/** `{cents, reason}` for a dispute, or the field it refuses with its sentence. */
export function parseDispute(body: unknown, owedCents: number):
  { ok: true; cents: number; reason: string } | { ok: false; field: string; message: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const cents = b.cents;
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents <= 0) {
    return { ok: false, field: 'cents', message: 'Give the amount you dispute as a positive whole number of cents.' };
  }
  if (cents > owedCents) return { ok: false, field: 'cents', message: 'You cannot dispute more than the statement says is owed.' };
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length < 10) return { ok: false, field: 'reason', message: 'Say why, in at least 10 characters, so HQ can check it.' };
  if (reason.length > 2000) return { ok: false, field: 'reason', message: 'Keep the reason to 2,000 characters.' };
  return { ok: true, cents, reason };
}

/**
 * Record a dispute as a request to HQ: an escalation of kind `other` on HQ's
 * own lane (`branch_code = 'hq'`, D795 D-d), naming the licence by its uid and
 * the statement in the detail, and notify every Super Admin. It writes no
 * statement field.
 */
export async function raiseStatementDispute(
  env: Env, licence: LicenceRow, user: { id: number; name?: string | null; email?: string | null },
  statement: { uid: string; period: string; owed_cents: number; currency: string }, cents: number, reason: string,
) {
  const uid = `esc_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const dueAt = new Date(Date.now() + SLA_HOURS.other * 3600_000).toISOString();
  const subject = `Statement dispute ${statement.period}`;
  const detail = `${licence.licence_ref}: statement ${statement.uid} (${statement.period}). Disputes ${cents} of ${statement.owed_cents} cents owed (${statement.currency}). Reason: ${reason}`;
  const raisedBy = String(user.name || user.email || '').slice(0, 200) || null;
  await env.DB.prepare(
    `INSERT INTO hq_escalations
       (uid, branch_code, kind, subject, subject_ref, detail, raised_by_name, raised_by_branch_user_id, status, due_at)
     VALUES (?, 'hq', 'other', ?, ?, ?, ?, ?, 'open', ?)`,
  ).bind(uid, subject, licence.uid, detail.slice(0, 4000), raisedBy, user.id, dueAt).run();
  try {
    const { notify } = await import('./notify');
    const hq = await env.DB.prepare('SELECT user_id FROM super_admins').all<{ user_id: number }>();
    for (const h of hq.results || []) {
      await notify(env, {
        userId: Number(h.user_id), type: 'statement_dispute', category: 'compliance',
        title: `${licence.brand_name || licence.licence_ref} disputes its ${statement.period} statement`,
        body: `${raisedBy ?? 'The licence administrator'} disputes ${cents} cents of the ${statement.period} statement. It is waiting on HQ.`,
        link: '/admin/licences', payload: { escalation_uid: uid, licence_uid: licence.uid, statement_uid: statement.uid },
      });
    }
  } catch (e) { console.warn('[licence] statement dispute notice failed', (e as Error).message); }
  return { uid, due_at: dueAt, status: 'open' as const };
}

export const NEEDS_REASON = {
  seats_hq: 'Seats used is not counted on HQ yet, so no seat type is flagged here.',
  notices_unreadable: 'HQ\'s notices could not be read on this database (migration 264).',
} as const;

/** A seat type at 90% or more of its seats licensed, from what a branch counts. */
export function seatsNearCap(licensed: Record<string, number>, used: Record<string, number> | null) {
  if (!used) return [];
  return Object.entries(licensed)
    .filter(([type, n]) => n > 0 && (used[type] ?? 0) * 10 >= n * 9)
    .map(([type, n]) => ({ seat_type: type, used: used[type] ?? 0, licensed: n }));
}

type NeedItem = { kind: string; title: string; link: string; ref: string | null; due: string | null };

/** HQ's notices waiting on the caller's answer, oldest deadline first; null when the store cannot be read. */
export async function noticesWaiting(env: Env, userId: number): Promise<NeedItem[] | null> {
  try {
    const q = await env.DB.prepare(
      `SELECT uid, subject, respond_by FROM admin_notices
        WHERE user_id = ? AND status IN ('issued', 'overdue')
        ORDER BY respond_by, id`,
    ).bind(userId).all<{ uid: string; subject: string; respond_by: string | null }>();
    return (q.results || []).map((n) => ({
      kind: 'notice', title: `HQ notice: ${n.subject}`, link: '/admin/my-licence/requests', ref: n.uid, due: n.respond_by ?? null,
    }));
  } catch { return null; }
}

/**
 * GET /api/licence/mine/needs on HQ: what waits on the caller, in the
 * Summary's order. A contract waiting for the caller's own signature; HQ's
 * notices waiting for an answer; issued statements not yet paid. Seats are
 * counted on a branch only, so HQ names the reason instead.
 */
export async function licenseeNeeds(env: Env, licence: LicenceRow, userId: number) {
  const items: NeedItem[] = [];
  const reasons: Record<string, string> = { seats: NEEDS_REASON.seats_hq };
  const { rows } = await visibleContracts(env, licence);
  const pending = rows.find((row) => !row.superseded_at && row.status === 'sent');
  if (pending && (await signing(env, pending, userId)).sign_url) {
    items.push({
      kind: 'contract', title: `Contract v${pending.template_version} is waiting for your signature`,
      link: '/admin/my-licence/contract', ref: pending.uid, due: null,
    });
  }
  const notices = await noticesWaiting(env, userId);
  if (notices) items.push(...notices); else reasons.notices = NEEDS_REASON.notices_unreadable;
  const unpaid = await env.DB.prepare(
    `SELECT uid, period FROM subsidiary_statements
      WHERE licence_uid = ? AND status = 'issued' AND paid_cents < owed_cents
      ORDER BY period, id`,
  ).bind(licence.uid).all<{ uid: string; period: string }>();
  for (const st of unpaid.results || []) {
    items.push({ kind: 'statement', title: `Statement ${st.period} issued and unpaid`, link: '/admin/my-licence/statements', ref: st.uid, due: null });
  }
  return { available: true as const, count: items.length, items, reasons };
}
