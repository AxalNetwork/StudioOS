/**
 * D958 (#2791, Programs part 5 of #2371) — Referral partners, mounted at
 * /api/admin/referral-partners. Every route is `requireHqAdmin`: HQ holds
 * referral partners and their terms, and a branch is refused (#2376).
 *
 *   GET  /                      the partners, paged, with segment, terms state, code,
 *                               introductions, converted, accrued, paid and last activity
 *   POST /                      HQ adds a member as a referral partner (OD3 A) `{ user_id, segment, note? }`
 *   PATCH /:userId              a partner's segment or note
 *   GET  /summary?quarter=      the facts and tiles for one calendar quarter (UTC)
 *   GET  /series                introductions by week, outcome and segment; commission by month
 *   GET  /terms?status=         the terms in one state, oldest first (submitted: the Queue tab)
 *   POST /terms                 a draft
 *   PATCH /terms/:uid           edit a draft
 *   POST /terms/:uid/submit     draft → submitted (sent to HQ)
 *   POST /terms/:uid/approve    submitted → approved: the Super Admin only, behind the step-up bar (O-TERMS A)
 *   POST /terms/:uid/preview    the contract the send would carry, from the published template
 *   POST /terms/:uid/send       approved → sent, through today's envelope send, matching its preview
 *   POST /terms/:uid/end        signed or active → ended, with a reason
 *   GET  /:userId/terms         one partner's terms, newest first
 *
 * MONEY FOLLOWS O-MONEY (A). Accrued and paid figures are the Super Admin's;
 * a plain Admin's read carries `{ available: false, reason: 'hq_reads' }` in
 * their place, never a 0. A terms row's own amounts are not earnings: HQ
 * admins draft them, so they read them.
 *
 * Paid is completed payouts (`payouts.status = 'completed'`), never
 * `commissions.status = 'paid'`, which only says a payout request claimed it.
 * Accrued is every commission earned, less what a refund reversed.
 *
 * Each write records its decision through `logAdminAction`; the action names
 * are listed for Referral partners in services/programActivity.ts.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireHqAdmin, requireSuperAdminWriteBar } from '../auth';
import { refuse } from '../util/refusal';
import { likeNeedle } from '../util/likeSearch';
import { logAdminAction } from '../services/adminAudit';
import { quarterOf } from '../services/partnerLeaderboard';
import { envelopeHandler } from './admin_contracts';
import {
  FACTS, FIRING_RULES, LIVE_STATES, READ_STATES, SEGMENT_LABEL, STORED_STATES, effectiveState, isSegment, rangesOverlap, todayUtc,
} from '../services/referralPartnerTerms';

type Ctx = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

export const TERMS_ACTIONS = [
  'referral_partner.added', 'referral_partner.updated',
  'referral_terms.created', 'referral_terms.updated', 'referral_terms.submitted', 'referral_terms.approved',
  'referral_terms.sent', 'referral_terms.ended',
] as const;

const PAGE = 25;
const PAGE_MAX = 100;
const NOTE_MAX = 2000;
const AMOUNT_MAX_CENTS = 100_000_000;
const TRIGGERS_MAX = 10;
const HQ_READS = { available: false as const, reason: 'hq_reads', message: 'HQ reads these figures.' };
/** KYC approval carries no amount, so a share of it would always pay 0. */
const NO_BASE_AMOUNT: ReadonlySet<string> = new Set(['referral_kyc_approved']);

function paging(c: Ctx): { limit: number; offset: number } | null {
  const limit = c.req.query('limit') === undefined ? PAGE : Number(c.req.query('limit'));
  const offset = c.req.query('offset') === undefined ? 0 : Number(c.req.query('offset'));
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0) return null;
  return { limit: Math.min(limit, PAGE_MAX), offset };
}
const BAD_PAGE = { code: 'invalid_page', message: 'Use a limit from 1 to 100 and a nonnegative offset.' };
const unreadable = (c: Ctx, raw: unknown) => refuse(c, 503, { code: 'referral_partners_unreadable', message: 'Referral partners could not be read. Try again in a moment.', raw });

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const posIntOrNull = (v: unknown, max = AMOUNT_MAX_CENTS): number | null | 'bad' => {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= max ? v : 'bad';
};
const textOrNull = (v: unknown, max: number): string | null | 'bad' => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return 'bad';
  const t = v.trim();
  return t.length > max ? 'bad' : t || null;
};

type Trigger = { rule_key: string; amount_cents: number | null; percentage_bps: number | null };
type TermsInput = {
  starts_on: string; ends_on: string | null; cap_per_intro_cents: number | null; overall_cap_cents: number | null;
  currency: string; sectors: string | null; contract_slug: string | null; note: string | null; triggers: Trigger[];
};
type Refusal = { status: 400 | 409; code: string; message: string };

/** One body, whole or merged over a draft, checked as the store and the engine need it. */
export function readTermsInput(b: any, base?: TermsInput): TermsInput | Refusal {
  const pick = (k: keyof TermsInput) => (b && Object.prototype.hasOwnProperty.call(b, k) ? b[k] : base?.[k]);
  const starts = pick('starts_on');
  const ends = pick('ends_on') ?? null;
  if (!isDate(starts) || (ends !== null && !isDate(ends)) || (ends !== null && ends < starts)) {
    return { status: 400, code: 'invalid_dates', message: 'Give a start date, and an end date on or after it, as YYYY-MM-DD.' };
  }
  const perIntro = posIntOrNull(pick('cap_per_intro_cents'));
  const overall = posIntOrNull(pick('overall_cap_cents'));
  if (perIntro === 'bad' || overall === 'bad') return { status: 400, code: 'invalid_cap', message: 'A cap is whole cents above 0, or left out.' };
  const currency = pick('currency') ?? 'USD';
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return { status: 400, code: 'invalid_currency', message: 'The currency is a three-letter code, such as USD.' };
  const rawSectors = pick('sectors');
  let sectors: string | null = null;
  if (rawSectors != null) {
    const list = typeof rawSectors === 'string' ? (() => { try { return JSON.parse(rawSectors); } catch { return null; } })() : rawSectors;
    if (!Array.isArray(list) || list.length > 20 || list.some((s) => typeof s !== 'string' || !s.trim() || s.length > 80)) {
      return { status: 400, code: 'invalid_sectors', message: 'Sectors are up to 20 names, or left out for every sector.' };
    }
    sectors = list.length ? JSON.stringify(list.map((s: string) => s.trim())) : null;
  }
  const slug = textOrNull(pick('contract_slug'), 200);
  const note = textOrNull(pick('note'), NOTE_MAX);
  if (slug === 'bad' || note === 'bad') return { status: 400, code: 'invalid_request', message: `The contract is a template slug, and the note at most ${NOTE_MAX} characters.` };
  const rawTriggers = pick('triggers');
  if (!Array.isArray(rawTriggers) || !rawTriggers.length || rawTriggers.length > TRIGGERS_MAX) {
    return { status: 400, code: 'triggers_required', message: `Name from 1 to ${TRIGGERS_MAX} triggers the terms pay on.` };
  }
  const triggers: Trigger[] = [];
  for (const t of rawTriggers) {
    const key = t?.rule_key;
    if (typeof key !== 'string' || !FIRING_RULES.has(key)) {
      return { status: 400, code: 'trigger_unknown', message: 'Terms can pay only on a trigger an event fires today: a referred member’s identity check (referral_kyc_approved).' };
    }
    if (triggers.some((x) => x.rule_key === key)) return { status: 400, code: 'trigger_repeated', message: 'Name each trigger once.' };
    const amount = t.amount_cents ?? null;
    const bps = t.percentage_bps ?? null;
    if ((amount === null) === (bps === null)) {
      return { status: 400, code: 'trigger_amount_ambiguous', message: 'Each trigger pays a flat amount or a share, never both and never neither.' };
    }
    const a = posIntOrNull(amount);
    const s = posIntOrNull(bps, 10_000);
    if (a === 'bad' || s === 'bad') return { status: 400, code: 'trigger_amount_invalid', message: 'A flat amount is whole cents above 0; a share is from 1 to 10000 basis points.' };
    if (s !== null && NO_BASE_AMOUNT.has(key)) {
      return { status: 400, code: 'trigger_share_unpaid', message: 'An identity check carries no amount, so a share of it pays nothing. Give a flat amount.' };
    }
    triggers.push({ rule_key: key, amount_cents: a, percentage_bps: s });
  }
  return { starts_on: starts, ends_on: ends, cap_per_intro_cents: perIntro, overall_cap_cents: overall, currency, sectors, contract_slug: slug, note, triggers };
}
const isRefusal = (v: TermsInput | Refusal): v is Refusal => (v as Refusal).code !== undefined;

async function triggersFor(env: Env, ids: number[]): Promise<Map<number, Trigger[]>> {
  const out = new Map<number, Trigger[]>();
  if (!ids.length) return out;
  const rows = await env.DB.prepare(
    `SELECT terms_id, rule_key, amount_cents, percentage_bps FROM referral_partner_term_triggers
      WHERE terms_id IN (SELECT value FROM json_each(?)) ORDER BY terms_id, id`,
  ).bind(JSON.stringify(ids)).all<any>();
  for (const g of rows.results || []) {
    const list = out.get(Number(g.terms_id)) ?? [];
    list.push({ rule_key: g.rule_key, amount_cents: g.amount_cents ?? null, percentage_bps: g.percentage_bps ?? null });
    out.set(Number(g.terms_id), list);
  }
  return out;
}

/** A terms row as every read draws it: its state today, its triggers, and who did each step. */
function presentTerms(t: any, triggers: Trigger[], today: string) {
  let sectors: string[] | null = null;
  try { sectors = t.sectors ? JSON.parse(t.sectors) : null; } catch { sectors = null; }
  return {
    uid: t.uid, partner_user_id: t.partner_user_id ?? null, partner_name: t.partner_name ?? null,
    segment: t.segment, segment_label: SEGMENT_LABEL[t.segment as keyof typeof SEGMENT_LABEL] ?? t.segment,
    stored_status: t.status, state: effectiveState(t, today),
    starts_on: t.starts_on, ends_on: t.ends_on ?? null,
    cap_per_intro_cents: t.cap_per_intro_cents ?? null, overall_cap_cents: t.overall_cap_cents ?? null, currency: t.currency,
    sectors, contract_slug: t.contract_slug ?? null, envelope_id: t.envelope_id ?? null, note: t.note ?? null, triggers,
    created: { by: t.created_by ?? null, at: t.created_at },
    submitted: t.submitted_at ? { by: t.submitted_by ?? null, at: t.submitted_at } : null,
    approved: t.approved_at ? { by: t.approved_by ?? null, at: t.approved_at } : null,
    sent: t.sent_at ? { by: t.sent_by ?? null, at: t.sent_at } : null,
    signed: t.signed_at ? { at: t.signed_at } : null,
    ended: t.ended_at ? { by: t.ended_by ?? null, at: t.ended_at, reason: t.end_reason ?? null } : null,
  };
}

async function termsByUid(env: Env, uid: string) {
  return env.DB.prepare(`SELECT t.*, p.user_id AS partner_user_id, u.name AS partner_name, u.email AS partner_email
    FROM referral_partner_terms t JOIN referral_partners p ON p.id = t.partner_id JOIN users u ON u.id = p.user_id
    WHERE t.uid = ?`).bind(uid).first<any>();
}
const NOT_FOUND = { code: 'terms_not_found', message: 'No terms have that reference.' };
const PARTNER_NOT_FOUND = { code: 'referral_partner_not_found', message: 'That member is not a referral partner.' };

/** Another live terms row of the same partner whose dates overlap these. */
async function overlapping(env: Env, partnerId: number, self: { id?: number; starts_on: string; ends_on: string | null }, today: string) {
  const rows = await env.DB.prepare(
    `SELECT id, uid, status, starts_on, ends_on FROM referral_partner_terms
      WHERE partner_id = ? AND id <> ? AND status IN ('submitted', 'approved', 'sent', 'signed', 'active')`,
  ).bind(partnerId, self.id ?? 0).all<any>();
  return (rows.results || []).find((o) => (LIVE_STATES as readonly string[]).includes(effectiveState(o, today)) && rangesOverlap(o, self)) ?? null;
}
const OVERLAP = (uid: string) => ({ code: 'terms_overlap', message: `These dates overlap the partner’s terms ${uid}. A partner holds one set of terms at a time.` });

async function moneyFor(env: Env, userIds: number[]) {
  const ids = JSON.stringify(userIds);
  const accrued = await env.DB.prepare(
    `SELECT user_id, currency, SUM(amount_cents - COALESCE(reversed_amount_cents, 0)) AS cents FROM commissions
      WHERE user_id IN (SELECT value FROM json_each(?)) GROUP BY user_id, currency ORDER BY currency`,
  ).bind(ids).all<any>();
  const paid = await env.DB.prepare(
    `SELECT user_id, currency, SUM(amount_cents) AS cents FROM payouts
      WHERE status = 'completed' AND user_id IN (SELECT value FROM json_each(?)) GROUP BY user_id, currency ORDER BY currency`,
  ).bind(ids).all<any>();
  const by = (rows: any[]) => {
    const m = new Map<number, Array<{ currency: string; cents: number }>>();
    for (const x of rows) { const l = m.get(Number(x.user_id)) ?? []; l.push({ currency: x.currency, cents: Number(x.cents) || 0 }); m.set(Number(x.user_id), l); }
    return m;
  };
  return { accrued: by(accrued.results || []), paid: by(paid.results || []) };
}

/* ------------------------------------------------------------------ *
 * Partners
 * ------------------------------------------------------------------ */

const LIST_SORTS = ['added', 'name', 'introductions', 'last_activity'] as const;

r.get('/', async (c) => {
  const admin = await requireHqAdmin(c);
  const page = paging(c);
  if (!page) return refuse(c, 400, BAD_PAGE);
  const segment = c.req.query('segment') || '';
  const terms = c.req.query('terms') || '';
  const status = c.req.query('status') || '';
  const sort = c.req.query('sort') || 'added';
  if (segment && !isSegment(segment)) return refuse(c, 400, { code: 'unknown_segment', message: 'Segment is event_organisers, venture_scouts or deal_makers.' });
  if (terms && terms !== 'none' && !(READ_STATES as readonly string[]).includes(terms)) return refuse(c, 400, { code: 'unknown_terms_state', message: `Terms is none or one of ${READ_STATES.join(', ')}.` });
  if (status && status !== 'active' && status !== 'inactive') return refuse(c, 400, { code: 'unknown_status', message: 'Status is active or inactive.' });
  if (!(LIST_SORTS as readonly string[]).includes(sort)) return refuse(c, 400, { code: 'unknown_sort', message: `Sort is one of ${LIST_SORTS.join(', ')}.` });
  const q = likeNeedle(c.req.query('q'));
  const today = todayUtc();
  try {
    // One literal statement; partners join by invitation, so the filtered list is
    // paged here rather than counted twice.
    const list = await c.env.DB.prepare(`WITH ts AS (
        SELECT t.partner_id, CASE
          WHEN t.status IN ('signed', 'active') AND t.ends_on IS NOT NULL AND t.ends_on < ? THEN 'expired'
          WHEN t.status IN ('signed', 'active') AND t.starts_on <= ? THEN 'active'
          WHEN t.status = 'active' THEN 'signed'
          ELSE t.status END AS st
        FROM referral_partner_terms t),
      best AS (SELECT partner_id, MIN(CASE st WHEN 'active' THEN 0 WHEN 'signed' THEN 1 WHEN 'sent' THEN 2 WHEN 'approved' THEN 3
          WHEN 'submitted' THEN 4 WHEN 'draft' THEN 5 WHEN 'ended' THEN 6 ELSE 7 END) AS rk FROM ts GROUP BY partner_id),
      rows AS (
        SELECT p.id AS partner_id, p.user_id, p.segment, p.added_at, u.name, u.email, u.referral_code AS code, u.is_active,
          (SELECT COUNT(*) FROM referrals x WHERE x.referrer_id = p.user_id) AS introductions,
          (SELECT COUNT(*) FROM referrals x WHERE x.referrer_id = p.user_id AND x.status = 'converted') AS converted,
          NULLIF(MAX(COALESCE((SELECT MAX(x.created_at) FROM referrals x WHERE x.referrer_id = p.user_id), ''),
              COALESCE((SELECT MAX(m.created_at) FROM commissions m WHERE m.user_id = p.user_id), '')), '') AS last_activity,
          CASE b.rk WHEN 0 THEN 'active' WHEN 1 THEN 'signed' WHEN 2 THEN 'sent' WHEN 3 THEN 'approved' WHEN 4 THEN 'submitted'
            WHEN 5 THEN 'draft' WHEN 6 THEN 'ended' WHEN 7 THEN 'expired' END AS terms_state
        FROM referral_partners p JOIN users u ON u.id = p.user_id LEFT JOIN best b ON b.partner_id = p.id)
      SELECT * FROM rows
       WHERE (? = '' OR segment = ?)
         AND (? = '' OR terms_state = ? OR (? = 'none' AND terms_state IS NULL))
         AND (? = '' OR (? = 'active' AND is_active = 1) OR (? = 'inactive' AND is_active <> 1))
         AND (? IS NULL OR name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\')
       ORDER BY CASE WHEN ? = 'name' THEN name END COLLATE NOCASE,
                CASE WHEN ? = 'introductions' THEN introductions END DESC,
                CASE WHEN ? = 'last_activity' THEN last_activity END DESC,
                added_at DESC, user_id DESC`)
      .bind(today, today, segment, segment, terms, terms, terms, status, status, status, q, q, q, q, sort, sort, sort).all<any>();
    const all = list.results || [];
    const total = { n: all.length };
    const rows = all.slice(page.offset, page.offset + page.limit);
    const money = isSuperAdmin(admin) && rows.length ? await moneyFor(c.env, rows.map((x) => Number(x.user_id))) : null;
    return c.json({
      facts: FACTS,
      items: rows.map((x) => ({
        user_id: Number(x.user_id), name: x.name ?? null, email: x.email, active: Number(x.is_active) === 1,
        segment: x.segment, segment_label: SEGMENT_LABEL[x.segment as keyof typeof SEGMENT_LABEL] ?? x.segment,
        terms_state: x.terms_state ?? 'none', code: x.code ?? null,
        introductions: Number(x.introductions) || 0, converted: Number(x.converted) || 0,
        last_activity: x.last_activity || null, added_at: x.added_at,
        money: money ? { available: true, accrued: money.accrued.get(Number(x.user_id)) ?? [], paid: money.paid.get(Number(x.user_id)) ?? [] } : HQ_READS,
      })),
      total: Number(total?.n) || 0, limit: page.limit, offset: page.offset,
      introduction_means: 'A member who signed up with the partner’s referral code. Converted: their referral earned a commission.',
    });
  } catch (e) { return unreadable(c, e); }
});

r.post('/', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await c.req.json().catch(() => null) as any;
  const userId = b?.user_id;
  if (!Number.isSafeInteger(userId) || userId <= 0) return refuse(c, 400, { code: 'invalid_request', message: 'Name the member by their account number.' });
  if (!isSegment(b?.segment)) return refuse(c, 400, { code: 'unknown_segment', message: 'Segment is event_organisers, venture_scouts or deal_makers.' });
  const note = textOrNull(b?.note, NOTE_MAX);
  if (note === 'bad') return refuse(c, 400, { code: 'invalid_request', message: `Keep the note to ${NOTE_MAX} characters.` });
  try {
    const u = await c.env.DB.prepare(
      `SELECT u.id, u.role, u.is_active, EXISTS (SELECT 1 FROM super_admins s WHERE s.user_id = u.id) AS sa FROM users u WHERE u.id = ?`,
    ).bind(userId).first<any>();
    if (!u || Number(u.is_active) !== 1) return refuse(c, 404, { code: 'member_not_found', message: 'No active member has that account number.' });
    if (u.role === 'admin' || Number(u.sa) === 1) return refuse(c, 409, { code: 'admins_cannot_refer', message: 'An admin account cannot be a referral partner.' });
    const row = await c.env.DB.prepare(
      `INSERT INTO referral_partners (user_id, segment, note, added_by) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING RETURNING id, user_id, segment, added_at`,
    ).bind(userId, b.segment, note, admin.id).first<any>();
    if (!row) return refuse(c, 409, { code: 'already_referral_partner', message: 'That member is already a referral partner.' });
    await logAdminAction(c.env, admin.id, admin.email, 'referral_partner.added', { target_user_id: userId, segment: b.segment });
    return c.json({ ...row, segment_label: SEGMENT_LABEL[b.segment as keyof typeof SEGMENT_LABEL] }, 201);
  } catch (e) { return unreadable(c, e); }
});

/* ------------------------------------------------------------------ *
 * The summary and the series
 * ------------------------------------------------------------------ */

/** "2026-Q4" → its first day and the first day after it, as YYYY-MM-DD. */
export function quarterRange(key: string): { from: string; to: string } | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]); const q = Number(m[2]) - 1;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(Date.UTC(y, q * 3, 1)), to: iso(Date.UTC(y, q * 3 + 3, 1)) };
}

r.get('/summary', async (c) => {
  const admin = await requireHqAdmin(c);
  const quarter = c.req.query('quarter') || quarterOf(Date.now()).key;
  const range = quarterRange(quarter);
  if (!range) return refuse(c, 400, { code: 'invalid_quarter', message: 'A quarter is written like 2026-Q4.' });
  const today = todayUtc();
  try {
    const counts = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM referral_partners p JOIN users u ON u.id = p.user_id WHERE u.is_active = 1) AS active_partners,
         (SELECT COUNT(DISTINCT t.partner_id) FROM referral_partner_terms t
           WHERE t.status IN ('signed', 'active') AND t.starts_on <= ? AND (t.ends_on IS NULL OR t.ends_on >= ?)) AS with_signed_terms,
         (SELECT COUNT(DISTINCT t.partner_id) FROM referral_partner_terms t WHERE t.status = 'sent') AS waiting_to_sign,
         (SELECT COUNT(*) FROM referrals x JOIN referral_partners p ON p.user_id = x.referrer_id
           WHERE date(x.created_at) >= ? AND date(x.created_at) < ?) AS introductions`,
    ).bind(today, today, range.from, range.to).first<any>();
    let money: any = HQ_READS;
    if (isSuperAdmin(admin)) {
      const accrued = await c.env.DB.prepare(
        `SELECT m.currency, SUM(m.amount_cents - COALESCE(m.reversed_amount_cents, 0)) AS cents FROM commissions m
          JOIN referral_partners p ON p.user_id = m.user_id
          WHERE date(m.created_at) >= ? AND date(m.created_at) < ? GROUP BY m.currency ORDER BY m.currency`,
      ).bind(range.from, range.to).all<any>();
      const paid = await c.env.DB.prepare(
        `SELECT o.currency, SUM(o.amount_cents) AS cents FROM payouts o JOIN referral_partners p ON p.user_id = o.user_id
          WHERE o.status = 'completed' AND date(o.completed_at) >= ? AND date(o.completed_at) < ? GROUP BY o.currency ORDER BY o.currency`,
      ).bind(range.from, range.to).all<any>();
      const list = (rows: any[]) => rows.map((x) => ({ currency: x.currency, cents: Number(x.cents) || 0 }));
      money = { available: true, accrued: list(accrued.results || []), paid: list(paid.results || []) };
    }
    return c.json({
      quarter, from: range.from, to: range.to, facts: FACTS,
      active_partners: Number(counts?.active_partners) || 0, with_signed_terms: Number(counts?.with_signed_terms) || 0,
      waiting_to_sign: Number(counts?.waiting_to_sign) || 0, introductions: Number(counts?.introductions) || 0, money,
    });
  } catch (e) { return unreadable(c, e); }
});

const SERIES_WEEKS = 12;
const SERIES_MONTHS = 12;

r.get('/series', async (c) => {
  const admin = await requireHqAdmin(c);
  const now = new Date();
  const back = (now.getUTCDay() + 6) % 7;
  const thisMonday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back);
  const fromWeek = new Date(thisMonday - (SERIES_WEEKS - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
  const fromMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (SERIES_MONTHS - 1), 1)).toISOString().slice(0, 10);
  try {
    const intros = await c.env.DB.prepare(
      `SELECT date(x.created_at, '-6 days', 'weekday 1') AS week_start, p.segment, x.status AS outcome, COUNT(*) AS n
         FROM referrals x JOIN referral_partners p ON p.user_id = x.referrer_id
        WHERE date(x.created_at) >= ?
        GROUP BY week_start, p.segment, x.status ORDER BY week_start, p.segment, x.status`,
    ).bind(fromWeek).all<any>();
    let commission: any = HQ_READS;
    if (isSuperAdmin(admin)) {
      const accrued = await c.env.DB.prepare(
        `SELECT strftime('%Y-%m', m.created_at) AS month, m.currency, SUM(m.amount_cents - COALESCE(m.reversed_amount_cents, 0)) AS cents
           FROM commissions m JOIN referral_partners p ON p.user_id = m.user_id
          WHERE date(m.created_at) >= ? GROUP BY month, m.currency ORDER BY month, m.currency`,
      ).bind(fromMonth).all<any>();
      const paid = await c.env.DB.prepare(
        `SELECT strftime('%Y-%m', o.completed_at) AS month, o.currency, SUM(o.amount_cents) AS cents
           FROM payouts o JOIN referral_partners p ON p.user_id = o.user_id
          WHERE o.status = 'completed' AND date(o.completed_at) >= ? GROUP BY month, o.currency ORDER BY month, o.currency`,
      ).bind(fromMonth).all<any>();
      const list = (rows: any[]) => rows.map((x) => ({ month: x.month, currency: x.currency, cents: Number(x.cents) || 0 }));
      commission = { available: true, accrued: list(accrued.results || []), paid: list(paid.results || []) };
    }
    return c.json({
      weeks_from: fromWeek, months_from: fromMonth,
      introductions: (intros.results || []).map((x) => ({ week_start: x.week_start, segment: x.segment, outcome: x.outcome, n: Number(x.n) || 0 })),
      outcomes: ['pending', 'converted'],
      commission,
    });
  } catch (e) { return unreadable(c, e); }
});

/* ------------------------------------------------------------------ *
 * Terms
 * ------------------------------------------------------------------ */

r.get('/terms', async (c) => {
  await requireHqAdmin(c);
  const page = paging(c);
  if (!page) return refuse(c, 400, BAD_PAGE);
  const status = c.req.query('status') || 'submitted';
  if (!(STORED_STATES as readonly string[]).includes(status)) return refuse(c, 400, { code: 'unknown_status', message: `Status is one of ${STORED_STATES.join(', ')}.` });
  const today = todayUtc();
  try {
    const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM referral_partner_terms WHERE status = ?').bind(status).first<{ n: number }>();
    const rows = await c.env.DB.prepare(`SELECT t.*, p.user_id AS partner_user_id, u.name AS partner_name
      FROM referral_partner_terms t JOIN referral_partners p ON p.id = t.partner_id JOIN users u ON u.id = p.user_id
      WHERE t.status = ?
      ORDER BY COALESCE(t.submitted_at, t.created_at) ASC, t.id ASC LIMIT ? OFFSET ?`).bind(status, page.limit, page.offset).all<any>();
    const list = rows.results || [];
    const triggers = await triggersFor(c.env, list.map((t) => Number(t.id)));
    return c.json({ items: list.map((t) => presentTerms(t, triggers.get(Number(t.id)) ?? [], today)), total: Number(total?.n) || 0, limit: page.limit, offset: page.offset });
  } catch (e) { return unreadable(c, e); }
});

async function saveTriggers(env: Env, termsId: number, triggers: Trigger[]) {
  return [
    env.DB.prepare('DELETE FROM referral_partner_term_triggers WHERE terms_id = ?').bind(termsId),
    ...triggers.map((g) => env.DB.prepare(
      'INSERT INTO referral_partner_term_triggers (terms_id, rule_key, amount_cents, percentage_bps) VALUES (?, ?, ?, ?)',
    ).bind(termsId, g.rule_key, g.amount_cents, g.percentage_bps)),
  ];
}

r.post('/terms', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await c.req.json().catch(() => null) as any;
  const userId = b?.user_id;
  if (!Number.isSafeInteger(userId) || userId <= 0) return refuse(c, 400, { code: 'invalid_request', message: 'Name the referral partner by their account number.' });
  const input = readTermsInput(b);
  if (isRefusal(input)) return refuse(c, input.status, { code: input.code, message: input.message });
  try {
    const partner = await c.env.DB.prepare('SELECT id, segment FROM referral_partners WHERE user_id = ?').bind(userId).first<any>();
    if (!partner) return refuse(c, 404, PARTNER_NOT_FOUND);
    const uid = `rpt_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const row = await c.env.DB.prepare(
      `INSERT INTO referral_partner_terms (uid, partner_id, segment, status, starts_on, ends_on, cap_per_intro_cents, overall_cap_cents, currency,
         sectors, contract_slug, note, created_by) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(uid, partner.id, partner.segment, input.starts_on, input.ends_on, input.cap_per_intro_cents, input.overall_cap_cents, input.currency,
      input.sectors, input.contract_slug, input.note, admin.id).first<{ id: number }>();
    await c.env.DB.batch(await saveTriggers(c.env, Number(row!.id), input.triggers));
    await logAdminAction(c.env, admin.id, admin.email, 'referral_terms.created', { uid, partner_user_id: userId });
    const saved = await termsByUid(c.env, uid);
    return c.json(presentTerms(saved, (await triggersFor(c.env, [Number(saved.id)])).get(Number(saved.id)) ?? [], todayUtc()), 201);
  } catch (e) { return unreadable(c, e); }
});

r.patch('/terms/:uid', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await c.req.json().catch(() => null) as any;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return refuse(c, 400, { code: 'invalid_request', message: 'Send the changes as an object.' });
  try {
    const t = await termsByUid(c.env, c.req.param('uid'));
    if (!t) return refuse(c, 404, NOT_FOUND);
    if (t.status !== 'draft') return refuse(c, 409, { code: 'terms_not_draft', message: 'Only a draft can be edited. Submitted terms are HQ’s to decide.' });
    const current = (await triggersFor(c.env, [Number(t.id)])).get(Number(t.id)) ?? [];
    const input = readTermsInput(b, {
      starts_on: t.starts_on, ends_on: t.ends_on ?? null, cap_per_intro_cents: t.cap_per_intro_cents ?? null, overall_cap_cents: t.overall_cap_cents ?? null,
      currency: t.currency, sectors: t.sectors ?? null, contract_slug: t.contract_slug ?? null, note: t.note ?? null, triggers: current,
    });
    if (isRefusal(input)) return refuse(c, input.status, { code: input.code, message: input.message });
    const update = c.env.DB.prepare(
      `UPDATE referral_partner_terms SET starts_on = ?, ends_on = ?, cap_per_intro_cents = ?, overall_cap_cents = ?, currency = ?, sectors = ?,
         contract_slug = ?, note = ?, updated_at = datetime('now') WHERE id = ? AND status = 'draft'`,
    ).bind(input.starts_on, input.ends_on, input.cap_per_intro_cents, input.overall_cap_cents, input.currency, input.sectors,
      input.contract_slug, input.note, t.id);
    const results = await c.env.DB.batch([update, ...await saveTriggers(c.env, Number(t.id), input.triggers)]);
    if (!Number(results[0]?.meta?.changes)) return refuse(c, 409, { code: 'terms_not_draft', message: 'Only a draft can be edited. Submitted terms are HQ’s to decide.' });
    await logAdminAction(c.env, admin.id, admin.email, 'referral_terms.updated', { uid: t.uid });
    const saved = await termsByUid(c.env, t.uid);
    return c.json(presentTerms(saved, input.triggers, todayUtc()));
  } catch (e) { return unreadable(c, e); }
});

/** One step: the row must be in `from`, the UPDATE names it, and a raced step changes nothing. */
async function step(c: Ctx, admin: { id: number; email: string }, uid: string, from: string, sql: string, binds: unknown[], action: string, extra: Record<string, unknown> = {}) {
  const t = await termsByUid(c.env, uid);
  if (!t) return refuse(c, 404, NOT_FOUND);
  return { t, run: async () => {
    const res = await c.env.DB.prepare(sql).bind(...binds, t.id, from).run();
    if (!Number(res.meta?.changes)) return refuse(c, 409, { code: 'terms_changed', message: 'These terms changed while you were looking at them. Read them again.' });
    await logAdminAction(c.env, admin.id, admin.email, action, { uid, ...extra });
    const saved = await termsByUid(c.env, uid);
    return c.json(presentTerms(saved, (await triggersFor(c.env, [Number(saved.id)])).get(Number(saved.id)) ?? [], todayUtc()));
  } };
}

r.post('/terms/:uid/submit', async (c) => {
  const admin = await requireHqAdmin(c);
  try {
    const s = await step(c, admin, c.req.param('uid'), 'draft',
      `UPDATE referral_partner_terms SET status = 'submitted', submitted_by = ?, submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = ?`,
      [admin.id], 'referral_terms.submitted');
    if (s instanceof Response) return s;
    if (s.t.status !== 'draft') return refuse(c, 409, { code: 'terms_not_draft', message: 'Only a draft can be sent to HQ.' });
    const clash = await overlapping(c.env, Number(s.t.partner_id), s.t, todayUtc());
    if (clash) return refuse(c, 409, OVERLAP(clash.uid));
    return await s.run();
  } catch (e) { return unreadable(c, e); }
});

r.post('/terms/:uid/approve', async (c) => {
  const admin = await requireHqAdmin(c);
  // Elevation BEFORE the bar: a plain Admin is never asked for a code (O-TERMS A).
  if (!isSuperAdmin(admin)) return refuse(c, 403, { code: 'super_admin_required', message: 'Only the Super Admin approves a referral partner’s terms.' });
  await requireSuperAdminWriteBar(c);
  try {
    const s = await step(c, admin, c.req.param('uid'), 'submitted',
      `UPDATE referral_partner_terms SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = ?`,
      [admin.id], 'referral_terms.approved');
    if (s instanceof Response) return s;
    if (s.t.status !== 'submitted') return refuse(c, 409, { code: 'terms_not_submitted', message: 'Only terms sent to HQ can be approved.' });
    const clash = await overlapping(c.env, Number(s.t.partner_id), s.t, todayUtc());
    if (clash) return refuse(c, 409, OVERLAP(clash.uid));
    return await s.run();
  } catch (e) { return unreadable(c, e); }
});

/** The envelope input for these terms: their template, and the partner on record as the signer. */
function envelopeInput(t: any, b: any): Record<string, unknown> {
  return {
    template_slug: t.contract_slug, template_version: b?.template_version, recipient_email: t.partner_email, recipient_name: t.partner_name || t.partner_email,
    fields: b?.fields ?? {}, page_size: b?.page_size, cover: b?.cover, preview_sha256: b?.preview_sha256, provider: b?.provider,
  };
}

for (const op of ['preview', 'send'] as const) {
  r.post(`/terms/:uid/${op}`, async (c) => {
    const admin = await requireHqAdmin(c);
    const b = await c.req.json().catch(() => null) as any;
    let t: any;
    try { t = await termsByUid(c.env, c.req.param('uid')); } catch (e) { return unreadable(c, e); }
    if (!t) return refuse(c, 404, NOT_FOUND);
    if (t.status !== 'approved') return refuse(c, 409, { code: 'terms_not_approved', message: 'Only approved terms are sent for signature.' });
    if (!t.contract_slug) return refuse(c, 409, { code: 'terms_contract_missing', message: 'Name the contract template before sending these terms.' });
    const res = await envelopeHandler(op, envelopeInput(t, b))(c, admin as any);
    if (op === 'preview' || res.status !== 200) return res;
    const out = await res.clone().json().catch(() => null) as any;
    const envelopeId = Number(out?.envelope_id);
    if (!Number.isSafeInteger(envelopeId) || envelopeId <= 0) return res;
    const saved = await c.env.DB.prepare(
      `UPDATE referral_partner_terms SET status = 'sent', envelope_id = ?, sent_by = ?, sent_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND status = 'approved'`,
    ).bind(envelopeId, admin.id, t.id).run();
    if (!Number(saved.meta?.changes)) {
      return refuse(c, 409, { code: 'terms_changed', message: 'The envelope was sent, but these terms changed meanwhile. Check Agreements and the terms before sending again.' });
    }
    await logAdminAction(c.env, admin.id, admin.email, 'referral_terms.sent', { uid: t.uid, envelope_id: envelopeId });
    return c.json({ ...out, terms_uid: t.uid, state: 'sent' });
  });
}

r.post('/terms/:uid/end', async (c) => {
  const admin = await requireHqAdmin(c);
  const b = await c.req.json().catch(() => null) as any;
  const reason = typeof b?.reason === 'string' ? b.reason.trim() : '';
  if (reason.length < 10 || reason.length > NOTE_MAX) return refuse(c, 400, { code: 'reason_required', message: `Say why the terms end, in 10 to ${NOTE_MAX} characters.` });
  try {
    const t = await termsByUid(c.env, c.req.param('uid'));
    if (!t) return refuse(c, 404, NOT_FOUND);
    const state = effectiveState(t, todayUtc());
    if (state !== 'active' && state !== 'signed') return refuse(c, 409, { code: 'terms_not_active', message: 'Only signed terms, active or about to start, can be ended.' });
    const res = await c.env.DB.prepare(
      `UPDATE referral_partner_terms SET status = 'ended', ended_by = ?, ended_at = datetime('now'), end_reason = ?, updated_at = datetime('now')
        WHERE id = ? AND status IN ('signed', 'active')`,
    ).bind(admin.id, reason, t.id).run();
    if (!Number(res.meta?.changes)) return refuse(c, 409, { code: 'terms_changed', message: 'These terms changed while you were looking at them. Read them again.' });
    await logAdminAction(c.env, admin.id, admin.email, 'referral_terms.ended', { uid: t.uid });
    const saved = await termsByUid(c.env, t.uid);
    return c.json(presentTerms(saved, (await triggersFor(c.env, [Number(saved.id)])).get(Number(saved.id)) ?? [], todayUtc()));
  } catch (e) { return unreadable(c, e); }
});

/* ------------------------------------------------------------------ *
 * One partner
 * ------------------------------------------------------------------ */

const partnerId = (raw: string) => (/^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : null);

r.patch('/:userId', async (c) => {
  const admin = await requireHqAdmin(c);
  const userId = partnerId(c.req.param('userId'));
  if (userId == null) return refuse(c, 404, PARTNER_NOT_FOUND);
  const b = await c.req.json().catch(() => null) as any;
  const hasSeg = b && Object.prototype.hasOwnProperty.call(b, 'segment');
  const hasNote = b && Object.prototype.hasOwnProperty.call(b, 'note');
  if (!hasSeg && !hasNote) return refuse(c, 400, { code: 'invalid_request', message: 'Change the segment, the note, or both.' });
  if (hasSeg && !isSegment(b.segment)) return refuse(c, 400, { code: 'unknown_segment', message: 'Segment is event_organisers, venture_scouts or deal_makers.' });
  const note = hasNote ? textOrNull(b.note, NOTE_MAX) : null;
  if (note === 'bad') return refuse(c, 400, { code: 'invalid_request', message: `Keep the note to ${NOTE_MAX} characters.` });
  try {
    const row = await c.env.DB.prepare(
      `UPDATE referral_partners SET segment = CASE WHEN ? = 1 THEN ? ELSE segment END, note = CASE WHEN ? = 1 THEN ? ELSE note END,
         updated_at = datetime('now') WHERE user_id = ? RETURNING user_id, segment, note`,
    ).bind(hasSeg ? 1 : 0, hasSeg ? b.segment : null, hasNote ? 1 : 0, note, userId).first<any>();
    if (!row) return refuse(c, 404, PARTNER_NOT_FOUND);
    await logAdminAction(c.env, admin.id, admin.email, 'referral_partner.updated', { target_user_id: userId, ...(hasSeg ? { segment: b.segment } : {}) });
    return c.json({ ...row, segment_label: SEGMENT_LABEL[row.segment as keyof typeof SEGMENT_LABEL] });
  } catch (e) { return unreadable(c, e); }
});

r.get('/:userId/terms', async (c) => {
  await requireHqAdmin(c);
  const userId = partnerId(c.req.param('userId'));
  if (userId == null) return refuse(c, 404, PARTNER_NOT_FOUND);
  try {
    const partner = await c.env.DB.prepare('SELECT id FROM referral_partners WHERE user_id = ?').bind(userId).first<any>();
    if (!partner) return refuse(c, 404, PARTNER_NOT_FOUND);
    const rows = await c.env.DB.prepare(`SELECT t.*, p.user_id AS partner_user_id, u.name AS partner_name
      FROM referral_partner_terms t JOIN referral_partners p ON p.id = t.partner_id JOIN users u ON u.id = p.user_id
      WHERE t.partner_id = ? ORDER BY t.created_at DESC, t.id DESC`).bind(partner.id).all<any>();
    const list = rows.results || [];
    const triggers = await triggersFor(c.env, list.map((t) => Number(t.id)));
    const today = todayUtc();
    return c.json({ items: list.map((t) => presentTerms(t, triggers.get(Number(t.id)) ?? [], today)), total: list.length });
  } catch (e) { return unreadable(c, e); }
});

export default r;
