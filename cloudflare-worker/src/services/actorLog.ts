/**
 * D637 — one `activity_logs` line for a member's own write: who (the hashed
 * email and the user id), what (the action), on which project when there is
 * one, and the ids the write touched.
 *
 * Best effort, like `logAdminAction`: the write has already happened, and a
 * recorded act undone by its own log line would be worse than the missing
 * line. A failure only warns. The details never carry an address or free text
 * the person typed: ids and states only.
 */
import type { Env } from '../types';
import { hashEmail } from '../util/hashEmail';

export async function logActorAct(
  env: Env,
  user: { id: number; email?: string | null },
  action: string,
  details: Record<string, unknown>,
  projectId: number | null = null,
): Promise<void> {
  try {
    const actor = await hashEmail(String(user.email || ''));
    await env.DB.prepare(
      'INSERT INTO activity_logs (project_id, user_id, action, details, actor) VALUES (?, ?, ?, ?, ?)',
    ).bind(projectId, user.id, action, JSON.stringify(details ?? {}), actor).run();
  } catch (e) {
    console.warn('[actorLog] activity_logs write failed', action, (e as Error).message);
  }
}
