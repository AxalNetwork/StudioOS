/**
 * Task #19 — Match-list audit.
 *
 * Writes an activity_logs entry whenever an ADMIN generates a match list.
 * Mirrors admin_advisor_audit.ts::logAdminAction (same columns) and is a
 * no-op for non-admin callers (founders generating their own match lists are
 * not audited). Never throws — auditing must not break the match response.
 */
import type { Env } from '../types';
import { hashEmail } from '../util/hashEmail';

export async function logMatchListGeneration(
  env: Env,
  user: { id: number; email?: string | null; role?: string | null },
  kind: string,
  details: Record<string, unknown>,
): Promise<void> {
  if ((user.role || '').toLowerCase() !== 'admin') return;
  try {
    const actor = await hashEmail(user.email || '');
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind('match_list_generated', JSON.stringify({ kind, ...details }), actor, user.id).run();
  } catch (e) {
    console.warn('[matchAudit] activity log:', (e as Error).message);
  }
}
