/**
 * D959 (#2792, Programs part 6) — Investor cohort access (migration 564).
 *
 * An admin gives a verified investor access to one Lab cohort
 * (`routes/admin_investor_cohorts.ts`). The investor reads that cohort's
 * ventures once they have signed the cohort NDA, and asks a founder for an
 * introduction; the founder is told, can hide from one investor, and accepts
 * or declines once (`routes/investor_cohorts.ts`).
 *
 * THE OWNER'S ANSWERS (D953 §5, given on #2792 on 2026-10-26):
 *   - O-VER A. "Verified" is D653's rule: role investor, an active account and
 *     approved KYC (`verifiedInvestor`, services/roundCallPolicy.ts). It is
 *     checked again on every read and every list, never only at the grant. An
 *     investor who stops being verified keeps the grant, reads nothing, and
 *     the grant reads `waits_for_verification`.
 *   - O-NDA B. One cohort NDA per grant, from the HQ template
 *     `investor_cohort_nda_v1`, signed by the investor. Until it is signed the
 *     grant reads `waits_for_nda` and the investor reads nothing. No such
 *     template is published yet: its wording is the owner's or counsel's.
 *   - O-INT B. An intro request lives in 564, apart from the paid
 *     introductions quota; the founder accepts or declines.
 *   - O-SEE A. Each venture's summary and weekly progress. Never a founder's
 *     email address. Pitch deck and Demo Day have no store to read, so a grant
 *     asking for them is refused `scope_unavailable`.
 *
 * COHORT MEMBERSHIP is `company_week_status`, as the mentor reads have it
 * (routes/advisors.ts), until O-FND names one definition. A founder with no
 * week row yet (Week 1 not opened) is not in the cohort here (map F2).
 *
 * WHAT IS NOT COPIED FROM THE MENTOR PATTERN (map F1, F5, F6): the sweep checks
 * the investor's account state and the verified rule, not the role alone; a
 * grant is one row per grant, so an ended grant keeps its dates; a second hide
 * keeps the first hide's date.
 */
import type { Env } from '../types';
import { notify } from './notify';
import { verifiedInvestor } from './roundCallPolicy';

/** The HQ template the cohort NDA is sent from (O-NDA B). Its wording is not supplied yet. */
export const COHORT_NDA_SLUG = 'investor_cohort_nda_v1';
/** The e-sign document type of a cohort NDA envelope; `routes/esign.ts` runs the completion hook on it. */
export const COHORT_NDA_DOC_TYPE = 'investor_cohort_nda';

/** What a grant may open (O-SEE A). */
export const READABLE_SCOPES = ['summary', 'weekly_progress'] as const;
/** What PG11d offers that has no store to read yet. */
export const UNAVAILABLE_SCOPES = ['pitch_deck', 'demo_day'] as const;
export type Scope = typeof READABLE_SCOPES[number];

export const GRANT_STATES = ['active', 'ended', 'waits_for_verification', 'waits_for_nda'] as const;
export type GrantState = typeof GRANT_STATES[number];
export const NDA_STATES = ['signed', 'sent', 'not_sent'] as const;
export type NdaState = typeof NDA_STATES[number];

export const NOTICE_TYPE = 'investor_cohort_access';
export const NOTICE_LINK = '/account/security-privacy';
export const NOTE_MAX = 1000;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 2026 cohort", or "Spin-Out Lab cohort" when the cycle's month is not readable. */
export function cohortLabel(year: number | null | undefined, month: number | null | undefined): string {
  return year && month && month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${year} cohort` : 'Spin-Out Lab cohort';
}

/**
 * "This user is a verified investor now" on the alias `u` (O-VER A), the same
 * rule as `verifiedInvestor`. Every query here and in the two route files
 * writes it out as this literal text, never interpolated (no new `${…}` in a
 * prepare); `investor_cohort_access_d959.test.ts` checks each site carries it.
 */
export const VERIFIED_SQL = "(lower(u.role) = 'investor' AND u.is_active = 1 AND u.kyc_status = 'approved')";

/** O-VER A, on a user row. */
export function isVerifiedInvestor(u: { role?: string | null; is_active?: number | boolean | null; kyc_status?: string | null } | null | undefined): boolean {
  if (!u) return false;
  return verifiedInvestor({ role: String(u.role ?? '').toLowerCase(), is_active: Number(u.is_active ?? 0), kyc_status: u.kyc_status ?? null });
}

/** Today's UTC date, YYYY-MM-DD. */
export const todayUtc = () => new Date().toISOString().slice(0, 10);

/** A real calendar date, YYYY-MM-DD. */
export function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
}

/** PG11d's End date: a real date, today or later. It is the last day of access. */
export const validEndDate = (v: unknown, today: string): v is string => isDate(v) && v >= today;

/**
 * The scope a grant asks for: the readable ones, or the code to refuse with.
 * Absent means both readable scopes. Pitch deck and Demo Day answer
 * `scope_unavailable`; an unknown word or an empty list is `invalid_scope`.
 */
export function parseScope(raw: unknown): { ok: true; scope: Scope[] } | { ok: false; code: 'scope_unavailable' | 'invalid_scope'; asked?: string[] } {
  if (raw === undefined || raw === null) return { ok: true, scope: [...READABLE_SCOPES] };
  if (!Array.isArray(raw) || !raw.length || raw.some((x) => typeof x !== 'string')) return { ok: false, code: 'invalid_scope' };
  const asked = [...new Set(raw as string[])];
  const unavailable = asked.filter((x) => (UNAVAILABLE_SCOPES as readonly string[]).includes(x));
  if (unavailable.length) return { ok: false, code: 'scope_unavailable', asked: unavailable };
  if (asked.some((x) => !(READABLE_SCOPES as readonly string[]).includes(x))) return { ok: false, code: 'invalid_scope' };
  return { ok: true, scope: READABLE_SCOPES.filter((x) => asked.includes(x)) };
}

export function scopeOf(raw: string | null | undefined): Scope[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? READABLE_SCOPES.filter((x) => v.includes(x)) : [];
  } catch { return []; }
}

export type GrantRow = {
  id: number; uid: string; investor_user_id: number; cohort_cycle_id: number;
  granted_by_admin_id: number | null; granted_at: string; ends_at: string;
  ended_at: string | null; ended_by_admin_id: number | null; end_reason: string | null;
  note: string | null; scope_json: string; nda_template_slug: string;
  nda_envelope_uuid: string | null; nda_sent_at: string | null; nda_signed_at: string | null;
};

export function ndaStateOf(g: Pick<GrantRow, 'nda_signed_at' | 'nda_envelope_uuid'>): NdaState {
  return g.nda_signed_at ? 'signed' : g.nda_envelope_uuid ? 'sent' : 'not_sent';
}

/** A grant is over when it was ended, or its last day has passed. */
export const isOver = (g: Pick<GrantRow, 'ended_at' | 'ends_at'>, today: string) => Boolean(g.ended_at) || g.ends_at < today;

/** The access state PG11 draws, from the grant and whether the investor is verified now. */
export function grantStateOf(g: Pick<GrantRow, 'ended_at' | 'ends_at' | 'nda_signed_at'>, verifiedNow: boolean, today: string): GrantState {
  if (isOver(g, today)) return 'ended';
  if (!verifiedNow) return 'waits_for_verification';
  if (!g.nda_signed_at) return 'waits_for_nda';
  return 'active';
}

/** The investor's open grant on a cycle (not ended, last day not passed), or null. */
export async function openGrant(env: Env, investorUserId: number, cycleId: number, today: string): Promise<GrantRow | null> {
  return env.DB.prepare(
    `SELECT g.id, g.uid, g.investor_user_id, g.cohort_cycle_id, g.granted_by_admin_id, g.granted_at,
            g.ends_at, g.ended_at, g.ended_by_admin_id, g.end_reason, g.note, g.scope_json, g.nda_template_slug,
            g.nda_envelope_uuid, g.nda_sent_at, g.nda_signed_at FROM investor_cohort_access g
      WHERE g.investor_user_id = ? AND g.cohort_cycle_id = ? AND g.ended_at IS NULL AND g.ends_at >= ?`,
  ).bind(investorUserId, cycleId, today).first<GrantRow>();
}

/** Founders who have hidden from this investor (a hide in force). */
export async function hiddenFrom(env: Env, investorUserId: number): Promise<Set<number>> {
  const res = await env.DB.prepare(
    'SELECT founder_user_id FROM investor_cohort_optouts WHERE investor_user_id = ? AND withdrawn_at IS NULL',
  ).bind(investorUserId).all<{ founder_user_id: number }>();
  return new Set((res.results || []).map((r) => Number(r.founder_user_id)));
}

/** Close every open grant whose last day has passed, as `expired`. Returns how many. */
export async function expireGrants(env: Env, today: string): Promise<number> {
  const res = await env.DB.prepare(
    `UPDATE investor_cohort_access SET ended_at = ?, end_reason = 'expired'
      WHERE ended_at IS NULL AND ends_at < ?`,
  ).bind(`${today} 00:00:00`, today).run();
  return Number(res.meta?.changes) || 0;
}

const who = (name: string | null | undefined, firm: string | null | undefined) => {
  const n = name?.trim() || 'An investor';
  const f = firm?.trim();
  return f ? `${n} (${f})` : n;
};

export interface SyncScope {
  grantId?: number | null;
  founderUserId?: number | null;
  today?: string;
  /** Rows considered per kind in one call (default 500). */
  limit?: number;
}

/**
 * Send every start and end notice owed in `scope` and not yet sent. Grants
 * past their last day are closed first, so their end notices go in the same
 * pass. A start is owed only while the investor is verified now (O-VER A) and
 * the founder has not hidden from them.
 */
export async function syncInvestorCohortNotices(env: Env, scope: SyncScope = {}): Promise<{ started: number; ended: number; expired: number }> {
  const today = scope.today ?? todayUtc();
  const grant = scope.grantId ?? null;
  const founder = scope.founderUserId ?? null;
  const limit = Math.max(1, Math.min(2000, Math.floor(scope.limit ?? 500)));
  const expired = await expireGrants(env, today);
  let started = 0;
  let ended = 0;

  const owedStart = await env.DB.prepare(
    `SELECT g.id AS grant_id, g.investor_user_id, u.name AS investor_name, p.firm_name AS firm,
            c.year, c.month, w.user_id AS founder_user_id
       FROM investor_cohort_access g
       JOIN users u ON u.id = g.investor_user_id
       LEFT JOIN investor_profiles p ON p.user_id = g.investor_user_id
       LEFT JOIN cohort_cycles c ON c.id = g.cohort_cycle_id
       JOIN (SELECT DISTINCT user_id, cohort_cycle_id FROM company_week_status) w ON w.cohort_cycle_id = g.cohort_cycle_id
      WHERE g.ended_at IS NULL AND g.ends_at >= ?1 AND (lower(u.role) = 'investor' AND u.is_active = 1 AND u.kyc_status = 'approved')
        AND (?2 IS NULL OR g.id = ?2)
        AND (?3 IS NULL OR w.user_id = ?3)
        AND NOT EXISTS (SELECT 1 FROM investor_cohort_optouts o
                         WHERE o.founder_user_id = w.user_id AND o.investor_user_id = g.investor_user_id AND o.withdrawn_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM investor_cohort_notices n
                         WHERE n.grant_id = g.id AND n.founder_user_id = w.user_id AND n.kind = 'started')
      ORDER BY g.id, w.user_id
      LIMIT ?4`,
  ).bind(today, grant, founder, limit).all<{
    grant_id: number; investor_user_id: number; investor_name: string | null; firm: string | null;
    year: number | null; month: number | null; founder_user_id: number;
  }>();
  for (const r of owedStart.results || []) {
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO investor_cohort_notices (grant_id, founder_user_id, kind) VALUES (?, ?, 'started')`,
    ).bind(r.grant_id, r.founder_user_id).run();
    if (!(Number(ins.meta?.changes) > 0)) continue;
    started += 1;
    const name = who(r.investor_name, r.firm);
    await notify(env, {
      userId: r.founder_user_id,
      type: NOTICE_TYPE,
      category: 'privacy',
      title: `${name} can see your venture in your Spin-Out Lab cohort`,
      body: `Axal gave ${name} access to the ${cohortLabel(r.year, r.month)}. Once they sign the cohort NDA, they can see your venture's summary and weekly progress, never your email address. You can hide yourself from them in Account → Security & Privacy.`,
      link: NOTICE_LINK,
      payload: { kind: 'started', grant_id: r.grant_id, investor_user_id: r.investor_user_id },
    });
  }

  // A grant past its last day was closed above, so an ended grant is one with `ended_at`.
  const owedEnd = await env.DB.prepare(
    `SELECT n.grant_id, n.founder_user_id, g.investor_user_id, u.name AS investor_name, p.firm_name AS firm, c.year, c.month
       FROM investor_cohort_notices n
       JOIN investor_cohort_access g ON g.id = n.grant_id
       LEFT JOIN users u ON u.id = g.investor_user_id
       LEFT JOIN investor_profiles p ON p.user_id = g.investor_user_id
       LEFT JOIN cohort_cycles c ON c.id = g.cohort_cycle_id
      WHERE n.kind = 'started' AND g.ended_at IS NOT NULL
        AND (?1 IS NULL OR g.id = ?1)
        AND (?2 IS NULL OR n.founder_user_id = ?2)
        AND NOT EXISTS (SELECT 1 FROM investor_cohort_notices e
                         WHERE e.grant_id = n.grant_id AND e.founder_user_id = n.founder_user_id AND e.kind = 'ended')
      ORDER BY n.grant_id, n.founder_user_id
      LIMIT ?3`,
  ).bind(grant, founder, limit).all<{
    grant_id: number; founder_user_id: number; investor_user_id: number; investor_name: string | null;
    firm: string | null; year: number | null; month: number | null;
  }>();
  for (const r of owedEnd.results || []) {
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO investor_cohort_notices (grant_id, founder_user_id, kind) VALUES (?, ?, 'ended')`,
    ).bind(r.grant_id, r.founder_user_id).run();
    if (!(Number(ins.meta?.changes) > 0)) continue;
    ended += 1;
    const name = who(r.investor_name, r.firm);
    await notify(env, {
      userId: r.founder_user_id,
      type: NOTICE_TYPE,
      category: 'privacy',
      title: `${name} can no longer see your venture in your Spin-Out Lab cohort`,
      body: `${name}'s access to the ${cohortLabel(r.year, r.month)} has ended.`,
      link: NOTICE_LINK,
      payload: { kind: 'ended', grant_id: r.grant_id, investor_user_id: r.investor_user_id },
    });
  }
  return { started, ended, expired };
}

export interface FounderInvestorAccess {
  investor_user_id: number;
  investor_name: string | null;
  firm: string | null;
  cohort_cycle_id: number;
  cohort_label: string;
  granted_at: string;
  ends_at: string;
  ended_at: string | null;
  /** True when this investor can read the founder's venture right now. */
  can_see: boolean;
  /** The founder's hide, when one is in force. */
  hidden_at: string | null;
}

/** Every investor grant on a cohort the founder is in, open ones first. */
export async function founderInvestorAccess(env: Env, founderUserId: number, today: string = todayUtc()): Promise<FounderInvestorAccess[]> {
  const res = await env.DB.prepare(
    `SELECT g.investor_user_id, u.name AS investor_name, p.firm_name AS firm, g.cohort_cycle_id, c.year, c.month,
            g.granted_at, g.ends_at, g.ended_at, g.nda_signed_at,
            CASE WHEN (lower(u.role) = 'investor' AND u.is_active = 1 AND u.kyc_status = 'approved') THEN 1 ELSE 0 END AS verified,
            (SELECT o.opted_out_at FROM investor_cohort_optouts o
              WHERE o.founder_user_id = ?1 AND o.investor_user_id = g.investor_user_id AND o.withdrawn_at IS NULL) AS hidden_at
       FROM investor_cohort_access g
       LEFT JOIN users u ON u.id = g.investor_user_id
       LEFT JOIN investor_profiles p ON p.user_id = g.investor_user_id
       LEFT JOIN cohort_cycles c ON c.id = g.cohort_cycle_id
      WHERE g.cohort_cycle_id IN (SELECT DISTINCT cohort_cycle_id FROM company_week_status WHERE user_id = ?1)
      ORDER BY CASE WHEN g.ended_at IS NULL AND g.ends_at >= ?2 THEN 0 ELSE 1 END, g.granted_at DESC, g.id DESC
      LIMIT 100`,
  ).bind(founderUserId, today).all<any>();
  return (res.results || []).map((r: any) => {
    const state = grantStateOf(r, Number(r.verified) === 1, today);
    return {
      investor_user_id: Number(r.investor_user_id),
      investor_name: r.investor_name ?? null,
      firm: r.firm ?? null,
      cohort_cycle_id: Number(r.cohort_cycle_id),
      cohort_label: cohortLabel(r.year, r.month),
      granted_at: r.granted_at,
      ends_at: r.ends_at,
      ended_at: r.ended_at ?? (r.ends_at < today ? r.ends_at : null),
      can_see: state === 'active' && !r.hidden_at,
      hidden_at: r.hidden_at ?? null,
    };
  });
}

/**
 * The founder hides from one investor, or shows again. Only an investor who
 * holds or held a grant on one of the founder's cohorts can be named. Hiding
 * while hidden changes nothing and keeps the first date. Returns false when
 * the investor is not one of those.
 */
export async function setFounderVisibility(env: Env, founderUserId: number, investorUserId: number, visible: boolean): Promise<boolean> {
  const known = await env.DB.prepare(
    `SELECT 1 AS ok FROM investor_cohort_access
      WHERE investor_user_id = ?1
        AND cohort_cycle_id IN (SELECT DISTINCT cohort_cycle_id FROM company_week_status WHERE user_id = ?2)
      LIMIT 1`,
  ).bind(investorUserId, founderUserId).first<{ ok: number }>();
  if (!known) return false;
  if (visible) {
    await env.DB.prepare(
      `UPDATE investor_cohort_optouts SET withdrawn_at = datetime('now')
        WHERE founder_user_id = ? AND investor_user_id = ? AND withdrawn_at IS NULL`,
    ).bind(founderUserId, investorUserId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO investor_cohort_optouts (founder_user_id, investor_user_id) VALUES (?, ?)
       ON CONFLICT (founder_user_id, investor_user_id) WHERE withdrawn_at IS NULL DO NOTHING`,
    ).bind(founderUserId, investorUserId).run();
  }
  return true;
}

/**
 * The e-sign completion hook for a cohort NDA (`routes/esign.ts`): the grant
 * that names this envelope records its signature once. A second completion
 * changes nothing.
 */
export async function onCohortNdaEnvelopeCompleted(env: Env, envelopeUuid: string): Promise<{ changed: boolean }> {
  const res = await env.DB.prepare(
    `UPDATE investor_cohort_access SET nda_signed_at = datetime('now')
      WHERE nda_envelope_uuid = ? AND nda_signed_at IS NULL`,
  ).bind(envelopeUuid).run();
  return { changed: Number(res.meta?.changes) > 0 };
}
