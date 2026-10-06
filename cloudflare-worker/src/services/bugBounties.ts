/**
 * D542 — bug bounties, read from the coordinator's labels on a mirrored
 * ticket issue.
 *
 * WHO DECIDES. Session 1 confirms a bug, checks the fix in production and
 * grades it, and says so with a label on the ticket's GitHub issue (the
 * labels are declared by D543). The platform acts on a bounty label only when
 * the webhook's sender is on `BOUNTY_GRANTERS`: anyone who can label an issue
 * could otherwise mint credits. The allowlist is a second wall behind the
 * webhook's signature check, which is unchanged.
 *
 * WHAT A LABEL MEANS
 *   bounty:confirmed          the bug is real and a fix is being made
 *   bounty:verified-<tier>    the fix is live and graded: grant `bug_<tier>`
 *   bounty:not-a-bug          closed, with S1's reason comment
 *   bounty:duplicate          closed, with a link to the original
 *
 * Removing a verified label within the revoke window revokes the grant (a
 * fix that was reverted). The grant and the revoke go through the credit
 * grant service, keyed by `bountySourceRef`, so a redelivered webhook or a
 * replay from the label snapshot grants once.
 *
 * The decisions (`bountyLabelEvent`, `bountyStateFromLabels`) are pure, so
 * every rule can be tested without a database. `applyBountyTier` is the one
 * step that writes: it hands a verified tier to the credit grant service
 * (D540) and takes it back when the tier is removed in time.
 */
import type { Env } from '../types';
import { grantCredits, revokeGrant, type GrantActor } from './creditGrants';

export const BOUNTY_CONFIRMED = 'bounty:confirmed';
export const BOUNTY_NOT_A_BUG = 'bounty:not-a-bug';
export const BOUNTY_DUPLICATE = 'bounty:duplicate';

/** Each verified tier and the reward rule it grants. */
export const BOUNTY_TIER_RULES: Readonly<Record<string, 'bug_high' | 'bug_medium' | 'bug_low'>> = {
  'bounty:verified-high': 'bug_high',
  'bounty:verified-medium': 'bug_medium',
  'bounty:verified-low': 'bug_low',
};

/** A tier removed this many days after it was added or later is not revoked. */
export const BOUNTY_REVOKE_WINDOW_DAYS = 30;

/** The ledger's source ref for a ticket's bounty: one grant per ticket. */
export function bountySourceRef(ticketId: number | string): string {
  return `bounty:ticket:${ticketId}`;
}

/**
 * `BOUNTY_GRANTERS` as a set of lower-cased GitHub logins. Commas or
 * whitespace separate them. Unset or empty is an EMPTY set — nobody's label
 * counts — never "everybody".
 */
export function parseGranters(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of String(raw ?? '').split(/[\s,]+/)) {
    const login = part.trim().toLowerCase();
    if (login) out.add(login);
  }
  return out;
}

export type BountyLabelEvent =
  | { kind: 'ignored'; reason: 'not_a_bounty_label' | 'not_a_label_event' }
  | { kind: 'refused'; reason: 'sender_not_allowed'; label: string }
  | { kind: 'confirmed'; label: string }
  | { kind: 'confirmed_removed'; label: string }
  | { kind: 'tier_added'; label: string; ruleKey: string }
  | { kind: 'tier_removed'; label: string; ruleKey: string }
  | { kind: 'outcome'; label: string; outcome: 'not_a_bug' | 'duplicate' }
  | { kind: 'outcome_removed'; label: string };

/**
 * What one `issues` labeled / unlabeled delivery means for a bounty.
 *
 * A label that is not a bounty label is ignored here (the ordinary label sync
 * still runs). A bounty label from a sender not on the allowlist is REFUSED —
 * reported, never acted on — whichever way it moved.
 */
export function bountyLabelEvent(args: {
  action: string | null | undefined;
  label: string | null | undefined;
  sender: string | null | undefined;
  granters: Set<string>;
}): BountyLabelEvent {
  if (args.action !== 'labeled' && args.action !== 'unlabeled') {
    return { kind: 'ignored', reason: 'not_a_label_event' };
  }
  const label = String(args.label ?? '').trim().toLowerCase();
  const isBounty = label === BOUNTY_CONFIRMED || label === BOUNTY_NOT_A_BUG || label === BOUNTY_DUPLICATE
    || Object.prototype.hasOwnProperty.call(BOUNTY_TIER_RULES, label);
  if (!isBounty) return { kind: 'ignored', reason: 'not_a_bounty_label' };

  const sender = String(args.sender ?? '').trim().toLowerCase();
  if (!sender || !args.granters.has(sender)) return { kind: 'refused', reason: 'sender_not_allowed', label };

  const added = args.action === 'labeled';
  if (Object.prototype.hasOwnProperty.call(BOUNTY_TIER_RULES, label)) {
    const ruleKey = BOUNTY_TIER_RULES[label];
    return added ? { kind: 'tier_added', label, ruleKey } : { kind: 'tier_removed', label, ruleKey };
  }
  if (label === BOUNTY_CONFIRMED) return added ? { kind: 'confirmed', label } : { kind: 'confirmed_removed', label };
  return added
    ? { kind: 'outcome', label, outcome: label === BOUNTY_NOT_A_BUG ? 'not_a_bug' : 'duplicate' }
    : { kind: 'outcome_removed', label };
}

export type BountyState =
  | { state: 'not_a_bug' }
  | { state: 'duplicate' }
  | { state: 'fixed'; tier: 'high' | 'medium' | 'low'; ruleKey: string }
  | { state: 'confirmed' }
  | { state: 'under_review' }
  | null;

/**
 * A ticket's bounty state from its label snapshot (`tickets.github_labels`),
 * most decisive first: a closing outcome, then a verified tier, then
 * confirmed. A bug ticket with none of them is under review; any other ticket
 * has no bounty state at all (null), because a feature request or a question
 * is not a bounty candidate.
 */
export function bountyStateFromLabels(labels: readonly string[], ticketType: string | null | undefined): BountyState {
  const set = new Set(labels.map((l) => String(l).trim().toLowerCase()));
  if (set.has(BOUNTY_NOT_A_BUG)) return { state: 'not_a_bug' };
  if (set.has(BOUNTY_DUPLICATE)) return { state: 'duplicate' };
  for (const tier of ['high', 'medium', 'low'] as const) {
    const label = `bounty:verified-${tier}`;
    if (set.has(label)) return { state: 'fixed', tier, ruleKey: BOUNTY_TIER_RULES[label] };
  }
  if (set.has(BOUNTY_CONFIRMED)) return { state: 'confirmed' };
  if (String(ticketType ?? '').toLowerCase() === 'bug' || set.has('bug')) return { state: 'under_review' };
  return null;
}

/** The webhook acts as the system; the GitHub sender is in the activity log beside it. */
export const BOUNTY_ACTOR: GrantActor = { kind: 'system', source: 'github_bounty' };

/** Whole days from an instant to now, for either stored date shape (D162). */
function daysSince(at: string, now: Date): number {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now.getTime() - t) / 86_400_000 : Number.POSITIVE_INFINITY;
}

/**
 * What a verified tier label added or removed does to the ticket owner's
 * credits. Returns the report the webhook answers with.
 *
 *   added    → `grantCredits(bug_<tier>)` under `bounty:ticket:<id>`. The
 *              grant service reads the amount, refuses staff, holds the
 *              monthly cap and pays a source once, so a redelivery or a
 *              second tier on the same ticket is `already_granted`.
 *   removed  → the grant under that source is revoked when it is the tier
 *              that was removed (removing a tier that was never paid takes
 *              nothing back) and it is under BOUNTY_REVOKE_WINDOW_DAYS old.
 *              A revoke the ledger refuses (the credits are spent) is
 *              reported, not retried.
 *
 * A refusal is an answer, not a failure: the webhook acknowledges it, since a
 * redelivery would be refused the same way. A thrown error propagates, so the
 * webhook releases the delivery claim and the event can be redelivered.
 */
export async function applyBountyTier(env: Env, args: {
  ticketId: number; userId: number | null | undefined;
  event: { kind: 'tier_added' | 'tier_removed'; label: string; ruleKey: string };
  now?: Date;
}): Promise<Record<string, unknown>> {
  const sourceRef = bountySourceRef(args.ticketId);
  const base = { kind: args.event.kind, rule_key: args.event.ruleKey, source_ref: sourceRef };
  const userId = Number(args.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { ...base, credits: 'not_granted', reason: 'no_ticket_owner' };
  }

  if (args.event.kind === 'tier_added') {
    const r = await grantCredits(env, { userId, ruleKey: args.event.ruleKey, sourceRef, actor: BOUNTY_ACTOR });
    if (r.status === 'granted') return { ...base, credits: 'granted', amount: r.credits, ledger_id: r.ledger_id };
    if (r.status === 'already_granted') {
      // One grant per ticket, ever: a tier put back after a revoke does not
      // pay again, and the answer says so rather than reading as paid.
      const revoked = r.ledger_id === null ? null : await env.DB.prepare(
        `SELECT id FROM perk_credit_ledger WHERE user_id = ? AND kind = 'admin_adjust' AND source_ref = ?`,
      ).bind(userId, `revoke:${r.ledger_id}`).first<{ id: number }>();
      return { ...base, credits: revoked ? 'revoked_earlier' : 'already_granted', ledger_id: r.ledger_id };
    }
    return { ...base, credits: 'refused', code: r.code, message: r.message, ...(r.cap ? { cap: r.cap } : {}) };
  }

  const grant = await env.DB.prepare(
    `SELECT id, rule_key, created_at FROM perk_credit_ledger WHERE user_id = ? AND kind = 'grant' AND source_ref = ?`,
  ).bind(userId, sourceRef).first<{ id: number; rule_key: string | null; created_at: string }>();
  if (!grant) return { ...base, credits: 'nothing_to_revoke' };
  if (grant.rule_key !== args.event.ruleKey) {
    return { ...base, credits: 'kept', reason: 'paid_under_another_tier', paid_rule_key: grant.rule_key };
  }
  if (daysSince(String(grant.created_at), args.now ?? new Date()) > BOUNTY_REVOKE_WINDOW_DAYS) {
    return { ...base, credits: 'kept', reason: 'revoke_window_passed', ledger_id: Number(grant.id) };
  }
  const r = await revokeGrant(env, {
    ledgerId: Number(grant.id),
    actor: BOUNTY_ACTOR,
    reason: `The ${args.event.label} label was removed from the ticket within ${BOUNTY_REVOKE_WINDOW_DAYS} days: the fix was reverted or regraded.`,
  });
  if (r.status === 'revoked') return { ...base, credits: 'revoked', amount: r.credits, ledger_id: r.ledger_id };
  if (r.status === 'already_revoked') return { ...base, credits: 'already_revoked', ledger_id: r.ledger_id };
  return { ...base, credits: 'kept', reason: r.code, message: r.message };
}
