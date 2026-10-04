/**
 * D545 — the community task list the Eadwyn chat's Tasks panel reads.
 * Mounted at /api/community-tasks. Signed-in only.
 *
 *   GET /   { tasks, my_suggestions, audience }
 *
 *   tasks           the approved community tasks for the caller's persona,
 *                   plus those for `all`. An admin, who reviews them, sees
 *                   every approved task.
 *   my_suggestions  the caller's own suggested tasks with their review state:
 *                   pending, approved, or declined with the Super Admin's reason.
 *
 * The store is D544's `community_tasks` (migration 383). A read that fails is
 * a 500 refusal, never an empty list: "No tasks yet" and "could not read the
 * tasks" are different sentences, and the panel prints each.
 *
 * The persona matches D544's audiences: the four roles that are personas
 * themselves, `exploring` as `explorer`, and any other account sees only the
 * tasks for `all`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

/** The audience a role reads, or null for "only the tasks for everyone". */
export function audienceFor(role: unknown): string | null {
  const v = String(role ?? '').toLowerCase();
  if (v === 'founder' || v === 'investor' || v === 'advisor' || v === 'partner') return v;
  if (v === 'exploring' || v === 'explorer') return 'explorer';
  return null;
}

r.get('/', async (c) => {
  let user;
  try { user = await requireAuth(c); } catch (e) { return mapError(c, e); }
  const isAdmin = String(user.role || '').toLowerCase() === 'admin';
  const audience = audienceFor(user.role);
  try {
    const tasks = await (isAdmin
      ? c.env.DB.prepare(
          `SELECT id, title, body, audience, decided_at FROM community_tasks
            WHERE status = 'approved' ORDER BY decided_at DESC, id DESC LIMIT 200`,
        )
      : c.env.DB.prepare(
          `SELECT id, title, body, audience, decided_at FROM community_tasks
            WHERE status = 'approved' AND (audience = 'all' OR audience = ?)
            ORDER BY decided_at DESC, id DESC LIMIT 200`,
        ).bind(audience ?? 'all')
    ).all<any>();
    const mine = await c.env.DB.prepare(
      `SELECT ct.id, ct.ticket_id, ct.title, ct.status, ct.decline_reason, ct.created_at, ct.decided_at
         FROM community_tasks ct JOIN tickets t ON t.id = ct.ticket_id
        WHERE t.user_id = ?
        ORDER BY ct.created_at DESC, ct.id DESC LIMIT 100`,
    ).bind(user.id).all<any>();
    return c.json({
      audience: isAdmin ? 'admin' : (audience ?? 'all'),
      tasks: (tasks.results || []).map((x: any) => ({
        id: x.id, title: x.title, body: x.body ?? null, audience: x.audience, published_at: x.decided_at ?? null,
      })),
      my_suggestions: (mine.results || []).map((x: any) => ({
        id: x.id, ticket_id: x.ticket_id, title: x.title, status: x.status,
        // The reason belongs to a decline only; a pending or approved row has none.
        decline_reason: x.status === 'declined' ? (x.decline_reason ?? null) : null,
        created_at: x.created_at, decided_at: x.decided_at ?? null,
      })),
    });
  } catch (e) {
    return refuse(c, 500, {
      code: 'community_tasks_unreadable',
      message: 'The task list could not be read. This is not a sign there are none; try again.',
      raw: e,
    });
  }
});

export default r;
