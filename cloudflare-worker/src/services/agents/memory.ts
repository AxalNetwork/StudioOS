/**
 * D1530 (#3849, E5 of #3742) — an agent's memory in one scope (migration
 * 728's `agent_memory_notes`), its retention, its erasure and its export.
 *
 * NOTES. At most 1,000 characters each, never a raw prompt:
 *   `decision`  written by the loop's `after` step, deterministically, once a
 *               person decided a proposal (no model call; `src/agents/loop.ts`);
 *   `fact`      added by a manager on the agent's profile (`addFact`);
 *   `summary`   reserved for the optional weekly `memory_digest` duty, a costed
 *               run whose output is itself a proposal. Not built here.
 * The context step reads the last 20 inside the untrusted-data wrapper.
 *
 * FORGET (the product amendment). A manager forgets one note
 * (`forgetNote`) or everything an agent keeps (`forgetAll`): the rows go.
 *
 * RETENTION (owner Q6 A; counsel still confirms it for EU members). Notes are
 * kept while the agent exists and `RETENTION.notes_days_after_removal` days
 * after it is removed (`onAgentRemoved` sets `expires_at`); a run's step
 * summaries are kept `RETENTION.run_summaries_days` days after it ends. Both
 * are config here, so a change is a config change; `purgeExpired` applies
 * them from the sweep. The profile's sentence (`retentionText`) is built from
 * the same values.
 *
 * ERASURE (the product amendment). A project hard-deleted, a company deleted,
 * or an account deleted removes the memory notes, the run summaries and the
 * queued tasks of the agents concerned (`eraseAgentData`). The account's
 * deletion is a manual erasure today (D168: the platform has no account
 * delete); this is the function that erasure calls.
 *
 * EXPORT. `exportAgentData(userId)`: the agents, rule books, memory notes and
 * run history the member can see, for the account data export.
 *
 * Bound SQL only. Codes in logs, never a note.
 */
import type { Env, User } from '../../types';
import { newUid } from '../../routes/_t13t14t15_helpers';
import { canRead, effectiveBook, scopeOfAgent, type AgentRow } from './teams';

export const NOTE_MAX = 1000;
export const NOTES_PAGE = 100;
/** Q6 A. Counsel confirms for EU members; a change is a change here. */
export const RETENTION = Object.freeze({ notes_days_after_removal: 90, run_summaries_days: 180 });
export const retentionText = (r = RETENTION) =>
  `Notes are kept while this agent works for the team and for ${r.notes_days_after_removal} days after it is removed. `
  + `The step summaries of its runs are kept for ${r.run_summaries_days} days. Managers can forget a note, or everything, at any time.`;

export type NoteRow = {
  id: number; uid: string; agent_id: number; scope_kind: 'company' | 'project'; company_id: number | null; project_id: number | null;
  kind: 'decision' | 'fact' | 'summary'; body: string; run_id: number | null; created_by_user_id: number | null; expires_at: string | null; created_at: string;
};

const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

export async function notesOf(env: Env, a: Pick<AgentRow, 'id'>): Promise<NoteRow[]> {
  return (await env.DB.prepare(
    'SELECT * FROM agent_memory_notes WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
  ).bind(a.id, NOTES_PAGE).all<NoteRow>()).results ?? [];
}

export async function noteByUid(env: Env, uid: string): Promise<NoteRow | null> {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(uid)) return null;
  return env.DB.prepare('SELECT * FROM agent_memory_notes WHERE uid = ?').bind(uid).first<NoteRow>();
}

export type NoteRefusal = { status: number; code: string; message: string };

/** A manager's fact for the agent to keep, in its scope. */
export async function addFact(env: Env, a: AgentRow, body: unknown, by: number): Promise<{ ok: true; note: NoteRow } | { ok: false; refusal: NoteRefusal }> {
  if (typeof body !== 'string' || !body.trim()) return { ok: false, refusal: { status: 400, code: 'invalid_note', message: 'Write the fact first.' } };
  const text = body.trim();
  if (text.length > NOTE_MAX) return { ok: false, refusal: { status: 422, code: 'note_too_long', message: `A note is at most ${NOTE_MAX.toLocaleString('en-US')} characters.` } };
  const uid = newUid();
  await env.DB.prepare(
    `INSERT INTO agent_memory_notes (uid, agent_id, scope_kind, company_id, project_id, kind, body, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, 'fact', ?, ?)`,
  ).bind(uid, a.id, a.scope_kind, a.scope_kind === 'company' ? a.company_id : null, a.scope_kind === 'project' ? a.project_id : null, text, by).run();
  return { ok: true, note: (await noteByUid(env, uid))! };
}

export async function forgetNote(env: Env, n: NoteRow): Promise<void> {
  await env.DB.prepare('DELETE FROM agent_memory_notes WHERE id = ?').bind(n.id).run();
}

/** "Forget everything": every note this agent keeps. Returns how many went. */
export async function forgetAll(env: Env, a: Pick<AgentRow, 'id'>): Promise<number> {
  const r = await env.DB.prepare('DELETE FROM agent_memory_notes WHERE agent_id = ?').bind(a.id).run();
  return Number(r.meta?.changes ?? 0);
}

/** The agent was removed: its notes expire `notes_days_after_removal` days from now. */
export async function onAgentRemoved(env: Env, agentId: number, now = new Date()): Promise<void> {
  const at = new Date(now.getTime() + RETENTION.notes_days_after_removal * 86_400_000);
  await env.DB.prepare('UPDATE agent_memory_notes SET expires_at = ? WHERE agent_id = ? AND expires_at IS NULL').bind(sqlTime(at), agentId).run();
}

/** Apply the retention: notes past their expiry go; step summaries of runs ended too long ago are emptied. */
export async function purgeExpired(env: Env, now = new Date()): Promise<{ notes: number; runs: number }> {
  const notes = await env.DB.prepare('DELETE FROM agent_memory_notes WHERE expires_at IS NOT NULL AND expires_at <= ?').bind(sqlTime(now)).run();
  const before = sqlTime(new Date(now.getTime() - RETENTION.run_summaries_days * 86_400_000));
  const runs = await env.DB.prepare(
    "UPDATE agent_task_runs SET steps_json = '[]', updated_at = CURRENT_TIMESTAMP WHERE ended_at IS NOT NULL AND ended_at <= ? AND steps_json <> '[]'",
  ).bind(before).run();
  return { notes: Number(notes.meta?.changes ?? 0), runs: Number(runs.meta?.changes ?? 0) };
}

export type EraseWhere = { scope: { kind: 'company' | 'project'; id: number } } | { userId: number };

/**
 * The product amendment's D1 half: the memory notes, the run summaries and
 * the queued tasks of the agents concerned. Notes a person wrote about a
 * scope go with the scope; an account's own fact notes go with the account.
 * Queued tasks (agent tasks not done) are cancelled; nothing left to run.
 */
export async function eraseAgentData(env: Env, where: EraseWhere): Promise<void> {
  // One literal statement set per case; the scope's kind picks which, never splices.
  const kind = 'scope' in where ? where.scope.kind : 'account';
  const bind = 'scope' in where ? where.scope.id : where.userId;
  const SETS: Record<'company' | 'project' | 'account', string[]> = {
    company: [
      "DELETE FROM agent_memory_notes WHERE agent_id IN (SELECT id FROM team_agents WHERE scope_kind = 'company' AND company_id = ?1) OR (scope_kind = 'company' AND company_id = ?1)",
      "DELETE FROM agent_task_runs WHERE agent_id IN (SELECT id FROM team_agents WHERE scope_kind = 'company' AND company_id = ?1)",
      "UPDATE scope_tasks SET status = 'cancelled', board_column = CASE WHEN board_column IS NULL THEN NULL ELSE 'done' END, close_reason = CASE WHEN board_column IS NULL THEN NULL ELSE 'not_planned' END, updated_at = CURRENT_TIMESTAMP WHERE assignee_kind = 'agent' AND status IN ('open', 'in_progress', 'waiting_decision', 'blocked') AND assignee_agent_id IN (SELECT id FROM team_agents WHERE scope_kind = 'company' AND company_id = ?1)",
      "UPDATE agent_duties SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE status <> 'removed' AND agent_id IN (SELECT id FROM team_agents WHERE scope_kind = 'company' AND company_id = ?1)",
    ],
    project: [
      "DELETE FROM agent_memory_notes WHERE agent_id IN (SELECT id FROM team_agents WHERE scope_kind = 'project' AND project_id = ?1) OR (scope_kind = 'project' AND project_id = ?1)",
      "DELETE FROM agent_task_runs WHERE agent_id IN (SELECT id FROM team_agents WHERE scope_kind = 'project' AND project_id = ?1)",
      "UPDATE scope_tasks SET status = 'cancelled', board_column = CASE WHEN board_column IS NULL THEN NULL ELSE 'done' END, close_reason = CASE WHEN board_column IS NULL THEN NULL ELSE 'not_planned' END, updated_at = CURRENT_TIMESTAMP WHERE assignee_kind = 'agent' AND status IN ('open', 'in_progress', 'waiting_decision', 'blocked') AND assignee_agent_id IN (SELECT id FROM team_agents WHERE scope_kind = 'project' AND project_id = ?1)",
      "UPDATE agent_duties SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE status <> 'removed' AND agent_id IN (SELECT id FROM team_agents WHERE scope_kind = 'project' AND project_id = ?1)",
    ],
    account: [
      'DELETE FROM agent_memory_notes WHERE agent_id IN (SELECT id FROM team_agents WHERE sponsor_user_id = ?1) OR created_by_user_id = ?1',
      'DELETE FROM agent_task_runs WHERE agent_id IN (SELECT id FROM team_agents WHERE sponsor_user_id = ?1)',
      "UPDATE scope_tasks SET status = 'cancelled', board_column = CASE WHEN board_column IS NULL THEN NULL ELSE 'done' END, close_reason = CASE WHEN board_column IS NULL THEN NULL ELSE 'not_planned' END, updated_at = CURRENT_TIMESTAMP WHERE assignee_kind = 'agent' AND status IN ('open', 'in_progress', 'waiting_decision', 'blocked') AND assignee_agent_id IN (SELECT id FROM team_agents WHERE sponsor_user_id = ?1)",
      "UPDATE agent_duties SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE status <> 'removed' AND agent_id IN (SELECT id FROM team_agents WHERE sponsor_user_id = ?1)",
    ],
  };
  await env.DB.batch(SETS[kind].map((sql) => env.DB.prepare(sql).bind(bind)));
}

/**
 * The agents, rule books, memory notes and run history the member can see:
 * the agents they sponsor, and those of every team they can read (their
 * companies and the projects they run). Never an email, never another
 * member's numeric id.
 */
export async function exportAgentData(env: Env, user: User) {
  const candidates = (await env.DB.prepare(
    `SELECT a.* FROM team_agents a
      WHERE a.sponsor_user_id = ?
         OR (a.scope_kind = 'company' AND a.company_id IN (SELECT company_id FROM user_company_links WHERE user_id = ?))
         OR (a.scope_kind = 'project' AND a.project_id IN (SELECT p.id FROM projects p JOIN users u ON u.founder_id = p.founder_id WHERE u.id = ?))
      ORDER BY a.id LIMIT 200`,
  ).bind(user.id, user.id, user.id).all<AgentRow>()).results ?? [];
  const agents = [];
  for (const a of candidates) {
    const s = await scopeOfAgent(env, a);
    if (!s || !(await canRead(env, s, user))) continue;
    const { rules } = await effectiveBook(env, s, a.role_key);
    const notes = (await env.DB.prepare(
      'SELECT kind, body, created_at FROM agent_memory_notes WHERE agent_id = ? ORDER BY created_at, id',
    ).bind(a.id).all<{ kind: string; body: string; created_at: string }>()).results ?? [];
    const runs = (await env.DB.prepare(
      'SELECT uid, status, refusal, steps_json, created_at, ended_at FROM agent_task_runs WHERE agent_id = ? ORDER BY id',
    ).bind(a.id).all<{ uid: string; status: string; refusal: string | null; steps_json: string; created_at: string; ended_at: string | null }>()).results ?? [];
    agents.push({
      uid: a.uid, role_key: a.role_key, first_name: a.first_name, last_name: a.last_name, status: a.status,
      scope: s.kind, rule_book: rules, memory_notes: notes,
      runs: runs.map((r) => {
        let steps: unknown = [];
        try { steps = (JSON.parse(r.steps_json) || []).map((x: any) => ({ name: x?.name, status: x?.status, at: x?.at, summary: x?.summary })); } catch { steps = []; }
        return { uid: r.uid, status: r.status, refusal: r.refusal, started: r.created_at, ended: r.ended_at, steps };
      }),
    });
  }
  return { agents, retention: { ...RETENTION, text: retentionText() } };
}

export const noteDto = async (env: Env, n: NoteRow) => {
  const by = n.created_by_user_id
    ? await env.DB.prepare('SELECT uid, name FROM users WHERE id = ?').bind(n.created_by_user_id).first<{ uid: string; name: string }>()
    : null;
  return { uid: n.uid, kind: n.kind, body: n.body, by: by ? { uid: by.uid, name: by.name } : null, at: n.created_at, expires_at: n.expires_at };
};
