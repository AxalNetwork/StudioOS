/**
 * D893 (#2662) — the Super Admin scope of Admin › Insights: each deployed
 * subsidiary's counts, read from its own database through the fan-out.
 *
 * Real SQLite at HQ (the registry, the admins) behind #2660's real route.
 * The branch is the real `branchInsights` RPC: over a stubbed loader where a
 * test needs exact counts, and over #2660's own read (`loadInsightsForBranch`)
 * to prove the wiring. What HQ shows is what the branch answered.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/insights_scope_d893.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import scopesRoute from '../src/routes/admin_insights_scopes.ts';
import insightsRoute, { loadInsightsForBranch } from '../src/routes/admin_insights.ts';
import { branchInsights } from '../src/rpc/branchOps.ts';
import {
  countsOnly,
  INSIGHTS_KPI_KEYS, INSIGHTS_BLOCK_KEYS, HQ_ONLY_MESSAGE, BRANCH_SCOPE_SOURCE,
} from '../src/services/insightsScope.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const PLAIN = 2;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const migration = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}
const db0 = () => new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });

/** HQ: a Super Admin, a plain Admin, and four deployments in different states. */
function hqDb(opts: { registry?: boolean } = {}) {
  const db = db0();
  for (const t of ['users', 'super_admins', 'user_sessions', 'territory_licences']) db.exec(ddl(t));
  for (const f of ['258_licence_deployments.sql', '279_licence_kind.sql']) db.exec(migration(f));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'The Holder', 'holder@example.test', 1);
  u.run(PLAIN, 'admin', 'A Plain Admin', 'plain@example.test', 1);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const l = db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, kind) VALUES (?, ?, ?, ?, ?, 'active', 'subsidiary')`);
  l.run(1, 'lic_no', 'AXL-001', 'Axal VC North AB', 'Branch North');
  l.run(2, 'lic_de', 'AXL-002', 'Axal VC DACH GmbH', 'Axal VC DACH');
  l.run(3, 'lic_es', 'AXL-003', 'Axal VC Iberia SL', 'Axal VC Iberia');
  const dep = db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status) VALUES (?, ?, ?, ?, ?, ?)`);
  dep.run('lic_no', 'no', 'no.axal.vc', 'studioos-no', 'studioos-no', 'linked');
  dep.run('lic_de', 'de', 'de.axal.vc', 'studioos-de', 'studioos-de', 'hostname_active');
  dep.run('lic_es', 'es', 'es.axal.vc', 'studioos-es', 'studioos-es', 'requested'); // no Worker yet: not listed
  dep.run('lic_it', 'it', 'it.axal.vc', 'studioos-it', 'studioos-it', 'worker_live'); // no licence row yet: its code
  if (opts.registry === false) db.exec('DROP TABLE licence_deployments');
  return db;
}

/** What #2660's read returns over a branch's database, plus the personal fields a strip must catch. */
function branchRead(params: Record<string, string>) {
  return {
    range: params.range || '8w',
    weeks: ['2026-10-12', '2026-10-19'],
    scope: { label: 'This deployment' },
    kpis: {
      accounts: { available: true, total: 42, new_30d: 5, deactivated: 1 },
      new_this_week: { available: true, count: 3, last_week: 2 },
      active_last_week: { available: true, value: 17, week_before: 15 },
      activated: { available: true, rate_pct: 40, cohorts_counted: 8 },
    },
    blocks: {
      who: { available: true, total: 42, by_profile: [{ profile: 'founder', count: 30 }], lps: 2, product_testers: { recorded: false, reason: 'Not defined yet.' } },
      countries: { available: true, rows: [{ country: 'SE', count: 20 }], not_stated: 4 },
      // A leak the branch's strip and HQ's strip must both remove.
      dormant: { available: true, count: 6, last_month: 4, user_id: 77, sample: [{ id: 9, email: 'person@branch.example', name: 'A Person', count: 1 }] },
      tickets: { available: true, open: 2, by_status: { open: 2 }, note: 'reach owner@branch.example' },
    },
  };
}

const branchEnv = (code = 'no') => ({ DB: d1Over(db0()), BRANCH_CODE: code, JWT_SECRET, ENVIRONMENT: 'development' }) as any;
const seen: Array<Record<string, unknown>> = [];
const loader = async (_env: any, params: Record<string, string>) => { seen.push(params); return branchRead(params); };
const binding = (code: string) => ({ insights: (p: unknown) => branchInsights(branchEnv(code), p, loader as any) });

const app = new Hono<any>();
app.route('/scopes', scopesRoute);
app.route('/read', insightsRoute);
app.onError((err: any, c) => {
  const s = ({ Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403, 'HQ only': 403 } as any)[err?.message];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function call(path: string, db: InstanceType<typeof DatabaseSync>, opts: { as?: number; env?: Record<string, unknown> } = {}) {
  const jwt = await new SignJWT({ user_id: opts.as ?? SUPER, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, { headers: { Authorization: `Bearer ${jwt}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...(opts.env || {}) });
  return { status: res.status, body: await res.json() as any };
}

/** Every key and string in a JSON value, for the counts-only walk. */
function walk(v: unknown, keys: string[] = [], strings: string[] = []) {
  if (Array.isArray(v)) v.forEach((x) => walk(x, keys, strings));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x, keys, strings); }
  else if (typeof v === 'string') strings.push(v);
  return { keys, strings };
}
const PERSONAL = /^(?:id|uid|name|email|phone|[a-z_]*_(?:id|uid|name|email|phone))$/i;
function assertCountsOnly(body: unknown) {
  const { keys, strings } = walk(body);
  assert.deepEqual(keys.filter((k) => PERSONAL.test(k)), [], 'no key names a person or a record');
  assert.deepEqual(strings.filter((s) => /@/.test(s)), [], 'no email-shaped string');
  assert.doesNotMatch(JSON.stringify(body), /A Person|person@branch|owner@branch|"id":9|"user_id"/);
}

// ───────────────────────────────────────────────────────────── the branch ──

test('the branch answers its own read, with the contract\'s parameters only, and strips every personal field', async () => {
  seen.length = 0;
  const ans = await branchInsights(branchEnv('no'), { range: 'quarter', profile: 'founder', compare: '1', email: 'x@y.z', limit: '9' }, loader as any);
  assert.equal(ans.branch, 'no');
  assert.deepEqual(seen[0], { range: 'quarter', profile: 'founder', compare: '1' }, 'only range, profile, country, compare and group cross');
  assert.equal((ans.insights.kpis as any).accounts.total, 42);
  assert.equal((ans.insights.blocks as any).dormant.count, 6);
  assert.deepEqual((ans.insights.blocks as any).dormant.sample, [{ count: 1 }]);
  assert.equal((ans.insights.blocks as any).tickets.note, null, 'an email-shaped string is dropped, not shown');
  assertCountsOnly(ans);
});

test('HQ\'s tier refuses to answer as a branch; the branch runs #2660\'s read, and refuses a filter it cannot use', async () => {
  await assert.rejects(() => branchInsights({ DB: d1Over(db0()) } as any, {}, loader as any), /only live on a branch/);
  await assert.rejects(() => branchInsights(branchEnv(), { range: 'decade' }, loadInsightsForBranch), /range must be 8w, quarter or year/);
  // An empty branch database: #2660's read answers, every block failing alone with its own reason.
  const ans = await branchInsights(branchEnv('no'), { range: 'quarter' }, loadInsightsForBranch);
  assert.equal(ans.insights.range, 'quarter');
  assert.equal((ans.insights.scope as any).key, 'no', 'the branch answers for its own scope');
  assert.equal((ans.insights.kpis as any).accounts.unreadable, true);
  assertCountsOnly(ans);
});

test('countsOnly keeps counts, profiles, countries and labels, and removes ids, names and emails at any depth', () => {
  assert.deepEqual(countsOnly({ profile: 'lp', country: 'FR', tier: 'pro', label: 'Branch North', week: '2026-10-19', count: 3, rate_pct: null, available: true }),
    { profile: 'lp', country: 'FR', tier: 'pro', label: 'Branch North', week: '2026-10-19', count: 3, rate_pct: null, available: true });
  assert.deepEqual(countsOnly({ a: [{ b: { account_id: 1, first_name: 'X', uid: 'u', phone: '1', c: 2 } }] }), { a: [{ b: { c: 2 } }] });
});

// ──────────────────────────────────────────────────────────────── HQ ──

test('a Super Admin reads one subsidiary\'s counts, from its own database, under HQ\'s label', async () => {
  const { status, body } = await call('/read?scope=no&range=year&country=SE', hqDb(), { env: { BRANCH_NO: binding('no') } });
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.scope, { key: 'no', label: 'Branch North', kind: 'branch', source: BRANCH_SCOPE_SOURCE });
  assert.equal(body.range, 'year');
  assert.equal(body.kpis.accounts.total, 42);
  assert.equal(body.kpis.active_last_week.value, 17);
  assert.equal(body.blocks.countries.rows[0].count, 20);
  assert.deepEqual(body.branch, { status: 'ok' });
  assert.ok(body.as_of, 'the branch\'s own as_of travels');
  assertCountsOnly(body);
  assert.deepEqual(seen.at(-1), { range: 'year', country: 'SE' }, 'HQ forwards the filters, and only them');

  const wired = { insights: (p: unknown) => branchInsights(branchEnv('no'), p, loadInsightsForBranch) };
  const real = await call('/read?scope=no', hqDb(), { env: { BRANCH_NO: wired } });
  assert.equal(real.status, 200);
  assert.deepEqual(real.body.branch, { status: 'ok' }, 'the branch answered with #2660\'s read');
  assert.equal(real.body.scope.label, 'Branch North');
  assert.match(real.body.kpis.accounts.reason, /could not be read/, 'its own block reasons travel');
});

test('a filter HQ cannot use is a 400 before any branch is asked', async () => {
  seen.length = 0;
  const r = await call('/read?scope=no&range=decade', hqDb(), { env: { BRANCH_NO: binding('no') } });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'bad_range');
  assert.equal(seen.length, 0);
});

test('HQ strips again: a branch on an older deploy that answers with personal fields leaks none', async () => {
  const raw = { insights: async () => ({ branch: 'no', as_of: '2026-10-24T07:00:00.000Z', insights: branchRead({}) }) };
  const { body } = await call('/read?scope=no', hqDb(), { env: { BRANCH_NO: raw } });
  assert.equal(body.blocks.dormant.count, 6);
  assertCountsOnly(body);
});

test('a branch that does not answer gives every KPI and block unreadable with its reason, never a zero', async () => {
  const down = { insights: async () => { throw new Error('connection reset'); } };
  const { status, body } = await call('/read?scope=de', hqDb(), { env: { BRANCH_DE: down } });
  assert.equal(status, 200);
  assert.equal(body.scope.label, 'Axal VC DACH');
  assert.deepEqual(body.branch, { status: 'unreadable' });
  for (const k of INSIGHTS_KPI_KEYS) {
    assert.equal(body.kpis[k].available, false, k);
    assert.equal(body.kpis[k].unreadable, true, k);
    assert.match(body.kpis[k].reason, /Axal VC DACH did not answer.*connection reset/, k);
  }
  for (const k of INSIGHTS_BLOCK_KEYS) assert.equal(body.blocks[k].unreadable, true, k);
  assert.doesNotMatch(JSON.stringify(body), /"(total|count|value)":0/, 'no zero stands in for a branch that did not answer');

  const older = { health: async () => ({}) }; // a deploy without insights()
  const o = await call('/read?scope=de', hqDb(), { env: { BRANCH_DE: older } });
  assert.match(o.body.blocks.who.reason, /does not expose insights\(\)/);

  const unbound = await call('/read?scope=it', hqDb());
  assert.deepEqual(unbound.body.branch, { status: 'not_deployed' });
  assert.match(unbound.body.kpis.accounts.reason, /^it is not bound to this Worker yet/);
});

test('a plain Admin, or any admin on a branch, is refused another scope with 403 hq_only and INS10\'s words', async () => {
  const plain = await call('/read?scope=no', hqDb(), { as: PLAIN, env: { BRANCH_NO: binding('no') } });
  assert.equal(plain.status, 403);
  assert.equal(plain.body.code, 'hq_only');
  assert.equal(plain.body.detail, HQ_ONLY_MESSAGE);
  const own = await call('/read?scope=hq', hqDb(), { as: PLAIN });
  assert.equal(own.status, 200, 'their own deployment is always theirs');
  assert.equal(own.body.scope.key, 'hq');
  const none = await call('/read', hqDb(), { as: PLAIN });
  assert.equal(none.body.scope.key, 'hq');
  const bad = await call('/read?scope=../etc', hqDb());
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'bad_scope');
});

test('the scopes list: HQ-held first, then each deployed subsidiary by code, from the registry', async () => {
  const { status, body } = await call('/scopes', hqDb(), { env: { BRANCH_NO: binding('no') } });
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.scopes, [
    { code: 'hq', label: 'HQ-held accounts', kind: 'hq', bound: true },
    { code: 'de', label: 'Axal VC DACH', kind: 'branch', bound: false },
    { code: 'it', label: 'it', kind: 'branch', bound: false },
    { code: 'no', label: 'Branch North', kind: 'branch', bound: true },
  ], 'es is only requested, so it has no database to read');
  assertCountsOnly(body);
});

test('the scopes list refuses a plain Admin and a branch admin, and an unreadable registry still answers HQ-held', async () => {
  const plain = await call('/scopes', hqDb(), { as: PLAIN });
  assert.equal(plain.status, 403);
  assert.equal(plain.body.error, 'hq_only');
  const onBranch = await call('/scopes', hqDb(), { env: { BRANCH_CODE: 'no' } });
  assert.equal(onBranch.status, 403);
  const gone = await call('/scopes', hqDb({ registry: false }));
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.body.scopes.map((s: any) => s.code), ['hq']);
  assert.match(gone.body.reason, /deployment registry could not be read/);
});
