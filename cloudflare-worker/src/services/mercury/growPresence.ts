/**
 * D840 part 3 (#2348) — whether a venture's founder holds an active Mercury
 * connection, for the durability checklist's runway item (`growCycle.ts`).
 *
 * A LEAF, ON PURPOSE. `growCycle.ts` is read by admin routes, crons, Eadwyn's
 * readers and the fund modules; this file imports nothing, so none of them
 * reaches member bank code through it. It reads one row's existence, never a
 * credential or a figure.
 */
import type { Env } from '../../types';

export async function founderHasMercury(env: Env, projectId: number): Promise<boolean> {
  return !!(await env.DB.prepare(
    `SELECT 1 FROM integrations i JOIN users u ON u.id = i.user_id JOIN projects p ON p.founder_id = u.founder_id
      WHERE p.id = ? AND i.provider_key = 'mercury' AND i.status = 'active' LIMIT 1`,
  ).bind(projectId).first());
}
