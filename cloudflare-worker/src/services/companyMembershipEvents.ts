/**
 * D1137 (#3017, part 3 of #2422) — the membership audit: one row in
 * `company_membership_events` (migration 597) per change to who belongs to a
 * company or a venture.
 *
 * `membershipEvent` returns a bound statement and runs nothing, so a route
 * puts it in the same `DB.batch` as the change it records: the change and its
 * row commit together or not at all. `before` and `after` hold the fields the
 * change touched (a role, a flag, a company id, a name); never a token, an
 * email or an invitation code.
 *
 * Part 1 (D1135, #3015) makes any member able to leave a company; its route
 * records the leave through this same function with `kind: 'leave'`.
 */
import type { Env } from '../types';

export const MEMBERSHIP_EVENT_KINDS = [
  'join', 'role_change', 'remove', 'leave', 'transfer', 'archive', 'restore', 'rename',
  'project_move', 'project_transfer', 'seat_add', 'seat_remove',
  // #3932 (migration 757): a change to the company's default currency, recorded beside 'rename'.
  'currency_change',
] as const;
export type MembershipEventKind = (typeof MEMBERSHIP_EVENT_KINDS)[number];

export type MembershipEvent = {
  kind: MembershipEventKind;
  companyId?: number | null;
  projectId?: number | null;
  actorUserId?: number | null;
  targetUserId?: number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

const json = (o: Record<string, unknown> | null | undefined) => (o && Object.keys(o).length ? JSON.stringify(o) : null);
const idOrNull = (x: unknown) => (typeof x === 'number' && Number.isSafeInteger(x) && x > 0 ? x : null);

/** The statement that records one event; batch it with the change. */
export function membershipEvent(env: Pick<Env, 'DB'>, ev: MembershipEvent): D1PreparedStatement {
  if (!MEMBERSHIP_EVENT_KINDS.includes(ev.kind)) throw new Error('unknown membership event kind');
  const companyId = idOrNull(ev.companyId);
  const projectId = idOrNull(ev.projectId);
  if (companyId == null && projectId == null) throw new Error('a membership event names a company or a venture');
  return env.DB.prepare(
    `INSERT INTO company_membership_events
       (company_id, project_id, actor_user_id, target_user_id, kind, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(companyId, projectId, idOrNull(ev.actorUserId), idOrNull(ev.targetUserId), ev.kind, json(ev.before), json(ev.after));
}
