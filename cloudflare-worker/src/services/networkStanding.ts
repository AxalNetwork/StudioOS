/**
 * D976 / #2762 — one person's standing in the advisor and partner network
 * (Advisors & Partners, part 4 of #2369).
 *
 * A person is a member account (`users.id`) that is an advisor (role
 * `advisor`, or an `advisors` row) or an operating partner (role `partner`).
 *
 * THE STAGE (AP3), derived where it can be and stored where it cannot:
 *   · Ended      — the account is inactive; or the advisor's own profile is
 *                  marked inactive; or the partner's firm is `inactive`.
 *   · Paused     — an admin paused the person (migration 552), with a reason.
 *   · Onboarding — an advisor with no advisor profile yet; a partner account
 *                  not attached to a firm.
 *   · Active     — otherwise.
 *   · Invited    — a partner invitation with no account behind it yet. It
 *                  belongs to no account, so this read never returns it;
 *                  advisors have no invitation store, so for them it is not
 *                  recorded (D976.md).
 *
 * Each block answers alone in D893's shape (`decisions/D893.md`): a failed
 * read is `{ available: false, unreadable: true, reason }`, a figure no store
 * holds is `{ recorded: false, reason }`, never a zero. Engagements are counts
 * per lane: a client's name stays the advisor's.
 */
import type { Env } from '../types';
import { derivePayoutState } from './advisorMoney';

type Unreadable = { available: false; unreadable: true; reason: string };
type NotRecorded = { recorded: false; reason: string };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const SESSION_WINDOW_DAYS = 90;
export const OPEN_SLOT_DAYS = 14;
export const REASON_MAX = 1000;
export const ENGAGEMENT_LANES = ['drafting', 'proposed', 'signed', 'renewal_due', 'ended'] as const;

export type NetworkKind = 'advisor' | 'operating_partner';
export type NetworkStage = 'onboarding' | 'active' | 'paused' | 'ended';

const unreadable = (what: string, e: unknown): Unreadable => {
  console.error('[network-standing]', what, typeof e === 'string' ? e : (e as Error)?.message);
  return {
    available: false,
    unreadable: true,
    reason: `${what} could not be read on this database. That is not the same as none.`,
  };
};

async function block<T>(what: string, read: () => Promise<T>): Promise<({ available: true } & T) | Unreadable | NotRecorded> {
  try {
    const out: any = await read();
    if (out && out.recorded === false) return out as NotRecorded;
    return { available: true, ...out };
  } catch (e) {
    return unreadable(what, e);
  }
}

async function all(env: Env, sql: string, binds: unknown[] = []): Promise<any[]> {
  const r: any = await env.DB.prepare(sql).bind(...binds).all();
  if ((r && 'success' in r && !r.success) || !Array.isArray(r?.results)) throw new Error('rows were not returned');
  return r.results;
}

/** D1's zone-less stamps are UTC (`ui/parseStamp.js`); ISO stamps keep their zone. */
export function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return Number.NaN;
  const v = value.trim();
  return Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(v) ? v : v.replace(' ', 'T') + 'Z');
}

export interface PersonRow {
  user_id: number;
  role: string | null;
  user_active: number | null;
  partner_id: number | null;
  kyc_status: string | null;
  advisor_id: number | null;
  advisor_active: number | null;
  firm_status: string | null;
  paused_at: string | null;
  paused_reason: string | null;
  resumed_at: string | null;
  resume_reason: string | null;
  directory_hidden_at: string | null;
}

/** The person's kind, or null when the account is in neither network. */
export function kindOf(p: Pick<PersonRow, 'role' | 'advisor_id'>): NetworkKind | null {
  if (p.role === 'advisor' || p.advisor_id != null) return 'advisor';
  if (p.role === 'partner') return 'operating_partner';
  return null;
}

/** D976 §1: the stage, in this order. */
export function stageOf(p: PersonRow): NetworkStage {
  const kind = kindOf(p);
  if (p.user_active != null && Number(p.user_active) === 0) return 'ended';
  if (kind === 'advisor' && p.advisor_id != null && Number(p.advisor_active) === 0) return 'ended';
  if (kind === 'operating_partner' && p.partner_id != null && p.firm_status === 'inactive') return 'ended';
  if (p.paused_at) return 'paused';
  if (kind === 'advisor' && p.advisor_id == null) return 'onboarding';
  if (kind === 'operating_partner' && p.partner_id == null) return 'onboarding';
  return 'active';
}

export async function loadPerson(env: Env, userId: number): Promise<PersonRow | null> {
  const r: any = await env.DB.prepare(
    `SELECT u.id AS user_id, u.role, u.is_active AS user_active, u.partner_id, u.kyc_status,
            v.id AS advisor_id, v.is_active AS advisor_active, p.status AS firm_status,
            s.paused_at, s.paused_reason, s.resumed_at, s.resume_reason, s.directory_hidden_at
       FROM users u
       LEFT JOIN advisors v ON v.user_id = u.id
       LEFT JOIN partners p ON p.id = u.partner_id
       LEFT JOIN network_member_states s ON s.user_id = u.id
      WHERE u.id = ?`,
  ).bind(userId).first();
  return r ? (r as PersonRow) : null;
}

/** What a pause does to this person, said back so the dialog says only what is true (AP9c). */
export function pauseEffects(p: PersonRow): string[] {
  if (p.advisor_id == null) return [];
  return ['advisor_bookings_stop', 'advisor_directory_hidden', 'lab_office_hours_hidden'];
}

// ── sessions ───────────────────────────────────────────────────────────────

function tallySessions(rows: any[], now: number) {
  const since = now - SESSION_WINDOW_DAYS * DAY;
  const counts = { completed: 0, upcoming: 0, cancelled: 0, no_show: 0, not_marked: 0 };
  for (const r of rows) {
    const at = timestamp(r.starts_at);
    if (!Number.isFinite(at)) continue;
    const open = r.status === 'pending' || r.status === 'confirmed';
    if (open && at >= now) { counts.upcoming++; continue; }
    if (at < since || at >= now) continue;
    if (r.status === 'completed') counts.completed++;
    else if (r.status === 'cancelled') counts.cancelled++;
    else if (r.status === 'no_show') counts.no_show++;
    // Held and never marked: not counted as completed, and not as a no-show.
    else if (open) counts.not_marked++;
  }
  return counts;
}

function openSlots(slots: any[], now: number) {
  const until = now + OPEN_SLOT_DAYS * DAY;
  return slots.filter((s) => {
    const at = timestamp(s.starts_at);
    return at >= now && at <= until && Number(s.taken || 0) < Number(s.capacity || 0);
  }).length;
}

// ── GET /api/admin/network/people/:userId ──────────────────────────────────

export async function readStanding(env: Env, p: PersonRow, now = Date.now()) {
  const kind = kindOf(p)!;
  const advisorId = p.advisor_id;
  const firmId = p.partner_id;
  const since = new Date(now - (SESSION_WINDOW_DAYS + 1) * DAY).toISOString().slice(0, 10);

  const noFirm: NotRecorded = { recorded: false, reason: 'Not attached to a firm, so there are no office hours to count.' };
  const noProfile: NotRecorded = { recorded: false, reason: 'No advisor profile yet, so there is nothing to count.' };

  const [ratings, sessions, engagements, payout, agreement, lab_host] = await Promise.all([
    block('The ratings', async () => {
      if (kind === 'advisor') {
        if (advisorId == null) return noProfile;
        const rows = await all(env,
          `SELECT r.rating FROM advisor_reviews r JOIN advisor_bookings b ON b.id = r.booking_id
            WHERE b.advisor_id = ? AND r.reviewer_role = 'founder'`, [advisorId]);
        return { scope: 'advisor', ...ratingSummary(rows) };
      }
      if (firmId == null) return noFirm;
      const rows = await all(env, `SELECT rating FROM partner_booking_ratings WHERE partner_id = ?`, [firmId]);
      return { scope: 'firm', ...ratingSummary(rows) };
    }),
    block('The sessions', async () => {
      if (kind === 'advisor') {
        if (advisorId == null) return noProfile;
        const rows = await all(env,
          `SELECT b.status, s.starts_at FROM advisor_bookings b JOIN advisor_office_hour_slots s ON s.id = b.slot_id
            WHERE b.advisor_id = ? AND s.starts_at >= ?`, [advisorId, since]);
        const slots = await all(env,
          `SELECT s.starts_at, s.capacity,
                  (SELECT COUNT(*) FROM advisor_bookings b WHERE b.slot_id = s.id AND b.status IN ('pending','confirmed','completed')) AS taken
             FROM advisor_office_hour_slots s WHERE s.advisor_id = ? AND s.is_cancelled = 0 AND s.starts_at >= ?`, [advisorId, since]);
        return { scope: 'advisor', window_days: SESSION_WINDOW_DAYS, counts: tallySessions(rows, now), open_slots_14d: openSlots(slots, now) };
      }
      if (firmId == null) return noFirm;
      const rows = await all(env,
        `SELECT b.status, s.starts_at FROM partner_bookings b JOIN partner_office_hour_slots s ON s.id = b.slot_id
          WHERE b.partner_id = ? AND s.starts_at >= ?`, [firmId, since]);
      const slots = await all(env,
        `SELECT s.starts_at, s.capacity,
                (SELECT COUNT(*) FROM partner_bookings b WHERE b.slot_id = s.id AND b.status IN ('pending','confirmed','completed')) AS taken
           FROM partner_office_hour_slots s WHERE s.partner_id = ? AND s.is_cancelled = 0 AND s.starts_at >= ?`, [firmId, since]);
      return { scope: 'firm', window_days: SESSION_WINDOW_DAYS, counts: tallySessions(rows, now), open_slots_14d: openSlots(slots, now) };
    }),
    block('The engagements', async () => {
      if (kind !== 'advisor') return { recorded: false, reason: 'Engagements with founders are an advisor’s store; a partner’s work is its firm’s deals.' } as NotRecorded;
      if (advisorId == null) return noProfile;
      const rows = await all(env, `SELECT lane, COUNT(*) AS n FROM advisor_engagements WHERE advisor_id = ? GROUP BY lane`, [advisorId]);
      const by_lane = Object.fromEntries(ENGAGEMENT_LANES.map((l) => [l, 0])) as Record<(typeof ENGAGEMENT_LANES)[number], number>;
      let other = 0;
      for (const r of rows) {
        if ((ENGAGEMENT_LANES as readonly string[]).includes(r.lane)) by_lane[r.lane as (typeof ENGAGEMENT_LANES)[number]] += Number(r.n);
        else other += Number(r.n);
      }
      return { by_lane, other };
    }),
    block('The payout account', async () => {
      if (kind !== 'advisor') return { recorded: false, reason: 'A partner is paid through its firm’s settlements, read on Firms.' } as NotRecorded;
      if (advisorId == null) return noProfile;
      const rows = await all(env,
        `SELECT charges_enabled, payouts_enabled, blocked_reason, last_checked_at FROM advisor_payout_accounts WHERE advisor_id = ?`, [advisorId]);
      if (!rows.length) return { on_file: false, ready: false, state: null, last_checked_at: null };
      const state = derivePayoutState(rows[0]);
      return { on_file: true, ready: state === 'verified', state, last_checked_at: rows[0].last_checked_at ?? null };
    }),
    block('The studio agreement', async () => {
      if (kind === 'advisor') return { recorded: false, reason: 'No store records a studio agreement with an advisor yet.' } as NotRecorded;
      const rows = await all(env,
        `SELECT signed_at FROM partner_invitations WHERE resulting_user_id = ? AND signed_at IS NOT NULL
          ORDER BY signed_at DESC LIMIT 1`, [p.user_id]);
      return { on_file: rows.length > 0, signed_at: rows[0]?.signed_at ?? null, source: 'partner_invitation' };
    }),
    block('The Lab host status', async () => {
      const hostKind = kind === 'advisor' ? 'advisor' : 'partner';
      const hostId = kind === 'advisor' ? advisorId : firmId;
      if (hostId == null) return { status: null, decided_at: null };
      const rows = await all(env,
        `SELECT status, reviewed_at FROM lab_host_applications WHERE host_kind = ? AND host_id = ?
          ORDER BY id DESC LIMIT 1`, [hostKind, hostId]);
      return { scope: kind === 'advisor' ? 'advisor' : 'firm', status: rows[0]?.status ?? null, decided_at: rows[0]?.reviewed_at ?? null };
    }),
  ]);

  return {
    user_id: p.user_id,
    kind,
    stage: stageOf(p),
    pause: {
      paused: !!p.paused_at,
      paused_at: p.paused_at ?? null,
      reason: p.paused_reason ?? null,
      last_resumed_at: p.resumed_at ?? null,
      last_resume_reason: p.resume_reason ?? null,
      effects: pauseEffects(p),
    },
    directory: kind === 'advisor'
      ? { listed: advisorId != null && Number(p.advisor_active) === 1 && !p.paused_at && !p.directory_hidden_at,
          hidden_by_admin: !!p.directory_hidden_at, hidden_at: p.directory_hidden_at ?? null }
      : { recorded: false, reason: 'A partner is listed through its firm, switched on Firms.' } as NotRecorded,
    kyc_status: p.kyc_status ?? null,
    ratings, sessions, engagements, payout, agreement, lab_host,
  };
}

function ratingSummary(rows: any[]) {
  const by_score = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<number, number>;
  let sum = 0, n = 0;
  for (const r of rows) {
    const v = Number(r.rating);
    if (!Number.isInteger(v) || v < 1 || v > 5) continue;
    by_score[v]++; sum += v; n++;
  }
  // No ratings is "No ratings yet", never an average of zero.
  return { count: n, average: n ? Math.round((sum / n) * 10) / 10 : null, by_score };
}
