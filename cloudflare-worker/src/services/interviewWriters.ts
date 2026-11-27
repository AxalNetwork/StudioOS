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
 * `addInterviewPain` (D757, #1897) is an accepted pain's mention: the phrase
 * appended to the interview's `pains_json`, as a guarded statement its caller
 * batches with the severity and the theme.
 *
 * None decides who may write: the caller has checked `canWrite` (or the
 * route's `ensureCanEdit`) for the venture, and each statement is scoped to
 * the interview's own `project_id`.
 */
import type { Env } from '../types';
import { logCycleWrite } from './cycleActivity';
import { deleteSession, type SessionRow } from './interviewSessions';
import { presentTables } from './interviewFindings';
import { normPhrase } from './painGroups';
import { WriterError } from './validateWriters';
import { MAX_PAIN_PHRASE } from '../routes/_founder_validate_writes';

const detail = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);

/**
 * Edit details: the name (required, trimmed, as the PUT requires it), the
 * company and, since D757 (#1923), the role (an empty one is stored as NULL).
 * No other column is written, and the log row names the interview by id,
 * never the interviewee.
 *
 * `fillEmpty` is an interview suggestion's Accept (a `firmographic` role or
 * company): the name is not touched, and the one field given is written only
 * where it is empty. A field the founder already filled is never overwritten
 * by a suggestion; that refusal puts the suggestion back to pending.
 */
export async function updateInterviewDetails(
  env: Env,
  input: {
    projectId: number; userId: number | null; interviewId: number; interviewee_name?: unknown;
    interviewee_company?: unknown; interviewee_role?: unknown; fillEmpty?: boolean;
  },
): Promise<{ id: number }> {
  if (input.fillEmpty) return fillInterviewDetail(env, input);
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
  if (input.interviewee_role !== undefined) {
    await env.DB.prepare(
      "UPDATE discovery_interviews SET interviewee_role = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?",
    ).bind(detail(input.interviewee_role), input.interviewId, input.projectId).run();
  }
  await logCycleWrite(env, {
    projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'customer-research',
    entityId: input.interviewId, action: 'interview_details_edited', summary: `Interview ${input.interviewId} details edited`,
  });
  return { id: input.interviewId };
}

async function fillInterviewDetail(
  env: Env,
  input: { projectId: number; userId: number | null; interviewId: number; interviewee_company?: unknown; interviewee_role?: unknown },
): Promise<{ id: number }> {
  const role = input.interviewee_role !== undefined;
  const company = input.interviewee_company !== undefined;
  if (role === company) throw new WriterError(400, 'Fill one field: the role or the company');
  const value = detail(role ? input.interviewee_role : input.interviewee_company);
  if (!value) throw new WriterError(400, role ? 'A role needs a value' : 'A company needs a value');
  // Two literal statements, one per column: an empty field is NULL or blank.
  const res = await (role
    ? env.DB.prepare(
      "UPDATE discovery_interviews SET interviewee_role = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ? AND (interviewee_role IS NULL OR trim(interviewee_role) = '')",
    )
    : env.DB.prepare(
      "UPDATE discovery_interviews SET interviewee_company = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ? AND (interviewee_company IS NULL OR trim(interviewee_company) = '')",
    )).bind(value, input.interviewId, input.projectId).run();
  if (!res.meta?.changes) {
    const iv = await env.DB.prepare('SELECT id FROM discovery_interviews WHERE id = ? AND project_id = ?')
      .bind(input.interviewId, input.projectId).first();
    if (!iv) throw new WriterError(404, 'Interview not found on this project');
    throw new WriterError(409, role
      ? 'This interview already has a role. Change it in Edit details.'
      : 'This interview already has a company. Change it in Edit details.');
  }
  await logCycleWrite(env, {
    projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'customer-research',
    entityId: input.interviewId, action: 'interview_details_edited', summary: `Interview ${input.interviewId} ${role ? 'role' : 'company'} filled from a suggestion`,
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
  // D757 §2.13 (#1923) — the interview's findings and its interview-kind
  // evidence links go explicitly: D1 may run with foreign keys off, and an
  // evidence link names the interview by `ref_id`, with no foreign key at all.
  const tables = await presentTables(env, ['interview_findings', 'hypothesis_evidence_links']);
  await env.DB.batch([
    ...(tables.has('interview_findings')
      ? [env.DB.prepare('DELETE FROM interview_findings WHERE interview_id = ? AND project_id = ?').bind(input.interviewId, input.projectId)]
      : []),
    ...(tables.has('hypothesis_evidence_links')
      ? [env.DB.prepare("DELETE FROM hypothesis_evidence_links WHERE kind = 'interview' AND ref_id = ? AND project_id = ?").bind(String(input.interviewId), input.projectId)]
      : []),
    env.DB.prepare('DELETE FROM discovery_interviews WHERE id = ? AND project_id = ?').bind(input.interviewId, input.projectId),
  ]);
  await logCycleWrite(env, {
    projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'customer-research',
    entityId: input.interviewId, action: 'interview_deleted', summary: `Interview ${input.interviewId} deleted`,
  });
  return { deleted: input.interviewId, sessions_deleted: (owned.results || []).length };
}

export type AddedPain = {
  norm: string;
  display: string;
  added: boolean;
  /** What the row holds once the batch has run; the guard the batch's other statements carry. */
  painsJson: string | null;
  /** The guarded UPDATE when the phrase is new, else nothing. */
  statements: ReturnType<Env['DB']['prepare']>[];
};

/**
 * D757 (#1897) — one pain mention, deduplicated by `normPhrase`.
 *
 * The list is a JSON blob and `normPhrase` is a regex SQL cannot run, so this
 * reads first and returns a statement guarded on the value it read: when the
 * founder's form or a second Accept changes the list in between, the UPDATE
 * writes nothing and its caller's batch can tell. A phrase the interview
 * already holds, in any wording, appends nothing and keeps the stored wording.
 *
 * A stored value that is not a JSON array is refused, never overwritten:
 * `safeParseStrings` would read it as empty and the write would erase the
 * founder's text.
 */
export async function addInterviewPain(
  env: Env,
  input: { projectId: number; interviewId: number; phrase: string },
): Promise<AddedPain> {
  const display = String(input.phrase ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_PAIN_PHRASE);
  const norm = normPhrase(display);
  if (!norm) throw new WriterError(400, 'A pain needs a phrase');
  const row = await env.DB.prepare('SELECT pains_json FROM discovery_interviews WHERE id = ? AND project_id = ?')
    .bind(input.interviewId, input.projectId).first<{ pains_json: string | null }>();
  if (!row) throw new WriterError(404, 'Interview not found on this project');
  const raw = row.pains_json ?? null;
  let stored: unknown[] = [];
  if (raw != null && raw.trim() !== '') {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!Array.isArray(parsed)) {
      throw new WriterError(409, "This interview's pains could not be read, so nothing was added. Open the interview and save its pains first.");
    }
    stored = parsed;
  }
  const same = stored.find((x) => normPhrase(typeof x === 'string' ? x : String(x ?? '')) === norm);
  if (same !== undefined) {
    return { norm, display: typeof same === 'string' ? same.trim() : String(same), added: false, painsJson: raw, statements: [] };
  }
  const next = JSON.stringify([...stored, display]);
  return {
    norm, display, added: true, painsJson: next,
    statements: [env.DB.prepare(
      "UPDATE discovery_interviews SET pains_json = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ? AND pains_json IS ?",
    ).bind(next, input.interviewId, input.projectId, raw)],
  };
}
