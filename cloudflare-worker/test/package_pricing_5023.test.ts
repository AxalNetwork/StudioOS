/**
 * D5023 (#5023) — a package version's country-adjusted price, its bundle economics and its frozen record.
 *
 * The pure calculation, then real SQLite over every migration with the real routers (package pricing, the
 * package catalogue, program pricing, licence pricing). Pinned, from the issue:
 *   · reference country, a lower and a higher index, floor and ceiling, deterministic rounding;
 *   · Full Axal VC's bundle saving, explainable from its programs; the no-discount warning;
 *   · a missing program reference price is never a fake zero comparison;
 *   · provisional market data is a warning; a multi-country basket uses the licence's own weights;
 *   · the same package version + country snapshot always answers the same recommendation, and a country-data
 *     update reaches only recommendations made after it; a new package version leaves the old one's alone.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/package_pricing_5023.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount as packagePricingMount } from '../src/routes/admin_package_pricing.ts';
import { mount as packagesMount } from '../src/routes/admin_licence_packages.ts';
import { mount as programPricingMount } from '../src/routes/admin_program_pricing.ts';
import { mount as pricingApplyMount } from '../src/routes/admin_licence_pricing_apply.ts';
import { recommendPackage } from '../src/services/packagePricing.ts';

// ── The pure calculation ─────────────────────────────────────────────────────

const pkgOf = (over: Record<string, unknown> = {}, items: string[] = ['a', 'b']) => ({
  uid: 'pkg_x_v1', package_key: 'x', version: 1, name: 'X', description: null, status: 'active', currency: 'EUR',
  base_annual_fee_cents: 1_000_000, guidance_min_cents: 800_000, guidance_max_cents: 1_200_000,
  floor_multiplier_ppm: null, ceiling_multiplier_ppm: null, effective_from: '2026-11-01', effective_to: null,
  created_at: '2026-11-01', created_by: null,
  items: items.map((k, i) => ({ program_key: k, included_by_default: true, position: i + 1, metadata: null })),
  ...over,
}) as any;
const def = (key: string, base: number, version = 1) => ({
  uid: `def_${key}_${version}`, program_key: key, version, status: 'active', currency: 'EUR', base_annual_fee_cents: base,
  base_initial_fee_cents: null, floor_multiplier_ppm: null, ceiling_multiplier_ppm: null, fee_rounding_cents: null,
  effective_from: '2026-11-01', reason: 'r', created_at: '2026-11-01', created_by: 'user:1', retired_at: null,
}) as any;
const idxOf = (ppm: number | null, rounding = 10_000) => ({ ppm, currency: 'EUR', rounding_cents: rounding, model_version: 'v1', reason: ppm === null ? 'No country index.' : null });
const defaults = (m: Record<string, number | null>) => new Map(Object.entries(m).map(([k, v]) => [k, v === null ? null : def(k, v)]));

test('reference country: index 1.0 prices the package at its base, and the guidance range is unchanged', () => {
  const r = recommendPackage(pkgOf(), idxOf(1_000_000), defaults({ a: 700_000, b: 600_000 }));
  assert.equal(r.available, true);
  assert.equal(r.recommended_annual_fee_cents, 1_000_000);
  assert.equal(r.guidance_min_cents, 800_000);
  assert.equal(r.guidance_max_cents, 1_200_000);
  assert.equal(r.standalone_sum_cents, 1_300_000);
  assert.equal(r.bundle_saving_cents, 300_000);
  assert.equal(r.bundle_discount_bps, 2308, '300000 / 1300000 = 23.08%');
  assert.equal(r.bundle_value_warning, false);
});

test('a lower (Türkiye-style) and a higher (Switzerland-style) index move the price, the guidance and the programs together', () => {
  const low = recommendPackage(pkgOf(), idxOf(450_000), defaults({ a: 700_000, b: 600_000 }));
  assert.equal(low.recommended_annual_fee_cents, 450_000);
  assert.equal(low.guidance_min_cents, 360_000);
  assert.equal(low.guidance_max_cents, 540_000);
  assert.equal(low.standalone_sum_cents, 320_000 + 270_000);
  const high = recommendPackage(pkgOf(), idxOf(1_650_000), defaults({ a: 700_000, b: 600_000 }));
  assert.equal(high.recommended_annual_fee_cents, 1_650_000);
  assert.equal(high.standalone_sum_cents, 1_160_000 + 990_000);
  assert.equal(high.trace.annual && (high.trace.annual as any).unrounded_microcents, String(1_000_000n * 1_650_000n), 'the unrounded value is kept');
});

test('the package floor and ceiling clamp the country-adjusted price, and the trace says which', () => {
  const floored = recommendPackage(pkgOf({ floor_multiplier_ppm: 600_000, ceiling_multiplier_ppm: 1_400_000 }), idxOf(450_000), defaults({ a: 700_000, b: 600_000 }));
  assert.equal(floored.recommended_annual_fee_cents, 600_000);
  assert.equal((floored.trace.annual as any).clamped, 'floor');
  const capped = recommendPackage(pkgOf({ floor_multiplier_ppm: 600_000, ceiling_multiplier_ppm: 1_400_000 }), idxOf(1_650_000), defaults({ a: 700_000, b: 600_000 }));
  assert.equal(capped.recommended_annual_fee_cents, 1_400_000);
  assert.equal((capped.trace.annual as any).clamped, 'ceiling');
  const inside = recommendPackage(pkgOf({ floor_multiplier_ppm: 600_000, ceiling_multiplier_ppm: 1_400_000 }), idxOf(1_000_000), defaults({ a: 700_000, b: 600_000 }));
  assert.equal((inside.trace.annual as any).clamped, null);
});

test('rounding is the model increment, half up, and deterministic', () => {
  // 1,000,000 × 0.987654 = 987,654 cents → 990,000 at a 10,000-cent increment; 985,000 → 990,000 (half up).
  const a = recommendPackage(pkgOf(), idxOf(987_654), defaults({ a: 700_000, b: 600_000 }));
  assert.equal(a.recommended_annual_fee_cents, 990_000);
  assert.equal(recommendPackage(pkgOf(), idxOf(985_000), defaults({ a: 700_000, b: 600_000 })).recommended_annual_fee_cents, 990_000);
  assert.equal(recommendPackage(pkgOf(), idxOf(984_999), defaults({ a: 700_000, b: 600_000 })).recommended_annual_fee_cents, 980_000);
  assert.deepEqual(recommendPackage(pkgOf(), idxOf(987_654), defaults({ a: 700_000, b: 600_000 })), a, 'same inputs, same answer');
  assert.equal((a.trace.annual as any).unrounded_cents, 987_654);
});

test('a package that costs more than its programs is flagged, never shown as a discount', () => {
  const r = recommendPackage(pkgOf(), idxOf(1_000_000), defaults({ a: 400_000, b: 300_000 }));
  assert.equal(r.bundle_value_warning, true);
  assert.equal(r.bundle_saving_cents, null);
  assert.equal(r.bundle_discount_bps, null);
  assert.equal(r.bundle_premium_cents, 300_000);
  assert.ok(r.warnings.some((w) => w.code === 'bundle_value_warning'));
});

test('a missing program reference price leaves the standalone total unknown, not smaller', () => {
  const r = recommendPackage(pkgOf(), idxOf(1_000_000), defaults({ a: 700_000, b: null }));
  assert.equal(r.recommended_annual_fee_cents, 1_000_000, 'the package still has its own price');
  assert.equal(r.standalone_sum_cents, null);
  assert.equal(r.bundle_saving_cents, null);
  assert.equal(r.bundle_discount_bps, null);
  assert.equal(r.bundle_value_warning, false);
  const w = r.warnings.find((x) => x.code === 'missing_program_price');
  assert.ok(w);
  assert.deepEqual(w?.detail?.programs, ['b']);
  assert.equal(r.programs.find((p) => p.program_key === 'b')?.recommended_annual_fee_cents, null);
});

test('no country index, or a different currency, is unavailable with a reason', () => {
  const none = recommendPackage(pkgOf(), idxOf(null), defaults({ a: 1, b: 1 }));
  assert.equal(none.available, false);
  assert.equal(none.recommended_annual_fee_cents, null);
  const usd = recommendPackage(pkgOf(), { ...idxOf(1_000_000), currency: 'USD' }, defaults({ a: 1, b: 1 }));
  assert.equal(usd.available, false);
  assert.match(String(usd.unavailable_reason), /USD/);
});

test('only the version\'s own items are compared, in their order; an optional item is not', () => {
  const pkg = pkgOf({}, ['a', 'b', 'c']);
  pkg.items[2].included_by_default = false;
  const r = recommendPackage(pkg, idxOf(1_000_000), defaults({ a: 700_000, b: 600_000, c: 999_999 }));
  assert.deepEqual(r.programs.map((p) => p.program_key), ['a', 'b']);
  assert.equal(r.standalone_sum_cents, 1_300_000);
});

// ── Over the routes ──────────────────────────────────────────────────────────

const SECRET = ['d5023', 'package', 'pricing', 'fixture', 'secret'].join('-');
const SUPER = 1, ADMIN = 3;
const LIC = 'lic_5023';
const PP = `/api/admin/licences/${LIC}/package-pricing`;
const FULL = ['spinout-lab', 'ai-native-venture', 'mentor-cohorts', 'investor-cohorts', 'referral-partners', 'refer-and-earn', 'perks', 'learning', 'product-testing', 'influencer'];

function fixture(countries: string[] = ['FR']) {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  for (const id of [SUPER, ADMIN]) u.run(id, 'admin', `Person ${id}`, `user${id}@example.test`);
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  s.run(SUPER, 'totp-1'); s.run(ADMIN, 'totp-3');
  db.exec("UPDATE pricing_models SET status = 'active', activated_at = datetime('now') WHERE uid = 'pricing-model-v1-seed'");
  const prof = db.prepare(`UPDATE country_market_profiles SET population = ?, population_status = 'recorded', ppp_gdp_per_capita = ?, ppp_status = 'recorded',
      startup_ecosystem_score = ?, startup_score_status = 'recorded', regulatory_class = ? WHERE country_code = ?`);
  prof.run(68_000_000, 58_000, 30_000, 'medium', 'FR');
  prof.run(84_000_000, 66_000, 45_000, 'medium', 'DE');
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, term_years,
      annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
    VALUES (1, ?, 'AXL-5023', 'Licensee', 'Brand', 'active', 3, 1000000, 'EUR', 3000, 5000, '2025-01-01', '2027-10-31')`).run(LIC);
  const t = db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (1, ?)');
  for (const c of countries) t.run(c);
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  for (const m of [...packagePricingMount, packagesMount, ...programPricingMount, ...pricingApplyMount]) app.route(m.path, m.router);
  app.onError((err: any, c) => {
    const status = ({ Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>)[String(err?.message || '')];
    if (status) return c.json({ detail: err.message }, status);
    throw err;
  });
  async function call(who: number, method: string, path: string, body?: unknown) {
    const token = await new SignJWT({ user_id: who, jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, env));
      let json: any = null; try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const publish = (program: string, base: number, expected = 0) => call(SUPER, 'POST', `/api/admin/program-pricing/defaults/${program}`,
    { currency: 'EUR', base_annual_fee_cents: base, effective_from: '2026-12-01', reason: 'Reference price', expected_version: expected });
  const snapshot = async (body: Record<string, unknown> = {}) => {
    const r = await call(SUPER, 'POST', `/api/admin/licences/${LIC}/pricing/snapshot`, body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.snapshot;
  };
  return { db, call, all, one, publish, snapshot };
}

const indexOf = (one: any, snap: any) => one('SELECT country_index FROM country_pricing_snapshots WHERE uid = ?', snap.lead_snapshot_uid).country_index as number;
const expectFee = (base: number, index: number, rounding: number) => Math.round((base * index) / 1_000_000 / rounding) * rounding;

test('Full Axal VC: priced from the licence\'s snapshot, with a bundle saving explained by its ten programs', async () => {
  const { call, one, all, publish, snapshot } = fixture();
  for (const k of FULL) assert.equal((await publish(k, 700_000)).status, 201);
  const snap = await snapshot();
  const index = indexOf(one, snap);
  const rounding = one("SELECT fee_rounding_cents FROM pricing_models WHERE uid = 'pricing-model-v1-seed'").fee_rounding_cents as number;
  const view = await call(SUPER, 'GET', `${PP}?package=full_axal_vc`);
  assert.equal(view.status, 200, JSON.stringify(view.body));
  assert.equal(view.body.snapshot.uid, snap.uid);
  assert.equal(view.body.snapshot.latest, true);
  const full = view.body.packages[0];
  assert.equal(full.package_key, 'full_axal_vc');
  assert.equal(full.package_version, 1);
  assert.equal(full.country_index_ppm, index);
  assert.equal(full.base_annual_fee_cents, 5_250_000);
  assert.equal(full.recommended_annual_fee_cents, expectFee(5_250_000, index, rounding));
  assert.deepEqual(full.programs.map((p: any) => p.program_key), FULL);
  const sum = full.programs.reduce((a: number, p: any) => a + p.recommended_annual_fee_cents, 0);
  assert.equal(full.standalone_sum_cents, sum);
  assert.equal(full.bundle_saving_cents, sum - full.recommended_annual_fee_cents);
  assert.ok(full.bundle_discount_bps > 0 && full.bundle_discount_bps < 10000);
  assert.equal(full.bundle_value_warning, false);
  assert.equal(all('SELECT * FROM package_pricing_recommendations').length, 0, 'a preview records nothing');

  // Freeze it. The same inputs answer the same row.
  const made = await call(SUPER, 'POST', `${PP}/recommendations`, { package_key: 'full_axal_vc' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const rec = made.body.recommendation;
  assert.equal(rec.licence_snapshot_uid, snap.uid);
  assert.equal(rec.recommended_annual_fee_cents, full.recommended_annual_fee_cents);
  assert.equal(rec.bundle_saving_cents, full.bundle_saving_cents);
  assert.equal(rec.created_by, `user:${SUPER}`);
  const again = await call(SUPER, 'POST', `${PP}/recommendations`, { package_key: 'full_axal_vc' });
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false);
  assert.equal(again.body.recommendation.uid, rec.uid);
  assert.equal(all('SELECT * FROM package_pricing_recommendations').length, 1);
  assert.equal(one("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'package_pricing_recommended'").n, 1, 'audited once');
  assert.equal((await call(ADMIN, 'POST', `${PP}/recommendations`, { package_key: 'full_axal_vc' })).status, 403, 'Super Admin only');
});

test('a missing program reference price is "not known", never a zero in the comparison', async () => {
  const { call, publish, snapshot } = fixture();
  for (const k of FULL.slice(0, 9)) await publish(k, 700_000);
  await snapshot();
  const r = await call(SUPER, 'POST', `${PP}/recommendations`, { package_key: 'full_axal_vc' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.recommendation.standalone_sum_cents, null);
  assert.equal(r.body.recommendation.bundle_saving_cents, null);
  assert.equal(r.body.recommendation.bundle_discount_bps, null);
  const w = r.body.recommendation.warnings.find((x: any) => x.code === 'missing_program_price');
  assert.deepEqual(w.detail.programs, ['influencer']);
});

test('provisional market data is carried as a warning', async () => {
  const { call, db, snapshot, publish } = fixture();
  for (const k of FULL) await publish(k, 700_000);
  db.exec("UPDATE country_market_profiles SET ppp_status = 'provisional' WHERE country_code = 'FR'");
  await snapshot({ allow_provisional: true });
  const view = await call(SUPER, 'GET', `${PP}?package=full_axal_vc`);
  assert.equal(view.status, 200, JSON.stringify(view.body));
  const w = view.body.packages[0].warnings.find((x: any) => x.code === 'provisional_market_data');
  assert.ok(w, JSON.stringify(view.body.packages[0].warnings));
  assert.equal(w.detail.countries[0].country_code, 'FR');
});

test('a multi-country licence uses its recorded basket, and an older snapshot needs a reason', async () => {
  const { call, one, publish, snapshot } = fixture(['DE', 'FR']);
  for (const k of FULL) await publish(k, 700_000);
  assert.equal((await call(SUPER, 'GET', PP)).status, 409, 'no snapshot yet');
  const basis = await call(SUPER, 'PUT', `/api/admin/licences/${LIC}/pricing/policy`, { basis: 'basket_weighted', weights: { FR: 7000, DE: 3000 }, reason: 'Paris-led launch', expected_revision: 0 });
  assert.equal(basis.status, 200, JSON.stringify(basis.body));
  const first = await snapshot();
  const fr = one("SELECT country_index FROM country_pricing_snapshots WHERE uid = ?", first.components.find((c: any) => c.country_code === 'FR').snapshot_uid).country_index;
  const de = one("SELECT country_index FROM country_pricing_snapshots WHERE uid = ?", first.components.find((c: any) => c.country_code === 'DE').snapshot_uid).country_index;
  const weighted = Math.round((fr * 7000 + de * 3000) / 10000);
  const view = await call(SUPER, 'GET', `${PP}?package=core_network`);
  assert.equal(view.body.packages[0].country_index_ppm, weighted, 'the basket\'s weighted index, not an average of convenience');
  const second = await snapshot();
  const stale = await call(SUPER, 'POST', `${PP}/recommendations`, { package_key: 'core_network', licence_snapshot_uid: first.uid });
  assert.equal(stale.status, 400);
  assert.equal(stale.body.error, 'snapshot_reason_required');
  const chosen = await call(SUPER, 'POST', `${PP}/recommendations`, { package_key: 'core_network', licence_snapshot_uid: first.uid, snapshot_reason: 'Matches the quote sent in October.' });
  assert.equal(chosen.status, 201, JSON.stringify(chosen.body));
  assert.equal(chosen.body.recommendation.snapshot_is_latest, false);
  assert.equal(chosen.body.recommendation.snapshot_reason, 'Matches the quote sent in October.');
  const latest = await call(SUPER, 'POST', `${PP}/recommendations`, { package_key: 'core_network' });
  assert.equal(latest.body.recommendation.licence_snapshot_uid, second.uid);
  assert.equal(latest.body.recommendation.snapshot_is_latest, true);
  const foreign = await call(SUPER, 'POST', `${PP}/recommendations`, { package_key: 'core_network', licence_snapshot_uid: '00000000-0000-0000-0000-000000000000', snapshot_reason: 'x y z' });
  assert.equal(foreign.status, 404);
});

test('a country-data update and a new package version reach only new recommendations', async () => {
  const { call, db, one, all, publish, snapshot } = fixture();
  for (const k of FULL) await publish(k, 700_000);
  await snapshot();
  const v1 = (await call(SUPER, 'POST', `${PP}/recommendations`, { package_key: 'core_network' })).body.recommendation;
  const frozen = one('SELECT * FROM package_pricing_recommendations WHERE uid = ?', v1.uid);

  // Country data moves; a new snapshot gives a new recommendation, the old row is untouched.
  db.prepare("UPDATE country_market_profiles SET ppp_gdp_per_capita = 90000, revision = revision + 1 WHERE country_code = 'FR'").run();
  await snapshot();
  const after = (await call(SUPER, 'POST', `${PP}/recommendations`, { package_key: 'core_network' })).body.recommendation;
  assert.notEqual(after.uid, v1.uid);
  assert.notEqual(after.country_index_ppm, v1.country_index_ppm);
  assert.deepEqual(one('SELECT * FROM package_pricing_recommendations WHERE uid = ?', v1.uid), frozen);
  assert.throws(() => db.exec(`UPDATE package_pricing_recommendations SET recommended_annual_fee_cents = 1 WHERE uid = '${v1.uid}'`), /append-only/);
  assert.throws(() => db.exec('DELETE FROM package_pricing_recommendations'), /append-only/);

  // A new package version: v2 prices differently; v1 can still be priced, and its answer is the same row.
  const draft = await call(SUPER, 'POST', '/api/admin/licence-packages/core_network/versions', {
    name: 'Core Network', currency: 'EUR', base_annual_fee_cents: 1_200_000, effective_from: '2027-01-01',
    items: ['referral-partners', 'refer-and-earn', 'perks', 'influencer'].map((k) => ({ program_key: k, included_by_default: true })),
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal((await call(SUPER, 'POST', `${PP}/recommendations`, { package_key: 'core_network', version: 2 })).body.error, 'package_not_published', 'a draft can still change');
  assert.equal((await call(SUPER, 'POST', '/api/admin/licence-packages/core_network/versions/2/publish', { reason: 'New year pricing' })).status, 200);
  const v2 = (await call(SUPER, 'POST', `${PP}/recommendations`, { package_key: 'core_network' })).body.recommendation;
  assert.equal(v2.package_version, 2);
  assert.equal(v2.base_annual_fee_cents, 1_200_000);
  const v1Again = await call(SUPER, 'POST', `${PP}/recommendations`, { package_key: 'core_network', version: 1 });
  assert.equal(v1Again.body.created, false);
  assert.equal(v1Again.body.recommendation.uid, after.uid, 'version 1 on the same snapshot answers the same recommendation');
  const history = await call(SUPER, 'GET', `${PP}/recommendations?package=core_network`);
  assert.equal(history.body.total, 3);
  assert.equal(all('SELECT * FROM package_pricing_recommendations').length, 3);
});
