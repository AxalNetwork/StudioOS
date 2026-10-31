import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { SignJWT } from 'jose';
import advisors from '../src/routes/advisors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'fixture'.repeat(12);
const routeUrl = new URL('../src/routes/advisors.ts', import.meta.url);
async function fixture(t: any) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const name of ['277_user_recovery_state.sql', '302_push_subscriptions.sql']) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  db.exec("INSERT INTO users(id,email,name,role,is_active) VALUES(1,'writer@example.test','Writer','advisor',1),(2,'other@example.test','Other','advisor',1)");
  db.prepare('INSERT INTO cohort_cycles(id,year,month,start_at,end_at) VALUES(9,2099,1,?,?)')
    .run(new Date(Date.now() + 86400000).toISOString(), new Date(Date.now() + 10 * 86400000).toISOString());
  db.exec("INSERT INTO advisor_cohort_assignments(uid,advisor_user_id,cohort_cycle_id) VALUES('synthetic-assignment',1,9)");
  const f: any = { db, failure: null, table: 'articles' };
  const binding = d1Over(db);
  f.env = { DB: { ...binding, prepare(sql: string) {
    if ((f.table === 'articles' && /FROM articles\b/.test(sql)) || (f.table === 'week_windows' && /FROM week_windows\b/.test(sql))) {
      const fail = () => { throw new Error(`D1_ERROR: synthetic ${f.table} read failed`); };
      if (f.failure === 'prepare') fail();
      if (f.failure === 'all') {
        const statement = { bind: () => statement, all: async () => fail() };
        return statement;
      }
    }
    return binding.prepare(sql);
  } }, JWT_SECRET: SECRET, ENVIRONMENT: 'production', RATE_LIMITS: { async get() { return null; }, async put() {} } };
  const jwt = await new SignJWT({ user_id: 1 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  f.headers = { Cookie: `studioos_auth=${jwt}` };
  return f;
}
async function shelf(f: any, router = advisors, path = '/me/thinking') {
  const response = await router.request(path, { headers: f.headers }, f.env);
  return { status: response.status, body: await response.json() as any };
}

async function failedRead(t: any, router = advisors, failure = 'all', table = 'articles') {
  const f = await fixture(t);
  f.failure = failure; f.table = table;
  const r = await shelf(f, router, table === 'articles' ? '/me/thinking' : '/me/cohort/9/calendar');
  assert.deepEqual([r.status, r.body.error, r.body.message, r.body.counts, r.body.items], [500, 'storage_error', 'Something went wrong saving or loading this. The failure has been logged.', undefined, undefined]);
  assert.equal(JSON.stringify(r.body).includes('synthetic'), false);
}
test('an articles all() rejection is an error, never a successful zero-count shelf', t => failedRead(t));
test('an articles prepare() failure uses the same existing error response', t => failedRead(t, advisors, 'prepare'));
test('a week-window all() rejection cannot undercount calendar obligations', t => failedRead(t, advisors, 'all', 'week_windows'));
test('a week-window prepare() failure uses the same existing error response', t => failedRead(t, advisors, 'prepare', 'week_windows'));

test('a successfully read empty shelf keeps real zero counts', async t => {
  const f = await fixture(t), r = await shelf(f);
  assert.deepEqual([r.status, r.body], [200, { items: [], counts: { published: 0, drafts: 0, best_reach: null, total_reach: null, talk_reach: null } }]);
});
test('a successful shelf counts only the caller’s writing and published reach', async t => {
  const f = await fixture(t);
  f.db.exec("INSERT INTO articles(slug,title,author_user_id,status,views) VALUES('one','One',1,'published',7),('two','Two',1,'published',0),('draft','Draft',1,'draft',400),('other','Other',2,'published',999)");
  const r = await shelf(f);
  assert.deepEqual([r.status, r.body.items.map((a: any) => a.slug).sort(), r.body.counts], [200, ['draft', 'one', 'two'], { published: 2, drafts: 1, best_reach: 7, total_reach: 7, talk_reach: null }]);
});

test('successfully missing week windows stay absent; recorded windows feed real calendar counts', async t => {
  const f = await fixture(t);
  const missing = await shelf(f, advisors, '/me/cohort/9/calendar');
  f.db.prepare('INSERT INTO week_windows(cohort_cycle_id,week_number,unlock_at,deadline_at) VALUES(9,1,?,?)')
    .run(new Date(Date.now() + 86400000).toISOString(), new Date(Date.now() + 2 * 86400000).toISOString());
  const recorded = await shelf(f, advisors, '/me/cohort/9/calendar');
  assert.deepEqual([missing.status, missing.body.windows_recorded, missing.body.counts, recorded.status, recorded.body.windows_recorded, recorded.body.counts], [200, false, { next_14_days: 1, cohort_obligations: 1, collisions: 0, missing_prep: null }, 200, true, { next_14_days: 3, cohort_obligations: 3, collisions: 0, missing_prep: null }]);
});

async function sourceRouter(source: string) {
  const js = stripTypeScriptTypes(source).replace(/(from\s+|import\()(['"])([^'"\s]+)\2/g, (all, prefix, _quote, spec) => {
    const path = new URL(spec, routeUrl);
    const resolved = spec.startsWith('.') ? [path.href, path.href + '.ts', path.href + '.js'].find(p => statSync(new URL(p), { throwIfNoEntry: false })?.isFile()) : import.meta.resolve(spec);
    return `${prefix}'${resolved}'`;
  });
  return (await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))).default;
}
test('restoring the swallowed read makes the failure regression fail, then the original passes', async t => {
  const source = readFileSync(routeUrl, 'utf8');
  for (const [table, route, marker] of [
    ['articles', '/me/thinking', '    const items = rows.results || [];'],
    ['week_windows', '/me/cohort/:cycleId/calendar', '    const weekRows = windows.results || [];'],
  ]) {
    const at = source.indexOf(marker, source.indexOf(`advisors.get('${route}'`));
    const before = source.slice(0, at);
    const changed = before.replace(/\}>\(\);\s*$/, '}>().catch(() => ({ results: [] as any[] }));\n');
    assert.ok(changed !== before, 'the mutation must restore the removed fallback');
    const mutant = await sourceRouter(changed + source.slice(at));
    await assert.rejects(() => failedRead(t, mutant, 'all', table), { name: 'AssertionError' });
    await failedRead(t, advisors, 'all', table);
  }
});
