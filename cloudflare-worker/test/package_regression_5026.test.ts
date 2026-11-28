/**
 * #5026 end-to-end package regressions over real SQLite, JWTs and the mounted routes: the catalogue seed, the
 * country-adjusted comparison, accepting Core Network, the Full Axal VC refusal, an override, a standalone grant
 * beside a package, upgrade / downgrade / renewal reads, a renewal to a new catalogue version, no package with
 * standalone programs, and an old package that stays reproducible after catalogue v2 — each read back through the
 * studio's own `GET /api/licence/mine/package` (D5026 part 2, board L35), which must never carry HQ's internals.
 * Branch push failure and grant conflicts keep their own cases in `package_offers_5024.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount as offers } from '../src/routes/admin_package_offers.ts';
import { mount as snapshots } from '../src/routes/admin_licence_pricing_apply.ts';
import { mount as pricing } from '../src/routes/admin_package_pricing.ts';
import { mount as lifecycle } from '../src/routes/admin_package_lifecycle.ts';
import { mount as catalogue } from '../src/routes/admin_licence_packages.ts';
import { mount as mine, BRANCH_REASON } from '../src/routes/licence_package_mine.ts';
import policies from '../src/routes/admin_licence_agreement_policies.ts';
import grants from '../src/routes/admin_program_grants.ts';
import { activePackageDetail, draftNextVersion, publishVersion } from '../src/services/licencePackagesStore.ts';

const CLOCK = Date.UTC(2026, 10, 13, 12); // 2026-11-13
const SECRET = 'synthetic-package-regression-5026-test-secret';
const LIC = 'lic_5026';
const CORE = ['perks', 'refer-and-earn', 'referral-partners'];
const BASE = `/api/admin/licences/${LIC}/package-offers`;
const REASON = 'Commercial package reviewed with the licence operator';
const HQ = 1, STUDIO = 4;
// Words that name HQ's pricing internals. None may reach the studio's read.
const HQ_ONLY = ['recommend', 'override', 'snapshot', 'index', 'model', 'decided_by', 'created_by', 'acceptance', REASON];

function fixture(ctx: any) {
  ctx.mock.timers.enable({ apis: ['Date'], now: CLOCK });
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  ctx.after(() => db.close());
  for (const id of [HQ, STUDIO]) {
    db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, 'admin', ?, ?)").run(id, `Person ${id}`, `test${id}@example.test`);
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', ?)")
      .run(id, `totp-${id}`, new Date(CLOCK).toISOString());
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${HQ})`);
  db.exec("UPDATE pricing_models SET status = 'active', activated_at = '2026-11-01' WHERE uid = 'pricing-model-v1-seed'");
  db.exec(`UPDATE country_market_profiles SET population = 68000000, population_status = 'recorded',
    ppp_gdp_per_capita = 58000, ppp_status = 'recorded', startup_ecosystem_score = 30000,
    startup_score_status = 'recorded', regulatory_class = 'medium' WHERE country_code = 'FR'`);
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years,
    annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
    VALUES (1, ?, 'AXL-5026', 'Test licensee', 'Test studio', 'active', 3, 1000000, 'EUR', 3000, 5000, '2025-01-01', '2028-01-01')`).run(LIC);
  db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (1, 'FR')").run();
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'delegate')").run(STUDIO);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  for (const m of [offers, lifecycle, mine, catalogue, ...pricing, ...snapshots]) app.route(m.path, m.router);
  app.route('/api/admin/licence-agreement-policies', policies);
  app.route('/api/admin/program-grants', grants);
  const call = async (method: string, path: string, body?: unknown, user: number = HQ, e = env) => {
    const token = await new SignJWT({ user_id: user, role: 'admin', jti: `totp-${user}` })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await withThrownResponses(() => app.request(path, { method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, e));
    return { status: res.status, body: await res.json() as any };
  };
  const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;
  const studio = async () => {
    const r = await call('GET', '/api/licence/mine/package', undefined, STUDIO);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const text = JSON.stringify(r.body).toLowerCase();
    for (const word of HQ_ONLY) assert.ok(!text.includes(word.toLowerCase()), `the studio read carries no "${word}"`);
    return r.body;
  };
  let seq = 0;
  /** Publish a catalogue version of `key` dated inside the mocked clock (the seed's date('now') is not). */
  const publish = async (key: string, edit: (d: any) => any = (d) => d) => {
    const current = await activePackageDetail(env, key);
    const draft = await draftNextVersion(env, key, edit({ ...current, effective_from: '2026-11-01' }), 'user:1');
    await publishVersion(env, key, draft.version, 'user:1');
    return draft.version;
  };
  const setup = async () => {
    await publish('core_network', (d) => ({ ...d, items: d.items.filter((p: any) => p.program_key !== 'influencer') }));
    const p = await call('POST', '/api/admin/licence-agreement-policies/package/core_network',
      { strategy: 'none', legal_gate: 'optional', programs: CORE, reason: REASON });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    const s = await call('POST', `/api/admin/licences/${LIC}/pricing/snapshot`, {});
    assert.equal(s.status, 201, JSON.stringify(s.body));
  };
  const offered = async (extra: Record<string, unknown> = {}) => {
    const c = await call('POST', BASE, { package_key: 'core_network', starts_on: '2026-11-13', ends_on: '2027-10-31',
      reason: REASON, idempotency_key: `create-5026-${++seq}`, ...extra });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const o = await call('POST', `${BASE}/${c.body.offer.uid}/offer`, { expected_revision: c.body.offer.revision, reason: REASON });
    assert.equal(o.status, 200, JSON.stringify(o.body));
    return o.body.offer;
  };
  const accept = async (o: any, price: Record<string, unknown> = {}) => {
    const r = await call('POST', `${BASE}/${o.uid}/review`, price);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return call('POST', `${BASE}/${o.uid}/accept`, { ...price, expected_revision: o.revision, review_hash: r.body.review_hash,
      reason: REASON, idempotency_key: `accept-5026-${++seq}` });
  };
  const standaloneGrant = async (program: string) => {
    const r = await call('POST', `/api/admin/program-grants/licences/${LIC}/${program}`, { reason: REASON,
      terms: { starts_on: '2026-01-01', ends_on: '2028-01-01', requires_signed_schedule: 0, fee_cents: 10000, currency: 'EUR' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  };
  const freshSession = (at: number) => db.prepare('UPDATE user_sessions SET created_at = ?').run(new Date(at).toISOString());
  return { db, env, call, one, studio, publish, setup, offered, accept, standaloneGrant, freshSession };
}

test('the catalogue seeds the four Axal VC packages and prices a published one for the licence country', async (t) => {
  const f = fixture(t);
  const all = await f.call('GET', '/api/admin/licence-packages?all=1');
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.deepEqual([...new Set(all.body.packages.map((p: any) => p.package_key))].sort(),
    ['core_network', 'full_axal_vc', 'talent_learning', 'venture_building']);
  await f.setup();
  const priced = await f.call('GET', `/api/admin/licences/${LIC}/package-pricing?package=core_network`);
  assert.equal(priced.status, 200, JSON.stringify(priced.body));
  const core = priced.body.packages[0];
  assert.deepEqual([core.package_key, core.package_version, core.currency], ['core_network', 2, 'EUR']);
  assert.ok(Number.isSafeInteger(priced.body.country_index_ppm) && priced.body.country_index_ppm > 0, 'priced from the FR index');
  assert.equal(core.country_index_ppm, priced.body.country_index_ppm);
});

test('no package with standalone programs: the studio reads no package and names its standalone grants', async (t) => {
  const f = fixture(t); await f.setup();
  const none = await f.studio();
  assert.deepEqual([none.recorded, none.current, none.next, none.standalone], [true, null, null, []]);
  await f.standaloneGrant('learning');
  const read = await f.studio();
  assert.deepEqual([read.current, read.standalone], [null, ['learning']], 'no package is not no programs');
  assert.equal((await f.call('GET', '/api/licence/mine/package', undefined, HQ)).status, 404, 'an account no licence binds reads no licence');
});

test('accepting Core Network at an override price: the studio reads the frozen package, price and extras, never HQ internals', async (t) => {
  const f = fixture(t); await f.setup();
  await f.standaloneGrant('learning');
  const o = await f.offered();
  const accepted = await f.accept(o, { accepted_annual_fee_cents: 123400, override_reason: 'Frozen negotiated package price for this term' });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const read = await f.studio();
  assert.deepEqual(read.current, {
    package_key: 'core_network', package_name: o.package_name, package_version: 2, starts_on: '2026-11-13', ends_on: '2027-10-31',
    state: 'active', programs: CORE, annual_fee_cents: 123400, currency: 'EUR',
  });
  assert.notEqual(o.recommended_annual_fee_cents, 123400, 'the override differs from the recommendation the studio never sees');
  assert.deepEqual([read.next, read.standalone], [null, ['learning']], 'a program outside the package stays a standalone extra');
});

test('Full Axal VC is refused whole while it holds an HQ-only program; the studio still reads no package', async (t) => {
  const f = fixture(t); await f.setup();
  await f.publish('full_axal_vc');
  const draft = await f.call('POST', BASE, { package_key: 'full_axal_vc', starts_on: '2026-11-13', ends_on: '2027-10-31',
    reason: REASON, idempotency_key: 'create-5026-full' });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const blocked = await f.call('POST', `${BASE}/${draft.body.offer.uid}/offer`, { expected_revision: draft.body.offer.revision, reason: REASON });
  assert.deepEqual([blocked.status, blocked.body.error], [409, 'package_delivery_conflict']);
  assert.ok(blocked.body.conflicts.some((p: any) => p.code === 'not_grantable'));
  assert.equal(f.one('SELECT COUNT(*) AS n FROM program_grants').n, 0, 'no partial grant');
  assert.equal((await f.studio()).current, null);
});

test('upgrade, downgrade and renewal are read against the accepted term, and a renewal to catalogue v3 keeps v2 reproducible', async (t) => {
  const f = fixture(t); await f.setup();
  const first = await f.offered();
  assert.equal((await f.accept(first)).status, 200);
  // Catalogue v3 renames the package and changes its base fee; the accepted v2 term must not move.
  const v3 = await f.publish('core_network', (d) => ({ ...d, name: 'Core Network 2028', base_annual_fee_cents: d.base_annual_fee_cents + 100000 }));
  assert.equal(v3, 3);
  const before = await f.studio();
  assert.deepEqual([before.current.package_version, before.current.package_name, before.current.programs], [2, first.package_name, CORE]);
  const s = await f.call('POST', `/api/admin/licences/${LIC}/pricing/snapshot`, {});
  assert.equal(s.status, 201, JSON.stringify(s.body));
  // The next term retains today's grants, so HQ first extends each one in Program Grants: an offer never
  // stretches a grant's dates on its own (packageOfferGrants `grant_dates_conflict`).
  const tooShort = await f.call('POST', BASE, { package_key: 'core_network', starts_on: '2027-11-01', ends_on: '2028-10-31',
    reason: REASON, idempotency_key: 'create-5026-short' });
  const refused = await f.call('POST', `${BASE}/${tooShort.body.offer.uid}/offer`, { expected_revision: 0, reason: REASON });
  assert.deepEqual([refused.status, refused.body.error], [409, 'package_delivery_conflict']);
  assert.ok(refused.body.conflicts.every((p: any) => p.code === 'grant_dates_conflict'));
  for (const program of CORE) {
    const ext = await f.call('PATCH', `/api/admin/program-grants/licences/${LIC}/${program}`, { reason: REASON, terms: { ends_on: '2028-10-31' } });
    assert.equal(ext.status, 200, JSON.stringify(ext.body));
  }
  const next = await f.offered({ starts_on: '2027-11-01', ends_on: '2028-10-31' });
  assert.equal(next.package_version, 3);
  const review = await f.call('GET', `${BASE}/${next.uid}/change-review`);
  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.equal(review.body.kind, 'renewal', 'the same package with the same programs, on a new catalogue version');
  // A strict superset is an upgrade and a strict subset a downgrade (synthetic drafts, same review route).
  for (const [uid, keys, kind] of [['syn_up', [...CORE, 'learning'], 'upgrade'], ['syn_down', CORE.slice(1), 'downgrade']] as const) {
    f.db.prepare(`INSERT INTO licence_package_offers (uid, licence_uid, package_uid, package_key, package_version, package_name,
      pricing_recommendation_uid, country_pricing_snapshot_uid, currency, recommended_annual_fee_cents, state, starts_on, ends_on,
      composition_json, recommendation_json, created_at, created_by, create_key, create_hash)
      SELECT ?, licence_uid, package_uid, package_key, package_version, package_name, pricing_recommendation_uid,
             country_pricing_snapshot_uid, currency, recommended_annual_fee_cents, 'draft', '2027-11-01', '2028-10-31', ?,
             recommendation_json, created_at, created_by, ?, 'h' FROM licence_package_offers WHERE uid = ?`)
      .run(uid, JSON.stringify(keys.map((k, i) => ({ program_key: k, position: i }))), `key-${uid}`, first.uid);
    assert.equal((await f.call('GET', `${BASE}/${uid}/change-review`)).body.kind, kind);
  }
  f.db.prepare("DELETE FROM licence_package_offers WHERE uid IN ('syn_up', 'syn_down')").run();
  const scheduled = await f.call('POST', `${BASE}/${next.uid}/schedule-change`, { reason: REASON, idempotency_key: 'sched-5026-001' });
  assert.equal(scheduled.status, 201, JSON.stringify(scheduled.body));
  // Next term only (D5025-p2): HQ accepts on the day, and the studio then reads v3 as current.
  t.mock.timers.setTime(Date.UTC(2027, 10, 1, 9)); f.freshSession(Date.UTC(2027, 10, 1, 9));
  const renewed = await f.accept(next);
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  const after = await f.studio();
  assert.deepEqual([after.current.package_version, after.current.package_name, after.current.programs, after.current.state],
    [3, 'Core Network 2028', CORE, 'active']);
  const old = f.one('SELECT package_version, package_name, composition_json FROM licence_package_offers WHERE uid = ?', first.uid);
  assert.deepEqual([old.package_version, old.package_name, JSON.parse(old.composition_json).map((p: any) => p.program_key).sort()],
    [2, first.package_name, CORE], 'the old term is still reproducible from its frozen record');
  const changes = await f.call('GET', `/api/admin/licences/${LIC}/package-changes`);
  assert.deepEqual(changes.body.items.map((x: any) => x.status), ['applied']);
});

test('a branch deployment reads Not recorded with its reason, never no package', async (t) => {
  const f = fixture(t);
  const r = await f.call('GET', '/api/licence/mine/package', undefined, STUDIO, { ...f.env, BRANCH_CODE: 'fr' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.source, r.body.recorded, r.body.current, r.body.standalone, r.body.reason], ['copy', false, null, null, BRANCH_REASON]);
});
