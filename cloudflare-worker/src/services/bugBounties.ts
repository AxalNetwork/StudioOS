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
 * Everything here is a pure decision over the event, so the webhook handler
 * stays a thin caller and every rule can be tested without a database.
 */

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
