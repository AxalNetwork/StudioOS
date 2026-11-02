/**
 * D1570 (#3817, deck builder v2 D9) — the approval a share waits for.
 *
 * A founder names approvers on the venture's deck (`deck_approvers`, migration
 * 741). Each approver signs off one version (`approved_deck_id`); until every
 * approver still named has signed off the version being shared, no share link
 * for it is made. Both link writers ask this before they write:
 * `POST /api/decks/:id/share` and `createDeckLink` (D902's one link writer,
 * behind `POST /api/cycles/raise/deck-links` and
 * `POST /api/decks/:id/investor-links`).
 *
 * An approval is of a version, because a link is frozen to one (D902 §0.4): a
 * later save is not what the approver read, so its link waits again.
 *
 * A database without migration 741 has no approvers, so nothing waits; any
 * other read failure refuses the link rather than letting it through.
 */
import type { Env } from '../../types';

export type PendingApprover = { user_id: number; name: string | null };

/** The approvers still named on the venture's deck who have not signed off this version. */
export async function pendingApprovers(env: Env, projectId: number, deckId: number): Promise<PendingApprover[]> {
  try {
    const rows = (await env.DB.prepare(
      `SELECT a.user_id, u.name FROM deck_approvers a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.project_id = ? AND a.removed_at IS NULL AND (a.approved_deck_id IS NULL OR a.approved_deck_id <> ?)
        ORDER BY a.id`,
    ).bind(projectId, deckId).all<{ user_id: number; name: string | null }>()).results ?? [];
    return rows.map((r) => ({ user_id: Number(r.user_id), name: r.name ?? null }));
  } catch (e) {
    if (/no such table: deck_approvers/i.test(String((e as Error)?.message ?? ''))) return [];
    throw e;
  }
}

const nameOf = (p: PendingApprover) => (p.name && p.name.trim()) || 'An approver';

/** "Approval needed before sharing · Sam has not approved yet." (pd33 inset), for one or more. */
export function approvalSentence(pending: PendingApprover[]): string {
  const names = pending.map(nameOf);
  const who = names.length === 1 ? `${names[0]} has` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} have`;
  return `Approval needed before sharing · ${who} not approved yet.`;
}

/** The refusal both link writers answer while an approver has not signed off: 409, with who is waited on. */
export function approvalRefusal(pending: PendingApprover[]) {
  return { error: 'approval_needed', message: approvalSentence(pending), pending };
}
