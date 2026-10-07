/**
 * D486 — H15's ACTIVATION FUNNEL, READ ONCE FOR BOTH TIERS.
 *
 * H15 drew "invited, signed in, agreement signed, active in week two" as Not
 * recorded: nothing defined whose funnel it was. D486 settles it (#1025,
 * option A): accounts are grouped by the WEEK THEY WERE CREATED
 * (`users.created_at`, UTC Monday weeks, the H15 chart's own axis), and each
 * step is an event a database records:
 *
 *   signed in        an `activity_logs` row whose action is a sign-in
 *                    (`user_login…`: password, recovery code, magic link,
 *                    Google, passkey, SMS — every route that writes one).
 *   terms accepted   a `legal_acceptances` row for the current Terms key
 *                    (`TOS_KEY`; migration 245 says the key carries the version
 *                    and there is no other "current terms" marker).
 *   active week two  any `activity_logs` row from day 8 to day 14 after the
 *                    account was created, measured per account, not per week.
 *
 * NO "INVITED" STEP. Most accounts sign up without an invitation, so an
 * "invited" first step would undercount every step after it. Instead the
 * accounts that came from an accepted invitation are COUNTED BESIDE the funnel
 * and named so. An invitation names its account by id where its table records
 * one (`company_invitations` and `project_member_invitations`
 * `accepted_by_user_id`, `partner_invitations.resulting_user_id`), and by its
 * email where it does not (`branch_invitations`, whose accept flow matches the
 * email exactly, migration 263).
 *
 * WHAT TRAVELS: counts per cohort week. No account id, email or name leaves
 * the database that holds it, so a branch can answer HQ's `activation()` RPC
 * with this read and HQ can add the counts across branches: each account lives
 * on exactly one database, so the lines never count one account twice.
 *
 * EACH STEP IS ITS OWN READ, so a store that cannot be read costs only its
 * own step: the cohort sizes and sign-ins (users, activity_logs) are the
 * funnel and failing them fails it; terms and invitations fail alone, with
 * their reason.
 *
 * A COHORT WHOSE SECOND WEEK HAS NOT ENDED has no week-two figure: an account
 * created on the Sunday of a cohort week reaches its day 14 three weeks after
 * the week began, so until then the count would only be a floor.
 */
import type { Env } from '../types';
import { weekAxis } from './activeAccounts';

/** How many creation weeks the funnel shows, the current one included. */
export const ACTIVATION_WEEKS = 8;

/** The Terms of Service obligation key (`services/trust.ts`; migration 245). */
export const TOS_KEY = 'tos_v1';

const DAY_MS = 86_400_000;

export type ActivationCohort = {
  /** The Monday the creation week starts, `YYYY-MM-DD`. */
  week: string;
  created: number;
  signed_in: number;
  /** `null` when `legal_acceptances` could not be read. */
  terms_accepted: number | null;
  /** `null` while the cohort's second week is still open, or when unreadable. */
  active_week_two: number | null;
  week_two_open: boolean;
  /** Accounts that came from an accepted invitation; `null` when unreadable. */
  invited: number | null;
};

export type StepState = { available: true } | { available: false; unreadable: true; reason: string };

export type ActivationRead =
  | {
    available: true;
    weeks: string[];
    cohorts: ActivationCohort[];
    steps: { terms_accepted: StepState; invited: StepState };
  }
  | { available: false; unreadable: true; reason: string };

const msOf = (sqlTime: string) => Date.parse(`${String(sqlTime).replace(' ', 'T').slice(0, 19)}Z`);

/** Which creation week (Monday) an account belongs to, or null outside the axis. Pure. */
export function cohortWeekOf(createdAt: string, weeks: string[]): string | null {
  const t = msOf(createdAt);
  if (!Number.isFinite(t)) return null;
  for (let i = weeks.length - 1; i >= 0; i--) {
    const start = Date.parse(`${weeks[i]}T00:00:00Z`);
    if (t >= start) return t < start + 7 * DAY_MS ? weeks[i] : null;
  }
  return null;
}

/** Has every account in the cohort week reached day 14? Pure. */
export function weekTwoClosed(week: string, nowMs: number): boolean {
  return Date.parse(`${week}T00:00:00Z`) + 21 * DAY_MS <= nowMs;
}

type AccountRow = { id: number; created_at: string; signed_in: number; active_w2: number };

/** Fold the per-account rows into cohort counts. Pure; nothing per account survives it. */
export function foldCohorts(
  weeks: string[],
  rows: AccountRow[],
  tos: Set<number> | null,
  invited: Set<number> | null,
  nowMs: number,
): ActivationCohort[] {
  const by = new Map<string, ActivationCohort>(weeks.map((w) => {
    const open = !weekTwoClosed(w, nowMs);
    return [w, {
      week: w, created: 0, signed_in: 0,
      terms_accepted: tos ? 0 : null,
      active_week_two: open ? null : 0,
      week_two_open: open,
      invited: invited ? 0 : null,
    }];
  }));
  for (const r of rows) {
    const w = cohortWeekOf(r.created_at, weeks);
    const c = w ? by.get(w) : undefined;
    if (!c) continue;
    const id = Number(r.id);
    c.created += 1;
    if (Number(r.signed_in) === 1) c.signed_in += 1;
    if (tos && c.terms_accepted !== null && tos.has(id)) c.terms_accepted += 1;
    if (c.active_week_two !== null && Number(r.active_w2) === 1) c.active_week_two += 1;
    if (invited && c.invited !== null && invited.has(id)) c.invited += 1;
  }
  return weeks.map((w) => by.get(w)!);
}

/** This database's funnel, by creation week. Never throws: a failed read is a stated state. */
export async function activationFunnel(env: Env, nowMs: number = Date.now()): Promise<ActivationRead> {
  const axis = weekAxis(new Date(nowMs).toISOString(), ACTIVATION_WEEKS);
  const from = axis.from;
  const to = axis.to;

  let rows: AccountRow[];
  try {
    const q = await env.DB.prepare(
      `SELECT u.id, u.created_at,
              EXISTS (SELECT 1 FROM activity_logs a
                       WHERE a.user_id = u.id AND a.action LIKE 'user\\_login%' ESCAPE '\\') AS signed_in,
              EXISTS (SELECT 1 FROM activity_logs a
                       WHERE a.user_id = u.id
                         AND datetime(a.created_at) >= datetime(u.created_at, '+7 days')
                         AND datetime(a.created_at) <  datetime(u.created_at, '+14 days')) AS active_w2
         FROM users u
        WHERE datetime(u.created_at) >= datetime(?) AND datetime(u.created_at) < datetime(?)`,
    ).bind(from, to).all<AccountRow>();
    rows = q.results || [];
  } catch (e) {
    return {
      available: false, unreadable: true,
      reason: `The accounts or the activity log could not be read: ${(e as Error)?.message || 'unknown'}.`,
    };
  }

  let tos: Set<number> | null = null;
  let termsState: StepState = { available: true };
  try {
    const q = await env.DB.prepare(
      `SELECT DISTINCT l.user_id AS id FROM legal_acceptances l JOIN users u ON u.id = l.user_id
        WHERE l.obligation_key = ? AND datetime(u.created_at) >= datetime(?) AND datetime(u.created_at) < datetime(?)`,
    ).bind(TOS_KEY, from, to).all<{ id: number }>();
    tos = new Set((q.results || []).map((r) => Number(r.id)));
  } catch (e) {
    termsState = {
      available: false, unreadable: true,
      reason: `Terms acceptances could not be read (migration 245): ${(e as Error)?.message || 'unknown'}.`,
    };
  }

  let invited: Set<number> | null = null;
  let invitedState: StepState = { available: true };
  try {
    const q = await env.DB.prepare(
      `SELECT u.id FROM users u
        WHERE datetime(u.created_at) >= datetime(?) AND datetime(u.created_at) < datetime(?)
          AND (EXISTS (SELECT 1 FROM company_invitations ci WHERE ci.accepted_by_user_id = u.id AND ci.status = 'accepted')
            OR EXISTS (SELECT 1 FROM project_member_invitations pi WHERE pi.accepted_by_user_id = u.id AND pi.status = 'accepted')
            OR EXISTS (SELECT 1 FROM partner_invitations pa WHERE pa.resulting_user_id = u.id)
            OR EXISTS (SELECT 1 FROM branch_invitations bi WHERE bi.status = 'accepted' AND lower(bi.email) = lower(u.email)))`,
    ).bind(from, to).all<{ id: number }>();
    invited = new Set((q.results || []).map((r) => Number(r.id)));
  } catch (e) {
    invitedState = {
      available: false, unreadable: true,
      reason: `The invitation tables could not be read: ${(e as Error)?.message || 'unknown'}.`,
    };
  }

  return {
    available: true,
    weeks: axis.weeks,
    cohorts: foldCohorts(axis.weeks, rows, tos, invited, nowMs),
    steps: { terms_accepted: termsState, invited: invitedState },
  };
}

export type FunnelLine = {
  code: string; label: string; kind: 'hq' | 'branch';
  read: ActivationRead | null; reason?: string;
};

type Total = Omit<ActivationCohort, 'week' | 'week_two_open'> & { week: string; week_two_open: boolean };

/**
 * The funnel across lines: each cohort's counts added over the lines that
 * answered. A step is added only when every answering line could read it;
 * otherwise its total is withheld, because a sum missing a line is a floor
 * drawn as a figure. Pure.
 */
export function combineFunnels(lines: FunnelLine[], weeks: string[], nowMs: number) {
  const answered = lines.flatMap((l) => (l.read && l.read.available ? [l.read] : []));
  const termsWhole = answered.every((r) => r.steps.terms_accepted.available);
  const invitedWhole = answered.every((r) => r.steps.invited.available);
  const cohorts: Total[] = weeks.map((w) => {
    const open = !weekTwoClosed(w, nowMs);
    const t: Total = {
      week: w, created: 0, signed_in: 0,
      terms_accepted: termsWhole ? 0 : null,
      active_week_two: open ? null : 0,
      week_two_open: open,
      invited: invitedWhole ? 0 : null,
    };
    for (const r of answered) {
      const c = r.cohorts.find((x) => x.week === w);
      if (!c) continue;
      t.created += c.created;
      t.signed_in += c.signed_in;
      if (t.terms_accepted !== null) t.terms_accepted += c.terms_accepted ?? 0;
      if (t.active_week_two !== null) t.active_week_two += c.active_week_two ?? 0;
      if (t.invited !== null) t.invited += c.invited ?? 0;
    }
    return t;
  });
  return {
    cohorts,
    lines_counted: answered.length,
    lines_total: lines.length,
    ...(termsWhole ? {} : { terms_reason: 'A line that answered could not read its terms acceptances, so no total is added for that step.' }),
    ...(invitedWhole ? {} : { invited_reason: 'A line that answered could not read its invitations, so no total is added for them.' }),
  };
}
