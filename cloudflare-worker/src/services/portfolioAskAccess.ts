import type { Env } from '../types';

/** D4636's recorded investor delivery. Modern reservations alone do not grant access. */
export async function receivedInvestorUpdate(env: Env, updateId: number, userId: number): Promise<boolean> {
  return !!(await env.DB.prepare(
    `SELECT 1 FROM update_recipients
      WHERE update_id = ? AND user_id = ? AND audience = 'investor'
        AND (version_id IS NULL OR delivery_state = 'delivered')
      LIMIT 1`,
  ).bind(updateId, userId).first());
}
