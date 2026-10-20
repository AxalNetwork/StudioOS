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
 *
 * D808 (#2250) ADDS what the Licences canvas reads beside them:
 *   - `in_force` and `pending` on the contract read. Drawing a new contract
 *     supersedes every earlier row, the signed one included (`admin_licences.ts`,
 *     the contract create), so "not superseded" cannot be what ends a signed
 *     contract's force: only a later signature does. `in_force` is the latest
 *     signed contract; `pending` is the current row while it is out for
 *     signature.
 *   - The contract's PDF: the stored body on the legal paper, never the
 *     template re-rendered.
 *   - `licenseeNeeds`, the one cheap read behind "Needs you" and the Licences
 *     row's count pill.
 *   - Each completed month's usage report, Sent or Late against the terms'
 *     `usage_report_day` (D797), and whether this deployment can send one now.
 *   - The payee check reads D797's `licensor_ip_entity`: the territory licence
 *     fee is paid to the platform IP licensor.
 */
import type { Env } from '../types';
import { enrichContractFromEnvelope, type LicenceRow } from '../routes/admin_licences';
import { paymentBlock } from './fundNotices';
import { PAY_WARNING } from './payInstructions';
import { AXAL_ENTITIES, type AxalEntityKey } from './legalDocFormat';
import { SLA_HOURS } from '../rpc/hqOps';
import { stripTrailingSlashes } from '../util/url';
import { paperModel, type PaperInput, type PaperState } from './legalPaper';
import { renderLegalPdf } from './legalPaperRender';
import { SEAT_ROLES } from '../rpc/branchOps';

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
 * The platform IP licensor the fee is paid to, when it is not Holdings. The
 * territory licence fee's payee is Holdings (`PAYMENT_PURPOSES.territory_licence_fee`),
 * and the fee is the price of the platform IP licence, so its payee is the
 * licensor the terms name for the IP (D797's `licensor_ip_entity`), never the
 * brand licensor. A licence whose terms name another IP licensor is refused
 * rather than shown Holdings' account. Null when the payment may be given.
 */
export function licensorRefusal(licensorIp: string | null | undefined): { refusal: string; refusal_code: string } | null {
  if (licensorIp == null || licensorIp === '' || licensorIp === 'holdings') return null;
  const name = AXAL_ENTITIES[licensorIp as AxalEntityKey]?.name ?? 'another entity';
  return {
    refusal_code: 'licensor_not_payee',
    refusal: `This licence's terms name ${name} as the platform IP licensor, but the territory licence fee is paid to ${AXAL_ENTITIES.holdings.name}, so no payment instructions are given. Ask HQ to correct the terms before you pay.`,
  };
}

/**
 * The two terms this module reads, off the stored row as it stands: the IP
 * licensor and the usage report day. Read from the raw row rather than D797's
 * field list, so the read holds while that list changes. `readable: false`
 * when the table cannot be read (a database without migration 512), which is
 * never "not recorded".
 */
export async function accountTerms(env: Env, licenceUid: string):
  Promise<{ readable: true; licensor_ip_entity: string | null; usage_report_day: number | null } | { readable: false }> {
  try {
    const row = await env.DB.prepare('SELECT * FROM licence_terms WHERE licence_uid = ?')
      .bind(licenceUid).first<Record<string, unknown>>();
    return { readable: true, ...accountTermsOf(row) };
  } catch (e) {
    console.warn('[licence] licence_terms unreadable for the account', (e as Error).message);
    return { readable: false };
  }
}

/** The same two terms off a terms object (the branch copy's `terms_json`, or a stored row). */
export function accountTermsOf(row: Record<string, unknown> | null | undefined) {
  const ip = row?.licensor_ip_entity;
  const day = Number(row?.usage_report_day);
  return {
    licensor_ip_entity: typeof ip === 'string' && ip ? ip : null,
    usage_report_day: Number.isInteger(day) && day >= 1 && day <= 28 ? day : null,
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
  // D808 — the latest signed row, superseded or not: a newer draft or a newer
  // sent version does not end its force, only a later signature does.
  const signedRow = rows.find((row: any) => row.status === 'signed') as any;
  const in_force = signedRow ? view(signedRow) : null;
  if (!current) {
    return {
      available: true as const, contract: null, in_force, pending: null, earlier,
      sign_url: null, sign_reason: 'HQ has not drawn a contract for this licence yet',
    };
  }
  const sign = await signing(env, current, userId);
  // The current row while it is out for signature; `waiting_on_you` when the
  // signing link is the caller's own.
  const pending = current.status === 'sent' ? { ...view(current), waiting_on_you: sign.sign_url !== null } : null;
  return { available: true as const, contract: view(current), in_force, pending, earlier, ...sign };
}

/** The paper state a stored contract prints under: issued once sent, a draft before. */
export function contractPaperState(row: { status: string }): PaperState {
  return row.status === 'sent' || row.status === 'signed' ? { kind: 'issued' } : { kind: 'draft' };
}

/** The paper a stored contract prints on: its own `body_md`, as stored, never the template's. */
export async function contractPaperInput(row: {
  template_title: string; template_slug: string; template_version: number; body_md: string | null; status: string;
}): Promise<PaperInput> {
  const body = String(row.body_md ?? '');
  return {
    title: String(row.template_title), body, slug: String(row.template_slug),
    version: Number(row.template_version), bodySha256: await sha256Hex(body),
    merge: 'raw', preserveBody: true, documentKind: 'agreement', axalEntityKey: 'holdings',
    state: contractPaperState(row),
  };
}

/**
 * D808 — one of the caller's own contracts as a PDF: the stored body on the
 * legal paper (`renderLegalPdf`, the renderer the generated documents use),
 * never the template re-rendered. The row is looked up WITHIN the caller's
 * licence, so another licence's uid is `not_found` as an unknown one is.
 */
export async function licenseeContractPdf(env: Env, licence: LicenceRow, uid: string):
  Promise<{ ok: true; bytes: Uint8Array; filename: string; renderer: string } | { ok: false; code: 'not_found' | 'unrenderable' }> {
  const row = await env.DB.prepare(
    `SELECT uid, template_slug, template_version, template_title, body_md, status, envelope_uid
       FROM licence_contracts WHERE uid = ? AND licence_uid = ?`,
  ).bind(uid, licence.uid).first<any>();
  if (!row) return { ok: false, code: 'not_found' };
  const enriched = await enrichContractFromEnvelope(env, row) as any;
  const model = paperModel(await contractPaperInput({ ...row, status: enriched.status }));
  const rendered = await renderLegalPdf(env, model, { pageSize: 'letter', cover: 'light' });
  if (!rendered.ok) return { ok: false, code: 'unrenderable' };
  const filename = `${licence.licence_ref}-contract-v${row.template_version}.pdf`.replace(/[^A-Za-z0-9_.-]/g, '-');
  return { ok: true, bytes: rendered.bytes, filename, renderer: rendered.renderer };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
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

/** D808 — the day of the month a usage report falls due when the terms record none. */
export const DEFAULT_USAGE_REPORT_DAY = 5;

/** How many completed months the usage list shows, newest first (the canvas's three). */
export const USAGE_MONTHS_SHOWN = 3;

/** D808 — why HQ has no Send now: it keeps the ledger the report feeds. */
export const SEND_NOW_HQ_REASON = 'HQ keeps the statements ledger itself; only a branch sends its usage report.';

const pad2 = (n: number) => String(n).padStart(2, '0');
const monthKey = (y: number, m0: number) => `${y}-${pad2(m0 + 1)}`;

/** The quarter (`YYYY-Qn`) a month (`YYYY-MM`) falls in. */
export function quarterOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/** A stored stamp in ms: an ISO string, or D1's `YYYY-MM-DD HH:MM:SS`, which is UTC. NaN when it is neither. */
function stampMs(t: string): number {
  const iso = t.includes('T') ? t : t.replace(' ', 'T');
  return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) || iso.length <= 10 ? iso : `${iso}Z`);
}

export type UsageMonth = {
  month: string;
  /** `sent`: a report for the month's period, stamped after the month ended. */
  status: 'sent' | 'late' | 'due';
  sent_at: string | null;
  /** The month's report deadline: `usage_report_day` of the next month, end of day UTC. */
  due_on: string;
};

/**
 * Each of the last `USAGE_MONTHS_SHOWN` completed months, Sent or Late (D808).
 *
 * THE REPORTS ARE QUARTERLY, the months are not. A branch reports its quarter
 * every day (`pushUsageReport`, D266), upserted per (licence, period, stream),
 * so a month is covered by its quarter's report once that report was stamped
 * after the month ended. A period stored by month (`YYYY-MM`) covers its own
 * month the same way. `sent_at` is the latest stamp on the period, which is the
 * only one stored: the first report after the month is overwritten by the next.
 *
 * Late is measured against `usage_report_day` (D797), day 5 when the terms
 * record none: a month with no covering report after that day of the next
 * month is late; before it, it is due.
 */
export function usageMonths(
  reports: Array<{ period: string; reported_at: string | null }>, now: Date, reportDay: number | null,
): UsageMonth[] {
  const day = reportDay ?? DEFAULT_USAGE_REPORT_DAY;
  const stamps = new Map<string, string>();
  for (const r of reports) {
    if (!r.reported_at) continue;
    const prior = stamps.get(r.period);
    if (!prior || r.reported_at > prior) stamps.set(r.period, r.reported_at);
  }
  const out: UsageMonth[] = [];
  for (let i = 1; i <= USAGE_MONTHS_SHOWN; i += 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const month = monthKey(start.getUTCFullYear(), start.getUTCMonth());
    const ended = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const due = new Date(Date.UTC(ended.getUTCFullYear(), ended.getUTCMonth(), day, 23, 59, 59));
    const due_on = `${ended.getUTCFullYear()}-${pad2(ended.getUTCMonth() + 1)}-${pad2(day)}`;
    const covering = [stamps.get(month), stamps.get(quarterOfMonth(month))]
      .filter((t): t is string => !!t && stampMs(t) >= ended.getTime())
      .sort().pop() ?? null;
    if (covering) out.push({ month, status: 'sent', sent_at: covering, due_on });
    else out.push({ month, status: now.getTime() > due.getTime() ? 'late' : 'due', sent_at: null, due_on });
  }
  return out;
}

/**
 * GET /api/licence/mine/statements's body: the licensee's statements, the usage
 * reports by period and by month, and the payment block for the territory
 * licence fee. `terms` are the two the account reads (`accountTerms`), when known.
 */
export async function licenseeStatements(
  env: Env, licence: LicenceRow,
  terms?: { licensor_ip_entity: string | null; usage_report_day: number | null } | null,
  now: Date = new Date(),
) {
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
  const usage_report_day = terms?.usage_report_day ?? null;
  const usage_months = usageMonths(u.results || [], now, usage_report_day);

  const refused = licensorRefusal(terms?.licensor_ip_entity ?? null);
  let payment: Record<string, unknown>;
  if (refused) payment = refused;
  else {
    const block = await paymentBlock(env, 'holdings', 'territory_licence_fee', null, false);
    payment = block.refusal ? block.payment : { ...block.payment, warning: PAY_WARNING };
  }
  return {
    available: true as const, statements, usage_reports, usage_months,
    usage_report_day: usage_report_day ?? DEFAULT_USAGE_REPORT_DAY, usage_report_day_recorded: usage_report_day !== null,
    send_now: false as const, send_now_reason: SEND_NOW_HQ_REASON,
    payment,
  };
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

// ── D808: Needs you ──────────────────────────────────────────────────────────

/** Where each kind of item takes the Administrator (D800's tabs under `/admin/my-licence`). */
export const NEEDS_LINKS = {
  contract: '/admin/my-licence/contract',
  notice: '/admin/my-licence/history',
  statement: '/admin/my-licence/statements',
  seats: '/admin/my-licence/requests',
} as const;

/** A seat type needs the Administrator at this share of its licensed seats, or more. */
export const SEAT_NEEDS_SHARE = 0.9;

export type NeedsKind = keyof typeof NEEDS_LINKS;

export type NeedsItem =
  | { kind: 'contract'; link: string; action: 'sign'; contract_uid: string; template_title: string; template_version: number; sent_at: string | null }
  | { kind: 'notice'; link: string; action: 'answer'; notice_uid: string; notice_kind: string; subject: string; respond_by: string | null; status: string }
  | { kind: 'statement'; link: string; action: 'view'; statement_uid: string; period: string; owed_cents: number; paid_cents: number; currency: string }
  | { kind: 'seats'; link: string; action: 'request_seats'; seat_type: string; seats_used: number; seats_licensed: number };

/** The order the items are listed in, kind by kind. */
export const NEEDS_ORDER: readonly NeedsKind[] = ['contract', 'notice', 'statement', 'seats'];

type Unavailable = { kind: NeedsKind; reason: string };

/** The answer's shape: the items in order, the count the pill draws, and every kind that could not be checked. */
function needsAnswer(items: NeedsItem[], unavailable: Unavailable[]) {
  const rank = (k: NeedsKind) => NEEDS_ORDER.indexOf(k);
  items.sort((a, b) => rank(a.kind) - rank(b.kind));
  return { items, count: items.length, complete: unavailable.length === 0, unavailable };
}

/**
 * GET /api/licence/mine/needs on HQ (D808): what is waiting on the caller, in
 * order. A contract out for THEIR signature, an HQ notice addressed to them and
 * not yet answered, and an issued statement not paid in full. Seats are a
 * branch's to count (`branchNeeds`); HQ does not count them. Each source is
 * read on its own: an unreadable one is named in `unavailable`, never read as
 * nothing to do.
 */
export async function licenseeNeeds(env: Env, licence: LicenceRow & { id: number }, userId: number) {
  const items: NeedsItem[] = [];
  const unavailable: Unavailable[] = [];

  try {
    const row = await env.DB.prepare(
      `SELECT uid, template_title, template_version, status, envelope_uid, sent_at
         FROM licence_contracts
        WHERE licence_uid = ? AND superseded_at IS NULL AND status = 'sent'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).bind(licence.uid).first<any>();
    if (row) {
      const enriched = await enrichContractFromEnvelope(env, row) as any;
      if (enriched.status === 'sent') {
        const sign = await signing(env, enriched, userId);
        if (sign.sign_url) {
          items.push({
            kind: 'contract', link: NEEDS_LINKS.contract, action: 'sign', contract_uid: row.uid,
            template_title: row.template_title, template_version: Number(row.template_version), sent_at: row.sent_at ?? null,
          });
        }
      }
    }
  } catch (e) {
    console.warn('[licence] needs: contracts unreadable', (e as Error).message);
    unavailable.push({ kind: 'contract', reason: 'The contract could not be read just now.' });
  }

  try {
    const q = await env.DB.prepare(
      `SELECT uid, kind, subject, respond_by, status FROM admin_notices
        WHERE user_id = ? AND licence_id = ? AND status IN ('issued', 'overdue')
        ORDER BY respond_by IS NULL, respond_by, id`,
    ).bind(userId, licence.id).all<any>();
    for (const n of q.results || []) {
      items.push({
        kind: 'notice', link: NEEDS_LINKS.notice, action: 'answer', notice_uid: n.uid, notice_kind: String(n.kind),
        subject: String(n.subject), respond_by: n.respond_by ?? null, status: String(n.status),
      });
    }
  } catch (e) {
    console.warn('[licence] needs: notices unreadable', (e as Error).message);
    unavailable.push({ kind: 'notice', reason: 'HQ\'s notices could not be read just now.' });
  }

  try {
    const q = await env.DB.prepare(
      `SELECT uid, period, owed_cents, paid_cents, currency FROM subsidiary_statements
        WHERE licence_uid = ? AND status = 'issued' AND paid_cents < owed_cents
        ORDER BY period, id`,
    ).bind(licence.uid).all<any>();
    for (const st of q.results || []) {
      items.push({
        kind: 'statement', link: NEEDS_LINKS.statement, action: 'view', statement_uid: st.uid, period: st.period,
        owed_cents: Number(st.owed_cents), paid_cents: Number(st.paid_cents), currency: st.currency,
      });
    }
  } catch (e) {
    console.warn('[licence] needs: statements unreadable', (e as Error).message);
    unavailable.push({ kind: 'statement', reason: 'The statements could not be read just now.' });
  }

  return needsAnswer(items, unavailable);
}

/**
 * The seat types at `SEAT_NEEDS_SHARE` or more of their licensed seats. Seats
 * used are counted as `/mine` counts them on a branch (D127): active accounts
 * by role, summed in JS, never an `IN (…)`. A type licensed for no seats is
 * not listed: there is nothing to run out of.
 */
export function seatNeeds(licensed: Record<string, number>, usedByRole: Record<string, number>): NeedsItem[] {
  const out: NeedsItem[] = [];
  for (const type of SEAT_ROLES) {
    const total = Number(licensed[type]) || 0;
    const used = Number(usedByRole[type]) || 0;
    if (total > 0 && used >= total * SEAT_NEEDS_SHARE) {
      out.push({ kind: 'seats', link: NEEDS_LINKS.seats, action: 'request_seats', seat_type: type, seats_used: used, seats_licensed: total });
    }
  }
  return out;
}

/**
 * GET /api/licence/mine/needs on a branch (D808): the seat types near their
 * limit, from the licence copy's seats and this database's accounts. The
 * contract, the statements and HQ's notices are HQ's tables, so a branch names
 * them as unavailable rather than reading them as clear. Never pulls the copy:
 * this is the cheap read the sidebar's pill makes on every page.
 */
export async function branchNeeds(env: Env) {
  const unavailable: Unavailable[] = (['contract', 'notice', 'statement'] as const)
    .map((kind) => ({ kind, reason: BRANCH_UNAVAILABLE.reason }));
  let licensed: Record<string, number> | null = null;
  try {
    const row = await env.DB.prepare('SELECT seats_json FROM branch_licence WHERE id = 1').first<{ seats_json: string | null }>();
    if (row) {
      const parsed = row.seats_json ? JSON.parse(row.seats_json) : {};
      licensed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
  } catch (e) {
    console.warn('[licence] needs: branch_licence unreadable', (e as Error).message);
  }
  if (!licensed) {
    unavailable.push({ kind: 'seats', reason: 'HQ has not pushed this branch its licence yet, so its seats are not known here.' });
    return needsAnswer([], unavailable);
  }
  try {
    const q = await env.DB.prepare('SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role')
      .all<{ role: string; n: number }>();
    const used: Record<string, number> = {};
    for (const r of q.results || []) used[String(r.role)] = Number(r.n) || 0;
    return needsAnswer(seatNeeds(licensed, used), unavailable);
  } catch (e) {
    console.warn('[licence] needs: seats used unreadable', (e as Error).message);
    unavailable.push({ kind: 'seats', reason: 'Seats used could not be counted just now.' });
    return needsAnswer([], unavailable);
  }
}
