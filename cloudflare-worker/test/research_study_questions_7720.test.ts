/** D7720 (#7720): mounted authenticated routes over the complete migrated SQLite schema.
 * Evidence survives status changes/deletion; refusals and races leave no partial writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { d1Over } from './_d1_sqlite.mjs';
import { openSchema, schemaInputs } from './_schema_once.mjs';
import { migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
// Cache the unchanged prefix once; apply this migration and every later one in order per fixture.
// SQL mutations therefore exercise the complete schema without rebuilding the unrelated prefix.
const MIGRATION = 202611220329;
const suffix = schemaInputs().migrations.filter((m: { name: string }) => migrationNumber(m.name) >= MIGRATION);
import questions, { QUESTION_LIMITS, QUESTION_MAX, STUDY_LINK_MAX, LINK_NOTE_LIMIT } from '../src/routes/research_study_questions.ts';
import decisions, { DECISION_TEXT_LIMIT, DECISION_LINK_MAX } from '../src/routes/research_study_decisions.ts';
import findings from '../src/routes/research_project_findings.ts';
const app = new Hono().route('/api/research/projects', questions).route('/api/research/projects', decisions).route('/api/research/projects', findings);
app.onError((e, c) => c.json({ error: e.message }, e.message === 'Unauthorized' ? 401 : 500));
let database: ReturnType<typeof openSchema> | undefined;
test.after(() => database?.close());
const SECRET = 'unit-study-questions-7720-0123456789abcdef';
function fixture() {
  // Serial fixtures reset project data; keep the fixed identities and append-only admin receipts.
  if (!database) {
    database = openSchema({ below: MIGRATION });
    database.exec('PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF;');
    for (const migration of suffix) database.exec(migration.sql);
  } else {
    database.exec(`DROP TRIGGER IF EXISTS test_fail_link;
      DELETE FROM research_projects WHERE id IN (1,2,3,4);
      DELETE FROM activity_logs;`);
  }
  const db = database;
  db.exec(`PRAGMA foreign_keys=ON;
    INSERT OR IGNORE INTO founders (id,name,email) VALUES (50,'Ada','ada@example.test');
    INSERT OR IGNORE INTO users (id,email,name,role,founder_id,is_active) VALUES (701,'one@example.test','One','founder',50,1), (702,'two@example.test','Two','founder',50,1);
    INSERT INTO research_projects (id,uid,owner_user_id,title,question,created_by) VALUES
      (1,'project-own',701,'T','Q',701), (2,'project-other',702,'T','Q',702), (3,'project-empty',701,'T','Q',701), (4,'project-foreign-finding',701,'T','Q',701);
    INSERT INTO research_studies (project_id,owner_user_id,product,created_by) VALUES (1,701,'Product',701), (2,702,'Product',702);
    INSERT INTO research_project_findings (id,uid,project_id,owner_user_id,kind,text,state,proposed_text,decided_by,created_by,updated_at) VALUES
      (1,'finding-support',1,701,'conclusion','secret support',NULL,NULL,701,701,'2026-11-19 10:00:00'),
      (2,'finding-contradict',1,701,'conclusion','secret against',NULL,NULL,701,701,'2026-11-19 10:01:00'),
      (3,'finding-discarded',1,701,'interpretation','secret discarded','discarded','proposal',701,701,'2026-11-19 10:02:00'),
      (4,'finding-foreign',4,701,'conclusion','other project',NULL,NULL,701,701,'2026-11-19 10:03:00');`);
  const base = d1Over(db); const hooks: { beforeBatch?: () => void; beforeRun?: () => void } = {};
  const DB = { ...base, prepare(sql: string) {
    const s = base.prepare(sql); const run = s.run;
    s.run = async () => { const h = hooks.beforeRun; delete hooks.beforeRun; h?.(); return run(); }; return s;
  }, async batch(stmts: any[]) { const h = hooks.beforeBatch; delete hooks.beforeBatch; h?.(); return base.batch(stmts); } };
  return { db, hooks, env: { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, method: string, path = '/study/questions', body?: unknown, who = 701, support = false, project = 'project-own') {
  const token = await new SignJWT({ user_id: who, role: 'founder', ...(support ? { impersonated_by: 9000 } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const r = await app.request(`/api/research/projects/${project}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
  return { status: r.status, body: await r.json() as any };
}
const count = (f: F, t: string) => Number((f.db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as any).n);
const version = (f: F) => Number((f.db.prepare('SELECT version FROM research_studies WHERE project_id = 1').get() as any).version);
async function create(f: F, extra = {}) { const r = await call(f, 'POST', undefined, { topic: 'demand', text: 'Secret question?', ...extra }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.questions.find((q: any) => q.uid === r.body.uid); }
const qpath = (q: any) => `/study/questions/${q.uid}`;
async function add(f: F, q: any, finding_uid: string, direction: string) {
  const r = await call(f, 'POST', `${qpath(q)}/links`, { version: q.version, finding_uid, direction, note: 'secret link note' });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.questions.find((x: any) => x.uid === q.uid);
}
const record = (f: F, extra = {}) => call(f, 'POST', '/study/decisions', { version: version(f), outcome: 'test_further', rationale: 'secret rationale', reversing_assumptions: 'secret reversal', links: [{ finding_uid: 'finding-support', direction: 'supports' }], ...extra });

test('counts distinguish no study, recorded zero, statuses and contradictory evidence after answer/set-aside', async () => {
  const f = fixture();
  assert.deepEqual((await call(f, 'GET', undefined, undefined, 701, false, 'project-empty')).body, { recorded: false, study_version: null, counts: null, questions: [] });
  const zero = (await call(f, 'GET')).body;
  assert.equal(zero.recorded, true);
  assert.deepEqual(zero.counts, { total: 0, answered: 0, open: 0, set_aside: 0, open_with_contradicting_evidence: 0, links_with_removed_finding: 0 });
  f.db.exec("INSERT INTO research_study_questions (uid, project_id, topic, text, position) VALUES ('other-question',2,'demand','Other',1)");
  let q = await create(f); q = await add(f, q, 'finding-support', 'supports'); q = await add(f, q, 'finding-contradict', 'contradicts');
  assert.deepEqual((await call(f, 'GET')).body.counts, { total: 1, answered: 0, open: 1, set_aside: 0, open_with_contradicting_evidence: 1, links_with_removed_finding: 0 });
  for (const status of ['answered', 'set_aside']) {
    const r = await call(f, 'PUT', qpath(q), { ...q, status, answer: 'Secret answer' }); assert.equal(r.status, 200);
    q = r.body.questions[0]; assert.deepEqual(q.links.map((l: any) => l.direction), ['supports', 'contradicts']);
    assert.equal(r.body.counts[status], 1); assert.equal(r.body.counts.open_with_contradicting_evidence, 0);
  }
  assert.equal(q.answer, 'Secret answer');
  let open = await create(f); open = await add(f, open, 'finding-support', 'contradicts'); open = await add(f, open, 'finding-contradict', 'contradicts');
  assert.deepEqual((await call(f, 'GET')).body.counts, { total: 2, answered: 0, open: 1, set_aside: 1, open_with_contradicting_evidence: 1, links_with_removed_finding: 0 });
  const logs = JSON.stringify(f.db.prepare("SELECT details FROM activity_logs WHERE action LIKE 'research_study_%'").all());
  for (const secret of ['Secret question', 'Secret answer', 'secret link note', 'secret support']) assert.equal(logs.includes(secret), false);
});
test('foreign and discarded targets refused; finding deletion retains direction, note and immutable snapshot', async () => {
  const f = fixture(); let q = await create(f);
  for (const finding_uid of ['finding-foreign', 'finding-discarded', 'absent']) {
    const r = await call(f, 'POST', `${qpath(q)}/links`, { version: q.version, finding_uid, direction: 'supports' });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'finding_not_in_project');
    assert.equal(count(f, 'research_study_links'), 0);
  }
  q = await add(f, q, 'finding-support', 'contradicts');
  f.db.exec("UPDATE research_project_findings SET kind='source_fact', updated_at='later' WHERE id=1");
  assert.equal((await call(f, 'DELETE', '/findings/finding-support')).status, 200);
  const r = await call(f, 'GET'); const link = r.body.questions[0].links[0];
  assert.equal(link.finding_removed, true); assert.equal(link.target_label, 'finding removed');
  assert.equal(link.direction, 'contradicts'); assert.equal(link.note, 'secret link note');
  assert.equal(link.finding_uid, 'finding-support'); assert.equal(link.finding_kind, 'conclusion'); assert.equal(link.finding_updated_at, '2026-11-19 10:00:00');
  assert.equal(r.body.counts.links_with_removed_finding, 1); assert.equal(r.body.counts.open_with_contradicting_evidence, 1);
  assert.equal((await call(f, 'DELETE', `${qpath(q)}/links/${link.uid}`, { version: q.version })).status, 200);
  assert.equal(count(f, 'research_study_links'), 0);
  f.db.exec("UPDATE research_project_findings SET state='accepted' WHERE id=3");
  q = (await call(f, 'GET')).body.questions[0]; q = await add(f, q, 'finding-discarded', 'context');
  assert.equal(q.links[0].finding_kind, 'interpretation');
});
test('versions fence edits, links, remove and complete-set reorder without partial changes', async () => {
  const f = fixture(); let a = await create(f); const b = await create(f, { topic: 'pricing' });
  a = await add(f, a, 'finding-support', 'supports');
  for (const [method, path, body] of [
    ['PUT', qpath(a), { ...a, version: 1, text: 'stale' }], ['DELETE', qpath(a), { version: 1 }],
    ['POST', `${qpath(a)}/links`, { version: 1, finding_uid: 'finding-contradict', direction: 'context' }],
    ['DELETE', `${qpath(a)}/links/${a.links[0].uid}`, { version: 1 }],
    ['POST', '/study/questions/reorder', { questions: [{ uid: b.uid, version: b.version }, { uid: a.uid, version: 1 }] }],
  ] as const) assert.equal((await call(f, method, path, body)).status, 409);
  assert.equal(count(f, 'research_study_links'), 1); assert.equal(count(f, 'research_study_questions'), 2);
  assert.equal((await call(f, 'GET')).body.questions[0].text, 'Secret question?');
  assert.equal((await call(f, 'POST', '/study/questions/reorder', { questions: [{ uid: a.uid, version: a.version }] })).status, 409);
  assert.equal((await call(f, 'POST', '/study/questions/reorder', { questions: [a, a] })).status, 400);
  const r = await call(f, 'POST', '/study/questions/reorder', { questions: [b, a] }); assert.equal(r.status, 200);
  assert.deepEqual(r.body.questions.map((q: any) => q.uid), [b.uid, a.uid]);
  assert.deepEqual(r.body.questions.map((q: any) => q.version), [b.version + 1, a.version + 1]);
  assert.equal((await call(f, 'DELETE', qpath(b), { version: b.version + 1 })).status, 200);
  assert.equal((await call(f, 'GET')).body.counts.total, 1);
});
test('decisions are append-only, newest first with their own frozen links, and cascade with project', async () => {
  const f = fixture(); const first = await record(f); assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.current.created_by, 701); assert.ok(first.body.current.created_at);
  assert.equal(first.body.current.rationale, 'secret rationale'); assert.equal(first.body.current.reversing_assumptions, 'secret reversal');
  assert.throws(() => f.db.prepare("UPDATE research_study_decisions SET rationale='changed'").run(), /study_decision_immutable/);
  const stale = await record(f, { version: 1 }); assert.equal(stale.status, 409); assert.equal(count(f, 'research_study_decisions'), 1);
  const second = await record(f, { outcome: 'enter', links: [{ finding_uid: 'finding-contradict', direction: 'contradicts' }] }); assert.equal(second.status, 201);
  const history = (await call(f, 'GET', '/study/decisions')).body;
  assert.equal(history.current.uid, second.body.current.uid);
  assert.deepEqual(history.decisions.map((d: any) => d.outcome), ['enter', 'test_further']);
  assert.deepEqual(history.decisions.map((d: any) => d.links[0].finding_uid), ['finding-contradict', 'finding-support']);
  const q = await create(f);
  assert.equal((await call(f, 'DELETE', `${qpath(q)}/links/${history.current.links[0].uid}`, { version: q.version })).status, 404);
  f.db.exec('DELETE FROM research_project_findings WHERE id=1');
  assert.equal((await call(f, 'GET', '/study/decisions')).body.decisions[1].links[0].finding_removed, true);
  const logs = JSON.stringify(f.db.prepare("SELECT details FROM activity_logs WHERE action='research_study_decision_recorded'").all());
  assert.equal(logs.includes('secret rationale'), false); assert.equal(logs.includes('secret reversal'), false);
  f.db.exec('DELETE FROM research_projects WHERE id=1');
  for (const t of ['research_studies', 'research_study_questions', 'research_study_decisions', 'research_study_links']) assert.equal(Number((f.db.prepare(`SELECT count(*) AS n FROM ${t} WHERE project_id=1`).get() as any).n), 0);
});
test('owner, support and archived gates cover every route, including reorder and decision reads', async () => {
  const f = fixture(); const q = await add(f, await create(f), 'finding-support', 'supports');
  const routes = [ ['POST', '/study/questions', { topic: 'demand', text: 'Q' }], ['PUT', qpath(q), q], ['DELETE', qpath(q), { version: q.version }],
    ['POST', '/study/questions/reorder', { questions: [q] }], ['POST', `${qpath(q)}/links`, { version: q.version, finding_uid: 'finding-support', direction: 'supports' }],
    ['DELETE', `${qpath(q)}/links/${q.links[0].uid}`, { version: q.version }], ['POST', '/study/decisions', { version: 1, outcome: 'enter', rationale: 'R' }] ] as const;
  for (const [method, path, body] of routes) {
    assert.equal((await call(f, method, path, body, 702)).status, 404);
    const support = await call(f, method, path, body, 701, true); assert.equal(support.status, 403); assert.equal(support.body.error, 'support_read_only');
    const unauth = await app.request(`/api/research/projects/project-own${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, f.env); assert.equal(unauth.status, 401);
  }
  for (const path of ['/study/questions', '/study/decisions']) assert.equal((await call(f, 'GET', path, undefined, 702)).status, 404);
  f.db.exec("UPDATE research_projects SET status='archived', archived_at=datetime('now') WHERE id=1");
  for (const [method, path, body] of routes) { const r = await call(f, method, path, body); assert.equal(r.status, 409); assert.equal(r.body.error, 'project_archived'); }
  for (const path of ['/study/questions', '/study/decisions']) assert.equal((await call(f, 'GET', path)).status, 200);
  assert.equal(count(f, 'research_study_questions'), 1); assert.equal(count(f, 'research_study_links'), 1); assert.equal(count(f, 'research_study_decisions'), 0);
});
test('bounds hold at and above text/row limits and invalid target kinds are refused', async () => {
  assert.deepEqual(QUESTION_LIMITS, { text: 1000, answer: 4000, gap_note: 2000, next_validation_action: 2000 });
  assert.equal(QUESTION_MAX, 100); assert.equal(STUDY_LINK_MAX, 1000); assert.equal(LINK_NOTE_LIMIT, 2000); assert.equal(DECISION_TEXT_LIMIT, 4000); assert.equal(DECISION_LINK_MAX, 20);
  const f = fixture();
  const at = Object.fromEntries(Object.entries(QUESTION_LIMITS).map(([k, n]) => [k, 'x'.repeat(n)]));
  const q = await create(f, at);
  for (const [key, n] of Object.entries(QUESTION_LIMITS)) assert.equal((await call(f, 'PUT', qpath(q), { ...q, [key]: 'x'.repeat(n + 1) })).status, 400);
  for (const body of [{ topic: 'invalid', text: 'Q' }, { topic: 'demand', text: '' }, { topic: 'demand', text: 'Q', status: 'invalid' }]) assert.equal((await call(f, 'POST', undefined, body)).status, 400);
  for (const extra of [{ note: 'x'.repeat(LINK_NOTE_LIMIT + 1) }, { target_kind: 'unimplemented' }, { direction: 'invalid' }]) assert.equal((await call(f, 'POST', `${qpath(q)}/links`, { version: q.version, finding_uid: 'finding-support', direction: 'supports', ...extra })).status, 400);
  assert.equal((await call(f, 'POST', `${qpath(q)}/links`, { version: q.version, finding_uid: 'finding-support', direction: 'context', note: 'x'.repeat(LINK_NOTE_LIMIT) })).status, 201);
  assert.equal((await record(f, { rationale: 'x'.repeat(DECISION_TEXT_LIMIT), reversing_assumptions: 'x'.repeat(DECISION_TEXT_LIMIT), links: [] })).status, 201);
  for (const key of ['rationale', 'reversing_assumptions']) assert.equal((await record(f, { [key]: 'x'.repeat(DECISION_TEXT_LIMIT + 1) })).status, 400);
  for (const extra of [{ links: Array(DECISION_LINK_MAX + 1).fill({ finding_uid: 'finding-support', direction: 'supports' }) }, { outcome: 'invalid' }, { rationale: '' }, { links: Array(STUDY_LINK_MAX + 1).fill({}) }]) assert.equal((await record(f, extra)).status, 400);
  const insert = f.db.prepare("INSERT INTO research_study_questions (uid,project_id,topic,text,position) VALUES (?,1,'demand','Q',1)");
  for (let i = 1; i < QUESTION_MAX; i++) insert.run(`limit-q-${i}`);
  assert.equal((await call(f, 'POST', undefined, { topic: 'demand', text: 'Q' })).status, 400); assert.equal(count(f, 'research_study_questions'), QUESTION_MAX);
  const qid = (f.db.prepare('SELECT id FROM research_study_questions LIMIT 1').get() as any).id;
  const il = f.db.prepare("INSERT INTO research_study_links (uid,project_id,question_id,direction,target_kind,finding_id,finding_uid,finding_kind,finding_updated_at) VALUES (?,1,?,'context','finding',1,'finding-support','conclusion','then')");
  for (let i = count(f, 'research_study_links'); i < STUDY_LINK_MAX; i++) il.run(`limit-l-${i}`, qid);
  const before = version(f); assert.equal((await record(f)).status, 400); assert.equal(version(f), before); assert.equal(count(f, 'research_study_decisions'), 1);
  assert.equal(count(f, 'research_study_links'), STUDY_LINK_MAX);
});
test('raced finding deletion/discard and batch failure roll back version, decision and every link', async () => {
  for (const mutation of ["DELETE FROM research_project_findings WHERE id=1", "UPDATE research_project_findings SET state='discarded' WHERE id=3", "UPDATE research_project_findings SET project_id=4 WHERE id=1"]) {
    const f = fixture(); if (mutation.includes('state=')) f.db.exec("UPDATE research_project_findings SET state='accepted' WHERE id=3");
    const uid = mutation.includes('state=') ? 'finding-discarded' : 'finding-support';
    f.hooks.beforeBatch = () => f.db.exec(mutation);
    const r = await record(f, { links: [{ finding_uid: 'finding-contradict', direction: 'supports' }, { finding_uid: uid, direction: 'contradicts' }] });
    assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(version(f), 1); assert.equal(count(f, 'research_study_decisions'), 0); assert.equal(count(f, 'research_study_links'), 0);
  }
  const f = fixture(); let q = await create(f);
  f.hooks.beforeBatch = () => f.db.exec('DELETE FROM research_project_findings WHERE id=1');
  assert.equal((await call(f, 'POST', `${qpath(q)}/links`, { version: 1, finding_uid: 'finding-support', direction: 'supports' })).status, 409);
  q = (await call(f, 'GET')).body.questions[0]; assert.equal(q.version, 1); assert.equal(q.links.length, 0);
  f.db.exec("CREATE TRIGGER test_fail_link BEFORE INSERT ON research_study_links BEGIN SELECT RAISE(ABORT,'forced link failure'); END");
  assert.equal((await record(f, { links: [{ finding_uid: 'finding-contradict', direction: 'context' }] })).status, 500);
  assert.equal(version(f), 1); assert.equal(count(f, 'research_study_decisions'), 0);
});
test('archiving or changing a version after authorization still fences SQL writes', async () => {
  for (const operation of ['create', 'edit', 'remove', 'reorder', 'addLink', 'removeLink']) {
    const raced = fixture(); const held = await add(raced, await create(raced), 'finding-support', 'supports');
    const writes: Record<string, [string, string, unknown]> = {
      create: ['POST', '/study/questions', { topic: 'demand', text: 'Raced' }],
      edit: ['PUT', qpath(held), { ...held, text: 'Raced' }],
      remove: ['DELETE', qpath(held), { version: held.version }],
      reorder: ['POST', '/study/questions/reorder', { questions: [held] }],
      addLink: ['POST', `${qpath(held)}/links`, { version: held.version, finding_uid: 'finding-contradict', direction: 'contradicts' }],
      removeLink: ['DELETE', `${qpath(held)}/links/${held.links[0].uid}`, { version: held.version }],
    };
    const archive = () => raced.db.exec("UPDATE research_projects SET status='archived', archived_at=datetime('now') WHERE id=1");
    if (operation === 'addLink' || operation === 'removeLink') raced.hooks.beforeBatch = archive; else raced.hooks.beforeRun = archive;
    const [method, path, body] = writes[operation]; const refused = await call(raced, method, path, body);
    assert.equal(refused.status, 409, operation);
    const state = (await call(raced, 'GET')).body; assert.equal(state.questions.length, 1); assert.equal(state.questions[0].version, held.version); assert.equal(state.questions[0].text, held.text); assert.deepEqual(state.questions[0].links, held.links);
  }
  const f = fixture(); const q = await create(f);
  f.hooks.beforeRun = () => f.db.exec("UPDATE research_projects SET status='archived', archived_at=datetime('now') WHERE id=1");
  assert.equal((await call(f, 'PUT', qpath(q), { ...q, text: 'must not save' })).status, 409);
  f.db.exec("UPDATE research_projects SET status='in_progress', archived_at=NULL WHERE id=1");
  f.hooks.beforeBatch = () => f.db.exec('UPDATE research_studies SET version=version+1 WHERE project_id=1');
  assert.equal((await record(f)).status, 409); assert.equal(count(f, 'research_study_decisions'), 0); assert.equal(count(f, 'research_study_links'), 0);
  f.hooks.beforeBatch = () => f.db.exec("UPDATE research_projects SET status='archived', archived_at=datetime('now') WHERE id=1");
  assert.equal((await record(f)).status, 409); assert.equal(count(f, 'research_study_decisions'), 0);
});
