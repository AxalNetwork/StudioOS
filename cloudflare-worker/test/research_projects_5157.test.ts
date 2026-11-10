/**
 * D5157 (#5157) — the Research Project store and its routes, against the
 * canonical migrations: create, list, read, update, archive and restore, the
 * evidence and Ask links, and owner scoping on every one of them.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_projects_5157.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { d1Over } from './_d1_sqlite.mjs';
import projects, { defaultTitle, mount, passagesUsed, readField } from '../src/routes/research_projects.ts';

const app = new Hono().route('/api/research/projects', projects);
app.onError((error, c) => c.json({ detail: error.message }, error.message === 'Unauthorized' ? 401 : 500));
const SECRET = 'unit-research-projects-0123456789012345678';
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');
const MIGRATION = 'migrations/202611092035_research_projects.sql';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  db.exec(baseline.match(/CREATE TABLE users \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE projects \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE activity_logs \([\s\S]*?;/)![0]);
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec(sql(MIGRATION));
  db.exec("INSERT INTO users (id,email,name,role) VALUES (701,'owner@example.test','Owner','founder'),(702,'other@example.test','Other','founder')");
  db.exec(`INSERT INTO research_documents (id,uid,owner_user_id,title,r2_key,index_state,created_at) VALUES
    (1,'doc-indexed',701,'EU Data Act','r/1','indexed','2026-11-01 10:00:00'),
    (2,'doc-pending',701,'Power prices','r/2','pending','2026-11-02 10:00:00'),
    (3,'doc-failed',701,'Investor memo','r/3','failed','2026-11-03 10:00:00'),
    (4,'other-doc',702,'Other file','r/4','indexed','2026-11-04 10:00:00')`);
  db.exec(`INSERT INTO research_collections (id,uid,owner_user_id,name,created_by) VALUES (1,'col-own',701,'EU regulation',701),(2,'col-other',702,'Theirs',702)`);
  db.exec('INSERT INTO research_collection_documents (collection_id,document_id,created_by) VALUES (1,1,701),(1,3,701),(2,4,702)');
  db.exec("INSERT INTO research_ask_sessions (id,uid,owner_user_id) VALUES (1,'ses-own',701),(2,'ses-other',702)");
  db.exec(`INSERT INTO research_ask_answers (id,uid,session_id,owner_user_id,question,answer,reason,citations) VALUES
    (1,'ans-own',1,701,'What applies?','The Act','answered','[{"document_uid":"doc-indexed","n":1},{"document_uid":"doc-indexed","n":2},{"title":"legacy","n":3}]'),
    (2,'ans-other',2,702,'Private?','Private','answered','[]')`);
  db.exec('PRAGMA foreign_keys=ON');
  const statements: string[] = [];
  const underlying = d1Over(db);
  const DB = { ...underlying, prepare(query: string) { statements.push(query); return underlying.prepare(query); } };
  return { db, statements, env: { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, method: string, path: string, body?: unknown, who: number | null = 701) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who != null) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
  }
  const response = await app.request(`/api/research/projects${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: response.status, body: await response.json() as any };
}
const rows = (f: F, q: string) => f.db.prepare(q).all().map((r) => ({ ...r }));
const receipts = (f: F) => rows(f, 'SELECT action, user_id FROM activity_logs ORDER BY id').map((r: any) => r.action);
const create = async (f: F, body: Record<string, unknown> = { question: 'Is EU GPU capacity a market a seed company can enter?' }, who = 701) =>
  (await call(f, 'POST', '', body, who)).body.item.uid as string;

test('the router mounts itself at /api/research/projects (#4105 registry)', () => {
  assert.equal(mount.path, '/api/research/projects');
  assert.equal(mount.router, projects);
  const registry = readFileSync(new URL('../src/routes/_registry.ts', import.meta.url), 'utf8');
  assert.match(registry, /research_projects/);
});

test('the migration refuses an empty title, an unknown status and an archive without its date', () => {
  const f = fixture();
  const insert = (title: string, status: string, archivedAt: string | null) => f.db.prepare(
    "INSERT INTO research_projects (uid,owner_user_id,title,question,status,archived_at,created_by) VALUES (lower(hex(randomblob(8))),701,?,'Q',?,?,701)",
  ).run(title, status, archivedAt);
  assert.throws(() => insert('  ', 'in_progress', null), /CHECK/);
  assert.throws(() => insert('T', 'deleted', null), /CHECK/);
  // Mutation checked: drop the pairing CHECK → both of these insert.
  assert.throws(() => insert('T', 'archived', null), /CHECK/);
  assert.throws(() => insert('T', 'in_progress', '2026-11-09 10:00:00'), /CHECK/);
  insert('T', 'archived', '2026-11-09 10:00:00');
});

test('create: the question is required, the title defaults to it, optional text is null not empty', async () => {
  const f = fixture();
  const statuses = [];
  for (const body of [{}, { question: '' }, { question: '   ' }, { question: 7 }, { question: 'x'.repeat(1001) }, { question: 'Q', title: 'x'.repeat(161) }, { question: 'Q', objective: 5 }]) {
    statuses.push((await call(f, 'POST', '', body)).status);
  }
  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 400, 400]);
  assert.equal((await call(f, 'POST', '', { question: 'Q' }, null)).status, 401);
  const question = "Which seed funds lead climate rounds?'; DROP TABLE research_projects; --";
  const made = await call(f, 'POST', '', { question: `  ${question}  `, objective: '  ', scope: 'EU-27' });
  assert.equal(made.status, 201);
  assert.deepEqual(
    [made.body.item.title, made.body.item.question, made.body.item.objective, made.body.item.scope, made.body.item.exclusions, made.body.item.status],
    [question, question, null, 'EU-27', null, 'in_progress'],
  );
  assert.equal(f.statements.some((q) => q.includes(question)), false, 'request text never reaches the query text');
  assert.deepEqual(receipts(f), ['research_project_created']);
});

test('defaultTitle keeps whole words inside the limit', () => {
  assert.equal(defaultTitle('  short   question '), 'short question');
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const title = defaultTitle(long);
  assert.ok(title.length <= 160, title);
  assert.match(title, /word\d+…$/);
  assert.deepEqual(readField('objective', null), { value: null });
  assert.deepEqual(readField('question', null), { error: 'question_required' });
});

test('list: only the owner’s, active by default, archived counted, counts are counts of links', async () => {
  const f = fixture();
  const a = await create(f, { question: 'First' });
  const b = await create(f, { question: 'Second' });
  await create(f, { question: 'Not yours' }, 702);
  await call(f, 'POST', `/${a}/documents`, { document_uid: 'doc-indexed' });
  // doc-indexed again through the collection: counted once.
  await call(f, 'POST', `/${a}/collections`, { collection_uid: 'col-own' });
  await call(f, 'POST', `/${a}/sessions`, { session_uid: 'ses-own' });
  await call(f, 'POST', `/${b}/archive`);
  const list = (await call(f, 'GET', '')).body;
  assert.deepEqual(list.items.map((i: any) => i.uid), [a]);
  assert.equal(list.archived_count, 1);
  // Mutation checked: UNION ALL and COUNT(d.id) in the evidence count → evidence reads 3.
  assert.deepEqual(list.items[0].counts, { evidence: 2, answerable: 1, collections: 1, sessions: 1, answers: 0 });
  assert.deepEqual((await call(f, 'GET', '?status=archived')).body.items.map((i: any) => i.uid), [b]);
  assert.deepEqual((await call(f, 'GET', '?status=all')).body.items.length, 2);
  assert.equal((await call(f, 'GET', '?status=deleted')).status, 400);
  assert.deepEqual((await call(f, 'GET', '', undefined, 702)).body.items.map((i: any) => i.title), ['Not yours']);
});

test('read: evidence from both routes once each, with the Library’s states and passages used', async () => {
  const f = fixture();
  const uid = await create(f);
  await call(f, 'POST', `/${uid}/documents`, { document_uid: 'doc-indexed' });
  await call(f, 'POST', `/${uid}/documents`, { document_uid: 'doc-pending' });
  await call(f, 'POST', `/${uid}/collections`, { collection_uid: 'col-own' });
  await call(f, 'POST', `/${uid}/sessions`, { session_uid: 'ses-own' });
  const read = (await call(f, 'GET', `/${uid}`)).body;
  const ev = Object.fromEntries(read.evidence.map((d: any) => [d.uid, [d.index_state, d.in_ask, d.direct, d.via_collections, d.passages_used]]));
  assert.deepEqual(ev, {
    'doc-indexed': ['indexed', true, true, ['EU regulation'], 2],
    'doc-pending': ['pending', false, true, [], 0],
    'doc-failed': ['failed', false, false, ['EU regulation'], 0],
  });
  // Mutation checked: count a citation with no document_uid as nothing → 0.
  assert.equal(read.passages_unattributed, 1);
  assert.deepEqual(read.collections, [{ uid: 'col-own', name: 'EU regulation', documents: 2 }]);
  assert.deepEqual(read.sessions.map((s: any) => [s.uid, s.answers]), [['ses-own', 1]]);
  assert.deepEqual(read.answers.map((a: any) => [a.uid, a.linked]), [['ans-own', false]]);
  assert.equal((await call(f, 'GET', `/${uid}`, undefined, 702)).status, 404);
});

test('passagesUsed survives bad JSON and counts unattributed citations', () => {
  const { used, unattributed } = passagesUsed(['not json', null, '{"a":1}', '[{"document_uid":"d"},{"n":1},null]']);
  assert.deepEqual([[...used], unattributed], [[['d', 1]], 2]);
});

test('links: only the caller’s rows, idempotent, and a removed link is gone without touching the row', async () => {
  const f = fixture();
  const uid = await create(f);
  const other = await create(f, { question: 'Theirs' }, 702);
  const statuses: number[] = [];
  const attempts: [string, string, unknown?][] = [
    ['POST', `/${uid}/documents`, { document_uid: 'other-doc' }],
    ['POST', `/${uid}/collections`, { collection_uid: 'col-other' }],
    ['POST', `/${uid}/sessions`, { session_uid: 'ses-other' }],
    ['POST', `/${uid}/answers`, { answer_uid: 'ans-other' }],
    ['POST', `/${other}/documents`, { document_uid: 'doc-indexed' }],
    ['DELETE', `/${other}/documents/other-doc`],
    ['POST', `/${uid}/documents`, {}],
    ['DELETE', `/${uid}/documents/doc-indexed`],
  ];
  for (const [method, path, body] of attempts) statuses.push((await call(f, method, path, body)).status);
  // Mutation checked: drop `AND owner_user_id = ?` from the documents `owned` read → the first is 200.
  assert.deepEqual(statuses, [404, 404, 404, 404, 404, 404, 400, 404]);
  assert.deepEqual(rows(f, 'SELECT COUNT(*) AS n FROM research_project_documents'), [{ n: 0 }]);
  const first = await call(f, 'POST', `/${uid}/answers`, { answer_uid: 'ans-own' });
  const again = await call(f, 'POST', `/${uid}/answers`, { answer_uid: 'ans-own' });
  assert.deepEqual([first.body.added, again.body.added], [true, false]);
  assert.equal((await call(f, 'DELETE', `/${uid}/answers/ans-own`)).status, 200);
  assert.deepEqual(rows(f, "SELECT COUNT(*) AS n FROM research_ask_answers WHERE uid='ans-own'"), [{ n: 1 }]);
  assert.deepEqual(receipts(f), ['research_project_created', 'research_project_created', 'research_project_answer_added', 'research_project_answer_removed']);
});

test('deleting a document drops its link, not the project', async () => {
  const f = fixture();
  const uid = await create(f);
  await call(f, 'POST', `/${uid}/documents`, { document_uid: 'doc-pending' });
  f.db.exec("DELETE FROM research_documents WHERE uid='doc-pending'");
  assert.deepEqual((await call(f, 'GET', `/${uid}`)).body.evidence, []);
  assert.equal((await call(f, 'GET', '')).body.items.length, 1);
});

test('update, archive and restore: an archived project is read-only until restored', async () => {
  const f = fixture();
  const uid = await create(f);
  const edited = await call(f, 'PATCH', `/${uid}`, { title: 'European AI Infrastructure', objective: 'Decide whether to enter.', exclusions: 'Consumer devices' });
  assert.deepEqual([edited.status, edited.body.item.title, edited.body.item.objective, edited.body.item.exclusions], [200, 'European AI Infrastructure', 'Decide whether to enter.', 'Consumer devices']);
  const cleared = await call(f, 'PATCH', `/${uid}`, { exclusions: null });
  assert.deepEqual([cleared.body.item.exclusions, cleared.body.item.objective], [null, 'Decide whether to enter.']);
  const statuses = [];
  for (const body of [{}, { title: '' }, { question: null }, { status: 'archived' }, { status: 'done' }]) statuses.push((await call(f, 'PATCH', `/${uid}`, body)).status);
  assert.deepEqual(statuses, [400, 400, 400, 400, 400]);
  assert.equal((await call(f, 'PATCH', `/${uid}`, { title: 'Stolen' }, 702)).status, 404);

  const archived = await call(f, 'POST', `/${uid}/archive`);
  assert.equal(archived.body.item.status, 'archived');
  assert.ok(archived.body.item.archived_at);
  // Mutation checked: drop the archived guard on links → this is 200.
  assert.equal((await call(f, 'POST', `/${uid}/documents`, { document_uid: 'doc-indexed' })).status, 409);
  assert.equal((await call(f, 'PATCH', `/${uid}`, { title: 'Again' })).status, 409);
  assert.equal((await call(f, 'POST', `/${uid}/archive`)).status, 409);
  assert.equal((await call(f, 'POST', `/${uid}/restore`, undefined, 702)).status, 404);
  const restored = await call(f, 'POST', `/${uid}/restore`);
  assert.deepEqual([restored.body.item.status, restored.body.item.archived_at], ['in_progress', null]);
  assert.equal((await call(f, 'POST', `/${uid}/restore`)).status, 409);
  assert.equal((await call(f, 'PATCH', `/${uid}`, { status: 'complete' })).body.item.status, 'complete');
  assert.deepEqual(receipts(f), ['research_project_created', 'research_project_updated', 'research_project_updated', 'research_project_archived', 'research_project_restored', 'research_project_updated']);
});
