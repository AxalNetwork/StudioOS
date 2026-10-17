/**
 * D690 (#1692) — the interview writes Customer research's record calls.
 *
 * `updateInterviewDetails` is decision 18's Edit details: the interviewee's
 * name and company and nothing else. `PUT /progress/discovery/interview/:id`
 * writes every field it is not sent as empty, so an edit of the name alone
 * through it would blank the role, the notes, the hypotheses and the pains.
 * That route keeps its behaviour for its existing callers; this writer never
 * calls it.
 *
 * `deleteInterview` is the body of `DELETE /progress/discovery/interview/:id`,
 * moved here so the record's `delete` action and that route are one writer.
 * The route keeps its own auth and calls it.
 *
 * Neither decides who may write: the caller has checked `canWrite` (or the
 * route's `ensureCanEdit`) for the venture, and each statement is scoped to
 * the interview's own `project_id`.
 */
import type { Env } from '../types';
import { logCycleWrite } from './cycleActivity';
import { deleteSession, type SessionRow } from './interviewSessions';
import { WriterError } from './validateWriters';

/**
 * Edit details: the name (required, trimmed, as the PUT requires it) and the
 * company (an empty one is stored as NULL). No other column is written, and
 * the log row names the interview by id, never the interviewee.
 */
export async function updateInterviewDetails(
  env: Env,
  input: { projectId: number; userId: number | null; interviewId: number; interviewee_name: unknown; interviewee_company?: unknown },
): Promise<{ id: number }> {
  const name = typeof input.interviewee_name === 'string' ? input.interviewee_name.trim().slice(0, 200) : '';
  if (!name) throw new WriterError(400, 'An interviewee needs a name');
  const company = input.interviewee_company === undefined ? undefined
    : (typeof input.interviewee_company === 'string' && input.interviewee_company.trim() ? input.interviewee_company.trim().slice(0, 200) : null);
  const res = company === undefined
    ? await env.DB.prepare(
      "UPDATE discovery_interviews SET interviewee_name = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?",
    ).bind(name, input.interviewId, input.projectId).run()
    : await env.DB.prepare(
      "UPDATE discovery_interviews SET interviewee_name = ?, interviewee_company = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?",
    ).bind(name, company, input.interviewId, input.projectId).run();
  if (!res.meta?.changes) throw new WriterError(404, 'Interview not found on this project');
  await logCycleWrite(env, {
    projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'customer-research',
    entityId: input.interviewId, action: 'interview_details_edited', summary: `Interview ${input.interviewId} details edited`,
  });
  return { id: input.interviewId };
}

/**
 * Delete an interview and everything its sessions hold.
 *
 * D685 §5.11 — each session goes the way DELETE /sessions/:id sends it: its
 * R2 audio, its rows, and its pending proposals with their quotes. Deleting
 * the row alone left the audio in R2 and the proposals behind (the CASCADE
 * reaches the session rows, not R2, and validate_proposals has no FK).
 */
export async function deleteInterview(
  env: Env,
  input: { projectId: number; userId: number; interviewId: number },
): Promise<{ deleted: number; sessions_deleted: number }> {
  const existing = await env.DB.prepare('SELECT id FROM discovery_interviews WHERE id = ? AND project_id = ?')
    .bind(input.interviewId, input.projectId).first<{ id: number }>();
  if (!existing) throw new WriterError(404, 'Interview not found on this project');
  const owned = await env.DB.prepare('SELECT * FROM interview_sessions WHERE interview_id = ?')
    .bind(input.interviewId).all<SessionRow>().catch(() => ({ results: [] as SessionRow[] }));
  for (const session of owned.results || []) await deleteSession(env, session, input.userId);
  await env.DB.prepare('DELETE FROM discovery_interviews WHERE id = ? AND project_id = ?')
    .bind(input.interviewId, input.projectId).run();
  await logCycleWrite(env, {
    projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'customer-research',
    entityId: input.interviewId, action: 'interview_deleted', summary: `Interview ${input.interviewId} deleted`,
  });
  return { deleted: input.interviewId, sessions_deleted: (owned.results || []).length };
}
