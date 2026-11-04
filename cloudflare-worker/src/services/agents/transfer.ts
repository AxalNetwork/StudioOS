/**
 * #3850 (E6 of #3742, D1528 §4.4) — what a project's move does to the agent
 * engine.
 *
 * A project inside a company is under the company's authority (owner rule,
 * 2026-10-31, #3697). Moving it — into a company, out of one, or between two —
 * changes, in the SAME batch as `projects.company_id` (`projectMoveStatements`,
 * `services/projectMove.ts`), and only when it leaves a company:
 *
 *   - its goals no longer roll up to the old company's goals (`parent_goal_id`
 *     cut);
 *   - the old company's tasks about it (`context_project_id`) still open are
 *     `blocked` with `project_left`, and lose the project (`context_project_id`
 *     cleared), each with a `scope_task_events` row naming the move.
 *
 * The move and these commit together or not at all (`transferStatements` only
 * returns bound statements; the caller batches them).
 *
 * What travels and what stays (§4.4):
 *   project agents, goals, tasks, memory, rule books and custom roles travel —
 *   they are the project's, keyed by `project_id`, so nothing is rewritten; the
 *   object name `project:{id}` is unchanged. The old company's agents stay and
 *   lose the project at once: their tasks about it are blocked here, and a
 *   company agent reads a project only while it is still the company's
 *   (`loop.ts` context step).
 *
 * After the batch commits, `onProjectMoved`: in-flight runs of the project's
 * agents, and of the old company's agents on the blocked tasks, end
 * `scope_moved` at their next step (owner Q5 A; a proposal already made stays
 * decidable); the scope objects of the project and of both companies tell
 * their live boards (`scope_moved`); the agents' teams are told.
 */
import type { Env } from '../../types';
import type { ScopeRef } from '../../agents/runtime';
import { personaOf } from './personas';

export type Move = { projectId: number; from: number | null; to: number | null; actorUserId: number };

/** The transfer's statements, bound and not run, for the move's own batch. Empty when the project left no company. */
export function transferStatements(env: Pick<Env, 'DB'>, m: Move): D1PreparedStatement[] {
  if (m.from == null || m.from === m.to) return [];
  const detail = JSON.stringify({ reason: 'project_left', project_id: m.projectId, from: m.from, to: m.to });
  return [
    // The project's goals stop rolling up to the old company's goals.
    env.DB.prepare(
      `UPDATE scope_goals SET parent_goal_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE scope_kind = 'project' AND project_id = ?
          AND parent_goal_id IN (SELECT id FROM scope_goals WHERE scope_kind = 'company' AND company_id = ?)`,
    ).bind(m.projectId, m.from),
    // The event first, while the tasks still name the project and their status.
    env.DB.prepare(
      `INSERT INTO scope_task_events (task_id, actor_user_id, kind, detail_json)
       SELECT id, ?, 'status', json_set(?, '$.status_from', status, '$.status_to', 'blocked') FROM scope_tasks WHERE scope_kind = 'company' AND company_id = ? AND context_project_id = ? AND status NOT IN ('done', 'cancelled', 'blocked')`,
    ).bind(m.actorUserId, detail, m.from, m.projectId),
    env.DB.prepare(
      `UPDATE scope_tasks SET status = 'blocked', blocked_reason = 'project_left', context_project_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE scope_kind = 'company' AND company_id = ? AND context_project_id = ? AND status NOT IN ('done', 'cancelled', 'blocked')`,
    ).bind(m.from, m.projectId),
    // A task already blocked or finished keeps its status, but no longer names the project.
    env.DB.prepare(
      `UPDATE scope_tasks SET context_project_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE scope_kind = 'company' AND company_id = ? AND context_project_id = ?`,
    ).bind(m.from, m.projectId),
  ];
}

/** The live board of each scope the move touched, told what happened. */
export type MoveTell = (scope: ScopeRef, move: { project_id: number; from: number | null; to: number | null; ended: string[] }) => Promise<void>;
export type MovedDeps = { tell: MoveTell; notify: (env: Env, agentId: number, body: string) => Promise<void> };

/**
 * After the move's batch commits. Ends the in-flight runs `scope_moved`, tells
 * the boards and the teams. Every part is best effort: the move has happened,
 * and a run the update misses still ends at its next `load` or `context` step,
 * which re-check the project's company.
 */
export async function onProjectMoved(env: Env, m: Move, deps: MovedDeps): Promise<{ ended: number }> {
  if (m.from === m.to) return { ended: 0 };
  const runs = (await env.DB.prepare(
    `SELECT r.uid, r.agent_id, r.task_id, a.scope_kind FROM agent_task_runs r JOIN team_agents a ON a.id = r.agent_id JOIN scope_tasks t ON t.id = r.task_id
      WHERE r.status IN ('admitted', 'running')
        AND ((a.scope_kind = 'project' AND a.project_id = ?)
          OR (? IS NOT NULL AND a.scope_kind = 'company' AND a.company_id = ? AND t.status = 'blocked' AND t.blocked_reason = 'project_left'))`,
  ).bind(m.projectId, m.from, m.from).all<{ uid: string; agent_id: number; task_id: number; scope_kind: string }>()).results ?? [];
  let ended = 0;
  const endedUids: string[] = [];
  const line = JSON.stringify({ name: 'load', at: new Date().toISOString().replace('T', ' ').slice(0, 19), status: 'refused', summary: 'The project moved to another company.' });
  for (const r of runs) {
    const res = await env.DB.prepare(
      `UPDATE agent_task_runs
          SET status = 'scope_moved', refusal = 'scope_moved', steps_json = json_insert(steps_json, '$[#]', json(?)),
              ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE uid = ? AND status IN ('admitted', 'running')`,
    ).bind(line, r.uid).run();
    if (Number(res.meta?.changes ?? 0) > 0) {
      ended += 1;
      endedUids.push(r.uid);
      // A project agent's task travels with it: open again, for the next run. The old company's task stays blocked.
      if (r.scope_kind === 'project') {
        // `moveTask` keeps a project board's column with the status (in_progress → ready), as a run's own end does.
        const { moveTask } = await import('../../agents/engine');
        await moveTask(env, r.task_id, 'open', ['in_progress']);
      }
    }
  }
  const move = { project_id: m.projectId, from: m.from, to: m.to, ended: endedUids };
  const scopes: ScopeRef[] = [{ kind: 'project', id: m.projectId }];
  if (m.from != null) scopes.push({ kind: 'company', id: m.from });
  if (m.to != null) scopes.push({ kind: 'company', id: m.to });
  for (const s of scopes) {
    try { await deps.tell(s, move); } catch { console.warn('[agents] move_tell_failed'); }
  }
  // The teams of the agents that moved, and of the old company's agents that lost the project.
  const told = new Set<number>();
  const agents = (await env.DB.prepare(
    `SELECT id, scope_kind FROM team_agents WHERE status <> 'removed'
       AND ((scope_kind = 'project' AND project_id = ?) OR (? IS NOT NULL AND scope_kind = 'company' AND company_id = ?
            AND id IN (SELECT assignee_agent_id FROM scope_tasks WHERE status = 'blocked' AND blocked_reason = 'project_left' AND assignee_agent_id IS NOT NULL)))`,
  ).bind(m.projectId, m.from, m.from).all<{ id: number; scope_kind: string }>()).results ?? [];
  for (const a of agents) {
    if (told.has(a.id)) continue;
    told.add(a.id);
    const body = a.scope_kind === 'project'
      ? 'The project moved. Its agents came with it; a run in progress stopped, and its open proposals stay decidable.'
      : 'A project left this company. Its agents can no longer read it, and their tasks about it are blocked.';
    try { await deps.notify(env, a.id, body); } catch { /* one inbox never stops the move */ }
  }
  return { ended };
}

/**
 * An owner-seat transfer away from an agent's sponsor: the project's agents the
 * previous owner sponsored pause `sponsor_left` when the sponsor can no longer
 * manage the team (#3727's sponsor check), and are told once.
 */
export async function sponsorsLeft(env: Env, projectId: number, previousOwner: number | null,
  pause: (env: Env, agentId: number) => Promise<void>, stillManages: (env: Env, userId: number) => Promise<boolean>): Promise<number> {
  if (previousOwner == null) return 0;
  if (await stillManages(env, previousOwner)) return 0;
  const agents = (await env.DB.prepare(
    `SELECT id FROM team_agents WHERE scope_kind = 'project' AND project_id = ? AND sponsor_user_id = ? AND status = 'active'`,
  ).bind(projectId, previousOwner).all<{ id: number }>()).results ?? [];
  for (const a of agents) {
    // One agent's pause (or its notice) failing never leaves the others running.
    try { await pause(env, a.id); } catch { console.warn('[agents] sponsor_pause_failed'); }
  }
  return agents.length;
}

export type MoveRow = {
  direction: 'in' | 'out';
  project: { id: number; name: string };
  from: { uid: string; name: string } | null;
  to: { uid: string; name: string } | null;
  by: { uid: string; name: string } | null;
  at: string;
  blocked_tasks: number;
  /** #4394 (TM18b): on an `out` move only, this scope's own agents' runs the move stopped (`scope_moved`). */
  stopped_runs?: StoppedRun[];
};
export type StoppedRun = { agent: { uid: string; persona: { key: string; name: string } | null }; task: { uid: string; title: string } };

/**
 * The moves a scope saw, newest first (TM18's banner): a company's projects
 * coming in and going out, or one project's own moves. `blocked_tasks` counts
 * the old company's tasks the move blocked (`project_left`).
 */
export async function movesOf(env: Pick<Env, 'DB'>, scope: ScopeRef, limit: number): Promise<MoveRow[]> {
  // One query for both: a project matches its own id; a company matches either side of the move.
  const [projectId, companyId] = scope.kind === 'project' ? [scope.id, null] : [null, scope.id];
  const rows = (await env.DB.prepare(
    `SELECT e.project_id, p.name AS project_name, e.created_at,
            json_extract(e.before_json, '$.company_id') AS from_id, json_extract(e.after_json, '$.company_id') AS to_id,
            cf.uid AS from_uid, cf.company_name AS from_name, ct.uid AS to_uid, ct.company_name AS to_name,
            u.uid AS by_uid, u.name AS by_name,
            (SELECT COUNT(*) FROM scope_task_events te
              WHERE te.kind = 'status' AND json_extract(te.detail_json, '$.reason') = 'project_left'
                AND json_extract(te.detail_json, '$.project_id') = e.project_id
                AND te.created_at = e.created_at) AS blocked_tasks
       FROM company_membership_events e
       JOIN projects p ON p.id = e.project_id
       LEFT JOIN company_profiles cf ON cf.id = json_extract(e.before_json, '$.company_id')
       LEFT JOIN company_profiles ct ON ct.id = json_extract(e.after_json, '$.company_id')
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.kind = 'project_move'
        AND ((? IS NOT NULL AND e.project_id = ?)
          OR (? IS NOT NULL AND (json_extract(e.before_json, '$.company_id') = ? OR json_extract(e.after_json, '$.company_id') = ?)))
      ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
  ).bind(projectId, projectId, companyId, companyId, companyId, limit).all<any>()).results ?? [];
  const out: MoveRow[] = [];
  for (const r of rows) {
    // A company: did the project come in or go out? A project: did it move into a company, or out of every company?
    const direction: 'in' | 'out' = scope.kind === 'company' ? (Number(r.from_id) === scope.id ? 'out' : 'in') : (r.to_id != null ? 'in' : 'out');
    out.push({
    direction,
    project: { id: Number(r.project_id), name: String(r.project_name ?? '') },
    from: r.from_uid ? { uid: String(r.from_uid), name: String(r.from_name ?? '') } : null,
    to: r.to_uid ? { uid: String(r.to_uid), name: String(r.to_name ?? '') } : null,
    by: r.by_uid ? { uid: String(r.by_uid), name: String(r.by_name ?? '') } : null,
    at: String(r.created_at),
    blocked_tasks: Number(r.blocked_tasks ?? 0),
    ...(direction === 'out' ? { stopped_runs: await stoppedRuns(env, scope, Number(r.project_id), String(r.created_at)) } : {}),
    });
  }
  return out;
}

/**
 * #4394 (TM18b): the runs a move stopped, as this scope sees them: only its
 * OWN agents' runs (a project reads its agents; the company it left reads its
 * agents whose tasks the move blocked), never the other side's. A run counts
 * when it ended `scope_moved` after this move and before the project's next
 * move. A person is never named here; an agent by its persona (D4117).
 */
async function stoppedRuns(env: Pick<Env, 'DB'>, scope: ScopeRef, projectId: number, at: string): Promise<StoppedRun[]> {
  const rows = (await env.DB.prepare(
    `SELECT a.uid AS agent_uid, a.persona_key, t.uid AS task_uid, t.title AS task_title
       FROM agent_task_runs r JOIN team_agents a ON a.id = r.agent_id JOIN scope_tasks t ON t.id = r.task_id
      WHERE r.status = 'scope_moved' AND r.ended_at >= ?
        AND r.ended_at < COALESCE((SELECT MIN(n.created_at) FROM company_membership_events n
                                    WHERE n.kind = 'project_move' AND n.project_id = ? AND n.created_at > ?), '9999-12-31')
        AND ((? = 'project' AND a.scope_kind = 'project' AND a.project_id = ?)
          OR (? = 'company' AND a.scope_kind = 'company' AND a.company_id = ? AND t.blocked_reason = 'project_left'))
      ORDER BY r.ended_at, r.id LIMIT 50`,
  ).bind(at, projectId, at, scope.kind, projectId, scope.kind, scope.id).all<{ agent_uid: string; persona_key: string | null; task_uid: string; task_title: string }>()).results ?? [];
  return rows.map((r) => {
    const p = personaOf(r.persona_key);
    return { agent: { uid: r.agent_uid, persona: p ? { key: p.key, name: p.name } : null }, task: { uid: r.task_uid, title: r.task_title } };
  });
}

/** The deps a real move uses: the scope objects (`doRuntime.tellMoved`) and the agents' teams (`engine.tellTeam`). */
export async function liveMovedDeps(env: Env): Promise<MovedDeps> {
  const [{ tellMoved }, { tellTeam }] = await Promise.all([import('../../agents/doRuntime'), import('../../agents/engine')]);
  return {
    tell: (scope, move) => tellMoved(env, scope, move),
    notify: async (e, agentId, body) => {
      const a = await e.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(agentId).first<any>();
      if (a) await tellTeam(e, a, { type: 'agent_project_moved', title: 'A project moved', body });
    },
  };
}

/**
 * Called by every caller of `projectMoveStatements` once its batch has
 * committed (the move route, the filing), never before. Never throws: the
 * move has happened, and a run it misses still ends at its next step.
 */
export async function afterMove(env: Env, m: Move, deps?: MovedDeps): Promise<{ ended: number }> {
  try {
    return await onProjectMoved(env, m, deps ?? await liveMovedDeps(env));
  } catch (e) {
    console.warn('[agents] after_move_failed', (e as Error)?.name);
    return { ended: 0 };
  }
}
