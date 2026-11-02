/**
 * D1570 (#3817) — the people who can work on a venture's deck: the ones a
 * comment can mention, a thread can be assigned to and the founders can name
 * as approvers. Moved here from `routes/deck_comments.ts` unchanged by D1579
 * (#3826), whose card assignee is the same rule.
 *
 * Exactly the comments' readers: the venture's founder users, its accepted
 * owner and cofounder members, and an advisor or Operating Partner with a live
 * `advisor_client_grants` row that has `scope_deck` (migration 741, owner
 * decision Q = B). Never an Admin, never an inactive account. Bound SQL only.
 */
import type { Env } from '../../types';

export type Kind = 'founder' | 'advisor' | 'operating_partner';
export type Person = { id: number; name: string | null; kind: Kind };

export const PEOPLE_MAX = 100;

export const kindOfRole = (role: unknown): Kind => (role === 'advisor' ? 'advisor' : role === 'partner' ? 'operating_partner' : 'founder');

/** Who can be mentioned, assigned or named an approver: everyone who can read the threads. */
export async function peopleOf(env: Env, projectId: number): Promise<Person[]> {
  const rows = (await env.DB.prepare(
    `SELECT u.id, u.name, u.role FROM users u
      WHERE COALESCE(u.is_active, 1) = 1 AND u.role <> 'admin' AND (
        (u.role = 'founder' AND u.founder_id IS NOT NULL AND u.founder_id = (SELECT founder_id FROM projects WHERE id = ?))
        OR u.id IN (SELECT m.user_id FROM project_members m WHERE m.project_id = ? AND m.status = 'accepted' AND m.role IN ('owner', 'cofounder'))
        OR (u.role IN ('advisor', 'partner') AND u.id IN (
          SELECT g.advisor_user_id FROM advisor_client_grants g
           WHERE g.project_id = ? AND g.status = 'active' AND g.scope_deck = 1
             AND (g.expires_at IS NULL OR datetime(g.expires_at) > datetime('now'))))
      )
      ORDER BY u.name, u.id LIMIT ?`,
  ).bind(projectId, projectId, projectId, PEOPLE_MAX).all<{ id: number; name: string | null; role: string | null }>()).results ?? [];
  return rows.map((r) => ({ id: Number(r.id), name: r.name ?? null, kind: kindOfRole(r.role) }));
}
