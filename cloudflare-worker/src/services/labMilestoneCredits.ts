/**
 * D541 — Spin-Out Lab milestones pay credits, through D540's `grantCredits`.
 *
 * WHO EARNS. An accepted cohort member: `user_spinout_flags.spinout_lab_admitted
 * = 1`, the flag both acceptance paths set (the admin decision in
 * routes/admin.ts and the cycle activation in services/cohortApplications.ts).
 * `POST /spinout-lab/start` does not check it, so being in the Lab is not
 * enough. A flag that cannot be read pays nothing. Staff are refused by
 * `grantCredits` itself.
 *
 * WHAT PAYS. Each milestone's `lab:<milestone_key>` rule (migration 381); a
 * milestone with no rule (week 1's required four) pays nothing. The source ref
 * is `lab:<user_id>:<milestone_key>`, so a milestone pays once however many
 * times it is recorded. #1102 pays "the first of" `advisor_meeting_booked` and
 * `cofounder_request_sent`: the second one recorded is skipped.
 *
 * THE PAIR IS DECIDED INSIDE THE INSERT (#1104 follow-up). Each half passes
 * the other's source ref to `grantCredits` as `unlessPaid`, which the ledger
 * insert checks in the same statement, so two halves recorded at once land
 * one grant. A read-before-write check here let both through. Each half keeps
 * its own `lab:<user_id>:<key>` ref, the shape every earlier version wrote and
 * reads, so rolling the Worker back cannot make it blind to a grant this one
 * made (Workers roll back code, not D1).
 *
 * GRADUATION. `lab:graduation` is paid once, when the certificate is issued,
 * and only to someone whose `incorporation_completed` was itself paid.
 *
 * THE COHORT BACKFILL (#1102 question 4, A and B). Milestones completed from
 * launch day pay as they are recorded (A); the current cohort is also paid
 * once for what it completed before (B). `backfillLabCredits` walks each
 * accepted member's recorded milestones, oldest first, through the same
 * `creditLabMilestone`, then pays graduation to a member holding an issued
 * certificate. Every grant keeps its `lab:<user_id>:<key>` source ref, so the
 * ledger's idempotency key makes a second run, or a milestone already paid
 * live, pay nothing. A grant a Super Admin revoked stays revoked: its row
 * still holds the ref.
 *
 * NEVER THROWS. A grant is a side effect of recording a milestone or issuing a
 * certificate; neither may fail because the grant did (D111). Each call
 * returns what happened, and a failure is logged.
 */
import type { Env } from '../types';
import { grantCredits, INELIGIBLE_ROLES, type GrantResult } from './creditGrants';

export const LAB_ACTOR = { kind: 'system' as const, source: 'spinout_lab' };
/** #1102: "the first of `advisor_meeting_booked` or `cofounder_request_sent`". */
export const FIRST_OF: readonly string[] = ['advisor_meeting_booked', 'cofounder_request_sent'];

export const labSourceRef = (userId: number, key: string) => `lab:${userId}:${key}`;

export type LabCreditOutcome =
  | GrantResult
  | { status: 'skipped'; reason: 'not_accepted' | 'no_rule' | 'pair_already_paid' | 'graduation_not_paid' | 'error' };

/** True only when the admission flag reads 1. Unreadable is not accepted. */
export async function isAcceptedMember(env: Env, userId: number): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      'SELECT spinout_lab_admitted FROM user_spinout_flags WHERE user_id = ?',
    ).bind(userId).first<{ spinout_lab_admitted: number | null }>();
    return Number(row?.spinout_lab_admitted ?? 0) === 1;
  } catch (e) {
    console.warn('[labCredits] admission flag unreadable; paying nothing', (e as Error).message);
    return false;
  }
}

async function hasGrant(env: Env, userId: number, sourceRef: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id FROM perk_credit_ledger WHERE user_id = ? AND kind = 'grant' AND source_ref = ?`,
  ).bind(userId, sourceRef).first<{ id: number }>();
  return !!row;
}

/** Pay a milestone that was just recorded for the first time. */
export async function creditLabMilestone(env: Env, userId: number, key: string): Promise<LabCreditOutcome> {
  try {
    if (!(await isAcceptedMember(env, userId))) return { status: 'skipped', reason: 'not_accepted' };
    const other = FIRST_OF.includes(key) ? FIRST_OF.find((k) => k !== key)! : null;
    const out = await grantCredits(env, {
      userId, ruleKey: `lab:${key}`, sourceRef: labSourceRef(userId, key), actor: LAB_ACTOR,
      unlessPaid: other ? labSourceRef(userId, other) : null,
    });
    if (out.status === 'refused' && out.code === 'rule_unknown') return { status: 'skipped', reason: 'no_rule' };
    if (out.status === 'refused' && out.code === 'superseded') return { status: 'skipped', reason: 'pair_already_paid' };
    return out;
  } catch (e) {
    console.warn('[labCredits] milestone grant failed', key, (e as Error).message);
    return { status: 'skipped', reason: 'error' };
  }
}

/** Pay the graduation bonus, once, when a certificate has just been issued. */
export async function creditLabGraduation(env: Env, userId: number): Promise<LabCreditOutcome> {
  try {
    if (!(await isAcceptedMember(env, userId))) return { status: 'skipped', reason: 'not_accepted' };
    if (!(await hasGrant(env, userId, labSourceRef(userId, 'incorporation_completed')))) {
      return { status: 'skipped', reason: 'graduation_not_paid' };
    }
    return await grantCredits(env, {
      userId, ruleKey: 'lab:graduation', sourceRef: labSourceRef(userId, 'graduation'), actor: LAB_ACTOR,
    });
  } catch (e) {
    console.warn('[labCredits] graduation grant failed', (e as Error).message);
    return { status: 'skipped', reason: 'error' };
  }
}

export type MilestoneCredit = { credits: number; usd_value_cents: number; earned: boolean; superseded: boolean };
export type MilestoneCredits = {
  eligible: boolean;
  /** Why not, in a sentence the checklist prints; null when eligible. */
  reason: string | null;
  milestones: Record<string, MilestoneCredit>;
};

/**
 * What each milestone pays this user, and which have been paid. `superseded`
 * marks the half of the first-of pair that will not pay because the other
 * did. Throws when a read fails: the caller says "unreadable", never "0".
 */
export async function milestoneCreditsFor(env: Env, userId: number, role: string): Promise<MilestoneCredits> {
  const rules = await env.DB.prepare(
    `SELECT key, credits, usd_value_cents FROM credit_reward_rules
      WHERE substr(key, 1, 4) = 'lab:' AND active = 1 AND credits > 0`,
  ).all<{ key: string; credits: number; usd_value_cents: number }>();
  const prefix = `lab:${userId}:`;
  const paid = await env.DB.prepare(
    `SELECT g.source_ref FROM perk_credit_ledger g
      WHERE g.user_id = ? AND g.kind = 'grant' AND substr(g.source_ref, 1, length(?)) = ?
        AND NOT EXISTS (SELECT 1 FROM perk_credit_ledger r
                         WHERE r.user_id = g.user_id AND r.kind = 'admin_adjust'
                           AND r.source_ref = 'revoke:' || g.id)`,
  ).bind(userId, prefix, prefix).all<{ source_ref: string }>();
  const earned = new Set((paid.results || []).map((r) => r.source_ref.slice(prefix.length)));
  const pairPaid = FIRST_OF.find((k) => earned.has(k)) ?? null;
  const milestones: Record<string, MilestoneCredit> = {};
  for (const r of rules.results || []) {
    const key = r.key.slice(4);
    milestones[key] = {
      credits: Number(r.credits), usd_value_cents: Number(r.usd_value_cents),
      earned: earned.has(key),
      superseded: pairPaid !== null && FIRST_OF.includes(key) && key !== pairPaid,
    };
  }
  const staff = INELIGIBLE_ROLES.has(String(role || '').toLowerCase());
  const accepted = staff ? false : await isAcceptedMember(env, userId);
  return {
    eligible: !staff && accepted,
    reason: staff ? 'Staff and admin accounts do not earn credits.'
      : accepted ? null : 'Credits are earned once you are accepted into a cohort.',
    milestones,
  };
}

export type LabBackfillResult = {
  members: number;
  milestones: number;
  granted: number;
  credits: number;
  already_paid: number;
  graduations: number;
  skipped: Record<string, number>;
  failed: number;
  /** Pass as `after` to continue; null when every accepted member was walked. */
  next_after: number | null;
};

/** Members per call. A member's walk is roughly a hundred D1 queries, and a Worker invocation allows 1,000. */
export const BACKFILL_BATCH_DEFAULT = 5;
export const BACKFILL_BATCH_MAX = 8;

/**
 * Pay the current cohort once for the milestones it completed before credits
 * launched (#1102 Q4 B). Walks accepted members in user-id order after `after`,
 * `limit` at a time. Reading who to walk throws, so a failed read is never
 * reported as "nobody to pay"; one member's failed grant is counted in
 * `failed` and the walk goes on.
 */
export async function backfillLabCredits(env: Env, opts: { after?: number; limit?: number } = {}): Promise<LabBackfillResult> {
  const after = Number.isInteger(opts.after) && (opts.after as number) > 0 ? (opts.after as number) : 0;
  const limit = Math.min(BACKFILL_BATCH_MAX, Math.max(1, Number.isInteger(opts.limit) ? (opts.limit as number) : BACKFILL_BATCH_DEFAULT));
  const members = await env.DB.prepare(
    `SELECT user_id FROM user_spinout_flags WHERE spinout_lab_admitted = 1 AND user_id > ? ORDER BY user_id LIMIT ?`,
  ).bind(after, limit + 1).all<{ user_id: number }>();
  const ids = (members.results || []).map((r) => Number(r.user_id));
  const walk = ids.slice(0, limit);
  const out: LabBackfillResult = {
    members: walk.length, milestones: 0, granted: 0, credits: 0, already_paid: 0, graduations: 0,
    skipped: {}, failed: 0, next_after: ids.length > limit ? walk[walk.length - 1] : null,
  };
  const tally = (r: LabCreditOutcome) => {
    if (r.status === 'granted') { out.granted += 1; out.credits += Number(r.credits); }
    else if (r.status === 'already_granted') out.already_paid += 1;
    else if (r.status === 'skipped' && r.reason === 'error') out.failed += 1;
    else {
      const why = r.status === 'skipped' ? r.reason : r.code;
      out.skipped[why] = (out.skipped[why] || 0) + 1;
    }
  };
  for (const userId of walk) {
    const done = await env.DB.prepare(
      `SELECT milestone_key FROM spinout_lab_milestones WHERE user_id = ? ORDER BY completed_at, id`,
    ).bind(userId).all<{ milestone_key: string }>();
    for (const m of done.results || []) {
      out.milestones += 1;
      tally(await creditLabMilestone(env, userId, String(m.milestone_key)));
    }
    const cert = await env.DB.prepare(
      `SELECT id FROM spinout_certificates WHERE user_id = ? AND status = 'issued' LIMIT 1`,
    ).bind(userId).first<{ id: number }>();
    if (cert) {
      const g = await creditLabGraduation(env, userId);
      if (g.status === 'granted') out.graduations += 1;
      tally(g);
    }
  }
  return out;
}
