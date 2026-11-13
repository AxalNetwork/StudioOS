/**
 * D5014 (#5014) — the country-pricing schema and its Super Admin routes.
 *
 * Real SQLite over every migration (`_schema_once.mjs`), the real router. What is
 * pinned is what the issue's acceptance criteria name:
 *   · the migration is additive and re-runnable, and changes no licence, invoice
 *     or program-grant row;
 *   · an active pricing model is immutable, at the route AND at the database;
 *   · snapshots and decisions are append-only, so history survives later changes;
 *   · not recorded is NULL with its status, never 0, and money, rates and indexes
 *     are integers (a float is refused by the schema, not just avoided by code).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_pricing_schema_5014.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import pricing, { mount } from '../src/routes/admin_licence_pricing.ts';
import { validateModelInput } from '../src/services/licencePricingStore.ts';

const MIGRATION = readFileSync(new URL('../sql/migrations/202611081906_country_pricing_schema.sql', import.meta.url), 'utf8');
const SECRET = ['d5014', 'pricing', 'fixture', 'signing', 'secret'].join('-');
const SUPER = 1, SUPER_PW = 2, ADMIN = 3;
const LIC = 'lic_5014';

const MODEL = {
  version: 'v1', currency: 'EUR', reference_annual_fee_cents: 5_000_000, reference_initial_fee_cents: 5_000_000,
  default_royalty_bps: 600, minimum_royalty_ratio_bps: 4000,
  weight_purchasing_power_bps: 4000, weight_startup_ecosystem_bps: 3500, weight_market_size_bps: 2500,
  normalization: { ppp_reference: 65000 }, regulatory_surcharge: { low: 0, medium: 500000 }, tier_thresholds: [{ tier: 'A', min_index: 900000 }],
  effective_from: '2026-12-01',
};

function fixture() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  // D5016 seeds the 49-market catalogue and a v1 draft; these cases build their own, so they start empty.
  db.exec("DELETE FROM country_market_profiles; DELETE FROM pricing_models WHERE status = 'draft'");
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const id of [SUPER, SUPER_PW, ADMIN]) u.run(id, 'admin', `Person ${id}`, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${SUPER_PW})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now'))");
  s.run(SUPER, 'totp-super', 'totp');
  s.run(SUPER_PW, 'pw-super', 'password');
  s.run(ADMIN, 'totp-3', 'totp');
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years,
      annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
    VALUES (1, ?, 'AXL-5014', 'Licensee', 'Brand', 'active', 3, 1000000, 'EUR', 3000, 5000, '2025-01-01', '2027-01-01')`).run(LIC);
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  for (const m of mount) app.route(m.path, m.router);
  app.onError((err: any, c) => {
    const status = ({ Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>)[String(err?.message || '')];
    if (status) return c.json({ detail: err.message }, status);
    throw err;
  });
  async function call(who: number, method: string, path: string, body?: unknown) {
    const jti = who === SUPER ? 'totp-super' : who === SUPER_PW ? 'pw-super' : `totp-${who}`;
    const token = await new SignJWT({ user_id: who, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, env));
      let json: any = null; try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    } finally { [console.warn, console.error] = saved; }
  }
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  return { db, env, call, all };
}
const P = '/api/admin/licence-pricing';

test('the migration is additive and re-runnable, and changes no licence, invoice or grant row', () => {
  const { db, all } = fixture();
  db.prepare(`INSERT INTO licence_fee_invoices (uid, licence_uid, period_label, period_start, period_end, amount_cents, currency,
      reference, issued_at, due_at, status, figures_json, figures_sha256)
    VALUES ('inv_1', ?, '2026–27', '2026-01-01', '2026-12-31', 1000000, 'EUR', 'REF-1', '2026-11-01', '2026-12-01', 'issued', '{}', 'x')`).run(LIC);
  const before = { l: all('SELECT * FROM territory_licences'), i: all('SELECT * FROM licence_fee_invoices'), g: all('SELECT * FROM program_grants') };
  db.exec(MIGRATION);
  db.exec(MIGRATION);
  assert.deepEqual({ l: all('SELECT * FROM territory_licences'), i: all('SELECT * FROM licence_fee_invoices'), g: all('SELECT * FROM program_grants') }, before);
  // Additive: outside its triggers' bodies it only creates.
  const outside = MIGRATION.replace(/--[^\n]*/g, '').replace(/CREATE\s+TRIGGER[\s\S]*?\bEND\s*;/gi, '');
  for (const stmt of outside.split(';').map((x) => x.trim()).filter(Boolean)) {
    assert.match(stmt, /^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS /, stmt.slice(0, 80));
  }
});

test('the model body is validated whole: weights must sum to 10000, money is a non-negative integer', () => {
  assert.equal(validateModelInput(MODEL).ok, true);
  const bad = validateModelInput({ ...MODEL, weight_market_size_bps: 2400, reference_annual_fee_cents: 12.5, effective_from: 'soon' });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys((bad as any).errors).sort(), ['effective_from', 'reference_annual_fee_cents', 'weights']);
  assert.match((bad as any).errors.weights, /sum to 9900/);
  const v = validateModelInput({ ...MODEL, fee_rounding_cents: undefined });
  assert.equal((v as any).value.fee_rounding_cents, 250000, 'EUR 2,500 is the default commercial increment');
});

test('an active model is immutable at the route and at the database; the next version retires it', async () => {
  const { db, call } = fixture();
  const created = await call(SUPER, 'POST', `${P}/models`, MODEL);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const uid = created.body.model.uid;
  assert.equal(created.body.model.status, 'draft');
  // A draft may be edited.
  const edited = await call(SUPER, 'PUT', `${P}/models/${uid}`, { ...MODEL, default_royalty_bps: 650 });
  assert.equal(edited.body.model.default_royalty_bps, 650);
  assert.equal((await call(SUPER, 'POST', `${P}/models/${uid}/activate`, {})).body.error, 'reason_required');
  const act = await call(SUPER, 'POST', `${P}/models/${uid}/activate`, { reason: 'Launch pricing' });
  assert.equal(act.status, 200, JSON.stringify(act.body));
  assert.equal(act.body.model.status, 'active');
  const refused = await call(SUPER, 'PUT', `${P}/models/${uid}`, { ...MODEL, default_royalty_bps: 700 });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'pricing_model_immutable');
  // The database refuses it too, whoever writes.
  assert.throws(() => db.prepare('UPDATE pricing_models SET weight_market_size_bps = 2600, weight_purchasing_power_bps = 3900 WHERE uid = ?').run(uid), /pricing_model_immutable/);
  assert.throws(() => db.prepare("UPDATE pricing_models SET status = 'draft' WHERE uid = ?").run(uid), /pricing_model_immutable/);
  assert.throws(() => db.prepare('DELETE FROM pricing_models WHERE uid = ?').run(uid), /pricing_model_immutable/);
  assert.equal((await call(SUPER, 'DELETE', `${P}/models/${uid}`, { reason: 'tidy up' })).status, 409);
  // A second version activates and retires the first in one step: never two active.
  const v2 = (await call(SUPER, 'POST', `${P}/models`, { ...MODEL, version: 'v2' })).body.model.uid;
  const a2 = await call(SUPER, 'POST', `${P}/models/${v2}/activate`, { reason: 'Annual review' });
  assert.equal(a2.body.retired_model_uid, uid);
  const list = (await call(SUPER, 'GET', `${P}/models`)).body.models;
  assert.deepEqual(list.map((m: any) => [m.version, m.status]), [['v2', 'active'], ['v1', 'retired']]);
  assert.throws(() => db.prepare("UPDATE pricing_models SET status = 'active' WHERE uid = ?").run(uid), /pricing_model_immutable/, 'a retired model never comes back');
  assert.equal((await call(SUPER, 'POST', `${P}/models`, { ...MODEL, version: 'v2' })).body.error, 'version_taken');
  // Every write was audited with its reason.
  const audited = db.prepare("SELECT action, filters_json FROM admin_audit_log WHERE action LIKE 'licence_pricing_model_%' ORDER BY id").all() as any[];
  assert.deepEqual(audited.map((r) => r.action), ['licence_pricing_model_drafted', 'licence_pricing_model_edited', 'licence_pricing_model_activated', 'licence_pricing_model_drafted', 'licence_pricing_model_activated']);
  assert.equal(JSON.parse(audited[2].filters_json).reason, 'Launch pricing');
});

test('the database refuses weights that do not sum to 10000, a second active model, and float money', () => {
  const { db } = fixture();
  const ins = (uid: string, version: string, status: string, ppp: number, annual: number) => db.prepare(
    `INSERT INTO pricing_models (uid, version, status, reference_annual_fee_cents, reference_initial_fee_cents, default_royalty_bps,
       minimum_royalty_ratio_bps, weight_purchasing_power_bps, weight_startup_ecosystem_bps, weight_market_size_bps, effective_from)
     VALUES (?, ?, ?, ?, 0, 600, 4000, ?, 3500, 2500, '2026-12-01')`).run(uid, version, status, annual, ppp);
  assert.throws(() => ins('m0', 'bad', 'draft', 3000, 100), /CHECK/);
  ins('m1', 'a', 'active', 4000, 100);
  assert.throws(() => ins('m2', 'b', 'active', 4000, 100), /UNIQUE/);
  assert.throws(() => ins('m3', 'c', 'draft', 4000, 100.5), /CHECK/);
});

test('snapshots and decisions are append-only; an override says why', () => {
  const { db } = fixture();
  db.exec(`INSERT INTO pricing_models (uid, version, status, reference_annual_fee_cents, reference_initial_fee_cents, default_royalty_bps,
      minimum_royalty_ratio_bps, weight_purchasing_power_bps, weight_startup_ecosystem_bps, weight_market_size_bps, effective_from)
    VALUES ('m1', 'v1', 'active', 5000000, 5000000, 600, 4000, 4000, 3500, 2500, '2026-12-01')`);
  db.exec(`INSERT INTO country_pricing_snapshots (uid, country_code, pricing_model_uid, pricing_model_version, population_status, ppp_status,
      startup_score_status, profile_revision, complete, country_index, recommended_annual_fee_cents, currency, source_digest)
    VALUES ('s1', 'FR', 'm1', 'v1', 'recorded', 'recorded', 'recorded', 3, 1, 1000000, 5000000, 'EUR', 'sha256:abc')`);
  assert.throws(() => db.exec("UPDATE country_pricing_snapshots SET recommended_annual_fee_cents = 1 WHERE uid = 's1'"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM country_pricing_snapshots WHERE uid = 's1'"), /append-only/);
  assert.throws(() => db.exec(`INSERT INTO country_pricing_snapshots (uid, country_code, pricing_model_uid, pricing_model_version, population_status,
      ppp_status, startup_score_status, profile_revision, complete, country_index, currency, source_digest)
    VALUES ('s2', 'FR', 'm1', 'v1', 'recorded', 'recorded', 'recorded', 3, 1, 0.97, 'EUR', 'x')`), /CHECK/, 'an index is millionths, never a float');
  const decide = (uid: string, decision: string, reason: string | null) => db.prepare(
    `INSERT INTO licence_pricing_decisions (uid, licence_uid, snapshot_uid, currency, recommended_annual_fee_cents,
       accepted_annual_fee_cents, decision, override_reason, effective_from, created_by)
     VALUES (?, ?, 's1', 'EUR', 5000000, 4500000, ?, ?, '2027-01-01', 'user:1')`).run(uid, LIC, decision, reason);
  assert.throws(() => decide('d0', 'overridden', '  '), /CHECK/);
  decide('d1', 'overridden', 'Launch discount agreed with the board');
  assert.throws(() => db.exec("UPDATE licence_pricing_decisions SET accepted_annual_fee_cents = 1 WHERE uid = 'd1'"), /append-only/);
  assert.throws(() => db.exec("DELETE FROM licence_pricing_decisions WHERE uid = 'd1'"), /append-only/);
  // A later model change touches neither: the snapshot keeps its version and figures.
  db.exec("UPDATE pricing_models SET status = 'retired', retired_at = datetime('now') WHERE uid = 'm1'");
  assert.deepEqual({ ...(db.prepare("SELECT pricing_model_version, recommended_annual_fee_cents FROM country_pricing_snapshots WHERE uid = 's1'").get() as any) },
    { pricing_model_version: 'v1', recommended_annual_fee_cents: 5000000 });
});

test('not recorded is NULL with its status, never 0, and a status cannot claim a value that is not there', async () => {
  const { db, call } = fixture();
  db.exec("INSERT INTO country_market_profiles (country_code, country_name) VALUES ('MT', 'Malta')");
  db.exec(`INSERT INTO country_market_profiles (country_code, country_name, population, population_status, population_source, population_as_of)
    VALUES ('FR', 'France', 68400000, 'recorded', 'World Bank WDI', '2024-12-31')`);
  assert.throws(() => db.exec("INSERT INTO country_market_profiles (country_code, country_name, startup_score_status) VALUES ('CY', 'Cyprus', 'provisional')"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO country_market_profiles (country_code, country_name) VALUES ('fr', 'lower')"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO country_market_profiles (country_code, country_name, population, population_status) VALUES ('DE', 'Germany', 83.2, 'recorded')"), /CHECK/);
  const mt = (await call(SUPER, 'GET', `${P}/countries/mt`)).body.profile;
  assert.equal(mt.population, null);
  assert.equal(mt.population_status, 'not_recorded');
  assert.equal(mt.startup_ecosystem_score, null);
  const list = await call(SUPER, 'GET', `${P}/countries?incomplete=1`);
  assert.deepEqual(list.body.countries.map((c: any) => c.country_code), ['FR', 'MT'], 'France still lacks PPP and a startup score');
  assert.deepEqual((await call(SUPER, 'GET', `${P}/countries?q=fra`)).body.countries.map((c: any) => c.country_code), ['FR']);
  assert.equal((await call(SUPER, 'GET', `${P}/countries/XYZ`)).body.error, 'invalid_country');
  assert.equal((await call(SUPER, 'GET', `${P}/countries/ES`)).status, 404);
});

test('a licence\'s pricing decisions read with the snapshot each was made from', async () => {
  const { db, call } = fixture();
  db.exec(`INSERT INTO pricing_models (uid, version, status, reference_annual_fee_cents, reference_initial_fee_cents, default_royalty_bps,
      minimum_royalty_ratio_bps, weight_purchasing_power_bps, weight_startup_ecosystem_bps, weight_market_size_bps, effective_from)
    VALUES ('m1', 'v1', 'active', 5000000, 5000000, 600, 4000, 4000, 3500, 2500, '2026-12-01')`);
  db.exec(`INSERT INTO country_pricing_snapshots (uid, country_code, pricing_model_uid, pricing_model_version, population_status, ppp_status,
      startup_score_status, profile_revision, complete, recommended_annual_fee_cents, currency, source_digest)
    VALUES ('s1', 'FR', 'm1', 'v1', 'recorded', 'recorded', 'recorded', 3, 1, 5000000, 'EUR', 'sha256:abc')`);
  db.exec(`INSERT INTO licence_pricing_decisions (uid, licence_uid, snapshot_uid, currency, recommended_annual_fee_cents,
      accepted_annual_fee_cents, decision, effective_from, created_by)
    VALUES ('d1', '${LIC}', 's1', 'EUR', 5000000, 5000000, 'accepted', '2027-01-01', 'user:1')`);
  const r = await call(SUPER, 'GET', `/api/admin/licences/${LIC}/pricing-decisions`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.decisions.length, 1);
  const d = r.body.decisions[0];
  assert.deepEqual([d.decision, d.accepted.annual_fee_cents, d.recommended.initial_fee_cents], ['accepted', 5000000, null]);
  assert.deepEqual(d.snapshot, { pricing_model_version: 'v1', country_code: 'FR', source_digest: 'sha256:abc' });
  assert.equal((await call(SUPER, 'GET', '/api/admin/licences/lic_none/pricing-decisions')).status, 404);
  const snaps = (await call(SUPER, 'GET', `${P}/countries/FR`)).status;
  assert.equal(snaps, 404, 'a snapshot is not a profile: France has no profile row here');
});

test('Super Admin only; writes need the write bar (TOTP session and recent step-up)', async () => {
  const { call } = fixture();
  assert.equal((await call(ADMIN, 'GET', `${P}/models`)).status, 403, 'a plain admin is refused');
  assert.equal((await call(SUPER_PW, 'GET', `${P}/models`)).status, 200, 'reads need Super Admin only');
  const w = await call(SUPER_PW, 'POST', `${P}/models`, MODEL);
  assert.ok(w.status === 401 || w.status === 403, `a password session cannot write: ${w.status}`);
  assert.equal((await call(ADMIN, 'GET', `/api/admin/licences/${LIC}/pricing-decisions`)).status, 403);
  assert.equal(pricing, mount[0].router);
});
