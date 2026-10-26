/**
 * D968 (#3351, part of #2426): GET /api/cycles/build/plan/states, each
 * accepted, landed plan item's Built, Live and Tested from the row it landed
 * in, with the day it changed where the table stores one.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, so migration 441's `done_at` triggers run as they ship. The plan
 * items are seeded straight into each landed table, one per stage rule. Every
 * venture and person is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_states_d968.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import planRoutes from '../src/routes/build_plan.ts';
import { NO_DAY, NO_DEPLOY, NO_RELEASE, NO_TEST, ROW_GONE, stagesOf } from '../src/services/buildStates.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'build-states-test-secret-0123456789-abcdef'; // synthetic test fixture
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

const FOUNDER = 1, OTHER = 2, ADMIN = 3, PARTNER = 4;

/** One plan item, accepted (or not) and landed in `table` row `id`. */
function planItem(db: DatabaseSync, uid: string, kind: string, table: string | null, id: number | null, status = 'accepted', project = 1) {
  db.prepare(`INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,record_ref,kind,payload_json,status)
    VALUES(?,1,'Founder.Build.Plan','draft:build/plan',?,'proposal','{"title":"x"}',?)`).run(`q-${uid}`, `project:${project}`, status);
  db.prepare(`INSERT INTO build_plan_items(uid,plan_id,project_id,module,kind,item_key,proposal_uid,evidence_json,landed_table,landed_id,marker)
    VALUES(?,?,?,'prototype-mvp',?,?,?,'[]',?,?,?)`).run(uid, project === 1 ? 1 : 2, project, kind, `k-${uid}`, `q-${uid}`, table, id == null ? null : String(id), `VB-${uid}`);
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,spinout_lab_active,is_active) VALUES
    (1,'one@example.test','Founder One','founder',100,0,1),(2,'two@example.test','Founder Two','founder',200,0,1),(3,'admin@example.test','Admin','admin',NULL,0,1),
    (4,'partner@example.test','Partner','partner',NULL,0,1);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'One',100,10),(2,'Two',200,20);
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES('partner-one',10,4);
    INSERT INTO hypotheses(id,project_id,code,claim) VALUES(1,1,'H1','Setup in one day');
    INSERT INTO build_plans(id,uid,project_id,scope,trigger,status,evidence_hash,created_by) VALUES(1,'plan-one',1,'venture','manual','open','h',1),(2,'plan-two',2,'venture','manual','open','h',2);`);
  // Built: one must-have done (the trigger writes its day), one feature still in progress.
  db.exec(`INSERT INTO mvp_features(id,project_id,title,delivery_status,created_at) VALUES(11,1,'Done must-have','Backlog','2026-10-01 09:00:00'),(12,1,'Doing feature','In Progress','2026-10-02 09:00:00');`);
  db.exec(`UPDATE mvp_features SET delivery_status = 'Done' WHERE id = 11;`);
  db.exec(`UPDATE mvp_features SET done_at = '2026-10-14 10:00:00' WHERE id = 11;`);
  // Roadmap: one shipped by a GitHub release, one moved to Done by hand, one in Next.
  db.exec(`INSERT INTO roadmap_releases(id,project_id,repository,tag,name,published_at) VALUES(5,1,'acme/app','v1.2.0','Spring release','2026-10-20T12:00:00Z');
    INSERT INTO roadmap_okrs(id,project_id,objective,kanban_status,shipped_release_id) VALUES(21,1,'Shipped item','done',5),(22,1,'Done by hand','done',NULL),(23,1,'Next item','next',NULL);`);
  db.exec(`INSERT INTO formation_steps(id,project_id,title,state,created_by) VALUES(31,1,'Incorporate','done',1),(32,1,'Open a bank account','doing',1);`);
  db.exec(`INSERT INTO hypothesis_experiments(id,uid,project_id,hypothesis_id,title,status,result) VALUES(41,'e41',1,1,'Pilot','done','12 of 15 finished setup in a day'),(42,'e42',1,1,'Survey','running',NULL);`);
  db.exec(`INSERT INTO venture_risks(id,project_id,title,severity,state,created_by) VALUES(51,1,'Churn','high','open',1);`);
  planItem(db, 'mh', 'must-have', 'mvp_features', 11);
  planItem(db, 'ft', 'feature', 'mvp_features', 12);
  planItem(db, 'rs', 'roadmap', 'roadmap_okrs', 21);
  planItem(db, 'rd', 'roadmap', 'roadmap_okrs', 22);
  planItem(db, 'rn', 'roadmap', 'roadmap_okrs', 23);
  planItem(db, 'fs', 'formation-step', 'formation_steps', 31);
  planItem(db, 'fd', 'formation-step', 'formation_steps', 32);
  planItem(db, 'tx', 'prototype-test', 'hypothesis_experiments', 41);
  planItem(db, 'tr', 'prototype-test', 'hypothesis_experiments', 42);
  planItem(db, 'rk', 'risk', 'venture_risks', 51);
  planItem(db, 'gone', 'feature', 'mvp_features', 999);
  planItem(db, 'proposed', 'feature', 'mvp_features', 12, 'proposed');
  planItem(db, 'unlanded', 'feature', null, null);
  // Another venture's item names a row id this venture also has: never read across.
  db.exec(`INSERT INTO mvp_features(id,project_id,title,delivery_status) VALUES(61,2,'Theirs','Done');`);
  planItem(db, 'theirs', 'feature', 'mvp_features', 11, 'accepted', 2);
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  return { db, env };
}

const app = new Hono<any>();
app.route('/api/cycles/build/plan', planRoutes);
async function get(env: any, user: number | null, path = '/api/cycles/build/plan/states?project=1&scope=venture') {
  const headers: Record<string, string> = {};
  if (user) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const r = await app.request(path, { headers }, env);
    return { status: r.status, body: await r.json() as any };
  } finally { [console.warn, console.error] = saved; }
}
const byUid = (body: any) => Object.fromEntries(body.states.map((s: any) => [s.plan_item_uid, s]));

test('Built: a must-have done carries the day it moved to Done; a feature in progress is reported not done; Live and Tested are not reported', async () => {
  const { env, db } = fixture();
  const r = await get(env, FOUNDER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = byUid(r.body);
  assert.deepEqual(s.mh.built, { reported: true, done: true, at: '2026-10-14 10:00:00', source: 'Build › MVP scope', value: 'Done' });
  assert.deepEqual(s.ft.built, { reported: true, done: false, source: 'Build › MVP scope', value: 'In Progress' });
  assert.deepEqual(s.mh.live, { reported: false, reason: NO_DEPLOY });
  assert.deepEqual(s.mh.tested, { reported: false, reason: NO_TEST });
  // Migration 441's trigger: moving out of Done clears the day; the read then says not done.
  db.exec(`UPDATE mvp_features SET delivery_status = 'Review' WHERE id = 11;`);
  assert.deepEqual(byUid((await get(env, FOUNDER)).body).mh.built, { reported: true, done: false, source: 'Build › MVP scope', value: 'Review' });
});

test('a roadmap item: shipped by a release is Built and Live on the release’s day; Done by hand is Built with no day and why; in Next is not built and not live', async () => {
  const { env } = fixture();
  const s = byUid((await get(env, FOUNDER)).body);
  assert.deepEqual(s.rs.built, { reported: true, done: true, at: '2026-10-20T12:00:00Z', source: 'Connector · GitHub release', value: 'Spring release' });
  assert.deepEqual(s.rs.live, { reported: true, done: true, at: '2026-10-20T12:00:00Z', source: 'Connector · GitHub release', value: 'Spring release' });
  assert.deepEqual(s.rd.built, { reported: true, done: true, at: null, at_reason: NO_DAY.roadmap, source: 'Build › Roadmap', value: 'Done' });
  assert.deepEqual(s.rd.live, { reported: false, reason: NO_RELEASE });
  assert.deepEqual(s.rn.built, { reported: true, done: false, source: 'Build › Roadmap', value: 'next' });
});

test('a formation step’s Built and a test’s Tested: done with no day and why, or not done; a risk has no later stage', async () => {
  const { env } = fixture();
  const s = byUid((await get(env, FOUNDER)).body);
  assert.deepEqual(s.fs.built, { reported: true, done: true, at: null, at_reason: NO_DAY.formation, source: 'Build › Formation', value: 'Done' });
  assert.deepEqual(s.fd.built, { reported: true, done: false, source: 'Build › Formation', value: 'doing' });
  assert.equal(s.fs.live, undefined, 'a formation step is never live');
  assert.deepEqual(s.tx.tested, { reported: true, done: true, at: null, at_reason: NO_DAY.experiment, source: 'Validate › Experiments', value: '12 of 15 finished setup in a day' });
  assert.deepEqual(s.tr.tested, { reported: true, done: false, source: 'Validate › Experiments', value: 'running' });
  assert.equal(s.tx.built, undefined);
  assert.deepEqual(Object.keys(s.rk).filter((k) => ['built', 'live', 'tested'].includes(k)), []);
});

test('only this venture’s accepted, landed items; a row that is gone says so; never another venture’s row', async () => {
  const { env } = fixture();
  const r = (await get(env, FOUNDER)).body;
  const s = byUid(r);
  assert.equal(r.total, 11);
  assert.ok(!('proposed' in s) && !('unlanded' in s) && !('theirs' in s));
  assert.deepEqual(s.gone.built, { reported: false, reason: ROW_GONE });
  // Venture 2's item names mvp_features 11, which is venture 1's: it is read as gone, not as Done.
  const theirs = byUid((await get(env, OTHER, '/api/cycles/build/plan/states?project=2&scope=venture')).body).theirs;
  assert.deepEqual(theirs.built, { reported: false, reason: ROW_GONE });
});

test('the readers are the plan’s: the founder, an admin and the company’s partner read; another founder and no session are refused', async () => {
  const { env } = fixture();
  assert.equal((await get(env, ADMIN)).status, 200);
  assert.equal((await get(env, PARTNER)).status, 200);
  const other = await get(env, OTHER);
  assert.deepEqual([other.status, other.body.code], [404, 'not_this_project']);
  assert.equal((await get(env, null)).status, 401);
});

test('paged: limit and offset, a total, and a bad page refused', async () => {
  const { env } = fixture();
  const first = (await get(env, FOUNDER, '/api/cycles/build/plan/states?project=1&scope=venture&limit=4&offset=0')).body;
  const rest = (await get(env, FOUNDER, '/api/cycles/build/plan/states?project=1&scope=venture&limit=10&offset=4')).body;
  assert.deepEqual([first.states.length, first.total, rest.states.length], [4, 11, 7]);
  assert.equal(new Set([...first.states, ...rest.states].map((x: any) => x.plan_item_uid)).size, 11);
  const bad = await get(env, FOUNDER, '/api/cycles/build/plan/states?project=1&scope=venture&limit=501');
  assert.deepEqual([bad.status, bad.body.code], [400, 'invalid_page']);
});

test('stagesOf is pure: an unknown table reports nothing; a release with no publish day says why', () => {
  assert.deepEqual(stagesOf({ landed_table: 'connect_doors' }), {});
  const r = stagesOf({ landed_table: 'roadmap_okrs', o_id: 1, o_status: 'done', r_id: 2, r_tag: 'v1', r_name: null, r_published_at: null });
  assert.deepEqual(r.live, { reported: true, done: true, at: null, at_reason: 'The release carries no publish day', source: 'Connector · GitHub release', value: 'v1' });
  const long = stagesOf({ landed_table: 'hypothesis_experiments', e_id: 1, e_status: 'done', e_result: `  ${'x'.repeat(400)}  ` });
  assert.equal(long.tested.value, 'x'.repeat(300), 'a result is trimmed and capped at 300 characters');
});
