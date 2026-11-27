/**
 * D9072 (#9072, D6158 Q1 = A) — who opens a deal's closing workspace (`/deals/closing?deal=<id>`)
 * as studio staff: an Admin, or the Operating Partner who leads that round. Every other holder of the
 * partner licence is refused, unless they read the deal through a relationship of their own.
 *
 * WHY A SECOND RULE ON TOP OF `dealAudience`. `dealAudience` (services/dealAccess.ts, D4631) puts every
 * holder of the partner licence in `staff`, so every Operating Partner reads every deal. The Studio lens and
 * the deal page depend on that and it is not changed here. The closing workspace is narrower: the round's
 * lead keeps the checklist (`canMoveRound`, D1242), so the lead, and no other partner, reads the workspace.
 *
 * WHAT IT GATES. The workspace's own read, the checklist history behind its Audit tab
 * (`GET /api/deals/:id/closing-checklist/events`). The other reads the workspace makes are shared with the
 * deal page's closing room, which #2424 question 3 opens to every Operating Partner (D1213: the checklist,
 * the transfers and the confirmed total), so they keep that room's rule.
 *
 * WHO IS ADMITTED, in order:
 *   - anyone whose audience on the deal is not `staff` (the venture's founder, a related investor): this
 *     rule does not apply, and they keep what `dealAudience` gave them;
 *   - an Admin;
 *   - the round's lead (`canMoveRound`), in their own session: a support session is a person acting as
 *     the lead, so it is refused (`support_session_refused`);
 *   - a partner who is not the lead but is also the venture's founder or a related investor, who reads as
 *     that relationship;
 *   - anyone else holding the partner licence is refused (`not_your_closing`).
 */
import type { Env, User } from '../types';
import { holdsLicence } from './accountLicences';
import { investorHasDealRelationship, isDealOwner, type DealAudience } from './dealAccess';
import { canMoveRound } from './dealStudioLens';

/** The refusal to a partner who does not lead this round. */
export const NOT_YOUR_CLOSING = {
  code: 'not_your_closing',
  message: 'Only the round’s lead Operating Partner or an Admin opens this closing workspace. Nothing was read.',
} as const;

/** The refusal to a support session acting as the round's lead. */
export const CLOSING_SUPPORT_REFUSED = {
  code: 'support_session_refused',
  message: 'A support session cannot open a closing workspace as the round’s lead. Nothing was read.',
} as const;

export type ClosingRefusal = typeof NOT_YOUR_CLOSING | typeof CLOSING_SUPPORT_REFUSED;

/**
 * Null when the caller may read this deal's closing workspace, else the refusal to send (403).
 * `audience` is the caller's `dealAudience` on the deal, already decided by the route's read gate.
 */
export async function closingWorkspaceRefusal(
  env: Env,
  user: User,
  deal: { id: number; lead_partner_id?: unknown; project_founder_id?: number | null },
  audience: DealAudience,
): Promise<ClosingRefusal | null> {
  if (audience !== 'staff' || user.role === 'admin') return null;
  if (canMoveRound(user, deal.lead_partner_id)) return user.support_session ? CLOSING_SUPPORT_REFUSED : null;
  if (isDealOwner(user, deal.project_founder_id)) return null;
  if (holdsLicence(user as any, 'investor') && await investorHasDealRelationship(env, Number(user.id), Number(deal.id))) return null;
  return NOT_YOUR_CLOSING;
}
