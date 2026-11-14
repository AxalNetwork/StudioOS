// D1418 (#3862): the Studio module catalogue the canvas draws (#3698, SM0–SM15)
// — the 27 cycle modules derived from the Worker's own lists, every module's
// purpose, group and Open link, the renames, the defaults, and
// `GET /api/studio/modules`'s groups and `in_default`, against real SQLite
// with migration 687 and signed sessions per role.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/studio_catalogue_d1418.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import studio from '../src/routes/studio_layout.ts';
import {
  CYCLE_MODULES, CYCLE_PURPOSE, STUDIO_DEFAULTS, STUDIO_GROUPS, STUDIO_LAYOUT_MAX, STUDIO_MODULES, STUDIO_PROFILES, catalogueOf, cycleModuleKey,
} from '../src/services/studioModules.ts';
import { MODULES as VALIDATE } from '../src/services/cycleValidate.ts';
import { MODULES as RAISE } from '../src/services/raiseCycle.ts';
import { GROW_MODULES as GROW } from '../src/services/growCycle.ts';
import { BUILD_MODULES } from '../src/routes/cycle_build.ts';

const JWT_SECRET = randomBytes(32).toString('hex');
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const MIGRATION = readFileSync(new URL('../sql/migrations/687_studio_layouts.sql', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');

// [id, role, spinout_lab_active]
const USERS: Array<[number, string, number]> = [[1, 'founder', 0], [2, 'investor', 0], [3, 'advisor', 0], [4, 'partner', 0], [5, 'admin', 0], [7, 'exploring', 1], [9, 'founder', 1]];
function world() {
  const fx = makeD1(stripForeignKeys(tableFromBaseline(baseline, 'users')));
  fx.db.exec(MIGRATION);
  for (const [id, role, lab] of USERS)
    fx.db.prepare("INSERT INTO users(id,name,email,role,is_active,spinout_lab_active,subscription_tier,investor_tier) VALUES(?,?,?,?,1,?,'free','free')").run(id, 'Synthetic', `s${id}@example.test`, role, lab);
  return { ...fx, env: { DB: fx.DB, JWT_SECRET, ENVIRONMENT: 'development' } as any };
}
const token = (id: number) => new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function modules(env: any, id: number, q = '') {
  const res = await studio.fetch(new Request(`https://example.test/modules${q}`, { headers: { authorization: `Bearer ${await token(id)}` } }), env);
  return { status: res.status, body: await res.json() as any };
}

const LISTS: Array<[string, ReadonlyArray<{ slug: string; name: string }>]> = [
  ['validate', VALIDATE], ['build', BUILD_MODULES.map(([slug, name]) => ({ slug, name }))], ['raise', RAISE], ['grow', GROW],
];

test('the 27 founder cycle rows are the four Worker lists, in order, with their names and a purpose each', () => {
  const expected = LISTS.flatMap(([cycle, list]) => list.map((m) => ({ key: cycleModuleKey(cycle, m.slug), title: m.name, group: cycle, href: `/${cycle}/${m.slug}`, purpose: CYCLE_PURPOSE[`${cycle}/${m.slug}`] })));
  assert.equal(expected.length, 27);
  assert.deepEqual(CYCLE_MODULES.map(({ key, title, group, href, purpose }) => ({ key, title, group, href, purpose })), expected);
  for (const [cycle, list] of LISTS) for (const m of list) assert.ok(CYCLE_PURPOSE[`${cycle}/${m.slug}`], `${cycle}/${m.slug} has a purpose`);
  assert.equal(Object.keys(CYCLE_PURPOSE).length, 27, 'no purpose for a slug the lists do not have');
  assert.equal(cycleModuleKey('build', 'prototype-mvp'), 'build_prototype_mvp');
  for (const m of CYCLE_MODULES) {
    assert.deepEqual([m.default_size, m.reads], ['1/3', [`/api/cycles/${m.group}/overview`]]);
    assert.equal(m.founder_role_only === true, m.group === 'grow', `${m.key}: only Grow is founder-only`);
  }
});

test('every module: a purpose of at most 80 characters, a group of its profile, an Open link that is a real route or none, and a title that is never a key', () => {
  // A route matches when every segment is equal or the route's is a `:param`.
  const routes = [...APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p.startsWith('/') && !p.includes('*'))
    .map((p) => p.split('/'))
    .map((segs) => ({ test: (href: string) => { const h = href.split('/'); return h.length === segs.length && segs.every((s, i) => s.startsWith(':') ? h[i] !== '' : s === h[i]); } }));
  assert.ok(routes.length > 100, 'App.jsx routes were read');
  for (const m of STUDIO_MODULES) {
    assert.ok(m.purpose.trim().length > 0 && m.purpose.length <= 80, `${m.key}: purpose`);
    assert.ok(STUDIO_GROUPS[m.profile].some((g) => g.key === m.group), `${m.key}: group ${m.group}`);
    if (m.href !== null) assert.ok(routes.some((re) => re.test(m.href!)), `${m.key}: ${m.href} is a route in App.jsx`);
    assert.notEqual(m.title, m.key);
    assert.doesNotMatch(m.title, /_/, `${m.key}: title`);
  }
});

test('the renames: no module_map, firm_standing or "Module map"; Lab tools, Firm tiles and Firm feed are there', () => {
  const keys = STUDIO_MODULES.map((m) => m.key);
  const titles = STUDIO_MODULES.map((m) => m.title);
  for (const k of ['module_map', 'firm_standing']) assert.ok(!keys.includes(k), k);
  assert.ok(!titles.includes('Module map') && !titles.includes('What needs you') && !titles.includes('Firm standing'));
  assert.deepEqual(['lab_tools', 'firm_tiles', 'firm_feed'].map((k) => STUDIO_MODULES.find((m) => m.key === k)!.title), ['Lab tools', 'Firm tiles', 'Firm feed']);
  assert.equal(STUDIO_MODULES.find((m) => m.key === 'lab_tools')!.href, '/spinout-lab');
  assert.equal(STUDIO_MODULES.find((m) => m.key === 'operating_brief')!.title, 'Operating brief', 'owner question G, S1’s pick (a)');
  assert.ok(!keys.includes('holding_progress') && !keys.includes('implications'), 'owner question B, S1’s pick (b)');
});

test('the defaults are the canvas’s, within the cap, each in its catalogue at its own default size', () => {
  const short = (p: string) => STUDIO_DEFAULTS[p as keyof typeof STUDIO_DEFAULTS].map((d) => `${d.key} ${d.size}`);
  assert.deepEqual(short('founder'), ['company_progress full', 'eadwyn_questions 1/2', 'lab_tools 1/2']);
  assert.deepEqual(short('investor'), ['usage_quota', 'deal_lifecycle', 'scored_opportunities', 'quick_stats', 'portfolio_glance', 'upcoming_events'].map((k) => `${k} 1/2`));
  assert.deepEqual(short('advisor'), ['today 1/2', 'storefront 1/2', 'engagements 1/2', 'consented_proof 1/2', 'earnings full']);
  assert.deepEqual(short('partner'), ['firm_tiles full', 'operating_brief full', 'firm_feed full']);
  for (const p of STUDIO_PROFILES) {
    assert.ok(STUDIO_DEFAULTS[p].length <= STUDIO_LAYOUT_MAX);
    const cat = new Map(catalogueOf(p, { role: 'admin' }).map((m) => [m.key, m]));
    for (const d of STUDIO_DEFAULTS[p]) {
      assert.ok(cat.has(d.key), `${p}: ${d.key} is offered`);
      assert.equal(cat.get(d.key)!.default_size, d.size, `${p}: ${d.key}'s default_size`);
    }
  }
});

test('GET /modules: the founder gets five groups and 30 modules; a Spin-Out Lab member no Grow and 23; an investor one group and 6; in_default marks exactly the defaults', async () => {
  const w = world();
  try {
    const founder = await modules(w.env, 1);
    assert.equal(founder.status, 200);
    assert.deepEqual(founder.body.groups, [{ key: 'studio', label: 'Studio' }, { key: 'validate', label: 'Validate' }, { key: 'build', label: 'Build' }, { key: 'raise', label: 'Raise' }, { key: 'grow', label: 'Grow' }]);
    assert.equal(founder.body.modules.length, 30);
    assert.deepEqual(founder.body.modules.slice(0, 4).map((m: any) => m.key), ['company_progress', 'eadwyn_questions', 'lab_tools', 'validate_problem_discovery']);
    const prototype = founder.body.modules.find((m: any) => m.key === 'build_prototype_mvp');
    assert.deepEqual(prototype, { key: 'build_prototype_mvp', title: 'Prototype / MVP', group: 'build', purpose: 'Must-haves done against the plan.', href: '/build/prototype-mvp', default_size: '1/3', in_default: false, cohort_only: false, locked_by_plan: false, plan: null });
    assert.deepEqual(founder.body.modules.filter((m: any) => m.in_default).map((m: any) => m.key), ['company_progress', 'eadwyn_questions', 'lab_tools']);
    for (const id of [7, 9]) {
      const lab = await modules(w.env, id);
      assert.equal(lab.body.profile, 'founder');
      const labFounder = USERS.find((u) => u[0] === id)![1] === 'founder';
      assert.equal(lab.body.modules.length, labFounder ? 30 : 23, `user ${id}`);
      assert.equal(lab.body.groups.some((g: any) => g.key === 'grow'), labFounder, 'a group with no module offered is left out');
      assert.ok(lab.body.groups.every((g: any) => lab.body.modules.some((m: any) => m.group === g.key)), 'no empty group');
    }
    const admin = await modules(w.env, 5, '?profile=founder');
    assert.equal(admin.body.modules.length, 30, 'an admin previews the founder Studio with Grow');
    const inv = await modules(w.env, 2);
    assert.deepEqual([inv.body.groups, inv.body.modules.length], [[{ key: 'investor', label: 'Investor' }], 6]);
    assert.ok(inv.body.modules.every((m: any) => m.in_default));
    const scored = inv.body.modules.find((m: any) => m.key === 'scored_opportunities');
    assert.deepEqual([scored.locked_by_plan, scored.plan], [false, null], 'the canvas’s Investor Pro lock is not added');
    const adv = await modules(w.env, 3);
    assert.deepEqual(adv.body.groups, [{ key: 'advisor', label: 'Advisor' }]);
    const partner = await modules(w.env, 4);
    assert.deepEqual([partner.body.groups, partner.body.modules.map((m: any) => m.key)], [[{ key: 'partner', label: 'Operating partner' }], ['firm_tiles', 'operating_brief', 'firm_feed']]);
    for (const r of [founder, inv, adv, partner]) for (const m of r.body.modules) assert.equal(m.in_default, STUDIO_DEFAULTS[r.body.profile as 'founder'].some((d) => d.key === m.key));
  } finally { w.db.close(); }
});
