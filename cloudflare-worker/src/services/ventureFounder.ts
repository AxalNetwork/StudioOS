/**
 * Whether the viewer is the venture's founder (`projects.founder_id`).
 *
 * A missing founder id is never a match. Grow uses this for who decides what
 * Mercury proposes; publishing uses the same check for who may publish. It
 * lives here, not in `mercury/growFeeds.ts`, so a cron that imports publishing
 * does not reach a member's bank modules.
 */
import type { Env } from '../types';

export async function isVentureFounder(env: Env, viewer: { founder_id?: number | null }, projectId: number): Promise<boolean> {
  if (viewer.founder_id == null) return false;
  return !!(await env.DB.prepare('SELECT 1 FROM projects WHERE id = ? AND founder_id IS NOT NULL AND founder_id = ?')
    .bind(projectId, viewer.founder_id).first());
}
