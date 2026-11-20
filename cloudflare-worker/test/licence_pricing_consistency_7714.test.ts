/**
 * D7714 (#7714) — the country catalogue consistency read, and the import the
 * builder makes, over real SQLite (every migration, the 49 seeded markets) and
 * the real routers. Synthetic figures only.
 *
 * What is pinned:
 *   · after route writes only (a value, a provisional mark, a not-recorded mark,
 *     a details-only edit, an import) the read reports nothing and says how many
 *     countries and fields it checked;
 *   · a value planted with no history row is named, and nothing else is; a value
 *     changed by hand on a field with history is named; a cleared field whose
 *     history holds a value, and a history row above the profile's revision, are
 *     named; a rank is compared on its value only;
 *   · a finding lists the frozen snapshot that holds the value, and the decision
 *     made from it; the read writes no row;
 *   · Super Admin on HQ only;
 *   · one import of two fields for every seeded country leaves no finding;
 *   · the builder's body is accepted whole by the import route, a second run on
 *     the re-read catalogue builds nothing, and a reported field is kept even
 *     when unchanged, which repairs it (the owner's answer B).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_pricing_consistency_7714.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount as hqMount } from '../src/routes/admin_licence_pricing_hq.ts';
import { mount as pricingMount } from '../src/routes/admin_licence_pricing.ts';
import { OBSERVED_FIELDS, validateObservation } from '../src/services/licencePricingCatalogue.ts';
import { createSnapshot } from '../src/services/licencePricingSnapshots.ts';
import {
  OBSERVED_FIELDS as BUILDER_FIELDS, buildCountryImport, parseCatalogue, parseConsistency,
} from '../../scripts/lib/countryImport.mjs';

const SECRET = ['d7714', 'consistency', 'fixture', 'signing', 'secret'].join('-');
const SUPER = 1, ADMIN = 3;
const P = '/api/admin/licence-pricing';
const READ = `${P}/consistency`;
const REASON = 'Synthetic data refresh';

function fixture(opts: { branch?: string } = {}) {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const id of [SUPER, ADMIN]) u.run(id, 'admin', `Person ${id}`, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  s.run(SUPER, 'totp-1'); s.run(ADMIN, 'totp-3');
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', ...(opts.branch ? { BRANCH_CODE: opts.branch } : {}) } as any;
  const app = new Hono<any>();
  for (const m of [...hqMount, ...pricingMount]) app.route(m.path, m.router);
  app.onError((err: any, c) => {
    const status = ({ Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>)[String(err?.message || '')];
    if (status) return c.json({ detail: err.message }, status);
    throw err;
  });
  async function call(who: number | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who !== null) {
      headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
    }
    const saved = [console.warn, console.error, console.info];
    console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env));
      let json: any = null; try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  const all = (sql: string, ...a: any[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  const rev = (code: string) => Number((db.prepare('SELECT revision FROM country_market_profiles WHERE country_code = ?').get(code) as any).revision);
  const record = async (code: string, field: string, value: number, extra: Record<string, unknown> = {}) => {
    const r = await call(SUPER, 'POST', `${P}/countries/${code}/observations`, {
      field, value, source: 'Synthetic source', source_ref: 'SYN-1', as_of: '2024-12-31', reason: REASON, expected_revision: rev(code), ...extra,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  };
  const read = async () => {
    const r = await call(SUPER, 'GET', READ);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  return { db, env, call, all, rev, record, read };
}
type F = ReturnType<typeof fixture>;

const TABLES = ['country_market_profiles', 'country_market_observations', 'country_pricing_snapshots', 'licence_pricing_decisions', 'pricing_models', 'admin_audit_log'];
const everything = (f: F) => Object.fromEntries(TABLES.map((t) => [t, f.all(`SELECT * FROM ${t}`)]));
const named = (body: any) => body.findings.map((x: any) => `${x.country_code}:${x.field}:${x.kind}`);

test('after route writes only, the read reports nothing and says how much it checked', async () => {
  const f = fixture();
  await f.record('FR', 'population', 68_000_000);
  await f.record('FR', 'ppp_gdp_per_capita', 50_000, { source_ref: null });
  await f.record('FR', 'startup_ecosystem_score', 30_000, { source: 'Synthetic score list' });
  // A rank's source differs from the score's; the profile holds only the score's, and that is no finding.
  await f.record('FR', 'startup_ecosystem_rank', 9, { source: 'Synthetic rank list', as_of: '2025-01-01' });
  assert.equal((await f.call(SUPER, 'PUT', `${P}/countries/FR/fields/ppp_gdp_per_capita/status`, { status: 'provisional', reason: REASON, expected_revision: f.rev('FR') })).status, 200);
  await f.record('DE', 'population', 84_000_000);
  assert.equal((await f.call(SUPER, 'PUT', `${P}/countries/DE/fields/population/status`, { status: 'not_recorded', reason: REASON, expected_revision: f.rev('DE') })).status, 200);
  await f.record('DE', 'population', 83_000_000, { status: 'provisional' });
  assert.equal((await f.call(SUPER, 'PUT', `${P}/countries/DE/fields/population/status`, { status: 'provisional', reason: REASON, expected_revision: f.rev('DE') })).status, 200);
  assert.equal((await f.call(SUPER, 'PATCH', `${P}/countries/FR`, { regulatory_class: 'medium', reason: REASON, expected_revision: f.rev('FR') })).status, 200);
  const imp = await f.call(SUPER, 'POST', `${P}/countries/import`, {
    observations: [
      { country_code: 'BE', field: 'population', value: 11_700_000, status: 'recorded', source: 'Synthetic source', as_of: '2024-12-31' },
      { country_code: 'BE', field: 'startup_ecosystem_rank', value: 20, status: 'recorded', source: 'Synthetic rank list', as_of: '2024-12-31' },
    ],
    expected_revisions: { BE: f.rev('BE') }, reason: REASON,
  });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  const body = await f.read();
  assert.deepEqual(body.findings, []);
  assert.equal(body.total, 0);
  assert.deepEqual(body.checked, { countries: 49, fields_per_country: 4, fields: 196, field_names: [...OBSERVED_FIELDS] });
  assert.equal(body.stored, false);
});

test('a value planted with no history row is named, and nothing else is', async () => {
  const f = fixture();
  await f.record('FR', 'population', 68_000_000);
  f.db.exec("UPDATE country_market_profiles SET ppp_gdp_per_capita = 50000, ppp_status = 'recorded', ppp_source = 'Planted', ppp_as_of = '2024-12-31' WHERE country_code = 'IT'");
  const body = await f.read();
  assert.deepEqual(named(body), ['IT:ppp_gdp_per_capita:value_without_history']);
  const x = body.findings[0];
  assert.deepEqual([x.profile.value, x.profile.status, x.profile.source, x.history, x.expected], [50_000, 'recorded', 'Planted', null, null]);
  assert.equal(body.counts.value_without_history, 1);
  assert.equal(body.checked.countries, 49);
});

test('a value changed by hand on a field with older history is named, with what differs', async () => {
  const f = fixture();
  await f.record('FR', 'population', 68_000_000);
  await f.record('FR', 'population', 68_400_000, { as_of: '2025-06-30' });
  f.db.exec("UPDATE country_market_profiles SET population = 70000000 WHERE country_code = 'FR'");
  const body = await f.read();
  assert.deepEqual(named(body), ['FR:population:differs_from_history']);
  assert.deepEqual(body.findings[0].differences, ['value']);
  assert.deepEqual([body.findings[0].profile.value, body.findings[0].expected.value, body.findings[0].history.as_of], [70_000_000, 68_400_000, '2025-06-30']);
  f.db.exec("UPDATE country_market_profiles SET population = 68400000, population_source = 'Edited', population_as_of = '2025-07-01' WHERE country_code = 'FR'");
  assert.deepEqual((await f.read()).findings[0].differences, ['source', 'as_of']);
  f.db.exec("UPDATE country_market_profiles SET population_source = 'Synthetic source', population_as_of = '2025-06-30', population_source_ref = 'SYN-2' WHERE country_code = 'FR'");
  assert.deepEqual((await f.read()).findings[0].differences, ['source_ref']);
  f.db.exec("UPDATE country_market_profiles SET population_source_ref = 'SYN-1', population_status = 'provisional' WHERE country_code = 'FR'");
  assert.deepEqual((await f.read()).findings[0].differences, ['status']);
});

test('a provisional mark keeps the provenance the last value row set, unless a not-recorded mark cleared it since', async () => {
  const f = fixture();
  await f.record('FR', 'population', 68_000_000);
  assert.equal((await f.call(SUPER, 'PUT', `${P}/countries/FR/fields/population/status`, { status: 'provisional', reason: REASON, expected_revision: f.rev('FR') })).status, 200);
  f.db.exec("UPDATE country_market_profiles SET population_source = 'Edited' WHERE country_code = 'FR'");
  assert.deepEqual((await f.read()).findings.map((x: any) => [x.kind, x.differences, x.expected.source]), [['differs_from_history', ['source'], 'Synthetic source']]);
  // DE: recorded, then cleared, then a value planted by hand with the old provenance and marked provisional.
  await f.record('DE', 'population', 84_000_000);
  assert.equal((await f.call(SUPER, 'PUT', `${P}/countries/DE/fields/population/status`, { status: 'not_recorded', reason: REASON, expected_revision: f.rev('DE') })).status, 200);
  f.db.exec("UPDATE country_market_profiles SET population = 84000000, population_status = 'recorded', population_source = 'Synthetic source', population_source_ref = 'SYN-1', population_as_of = '2024-12-31' WHERE country_code = 'DE'");
  assert.equal((await f.call(SUPER, 'PUT', `${P}/countries/DE/fields/population/status`, { status: 'provisional', reason: REASON, expected_revision: f.rev('DE') })).status, 200);
  const de = (await f.read()).findings.filter((x: any) => x.country_code === 'DE');
  assert.deepEqual(de.map((x: any) => [x.kind, x.differences, x.expected]), [['differs_from_history', ['source', 'source_ref', 'as_of'],
    { value: 84_000_000, status: 'provisional', source: null, source_ref: null, as_of: null }]], 'the clearing row wiped the provenance the planted value claims');
});

test('a cleared field whose latest row holds a value, and a history row above the profile, are named; a rank compares its value only', async () => {
  const f = fixture();
  await f.record('FR', 'population', 68_000_000);
  f.db.exec("UPDATE country_market_profiles SET population = NULL, population_status = 'not_recorded', population_source = NULL, population_source_ref = NULL, population_as_of = NULL WHERE country_code = 'FR'");
  await f.record('DE', 'startup_ecosystem_rank', 7);
  f.db.exec("UPDATE country_market_profiles SET startup_ecosystem_rank = 8 WHERE country_code = 'DE'");
  await f.record('ES', 'population', 48_000_000);
  f.db.exec("UPDATE country_market_profiles SET revision = 0 WHERE country_code = 'ES'");
  const body = await f.read();
  assert.deepEqual(named(body).sort(), ['DE:startup_ecosystem_rank:differs_from_history', 'ES:population:history_ahead_of_profile', 'FR:population:cleared_but_history_holds_value']);
  const rank = body.findings.find((x: any) => x.country_code === 'DE');
  assert.deepEqual([rank.compared, rank.differences], [['value'], ['value']]);
  const cleared = body.findings.find((x: any) => x.country_code === 'FR');
  assert.deepEqual([cleared.profile.value, cleared.expected.value], [null, 68_000_000]);
  assert.deepEqual(cleared.snapshots, { value: 68_000_000, count: 0, decisions: 0, items: [] });
  assert.deepEqual(body.counts, { value_without_history: 0, differs_from_history: 1, cleared_but_history_holds_value: 1, history_ahead_of_profile: 1 });
});

test('a finding lists the frozen snapshot that holds the value and the decision made from it; the read writes nothing', async () => {
  const f = fixture();
  await f.record('FR', 'population', 68_000_000);
  await f.record('FR', 'startup_ecosystem_score', 30_000);
  f.db.exec("UPDATE pricing_models SET status = 'active', activated_at = '2026-01-01T00:00:00.000Z' WHERE uid = 'pricing-model-v1-seed'");
  f.db.exec("UPDATE country_market_profiles SET ppp_gdp_per_capita = 49000, ppp_status = 'recorded', ppp_source = 'Planted', ppp_as_of = '2024-12-31' WHERE country_code = 'FR'");
  const earlier = await createSnapshot(f.env, { modelUid: 'pricing-model-v1-seed', countryCode: 'FR', actor: 'user:1' });
  f.db.exec("UPDATE country_market_profiles SET ppp_gdp_per_capita = 50000 WHERE country_code = 'FR'");
  const snap = await createSnapshot(f.env, { modelUid: 'pricing-model-v1-seed', countryCode: 'FR', actor: 'user:1' });
  const other = await createSnapshot(f.env, { modelUid: 'pricing-model-v1-seed', countryCode: 'DE', actor: 'user:1' });
  f.db.prepare("INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, currency) VALUES (1, 'lic_7714', 'AXL-7714', 'L', 'B', 'active', 'EUR')").run();
  f.db.prepare(`INSERT INTO licence_pricing_decisions (uid, licence_uid, snapshot_uid, currency, decision, effective_from, created_by)
    VALUES ('dec_7714', 'lic_7714', ?, 'EUR', 'accepted', '2027-01-01', 'user:1')`).run(snap.uid);
  const before = everything(f);
  const body = await f.read();
  assert.deepEqual(everything(f), before, 'the read writes no row');
  assert.deepEqual(named(body), ['FR:ppp_gdp_per_capita:value_without_history']);
  const s = body.findings[0].snapshots;
  assert.deepEqual([s.value, s.count, s.decisions], [50_000, 1, 1]);
  assert.deepEqual(s.items.map((i: any) => [i.uid, i.decisions, i.pricing_model_version]), [[snap.uid, 1, 'v1']]);
  assert.equal(f.all('SELECT COUNT(*) AS n FROM country_pricing_snapshots')[0].n, 3, 'the snapshot at 49,000 and the other country\'s are not listed');
  assert.notEqual(other.uid, earlier.uid);
});

test('the read is Super Admin on HQ only', async () => {
  const f = fixture();
  assert.equal((await f.call(SUPER, 'GET', READ)).status, 200);
  assert.equal((await f.call(ADMIN, 'GET', READ)).status, 403, 'a plain admin is refused');
  assert.equal((await f.call(null, 'GET', READ)).status, 401, 'a signed-out request is refused');
  const branch = await fixture({ branch: 'fr-paris' }).call(SUPER, 'GET', READ);
  assert.ok(branch.status >= 400 && branch.status < 500, `a branch deployment is refused: ${branch.status}`);
});

/** Two synthetic fields for every seeded country, as a reviewed source file would hold them. */
const sourceRows = (codes: string[]) => codes.flatMap((code, i) => [
  { country: code, field: 'population', value: 1_000_000 + i * 1_000, status: 'recorded', source: 'Synthetic population', reference: `POP-${code}`, as_of: '2024-12-31' },
  { country: code, field: 'ppp_gdp_per_capita', value: 20_000 + i * 100, status: 'recorded', source: 'Synthetic PPP', reference: '', as_of: '2024-12-31' },
]);

test('the real shape: one import of two fields for every seeded country, built by the builder, is accepted whole and leaves no finding', async () => {
  const f = fixture();
  assert.deepEqual(BUILDER_FIELDS, [...OBSERVED_FIELDS], 'the builder knows the same fields as the Worker');
  const countriesRead = (await f.call(SUPER, 'GET', `${P}/countries`)).body;
  const codes = countriesRead.countries.map((c: any) => c.country_code);
  assert.equal(codes.length, 49);
  const built = buildCountryImport({ rows: sourceRows(codes), catalogue: parseCatalogue(countriesRead), reported: parseConsistency(await f.read()), reason: REASON });
  assert.equal(built.body.observations.length, 98);
  for (const o of built.body.observations) assert.equal(validateObservation(o).ok, true, JSON.stringify(o));
  const r = await f.call(SUPER, 'POST', `${P}/countries/import`, built.body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.conflicts, []);
  assert.deepEqual(Object.values(r.body.applied), Array(49).fill(2));
  assert.equal(f.all('SELECT COUNT(*) AS n FROM country_market_observations')[0].n, 98);
  const after = await f.read();
  assert.deepEqual(after.findings, [], 'the supported route leaves no value without history');
  assert.equal(after.checked.fields, 196);
  const again = buildCountryImport({ rows: sourceRows(codes), catalogue: parseCatalogue((await f.call(SUPER, 'GET', `${P}/countries`)).body), reported: parseConsistency(after), reason: REASON });
  assert.equal(again.body, null, 'a second run on the re-read catalogue builds nothing');
  assert.equal(again.left_out.length, 98);
});

test('repair B: a reported field is kept although unchanged, and recording it again through the import gives it its history', async () => {
  const f = fixture();
  await f.record('FR', 'population', 68_000_000);
  f.db.exec("UPDATE country_market_profiles SET ppp_gdp_per_capita = 50000, ppp_status = 'recorded', ppp_source = 'Synthetic PPP', ppp_source_ref = 'PPP-FR', ppp_as_of = '2024-12-31' WHERE country_code = 'FR'");
  const rows = [
    { country: 'FR', field: 'ppp_gdp_per_capita', value: 50_000, status: 'recorded', source: 'Synthetic PPP', reference: 'PPP-FR', as_of: '2024-12-31' },
    { country: 'FR', field: 'population', value: 68_000_000, status: 'recorded', source: 'Synthetic source', reference: 'SYN-1', as_of: '2024-12-31' },
  ];
  const countries = parseCatalogue((await f.call(SUPER, 'GET', `${P}/countries`)).body);
  assert.equal(buildCountryImport({ rows, catalogue: countries, reason: REASON }).body, null, 'without the consistency read both rows equal the profile');
  const built = buildCountryImport({ rows, catalogue: countries, reported: parseConsistency(await f.read()), reason: REASON });
  assert.deepEqual(built.body.observations.map((o: any) => o.field), ['ppp_gdp_per_capita'], 'only the reported field is kept');
  assert.deepEqual(built.body.expected_revisions, { FR: f.rev('FR') });
  const r = await f.call(SUPER, 'POST', `${P}/countries/import`, built.body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual((await f.read()).findings, []);
  assert.deepEqual(f.all("SELECT kind, value, source, source_ref FROM country_market_observations WHERE country_code = 'FR' AND field = 'ppp_gdp_per_capita'"),
    [{ kind: 'value', value: 50_000, source: 'Synthetic PPP', source_ref: 'PPP-FR' }]);
});

test('a stale body answers 207 for the country that changed and applies the others; rebuilding from a fresh read sends only what is left', async () => {
  const f = fixture();
  const read1 = (await f.call(SUPER, 'GET', `${P}/countries`)).body;
  const built = buildCountryImport({ rows: sourceRows(['FR', 'DE']), catalogue: parseCatalogue(read1), reason: REASON });
  await f.record('FR', 'startup_ecosystem_score', 30_000);
  const r = await f.call(SUPER, 'POST', `${P}/countries/import`, built.body);
  assert.equal(r.status, 207);
  assert.deepEqual(r.body.conflicts.map((c: any) => c.country_code), ['FR']);
  const rebuilt = buildCountryImport({ rows: sourceRows(['FR', 'DE']), catalogue: parseCatalogue((await f.call(SUPER, 'GET', `${P}/countries`)).body), reason: REASON });
  assert.deepEqual([...new Set(rebuilt.body.observations.map((o: any) => o.country_code))], ['FR']);
  assert.equal((await f.call(SUPER, 'POST', `${P}/countries/import`, rebuilt.body)).status, 200);
  assert.deepEqual((await f.read()).findings, []);
});
