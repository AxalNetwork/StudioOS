/**
 * D1614 CO2–CO5 (#3976) — a company's compliance tasks on D1384's store.
 *
 *   1. Migration 202611021812 rebuilds compliance_events keeping every row, column and
 *      id, the AUTOINCREMENT mark and the two ON DELETE CASCADE children, and
 *      fills company_id from the project; a row with neither is refused.
 *   2. Reading: a seat reads; HQ without a seat reads, `read_only`; anyone else
 *      is refused. No compliance at all is an empty list, never invented.
 *   3. Changing: only a company admin creates, edits, assigns, marks done and
 *      reopens; a plain member is `not_company_admin`; HQ without a seat is
 *      `read_only_admin`.
 *   4. Assigning: a seat or the company's own active agent; anyone else is
 *      `assignee_not_member`.
 *   5. Agents prepare (comment with their cost, ready for review) and never
 *      mark done: `agent_cannot_close`. Another company's agent is refused.
 *   6. Mark done rolls a recurring task forward once; reopen undoes done.
 *   7. "Create work in a project…": linking across companies and from a
 *      standalone project is refused; the item lands in Backlog with
 *      `compliance_ref`, and the task's read shows it with its column.
 *   8. A seat that ends flags the member's open tasks, with an event, and
 *      never reassigns; a refused leave flags nothing.
 *   9. The Calendar's Compliance layer shows a company task to its seats with
 *      the company badge, and not to anyone else.
 *  10. No reply carries an email.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import companyCompliance from '../src/routes/company_compliance.ts';
import companyRoutes from '../src/routes/company.ts';
import { commentOn, companyOf, markDone, readyForReview } from '../src/services/compliance/companyTasks.ts';
import { complianceDueEvents } from '../src/services/calendar/sourceReaders.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const FILES = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF)
  .sort((a, b) => migrationNumber(a) - migrationNumber(b) || a.localeCompare(b));
// D4106: the migration is named by its UTC minute, so it sorts after every numbered file.
const MCO = '202611021812_company_compliance_tasks.sql';
const SECRET = 'synthetic-company-compliance-3976-'.repeat(3);
// Users: 1 primary admin, 2 member, 3 HQ admin without a seat, 4 outsider, 5 HQ admin with a seat, 6 second member.
const ADMIN = 1, MEMBER = 2, HQ = 3, OUTSIDER = 4, HQ_SEATED = 5, MEMBER2 = 6;

function db0(upTo = Infinity) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const n of FILES.filter((f) => migrationNumber(f) <= upTo)) db.exec(readFileSync(`${DIR}/${n}`, 'utf8'));
  return db;
}

function fixture(engine = 'on') {
  const db = db0();
  db.exec(`INSERT INTO users(id,uid,role,name,email,founder_id,is_active) VALUES
    (1,'u-admin','founder','Ada Admin','ada@example.test',101,1),(2,'u-member','founder','Mo Member','mo@example.test',102,1),
    (3,'u-hq','admin','Hal HQ','hal@example.test',NULL,1),(4,'u-out','founder','Otto Outsider','otto@example.test',104,1),
    (5,'u-hq-seat','admin','Sia Seated','sia@example.test',NULL,1),(6,'u-member2','investor','Ivy Investor','ivy@example.test',NULL,1);
   INSERT INTO company_profiles(id,uid,company_name) VALUES (50,'co-a','Acme Holdings'),(60,'co-b','Beta Ltd');
   INSERT INTO user_company_links(uid,company_id,user_id,role_in_company,is_primary_admin) VALUES
    ('l1',50,1,'Owner',1),('l2',50,2,'Member',0),('l5',50,5,'Member',0),('l6',50,6,'Investor',0),('l7',60,4,'Owner',1);
   INSERT INTO projects(id,name,founder_id,company_id) VALUES (10,'Pilot app',101,50),(20,'Beta app',104,60),(30,'Solo',101,NULL);
   INSERT INTO team_agents(id,uid,scope_kind,company_id,role_key,first_name,model_id,sponsor_user_id,monthly_cap_microusd,created_by) VALUES
    (70,'ag-a','company',50,'legal','Lex','m',1,1000000,1),(80,'ag-b','company',60,'legal','Bex','m',4,1000000,4);`);
  const app = new Hono();
  app.route('/api/company', companyCompliance as any);
  app.route('/api', companyRoutes as any);
  const env: any = { DB: d1(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production', APP_URL: 'https://axal.vc', AGENT_ENGINE: engine, TEAM_AGENTS_ENABLED: 'true' };
  const ctx: any = { waitUntil() {}, passThroughOnException() {} };
  async function call(method: string, path: string, id: number, body?: unknown) {
    const token = await new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const init: any = { method, headers: { Cookie: `studioos_auth=${token}; studioos_csrf=fixture-csrf`, 'x-csrf-token': 'fixture-csrf', Origin: 'https://axal.vc', 'content-type': 'application/json' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await app.request(`/api${path}`, init, env, ctx);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  }
  return { db, env, call, close: () => db.close() };
}

function d1(db: DatabaseSync) {
  const stmt = (sql: string, args: any[] = []): any => ({
    bind: (...v: any[]) => stmt(sql, v.map((x) => (x === undefined ? null : x))),
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    raw: async () => db.prepare(sql).all(...args).map((r: any) => Object.values(r)),
    _run: () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return {
    prepare: (sql: string) => stmt(sql),
    exec: async (sql: string) => { db.exec(sql); },
    // A batch is one transaction, as on D1.
    batch: async (list: any[]) => {
      db.exec('SAVEPOINT b');
      try { const out = list.map((s) => s._run()); db.exec('RELEASE b'); return out; }
      catch (e) { db.exec('ROLLBACK TO b'); db.exec('RELEASE b'); throw e; }
    },
  };
}

const noEmail = (r: { text: string }) => assert.doesNotMatch(r.text, /@example\.test/, 'a reply carries an email');
const newTask = (f: ReturnType<typeof fixture>, over: Record<string, unknown> = {}) =>
  f.call('POST', '/company/co-a/compliance', ADMIN, { title: 'Delaware franchise tax', due: '2027-03-01', type: 'payment', jurisdiction: 'US-DE', ...over });

test('1: the rebuild keeps every row, id, column and child, fills company_id, and refuses a row with neither', () => {
  const db = db0(migrationNumber(MCO) - 1); // every migration before this one
  db.exec(`INSERT INTO company_profiles(id,uid,company_name) VALUES (50,'co-a','Acme');
    INSERT INTO projects(id,name,company_id) VALUES (10,'P',50),(11,'Q',NULL);
    INSERT INTO compliance_events(id,project_id,jurisdiction,event_type,title,due_date,kind,owner_name,remind_days_json) VALUES
      (3,10,'US-DE','annual_report','A','2026-12-01','filing','Ada','[30]'),(9,11,'UK','other','B','2026-12-02',NULL,NULL,NULL),(12,10,'US-DE','other','gone','2026-12-03',NULL,NULL,NULL);
    DELETE FROM compliance_events WHERE id = 12;
    INSERT INTO obligation_agenda_items(id,uid,event_id,text) VALUES (4,'a4',3,'Item');
    INSERT INTO obligation_occurrences(id,uid,event_id,held_on) VALUES (6,'o6',3,'2026-10-01');`);
  const before = db.prepare('SELECT * FROM compliance_events ORDER BY id').all() as any[];
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(`${DIR}/${MCO}`, 'utf8'));
  const after = db.prepare('SELECT * FROM compliance_events ORDER BY id').all() as any[];
  assert.equal(after.length, 2);
  for (const [i, b] of before.entries()) for (const k of Object.keys(b)) assert.equal(after[i][k], b[k], `${k} changed on row ${b.id}`);
  assert.deepEqual(after.map((r) => r.company_id), [50, null]);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM obligation_agenda_items').get() as any).n, 1, 'the cascade took the agenda items');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM obligation_occurrences').get() as any).n, 1, 'the cascade took the occurrences');
  db.exec(`INSERT INTO compliance_events(company_id,jurisdiction,event_type,title,due_date) VALUES (50,'US-DE','filing','Company task','2027-01-01')`);
  assert.equal((db.prepare('SELECT MAX(id) m FROM compliance_events').get() as any).m, 13, 'a deleted id was reused');
  assert.throws(() => db.exec(`INSERT INTO compliance_events(jurisdiction,event_type,title,due_date) VALUES ('X','other','none','2027-01-01')`));
  assert.throws(() => db.exec(`INSERT INTO compliance_events(company_id,jurisdiction,event_type,title,due_date,assignee_kind) VALUES (50,'X','other','half','2027-01-01','person')`), 'a person assignee with no person');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  for (const n of ['compliance_task_events']) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(n), `${n} missing`);
  assert.ok((db.prepare('PRAGMA table_info(scope_tasks)').all() as any[]).some((c) => c.name === 'compliance_ref'));
  db.close();
});

test('2: a seat reads, HQ without one reads read-only, anyone else is refused; none is an empty list', async () => {
  const f = fixture();
  try {
    const empty = await f.call('GET', '/company/co-a/compliance', MEMBER);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.tasks, []);
    assert.deepEqual(empty.body.viewer, { can_manage: false, can_comment: true, read_only: false });
    assert.deepEqual(empty.body.projects, [{ id: 10, name: 'Pilot app' }], 'another company\'s or a standalone project is offered');
    const hq = await f.call('GET', '/company/co-a/compliance', HQ);
    assert.equal(hq.status, 200);
    assert.deepEqual(hq.body.viewer, { can_manage: false, can_comment: false, read_only: true });
    const out = await f.call('GET', '/company/co-a/compliance', OUTSIDER);
    assert.equal(out.status, 403);
    assert.equal(out.body.error, 'not_member');
    assert.equal((await f.call('GET', '/company/nope/compliance', ADMIN)).status, 404);
    noEmail(empty); noEmail(hq);
  } finally { f.close(); }
});

test('3: only a company admin changes tasks; a member and HQ without a seat are refused by name', async () => {
  const f = fixture();
  try {
    const member = await f.call('POST', '/company/co-a/compliance', MEMBER, { title: 'X', due: '2027-01-01' });
    assert.equal(member.status, 403);
    assert.equal(member.body.error, 'not_company_admin');
    const hq = await f.call('POST', '/company/co-a/compliance', HQ, { title: 'X', due: '2027-01-01' });
    assert.equal(hq.status, 403);
    assert.equal(hq.body.error, 'read_only_admin');
    const seated = await f.call('POST', '/company/co-a/compliance', HQ_SEATED, { title: 'Seated HQ task', due: '2027-01-02' });
    assert.equal(seated.status, 201, 'HQ with a seat is refused');
    for (const bad of [{ title: '', due: '2027-01-01' }, { title: 'X', due: '2027-13-01' }, { title: 'X', due: '2027-01-01', type: 'tax' }, { title: 'X', due: '2027-01-01', recurrence: 'daily' }, { title: 'X', due: '2027-01-01', extra: 1 }]) {
      const r = await f.call('POST', '/company/co-a/compliance', ADMIN, bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.body.error, 'invalid_task');
    }
    const other = await newTask(f, { project_id: 20 });
    assert.equal(other.status, 422);
    assert.equal(other.body.error, 'company_mismatch');
    const made = await newTask(f);
    assert.equal(made.status, 201);
    assert.equal(made.body.task.type, 'Payment');
    assert.equal(made.body.task.status, 'due');
    assert.equal(made.body.task.project, null, 'a company task names a project');
    const uid = made.body.task.uid;
    assert.equal((await f.call('PATCH', `/company/co-a/compliance/${uid}`, MEMBER, { title: 'Y' })).body.error, 'not_company_admin');
    const edited = await f.call('PATCH', `/company/co-a/compliance/${uid}`, ADMIN, { due: '2027-03-02', title: 'Delaware tax' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.task.due, '2027-03-02');
    assert.equal(edited.body.task.title, 'Delaware tax');
    assert.equal(edited.body.task.jurisdiction, 'US-DE', 'a field not sent changed');
    assert.equal(edited.body.task.type, 'Payment', 'a field not sent changed');
    const cleared = await f.call('PATCH', `/company/co-a/compliance/${uid}`, ADMIN, { description: 'Pay online.' });
    assert.equal(cleared.body.task.description, 'Pay online.');
    assert.equal(cleared.body.task.due, '2027-03-02', 'the due date moved when not sent');
    assert.equal((await f.call('PATCH', `/company/co-a/compliance/${uid}`, ADMIN, {})).status, 400);
    assert.equal((await f.call('POST', `/company/co-a/compliance/${uid}/done`, MEMBER, {})).body.error, 'not_company_admin');
    assert.equal((await f.call('GET', `/company/co-b/compliance/${uid}`, OUTSIDER)).status, 404, 'a task is read through another company');
    noEmail(made); noEmail(edited);
  } finally { f.close(); }
});

test('4: an owner is a seat or the company\'s own active agent; anyone else is assignee_not_member', async () => {
  const f = fixture();
  try {
    const uid = (await newTask(f)).body.task.uid;
    const path = `/company/co-a/compliance/${uid}/assignee`;
    for (const to of [{ kind: 'person', uid: 'u-out' }, { kind: 'person', uid: 'u-hq' }, { kind: 'agent', uid: 'ag-b' }]) {
      const r = await f.call('PUT', path, ADMIN, { assignee: to });
      assert.equal(r.status, 422, JSON.stringify(to));
      assert.equal(r.body.error, 'assignee_not_member');
    }
    assert.equal((await f.call('PUT', path, MEMBER, { assignee: { kind: 'person', uid: 'u-member' } })).body.error, 'not_company_admin');
    const person = await f.call('PUT', path, ADMIN, { assignee: { kind: 'person', uid: 'u-member2' } });
    assert.equal(person.status, 200);
    assert.deepEqual(person.body.task.owner, { kind: 'person', uid: 'u-member2', name: 'Ivy Investor' });
    const agent = await f.call('PUT', path, ADMIN, { assignee: { kind: 'agent', uid: 'ag-a' } });
    assert.deepEqual(agent.body.task.owner, { kind: 'agent', uid: 'ag-a', name: 'Lex' });
    assert.equal((await f.call('PUT', path, ADMIN, { assignee: null })).body.task.owner, null);
    const picker = await f.call('GET', '/company/co-a/compliance/assignable', MEMBER);
    assert.equal(picker.status, 200);
    assert.deepEqual(picker.body.team.map((p: any) => p.uid), ['u-admin', 'u-member']);
    assert.deepEqual(picker.body.platform.map((p: any) => p.uid), ['u-member2', 'u-hq-seat']);
    assert.deepEqual(picker.body.agents.map((a: any) => a.uid), ['ag-a']);
    assert.equal(picker.body.team[0].capacity, null, 'a capacity is invented');
    noEmail(picker); noEmail(person);
  } finally { f.close(); }
});

test('5: agents prepare and never mark done; another company\'s agent is refused; an agent entry carries its cost', async () => {
  const f = fixture();
  try {
    const uid = (await newTask(f)).body.task.uid;
    const s = await companyOf(f.env, 'co-a');
    await commentOn(f.env, s, { agentId: 70, costMicrousd: 4200 }, uid, 'Drafted the filing from last year’s return.');
    const ready = await readyForReview(f.env, s, { agentId: 70 }, uid);
    assert.equal(ready.review_state, 'ready_for_review');
    await assert.rejects(markDone(f.env, s, { agentId: 70 }, uid, null), (e: any) => e.status === 403 && e.code === 'agent_cannot_close');
    await assert.rejects(commentOn(f.env, s, { agentId: 80 }, uid, 'Not mine'), (e: any) => e.status === 403 && e.code === 'not_member');
    const hqComment = await f.call('POST', `/company/co-a/compliance/${uid}/comments`, HQ, { body: 'Looks fine' });
    assert.equal(hqComment.body.error, 'read_only_admin');
    const memberComment = await f.call('POST', `/company/co-a/compliance/${uid}/comments`, MEMBER, { body: 'I can sign it Friday.' });
    assert.equal(memberComment.status, 201);
    assert.equal((await f.call('POST', `/company/co-a/compliance/${uid}/comments`, MEMBER, { body: '  ' })).status, 400);
    const read = await f.call('GET', `/company/co-a/compliance/${uid}`, MEMBER);
    const t = read.body.timeline;
    assert.deepEqual(t.map((e: any) => e.kind), ['created', 'comment', 'ready_for_review', 'comment']);
    assert.deepEqual(t[1].actor, { kind: 'agent', uid: 'ag-a', name: 'Lex' });
    assert.equal(t[1].cost_microusd, 4200);
    assert.equal(t[3].cost_microusd, null, 'a person\'s comment carries a cost');
    assert.equal(t[3].actor.name, 'Mo Member');
    noEmail(read);
  } finally { f.close(); }
});

test('6: mark done rolls a recurring task forward once, keeps its owner, and reopen undoes done', async () => {
  const f = fixture();
  try {
    const uid = (await newTask(f, { recurrence: 'annual', due: '2027-03-01' })).body.task.uid;
    await f.call('PUT', `/company/co-a/compliance/${uid}/assignee`, ADMIN, { assignee: { kind: 'person', uid: 'u-member' } });
    const done = await f.call('POST', `/company/co-a/compliance/${uid}/done`, ADMIN, { note: 'Filed online.' });
    assert.equal(done.status, 200);
    assert.equal(done.body.task.status, 'done');
    assert.equal((await f.call('POST', `/company/co-a/compliance/${uid}/done`, ADMIN, {})).status, 409);
    const list = (await f.call('GET', '/company/co-a/compliance', MEMBER)).body.tasks;
    assert.deepEqual(list.map((t: any) => [t.due, t.status]), [['2027-03-01', 'done'], ['2028-02-29', 'due']]);
    assert.equal(list[1].owner.uid, 'u-member', 'the next occurrence lost its owner');
    await f.call('POST', `/company/co-a/compliance/${uid}/reopen`, ADMIN);
    await f.call('POST', `/company/co-a/compliance/${uid}/done`, ADMIN, {});
    assert.equal((await f.call('GET', '/company/co-a/compliance', MEMBER)).body.tasks.length, 2, 'the next occurrence was rolled twice');
    const filtered = await f.call('GET', '/company/co-a/compliance?status=due', MEMBER);
    assert.deepEqual(filtered.body.tasks.map((t: any) => t.due), ['2028-02-29']);
    assert.equal((await f.call('GET', '/company/co-a/compliance?status=late', MEMBER)).status, 400);
    assert.deepEqual((await f.call('GET', '/company/co-a/compliance?owner=u-member', MEMBER)).body.tasks.length, 2);
    assert.deepEqual((await f.call('GET', '/company/co-a/compliance?type=filing', MEMBER)).body.tasks, []);
    assert.equal((await f.call('GET', '/company/co-a/compliance?jurisdiction=US-DE', MEMBER)).body.tasks.length, 2);
    assert.deepEqual((await f.call('GET', '/company/co-a/compliance?jurisdiction=UK', MEMBER)).body.tasks, []);
    assert.deepEqual((await f.call('GET', '/company/co-a/compliance?owner=none', MEMBER)).body.tasks, []);
    assert.equal((await f.call('GET', '/company/co-a/compliance?type=payment', MEMBER)).body.tasks.length, 2);
  } finally { f.close(); }
});

test('7: Create work links only within the company; the item lands in Backlog and the task shows it', async () => {
  const f = fixture();
  try {
    const uid = (await newTask(f)).body.task.uid;
    const path = `/company/co-a/compliance/${uid}/work`;
    const across = await f.call('POST', path, ADMIN, { project_id: 20 });
    assert.equal(across.status, 422);
    assert.equal(across.body.error, 'company_mismatch');
    const solo = await f.call('POST', path, ADMIN, { project_id: 30 });
    assert.equal(solo.status, 422);
    assert.equal(solo.body.error, 'standalone_project');
    assert.equal((await f.call('POST', path, MEMBER, { project_id: 10 })).body.error, 'not_company_admin');
    const made = await f.call('POST', path, ADMIN, { project_id: 10 });
    assert.equal(made.status, 201);
    assert.equal(made.body.item.column, 'backlog');
    assert.equal(made.body.item.project_name, 'Pilot app');
    const row = f.db.prepare('SELECT compliance_ref, type, board_column FROM scope_tasks WHERE uid = ?').get(made.body.item.uid) as any;
    assert.equal(row.type, 'compliance');
    assert.equal(row.board_column, 'backlog');
    assert.equal(row.compliance_ref, (f.db.prepare('SELECT id FROM compliance_events WHERE uid = ?').get(uid) as any).id);
    const read = await f.call('GET', `/company/co-a/compliance/${uid}`, MEMBER);
    assert.deepEqual(read.body.task.linked_work, { uid: made.body.item.uid, task_number: 1, title: 'Delaware franchise tax', project_id: 10, project_name: 'Pilot app', column: 'backlog' });
    assert.equal(read.body.timeline.at(-1).kind, 'work_linked');
    const off = fixture('off');
    try {
      const u2 = (await newTask(off)).body.task.uid;
      assert.equal((await off.call('POST', `/company/co-a/compliance/${u2}/work`, ADMIN, { project_id: 10 })).status, 404, 'work was created with boards off');
    } finally { off.close(); }
  } finally { f.close(); }
});

test('8: a seat that ends flags its open tasks with an event and never reassigns; a refused leave flags nothing', async () => {
  const f = fixture();
  try {
    const open = (await newTask(f)).body.task.uid;
    const closed = (await newTask(f, { title: 'Annual report', due: '2027-04-01' })).body.task.uid;
    for (const uid of [open, closed]) await f.call('PUT', `/company/co-a/compliance/${uid}/assignee`, ADMIN, { assignee: { kind: 'person', uid: 'u-member' } });
    await f.call('POST', `/company/co-a/compliance/${closed}/done`, ADMIN, {});
    const left = await f.call('DELETE', '/company/co-a/members/2', ADMIN);
    assert.equal(left.status, 200);
    const rows = f.db.prepare('SELECT uid, needs_reassignment, assignee_user_id FROM compliance_events WHERE company_id = 50 ORDER BY id').all() as any[];
    const byUid = Object.fromEntries(rows.map((r) => [r.uid, r]));
    assert.equal(byUid[open].needs_reassignment, 1, 'an open task was not flagged');
    assert.equal(byUid[open].assignee_user_id, MEMBER, 'the task was reassigned');
    assert.equal(byUid[closed].needs_reassignment, 0, 'a done task was flagged');
    const ev = f.db.prepare(`SELECT kind, actor_kind FROM compliance_task_events WHERE kind = 'needs_reassignment'`).all() as any[];
    assert.equal(ev.length, 1);
    assert.equal(ev[0].actor_kind, 'system');
    assert.equal((await f.call('GET', `/company/co-a/compliance/${open}`, ADMIN)).body.task.needs_reassignment, true);
    // The last primary admin may not leave, and nothing of theirs is flagged.
    const mine = (await newTask(f, { title: 'Board minutes', due: '2027-05-01' })).body.task.uid;
    await f.call('PUT', `/company/co-a/compliance/${mine}/assignee`, ADMIN, { assignee: { kind: 'person', uid: 'u-admin' } });
    assert.equal((await f.call('POST', '/company/co-a/leave', ADMIN)).status, 409);
    assert.equal((f.db.prepare('SELECT needs_reassignment n FROM compliance_events WHERE uid = ?').get(mine) as any).n, 0);
    // Reassigning clears the flag.
    const again = await f.call('PUT', `/company/co-a/compliance/${open}/assignee`, ADMIN, { assignee: { kind: 'person', uid: 'u-member2' } });
    assert.equal(again.body.task.needs_reassignment, false);
    // A member who leaves on their own is flagged the same way.
    const ivy = (await newTask(f, { title: 'Signature', due: '2027-06-01' })).body.task.uid;
    await f.call('PUT', `/company/co-a/compliance/${ivy}/assignee`, ADMIN, { assignee: { kind: 'person', uid: 'u-member2' } });
    assert.equal((await f.call('POST', '/company/co-a/leave', MEMBER2)).status, 200);
    assert.equal((f.db.prepare('SELECT needs_reassignment n FROM compliance_events WHERE uid = ?').get(ivy) as any).n, 1);
  } finally { f.close(); }
});

test('9: the Calendar shows a company task to its seats with the company badge, and to nobody else', async () => {
  const f = fixture();
  try {
    await newTask(f, { due: '2026-11-20', title: 'Company-level filing' });
    f.db.exec(`INSERT INTO compliance_events(project_id,company_id,jurisdiction,event_type,title,due_date) VALUES (10,50,'US-DE','other','Venture filing','2026-11-21')`);
    const from = '2026-11-01T00:00:00.000Z', to = '2026-12-01T00:00:00.000Z';
    const mine = await complianceDueEvents(f.env, ADMIN, from, to);
    assert.deepEqual(mine.map((e) => [e.title, e.compliance?.company_task, e.compliance?.company?.name]), [
      ['Company-level filing', true, 'Acme Holdings'], ['Venture filing', false, 'Acme Holdings']]);
    assert.equal(mine[0].project_id, null);
    const member = await complianceDueEvents(f.env, MEMBER, from, to);
    assert.deepEqual(member.map((e) => e.title), ['Company-level filing'], 'a member sees another founder\'s venture, or not the company task');
    assert.deepEqual(await complianceDueEvents(f.env, OUTSIDER, from, to), []);
  } finally { f.close(); }
});
