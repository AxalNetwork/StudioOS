/**
 * D9102 (#9102): GET /api/cycles/build/plan/fed — the venture's GitHub issues
 * and pull requests that came back with no plan marker and have no link, for
 * Back in's "Link to a plan item…".
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, so the ledger, proposal and landed-row SQL runs against
 * production's columns. Every venture, person and repository is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_plan_unmarked_9102.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import planRoutes from '../src/routes/build_plan.ts';
import { UNMARKED_MAX } from '../src/services/buildHandoffs.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const SECRET = 'build-unmarked-test-secret-0123456789-abcdef'; // synthetic test fixture
const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

const FOUNDER = 1, OTHER = 2, ADMIN = 3, PARTNER = 4;
const ITEM = '11111111-1111-4111-8111-111111111111';
const R = 'acme/app';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,spinout_lab_active,is_active) VALUES
    (1,'one@example.test','Founder One','founder',100,0,1),(2,'two@example.test','Founder Two','founder',200,0,1),
    (3,'admin@example.test','Admin','admin',NULL,0,1),(4,'partner@example.test','Partner','partner',NULL,0,1);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'One',100,10),(2,'Two',200,20);
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES('partner-one',10,4);
    INSERT INTO mvp_features(id,project_id,title) VALUES(1,1,'Setup wizard'),(2,1,'Fix exports'),(3,2,'Another venture’s work'),(4,1,'Hand work');
    INSERT INTO roadmap_okrs(id,project_id,objective) VALUES(1,1,'Pilot plan');
    INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,record_ref,kind,payload_json,status)
      VALUES('p1',1,'Founder.Build.Plan','draft:build/plan','project:1','proposal','{"title":"Setup wizard"}','accepted');
    INSERT INTO build_plans(id,uid,project_id,scope,trigger,status,evidence_hash,created_by) VALUES(9,'plan-one',1,'venture','manual','open','h',1);
    INSERT INTO build_plan_items(uid,plan_id,project_id,module,kind,item_key,proposal_uid,evidence_json,landed_table,landed_id,marker)
      VALUES('${ITEM}',9,1,'prototype-mvp','must-have','k1','p1','[]','mvp_features','1','VB-${'A'.repeat(32)}');`);
  const fed = db.prepare(`INSERT INTO connector_fed_items(integration_id,project_id,module,kind,external_id,local_table,local_id,first_seen_at,last_seen_at)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  const pull = (integration: number, project: number, n: number, local: number | null, first: string, last: string) =>
    fed.run(integration, project, 'prototype_mvp', 'pull_request', `pull:${R}#${n}`, local == null ? null : 'mvp_features', local, first, last);
  const issue = (integration: number, project: number, n: number, local: number | null, first: string, last: string) =>
    fed.run(integration, project, 'product_roadmap', 'issue', `issue:${R}#${n}`, local == null ? null : 'roadmap_okrs', local, first, last);
  // #15 is held by two integrations of venture 1 (GitHub reconnected): the newer ledger row has no local row.
  pull(31, 1, 15, 2, '2026-11-01 09:00:00', '2026-11-20 10:00:00');
  pull(32, 1, 15, null, '2026-11-10 09:00:00', '2026-11-25 10:00:00');
  pull(31, 1, 17, 4, '2026-11-02 09:00:00', '2026-11-24 10:00:00');
  issue(31, 1, 9, null, '2026-11-03 09:00:00', '2026-11-22 10:00:00');
  issue(31, 1, 10, 1, '2026-11-04 09:00:00', '2026-11-21 10:00:00');
  // #16's ledger names a row of venture 2: its title is never read on venture 1.
  pull(31, 1, 16, 3, '2026-11-05 09:00:00', '2026-11-19 10:00:00');
  issue(31, 1, 11, null, '2026-11-06 09:00:00', '2026-11-26 10:00:00');
  issue(31, 1, 12, 1, '2026-11-07 09:00:00', '2026-11-18 10:00:00');
  pull(41, 2, 30, 3, '2026-11-08 09:00:00', '2026-11-27 10:00:00');
  fed.run(31, 1, 'product_roadmap', 'release', `release:${R}#v1`, null, null, '2026-11-09 09:00:00', '2026-11-27 11:00:00');
  // #11 has a proposal waiting; #12's was dismissed (Not this one), so it is listed again.
  const proposal = db.prepare(`INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,record_ref,kind,payload_json,source_kind,source_ref,status)
    VALUES(?,1,'Founder.Build.Plan','link:build/plan','project:1','proposal','{}','connector',?,?)`);
  proposal.run('22222222-2222-4222-8222-222222222222', `issue:${R}#11`, 'proposed');
  proposal.run('33333333-3333-4333-8333-333333333333', `issue:${R}#12`, 'discarded');
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  return { db, env };
}

const app = new Hono<any>();
app.route('/api/cycles/build/plan', planRoutes);

async function call(env: any, user: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try {
    const r = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json() as any };
  } finally { [console.warn, console.error, console.info] = saved; }
}
const unmarked = (env: any, who: number | null = FOUNDER, q = '?project=1&scope=venture') => call(env, who, 'GET', `/api/cycles/build/plan/fed${q}`);

test('the unmarked read: one row per item, newest first, titles from this venture only, no item with a waiting or accepted link', async () => {
  const { env } = fixture();
  const r = await unmarked(env);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((i: any) => [i.fed, i.fed_kind, i.title]), [
    [`pull:${R}#15`, 'pull_request', 'Fix exports'],
    [`pull:${R}#17`, 'pull_request', 'Hand work'],
    [`issue:${R}#9`, 'issue', null],
    [`issue:${R}#10`, 'issue', 'Pilot plan'],
    [`pull:${R}#16`, 'pull_request', null],
    [`issue:${R}#12`, 'issue', 'Pilot plan'],
  ]);
  assert.equal(r.body.total, 6, 'two integrations holding #15 count once');
  const twice = r.body.items[0];
  assert.deepEqual([twice.local_table, twice.local_id, twice.first_seen_at, twice.last_seen_at],
    ['mvp_features', '2', '2026-11-01 09:00:00', '2026-11-25 10:00:00'], 'the row with a local row, the newest last seen and the first seen');
  assert.deepEqual(r.body.items[2].local_table, null);

  // A link by hand takes #17 off the list; the write is D1068's own.
  const linked = await call(env, FOUNDER, 'POST', `/api/cycles/build/plan/items/${ITEM}/link`, { fed: `pull:${R}#17` });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  const after = await unmarked(env);
  assert.deepEqual(after.body.items.map((i: any) => i.fed), [`pull:${R}#15`, `issue:${R}#9`, `issue:${R}#10`, `pull:${R}#16`, `issue:${R}#12`]);
  assert.equal(after.body.total, 5);
});

test('the unmarked read is the founder’s: another founder, an admin and a partner are not_this_project, a signed-out caller 401, a bad venture or scope 400', async () => {
  const { env } = fixture();
  for (const who of [OTHER, ADMIN, PARTNER]) {
    const r = await unmarked(env, who);
    assert.deepEqual([r.status, r.body.code], [404, 'not_this_project'], `user ${who}`);
    assert.equal(r.body.items, undefined);
  }
  const gone = await unmarked(env, FOUNDER, '?project=999&scope=venture');
  assert.deepEqual([gone.status, gone.body.code], [404, 'not_this_project']);
  const out = await unmarked(env, null);
  assert.deepEqual([out.status, out.body.code], [401, 'unauthorized']);
  for (const q of ['?project=x&scope=venture', '?project=1&scope=h-0', '?scope=venture']) {
    const r = await unmarked(env, FOUNDER, q);
    assert.deepEqual([r.status, r.body.code], [400, 'invalid_project'], q);
  }
  // Venture 2's founder reads venture 2's item, never venture 1's.
  const two = await unmarked(env, OTHER, '?project=2&scope=venture');
  assert.deepEqual(two.body.items.map((i: any) => [i.fed, i.title]), [[`pull:${R}#30`, 'Another venture’s work']]);
});

test('the unmarked read: at most 200, newest first, and total counts every distinct item', async () => {
  const { db, env } = fixture();
  const fed = db.prepare(`INSERT INTO connector_fed_items(integration_id,project_id,module,kind,external_id,local_id,first_seen_at,last_seen_at)
    VALUES(31,1,'product_roadmap','issue',?,NULL,'2026-10-01 09:00:00',?)`);
  for (let n = 100; n < 300; n += 1) fed.run(`issue:${R}#${n}`, `2026-10-${String(1 + (n % 28)).padStart(2, '0')} 09:00:00`);
  const r = await unmarked(env);
  assert.equal(r.body.items.length, UNMARKED_MAX);
  assert.equal(UNMARKED_MAX, 200);
  assert.equal(r.body.total, 206);
  assert.equal(r.body.items[0].fed, `pull:${R}#15`);
  const seen = r.body.items.map((i: any) => i.last_seen_at);
  assert.deepEqual(seen, [...seen].sort().reverse(), 'newest first');
});
