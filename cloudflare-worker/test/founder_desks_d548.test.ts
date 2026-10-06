/**
 * `metric_targets` finally has both ends.
 *
 * Migration 173 created the table — `project_id`, `metric_key`, `target_value`,
 * a `direction` CHECK and `UNIQUE (project_id, metric_key)` — and then NOTHING
 * READ OR WROTE IT anywhere in the worker or the SPA, for twenty-one migrations.
 * It is the same orphan shape `interview_pain_severities` had before migration
 * 215's header named that one by example, and the consequence was visible on
 * three surfaces of `/grow/focus` at once: the "Targets" chip refused with "no
 * metric target is stored", the Target stat tile read "Not recorded · No target
 * source connected", and the rail listed "Target tracking" as unavailable.
 *
 * RUN, NOT READ. These call the routes against a real SQLite built from
 * MIGRATION 173 itself, because every failure worth catching here is shaped like
 * a write that succeeds and means the wrong thing:
 *
 *   · A `direction` defaulted from the column rather than the metric would put
 *     'up' on net burn, and migration 173's own comment says what that costs:
 *     the UI "would colour a burn overage green". The store, not the page, is
 *     where lower-is-better is known.
 *   · A second write from a second tab inserting rather than updating would leave
 *     two targets for one metric, and the reader would show whichever the index
 *     handed back first.
 *   · A target on a `metric_key` no snapshot carries can never be compared, so it
 *     would sit in the Targets view forever reading "Not recorded" and look like
 *     a broken reader rather than a metric this product does not store.
 *   · Clearing by sending 0 would make "get churn to zero" unsettable, and
 *     clearing by omission would make a mis-typed key permanent.
 *   · A read that is not narrowed to the caller's own project is the IDOR this
 *     file's neighbours exist to refuse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import progress from '../src/routes/progress.ts';
import { Hono } from 'hono';
const app = new Hono().route('/', progress);
// The entry point maps the shared permission helper's Forbidden error to 403.
app.onError((error, c) => c.json({ detail: error.message === 'Forbidden' ? 'Forbidden' : 'Internal error' }, error.message === 'Forbidden' ? 403 : 500));

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER_USER = 601;
const FOUNDER_ID = 71;
const OTHER_USER = 602;
const OTHER_FOUNDER_ID = 72;
const ADMIN_USER = 603;
const PROJECT = 8101;
const OTHER_PROJECT = 8102;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first(col?: string) {
          const r = db.prepare(sql).get(...b) ?? null;
          return col === undefined ? r : ((r as any)?.[col] ?? null);
        },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

/**
 * The target table comes FROM MIGRATION 173, not from a hand-written copy — the
 * rule `partner_pipeline_stores.test.ts` states in its own header, after a shape
 * copied into a test let it pass against a schema production did not have. It
 * matters twice over here, because the route ALSO carries a lazy `CREATE TABLE
 * IF NOT EXISTS` for dev databases: if that copy and the migration drift apart,
 * this fixture is the migration's side and the assertions below run against it.
 */
function tableFromMigration(name: string, table: string): string {
  const src = readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');
  const at = src.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(at >= 0, `${table} is no longer created by migration ${name}`);
  return src.slice(at, src.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
                        is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
                        name TEXT, email TEXT, spinout_lab_active INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER NOT NULL,
                           company_id INTEGER, name TEXT);
  `);
  db.exec(tableFromMigration('173_metrics_board_reporting', 'metric_targets'));
  db.exec(readFileSync(`${SQL}/migrations/384_metric_target_focus.sql`, 'utf8'));
  db.exec(readFileSync(`${SQL}/schema_baseline.sql`, 'utf8').match(/CREATE TABLE activity_logs[\s\S]*?;/)![0]);

  db.prepare('INSERT INTO users (id, role, founder_id, email) VALUES (?,?,?,?)')
    .run(FOUNDER_USER, 'founder', FOUNDER_ID, 'f@example.com');
  db.prepare('INSERT INTO users (id, role, founder_id, email) VALUES (?,?,?,?)')
    .run(OTHER_USER, 'founder', OTHER_FOUNDER_ID, 'other@example.com');
  db.prepare('INSERT INTO users (id, role, founder_id, email) VALUES (?,?,?,?)')
    .run(ADMIN_USER, 'admin', null, 'a@example.com');
  db.prepare('INSERT INTO projects (id, founder_id, name) VALUES (?,?,?)').run(PROJECT, FOUNDER_ID, 'Ours');
  db.prepare('INSERT INTO projects (id, founder_id, name) VALUES (?,?,?)')
    .run(OTHER_PROJECT, OTHER_FOUNDER_ID, 'Theirs');
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) }) as any;

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(e: any, path: string, init: RequestInit, who = FOUNDER_USER, role = 'founder') {
  const res = await app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${await token(who, role)}`, 'Content-Type': 'application/json' },
  }, e);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const put = (e: any, projectId: number, body: any, who = FOUNDER_USER, role = 'founder') =>
  call(e, `/metrics/${projectId}/targets`, { method: 'PUT', body: JSON.stringify(body) }, who, role);
const get = (e: any, projectId: number, who = FOUNDER_USER, role = 'founder') =>
  call(e, `/metrics/${projectId}/targets`, { method: 'GET' }, who, role);


test('D548: migration retains unrecorded focus and enforces a single explicit choice', async () => {
  const db = freshDb(); const e = env(db);
  await put(e, PROJECT, { metric_key: 'mrr', target_value: 100 });
  await put(e, PROJECT, { metric_key: 'active_users', target_value: 20 });
  assert.deepEqual((await get(e, PROJECT)).body.items.map((t: any) => t.is_focus), [null, null]);
  const chosen = await put(e, PROJECT, { metric_key: 'mrr', is_focus: true });
  assert.deepEqual([chosen.status, chosen.body.target.is_focus, chosen.body.target.target_value], [200, true, 100]);
  const refused = await put(e, PROJECT, { metric_key: 'active_users', is_focus: true });
  assert.equal(refused.status, 409);
  assert.throws(() => db.prepare('UPDATE metric_targets SET is_focus = 1 WHERE project_id = ? AND metric_key = ?').run(PROJECT, 'active_users'), /UNIQUE/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM metric_targets WHERE is_focus = 1').get()!.n, 1);
  db.close();
});
test('D548: clearing, preservation, and actor receipts describe the actual write', async () => {
  const db = freshDb(); const e = env(db);
  await put(e, PROJECT, { metric_key: 'mrr', target_value: 100, is_focus: true });
  const edited = await put(e, PROJECT, { metric_key: 'mrr', target_value: 200 });
  assert.equal(edited.body.target.is_focus, true);
  const cleared = await put(e, PROJECT, { metric_key: 'mrr', is_focus: false });
  assert.deepEqual([cleared.status, cleared.body.target.is_focus, cleared.body.target.target_value], [200, false, 200]);
  const logs = db.prepare("SELECT user_id, action, details FROM activity_logs WHERE action = 'metric_target_focus_updated'").all();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].user_id, FOUNDER_USER);
  assert.deepEqual(JSON.parse(String(logs[0].details)), { project_id: PROJECT, metric_key: 'mrr', is_focus: false });
  db.close();
});
test('D548: focus writes refuse outsiders, missing targets and ambiguous flags without receipts', async () => {
  const db = freshDb(); const e = env(db);
  const missing = await put(e, PROJECT, { metric_key: 'mrr', is_focus: true });
  const invalid = await put(e, PROJECT, { metric_key: 'mrr', target_value: 1, is_focus: 'yes' });
  const outside = await put(e, OTHER_PROJECT, { metric_key: 'mrr', target_value: 1, is_focus: true });
  assert.deepEqual([missing.status, invalid.status, outside.status], [404, 400, 403]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM metric_targets').get()!.n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get()!.n, 0);
  db.close();
});
test('D548: deleting the focus clears its choice and a failed read says unreadable', async () => {
  const db = freshDb(); const e = env(db);
  await put(e, PROJECT, { metric_key: 'mrr', target_value: 100, is_focus: true });
  const cleared = await put(e, PROJECT, { metric_key: 'mrr', target_value: null });
  assert.equal(cleared.status, 200);
  assert.deepEqual((await get(e, PROJECT)).body.items, []);
  const prepare = e.DB.prepare.bind(e.DB);
  e.DB.prepare = (sql: string) => { if (sql.includes('FROM metric_targets WHERE project_id')) throw new Error('synthetic read failure'); return prepare(sql); };
  const failed = await get(e, PROJECT);
  assert.deepEqual([failed.status, failed.body.detail], [503, 'Metric targets are unreadable']);
  db.close();
});
test('D548: a concurrent focus chosen after the check is refused without a receipt', async () => {
  const db = freshDb(); const e = env(db);
  await put(e, PROJECT, { metric_key: 'mrr', target_value: 100 });
  await put(e, PROJECT, { metric_key: 'active_users', target_value: 25 });
  const prepare = e.DB.prepare.bind(e.DB);
  e.DB.prepare = (sql: string) => {
    const stmt = prepare(sql);
    if (sql.startsWith('UPDATE metric_targets SET is_focus')) {
      const run = stmt.run.bind(stmt);
      stmt.run = async () => {
        db.prepare('UPDATE metric_targets SET is_focus = 1 WHERE project_id = ? AND metric_key = ?').run(PROJECT, 'active_users');
        return run();
      };
    }
    return stmt;
  };
  const raced = await put(e, PROJECT, { metric_key: 'mrr', is_focus: true });
  assert.equal(raced.status, 409);
  assert.deepEqual(db.prepare('SELECT metric_key FROM metric_targets WHERE is_focus = 1').all().map(r => r.metric_key), ['active_users']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'metric_target_focus_updated'").get()!.n, 0);
  db.close();
});
