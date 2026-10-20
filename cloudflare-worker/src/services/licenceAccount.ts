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
 * envelope, as HQ's console reads it (`enrichContractFromEnvelope`, D451).
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
 * sentence in their place.
 */
import type { Env } from '../types';
import { enrichContractFromEnvelope, type LicenceRow } from '../routes/admin_licences';
import { paymentBlock } from './fundNotices';
import { PAY_WARNING } from './payInstructions';
import { AXAL_ENTITIES, type AxalEntityKey } from './legalDocFormat';
import { SLA_HOURS } from '../rpc/hqOps';
import { stripTrailingSlashes } from '../util/url';

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
 * The licensor the fee is paid to, when it is not Holdings. The territory
 * licence fee's payee is Holdings (`PAYMENT_PURPOSES.territory_licence_fee`);
 * a licence whose terms name another licensor (D797's `licensor_entity`) is
 * refused rather than shown Holdings' account. Null when the payment may be
 * given.
 */
export function licensorRefusal(licensor: string | null | undefined): { refusal: string; refusal_code: string } | null {
  if (licensor == null || licensor === '' || licensor === 'holdings') return null;
  const name = AXAL_ENTITIES[licensor as AxalEntityKey]?.name ?? 'another entity';
  return {
    refusal_code: 'licensor_not_payee',
    refusal: `This licence's terms name ${name} as the licensor, but the territory licence fee is paid to ${AXAL_ENTITIES.holdings.name}, so no payment instructions are given. Ask HQ to correct the terms before you pay.`,
  };
}

type ContractView = {
  uid: string; template_title: string; template_version: number; status: string;
  sent_at: string | null; signed_at: string | null; unfilled_fields: string[]; body_md: string;
};

async function signing(env: Env, row: { envelope_uid: string | null; status: string }, userId: number):
  Promise<{ sign_url: string | null; sign_reason: string | null }> {
  if (row.status === 'draft') return { sign_url: null, sign_reason: 'Not sent yet' };
  if (row.status === 'signed') return { sign_url: null, sign_reason: 'Signed' };
  if (row.status === 'void') return { sign_url: null, sign_reason: 'Withdrawn by HQ' };
  if (!row.envelope_uid) return { sign_url: null, sign_reason: 'Not sent yet' };
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

/** GET /api/licence/mine/contract's body: the current contract, the superseded ones, and the caller's own signing link. */
export async function licenseeContracts(env: Env, licence: LicenceRow, userId: number) {
  const q = await env.DB.prepare(
    `SELECT uid, template_title, template_version, status, envelope_uid, superseded_at,
            sent_at, signed_at, unfilled_fields, body_md
       FROM licence_contracts WHERE licence_uid = ?
      ORDER BY created_at DESC, id DESC`,
  ).bind(licence.uid).all<any>();
  const rows = await Promise.all((q.results || []).map((row) => enrichContractFromEnvelope(env, row)));
  const view = (row: any): ContractView => {
    let unfilled: string[] = [];
    try { const v = JSON.parse(String(row.unfilled_fields || '[]')); if (Array.isArray(v)) unfilled = v.map(String); } catch { /* left empty */ }
    return {
      uid: row.uid, template_title: row.template_title, template_version: Number(row.template_version),
      status: String(row.status), sent_at: row.sent_at ?? null, signed_at: row.signed_at ?? null,
      unfilled_fields: unfilled, body_md: String(row.body_md ?? ''),
    };
  };
  const current = rows.find((row: any) => !row.superseded_at) as any;
  const earlier = rows.filter((row: any) => row.superseded_at).map((row: any) => ({ ...view(row), superseded_at: row.superseded_at }));
  if (!current) {
    return { available: true as const, contract: null, earlier, sign_url: null, sign_reason: 'HQ has not drawn a contract for this licence yet' };
  }
  return { available: true as const, contract: view(current), earlier, ...await signing(env, current, userId) };
}

type Stream = { stream: string; gross_cents: number | null; currency: string | null; available: boolean; is_estimate: boolean; reason: string | null };

function streamsOf(json: unknown): Stream[] {
  let raw: unknown;
  try { raw = JSON.parse(String(json ?? '[]')); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.map((s: any) => ({
    stream: String(s?.stream ?? ''),
    gross_cents: Number.isSafeInteger(s?.gross_cents) ? s.gross_cents : null,
    currency: s?.currency ? String(s.currency) : null,
    available: s?.available !== false,
    is_estimate: s?.is_estimate === true || s?.is_estimate === 1,
    reason: s?.reason ? String(s.reason) : null,
  }));
}

/**
 * GET /api/licence/mine/statements's body: the licensee's statements, the usage
 * reports by period, and the payment block for the territory licence fee.
 * `licensor` is the licensor the licence's terms name (D797), when known.
 */
export async function licenseeStatements(env: Env, licence: LicenceRow, licensor?: string | null) {
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
  const byPeriod = new Map<string, any[]>();
  for (const row of u.results || []) {
    const list = byPeriod.get(row.period) ?? [];
    list.push({
      stream: row.stream, gross_cents: row.gross_cents == null ? null : Number(row.gross_cents), currency: row.currency,
      is_estimate: row.is_estimate === 1, estimate_basis: row.estimate_basis ?? null, reported_at: row.reported_at,
    });
    byPeriod.set(row.period, list);
  }
  const usage_reports = [...byPeriod.entries()].map(([period, streams]) => ({ period, streams }));

  const refused = licensorRefusal(licensor);
  let payment: Record<string, unknown>;
  if (refused) payment = refused;
  else {
    const block = await paymentBlock(env, 'holdings', 'territory_licence_fee', null, false);
    payment = block.refusal ? block.payment : { ...block.payment, warning: PAY_WARNING };
  }
  return { available: true as const, statements, usage_reports, payment };
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
