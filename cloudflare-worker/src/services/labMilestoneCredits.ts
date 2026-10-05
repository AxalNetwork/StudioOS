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
 * THE PAIR SHARES ONE SOURCE REF (#1104 follow-up). Both halves are granted
 * under `lab:<user_id>:advisor_or_cofounder`, so the ledger's unique index on
 * (user_id, kind, source_ref) lets exactly one insert land when both are
 * recorded at once. A read-before-write check let both through: each request
 * saw no grant for the other half before either inserted. The row's
 * `rule_key` says which half paid. Grants made before this under the
 * per-milestone refs are still read as paying the pair.
 *
 * GRADUATION. `lab:graduation` is paid once, when the certificate is issued,
 * and only to someone whose `incorporation_completed` was itself paid. That is
 * #1102 question 4's pick A (only milestones completed from launch day earn)
 * carried to the bonus: a certificate the backfill issues for a pre-launch
 * graduate pays nothing, because their graduation milestone never did.
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

/** The one source ref both halves of the first-of pair are granted under. */
export const PAIR_REF_KEY = 'advisor_or_cofounder';

export const labSourceRef = (userId: number, key: string) =>
  `lab:${userId}:${FIRST_OF.includes(key) ? PAIR_REF_KEY : key}`;

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
    const pair = FIRST_OF.includes(key);
    if (pair) {
      // A grant from before the shared ref, under either half's own ref.
      for (const k of FIRST_OF) {
        if (await hasGrant(env, userId, `lab:${userId}:${k}`)) return { status: 'skipped', reason: 'pair_already_paid' };
      }
    }
    const out = await grantCredits(env, {
      userId, ruleKey: `lab:${key}`, sourceRef: labSourceRef(userId, key), actor: LAB_ACTOR,
    });
    if (out.status === 'refused' && out.code === 'rule_unknown') return { status: 'skipped', reason: 'no_rule' };
    if (pair && out.status === 'already_granted') {
      // The shared ref is taken: by this half recorded again, or by the other.
      const row = await env.DB.prepare('SELECT rule_key FROM perk_credit_ledger WHERE id = ?')
        .bind(out.ledger_id).first<{ rule_key: string | null }>();
      if (row?.rule_key !== `lab:${key}`) return { status: 'skipped', reason: 'pair_already_paid' };
    }
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
    `SELECT g.source_ref, g.rule_key FROM perk_credit_ledger g
      WHERE g.user_id = ? AND g.kind = 'grant' AND substr(g.source_ref, 1, length(?)) = ?
        AND NOT EXISTS (SELECT 1 FROM perk_credit_ledger r
                         WHERE r.user_id = g.user_id AND r.kind = 'admin_adjust'
                           AND r.source_ref = 'revoke:' || g.id)`,
  ).bind(userId, prefix, prefix).all<{ source_ref: string; rule_key: string | null }>();
  // The pair's shared ref names neither half; its rule_key says which paid.
  const earned = new Set((paid.results || []).map((r) => {
    const key = r.source_ref.slice(prefix.length);
    return key === PAIR_REF_KEY ? String(r.rule_key || '').slice(4) : key;
  }));
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
