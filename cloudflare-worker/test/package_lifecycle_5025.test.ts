/** Package term states, change review and proration over real SQLite (#5025 part 1, D5025). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount } from '../src/routes/admin_package_lifecycle.ts';
import { changeKind, prorate, reviewChange, standaloneGranted, termState } from '../src/services/packageLifecycle.ts';

const CLOCK = Date.UTC(2026, 10, 23, 12); // 2026-11-23
const SECRET = 'synthetic-package-lifecycle-5025-test-secret';
const LIC = 'lic_5025';
const comp = (...keys: string[]) => JSON.stringify(keys.map((k, i) => ({ program_key: k, position: i, metadata: null, terms: {} })));
const rec = (ppm: number) => JSON.stringify({ country_index_ppm: ppm, pricing_model_version: 1 });

function fixture(ctx: any) {
  ctx.mock.timers.enable({ apis: ['Date'], now: CLOCK });
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  ctx.after(() => db.close());
  for (const id of [1, 2]) {
    db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, 'admin', ?, ?)").run(id, `Operator ${id}`, `test${id}@example.test`);
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', ?)")
      .run(id, `totp-${id}`, new Date(CLOCK).toISOString());
  }
  db.exec('INSERT INTO super_admins (user_id) VALUES (1)');
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years,
    annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
    VALUES (1, ?, 'AXL-5025', 'Test licensee', 'Test studio', 'active', 3, 1000000, 'EUR', 3000, 5000, '2025-01-01', '2028-01-01')`).run(LIC);
  const offer = (uid: string, o: Record<string, any>) => {
    const accepted = o.state === 'accepted';
    db.prepare(`INSERT INTO licence_package_offers (uid, licence_uid, package_uid, package_key, package_version, package_name,
      pricing_recommendation_uid, country_pricing_snapshot_uid, currency, recommended_annual_fee_cents, accepted_annual_fee_cents,
      state, override_reason, starts_on, ends_on, composition_json, recommendation_json, created_at, created_by, create_key, create_hash,
      decided_by, acceptance_json) VALUES (?, ?, 'pkg', ?, 1, 'Package', 'rec', 'snap', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 1, ?, 'h', ?, ?)`)
      .run(uid, LIC, o.key ?? 'core_network', o.currency ?? 'EUR', o.fee, accepted ? o.fee : null, o.state, o.starts, o.ends,
        o.comp, o.rec ?? rec(1_000_000), o.created ?? '2026-01-01T00:00:00Z', `key-${uid}`, accepted ? 1 : null, accepted ? '{}' : null);
  };
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  app.route(mount.path, mount.router);
  const call = async (path: string, user: number | null = 1) => {
    const token = user == null ? null : await new SignJWT({ user_id: user, role: 'admin', jti: `totp-${user}` })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await withThrownResponses(() => app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env));
    return { status: res.status, body: await res.json() as any, cache: res.headers.get('cache-control') };
  };
  return { db, env, offer, call };
}

const T = (uid: string, state: string, starts: string, ends: string) => ({ uid, state, starts_on: starts, ends_on: ends } as any);

test('term states: scheduled, active, renewal_pending, superseded, ended', () => {
  const a = T('a', 'accepted', '2025-01-01', '2025-12-31');
  const b = T('b', 'accepted', '2026-01-01', '2026-12-31');
  const d = T('d', 'draft', '2027-01-01', '2027-12-31');
  assert.equal(termState(a, [a], '2024-12-31'), 'scheduled');
  assert.equal(termState(a, [a], '2025-01-01'), 'active');
  assert.equal(termState(a, [a], '2025-12-31'), 'active');
  assert.equal(termState(a, [a], '2026-01-01'), 'ended');
  assert.equal(termState(a, [a, b], '2026-01-01'), 'superseded');
  assert.equal(termState(a, [a, b], '2025-12-31'), 'active', 'a later term that has not started supersedes nothing');
  assert.equal(termState(b, [a, b, d], '2026-06-01'), 'renewal_pending');
  assert.equal(termState(b, [a, b, { ...d, state: 'declined' }], '2026-06-01'), 'active', 'a declined offer is not pending');
});

test('change kinds', () => {
  assert.equal(changeKind(['a', 'b'], ['a', 'b'], true), 'renewal');
  assert.equal(changeKind(['a', 'b'], ['a', 'b', 'c'], true), 'upgrade');
  assert.equal(changeKind(['a', 'b'], ['a'], false), 'downgrade');
  assert.equal(changeKind(['a', 'b'], ['a', 'c'], true), 'change');
  assert.equal(changeKind(['a', 'b'], ['a', 'b'], false), 'change');
});

test('proration is actual-day, inclusive, floored in integer cents', () => {
  const p = prorate({ termStartsOn: '2026-01-01', termEndsOn: '2026-12-31', effectiveOn: '2026-11-23',
    oldAnnualFeeCents: 1_000_000, newAnnualFeeCents: 1_500_000, currency: 'EUR', newCurrency: 'EUR' })!;
  assert.equal(p.term_days, 365);
  assert.equal(p.remaining_days, 39);
  assert.equal(p.credit_cents, 106_849); // floor(1_000_000 × 39 / 365) = 106849.3
  assert.equal(p.debit_cents, 160_273); // floor(1_500_000 × 39 / 365) = 160273.9
  assert.equal(p.net_cents, 53_424);
  assert.equal(p.direction, 'debit');
  assert.equal(p.trace.length, 5);
  const whole = prorate({ termStartsOn: '2026-01-01', termEndsOn: '2026-12-31', effectiveOn: '2026-01-01',
    oldAnnualFeeCents: 900, newAnnualFeeCents: 300, currency: 'EUR', newCurrency: 'EUR' })!;
  assert.deepEqual([whole.remaining_days, whole.credit_cents, whole.debit_cents, whole.direction], [365, 900, 300, 'credit']);
  const last = prorate({ termStartsOn: '2026-01-01', termEndsOn: '2026-12-31', effectiveOn: '2026-12-31',
    oldAnnualFeeCents: 365, newAnnualFeeCents: 365, currency: 'EUR', newCurrency: 'EUR' })!;
  assert.deepEqual([last.remaining_days, last.credit_cents, last.net_cents, last.direction], [1, 1, 0, 'none']);
  const base = { termStartsOn: '2026-01-01', termEndsOn: '2026-12-31', oldAnnualFeeCents: 1, newAnnualFeeCents: 1, currency: 'EUR' };
  assert.equal(prorate({ ...base, effectiveOn: '2027-01-01', newCurrency: 'EUR' }), null);
  assert.equal(prorate({ ...base, effectiveOn: '2025-12-31', newCurrency: 'EUR' }), null);
  assert.equal(prorate({ ...base, effectiveOn: '2026-06-01', newCurrency: 'USD' }), null);
});

test('package-terms lists accepted terms with their state; Super Admin only', async (t) => {
  const { offer, call } = fixture(t);
  offer('old', { state: 'accepted', fee: 900_000, starts: '2025-01-01', ends: '2025-12-31', comp: comp('perks') });
  offer('cur', { state: 'accepted', fee: 1_000_000, starts: '2026-01-01', ends: '2026-12-31', comp: comp('perks') });
  offer('next', { state: 'offered', fee: 1_100_000, starts: '2027-01-01', ends: '2027-12-31', comp: comp('perks') });
  const res = await call(`/api/admin/licences/${LIC}/package-terms`);
  assert.equal(res.status, 200);
  assert.equal(res.cache, 'no-store');
  assert.equal(res.body.as_of, '2026-11-23');
  assert.deepEqual(res.body.items.map((x: any) => [x.uid, x.state]), [['old', 'superseded'], ['cur', 'renewal_pending']]);
  assert.equal((await call(`/api/admin/licences/${LIC}/package-terms`, 2)).status, 403);
  assert.equal((await call(`/api/admin/licences/${LIC}/package-terms`, null)).status, 401);
  assert.equal((await call('/api/admin/licences/lic_none/package-terms')).status, 404);
});

test('change review: upgrade with programs, price, index movement and proration; nothing written', async (t) => {
  const { db, offer, call } = fixture(t);
  offer('cur', { state: 'accepted', fee: 1_000_000, starts: '2026-01-01', ends: '2026-12-31', comp: comp('perks', 'learning'), rec: rec(1_000_000) });
  offer('up', { state: 'draft', fee: 1_500_000, starts: '2026-11-23', ends: '2027-11-22', comp: comp('perks', 'learning', 'mentor-cohorts'), rec: rec(1_050_000) });
  db.prepare(`INSERT INTO program_grants (uid, licence_id, program_key, state, set_at) VALUES ('g1', 1, 'mentor-cohorts', 'granted', '2026-01-01'),
    ('g2', 1, 'spinout-lab', 'granted', '2026-01-01'), ('g3', 1, 'product-testing', 'ended', '2026-01-01')`).run();
  const before = db.prepare('SELECT COUNT(*) AS n FROM licence_package_offers').get();
  const res = await call(`/api/admin/licences/${LIC}/package-offers/up/change-review?effective_on=2026-11-23`);
  assert.equal(res.status, 200);
  assert.equal(res.cache, 'no-store');
  const b = res.body;
  assert.equal(b.kind, 'upgrade');
  assert.equal(b.current_term.uid, 'cur');
  assert.deepEqual(b.programs, { held: ['learning', 'perks'], added: ['mentor-cohorts'], ending: [], standalone_becoming_bundled: ['mentor-cohorts'] });
  assert.deepEqual([b.price.old_accepted_annual_fee_cents, b.price.new_annual_fee_cents, b.price.new_is, b.price.difference_cents], [1_000_000, 1_500_000, 'recommended', 500_000]);
  assert.deepEqual(b.country_index, { old_ppm: 1_000_000, new_ppm: 1_050_000, movement_ppm: 50_000 });
  assert.deepEqual(b.effective, { next_term_starts_on: '2027-01-01', proposal_starts_on: '2026-11-23', starts_inside_current_term: true });
  assert.equal(b.ending_dependents, null);
  assert.equal(b.financial_rule, 'not_decided');
  assert.equal(b.current_term_changes, false);
  assert.deepEqual([b.proration_quote.credit_cents, b.proration_quote.debit_cents, b.proration_quote.net_cents], [106_849, 160_273, 53_424]);
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM licence_package_offers').get(), before);
  assert.equal((db.prepare("SELECT state FROM licence_package_offers WHERE uid = 'cur'").get() as any).state, 'accepted');
});

test('change review: downgrade names dependents as not recorded; refusals', async (t) => {
  const { offer, call } = fixture(t);
  offer('cur', { state: 'accepted', fee: 1_000_000, starts: '2026-01-01', ends: '2026-12-31', comp: comp('perks', 'learning') });
  offer('down', { state: 'offered', key: 'lite', fee: 600_000, starts: '2027-01-01', ends: '2027-12-31', comp: comp('perks'), rec: 'null' });
  offer('gone', { state: 'declined', fee: 600_000, starts: '2027-01-01', ends: '2027-12-31', comp: comp('perks') });
  const res = await call(`/api/admin/licences/${LIC}/package-offers/down/change-review`);
  assert.equal(res.status, 200);
  assert.equal(res.body.kind, 'downgrade');
  assert.deepEqual(res.body.programs.ending, ['learning']);
  assert.equal(res.body.ending_dependents.status, 'not_recorded');
  assert.equal(res.body.proration_quote, null);
  assert.deepEqual(res.body.country_index, { old_ppm: 1_000_000, new_ppm: null, movement_ppm: null });
  assert.equal(res.body.effective.starts_inside_current_term, false);
  assert.equal((await call(`/api/admin/licences/${LIC}/package-offers/down/change-review?effective_on=2027-02-01`)).body.error, 'effective_outside_term');
  assert.equal((await call(`/api/admin/licences/${LIC}/package-offers/down/change-review?effective_on=soon`)).body.error, 'invalid_effective_on');
  assert.equal((await call(`/api/admin/licences/${LIC}/package-offers/gone/change-review`)).status, 409);
  assert.equal((await call(`/api/admin/licences/${LIC}/package-offers/cur/change-review`)).status, 409);
  assert.equal((await call(`/api/admin/licences/${LIC}/package-offers/nope/change-review`)).status, 404);
  assert.equal((await call(`/api/admin/licences/${LIC}/package-offers/down/change-review`, 2)).status, 403);
});

test('change review with no accepted term says it is a first term', async (t) => {
  const { offer, call } = fixture(t);
  offer('first', { state: 'draft', fee: 600_000, starts: '2027-01-01', ends: '2027-12-31', comp: comp('perks') });
  const res = await call(`/api/admin/licences/${LIC}/package-offers/first/change-review?effective_on=2027-01-01`);
  assert.equal(res.status, 200);
  assert.equal(res.body.current_term, null);
  assert.equal(res.body.kind, null);
});

test('standalone grants: granted only, and not one an accepted package item holds', async (t) => {
  const { db, env, offer } = fixture(t);
  offer('cur', { state: 'accepted', fee: 1, starts: '2026-01-01', ends: '2026-12-31', comp: comp('perks') });
  offer('drf', { state: 'draft', fee: 1, starts: '2027-01-01', ends: '2027-12-31', comp: comp('learning') });
  db.prepare(`INSERT INTO program_grants (uid, licence_id, program_key, state, set_at) VALUES
    ('g1', 1, 'mentor-cohorts', 'granted', '2026-01-01'), ('g2', 1, 'product-testing', 'ended', '2026-01-01'),
    ('g3', 1, 'perks', 'granted', '2026-01-01'), ('g4', 1, 'learning', 'granted', '2026-01-01')`).run();
  const item = db.prepare(`INSERT INTO licence_package_items (offer_uid, program_key, package_uid, package_key, package_version, position,
    grant_uid, grant_terms_revision, grant_action, accepted_terms_json) VALUES (?, ?, 'pkg', 'core_network', 1, 0, ?, 1, 'created', '{}')`);
  item.run('cur', 'perks', 'g3');
  item.run('drf', 'learning', 'g4');
  assert.deepEqual(await standaloneGranted(env, LIC), ['learning', 'mentor-cohorts']);
});

test('review: a program the old term already holds is not "becoming bundled"; accepted price wins; bad index is null', () => {
  const offerOf = (o: any) => ({ package_key: 'core_network', currency: 'EUR', recommendation_json: '{}', accepted_annual_fee_cents: null, ...o });
  const cur = offerOf({ uid: 'cur', state: 'accepted', starts_on: '2026-01-01', ends_on: '2026-12-31', accepted_annual_fee_cents: 100,
    recommended_annual_fee_cents: 100, composition_json: comp('perks'), recommendation_json: rec(1_000_000) });
  const next = offerOf({ uid: 'next', state: 'offered', starts_on: '2027-01-01', ends_on: '2027-12-31', accepted_annual_fee_cents: 250,
    recommended_annual_fee_cents: 200, composition_json: comp('perks', 'learning'), recommendation_json: rec(-5) });
  const r: any = reviewChange({ proposal: next, all: [cur, next], standaloneGranted: ['learning', 'perks'], day: '2026-11-23' });
  assert.deepEqual(r.programs.standalone_becoming_bundled, ['learning']);
  assert.deepEqual([r.price.new_annual_fee_cents, r.price.new_is, r.price.difference_cents], [250, 'accepted', 150]);
  assert.deepEqual(r.country_index, { old_ppm: 1_000_000, new_ppm: null, movement_ppm: null });
});
