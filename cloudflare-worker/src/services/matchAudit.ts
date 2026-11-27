/**
 * Task #19 — Match-list audit.
 *
 * Records that an ADMIN generated a match list. A no-op for non-admin callers
 * (founders generating their own match lists are not audited), and it never
 * throws — auditing must not break the match response.
 *
 * D159 — IT DELEGATES NOW, AND THAT IS THE FIX. This file used to carry its
 * own INSERT, and its header said it "mirrors admin_advisor_audit.ts
 * ::logAdminAction (same columns)". That was true, and it is how it inherited
 * that copy's gap: both wrote `activity_logs` and neither wrote
 * `admin_audit_log`, so an admin generating a match list over other people
 * appeared on no governance surface. `match_list_generated` is not in
 * `ACTOR_SIDE_ACTIONS`, the eight-action allowlist the H7 feed's activity_logs
 * arm reads, so the row it did write was unreachable from there too.
 */
import type { Env } from '../types';
import { logAdminAction } from './adminAudit';

export async function logMatchListGeneration(
  env: Env,
  user: { id: number; email?: string | null; role?: string | null },
  kind: string,
  details: Record<string, unknown>,
): Promise<void> {
  if ((user.role || '').toLowerCase() !== 'admin') return;
  // No `target_user_id`: a match list is generated over a set, not about one
  // person, so the feed's Target column is legitimately blank here rather than
  // carrying the first row of a list passed off as the subject.
  await logAdminAction(env, user.id, user.email || '', 'match_list_generated', { kind, ...details });
}
