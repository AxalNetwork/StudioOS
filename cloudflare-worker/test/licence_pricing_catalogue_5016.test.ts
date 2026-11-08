/**
 * D5016 (#5016) — the 49-market catalogue and its maintenance API.
 *
 * Real SQLite over every migration, the real router. What is pinned:
 *   · all 49 markets exist with ISO2 codes, and no external figure is seeded,
 *     so nothing (and no StartupBlink score) passes for a sourced fact;
 *   · every recorded value has a source and an as-of date, and the history is
 *     append-only;
 *   · profile edits are revision-safe and audited, and a bulk import applies a
 *     country's rows all or none;
 *   · a new observation changes only FUTURE recommendations: an existing
 *     snapshot and the decision made from it still reproduce.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_pricing_catalogue_5016.test.ts
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
import { mount } from '../src/routes/admin_licence_pricing.ts';
import { V1_MODEL_DRAFT } from '../src/services/licencePricing.ts';
import { createSnapshot, verifySnapshot } from '../src/services/licencePricingSnapshots.ts';

const SEED = readFileSync(new URL('../sql/migrations/202611081925_country_catalogue_seed.sql', import.meta.url), 'utf8');
const SECRET = ['d5016', 'catalogue', 'fixture', 'signing', 'secret'].join('-');
const SUPER = 1, SUPER_PW = 2, ADMIN = 3;
const P = '/api/admin/licence-pricing';

const STARTUPBLINK_40 = ['US', 'GB', 'IL', 'CA', 'SG', 'SE', 'DE', 'FR', 'NL', 'CH', 'AU', 'EE', 'CN', 'FI', 'ES', 'LT', 'IE', 'DK', 'IN', 'KR',
  'JP', 'TW', 'AE', 'BE', 'NO', 'AT', 'BR', 'IT', 'PT', 'NZ', 'LU', 'CZ', 'IS', 'PL', 'RU', 'ID', 'BG', 'CO', 'CL', 'TR'];
const EU_27 = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL',
  'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
const ABSENT_EU = EU_27.filter((c) => !STARTUPBLINK_40.includes(c));

function fixture() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const id of [SUPER, SUPER_PW, ADMIN]) u.run(id, 'admin', `Person ${id}`, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER}), (${SUPER_PW})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, ?, datetime('now'))");
  s.run(SUPER, 'totp-super', 'totp');
  s.run(SUPER_PW, 'pw-super', 'password');
  s.run(ADMIN, 'totp-3', 'totp');
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
  const row = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const rev = (code: string) => Number(row('SELECT revision FROM country_market_profiles WHERE country_code = ?', code).revision);
  return { db, env, call, row, rev };
}

const obs = (field: string, value: number, extra: Record<string, unknown> = {}) => ({
  field, value, source: 'World Bank WDI', source_ref: 'SP.POP.TOTL', as_of: '2024-12-31', reason: 'Annual data refresh', ...extra,
});

test('the catalogue: 49 markets with ISO2 codes, 27 EU, no figure seeded, the nine absent EU members told apart', () => {
  const { db } = fixture();
  const rows = db.prepare('SELECT * FROM country_market_profiles ORDER BY country_code').all() as any[];
  assert.equal(rows.length, 49);
  assert.deepEqual(rows.map((r) => r.country_code).sort(), [...new Set([...STARTUPBLINK_40, ...EU_27])].sort());
  for (const r of rows) {
    assert.match(r.country_code, /^[A-Z]{2}$/);
    assert.match(r.currency_code, /^[A-Z]{3}$/);
    for (const [v, st] of [['population', 'population_status'], ['ppp_gdp_per_capita', 'ppp_status'], ['startup_ecosystem_score', 'startup_score_status']]) {
      assert.equal(r[v], null, `${r.country_code}.${v}: nothing is seeded as if it were sourced`);
      assert.equal(r[st], 'not_recorded');
    }
    assert.equal(r.startup_ecosystem_rank, null);
    assert.equal(r.regulatory_class, null, 'a regulatory class is HQ\'s planning call, never seeded');
  }
  assert.deepEqual(rows.filter((r) => r.region_code === 'EU').map((r) => r.country_code).sort(), [...EU_27].sort());
  assert.equal(ABSENT_EU.length, 9);
  for (const c of ABSENT_EU) assert.match(rows.find((r) => r.country_code === c).strategic_note, /not in the StartupBlink top-40/);
  for (const c of STARTUPBLINK_40) assert.match(rows.find((r) => r.country_code === c).strategic_note, /^Listed in the StartupBlink top-40/);
  assert.equal(rows.find((r) => r.country_code === 'BG').currency_code, 'EUR');
  assert.equal(rows.find((r) => r.country_code === 'GB').country_name, 'United Kingdom');
});

test('the seed is re-runnable and never overwrites a profile HQ has edited', () => {
  const { db } = fixture();
  db.exec("UPDATE country_market_profiles SET country_name = 'France (edited)', revision = 3 WHERE country_code = 'FR'");
  db.exec("UPDATE pricing_models SET note = 'edited draft' WHERE uid = 'pricing-model-v1-seed'");
  db.exec(SEED);
  assert.equal(db.prepare("SELECT country_name FROM country_market_profiles WHERE country_code = 'FR'").get()!.country_name, 'France (edited)');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM country_market_profiles').get() as any).n, 49);
  assert.equal(db.prepare("SELECT note FROM pricing_models WHERE uid = 'pricing-model-v1-seed'").get()!.note, 'edited draft');
});

test('the seeded v1 draft is exactly the engine\'s V1_MODEL_DRAFT', () => {
  const { db } = fixture();
  const m = db.prepare("SELECT * FROM pricing_models WHERE uid = 'pricing-model-v1-seed'").get() as any;
  assert.equal(m.status, 'draft', 'HQ activates it; nothing is priced on a model nobody chose');
  const { normalization, regulatory_surcharge, tier_thresholds, ...scalars } = V1_MODEL_DRAFT as any;
  for (const [k, v] of Object.entries(scalars)) assert.equal(m[k], v, k);
  assert.deepEqual(JSON.parse(m.normalization_json), normalization);
  assert.deepEqual(JSON.parse(m.regulatory_surcharge_json), regulatory_surcharge);
  assert.deepEqual(JSON.parse(m.tier_thresholds_json), tier_thresholds);
});

test('an observation needs a source, an as-of date, a reason and the revision read; it is history, not an overwrite', async () => {
  const { db, call, rev } = fixture();
  const at = `${P}/countries/FR/observations`;
  assert.equal((await call(SUPER, 'POST', at, { ...obs('population', 68_400_000), expected_revision: 0, reason: '' })).body.error, 'reason_required');
  assert.equal((await call(SUPER, 'POST', at, obs('population', 68_400_000))).body.error, 'expected_revision_required');
  const bad = await call(SUPER, 'POST', at, { ...obs('population', 68.4, { source: '', as_of: 'last year' }), expected_revision: 0 });
  assert.deepEqual(Object.keys(bad.body.fields).sort(), ['as_of', 'source', 'value']);
  const ok = await call(SUPER, 'POST', at, { ...obs('population', 68_400_000), expected_revision: 0 });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.profile.population, ok.body.profile.population_status, ok.body.profile.population_source, ok.body.profile.population_as_of, ok.body.profile.revision],
    [68_400_000, 'recorded', 'World Bank WDI', '2024-12-31', 1]);
  // A stale write changes nothing and says which revision is current.
  const stale = await call(SUPER, 'POST', at, { ...obs('population', 1), expected_revision: 0 });
  assert.equal(stale.status, 409);
  assert.deepEqual([stale.body.error, stale.body.current_revision], ['profile_conflict', 1]);
  assert.equal(rev('FR'), 1);
  // Replaced, not overwritten: both values stay in the history.
  await call(SUPER, 'POST', at, { ...obs('population', 68_600_000, { as_of: '2025-12-31' }), expected_revision: 1 });
  const hist = (await call(SUPER, 'GET', `${P}/countries/FR/observations?field=population`)).body.observations;
  assert.deepEqual(hist.map((o: any) => [o.value, o.as_of, o.profile_revision, o.recorded_by, o.reason]),
    [[68_600_000, '2025-12-31', 2, 'user:1', 'Annual data refresh'], [68_400_000, '2024-12-31', 1, 'user:1', 'Annual data refresh']]);
  assert.throws(() => db.exec("DELETE FROM country_market_observations WHERE country_code = 'FR'"), /append-only/);
  assert.throws(() => db.exec("INSERT INTO country_market_observations (uid, country_code, field, kind, value, status, recorded_by, reason, profile_revision) VALUES ('x', 'FR', 'population', 'value', 5, 'recorded', 'u', 'why', 9)"), /CHECK/, 'the database refuses a value without a source');
  const audited = db.prepare("SELECT filters_json FROM admin_audit_log WHERE action = 'licence_pricing_observation_recorded' ORDER BY id").all() as any[];
  assert.equal(audited.length, 2);
  assert.equal(JSON.parse(audited[0].filters_json).reason, 'Annual data refresh');
});

test('provisional is HQ\'s explicit act on an existing value; not recorded clears the value and its provenance', async () => {
  const { call } = fixture();
  const st = (body: unknown) => call(SUPER, 'PUT', `${P}/countries/MT/fields/startup_ecosystem_score/status`, body);
  assert.equal((await st({ status: 'provisional', expected_revision: 0, reason: 'Proxy approved by HQ' })).body.error, 'no_value');
  await call(SUPER, 'POST', `${P}/countries/MT/observations`, { ...obs('startup_ecosystem_score', 4_200, { source: 'HQ proxy: regional median', status: 'provisional' }), expected_revision: 0, reason: 'Proxy approved by HQ' });
  let p = (await call(SUPER, 'GET', `${P}/countries/MT`)).body.profile;
  assert.deepEqual([p.startup_ecosystem_score, p.startup_score_status], [4_200, 'provisional']);
  const cleared = await st({ status: 'not_recorded', expected_revision: 1, reason: 'Proxy withdrawn' });
  p = cleared.body.profile;
  assert.deepEqual([p.startup_ecosystem_score, p.startup_score_status, p.startup_source, p.startup_as_of, p.revision], [null, 'not_recorded', null, null, 2]);
  assert.equal((await call(SUPER, 'PUT', `${P}/countries/MT/fields/startup_ecosystem_rank/status`, { status: 'provisional', expected_revision: 2, reason: 'x y z' })).body.error, 'invalid_status');
  assert.equal((await call(SUPER, 'PUT', `${P}/countries/MT/fields/gdp/status`, { status: 'not_recorded', expected_revision: 2, reason: 'x y z' })).status, 404);
});

test('profile details are revision-checked; the regulatory class is HQ\'s planning input', async () => {
  const { call } = fixture();
  const r = await call(SUPER, 'PATCH', `${P}/countries/DE`, { regulatory_class: 'medium', regulatory_note: 'Commercial planning note.', expected_revision: 0, reason: 'Planning review' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.profile.regulatory_class, r.body.profile.revision], ['medium', 1]);
  assert.equal((await call(SUPER, 'PATCH', `${P}/countries/DE`, { regulatory_class: 'severe', expected_revision: 1, reason: 'Planning review' })).body.error, 'invalid_profile');
  assert.equal((await call(SUPER, 'PATCH', `${P}/countries/DE`, { strategic_note: 'x', expected_revision: 0, reason: 'Planning review' })).status, 409);
});

test('a bulk import applies each country all or none against the revision HQ read', async () => {
  const { db, call, rev } = fixture();
  // Someone else writes France once, so France is at revision 1.
  await call(SUPER, 'POST', `${P}/countries/FR/observations`, { ...obs('population', 68_400_000), expected_revision: 0 });
  const rows = [
    { country_code: 'FR', ...obs('ppp_gdp_per_capita', 60_000, { source: 'IMF WEO' }) }, // expects FR rev 0: stale
    { country_code: 'FR', ...obs('startup_ecosystem_score', 33_100, { source: 'StartupBlink' }) }, // would expect rev 1 — which IS current
    { country_code: 'DE', ...obs('population', 83_300_000) },
    { country_code: 'DE', ...obs('ppp_gdp_per_capita', 70_000, { source: 'IMF WEO' }) },
  ].map(({ reason: _drop, ...r }) => r);
  const res = await call(SUPER, 'POST', `${P}/countries/import`, { observations: rows, expected_revisions: { FR: 0, DE: 0 }, reason: 'Annual data refresh' });
  assert.equal(res.status, 207, JSON.stringify(res.body));
  assert.deepEqual(res.body.applied, { DE: 2 });
  assert.deepEqual(res.body.conflicts, [{ country_code: 'FR', current_revision: 1 }]);
  assert.equal(rev('FR'), 1, 'France\'s second row did not apply on the revision it happened to match');
  assert.equal(db.prepare("SELECT startup_ecosystem_score FROM country_market_profiles WHERE country_code = 'FR'").get()!.startup_ecosystem_score, null);
  assert.equal(rev('DE'), 2);
  // A row with a problem stops the whole import before anything is written.
  const bad = await call(SUPER, 'POST', `${P}/countries/import`, { observations: [{ country_code: 'DE', ...obs('population', 1, { source: '' }) }], expected_revisions: { DE: 2 }, reason: 'Annual data refresh' });
  assert.deepEqual([bad.status, bad.body.error, bad.body.rows[0].row], [400, 'invalid_import', 0]);
  assert.equal(rev('DE'), 2);
  assert.equal((await call(SUPER, 'POST', `${P}/countries/import`, { observations: [{ country_code: 'ES', ...obs('population', 48_000_000) }], expected_revisions: {}, reason: 'Annual data refresh' })).body.error, 'expected_revision_required');
});

test('a new observation changes only future recommendations; the old snapshot and its decision still reproduce', async () => {
  const { db, env, call } = fixture();
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, currency) VALUES (1, 'lic_5016', 'AXL-5016', 'L', 'B', 'active', 'EUR')`).run();
  for (const [f, v, src] of [['population', 68_400_000, 'World Bank WDI'], ['ppp_gdp_per_capita', 60_000, 'IMF WEO'], ['startup_ecosystem_score', 33_100, 'StartupBlink']] as const) {
    const cur = (await call(SUPER, 'GET', `${P}/countries/FR`)).body.profile.revision;
    assert.equal((await call(SUPER, 'POST', `${P}/countries/FR/observations`, { ...obs(f, v, { source: src }), expected_revision: cur })).status, 201);
  }
  assert.equal((await call(SUPER, 'POST', `${P}/countries/FR/preview`, {})).body.error, 'no_active_model');
  const draftPreview = await call(SUPER, 'POST', `${P}/countries/FR/preview`, { model_uid: 'pricing-model-v1-seed' });
  assert.equal(draftPreview.status, 200, JSON.stringify(draftPreview.body));
  assert.equal(draftPreview.body.stored, false);
  assert.equal(draftPreview.body.recommendation.available, true);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM country_pricing_snapshots').get() as any).n, 0, 'a preview stores nothing');
  assert.equal((await call(SUPER, 'POST', `${P}/models/pricing-model-v1-seed/activate`, { reason: 'Launch v1 pricing' })).status, 200);

  const snap = await createSnapshot(env, { modelUid: 'pricing-model-v1-seed', countryCode: 'FR', actor: 'user:1' });
  db.prepare(`INSERT INTO licence_pricing_decisions (uid, licence_uid, snapshot_uid, currency, recommended_annual_fee_cents, accepted_annual_fee_cents,
      decision, effective_from, created_by) VALUES ('d1', 'lic_5016', ?, 'EUR', ?, ?, 'accepted', '2027-01-01', 'user:1')`)
    .run(snap.uid, snap.recommendation.recommended_annual_fee_cents, snap.recommendation.recommended_annual_fee_cents);
  const licenceBefore = { ...(db.prepare("SELECT * FROM territory_licences WHERE uid = 'lic_5016'").get() as any) };

  const cur = (await call(SUPER, 'GET', `${P}/countries/FR`)).body.profile.revision;
  await call(SUPER, 'POST', `${P}/countries/FR/observations`, { ...obs('ppp_gdp_per_capita', 48_000, { source: 'IMF WEO', as_of: '2025-12-31' }), expected_revision: cur });
  const next = await call(SUPER, 'POST', `${P}/countries/FR/preview`, {});
  assert.notEqual(next.body.source_digest, snap.source_digest, 'the next recommendation sees the new value');
  assert.ok(next.body.recommendation.country_index < snap.recommendation.country_index!);
  assert.equal((await verifySnapshot(env, snap.uid)).matches, true, 'the old snapshot still reproduces from its own columns');
  const d = (await call(SUPER, 'GET', '/api/admin/licences/lic_5016/pricing-decisions')).body.decisions[0];
  assert.deepEqual([d.accepted.annual_fee_cents, d.snapshot.source_digest], [snap.recommendation.recommended_annual_fee_cents, snap.source_digest]);
  assert.deepEqual({ ...(db.prepare("SELECT * FROM territory_licences WHERE uid = 'lic_5016'").get() as any) }, licenceBefore, 'a profile change never edits a licence');
});

test('writes need the write bar; previews and reads need Super Admin', async () => {
  const { call } = fixture();
  const w = await call(SUPER_PW, 'POST', `${P}/countries/FR/observations`, { ...obs('population', 1), expected_revision: 0 });
  assert.ok(w.status === 401 || w.status === 403, String(w.status));
  assert.equal((await call(SUPER_PW, 'POST', `${P}/countries/FR/preview`, { model_uid: 'pricing-model-v1-seed' })).status, 200);
  assert.equal((await call(ADMIN, 'POST', `${P}/countries/FR/preview`, {})).status, 403);
  assert.equal((await call(ADMIN, 'GET', `${P}/countries/FR/observations`)).status, 403);
  assert.equal((await call(SUPER, 'GET', `${P}/countries`)).body.total, 49);
});
