// D1421 (#3699): /api/studio — the module catalogue, the saved layout, its
// validation and reset, against real SQLite with migration 687 and signed
// sessions per role. Plan locks come only from the shared paywall prefixes.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/studio_layout_d1421.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import studio from '../src/routes/studio_layout.ts';
import {
  STUDIO_MODULES, STUDIO_DEFAULTS, STUDIO_FIXED, STUDIO_REMOVED, STUDIO_PROFILES, STUDIO_LAYOUT_MAX, catalogueOf, lockOf,
} from '../src/services/studioModules.ts';
import { PLAN_NAME, PLAN_KEY } from '../src/middleware/requireTier.ts';
import { PLAN_KEY as INVESTOR_PLAN_KEY } from '../src/middleware/requireInvestorTier.ts';

const JWT_SECRET = randomBytes(32).toString('hex');
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../sql/migrations/687_studio_layouts.sql', import.meta.url), 'utf8');

const USERS: Array<[number, string, number]> = [
  [1, 'founder', 0], [2, 'investor', 0], [3, 'advisor', 0], [4, 'partner', 0],
  [5, 'admin', 0], [6, 'exploring', 0], [7, 'exploring', 1], [8, 'founder', 0],
];
function world() {
  const fx = makeD1(stripForeignKeys(tableFromBaseline(baseline, 'users')));
  fx.db.exec('PRAGMA foreign_keys=ON');
  fx.db.exec(MIGRATION);
  for (const [id, role, lab] of USERS)
    fx.db.prepare('INSERT INTO users(id,name,email,role,is_active,spinout_lab_active) VALUES(?,?,?,?,1,?)').run(id, 'Synthetic', `s${id}@example.test`, role, lab);
  const env: any = { DB: fx.DB, JWT_SECRET, ENVIRONMENT: 'development' };
  return { ...fx, env };
}
const token = (id: number) => new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
  .sign(new TextEncoder().encode(JWT_SECRET));
async function call(env: any, id: number | null, path: string, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (id !== null) headers.authorization = `Bearer ${await token(id)}`;
  const res = await studio.fetch(new Request(`https://example.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json() as any };
}
const rows = (db: any) => db.prepare('SELECT COUNT(*) n FROM studio_layouts').get().n;

test('every route needs a session; an account with no Studio is refused; a Lab member is a founder', async () => {
  const w = world();
  try {
    for (const [path, method] of [['/modules', 'GET'], ['/layout', 'GET'], ['/layout', 'PUT'], ['/layout/reset', 'POST']])
      assert.equal((await call(w.env, null, path, method, method === 'PUT' ? { layout: [] } : undefined)).status, 401, path);
    const none = await call(w.env, 6, '/modules');
    assert.deepEqual([none.status, none.body.error], [403, 'no_studio_profile']);
    const lab = await call(w.env, 7, '/modules');
    assert.deepEqual([lab.status, lab.body.profile], [200, 'founder']);
  } finally { w.db.close(); }
});

test('a member arranges only their own Studio; an admin names the one they preview, and each is its own row', async () => {
  const w = world();
  try {
    const other = await call(w.env, 1, '/modules?profile=investor');
    assert.deepEqual([other.status, other.body.error], [403, 'profile_not_allowed']);
    assert.equal((await call(w.env, 1, '/modules?profile=founder')).status, 200);
    for (const q of ['', '?profile=admin', '?profile=Founder']) {
      const r = await call(w.env, 5, `/modules${q}`);
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_profile'], q);
    }
    const adv = await call(w.env, 5, '/modules?profile=advisor');
    assert.deepEqual(adv.body.modules.map((m: any) => m.key), catalogueOf('advisor').map((m) => m.key));
    await call(w.env, 5, '/layout?profile=advisor', 'PUT', { layout: [{ key: 'earnings', size: 'full' }] });
    await call(w.env, 5, '/layout?profile=partner', 'PUT', { layout: [{ key: 'firm_feed', size: '1/2' }] });
    assert.deepEqual(w.db.prepare('SELECT profile FROM studio_layouts WHERE user_id = 5 ORDER BY profile').all().map((r: any) => r.profile), ['advisor', 'partner']);
    // The real advisor still reads the default: another member's row is never theirs.
    assert.equal((await call(w.env, 3, '/layout')).body.source, 'default');
  } finally { w.db.close(); }
});

test('each catalogue is its registry rows, in order, and never offers a fixed or removed block', async () => {
  const w = world();
  try {
    for (const [id, profile] of [[1, 'founder'], [2, 'investor'], [3, 'advisor'], [4, 'partner']] as const) {
      const r = await call(w.env, id, '/modules');
      assert.equal(r.status, 200);
      assert.equal(r.body.profile, profile);
      assert.deepEqual(r.body.modules.map((m: any) => m.key), STUDIO_MODULES.filter((m) => m.profile === profile).map((m) => m.key));
      for (const m of r.body.modules) {
        assert.deepEqual(Object.keys(m).sort(), ['cohort_only', 'default_size', 'group', 'key', 'locked_by_plan', 'plan', 'title']);
        assert.equal(m.locked_by_plan, false, `${m.key}: no block on /studio is plan-locked on main`);
        assert.equal(m.plan, null);
        assert.ok(![...STUDIO_FIXED, ...STUDIO_REMOVED].includes(m.key));
      }
    }
    const founder = (await call(w.env, 1, '/modules')).body.modules;
    assert.equal(founder.find((m: any) => m.key === 'module_map').cohort_only, true);
    assert.ok(!founder.some((m: any) => ['holding_progress', 'implications'].includes(m.key)), 'no-store zones are not offered (owner question B)');
  } finally { w.db.close(); }
});

test('no row: the read answers the default and writes nothing', async () => {
  const w = world();
  try {
    for (const [id, profile] of [[1, 'founder'], [2, 'investor'], [3, 'advisor'], [4, 'partner']] as const) {
      const r = await call(w.env, id, '/layout');
      assert.equal(r.status, 200);
      assert.equal(r.body.source, 'default');
      assert.equal(r.body.updated_at, null);
      assert.deepEqual(r.body.layout.map(({ key, size }: any) => ({ key, size })), STUDIO_DEFAULTS[profile]);
    }
    assert.equal(rows(w.db), 0);
  } finally { w.db.close(); }
});

test('a saved layout round-trips in order with its sizes, and an empty one stays empty', async () => {
  const w = world();
  try {
    const layout = [{ key: 'upcoming_events', size: 'full' }, { key: 'usage_quota', size: '1/2' }, { key: 'quick_stats', size: '1/3' }];
    const put = await call(w.env, 2, '/layout', 'PUT', { layout });
    assert.equal(put.status, 200);
    assert.equal(put.body.source, 'saved');
    const read = await call(w.env, 2, '/layout');
    assert.deepEqual(read.body.layout, layout.map((e) => ({ ...e, locked_by_plan: false })));
    assert.ok(read.body.updated_at);
    assert.equal(rows(w.db), 1);
    assert.equal((await call(w.env, 2, '/layout', 'PUT', { layout: [] })).status, 200);
    const empty = await call(w.env, 2, '/layout');
    assert.deepEqual([empty.body.source, empty.body.layout], ['saved', []]);
    assert.equal(rows(w.db), 1);
  } finally { w.db.close(); }
});

test('validation: the cap, duplicates, unknown, removed, fixed and other-profile keys, sizes and shapes; nothing written', async () => {
  const w = world();
  try {
    const twelve = Array.from({ length: STUDIO_LAYOUT_MAX }, () => ({ key: 'today', size: '1/3' }));
    const r = (layout: unknown) => call(w.env, 3, '/layout', 'PUT', { layout });
    const tooMany = await r([...twelve, { key: 'today', size: '1/3' }]);
    assert.deepEqual([tooMany.status, tooMany.body.error], [400, 'too_many_modules']);
    for (const [layout, code, key] of [
      [[{ key: 'today', size: '1/3' }, { key: 'today', size: 'full' }], 'duplicate_module', 'today'],
      [[{ key: 'nonsense', size: '1/3' }], 'unknown_module', 'nonsense'],
      [[{ key: 'firm_feed', size: '1/3' }], 'unknown_module', 'firm_feed'],
      [[{ key: 'chat', size: 'full' }], 'unknown_module', 'chat'],
      [[{ key: 'founder_actions', size: 'full' }], 'unknown_module', 'founder_actions'],
      [[{ key: 'today', size: '2/3' }], 'invalid_size', 'today'],
      [[{ key: 'today', size: '1/3', locked: false }], 'invalid_layout', undefined],
      [[{ size: '1/3' }], 'invalid_layout', undefined],
      [['today'], 'invalid_layout', undefined],
    ] as const) {
      const res = await r(layout);
      assert.deepEqual([res.status, res.body.error, res.body.key], [400, code, key], JSON.stringify(layout));
    }
    for (const body of [null, [], { layout: 'today' }, { layout: { key: 'today' } }]) {
      const res = await call(w.env, 3, '/layout', 'PUT', body);
      assert.deepEqual([res.status, res.body.error], [400, 'invalid_layout'], JSON.stringify(body));
    }
    assert.equal(rows(w.db), 0);
    // Twelve distinct entries fit; this catalogue has five, so the cap is checked on its own above.
    assert.equal((await call(w.env, 3, '/layout', 'PUT', { layout: catalogueOf('advisor').map((m) => ({ key: m.key, size: '1/3' })) })).status, 200);
  } finally { w.db.close(); }
});

test('twelve entries are accepted where the catalogue allows it, thirteen are not', async () => {
  // A synthetic catalogue large enough to test the boundary through the route.
  const w = world();
  const extra = Array.from({ length: 13 }, (_, i) => ({ key: `synthetic_${i}`, profile: 'partner' as const, title: 'S', group: 'S', reads: [], default_size: '1/3' as const }));
  (STUDIO_MODULES as any[]).push(...extra);
  try {
    const twelve = extra.slice(0, 12).map((m) => ({ key: m.key, size: '1/3' }));
    assert.equal((await call(w.env, 4, '/layout', 'PUT', { layout: twelve })).status, 200);
    const r = await call(w.env, 4, '/layout', 'PUT', { layout: extra.map((m) => ({ key: m.key, size: '1/3' })) });
    assert.deepEqual([r.status, r.body.error], [400, 'too_many_modules']);
    assert.equal((await call(w.env, 4, '/layout')).body.layout.length, 12);
  } finally { (STUDIO_MODULES as any[]).splice(-13); w.db.close(); }
});

test('a locked module: the lock comes from the shared paywalls, its plan is named, and saving it is 402', async () => {
  const w = world();
  const pipeline = { key: 'synthetic_pipeline', profile: 'investor' as const, title: 'Pipeline', group: 'Deals', reads: ['/api/deals/pipeline'], default_size: '1/2' as const };
  const capital = { key: 'synthetic_capital', profile: 'founder' as const, title: 'Capital', group: 'Raise', reads: ['/api/capital/x'], default_size: '1/2' as const };
  (STUDIO_MODULES as any[]).push(pipeline, capital);
  try {
    const free = await call(w.env, 2, '/modules');
    const row = free.body.modules.find((m: any) => m.key === pipeline.key);
    assert.deepEqual([row.locked_by_plan, row.plan.tier, row.plan.plan_key], [true, 'professional', INVESTOR_PLAN_KEY.professional]);
    const put = await call(w.env, 2, '/layout', 'PUT', { layout: [{ key: pipeline.key, size: '1/2' }] });
    assert.deepEqual([put.status, put.body.error, put.body.key, put.body.plan.plan_key], [402, 'module_locked', pipeline.key, INVESTOR_PLAN_KEY.professional]);
    assert.equal(rows(w.db), 0);
    w.db.prepare("UPDATE users SET investor_tier = 'professional', investor_subscription_status = 'active' WHERE id = 2").run();
    assert.equal((await call(w.env, 2, '/modules')).body.modules.find((m: any) => m.key === pipeline.key).locked_by_plan, false);
    assert.equal((await call(w.env, 2, '/layout', 'PUT', { layout: [{ key: pipeline.key, size: '1/2' }] })).status, 200);
    // A plan that lapses later keeps the saved key, now marked locked.
    w.db.prepare("UPDATE users SET investor_tier = 'free' WHERE id = 2").run();
    assert.deepEqual((await call(w.env, 2, '/layout')).body.layout, [{ key: pipeline.key, size: '1/2', locked_by_plan: true }]);
    // The founder paywall, from STUDIO_PREFIXES.
    const founder = (await call(w.env, 1, '/modules')).body.modules.find((m: any) => m.key === capital.key);
    assert.deepEqual([founder.locked_by_plan, founder.plan.name, founder.plan.plan_key], [true, PLAN_NAME.studio, PLAN_KEY.studio]);
    // Bypass roles pass the same gates.
    assert.equal(lockOf({ role: 'advisor' } as any, pipeline), null);
    assert.equal(lockOf({ role: 'advisor' } as any, capital), null);
    // An exempt GET is not locked.
    assert.equal(lockOf({ role: 'investor', investor_tier: 'free' } as any, { reads: ['/api/deals/dealroom/quota'] }), null);
  } finally { (STUDIO_MODULES as any[]).splice(-2); w.db.close(); }
});

test('a saved key later removed from the registry is left out and named; a corrupt row is a refusal, never the default', async () => {
  const w = world();
  try {
    w.db.prepare("INSERT INTO studio_layouts(user_id,profile,layout) VALUES(4,'partner',?)").run(JSON.stringify([{ key: 'retired_tile', size: '1/3' }, { key: 'firm_feed', size: 'full' }]));
    const r = await call(w.env, 4, '/layout');
    assert.deepEqual([r.body.layout.map((e: any) => e.key), r.body.dropped], [['firm_feed'], ['retired_tile']]);
    w.db.prepare('PRAGMA ignore_check_constraints = ON').run();
    w.db.prepare("INSERT INTO studio_layouts(user_id,profile,layout) VALUES(3,'advisor','not json')").run();
    const bad = await call(w.env, 3, '/layout');
    assert.deepEqual([bad.status, bad.body.error], [500, 'layout_unreadable']);
  } finally { w.db.close(); }
});

test('reset deletes the row and answers the default; reset with no row is still 200', async () => {
  const w = world();
  try {
    await call(w.env, 1, '/layout', 'PUT', { layout: [{ key: 'module_map', size: '1/3' }] });
    await call(w.env, 8, '/layout', 'PUT', { layout: [] });
    const r = await call(w.env, 1, '/layout/reset', 'POST');
    assert.deepEqual([r.status, r.body.source], [200, 'default']);
    assert.deepEqual(r.body.layout.map(({ key, size }: any) => ({ key, size })), STUDIO_DEFAULTS.founder);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM studio_layouts WHERE user_id = 1').get().n, 0);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM studio_layouts WHERE user_id = 8').get().n, 1, 'another member keeps theirs');
    assert.equal((await call(w.env, 1, '/layout/reset', 'POST')).status, 200);
  } finally { w.db.close(); }
});

test('the user is always the session: a body or query user id changes nothing', async () => {
  const w = world();
  try {
    await call(w.env, 1, '/layout?user_id=8', 'PUT', { layout: [], user_id: 8 });
    assert.deepEqual(w.db.prepare('SELECT user_id FROM studio_layouts').all().map((r: any) => r.user_id), [1]);
  } finally { w.db.close(); }
});

test('migration 687 applies twice, and its checks refuse a non-array layout and an unknown profile', () => {
  const w = world();
  try {
    w.db.exec(MIGRATION);
    assert.throws(() => w.db.prepare("INSERT INTO studio_layouts(user_id,profile,layout) VALUES(1,'founder','{}')").run());
    assert.throws(() => w.db.prepare("INSERT INTO studio_layouts(user_id,profile,layout) VALUES(1,'admin','[]')").run());
    w.db.prepare("INSERT INTO studio_layouts(user_id,profile,layout) VALUES(1,'founder','[]')").run();
    assert.throws(() => w.db.prepare("INSERT INTO studio_layouts(user_id,profile,layout) VALUES(1,'founder','[]')").run());
    w.db.prepare('DELETE FROM users WHERE id = 1').run();
    assert.equal(rows(w.db), 0, 'the layout goes with the account');
  } finally { w.db.close(); }
});

test('the registry: unique snake_case keys, valid defaults within the cap, /api reads', () => {
  const keys = STUDIO_MODULES.map((m) => m.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const m of STUDIO_MODULES) {
    assert.match(m.key, /^[a-z][a-z0-9_]*$/);
    assert.ok((STUDIO_PROFILES as readonly string[]).includes(m.profile));
    for (const p of m.reads) assert.match(p, /^\/api\//);
  }
  for (const p of STUDIO_PROFILES) {
    const allowed = new Set(catalogueOf(p).map((m) => m.key));
    assert.ok(STUDIO_DEFAULTS[p].length <= STUDIO_LAYOUT_MAX);
    for (const e of STUDIO_DEFAULTS[p]) { assert.ok(allowed.has(e.key), `${p}:${e.key}`); assert.ok(['1/3', '1/2', 'full'].includes(e.size)); }
  }
});

test('the paywall prefixes are declared once, in middleware/paywallPrefixes.ts, and index.ts imports them', () => {
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(index, /const (STUDIO_PREFIXES|INVESTOR_PRO_PREFIXES)\s*=/);
  assert.match(index, /import \{ STUDIO_PREFIXES, INVESTOR_PRO_PREFIXES \} from '\.\/middleware\/paywallPrefixes';/);
  assert.match(index, /for \(const p of STUDIO_PREFIXES\) \{\s*app\.use\(p, requireTier\('studio'\)\);\s*app\.use\(`\$\{p\}\/\*`, requireTier\('studio'\)\);/);
  assert.match(index, /for \(const p of INVESTOR_PRO_PREFIXES\) \{\s*app\.use\(p, investorPro\);\s*app\.use\(`\$\{p\}\/\*`, investorPro\);/);
  assert.match(index, /app\.route\('\/api\/studio', studioLayout\);/);
});
