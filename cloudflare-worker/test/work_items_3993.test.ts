// D1614 W7 (#3993): a project task's timeline, comments, mentions, review,
// agent drafts, labels and milestones. Real SQLite and authenticated Hono, on
// W1's fixture plus migration 763. No external provider; notify() is a stub
// that records what it was asked to send.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, splitStatements, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import engine, { agentEngineEnabled } from '../src/routes/agent_engine.ts';
import teamAgents from '../src/routes/team_agents.ts';
import { workBoardRoutes } from '../src/routes/work_board.ts';
import { workItemRoutes } from '../src/routes/work_items.ts';
import { updateWorkTask, WorkRefusal, type WorkTask } from '../src/services/agents/workBoard.ts';
import { acceptDraft, agentComment, cleanMarkdown, proposeTaskDraft, safeTarget } from '../src/services/agents/workItems.ts';
import { taskByUid } from '../src/services/agents/tasks.ts';
import { loadScope } from '../src/services/agents/teams.ts';
import { removeMigratedDatabases } from './_storage_schema.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const baseline = sql('schema_baseline.sql');
const secret = 'fixture'.repeat(12);
test.after(removeMigratedDatabases);
const OWNER = 10, MEMBER = 11, OTHER = 12, STRANGER = 13;
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function world() {
  const { DB, db } = makeD1(['users', 'company_profiles', 'user_company_links', 'projects', 'roadmap_okrs'].map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'));
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  db.exec(sql('migrations/712_team_agents.sql'));
  db.exec(stripForeignKeys(sql('migrations/727_scope_goals_and_tasks.sql')));
  db.exec(sql('migrations/762_scope_task_work_board.sql'));
  db.exec(sql('migrations/763_task_comments_labels_milestones.sql'));
  db.exec('CREATE TABLE project_members (id INTEGER PRIMARY KEY,project_id INTEGER,user_id INTEGER,role TEXT,status TEXT,created_at TEXT,updated_at TEXT)');
  for (const [id, name, founder] of [[OWNER, 'Pat Owner', 100], [MEMBER, 'Max Member', 101], [OTHER, 'Ali Other', 102], [STRANGER, 'Sam Stranger', 103]] as const)
    db.prepare("INSERT INTO users (id,uid,email,name,role,founder_id,subscription_tier,subscription_status) VALUES (?,?,?,?,'founder',?,'growth','active')").run(id, `u-${id}`, `fixture-${id}@example.test`, name, founder);
  db.exec("INSERT INTO company_profiles (id,uid,company_name) VALUES (1,'co-one','Company One')");
  db.exec("INSERT INTO user_company_links (uid,user_id,company_id,role_in_company) VALUES ('link-owner',10,1,'Founder')");
  db.exec("INSERT INTO projects (id,uid,name,founder_id,company_id) VALUES (7,'p-seven','Project Seven',100,1),(8,'p-eight','Project Eight',100,NULL)");
  db.exec("INSERT INTO project_members (project_id,user_id,role,status) VALUES (7,11,'advisor','accepted'),(7,12,'advisor','accepted')");
  const env: any = { DB, JWT_SECRET: secret, ENVIRONMENT: 'development', AGENT_ENGINE: 'on', TEAM_AGENTS_ENABLED: 'true' };
  const sent: any[] = [];
  const publish = async (_env: unknown, args: any) => { sent.push(args); return 1; };
  const app = new Hono();
  app.route('/api/teams', workBoardRoutes(agentEngineEnabled));
  app.route('/api/teams', workItemRoutes(agentEngineEnabled, publish));
  app.route('/api/teams', engine);
  app.route('/api/teams', teamAgents);
  return { DB, db, env, app, sent, publish };
}
type W = ReturnType<typeof world>;
async function call(w: W, who: number | null, method: string, path: string, b?: unknown) {
  const token = who === null ? null : await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const r = await w.app.request(`/api/teams${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }, w.env);
  const text = await r.text();
  return { status: r.status, text, body: (text ? JSON.parse(text) : null) as any };
}
async function create(w: W, b: any = {}, project = 7) {
  const r = await call(w, OWNER, 'POST', `/project/${project}/tasks`, { title: 'Prepare launch', ...b });
  assert.equal(r.status, 201, r.text);
  return r.body.task;
}
async function agent(w: W, role = 'cfo') {
  const r = await call(w, OWNER, 'POST', '/project/7/agents', { role_key: role, first_name: 'Carla', last_name: 'Cash', model_id: MODEL, monthly_cap_microusd: 5_000_000 });
  assert.equal(r.status, 201, r.text);
  return { uid: r.body.agent.uid as string, id: (w.db.prepare('SELECT id FROM team_agents WHERE uid = ?').get(r.body.agent.uid) as any).id as number };
}
const raw = async (w: W, uid: string) => (await taskByUid(w.env, uid)) as WorkTask;
const project7 = async (w: W) => (await loadScope(w.env, 'project', '7')) as any;
const owner = (w: W) => w.db.prepare('SELECT * FROM users WHERE id = ?').get(OWNER) as any;
const move = (w: W, uid: string, column: string) => call(w, OWNER, 'PATCH', `/tasks/${uid}/move`, { column });
const noPrivate = (text: string) => {
  assert.doesNotMatch(text, /@example\.test/, 'an email in a DTO');
  assert.doesNotMatch(text, /"(user_id|author_user_id|assignee_user_id|created_by_user_id|actor_user_id|sponsor_user_id)"\s*:/, 'a numeric user id key in a DTO');
};

test('numbering is per project; the timeline reads by number; a company scope, a stranger and the flags answer 404', async () => {
  // Mutations checked: taskByNumber without its project_id clause → project 8's #1 reads project 7's task.
  const w = world();
  try {
    const a = await create(w, { title: 'Seven one' }), b = await create(w, { title: 'Seven two' }), c = await create(w, { title: 'Eight one' }, 8);
    assert.deepEqual([a.task_number, b.task_number, c.task_number], [1, 2, 1]);
    const seven = await call(w, MEMBER, 'GET', '/project/7/tasks/1/timeline');
    assert.equal(seven.status, 200, seven.text);
    assert.equal(seven.body.task.uid, a.uid);
    assert.equal((await call(w, OWNER, 'GET', '/project/8/tasks/1/timeline')).body.task.uid, c.uid);
    assert.equal((await call(w, OWNER, 'GET', '/project/7/tasks/3/timeline')).status, 404);
    assert.equal((await call(w, OWNER, 'GET', '/project/7/tasks/x/timeline')).status, 404);
    for (const path of ['/company/co-one/tasks/1/timeline', '/company/co-one/work/labels', '/company/co-one/work/milestones', '/company/co-one/work/drafts'])
      assert.equal((await call(w, OWNER, 'GET', path)).status, 404, path);
    assert.equal((await call(w, OWNER, 'POST', '/company/co-one/tasks/1/comments', { body: 'x' })).status, 404);
    assert.equal((await call(w, STRANGER, 'GET', '/project/7/tasks/1/timeline')).status, 404);
    assert.equal((await call(w, null, 'GET', '/project/7/tasks/1/timeline')).status, 401);
    w.env.AGENT_ENGINE = 'off';
    const off = await call(w, OWNER, 'GET', '/project/7/tasks/1/timeline');
    assert.deepEqual([off.status, off.body.error], [404, 'agent_engine_off']);
  } finally { w.db.close(); }
});

test('comment Markdown is cleaned: no raw HTML, no unsafe link target, encoded schemes refused', () => {
  // Mutations checked: the tag strip removed → <script> kept; safeTarget allowing any scheme → javascript: kept.
  const dirty = 'Hi <script>alert(1)</script><img src=x onerror=alert(1)> **bold** <!-- hidden -->\n'
    + '[ok](https://axal.vc/x) [bad](javascript:alert(1)) [enc](java&#115;cript:alert(1)) ![i](data:text/html;base64,AA)\n[ref]: vbscript:msgbox\n<b';
  const clean = cleanMarkdown(dirty);
  assert.doesNotMatch(clean, /<script|<img|onerror=|<!--|javascript:|java&#115;|data:text|vbscript:/i);
  assert.match(clean, /\*\*bold\*\*/);
  assert.match(clean, /\[ok\]\(https:\/\/axal\.vc\/x\)/);
  assert.match(clean, /\[bad\]\(#/);
  assert.match(clean, /&lt;b$/);
  for (const ok of ['https://a.b', 'mailto:x@y.z', '/projects/7', '#top', 'relative/path']) assert.equal(safeTarget(ok), true, ok);
  for (const no of ['javascript:x', ' JavaScript:x', 'data:x', 'java%3ascript', 'file:///etc']) assert.equal(safeTarget(no), false, no);
});

test('comments: a member comments, mentions notify people and an agent’s sponsor, an outsider mention refuses the comment, only the author edits or deletes', async () => {
  // Mutations checked: mentions never notified → sent is empty; the canRead check on a mention dropped → the stranger is notified;
  // the author check on edit dropped → another member edits.
  const w = world();
  try {
    const t = await create(w);
    const cfo = await agent(w);
    const r = await call(w, MEMBER, 'POST', '/project/7/tasks/1/comments', { body: 'Look <script>x</script>[here](javascript:y)', mentions: [{ kind: 'person', uid: `u-${OTHER}` }, { kind: 'agent', uid: cfo.uid }] });
    assert.equal(r.status, 201, r.text);
    noPrivate(r.text);
    assert.deepEqual([r.body.comment.author.kind, r.body.comment.author.uid, r.body.comment.author.name], ['person', `u-${MEMBER}`, 'Max Member']);
    assert.doesNotMatch(r.body.comment.body, /<script|javascript:/);
    assert.deepEqual(w.sent.map((s) => [s.userId, s.type, s.payload.task_uid]), [[OTHER, 'task_mention', t.uid], [OWNER, 'task_mention', t.uid]]);
    assert.ok(w.sent.every((s) => s.link === `/projects/7/work?item=${t.uid}`));

    const outsider = await call(w, MEMBER, 'POST', '/project/7/tasks/1/comments', { body: 'Ping', mentions: [{ kind: 'person', uid: `u-${STRANGER}` }] });
    assert.deepEqual([outsider.status, outsider.body.code ?? outsider.body.error], [422, 'mention_not_member']);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM task_comments').get() as any).n, 1, 'a refused comment is not stored');
    assert.equal(w.sent.length, 2);
    assert.equal((await call(w, MEMBER, 'POST', '/project/7/tasks/1/comments', { body: '   ' })).status, 400);
    assert.equal((await call(w, MEMBER, 'POST', '/project/7/tasks/1/comments', { body: 'x'.repeat(20001) })).status, 400);
    assert.equal((await call(w, STRANGER, 'POST', '/project/7/tasks/1/comments', { body: 'Hello' })).status, 404);

    const uid = r.body.comment.uid;
    assert.equal((await call(w, OTHER, 'PATCH', `/project/7/comments/${uid}`, { body: 'Hijack' })).status, 403);
    assert.equal((await call(w, OWNER, 'DELETE', `/project/7/comments/${uid}`)).status, 403, 'not even a manager deletes another’s comment');
    const edited = await call(w, MEMBER, 'PATCH', `/project/7/comments/${uid}`, { body: 'Look again' });
    assert.equal(edited.status, 200);
    assert.ok(edited.body.comment.edited_at);
    const gone = await call(w, MEMBER, 'DELETE', `/project/7/comments/${uid}`);
    assert.deepEqual([gone.status, gone.body.comment.deleted, gone.body.comment.body], [200, true, null]);
    assert.equal((w.db.prepare('SELECT body FROM task_comments WHERE uid = ?').get(uid) as any).body, null, 'a deleted comment keeps no body');
    assert.equal((await call(w, MEMBER, 'PATCH', `/project/7/comments/${uid}`, { body: 'Back' })).status, 409);
    assert.equal((await call(w, MEMBER, 'PATCH', `/project/8/comments/${uid}`, { body: 'Elsewhere' })).status, 404);
  } finally { w.db.close(); }
});

test('an agent comments only on its own task, naming its run and cost; it cannot close; the timeline names everyone and lists participants', async () => {
  // Mutations checked: agentComment without the assignee check → an unassigned agent comments; the cost join dropped → cost unavailable.
  const w = world();
  try {
    const cfo = await agent(w), other = await agent(w, 'coo');
    const t = await create(w, { module: 'use-of-funds', assignee: { kind: 'agent', uid: cfo.uid } });
    w.db.prepare("INSERT INTO ai_usage_logs (id,user_id,task,model,charged_microusd) VALUES (91,?,'rail_draft','m',1234)").run(OWNER);
    w.db.prepare("INSERT INTO ai_rail_proposals (uid,user_id,rail_page,rail_option,kind,payload_json,usage_log_id,agent_id,task_id) VALUES ('run-1',?,'Founder · Work','draft:x','proposal','{}',91,?,?)")
      .run(OWNER, cfo.id, (await raw(w, t.uid)).id);
    const s = await project7(w);
    const c = await agentComment(w.env, s, await raw(w, t.uid), cfo.id, { body: 'Runway drafted.' }, 'run-1', w.publish);
    assert.deepEqual([c.author.kind, c.author.uid, c.run, c.cost], ['agent', cfo.uid, 'run-1', { available: true, value_microusd: 1234 }]);
    await assert.rejects(async () => agentComment(w.env, s, await raw(w, t.uid), other.id, { body: 'Not mine' }, null), (e: any) => e.code === 'not_assignee');

    await updateWorkTask(w.env, await raw(w, t.uid), { column: 'in_progress' }, { agentId: cfo.id });
    await assert.rejects(async () => updateWorkTask(w.env, await raw(w, t.uid), { column: 'done' }, { agentId: cfo.id }), (e: any) => e.code === 'agent_cannot_close');
    await assert.rejects(async () => updateWorkTask(w.env, await raw(w, t.uid), { state: 'closed', close_reason: 'completed' }, { agentId: cfo.id }), (e: any) => e.code === 'agent_cannot_close');
    await updateWorkTask(w.env, await raw(w, t.uid), { column: 'in_review' }, { agentId: cfo.id });

    const tl = await call(w, MEMBER, 'GET', '/project/7/tasks/1/timeline');
    assert.equal(tl.status, 200, tl.text);
    noPrivate(tl.text);
    const types = tl.body.entries.map((e: any) => e.type);
    for (const k of ['created', 'comment', 'moved', 'linked_proposal']) assert.ok(types.includes(k), k);
    const agentMoves = tl.body.entries.filter((e: any) => e.type === 'moved' && e.actor?.kind === 'agent');
    assert.equal(agentMoves.length, 2);
    assert.ok(agentMoves.every((e: any) => e.actor.uid === cfo.uid && e.cost.available === false), 'an agent’s move with no run says its cost is not recorded');
    const linked = tl.body.entries.find((e: any) => e.type === 'linked_proposal');
    assert.deepEqual([linked.actor.uid, linked.cost], [cfo.uid, { available: true, value_microusd: 1234 }]);
    assert.deepEqual(tl.body.participants.map((p: any) => `${p.kind}:${p.uid}`).sort(), [`agent:${cfo.uid}`, `person:u-${OWNER}`].sort());
  } finally { w.db.close(); }
});

test('review: a manager approves (closed as completed) or requests changes (needs a comment; back to In progress); others are refused', async () => {
  // Mutations checked: request_changes without the comment rule → 200; the In review check dropped → a backlog task closes;
  // approve moving to in_progress → state stays open.
  const w = world();
  try {
    const t = await create(w, { assignee: { kind: 'person', uid: `u-${MEMBER}` } });
    const early = await call(w, OWNER, 'POST', '/project/7/tasks/1/review', { decision: 'approve' });
    assert.deepEqual([early.status, early.body.code ?? early.body.error], [409, 'not_in_review']);
    assert.equal((await move(w, t.uid, 'in_review')).status, 200);
    const nocomment = await call(w, OWNER, 'POST', '/project/7/tasks/1/review', { decision: 'request_changes', comment: '  ' });
    assert.deepEqual([nocomment.status, nocomment.body.code ?? nocomment.body.error], [400, 'comment_required']);
    assert.equal((await call(w, MEMBER, 'POST', '/project/7/tasks/1/review', { decision: 'approve' })).status, 403, 'the assignee does not review their own work');
    assert.equal((await call(w, OWNER, 'POST', '/project/7/tasks/1/review', { decision: 'merge' })).status, 400);

    const changes = await call(w, OWNER, 'POST', '/project/7/tasks/1/review', { decision: 'request_changes', comment: 'Add the **Q3** numbers.' });
    assert.equal(changes.status, 200, changes.text);
    assert.deepEqual([changes.body.task.column, changes.body.task.state, changes.body.task.review_state], ['in_progress', 'open', 'changes_requested']);
    assert.deepEqual(w.sent.map((s) => [s.userId, s.type]), [[MEMBER, 'task_changes_requested']]);

    assert.equal((await call(w, MEMBER, 'PATCH', `/tasks/${t.uid}/move`, { column: 'in_review' })).status, 200);
    const filtered = await call(w, OWNER, 'GET', '/project/7/work/board?filter=review%3Aneeded');
    assert.deepEqual(filtered.body.items.map((i: any) => i.uid), [t.uid]);
    const ok = await call(w, OWNER, 'POST', '/project/7/tasks/1/review', { decision: 'approve' });
    assert.deepEqual([ok.status, ok.body.task.state, ok.body.task.close_reason, ok.body.task.review_state], [200, 'closed', 'completed', 'approved']);

    const tl = (await call(w, OWNER, 'GET', '/project/7/tasks/1/timeline')).body.entries;
    assert.deepEqual(tl.filter((e: any) => e.type === 'reviewed').map((e: any) => e.decision), ['request_changes', 'approve']);
    assert.ok(tl.some((e: any) => e.type === 'comment' && /Q3/.test(e.comment.body)));
    assert.equal(tl.filter((e: any) => e.type === 'closed').length, 1);
  } finally { w.db.close(); }
});

test('agent drafts: nothing is created until Accept; Accept puts the task in Backlog naming the agent; Discard needs a reason', async () => {
  // Mutations checked: the claim's status guard dropped → two racing accepts create two tasks; discard without the reason rule → 200;
  // (Removing acceptDraft's own manager gate is equivalent: createWorkTask refuses the member with the same 403 and the claim is released.)
  const w = world();
  try {
    const cfo = await agent(w);
    const first = await proposeTaskDraft(w.env, cfo.id, { title: 'Reconcile the bank feed', body: 'From <b>the</b> run', type: 'chore' });
    const second = await proposeTaskDraft(w.env, cfo.id, { title: 'Draft the investor note' });
    await assert.rejects(() => proposeTaskDraft(w.env, cfo.id, { title: '' }), (e: any) => e.code === 'invalid_draft');
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM scope_tasks').get() as any).n, 0, 'a draft creates no task');

    const drafts = await call(w, MEMBER, 'GET', '/project/7/work/drafts');
    assert.equal(drafts.status, 200);
    noPrivate(drafts.text);
    assert.deepEqual(drafts.body.drafts.map((d: any) => [d.uid, d.column, d.review_state, d.drafted_by.uid, d.title]),
      [[first, 'triage', 'needs_review', cfo.uid, 'Reconcile the bank feed'], [second, 'triage', 'needs_review', cfo.uid, 'Draft the investor note']]);
    assert.doesNotMatch(drafts.body.drafts[0].body, /<b>/);

    assert.equal((await call(w, MEMBER, 'POST', `/project/7/work/drafts/${first}/accept`)).status, 403);
    const accepted = await call(w, OWNER, 'POST', `/project/7/work/drafts/${first}/accept`);
    assert.equal(accepted.status, 201, accepted.text);
    assert.deepEqual([accepted.body.task.column, accepted.body.task.type, accepted.body.task.drafted_by.uid, accepted.body.task.author.kind, accepted.body.task.task_number],
      ['backlog', 'chore', cfo.uid, 'agent', 1]);
    assert.equal((await call(w, OWNER, 'POST', `/project/7/work/drafts/${first}/accept`)).status, 404, 'a decided draft is no longer open');
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM scope_tasks').get() as any).n, 1);
    assert.equal((w.db.prepare('SELECT status FROM ai_rail_proposals WHERE uid = ?').get(first) as any).status, 'accepted');

    assert.equal((await call(w, OWNER, 'POST', `/project/7/work/drafts/${second}/discard`, {})).status, 400);
    const discarded = await call(w, OWNER, 'POST', `/project/7/work/drafts/${second}/discard`, { reason: 'Already done by hand.' });
    assert.deepEqual([discarded.status, discarded.body.draft.status], [200, 'discarded']);
    assert.equal(JSON.parse((w.db.prepare('SELECT decided_payload_json FROM ai_rail_proposals WHERE uid = ?').get(second) as any).decided_payload_json).reason, 'Already done by hand.');
    assert.equal((await call(w, OWNER, 'GET', '/project/7/work/drafts')).body.drafts.length, 0);
    assert.equal((w.db.prepare('SELECT COUNT(*) AS n FROM scope_tasks').get() as any).n, 1, 'a discarded draft creates nothing');

    const third = await proposeTaskDraft(w.env, cfo.id, { title: 'Raced draft' });
    const s7 = await project7(w);
    const raced = await Promise.allSettled([acceptDraft(w.env, s7, third, owner(w)), acceptDraft(w.env, s7, third, owner(w))]);
    assert.deepEqual(raced.map((r) => r.status).sort(), ['fulfilled', 'rejected'], 'two accepts at once create one task');
    assert.equal(((raced.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason as WorkRefusal).code, 'draft_decided');
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM scope_tasks WHERE title = 'Raced draft'").get() as any).n, 1);
    await create(w, { title: 'By hand' });
    for (const [filter, want] of [['drafted_by:agent', ['Reconcile the bank feed']], ['author:agent', ['Reconcile the bank feed']], ['author:person', ['By hand']]] as const) {
      const r = await call(w, OWNER, 'GET', `/project/7/work/board?filter=${encodeURIComponent(filter)}`);
      assert.deepEqual(r.body.items.map((i: any) => i.title).filter((t: string) => t !== 'Raced draft'), want, filter);
    }
    const tl = (await call(w, OWNER, 'GET', '/project/7/tasks/1/timeline')).body;
    assert.equal(tl.entries[0].from_draft, true);
  } finally { w.db.close(); }
});

test('labels and milestones: managers keep them, tasks carry them, renames and deletes follow through, filters and sort read them', async () => {
  // Mutations checked: the rename without remirror → the card keeps the old name; W1's named labels without the link sync → no link row;
  // deleteMilestone without clearing tasks → a dangling milestone.
  const w = world();
  try {
    const a = await create(w, { title: 'Alpha', due_at: '2026-12-01' }), b = await create(w, { title: 'Beta' });
    assert.equal((await call(w, MEMBER, 'POST', '/project/7/work/labels', { name: 'finance' })).status, 403);
    const finance = await call(w, OWNER, 'POST', '/project/7/work/labels', { name: 'finance', color: 'green' });
    assert.equal(finance.status, 201, finance.text);
    assert.equal((await call(w, OWNER, 'POST', '/project/7/work/labels', { name: 'FINANCE' })).status, 409);
    assert.equal((await call(w, OWNER, 'POST', '/project/7/work/labels', { name: 'x', color: 'neon' })).status, 400);
    const legal = (await call(w, OWNER, 'POST', '/project/7/work/labels', { name: 'legal' })).body.label;

    const labelled = await call(w, OWNER, 'PUT', '/project/7/tasks/1/labels', { labels: [finance.body.label.uid, legal.uid] });
    assert.deepEqual(labelled.body.task.labels, ['finance', 'legal']);
    assert.equal((await call(w, OWNER, 'PUT', '/project/7/tasks/1/labels', { labels: ['nope'] })).status, 404);
    // W1's own named labels become this project's labels and links.
    assert.equal((await call(w, OWNER, 'PATCH', `/tasks/${b.uid}`, { labels: ['ops', 'Finance'] })).status, 200);
    const links = w.db.prepare('SELECT l.name FROM task_label_links k JOIN task_labels l ON l.id = k.label_id WHERE k.task_id = ? ORDER BY l.name').all((await raw(w, b.uid)).id).map((r: any) => r.name);
    assert.deepEqual(links, ['finance', 'ops']);
    assert.deepEqual((await raw(w, b.uid)).labels_json, '["finance","ops"]');

    assert.equal((await call(w, OWNER, 'PATCH', `/project/7/work/labels/${finance.body.label.uid}`, { name: 'money' })).status, 200);
    const board = (await call(w, OWNER, 'GET', '/project/7/work/board')).body;
    assert.deepEqual(board.items.map((i: any) => [i.title, i.labels]), [['Alpha', ['legal', 'money']], ['Beta', ['money', 'ops']]]);
    const list = (await call(w, MEMBER, 'GET', '/project/7/work/labels')).body.labels;
    assert.deepEqual(list.map((l: any) => [l.name, l.open]), [['legal', 1], ['money', 2], ['ops', 1]]);
    assert.equal((await call(w, OWNER, 'DELETE', `/project/7/work/labels/${legal.uid}`)).status, 200);
    assert.deepEqual((await raw(w, a.uid)).labels_json, '["money"]');

    assert.equal((await call(w, OWNER, 'POST', '/project/7/work/milestones', { title: 'Seed', due_on: '2026-13-40' })).status, 400);
    const seed = await call(w, OWNER, 'POST', '/project/7/work/milestones', { title: 'Seed close', due_on: '2026-12-31' });
    assert.equal(seed.status, 201, seed.text);
    const set = await call(w, OWNER, 'PUT', '/project/7/tasks/2/milestone', { milestone: seed.body.milestone.uid });
    assert.deepEqual(set.body.task.milestone, { uid: seed.body.milestone.uid, title: 'Seed close', due_on: '2026-12-31', state: 'open' });
    const byMilestone = await call(w, OWNER, 'GET', `/project/7/work/board?filter=${encodeURIComponent(`milestone:${seed.body.milestone.uid}`)}`);
    assert.deepEqual(byMilestone.body.items.map((i: any) => i.title), ['Beta']);
    assert.deepEqual((await call(w, OWNER, 'GET', '/project/7/work/board?filter=milestone%3Anone')).body.items.map((i: any) => i.title), ['Alpha']);
    const closed = await call(w, OWNER, 'PATCH', `/project/7/work/milestones/${seed.body.milestone.uid}`, { state: 'closed' });
    assert.ok(closed.body.milestone.closed_at);
    const tl = (await call(w, OWNER, 'GET', '/project/7/tasks/2/timeline')).body.entries;
    assert.ok(tl.some((e: any) => e.type === 'milestone' && e.milestone.title === 'Seed close'));
    assert.ok((await call(w, OWNER, 'GET', '/project/7/tasks/1/timeline')).body.entries.some((e: any) => e.type === 'labelled' && e.added.length === 2));
    assert.equal((await call(w, OWNER, 'DELETE', `/project/7/work/milestones/${seed.body.milestone.uid}`)).status, 200);
    assert.equal((await raw(w, b.uid)).milestone_id, null);

    const sorted = await call(w, OWNER, 'GET', '/project/7/work/board?sort=number-desc');
    assert.deepEqual(sorted.body.items.map((i: any) => i.task_number), [2, 1]);
    assert.deepEqual((await call(w, OWNER, 'GET', '/project/7/work/board?sort=due')).body.items.map((i: any) => i.title), ['Alpha', 'Beta'], 'an unrecorded due date sorts last');
    assert.equal((await call(w, OWNER, 'GET', '/project/7/work/board?sort=random')).status, 400);
    assert.equal((await call(w, OWNER, 'GET', '/project/7/work/board?filter=review%3Amaybe')).status, 400);
    noPrivate(JSON.stringify(board));
  } finally { w.db.close(); }
});

test('migration 763 on real legacy rows: labels_json becomes labels and links; event ids and history are kept; the new kinds are accepted', () => {
  // Mutations checked: the back-fill INSERTs removed → no link rows; the events copy dropped → the old event is gone.
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(baseline);
  const dir = new URL('../sql/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort(compareMigrations).filter((x) => migrationNumber(x) > BASELINE_CUTOFF && migrationNumber(x) < 763)) {
    for (const stmt of splitStatements(readFileSync(new URL(f, dir), 'utf8'))) { try { db.exec(stmt); } catch { /* already on the baseline */ } }
  }
  try {
    db.exec("INSERT INTO users (id,uid,email,name,role) VALUES (1,'u-1','legacy@example.test','Legacy','founder')");
    db.exec("INSERT INTO projects (id,uid,name,founder_id) VALUES (5,'p-five','Five',1)");
    db.exec(`INSERT INTO scope_tasks (id,uid,scope_kind,project_id,title,labels_json,task_number) VALUES
      (1,'t-1','project',5,'One','["Finance","ops"]',1),(2,'t-2','project',5,'Two','["finance"]',2)`);
    db.exec("INSERT INTO scope_task_events (id,task_id,actor_user_id,kind,detail_json) VALUES (41,1,1,'moved','{}')");
    for (const stmt of splitStatements(sql('migrations/763_task_comments_labels_milestones.sql'))) db.exec(stmt);
    assert.deepEqual(db.prepare('SELECT lower(name) AS n FROM task_labels WHERE project_id = 5 ORDER BY 1').all().map((r: any) => r.n), ['finance', 'ops']);
    assert.deepEqual(db.prepare('SELECT task_id, COUNT(*) AS n FROM task_label_links GROUP BY task_id ORDER BY task_id').all().map((r: any) => [r.task_id, r.n]), [[1, 2], [2, 1]]);
    assert.equal((db.prepare('SELECT kind FROM scope_task_events WHERE id = 41').get() as any).kind, 'moved');
    db.exec("INSERT INTO scope_task_events (task_id,kind,detail_json) VALUES (1,'labelled','{}')");
    assert.ok((db.prepare("SELECT id FROM scope_task_events WHERE kind = 'labelled'").get() as any).id > 41, 'ids continue after the rebuild');
    assert.throws(() => db.exec("INSERT INTO scope_task_events (task_id,kind) VALUES (1,'invented')"));
    assert.throws(() => db.exec("INSERT INTO task_comments (uid,task_id,project_id,body) VALUES ('c',1,5,'no author')"));
  } finally { db.close(); }
});
