import React from 'react';

/**
 * D542 (#1105, the owner's C) — a ticket's bounty state, as the ticket list
 * (`GET /api/tickets`, `bounty` on each row) says it. One wording for both
 * places it is shown: the rows of Help → Tickets and the chat's own list.
 *
 *   under_review   a bug report nobody has graded yet
 *   confirmed      the bug is real and a fix is being made
 *   fixed          the fix is live and graded; the credits are the grant's
 *                  own amount, read from the ledger, never the rule's today
 *   not_a_bug      closed; the reason is S1's comment on the ticket
 *   duplicate      closed as a duplicate of another report
 *
 * A fixed ticket the grant service has not paid (refused, or not reached
 * yet) says so rather than naming an amount; one whose credits were taken
 * back says that; an unreadable ledger is said as unreadable.
 */
export function bountyLine(bounty) {
  if (!bounty || typeof bounty !== 'object') return null;
  switch (bounty.state) {
    case 'under_review': return { text: 'Under review', tone: 'neutral' };
    case 'confirmed': return { text: 'Confirmed: being fixed', tone: 'info' };
    case 'fixed': {
      if (bounty.credits_unreadable) return { text: 'Fixed: credits could not be read', tone: 'warn' };
      if (bounty.revoked) return { text: 'Fixed: credits taken back', tone: 'warn' };
      const n = Number(bounty.credits);
      if (bounty.credits != null && Number.isFinite(n) && n > 0) return { text: `Fixed: ${n} credit${n === 1 ? '' : 's'}`, tone: 'ok' };
      return { text: 'Fixed: no credits granted', tone: 'neutral' };
    }
    case 'not_a_bug': return { text: 'Not a bug', tone: 'muted', hint: 'The reason is in the ticket’s comments.' };
    case 'duplicate': return { text: 'Duplicate', tone: 'muted', hint: 'The original is named in the ticket’s comments.' };
    default: return null;
  }
}

const TONES = {
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  muted: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

export default function BountyBadge({ bounty, withHint = false }) {
  const line = bountyLine(bounty);
  if (!line) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="bounty-state">
      <span className={`text-[10px] px-2 py-0.5 rounded-full ${TONES[line.tone]}`}>{line.text}</span>
      {withHint && line.hint && <span className="text-[11px] text-gray-500 dark:text-gray-400">{line.hint}</span>}
    </span>
  );
}
