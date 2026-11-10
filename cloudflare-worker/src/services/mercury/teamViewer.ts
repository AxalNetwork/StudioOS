/**
 * Whether a viewer is on a venture's team, the one rule for who sees a founder's
 * Mercury figures (Grow, Publish, the agents' typed reads). It reads two D1 rows
 * and imports nothing, so a module that only needs the rule does not pull in the
 * Mercury client (`fund_admin_overview_d714` walks those imports). `growFeeds.ts`
 * re-exports it for its existing callers.
 */
import type { Env } from '../../types';

/**
 * Whether the viewer is on the founder's company: its founder, or a member
 * linked to its company. Nobody else — an admin, a partner, an advisor, an
 * investor — sees a Mercury figure, whatever they may read of the venture.
 */
export async function isTeamViewer(env: Env, viewer: { id: number; founder_id?: number | null }, projectId: number): Promise<boolean> {
  const p = await env.DB.prepare('SELECT founder_id, company_id FROM projects WHERE id = ?').bind(projectId)
    .first<{ founder_id: number | null; company_id: number | null }>();
  if (!p) return false;
  if (p.founder_id != null && viewer.founder_id != null && Number(viewer.founder_id) === Number(p.founder_id)) return true;
  if (p.company_id == null) return false;
  return !!(await env.DB.prepare('SELECT 1 FROM user_company_links WHERE company_id = ? AND user_id = ?').bind(p.company_id, viewer.id).first());
}
