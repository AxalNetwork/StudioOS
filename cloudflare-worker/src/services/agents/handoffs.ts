/**
 * D1530 (#3849, E5 of #3742) — agent to agent handoffs, as proposals
 * (migration 728's `agent_handoffs`).
 *
 * HOW AN AGENT PROPOSES ONE. Any run may end its output with one line
 *   {"handoff":{"to_role":"general_counsel","title":"…","why":"…","note":"…"}}
 * and the run's `propose` step (`src/agents/loop.ts`) reads it. The prompt
 * names the roles this agent may hand off to (`handsOffTo`), so no other
 * module or option is needed. The handoff is its own proposal in #3727's
 * approvals queue, on the rail option `propose:handoff`, beside the run's
 * own draft: a person decides each.
 *
 * ALLOWED ONLY WHEN, each refused in its own code and recorded as a
 * `refused` step of the chain, so the trail shows it:
 *   `not_allowed`     `to_role` is not in the agent's `hands_off_to`;
 *   `no_target`       no live agent of that role in the same scope, nor (for
 *                     a project agent) in the company the project is under;
 *   `depth_exceeded`  the chain is already 3 steps deep;
 *   `handoff_loop`    the target is already in the chain;
 *   `chain_ended`     the chain already has a step at that depth (a discarded
 *                     one ends it: migration 728 keeps one step per depth).
 * A refusal with no place in its chain (`depth_exceeded`, `chain_ended`) is
 * recorded as a one-step chain of its own, so the trail still shows it.
 *
 * ON ACCEPT (or edit) the target gets a task (`kind = 'handoff'`,
 * `source_kind = 'handoff'`, `source_ref` the handoff's uid) in its own scope;
 * nothing runs until a person presses Start (with `self_start`, the scope's
 * object is asked to admit it). DISCARD ends the chain. The target is read
 * again at Accept: a target removed in between refuses `no_target`.
 *
 * UNTRUSTED. The why and the note are a model's words. They never enter a
 * task's title or detail; the target's run reads them only inside the
 * untrusted-data wrapper (`handoffBlockFor`).
 *
 * Bound SQL only. Codes in logs, never a title, a note or a prompt.
 */
import type { Env } from '../../types';
import { proposeRail } from '../railProposals';
import { optionsIn } from './catalogue';
import { insertTask, taskEvent, type TaskRow } from './tasks';
import { effectiveBook, scopeOfAgent, type AgentRow, type Scope } from './teams';

export const HANDOFF_OPTION = 'propose:handoff';
export const HANDOFF_PAGE = 'Founder · Studio';
export const DEPTH_MAX = 3;
export const NOTE_MAX = 1000;
const TITLE_MAX = 200;

/**
 * The roles each catalogue role may hand off to (D1530's draft, for the owner
 * to review). A role never hands off to itself.
 */
export const HANDS_OFF_TO: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ceo: ['cfo', 'cto', 'cpo', 'coo', 'cmo', 'sales', 'general_counsel', 'people', 'investor_relations', 'research_analyst'],
  cto: ['cpo', 'coo'],
  cpo: ['cto', 'cmo', 'research_analyst'],
  cfo: ['general_counsel', 'investor_relations', 'ceo'],
  cmo: ['sales', 'cpo'],
  sales: ['cmo', 'general_counsel'],
  coo: ['ceo', 'cfo', 'people'],
  general_counsel: ['cfo', 'ceo'],
  people: ['coo', 'general_counsel'],
  research_analyst: ['cpo', 'cmo'],
  investor_relations: ['cfo', 'ceo', 'general_counsel'],
});

/** The roles this agent may hand off to: its catalogue role's, or a custom role's own list. */
export async function handsOffTo(env: Env, a: Pick<AgentRow, 'role_key' | 'scope_kind' | 'company_id' | 'project_id'>): Promise<string[]> {
  const m = /^custom:([A-Za-z0-9_-]{6,64})$/.exec(a.role_key);
  if (!m) return [...(HANDS_OFF_TO[a.role_key] ?? [])];
  try {
    const row = await env.DB.prepare(
      `SELECT hands_off_to_json FROM agent_custom_roles
        WHERE uid = ? AND status = 'live' AND scope_kind = ? AND company_id IS ? AND project_id IS ?`,
    ).bind(m[1], a.scope_kind, a.company_id, a.project_id).first<{ hands_off_to_json: string }>();
    const list = row ? JSON.parse(row.hands_off_to_json) : [];
    return Array.isArray(list) ? list.filter((k: unknown): k is string => typeof k === 'string' && k !== a.role_key) : [];
  } catch {
    return [];
  }
}

export type HandoffAsk = { to_role: string; title: string; why: string | null; note: string | null };
export type HandoffRow = {
  id: number; uid: string; chain_uid: string; depth: number; from_agent_id: number; to_role_key: string; to_agent_id: number | null;
  from_task_id: number | null; created_task_id: number | null; proposal_uid: string | null; title: string; why: string | null; note: string | null;
  status: 'proposed' | 'accepted' | 'discarded' | 'refused'; refusal: string | null; decided_by: number | null; decided_at: string | null; created_at: string;
};

const textOf = (v: unknown, max: number): string | null | undefined => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length && t.length <= max ? t : t.length ? undefined : null;
};

/**
 * The handoff a run's output asks for: the last `{"handoff": {…}}` object in
 * it, or null. A malformed one (a title missing or too long, a note over
 * 1,000 characters) is null: it is not a handoff, and the draft still stands.
 */
export function parseHandoff(output: string): HandoffAsk | null {
  const text = String(output ?? '');
  const at = text.lastIndexOf('{"handoff"');
  if (at < 0) return null;
  let depth = 0, end = -1;
  for (let i = at; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  let h: any;
  try { h = JSON.parse(text.slice(at, end + 1))?.handoff; } catch { return null; }
  if (!h || typeof h !== 'object') return null;
  const to = typeof h.to_role === 'string' && /^(custom:)?[a-z0-9_:-]{2,100}$/.test(h.to_role) ? h.to_role : null;
  const title = textOf(h.title, TITLE_MAX);
  const why = textOf(h.why, NOTE_MAX);
  const note = textOf(h.note, NOTE_MAX);
  if (!to || !title || why === undefined || note === undefined) return null;
  return { to_role: to, title, why, note };
}

/** The live target: an active or paused agent of that role in the scope, else (a project agent) in the project's company. */
async function targetFor(env: Env, from: AgentRow, toRole: string): Promise<AgentRow | null> {
  const same = await env.DB.prepare(
    `SELECT * FROM team_agents WHERE role_key = ? AND status <> 'removed' AND scope_kind = ? AND company_id IS ? AND project_id IS ? AND id <> ?
      ORDER BY id LIMIT 1`,
  ).bind(toRole, from.scope_kind, from.company_id, from.project_id, from.id).first<AgentRow>();
  if (same) return same;
  if (from.scope_kind !== 'project') return null;
  // The company agent of a project agent, while the project is still under that company.
  return env.DB.prepare(
    `SELECT a.* FROM team_agents a JOIN projects p ON p.company_id = a.company_id
      WHERE p.id = ? AND a.scope_kind = 'company' AND a.role_key = ? AND a.status <> 'removed'
      ORDER BY a.id LIMIT 1`,
  ).bind(from.project_id, toRole).first<AgentRow>();
}

/** The chain the from task belongs to, when it came from an accepted handoff. */
async function parentOf(env: Env, task: Pick<TaskRow, 'source_kind' | 'source_ref'>): Promise<HandoffRow | null> {
  if (task.source_kind !== 'handoff' || !task.source_ref) return null;
  return env.DB.prepare("SELECT * FROM agent_handoffs WHERE uid = ? AND status = 'accepted'").bind(task.source_ref).first<HandoffRow>();
}

export type ProposeOutcome = { status: 'proposed'; handoff: HandoffRow } | { status: 'refused'; code: string; handoff: HandoffRow | null };

/**
 * Record a handoff a run asked for: a `proposed` step with its proposal in
 * the queue, or a `refused` step with its code. Keyed by the run (`ho-<run
 * uid>`), so a retried step records nothing twice.
 */
export async function proposeHandoff(env: Env, i: { from: AgentRow; task: TaskRow; runUid: string; ask: HandoffAsk }): Promise<ProposeOutcome> {
  const uid = `ho-${i.runUid}`.slice(0, 80);
  const existing = await env.DB.prepare('SELECT * FROM agent_handoffs WHERE uid = ?').bind(uid).first<HandoffRow>();
  if (existing) return existing.status === 'refused' ? { status: 'refused', code: existing.refusal ?? 'refused', handoff: existing } : { status: 'proposed', handoff: existing };
  const parent = await parentOf(env, i.task);
  const chainUid = parent?.chain_uid ?? uid;
  const depth = (parent?.depth ?? 0) + 1;
  let code: string | null = null;
  let target: AgentRow | null = null;
  if (!(await handsOffTo(env, i.from)).includes(i.ask.to_role)) code = 'not_allowed';
  else if (depth > DEPTH_MAX) code = 'depth_exceeded';
  else {
    target = await targetFor(env, i.from, i.ask.to_role);
    if (!target) code = 'no_target';
    else {
      const seen = await env.DB.prepare(
        `SELECT 1 AS ok FROM agent_handoffs WHERE chain_uid = ? AND status = 'accepted' AND (from_agent_id = ? OR to_agent_id = ?) LIMIT 1`,
      ).bind(chainUid, target.id, target.id).first<{ ok: number }>();
      if (seen || target.id === i.from.id) code = 'handoff_loop';
    }
  }
  // One step per depth of a chain: a step already taken there (a discarded or refused one) ended it.
  const taken = !code && await env.DB.prepare('SELECT 1 AS ok FROM agent_handoffs WHERE chain_uid = ? AND depth = ?').bind(chainUid, depth).first<{ ok: number }>();
  if (taken) code = 'chain_ended';
  // A refusal that has no place in its chain (too deep, or the depth taken) is its own one-step chain on the trail.
  const own = code === 'depth_exceeded' || code === 'chain_ended';
  const write = (status: 'proposed' | 'refused', proposalUid: string | null) => env.DB.prepare(
    `INSERT OR IGNORE INTO agent_handoffs
       (uid, chain_uid, depth, from_agent_id, to_role_key, to_agent_id, from_task_id, proposal_uid, title, why, note, status, refusal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, own ? uid : chainUid, own ? 1 : depth, i.from.id, i.ask.to_role, target?.id ?? null, i.task.id, proposalUid,
    i.ask.title, i.ask.why, i.ask.note, status, status === 'refused' ? code : null).run();
  if (code) {
    await write('refused', null);
    return { status: 'refused', code, handoff: await env.DB.prepare('SELECT * FROM agent_handoffs WHERE uid = ?').bind(uid).first<HandoffRow>() };
  }
  const p = await proposeRail(env, {
    userId: i.from.sponsor_user_id, page: HANDOFF_PAGE, option: HANDOFF_OPTION, record: null, kind: 'proposal',
    payload: { handoff: uid, to_role: i.ask.to_role, title: i.ask.title, why: i.ask.why, note: i.ask.note },
    agentId: i.from.id, taskId: i.task.id, runKey: `agent:${uid}`,
  });
  await write('proposed', p.uid);
  return { status: 'proposed', handoff: (await env.DB.prepare('SELECT * FROM agent_handoffs WHERE uid = ?').bind(uid).first<HandoffRow>())! };
}

/** The target's task: in the from task's module when the target works there, else its first module; an option it may propose there. */
async function workFor(env: Env, target: AgentRow, s: Scope, fromModule: string | null): Promise<{ module: string | null; option: string | null }> {
  const { rules } = await effectiveBook(env, s, target.role_key);
  const module = fromModule && rules.works_in.includes(fromModule) ? fromModule : rules.works_in[0] ?? null;
  const option = module ? optionsIn(module).find((o) => rules.may_propose.includes(o) && o !== HANDOFF_OPTION) ?? null : null;
  return { module, option };
}

export type DecideDeps = { admit?: ((env: Env, a: AgentRow, task: TaskRow) => Promise<void>) | null };

/**
 * A person decided a handoff's proposal (`decideRailAs`). Accept or edit
 * creates the target's task; discard ends the chain. Conditional on the step
 * still being `proposed`, so a second press changes nothing.
 */
export async function decideHandoff(env: Env, proposalUid: string, status: string, deciderId: number | null, edited: Record<string, unknown> | null, deps: DecideDeps = {}): Promise<HandoffRow | null> {
  const h = await env.DB.prepare("SELECT * FROM agent_handoffs WHERE proposal_uid = ? AND status = 'proposed'").bind(proposalUid).first<HandoffRow>();
  if (!h) return null;
  if (status === 'discarded') {
    await env.DB.prepare(
      "UPDATE agent_handoffs SET status = 'discarded', decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'proposed'",
    ).bind(deciderId, h.id).run();
    return env.DB.prepare('SELECT * FROM agent_handoffs WHERE id = ?').bind(h.id).first<HandoffRow>();
  }
  if (status !== 'accepted' && status !== 'edited') return null;
  const from = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(h.from_agent_id).first<AgentRow>();
  const target = from ? await targetFor(env, from, h.to_role_key) : null;
  const s = target ? await scopeOfAgent(env, target) : null;
  if (!from || !target || !s) {
    await env.DB.prepare(
      "UPDATE agent_handoffs SET status = 'refused', refusal = 'no_target', decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'proposed'",
    ).bind(deciderId, h.id).run();
    return env.DB.prepare('SELECT * FROM agent_handoffs WHERE id = ?').bind(h.id).first<HandoffRow>();
  }
  // An edit may retitle the task; the why and the note stay the model's, read only as data.
  const title = typeof edited?.title === 'string' && edited.title.trim() && edited.title.length <= TITLE_MAX ? edited.title.trim() : h.title;
  const claimed = await env.DB.prepare(
    "UPDATE agent_handoffs SET status = 'accepted', to_agent_id = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'proposed'",
  ).bind(target.id, deciderId, h.id).run();
  if (!claimed.meta?.changes) return env.DB.prepare('SELECT * FROM agent_handoffs WHERE id = ?').bind(h.id).first<HandoffRow>();
  const fromTask = h.from_task_id ? await env.DB.prepare('SELECT module FROM scope_tasks WHERE id = ?').bind(h.from_task_id).first<{ module: string | null }>() : null;
  const work = await workFor(env, target, s, fromTask?.module ?? null);
  const task = await insertTask(env, s, {
    title, module: work.module, option: work.option, kind: 'handoff', assignee_kind: 'agent', assignee_agent_id: target.id,
    status: 'open', source_kind: 'handoff', source_ref: h.uid,
  }, deciderId ?? target.sponsor_user_id);
  await env.DB.prepare('UPDATE agent_handoffs SET created_task_id = ? WHERE id = ?').bind(task.id, h.id).run();
  if (h.from_task_id) await taskEvent(env, h.from_task_id, deciderId, 'handoff', { to_role: h.to_role_key, task: task.uid });
  if (deps.admit) {
    try { await deps.admit(env, target, task); } catch { console.warn('[agents] handoff_admit_failed'); }
  }
  return env.DB.prepare('SELECT * FROM agent_handoffs WHERE id = ?').bind(h.id).first<HandoffRow>();
}

/** The why and the note a handoff task came with, as untrusted data for the target's prompt; null when the task is no handoff's. */
export async function handoffBlockFor(env: Env, task: Pick<TaskRow, 'source_kind' | 'source_ref'>): Promise<{ from_role: string; why: string | null; note: string | null } | null> {
  const h = await parentOf(env, task);
  if (!h) return null;
  const from = await env.DB.prepare('SELECT role_key FROM team_agents WHERE id = ?').bind(h.from_agent_id).first<{ role_key: string }>();
  return { from_role: from?.role_key ?? 'unknown', why: h.why, note: h.note };
}

/** The handoff chains touching this scope's agents, newest first, for the trail (TM13). */
export async function chainsOf(env: Env, s: Scope) {
  const [companyId, projectId] = s.kind === 'company' ? [s.id, null] : [null, s.id];
  const rows = (await env.DB.prepare(
    `SELECT h.* FROM agent_handoffs h JOIN team_agents a ON a.id = h.from_agent_id
      WHERE (a.scope_kind = ? AND a.company_id IS ? AND a.project_id IS ?)
         OR h.to_agent_id IN (SELECT id FROM team_agents WHERE scope_kind = ? AND company_id IS ? AND project_id IS ?)
      ORDER BY h.chain_uid, h.depth, h.id LIMIT 300`,
  ).bind(s.kind, companyId, projectId, s.kind, companyId, projectId).all<HandoffRow>()).results ?? [];
  const role = new Map<number, string>();
  const roleOfAgent = async (id: number | null) => {
    if (id == null) return null;
    if (!role.has(id)) role.set(id, (await env.DB.prepare('SELECT role_key FROM team_agents WHERE id = ?').bind(id).first<{ role_key: string }>())?.role_key ?? 'unknown');
    return role.get(id)!;
  };
  const person = async (id: number | null) => {
    if (!id) return null;
    const u = await env.DB.prepare('SELECT uid, name FROM users WHERE id = ?').bind(id).first<{ uid: string; name: string }>();
    return u ? { uid: u.uid, name: u.name } : null;
  };
  // #4394 (TM13): `started_at` is the chain's first step; `at` (its latest) only orders the list.
  const chains = new Map<string, { uid: string; started_at: string; at: string; steps: unknown[]; refused: { reason: string }[] }>();
  for (const h of rows) {
    const c = chains.get(h.chain_uid) ?? { uid: h.chain_uid, started_at: h.created_at, at: h.created_at, steps: [], refused: [] };
    if (h.status === 'refused') c.refused.push({ reason: h.refusal ?? 'refused' });
    c.steps.push({
      uid: h.uid, depth: h.depth, from: { role_key: await roleOfAgent(h.from_agent_id) }, to: { role_key: h.to_role_key },
      title: h.title, status: h.status, refusal: h.refusal, decided_by: await person(h.decided_by),
      task_created: h.created_task_id != null,
    });
    if (h.created_at > c.at) c.at = h.created_at;
    if (h.created_at < c.started_at) c.started_at = h.created_at;
    chains.set(h.chain_uid, c);
  }
  return [...chains.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).map(({ at: _at, ...c }) => c);
}
