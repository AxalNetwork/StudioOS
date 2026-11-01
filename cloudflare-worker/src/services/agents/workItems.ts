/**
 * D1614 W7 (#3993). A project task works like a GitHub issue: a number, a
 * Markdown body, a timeline, comments from people and agents, labels, a
 * milestone, participants, agent drafts and a person's review. On W1's
 * `scope_tasks` (762) and migration 763. Project scope only.
 *
 * WHO MAY DO WHAT
 *   read the timeline, comment     the project's read gate (a person), or the
 *                                  task's assigned active agent (`agentComment`)
 *   edit or delete a comment       its own author only
 *   review, accept or discard a    the project's manage gate
 *   draft, labels, milestones
 * An agent never closes a task: W1's `updateWorkTask` refuses it with 403
 * `agent_cannot_close`, and a review is a person's.
 *
 * AGENT DRAFTS. An agent run proposes `create_task` as an `ai_rail_proposals`
 * row (`propose:create-task`, the project as its record). Until a manager
 * accepts it nothing is created: the draft is read from the proposal and drawn
 * in Triage with `review_state: 'needs_review'`. Accept creates the task in
 * Backlog with `drafted_by_agent_id`; Discard needs a reason and creates
 * nothing.
 *
 * MARKDOWN. The Worker never renders HTML. A comment body is stored cleaned
 * (`cleanMarkdown`): raw HTML tags and comments are removed, a stray `<` is
 * escaped, and a link whose target is not http(s), mailto or relative points
 * at `#`.
 *
 * No DTO here carries an email or a numeric user id: a person is `{ kind,
 * uid, name }`, an agent `{ kind, uid, name, role }`.
 */
import type { Env, User } from '../../types';
import { newUid } from '../../routes/_t13t14t15_helpers';
import { notify, type NotifyArgs } from '../notify';
import { proposeRail } from '../railProposals';
import { canManage, canRead, type Scope } from './teams';
import { columnOf, createWorkTask, updateWorkTask, WorkRefusal, WORK_TYPES, type WorkTask } from './workBoard';

type Project = Extract<Scope, { kind: 'project' }>;
export type Publish = (env: Env, args: NotifyArgs) => Promise<unknown>;
const bad = (code: string, message: string): never => { throw new WorkRefusal(400, code, message); };
const missing = (what = 'task'): never => { throw new WorkRefusal(404, 'not_found', `There is no such ${what} in this project.`); };

export const COMMENT_MAX = 20000;
export const MENTIONS_MAX = 20;
export const DRAFT_OPTION = 'propose:create-task';
export const DRAFT_PAGE = 'Founder · Work';
export const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
const draftRecord = (projectId: number) => `project:${projectId}`;

// ─────────────────────────────────────────────────────────────── Markdown

const SAFE_SCHEME = /^(https?:|mailto:)/i;
/** A link target a renderer may follow: http(s), mailto, an anchor or a relative path; never an encoded scheme. */
export function safeTarget(url: string): boolean {
  const u = url.replace(/[\u0000- \u007f]/g, '');
  if (/&#|&colon;|%3a/i.test(u)) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(u) || SAFE_SCHEME.test(u);
}
/** A comment's Markdown with no raw HTML and no unsafe link target. */
export function cleanMarkdown(src: string): string {
  let s = src.replace(/\r\n?/g, '\n');
  s = s.replace(/<!--[\s\S]*?(-->|$)/g, '');
  s = s.replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g, '');
  s = s.replace(/<(?=[A-Za-z!/?])/g, '&lt;');
  // Inline links and images: [text](target) and ![alt](target).
  s = s.replace(/(\]\(\s*)([^)\s]*)/g, (m, open: string, url: string) => (safeTarget(url) ? m : `${open}#`));
  // Reference definitions: [id]: target.
  s = s.replace(/^(\s{0,3}\[[^\]\n]+\]:\s*)(\S+)/gm, (m, head: string, url: string) => (safeTarget(url) ? m : `${head}#`));
  return s.trim();
}

// ─────────────────────────────────────────────────────────────── reads

export async function taskByNumber(env: Env, scope: Project, raw: string | undefined): Promise<WorkTask> {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) missing();
  const t = await env.DB.prepare("SELECT * FROM scope_tasks WHERE scope_kind = 'project' AND project_id = ? AND task_number = ?")
    .bind(scope.id, n).first<WorkTask>();
  return t ?? missing();
}

type ActorRow = { user_uid: string | null; user_name: string | null; agent_uid: string | null; role_key: string | null; first_name: string | null; last_name: string | null };
export type Actor = { kind: 'person'; uid: string; name: string | null } | { kind: 'agent'; uid: string; name: string | null; role: string | null };
function actorOf(r: ActorRow): Actor | null {
  if (r.agent_uid) return { kind: 'agent', uid: r.agent_uid, name: [r.first_name, r.last_name].filter(Boolean).join(' ') || null, role: r.role_key };
  if (r.user_uid) return { kind: 'person', uid: r.user_uid, name: r.user_name };
  return null;
}
export type Cost = { available: true; value_microusd: number } | { available: false };
const costOf = (v: unknown): Cost => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? { available: true, value_microusd: v } : { available: false });

type CommentRow = ActorRow & { uid: string; body: string | null; run_id: string | null; created_at: string; edited_at: string | null; deleted_at: string | null; charged_microusd: number | null };
function commentDto(r: CommentRow) {
  const author = actorOf(r)!;
  return {
    uid: r.uid, author, body: r.deleted_at ? null : r.body, deleted: !!r.deleted_at,
    created_at: r.created_at, edited_at: r.edited_at, deleted_at: r.deleted_at,
    ...(author.kind === 'agent' ? { run: r.run_id, cost: costOf(r.charged_microusd) } : {}),
  };
}
async function commentRows(env: Env, by: { taskId?: number; uid?: string }, limit = 1) {
  return (await env.DB.prepare(
    `SELECT c.uid, c.body, c.run_id, c.created_at, c.edited_at, c.deleted_at, u.uid AS user_uid, u.name AS user_name, a.uid AS agent_uid, a.role_key, a.first_name, a.last_name, l.charged_microusd
     FROM task_comments c LEFT JOIN users u ON u.id = c.author_user_id LEFT JOIN team_agents a ON a.id = c.author_agent_id
     LEFT JOIN ai_rail_proposals p ON p.uid = c.run_id AND p.agent_id = c.author_agent_id
     LEFT JOIN ai_usage_logs l ON l.id = p.usage_log_id
     WHERE (c.task_id = ? OR c.uid = ?) ORDER BY c.id LIMIT ?`,
  ).bind(by.taskId ?? null, by.uid ?? null, limit).all<CommentRow>()).results ?? [];
}

const TIMELINE_MAX = 1000;
/**
 * The task's timeline: its comments, its events and the proposals linked to
 * it, in time order. Every entry names its person or agent; an agent's entry
 * carries a cost, `{ available: false }` when the run recorded none.
 * Participants are derived here, never stored.
 */
export async function timeline(env: Env, scope: Project, t: WorkTask) {
  const comments = await commentRows(env, { taskId: t.id }, TIMELINE_MAX + 1);
  const events = (await env.DB.prepare(
    `SELECT e.id, e.kind, e.detail_json, e.created_at, u.uid AS user_uid, u.name AS user_name, a.uid AS agent_uid, a.role_key, a.first_name, a.last_name FROM scope_task_events e
     LEFT JOIN users u ON u.id = e.actor_user_id LEFT JOIN team_agents a ON a.id = e.actor_agent_id
     WHERE e.task_id = ? ORDER BY e.id LIMIT ?`,
  ).bind(t.id, TIMELINE_MAX + 1).all<ActorRow & { id: number; kind: string; detail_json: string | null; created_at: string }>()).results ?? [];
  const proposals = (await env.DB.prepare(
    `SELECT p.uid, p.status, p.rail_option, p.created_at, p.decided_at, u.uid AS user_uid, u.name AS user_name, a.uid AS agent_uid, a.role_key, a.first_name, a.last_name, l.charged_microusd
     FROM ai_rail_proposals p LEFT JOIN team_agents a ON a.id = p.agent_id LEFT JOIN users u ON u.id = p.user_id AND p.agent_id IS NULL
     LEFT JOIN ai_usage_logs l ON l.id = p.usage_log_id
     WHERE p.task_id = ? ORDER BY p.id LIMIT ?`,
  ).bind(t.id, TIMELINE_MAX + 1).all<ActorRow & { uid: string; status: string; rail_option: string; created_at: string; decided_at: string | null; charged_microusd: number | null }>()).results ?? [];

  type Entry = { type: string; at: string; actor: Actor | null; [k: string]: unknown };
  const entries: Array<Entry & { order: number }> = [];
  let order = 0;
  for (const c of comments.slice(0, TIMELINE_MAX)) entries.push({ type: 'comment', at: c.created_at, actor: actorOf(c), comment: commentDto(c), order: order++ });
  for (const e of events.slice(0, TIMELINE_MAX)) {
    let d: Record<string, any> = {};
    try { d = JSON.parse(e.detail_json ?? '{}') ?? {}; } catch { d = {}; }
    const actor = actorOf(e);
    const base = { at: e.created_at, actor, ...(actor?.kind === 'agent' ? { cost: { available: false } as Cost } : {}), order: order++ };
    switch (e.kind) {
      case 'created': entries.push({ type: 'created', column: d.column ?? null, from_draft: !!d.draft, ...base }); break;
      case 'assigned': entries.push({ type: 'assigned', assignee_kind: d.assignee_kind ?? null, ...base }); break;
      case 'moved':
        if (d.to === 'done') entries.push({ type: 'closed', close_reason: d.close_reason ?? null, ...base });
        else if (d.from === 'done') entries.push({ type: 'reopened', to: d.to ?? null, ...base });
        else entries.push({ type: 'moved', from: d.from ?? null, to: d.to ?? null, ...base });
        break;
      case 'updated': entries.push({ type: 'edited', fields: Array.isArray(d.fields) ? d.fields : [], ...base }); break;
      case 'labelled': entries.push({ type: 'labelled', added: d.added ?? [], removed: d.removed ?? [], ...base }); break;
      case 'milestone': entries.push({ type: 'milestone', milestone: d.milestone ?? null, ...base }); break;
      case 'reviewed': entries.push({ type: 'reviewed', decision: d.decision ?? null, ...base }); break;
      case 'deps_set': entries.push({ type: 'dependencies', count: d.count ?? null, ...base }); break;
      case 'unblocked': case 'dependency_incomplete': entries.push({ type: e.kind, blocker: d.blocker_uid ?? null, ...base }); break;
      default: break; // 'status' repeats the move it came with.
    }
  }
  for (const p of proposals.slice(0, TIMELINE_MAX)) {
    const actor = actorOf(p);
    entries.push({ type: 'linked_proposal', at: p.created_at, actor, proposal: { uid: p.uid, status: p.status, option: p.rail_option, decided_at: p.decided_at },
      ...(actor?.kind === 'agent' ? { cost: costOf(p.charged_microusd) } : {}), order: order++ });
  }
  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.order - b.order));

  const seen = new Map<string, Actor>();
  const add = (a: Actor | null) => { if (a && !seen.has(`${a.kind}:${a.uid}`)) seen.set(`${a.kind}:${a.uid}`, a); };
  const head = await env.DB.prepare(
    `SELECT cu.uid AS user_uid, cu.name AS user_name, da.uid AS agent_uid, da.role_key, da.first_name, da.last_name
     FROM scope_tasks t LEFT JOIN users cu ON cu.id = t.created_by_user_id LEFT JOIN team_agents da ON da.id = t.drafted_by_agent_id WHERE t.id = ?`,
  ).bind(t.id).first<ActorRow>();
  if (head) add(actorOf(head));
  const assignee = await env.DB.prepare(
    `SELECT u.uid AS user_uid, u.name AS user_name, a.uid AS agent_uid, a.role_key, a.first_name, a.last_name
     FROM scope_tasks t LEFT JOIN users u ON u.id = t.assignee_user_id LEFT JOIN team_agents a ON a.id = t.assignee_agent_id WHERE t.id = ?`,
  ).bind(t.id).first<ActorRow>();
  if (assignee) add(actorOf(assignee));
  for (const e of entries) add(e.actor);

  return {
    task: { uid: t.uid, task_number: t.task_number, title: t.title, project: { id: scope.id } },
    entries: entries.map(({ order: _o, ...e }) => e),
    participants: [...seen.values()],
    truncated: comments.length > TIMELINE_MAX || events.length > TIMELINE_MAX || proposals.length > TIMELINE_MAX,
  };
}

// ─────────────────────────────────────────────────────────────── comments

type Mention = { kind: 'person' | 'agent'; uid: string };
function readBody(b: Record<string, any>): string {
  if (typeof b.body !== 'string') bad('invalid_comment', 'Write the comment.');
  const body = cleanMarkdown(b.body);
  if (!body) bad('invalid_comment', 'Write the comment.');
  if (body.length > COMMENT_MAX) bad('invalid_comment', `A comment is at most ${COMMENT_MAX.toLocaleString('en-US')} characters.`);
  return body;
}
function readMentions(raw: unknown): Mention[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MENTIONS_MAX) bad('invalid_mentions', `Mention at most ${MENTIONS_MAX} people or agents.`);
  const out: Mention[] = [];
  for (const m of raw as any[]) {
    if (!m || (m.kind !== 'person' && m.kind !== 'agent') || typeof m.uid !== 'string' || !m.uid) bad('invalid_mentions', 'A mention is { kind: person or agent, uid }.');
    if (!out.some((x) => x.kind === m.kind && x.uid === m.uid)) out.push({ kind: m.kind, uid: m.uid });
  }
  return out;
}
/** Who each mention notifies: a person on the project, or an agent's sponsor. Anyone else refuses the whole comment. */
async function mentionTargets(env: Env, scope: Project, mentions: Mention[]): Promise<Array<{ userId: number; mention: Mention }>> {
  const out: Array<{ userId: number; mention: Mention }> = [];
  for (const m of mentions) {
    if (m.kind === 'person') {
      const u = await env.DB.prepare('SELECT * FROM users WHERE uid = ?').bind(m.uid).first<User>();
      if (!u || !(await canRead(env, scope, u))) throw new WorkRefusal(422, 'mention_not_member', 'Mention only people on this project.');
      out.push({ userId: Number(u.id), mention: m });
    } else {
      const a = await env.DB.prepare("SELECT sponsor_user_id FROM team_agents WHERE uid = ? AND scope_kind = 'project' AND project_id = ? AND status <> 'removed'")
        .bind(m.uid, scope.id).first<{ sponsor_user_id: number | null }>();
      if (!a) throw new WorkRefusal(422, 'mention_not_member', 'Mention only this project’s agents.');
      if (a.sponsor_user_id) out.push({ userId: a.sponsor_user_id, mention: m });
    }
  }
  return out;
}
async function notifyMentions(env: Env, scope: Project, t: WorkTask, targets: Array<{ userId: number; mention: Mention }>, byUserId: number | null, publish: Publish) {
  const done = new Set<number>();
  for (const { userId, mention } of targets) {
    if (userId === byUserId || done.has(userId)) continue;
    done.add(userId);
    await publish(env, {
      userId, type: 'task_mention', title: mention.kind === 'agent' ? 'Your agent was mentioned on a task' : 'You were mentioned on a task',
      body: t.title, link: `/projects/${scope.id}/work?item=${t.uid}`, category: 'proactive_nudges', channels: ['in_app'],
      payload: { task_uid: t.uid, task_number: t.task_number, mention: mention.kind === 'agent' ? { kind: 'agent', uid: mention.uid } : { kind: 'person' } },
    });
  }
}

export async function addComment(env: Env, scope: Project, t: WorkTask, b: Record<string, any>, user: User, publish: Publish = notify) {
  if (!(await canRead(env, scope, user))) missing();
  const body = readBody(b);
  const targets = await mentionTargets(env, scope, readMentions(b.mentions));
  const uid = newUid();
  await env.DB.prepare('INSERT INTO task_comments (uid, task_id, project_id, author_user_id, body) VALUES (?, ?, ?, ?, ?)')
    .bind(uid, t.id, scope.id, Number(user.id), body).run();
  await notifyMentions(env, scope, t, targets, Number(user.id), publish);
  return commentDto((await commentRows(env, { uid }))[0]);
}

/** The task's assigned active agent comments, naming its run. Called by the run path, never by a request body. */
export async function agentComment(env: Env, scope: Project, t: WorkTask, agentId: number, b: Record<string, any>, runId: string | null, publish: Publish = notify) {
  const a = await env.DB.prepare('SELECT id, scope_kind, project_id, status FROM team_agents WHERE id = ?')
    .bind(agentId).first<{ id: number; scope_kind: string; project_id: number | null; status: string }>();
  if (!a || a.scope_kind !== 'project' || a.project_id !== scope.id || a.status !== 'active' || t.assignee_kind !== 'agent' || t.assignee_agent_id !== a.id) {
    throw new WorkRefusal(403, 'not_assignee', 'Only the assigned active agent can comment on this task.');
  }
  if (runId !== null && (typeof runId !== 'string' || runId.length > 80)) bad('invalid_comment', 'A run is named by its proposal uid.');
  const body = readBody(b);
  const targets = await mentionTargets(env, scope, readMentions(b.mentions));
  const uid = newUid();
  await env.DB.prepare('INSERT INTO task_comments (uid, task_id, project_id, author_agent_id, run_id, body) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(uid, t.id, scope.id, a.id, runId, body).run();
  await notifyMentions(env, scope, t, targets, null, publish);
  return commentDto((await commentRows(env, { uid }))[0]);
}

async function commentIn(env: Env, uid: string) {
  const c = await env.DB.prepare('SELECT c.*, t.uid AS task_uid FROM task_comments c JOIN scope_tasks t ON t.id = c.task_id WHERE c.uid = ?')
    .bind(uid).first<{ id: number; project_id: number; author_user_id: number | null; deleted_at: string | null; task_uid: string }>();
  return c;
}
export async function editComment(env: Env, scope: Project, uid: string, b: Record<string, any>, user: User) {
  const c = await commentIn(env, uid);
  if (!c || c.project_id !== scope.id || !(await canRead(env, scope, user))) missing('comment');
  if (c!.author_user_id !== Number(user.id)) throw new WorkRefusal(403, 'not_author', 'Only its author can edit a comment.');
  if (c!.deleted_at) throw new WorkRefusal(409, 'comment_deleted', 'This comment was deleted.');
  const body = readBody(b);
  await env.DB.prepare('UPDATE task_comments SET body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').bind(body, c!.id).run();
  return commentDto((await commentRows(env, { uid }))[0]);
}
export async function deleteComment(env: Env, scope: Project, uid: string, user: User) {
  const c = await commentIn(env, uid);
  if (!c || c.project_id !== scope.id || !(await canRead(env, scope, user))) missing('comment');
  if (c!.author_user_id !== Number(user.id)) throw new WorkRefusal(403, 'not_author', 'Only its author can delete a comment.');
  await env.DB.prepare('UPDATE task_comments SET body = NULL, deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP) WHERE id = ?').bind(c!.id).run();
  return commentDto((await commentRows(env, { uid }))[0]);
}

// ─────────────────────────────────────────────────────────────── review

async function manager(env: Env, scope: Project, user: User, what: string) {
  if (!(await canRead(env, scope, user))) missing();
  if (!(await canManage(env, scope, user))) throw new WorkRefusal(403, 'not_manager', `Only a project editor can ${what}.`);
}

/**
 * A person reviews work In review. Approve closes it as completed; Request
 * changes needs a comment and moves it back to In progress. The move is W1's
 * own write (its checks, events and unblock notices); the comment, the
 * review event and `review_state` follow it.
 */
export async function reviewTask(env: Env, scope: Project, t: WorkTask, b: Record<string, any>, user: User, publish: Publish = notify) {
  await manager(env, scope, user, 'review work');
  if (b.decision !== 'approve' && b.decision !== 'request_changes') bad('invalid_review', 'Decide approve or request_changes.');
  const comment = typeof b.comment === 'string' ? cleanMarkdown(b.comment) : '';
  if (b.comment !== undefined && b.comment !== null && typeof b.comment !== 'string') bad('invalid_review', 'The comment is text.');
  if (comment.length > COMMENT_MAX) bad('invalid_review', `A comment is at most ${COMMENT_MAX.toLocaleString('en-US')} characters.`);
  if (b.decision === 'request_changes' && !comment) bad('comment_required', 'Say what to change.');
  if (columnOf(t) !== 'in_review') throw new WorkRefusal(409, 'not_in_review', 'Only work In review can be reviewed.');
  const approve = b.decision === 'approve';
  const moved = await updateWorkTask(env, t, approve ? { state: 'closed', close_reason: 'completed' } : { column: 'in_progress' }, { user }, publish);
  const statements = [
    env.DB.prepare('UPDATE scope_tasks SET review_state = ? WHERE id = ?').bind(approve ? 'approved' : 'changes_requested', t.id),
    env.DB.prepare("INSERT INTO scope_task_events (task_id, actor_user_id, kind, detail_json) VALUES (?, ?, 'reviewed', ?)")
      .bind(t.id, Number(user.id), JSON.stringify({ decision: b.decision })),
  ];
  if (comment) statements.push(env.DB.prepare('INSERT INTO task_comments (uid, task_id, project_id, author_user_id, body) VALUES (?, ?, ?, ?, ?)')
    .bind(newUid(), t.id, scope.id, Number(user.id), comment));
  await env.DB.batch(statements);
  if (!approve) {
    const to = moved.assignee_kind === 'person' ? moved.assignee_user_id
      : moved.assignee_kind === 'agent' ? (await env.DB.prepare('SELECT sponsor_user_id FROM team_agents WHERE id = ?').bind(moved.assignee_agent_id).first<{ sponsor_user_id: number | null }>())?.sponsor_user_id ?? null
      : null;
    if (to && to !== Number(user.id)) await publish(env, { userId: to, type: 'task_changes_requested', title: 'Changes were requested on a task', body: t.title,
      link: `/projects/${scope.id}/work?item=${t.uid}`, category: 'proactive_nudges', channels: ['in_app'], payload: { task_uid: t.uid, task_number: t.task_number } });
  }
  return (await env.DB.prepare('SELECT * FROM scope_tasks WHERE id = ?').bind(t.id).first<WorkTask>())!;
}

// ─────────────────────────────────────────────────────────────── agent drafts

export type DraftFields = { title: string; body: string | null; type: typeof WORK_TYPES[number]; module: string | null };
function draftFields(raw: unknown): DraftFields {
  const f = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const title = typeof f.title === 'string' ? f.title.trim() : '';
  if (!title || title.length > 200) bad('invalid_draft', 'A draft has a title of at most 200 characters.');
  const body = typeof f.body === 'string' ? cleanMarkdown(f.body) || null : null;
  if (body && body.length > 50000) bad('invalid_draft', 'A draft’s body is at most 50,000 characters.');
  const type = (f.type ?? 'task') as DraftFields['type'];
  if (!(WORK_TYPES as readonly unknown[]).includes(type)) bad('invalid_draft', 'Choose task, bug, feature, research, compliance or chore.');
  const module = typeof f.module === 'string' && f.module ? f.module : null;
  return { title, body, type, module };
}

/** An agent run proposes `create_task`. Nothing is created: the draft is a proposal until a manager accepts it. */
export async function proposeTaskDraft(env: Env, agentId: number, fields: unknown, run: { runKey?: string | null; usageLogId?: number | null } = {}) {
  const a = await env.DB.prepare('SELECT id, scope_kind, project_id, status, sponsor_user_id FROM team_agents WHERE id = ?')
    .bind(agentId).first<{ id: number; scope_kind: string; project_id: number | null; status: string; sponsor_user_id: number | null }>();
  if (!a || a.scope_kind !== 'project' || !a.project_id || a.status !== 'active' || !a.sponsor_user_id) {
    throw new WorkRefusal(403, 'agent_not_live', 'Only a live project agent can draft a task.');
  }
  const task = draftFields(fields);
  const p = await proposeRail(env, {
    userId: a.sponsor_user_id, page: DRAFT_PAGE, option: DRAFT_OPTION, record: draftRecord(a.project_id), kind: 'proposal',
    payload: { create_task: task }, agentId: a.id, runKey: run.runKey ?? null, usageLogId: run.usageLogId ?? null,
  });
  return p.uid;
}

type DraftRow = ActorRow & { uid: string; payload_json: string; created_at: string; agent_id: number; charged_microusd: number | null };
function draftDto(r: DraftRow) {
  let task: DraftFields | null = null;
  try { task = draftFields(JSON.parse(r.payload_json)?.create_task); } catch { task = null; }
  return {
    uid: r.uid, column: 'triage' as const, review_state: 'needs_review' as const, drafted_by: actorOf(r),
    title: task?.title ?? null, body: task?.body ?? null, type: task?.type ?? null, module: task?.module ?? null,
    readable: !!task, created_at: r.created_at, cost: costOf(r.charged_microusd),
  };
}
async function draftRows(env: Env, scope: Project, uid?: string) {
  return (await env.DB.prepare(
    `SELECT p.uid, p.payload_json, p.created_at, p.agent_id, u.uid AS user_uid, u.name AS user_name, a.uid AS agent_uid, a.role_key, a.first_name, a.last_name, l.charged_microusd
     FROM ai_rail_proposals p JOIN team_agents a ON a.id = p.agent_id AND a.scope_kind = 'project' AND a.project_id = ?
     LEFT JOIN users u ON 0 LEFT JOIN ai_usage_logs l ON l.id = p.usage_log_id
     WHERE p.rail_option = ? AND p.record_ref = ? AND p.status = 'proposed' AND (? IS NULL OR p.uid = ?) ORDER BY p.id LIMIT 500`,
  ).bind(scope.id, DRAFT_OPTION, draftRecord(scope.id), uid ?? null, uid ?? null).all<DraftRow>()).results ?? [];
}
export async function listDrafts(env: Env, scope: Project, user: User) {
  if (!(await canRead(env, scope, user))) missing();
  return (await draftRows(env, scope)).map(draftDto);
}

/** Accept: the proposal is claimed once, then the task is created in Backlog naming its agent. A failed create frees the claim. */
export async function acceptDraft(env: Env, scope: Project, uid: string, user: User) {
  await manager(env, scope, user, 'accept a draft');
  const [row] = await draftRows(env, scope, uid);
  if (!row) missing('draft');
  const task = draftDto(row);
  if (!task.readable) throw new WorkRefusal(409, 'draft_invalid', 'This draft cannot be accepted. Discard it.');
  const claim = await env.DB.prepare(
    `UPDATE ai_rail_proposals SET status = 'accepted', decided_by_user_id = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE uid = ? AND rail_option = ? AND record_ref = ? AND status = 'proposed'`,
  ).bind(Number(user.id), uid, DRAFT_OPTION, draftRecord(scope.id)).run();
  if (!claim.meta?.changes) throw new WorkRefusal(409, 'draft_decided', 'This draft was already accepted or discarded.');
  try {
    return await createWorkTask(env, scope, { title: task.title, body: task.body, type: task.type, ...(task.module ? { module: task.module } : {}), column: 'backlog', source_ref: uid },
      user, { draftedByAgentId: row.agent_id });
  } catch (e) {
    await env.DB.prepare("UPDATE ai_rail_proposals SET status = 'proposed', decided_by_user_id = NULL, decided_at = NULL WHERE uid = ? AND status = 'accepted'").bind(uid).run();
    throw e;
  }
}
export async function discardDraft(env: Env, scope: Project, uid: string, b: Record<string, any>, user: User) {
  await manager(env, scope, user, 'discard a draft');
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!reason || reason.length > 500) bad('reason_required', 'Say why the draft is discarded, in at most 500 characters.');
  const r = await env.DB.prepare(
    `UPDATE ai_rail_proposals SET status = 'discarded', decided_payload_json = ?, decided_by_user_id = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE uid = ? AND rail_option = ? AND record_ref = ? AND status = 'proposed'`,
  ).bind(JSON.stringify({ reason }), Number(user.id), uid, DRAFT_OPTION, draftRecord(scope.id)).run();
  if (!r.meta?.changes) missing('open draft');
  return { uid, status: 'discarded' as const, reason };
}

// ─────────────────────────────────────────────────────────────── labels

type LabelRow = { id: number; uid: string; name: string; color: string; description: string | null; open_count?: number; closed_count?: number };
const labelDto = (l: LabelRow) => ({ uid: l.uid, name: l.name, color: l.color, description: l.description,
  ...(l.open_count !== undefined ? { open: l.open_count ?? 0, closed: l.closed_count ?? 0 } : {}) });
export async function listLabels(env: Env, scope: Project, user: User) {
  if (!(await canRead(env, scope, user))) missing();
  return ((await env.DB.prepare(
    `SELECT l.*, SUM(CASE WHEN t.status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN t.status IN ('done','cancelled') THEN 1 ELSE 0 END) AS closed_count
     FROM task_labels l LEFT JOIN task_label_links k ON k.label_id = l.id LEFT JOIN scope_tasks t ON t.id = k.task_id
     WHERE l.project_id = ? GROUP BY l.id ORDER BY l.name COLLATE NOCASE`,
  ).bind(scope.id).all<LabelRow>()).results ?? []).map(labelDto);
}
function labelWrite(b: Record<string, any>, partial: boolean) {
  const out: { name?: string; color?: string; description?: string | null } = {};
  if (!partial || 'name' in b) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name || name.length > 80) bad('invalid_label', 'A label’s name is 1 to 80 characters.');
    out.name = name;
  }
  if ('color' in b) { if (!(LABEL_COLORS as readonly unknown[]).includes(b.color)) bad('invalid_label', `Choose a colour: ${LABEL_COLORS.join(', ')}.`); out.color = b.color; }
  if ('description' in b) {
    if (b.description !== null && (typeof b.description !== 'string' || b.description.length > 300)) bad('invalid_label', 'A description is at most 300 characters.');
    out.description = b.description;
  }
  return out;
}
const duplicateName = (e: unknown) => /UNIQUE/i.test(String((e as Error)?.message));
/** Rewrite the names' mirror of every task carrying the label, and bump each task's revision so a stale W1 write cannot restore old names. */
const remirror = (env: Env, labelId: number) => env.DB.prepare(
  `UPDATE scope_tasks SET labels_json = (SELECT COALESCE(json_group_array(name), '[]') FROM (
  SELECT l.name FROM task_label_links k JOIN task_labels l ON l.id = k.label_id WHERE k.task_id = scope_tasks.id ORDER BY l.name COLLATE NOCASE)), work_version = work_version + 1, updated_at = CURRENT_TIMESTAMP
   WHERE id IN (SELECT task_id FROM task_label_links WHERE label_id = ?)`,
).bind(labelId);
export async function createLabel(env: Env, scope: Project, b: Record<string, any>, user: User) {
  await manager(env, scope, user, 'change labels');
  const w = labelWrite(b, false), uid = newUid();
  try {
    await env.DB.prepare('INSERT INTO task_labels (uid, project_id, name, color, description, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(uid, scope.id, w.name!, w.color ?? 'gray', w.description ?? null, Number(user.id)).run();
  } catch (e) { if (duplicateName(e)) throw new WorkRefusal(409, 'label_exists', 'This project already has a label with that name.'); throw e; }
  return labelDto((await env.DB.prepare('SELECT * FROM task_labels WHERE uid = ?').bind(uid).first<LabelRow>())!);
}
async function labelIn(env: Env, scope: Project, uid: string) {
  const l = await env.DB.prepare('SELECT * FROM task_labels WHERE uid = ? AND project_id = ?').bind(uid, scope.id).first<LabelRow>();
  return l ?? missing('label');
}
export async function updateLabel(env: Env, scope: Project, uid: string, b: Record<string, any>, user: User) {
  await manager(env, scope, user, 'change labels');
  const l = await labelIn(env, scope, uid), w = labelWrite(b, true);
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE task_labels SET name = ?, color = ?, description = ? WHERE id = ?')
        .bind(w.name ?? l.name, w.color ?? l.color, 'description' in w ? w.description ?? null : l.description, l.id),
      remirror(env, l.id),
    ]);
  } catch (e) { if (duplicateName(e)) throw new WorkRefusal(409, 'label_exists', 'This project already has a label with that name.'); throw e; }
  return labelDto((await env.DB.prepare('SELECT * FROM task_labels WHERE id = ?').bind(l.id).first<LabelRow>())!);
}
export async function deleteLabel(env: Env, scope: Project, uid: string, user: User) {
  await manager(env, scope, user, 'change labels');
  const l = await labelIn(env, scope, uid);
  const tasks = JSON.stringify(((await env.DB.prepare('SELECT task_id FROM task_label_links WHERE label_id = ?').bind(l.id).all<{ task_id: number }>()).results ?? []).map((r) => r.task_id));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM task_label_links WHERE label_id = ?').bind(l.id),
    env.DB.prepare('DELETE FROM task_labels WHERE id = ?').bind(l.id),
    env.DB.prepare(`UPDATE scope_tasks SET labels_json = (SELECT COALESCE(json_group_array(name), '[]') FROM (
  SELECT l.name FROM task_label_links k JOIN task_labels l ON l.id = k.label_id WHERE k.task_id = scope_tasks.id ORDER BY l.name COLLATE NOCASE)), work_version = work_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT value FROM json_each(?))`).bind(tasks),
  ]);
  return { uid, deleted: true };
}

/** The task's labels become exactly these (by uid), with a `labelled` event; guarded by the task's revision. */
export async function setTaskLabels(env: Env, scope: Project, t: WorkTask, b: Record<string, any>, user: User) {
  await manager(env, scope, user, 'label tasks');
  if (!Array.isArray(b.labels) || b.labels.length > 20 || b.labels.some((v: unknown) => typeof v !== 'string')) bad('invalid_label', 'Send at most 20 label uids.');
  const want: LabelRow[] = [];
  for (const uid of new Set(b.labels as string[])) want.push(await labelIn(env, scope, uid));
  const had = ((await env.DB.prepare('SELECT l.* FROM task_label_links k JOIN task_labels l ON l.id = k.label_id WHERE k.task_id = ?').bind(t.id).all<LabelRow>()).results ?? []);
  const added = want.filter((l) => !had.some((h) => h.id === l.id)).map((l) => l.name);
  const removed = had.filter((h) => !want.some((l) => l.id === h.id)).map((l) => l.name);
  const names = want.map((l) => l.name).sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' }));
  const change = newUid();
  const r = await env.DB.batch([
    env.DB.prepare(`UPDATE scope_tasks SET labels_json = ?, work_version = work_version + 1, work_change_uid = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND work_version = ?`)
      .bind(JSON.stringify(names), change, t.id, t.work_version),
    env.DB.prepare(`DELETE FROM task_label_links WHERE task_id = ? AND EXISTS (SELECT 1 FROM scope_tasks WHERE id = ? AND work_change_uid = ?)`).bind(t.id, t.id, change),
    env.DB.prepare(`INSERT INTO task_label_links (task_id, label_id) SELECT ?, CAST(value AS INTEGER) FROM json_each(?) WHERE EXISTS (SELECT 1 FROM scope_tasks WHERE id = ? AND work_change_uid = ?)`)
      .bind(t.id, JSON.stringify(want.map((l) => l.id)), t.id, change),
    env.DB.prepare(`INSERT INTO scope_task_events (task_id, actor_user_id, kind, detail_json) SELECT ?, ?, 'labelled', ? WHERE EXISTS (SELECT 1 FROM scope_tasks WHERE id = ? AND work_change_uid = ?) AND (? > 0)`)
      .bind(t.id, Number(user.id), JSON.stringify({ change, added, removed }), t.id, change, added.length + removed.length),
  ]);
  if (!r[0]?.meta?.changes) throw new WorkRefusal(409, 'task_changed', 'This task changed. Read it again before retrying.');
  return (await env.DB.prepare('SELECT * FROM scope_tasks WHERE id = ?').bind(t.id).first<WorkTask>())!;
}

// ─────────────────────────────────────────────────────────────── milestones

type MilestoneRow = { id: number; uid: string; title: string; description: string | null; due_on: string | null; state: string; closed_at: string | null; open_count?: number; closed_count?: number };
const milestoneDto = (m: MilestoneRow) => ({ uid: m.uid, title: m.title, description: m.description, due_on: m.due_on, state: m.state, closed_at: m.closed_at,
  ...(m.open_count !== undefined ? { open: m.open_count ?? 0, closed: m.closed_count ?? 0 } : {}) });
export async function listMilestones(env: Env, scope: Project, user: User) {
  if (!(await canRead(env, scope, user))) missing();
  return ((await env.DB.prepare(
    `SELECT m.*, SUM(CASE WHEN t.id IS NOT NULL AND t.status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS open_count,
       SUM(CASE WHEN t.status IN ('done','cancelled') THEN 1 ELSE 0 END) AS closed_count
     FROM task_milestones m LEFT JOIN scope_tasks t ON t.milestone_id = m.id
     WHERE m.project_id = ? GROUP BY m.id ORDER BY m.state DESC, m.due_on IS NULL, m.due_on, m.title COLLATE NOCASE`,
  ).bind(scope.id).all<MilestoneRow>()).results ?? []).map(milestoneDto);
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function milestoneWrite(b: Record<string, any>, partial: boolean) {
  const out: { title?: string; description?: string | null; due_on?: string | null; state?: 'open' | 'closed' } = {};
  if (!partial || 'title' in b) {
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title || title.length > 120) bad('invalid_milestone', 'A milestone’s title is 1 to 120 characters.');
    out.title = title;
  }
  if ('description' in b) {
    if (b.description !== null && (typeof b.description !== 'string' || b.description.length > 2000)) bad('invalid_milestone', 'A description is at most 2,000 characters.');
    out.description = b.description;
  }
  if ('due_on' in b) {
    if (b.due_on !== null && (typeof b.due_on !== 'string' || !DATE_RE.test(b.due_on) || Number.isNaN(Date.parse(`${b.due_on}T00:00:00Z`)))) bad('invalid_milestone', 'A due date is YYYY-MM-DD.');
    out.due_on = b.due_on;
  }
  if ('state' in b) { if (b.state !== 'open' && b.state !== 'closed') bad('invalid_milestone', 'A milestone is open or closed.'); out.state = b.state; }
  return out;
}
async function milestoneIn(env: Env, scope: Project, uid: string) {
  const m = await env.DB.prepare('SELECT * FROM task_milestones WHERE uid = ? AND project_id = ?').bind(uid, scope.id).first<MilestoneRow>();
  return m ?? missing('milestone');
}
export async function createMilestone(env: Env, scope: Project, b: Record<string, any>, user: User) {
  await manager(env, scope, user, 'change milestones');
  const w = milestoneWrite(b, false), uid = newUid();
  if (w.state === 'closed') bad('invalid_milestone', 'A new milestone is open.');
  try {
    await env.DB.prepare('INSERT INTO task_milestones (uid, project_id, title, description, due_on, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(uid, scope.id, w.title!, w.description ?? null, w.due_on ?? null, Number(user.id)).run();
  } catch (e) { if (duplicateName(e)) throw new WorkRefusal(409, 'milestone_exists', 'This project already has a milestone with that title.'); throw e; }
  return milestoneDto((await env.DB.prepare('SELECT * FROM task_milestones WHERE uid = ?').bind(uid).first<MilestoneRow>())!);
}
export async function updateMilestone(env: Env, scope: Project, uid: string, b: Record<string, any>, user: User) {
  await manager(env, scope, user, 'change milestones');
  const m = await milestoneIn(env, scope, uid), w = milestoneWrite(b, true);
  const state = w.state ?? m.state;
  try {
    await env.DB.prepare(
      `UPDATE task_milestones SET title = ?, description = ?, due_on = ?, state = ?,
         closed_at = CASE WHEN ? = 'closed' THEN COALESCE(closed_at, CURRENT_TIMESTAMP) ELSE NULL END WHERE id = ?`,
    ).bind(w.title ?? m.title, 'description' in w ? w.description ?? null : m.description, 'due_on' in w ? w.due_on ?? null : m.due_on, state, state, m.id).run();
  } catch (e) { if (duplicateName(e)) throw new WorkRefusal(409, 'milestone_exists', 'This project already has a milestone with that title.'); throw e; }
  return milestoneDto((await env.DB.prepare('SELECT * FROM task_milestones WHERE id = ?').bind(m.id).first<MilestoneRow>())!);
}
export async function deleteMilestone(env: Env, scope: Project, uid: string, user: User) {
  await manager(env, scope, user, 'change milestones');
  const m = await milestoneIn(env, scope, uid);
  await env.DB.batch([
    env.DB.prepare('UPDATE scope_tasks SET milestone_id = NULL, work_version = work_version + 1, updated_at = CURRENT_TIMESTAMP WHERE milestone_id = ?').bind(m.id),
    env.DB.prepare('DELETE FROM task_milestones WHERE id = ?').bind(m.id),
  ]);
  return { uid, deleted: true };
}
/** Set or clear the task's milestone, with a `milestone` event; guarded by the task's revision. */
export async function setTaskMilestone(env: Env, scope: Project, t: WorkTask, b: Record<string, any>, user: User) {
  await manager(env, scope, user, 'set milestones');
  if (!('milestone' in b) || (b.milestone !== null && typeof b.milestone !== 'string')) bad('invalid_milestone', 'Send a milestone uid, or null.');
  const m = b.milestone === null ? null : await milestoneIn(env, scope, b.milestone);
  if ((m?.id ?? null) === (t.milestone_id ?? null)) return t;
  const change = newUid();
  const r = await env.DB.batch([
    env.DB.prepare('UPDATE scope_tasks SET milestone_id = ?, work_version = work_version + 1, work_change_uid = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND work_version = ?')
      .bind(m?.id ?? null, change, t.id, t.work_version),
    env.DB.prepare(`INSERT INTO scope_task_events (task_id, actor_user_id, kind, detail_json) SELECT ?, ?, 'milestone', ? WHERE EXISTS (SELECT 1 FROM scope_tasks WHERE id = ? AND work_change_uid = ?)`)
      .bind(t.id, Number(user.id), JSON.stringify({ change, milestone: m ? { uid: m.uid, title: m.title } : null }), t.id, change),
  ]);
  if (!r[0]?.meta?.changes) throw new WorkRefusal(409, 'task_changed', 'This task changed. Read it again before retrying.');
  return (await env.DB.prepare('SELECT * FROM scope_tasks WHERE id = ?').bind(t.id).first<WorkTask>())!;
}

