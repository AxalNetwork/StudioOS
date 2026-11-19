/**
 * D7177 (#7177, brief D7043) — saving a Research comparison all or nothing:
 * one D1 batch with a confirmed `rolled_back` reply, a request id per Compare
 * sheet so a repeat returns the same comparison, the save-status read by
 * request id, a generated title that keeps room for " …", a per-cell
 * Unreadable kept apart from Not recorded, and the optional new project plus
 * comparison in one request.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_comparison_saves_7177.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { d1Over } from './_d1_sqlite.mjs';
import projects from '../src/routes/research_projects.ts';
import comparisons, {
  TITLE_LIMIT, TITLE_MORE, companyCells, defaultComparisonTitle, memberCells, readRequestId,
} from '../src/routes/research_project_comparisons.ts';

const app = new Hono().route('/api/research/projects', comparisons).route('/api/research/projects', projects);
app.onError((error, c) => c.json({ detail: error.message }, error.message === 'Unauthorized' ? 401 : 500));
const SECRET = 'unit-research-comparison-saves-0123456789012';
const sql = (name: string) => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');
const REQUEST_MIGRATION = 'migrations/202611180051_7177_research_comparison_request_id.sql';
const RID = '0b7c1e2a-5d0f-4e8b-9a61-3f2d7c9e4a10';

/** The schema the routes read, and a binding whose batch and reads a test can break. */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = sql('schema_baseline.sql');
  db.exec(baseline.match(/CREATE TABLE users \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE projects \([\s\S]*?;/)![0]);
  db.exec(baseline.match(/CREATE TABLE activity_logs \([\s\S]*?;/)![0]);
  db.exec(sql('migrations/213_research_library.sql'));
  db.exec(sql('migrations/221_research_ask_sessions.sql'));
  db.exec(sql('migrations/202611151315_6272_ask_history_cleared.sql'));
  db.exec(sql('migrations/385_research_disposition_collections.sql'));
  db.exec(sql('migrations/202611092035_research_projects.sql'));
  db.exec(sql('migrations/228_research_company_directory.sql').match(/CREATE TABLE IF NOT EXISTS research_company_directory \([\s\S]*?\n\);/)![0]);
  db.exec(sql('migrations/375_research_company_directory_columns.sql'));
  db.exec(sql('migrations/378_research_fund_directory_rebuild.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_directory \(.*?\);/)![0]);
  db.exec(sql('migrations/406_research_fund_sources.sql').match(/CREATE TABLE IF NOT EXISTS research_fund_sources \([\s\S]*?\n\);/)![0]);
  db.exec(sql('migrations/202611130634_5157_research_project_comparisons.sql'));
  db.exec(sql(REQUEST_MIGRATION));
  db.exec("INSERT INTO users (id,email,name,role) VALUES (701,'owner@example.test','Owner','founder'),(702,'other@example.test','Other','founder')");
  db.exec(`INSERT INTO research_company_directory (uid,name,website,country,source_name,source_url,as_of) VALUES
    ('c-1','Alpha Grid','https://a.example','Norway','Wikidata','https://w.example/1','2026-09-30'),
    ('c-2','Beta Freight','https://b.example','Poland','Wikidata','https://w.example/2','2026-09-30'),
    ('c-3','Gamma Labs','https://c.example','Canada','Wikidata','https://w.example/3','2026-09-30')`);
  db.exec('PRAGMA foreign_keys=ON');
  const underlying = d1Over(db);
  const hooks: { beforeBatch?: () => void; failBatch?: boolean; failReads?: boolean } = {};
  const DB = {
    ...underlying,
    prepare(query: string) {
      const stmt = underlying.prepare(query);
      // Only the comparison reads fail: sign-in still reads its user.
      if (!hooks.failReads || !query.includes('research_project_comparisons k')) return stmt;
      const broken = { ...stmt, bind: () => broken, first: async () => { throw new Error('D1_ERROR: network'); }, all: async () => { throw new Error('D1_ERROR: network'); } };
      return broken;
    },
    async batch(stmts: any[]) {
      hooks.beforeBatch?.();
      if (hooks.failBatch) { hooks.failReads = true; throw new Error('D1_ERROR: connection closed'); }
      return underlying.batch(stmts);
    },
  };
  return { db, hooks, env: { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, method: string, path: string, body?: unknown, who = 701) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const response = await app.request(`/api/research/projects${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, f.env);
  return { status: response.status, body: await response.json() as any };
}
const count = (f: F, table: string) => Number((f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n);
const receipts = (f: F) => (f.db.prepare("SELECT action FROM activity_logs WHERE action LIKE 'research_project_%' ORDER BY id").all() as any[]).map((r) => r.action);
const project = async (f: F, who = 701) => (await call(f, 'POST', '', { question: 'Which grid companies raised a Series A?' }, who)).body.item.uid as string;
/** Makes the third column's insert fail inside the batch, as a mid-save failure would. */
const breakThirdColumn = (f: F) => f.db.exec(`CREATE TRIGGER t_fail_third BEFORE INSERT ON research_project_comparison_members
  WHEN NEW.position = 3 BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`);

test('the migration keeps one comparison per member and request id, and checks the id length', () => {
  const f = fixture();
  f.db.exec("INSERT INTO research_projects (id,uid,owner_user_id,title,question,created_by) VALUES (1,'p',701,'T','Q',701),(2,'q',702,'T','Q',702)");
  const insert = (id: number, owner: number, rid: string | null) => f.db.prepare(
    "INSERT INTO research_project_comparisons (id,uid,project_id,owner_user_id,kind,title,created_by,request_id) VALUES (?,?,?,?,'company','T',?,?)",
  ).run(id, `k${id}`, owner === 701 ? 1 : 2, owner, owner, rid);
  insert(1, 701, RID);
  insert(2, 701, null);
  insert(3, 701, null);
  insert(4, 702, RID);
  // Mutation checked: drop the unique index → a second comparison under the same member and id inserts.
  assert.throws(() => insert(5, 701, RID), /UNIQUE/);
  // Mutation checked: drop the CHECK → a three-character id inserts.
  assert.throws(() => insert(6, 701, 'abc'), /CHECK/);
});

test('readRequestId takes a uuid-like id or none, and refuses anything else', () => {
  assert.deepEqual(readRequestId(undefined), { value: null });
  assert.deepEqual(readRequestId(RID), { value: RID });
  assert.equal(readRequestId('short').error, 'invalid_request_id');
  assert.equal(readRequestId("x'; DROP TABLE users;--").error, 'invalid_request_id');
  assert.equal(readRequestId(42).error, 'invalid_request_id');
});

test('a save is one batch: a failure part-way keeps nothing and the reply confirms the rollback', async () => {
  const f = fixture();
  const uid = await project(f);
  await call(f, 'POST', `/${uid}/subjects`, { kind: 'company', uids: ['c-1'] });
  const before = (f.db.prepare('SELECT updated_at FROM research_projects').get() as any).updated_at;
  breakThirdColumn(f);
  const r = await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['c-1', 'c-2', 'c-3'], request_id: RID });
  // Mutation checked: run the statements one by one instead of env.DB.batch → Beta Freight and the comparison stay.
  assert.deepEqual([r.status, r.body.detail, r.body.rolled_back], [500, 'save_rolled_back', true]);
  assert.equal(count(f, 'research_project_comparisons'), 0);
  assert.equal(count(f, 'research_project_comparison_members'), 0);
  assert.deepEqual((f.db.prepare('SELECT directory_uid FROM research_project_subjects').all() as any[]).map((s) => s.directory_uid), ['c-1'], 'only the subject added before stays');
  assert.equal((f.db.prepare('SELECT updated_at FROM research_projects').get() as any).updated_at, before);
  assert.equal(receipts(f).includes('research_project_comparison_created'), false, 'no receipt for a save that wrote nothing');
  // The status read agrees: nothing was saved under the id, so trying again is safe.
  assert.deepEqual((await call(f, 'GET', `/comparison-saves/${RID}`)).body, { state: 'not_found', request_id: RID });
  f.db.exec('DROP TRIGGER t_fail_third');
  const again = await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['c-1', 'c-2', 'c-3'], request_id: RID });
  assert.deepEqual([again.status, again.body.item.members, again.body.repeat], [201, 3, false]);
});

test('a project archived during the save keeps nothing from it', async () => {
  const f = fixture();
  const uid = await project(f);
  f.hooks.beforeBatch = () => f.db.exec("UPDATE research_projects SET status = 'archived', archived_at = datetime('now')");
  const r = await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['c-1', 'c-2'] });
  // Mutation checked: drop `status <> 'archived'` from the project subquery → the comparison is written into the archived project.
  assert.deepEqual([r.status, r.body.rolled_back], [500, true]);
  assert.equal(count(f, 'research_project_comparisons') + count(f, 'research_project_subjects'), 0);
});

test('when neither the save nor the check can be read, the outcome is unknown and nobody is told nothing was added', async () => {
  const f = fixture();
  const uid = await project(f);
  f.hooks.failBatch = true;
  const r = await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['c-1', 'c-2'], request_id: RID });
  // Mutation checked: answer a failed confirming read as rolled back → rolled_back is true here.
  assert.deepEqual([r.status, r.body.detail, r.body.rolled_back], [503, 'save_outcome_unknown', null]);
  // And the status read itself, failing, says unreadable rather than not found.
  const status = await call(f, 'GET', `/comparison-saves/${RID}`);
  assert.deepEqual([status.status, status.body.state, status.body.detail], [503, 'unreadable', 'save_status_unreadable']);
});

test('a request id makes a repeat return the same comparison, and never a second one', async () => {
  const f = fixture();
  const uid = await project(f);
  const first = await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['c-1', 'c-2'], request_id: RID });
  assert.deepEqual([first.status, first.body.repeat, first.body.rolled_back, first.body.project.uid, first.body.subjects_added], [201, false, false, uid, 2]);
  const repeat = await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['c-1', 'c-2'], request_id: RID });
  // Mutation checked: skip both request-id lookups (before the batch and after it fails) → the repeat reads as
  // rolled back; either one alone is covered by the other and by the unique index.
  assert.deepEqual([repeat.status, repeat.body.repeat, repeat.body.item.uid], [200, true, first.body.item.uid]);
  assert.equal(count(f, 'research_project_comparisons'), 1);
  // Without an id every save is its own comparison, as before.
  await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['c-1', 'c-2'] });
  assert.equal(count(f, 'research_project_comparisons'), 2);
  // The same id into another project is refused; another member's id is theirs alone.
  const other = await project(f);
  assert.deepEqual((await call(f, 'POST', `/${other}/comparisons`, { kind: 'company', uids: ['c-3'], request_id: RID })).body.detail, 'request_id_reused');
  const theirs = await project(f, 702);
  assert.equal((await call(f, 'POST', `/${theirs}/comparisons`, { kind: 'company', uids: ['c-3'], request_id: RID }, 702)).status, 201);
  assert.equal((await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['c-3'], request_id: 'bad id!' })).body.detail, 'invalid_request_id');
  assert.deepEqual(receipts(f).filter((a) => a === 'research_project_comparison_created').length, 3, 'one receipt per comparison made');
});

test('a repeat that races the first attempt is answered with the first attempt’s comparison', async () => {
  const f = fixture();
  const uid = await project(f);
  // The first attempt commits while this one is between its lookup and its batch.
  f.hooks.beforeBatch = () => {
    f.hooks.beforeBatch = undefined;
    f.db.exec(`INSERT INTO research_project_comparisons (uid,project_id,owner_user_id,kind,title,created_by,request_id)
      SELECT 'k-first', id, 701, 'company', 'First attempt', 701, '${RID}' FROM research_projects WHERE uid = '${uid}'`);
  };
  const r = await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['c-1', 'c-2'], request_id: RID });
  // Mutation checked: drop the request-id lookup after a failed batch → this reads as rolled back.
  assert.deepEqual([r.status, r.body.repeat, r.body.item.uid], [200, true, 'k-first']);
  assert.equal(count(f, 'research_project_comparisons'), 1);
  assert.equal(count(f, 'research_project_subjects'), 0, 'the losing batch kept nothing');
});

test('save status by request id: saved with the comparison, not found, owner-scoped', async () => {
  const f = fixture();
  const uid = await project(f);
  const made = await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['c-1', 'c-2', 'c-3'], request_id: RID });
  const status = await call(f, 'GET', `/comparison-saves/${RID}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.state, 'saved');
  assert.deepEqual([status.body.item.uid, status.body.item.members, status.body.item.title, status.body.project.uid],
    [made.body.item.uid, 3, 'Alpha Grid · Beta Freight · Gamma Labs', uid]);
  // Mutation checked: drop `k.owner_user_id = ?` from the status read → another member reads this save.
  assert.equal((await call(f, 'GET', `/comparison-saves/${RID}`, undefined, 702)).body.state, 'not_found');
  assert.equal((await call(f, 'GET', '/comparison-saves/nope')).status, 400);
});

test('the generated title keeps room for " …" inside the limit and cuts at a whole name', () => {
  // Two names that fill 159 characters, then a third: the old helper returned 161.
  const names = ['x'.repeat(100), 'y'.repeat(56), 'z'];
  // Mutation checked: append " …" without making room → 161 characters.
  assert.equal(defaultComparisonTitle(names), `${'x'.repeat(100)}${TITLE_MORE}`);
  // A title that leaves room keeps every name that fits.
  assert.equal(defaultComparisonTitle(['x'.repeat(100), 'y'.repeat(55), 'z']), `${'x'.repeat(100)} · ${'y'.repeat(55)}${TITLE_MORE}`);
  const long = ['Halden Grid Energy Storage Systems AS', 'Northwind Labs Logistics Software Inc.', 'Kestrel Robotics Industrial Automation GmbH',
    'Quarry AI Developer Platforms Inc.', 'Orchard Data Infrastructure Holdings Inc.', 'Tidewater Systems Climate Technologies B.V.'];
  const t = defaultComparisonTitle(long);
  assert.ok(t.length <= TITLE_LIMIT && t.endsWith(TITLE_MORE), t);
  assert.equal(t, `${long.slice(0, 3).join(' · ')}${TITLE_MORE}`, 'whole names only');
  assert.equal(defaultComparisonTitle(['n'.repeat(200)]).length, TITLE_LIMIT);
  assert.equal(defaultComparisonTitle(['A', 'B']), 'A · B');
});

test('six long names save in one go: the title fits the CHECK', async () => {
  const f = fixture();
  const uid = await project(f);
  const names = Array.from({ length: 6 }, (_, i) => `Company ${i} ${'Industrial Automation Holdings '.repeat(1)}${'B'.repeat(i)} Inc.`);
  names.forEach((n, i) => f.db.prepare("INSERT INTO research_company_directory (uid,name,website,source_name,source_url,as_of) VALUES (?,?,'https://x.example','W','https://w.example','2026-09-30')").run(`long-${i}`, n));
  const r = await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: names.map((_, i) => `long-${i}`) });
  assert.equal(r.status, 201);
  assert.ok(r.body.item.title.length <= TITLE_LIMIT);
  assert.equal(r.body.item.members, 6);
});

test('a value held in a form that cannot be read is Unreadable, never Not recorded', () => {
  const base = { uid: 'x', name: 'X', country: 'Norway', source_name: 'Wikidata', source_url: 'u', as_of: '2026-09-30', metrics_source_name: 'Filing', metrics_source_url: 'https://f.example' };
  const cells = companyCells({ ...base, employee_count: 'about forty', funding_total: 1000, funding_currency: 'EUR', revenue: null });
  // Mutation checked: drop the numeric check → employees reads 'recorded' with a text value.
  assert.deepEqual([cells.employees.status, cells.funding_total.status, cells.revenue.status, cells.country.status], ['unreadable', 'recorded', 'not_recorded', 'recorded']);
  assert.match((cells.employees as any).reason, /^Unreadable/);
  // A row whose cells cannot be built at all is Unreadable in every row, not a failed read of the table.
  const broken = new Proxy({}, { get: () => { throw new Error('bad row'); } });
  const all = memberCells('company', broken as any);
  // Mutation checked: let memberCells throw → the read fails; return {} → the rows are missing.
  assert.deepEqual(Object.values(all).map((c) => c.status), Array(7).fill('unreadable'));
});

test('the comparison read carries a per-cell unreadable state', async () => {
  const f = fixture();
  const uid = await project(f);
  f.db.exec("UPDATE research_company_directory SET employee_count = 'n/a', metrics_source_name = 'Filing' WHERE uid = 'c-1'");
  await call(f, 'POST', `/${uid}/comparisons`, { kind: 'company', uids: ['c-1', 'c-2'] });
  const read = await call(f, 'GET', `/${uid}/comparisons`);
  const [alpha, beta] = read.body.comparisons[0].members;
  assert.deepEqual([alpha.values.employees.status, beta.values.employees.status, alpha.values.country.status], ['unreadable', 'not_recorded', 'recorded']);
});

test('a new project and its comparison in one request: both or neither', async () => {
  const f = fixture();
  const body = { project: { question: 'Which grid companies raised a Series A?', title: 'Grid scan' }, kind: 'company', uids: ['c-1', 'c-2'], request_id: RID };
  // Refused before any write: a company that is not in the directory leaves no project behind.
  const refused = await call(f, 'POST', '/with-comparison', { ...body, uids: ['c-1', 'gone'] });
  assert.deepEqual([refused.status, refused.body.detail], [404, 'not_in_directory']);
  assert.equal(count(f, 'research_projects'), 0);
  // Undone part-way: the new project goes with the rest.
  breakThirdColumn(f);
  const undone = await call(f, 'POST', '/with-comparison', { ...body, uids: ['c-1', 'c-2', 'c-3'] });
  // Mutation checked: insert the project outside the batch → an empty project stays.
  assert.deepEqual([undone.status, undone.body.rolled_back], [500, true]);
  assert.equal(count(f, 'research_projects'), 0);
  f.db.exec('DROP TRIGGER t_fail_third');
  const made = await call(f, 'POST', '/with-comparison', body);
  assert.deepEqual([made.status, made.body.project.title, made.body.item.members], [201, 'Grid scan', 2]);
  const repeat = await call(f, 'POST', '/with-comparison', body);
  assert.deepEqual([repeat.status, repeat.body.repeat, repeat.body.project.uid], [200, true, made.body.project.uid]);
  assert.equal(count(f, 'research_projects'), 1);
  assert.deepEqual(receipts(f), ['research_project_created', 'research_project_comparison_created']);
  assert.equal((await call(f, 'POST', '/with-comparison', { ...body, project: { title: 'No question' } })).body.detail, 'question_required');
  // The project is the caller's own.
  const read = await call(f, 'GET', `/${made.body.project.uid}/comparisons`, undefined, 702);
  assert.equal(read.status, 404);
});
