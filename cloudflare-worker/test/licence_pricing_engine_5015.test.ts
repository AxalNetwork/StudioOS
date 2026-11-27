/**
 * D5015 (#5015) — the country-pricing engine and its snapshots.
 *
 * The engine is pure, so most cases call it directly. The snapshot cases run over
 * real SQLite with every migration. The list is the issue's own: the reference
 * market, a rich small market, a huge lower-PPP market, a startup outlier, NULL
 * and provisional inputs, a bad weight sum, the caps, commercial rounding,
 * fixed-point boundaries, a deterministic digest, and a recommendation that
 * unrelated database changes leave alone.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_pricing_engine_5015.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import {
  PPM, PricingEngineError, V1_MODEL_DRAFT, canonicalJson, checkModel, divRound, isqrt, log10Ppm, recommend, roundToIncrement,
  sourceDigest, type EngineModel, type EngineProfile,
} from '../src/services/licencePricing.ts';
import { createSnapshot, previewRecommendation, verifySnapshot } from '../src/services/licencePricingSnapshots.ts';

const MODEL: EngineModel = JSON.parse(JSON.stringify({ uid: 'm-v1', ...V1_MODEL_DRAFT }));
const N = MODEL.normalization as any;

/** The reference market: every input exactly at its reference point. */
const REF: EngineProfile = {
  country_code: 'RF',
  population: N.market_size.reference_population, population_status: 'recorded', population_source: 'World Bank WDI', population_as_of: '2024-12-31',
  ppp_gdp_per_capita: N.purchasing_power.reference, ppp_status: 'recorded', ppp_source: 'IMF WEO', ppp_as_of: '2024-12-31',
  startup_ecosystem_score: N.startup_ecosystem.reference_score, startup_ecosystem_rank: 10, startup_score_status: 'recorded',
  startup_source: 'StartupBlink 2025', startup_as_of: '2025-06-01',
  regulatory_class: 'low',
};
const at = (o: Partial<EngineProfile>): EngineProfile => ({ ...REF, ...o });

test('the reference market is index 1.0 and pays exactly the reference fees', () => {
  const r = recommend(MODEL, REF);
  assert.deepEqual(r.factors, { purchasing_power: PPM, startup_ecosystem: PPM, market_size: PPM });
  assert.equal(r.country_index, PPM);
  assert.equal(r.recommended_annual_fee_cents, 5_000_000);
  assert.equal(r.recommended_initial_fee_cents, 5_000_000);
  assert.equal(r.recommended_royalty_bps, 600);
  assert.equal(r.recommended_minimum_royalty_cents, 2_000_000, '40% of EUR 50,000');
  assert.equal(r.recommended_regulatory_surcharge_cents, 0);
  assert.equal(r.tier, 'B');
  assert.deepEqual([r.complete, r.available, r.missing, r.provisional], [true, true, [], []]);
});

test('a rich, tiny market: PPP hits its cap, size pulls it down, nothing runs away', () => {
  const lu = recommend(MODEL, at({ ppp_gdp_per_capita: 140_000, population: 660_000 }));
  assert.equal(lu.factors.purchasing_power, N.purchasing_power.cap_ppm, 'PPP 140k is capped');
  assert.ok(lu.factors.market_size! < PPM && lu.factors.market_size! >= N.market_size.floor_ppm, 'a small population counts less, down to the floor');
  assert.ok(lu.country_index! > PPM && lu.country_index! < 1_300_000, `bounded: ${lu.country_index}`);
});

test('a huge, lower-PPP market: population counts with diminishing returns; PPP floors, never zero', () => {
  const india = recommend(MODEL, at({ ppp_gdp_per_capita: 10_000, population: 1_430_000_000 }));
  assert.equal(india.factors.purchasing_power, N.purchasing_power.floor_ppm, 'PPP 10k is floored, not near zero');
  // log10(1.43e9 / 5e7) = log10(28.6) ≈ 1.4564; × 0.25 + 1 ≈ 1.3641.
  assert.ok(Math.abs(india.factors.market_size! - 1_364_100) < 200, String(india.factors.market_size));
  const twice = recommend(MODEL, at({ ppp_gdp_per_capita: 10_000, population: 2_860_000_000 }));
  assert.ok(twice.factors.market_size! - india.factors.market_size! < 80_000, 'doubling the population adds about 0.075, not 1.0');
  assert.ok(india.country_index! > 500_000, 'a large lower-income market does not collapse');
});

test('a US-scale startup outlier is capped and does not move any other market', () => {
  const us = recommend(MODEL, at({ startup_ecosystem_score: 236_000 }));
  assert.equal(us.factors.startup_ecosystem, N.startup_ecosystem.cap_ppm);
  const mid = recommend(MODEL, at({ startup_ecosystem_score: 7_500 }));
  // sqrt(7.5 / 30) = 0.5: a quarter of the reference score is half the factor, not a sliver of the US's.
  assert.equal(mid.factors.startup_ecosystem, 500_000);
  assert.deepEqual(recommend(MODEL, at({ startup_ecosystem_score: 7_500 })), mid, 'a market\'s result depends only on its own inputs and the model');
});

test('a NULL input is never a fake low price: no index, no fee, and it is named', () => {
  for (const [field, status, key] of [
    ['ppp_gdp_per_capita', 'ppp_status', 'purchasing_power'],
    ['population', 'population_status', 'market_size'],
    ['startup_ecosystem_score', 'startup_score_status', 'startup_ecosystem'],
  ] as const) {
    const r = recommend(MODEL, at({ [field]: null, [status]: 'not_recorded' } as Partial<EngineProfile>));
    assert.equal(r.available, false, key);
    assert.equal(r.complete, false);
    assert.deepEqual(r.missing, [key]);
    assert.equal(r.country_index, null);
    assert.equal(r.recommended_annual_fee_cents, null);
    assert.equal(r.factors[key], null);
    assert.match(r.unavailable_reason!, /not recorded/);
  }
  const noClass = recommend(MODEL, at({ regulatory_class: null }));
  assert.equal(noClass.available, true, 'the regulatory class is HQ\'s optional input');
  assert.equal(noClass.recommended_regulatory_surcharge_cents, null, 'unknown, not free');
});

test('a provisional input is used only when HQ allows it, and the result says so', () => {
  const prov = at({ startup_score_status: 'provisional' });
  const refused = recommend(MODEL, prov);
  assert.deepEqual([refused.available, refused.provisional, refused.missing], [false, ['startup_ecosystem'], []]);
  assert.match(refused.unavailable_reason!, /only provisional/);
  const allowed = recommend(MODEL, prov, { allowProvisional: true });
  assert.deepEqual([allowed.available, allowed.complete, allowed.provisional], [true, false, ['startup_ecosystem']]);
  assert.equal(allowed.recommended_annual_fee_cents, 5_000_000);
  assert.equal(allowed.trace.allow_provisional, true);
});

test('a weight sum other than 10000, or a missing normalization, refuses the model', () => {
  assert.throws(() => recommend({ ...MODEL, weight_market_size_bps: 2499 }, REF), (e: any) => e instanceof PricingEngineError && e.code === 'model_invalid' && /9999/.test(e.problems.join()));
  assert.throws(() => recommend({ ...MODEL, normalization: { purchasing_power: N.purchasing_power } }, REF), /startup_ecosystem/);
  assert.throws(() => recommend({ ...MODEL, tier_thresholds: [{ tier: 'A', min_index_ppm: 900_000 }] }, REF), /min_index_ppm 0/);
  assert.throws(() => checkModel({ ...MODEL, regulatory_surcharge: { extreme: 1 } }), /regulatory_surcharge/);
});

test('caps and floors bound every factor, and the index between the weighted floors and caps', () => {
  const low = recommend(MODEL, at({ ppp_gdp_per_capita: 1, population: 1, startup_ecosystem_score: 0 }));
  assert.deepEqual(low.factors, { purchasing_power: N.purchasing_power.floor_ppm, startup_ecosystem: N.startup_ecosystem.floor_ppm, market_size: N.market_size.floor_ppm });
  const high = recommend(MODEL, at({ ppp_gdp_per_capita: 10_000_000, population: 9_000_000_000, startup_ecosystem_score: 10_000_000 }));
  assert.deepEqual(high.factors, { purchasing_power: N.purchasing_power.cap_ppm, startup_ecosystem: N.startup_ecosystem.cap_ppm, market_size: N.market_size.cap_ppm });
  assert.equal(low.country_index, 350_000, '(4000 × 0.3 + 3500 × 0.3 + 2500 × 0.5) / 10000');
  assert.equal(high.country_index, 1_645_000);
});

test('commercial rounding: the increment rounds half up, and the trace keeps the exact figure', () => {
  const pppOnly: EngineModel = { ...MODEL, weight_purchasing_power_bps: 10000, weight_startup_ecosystem_bps: 0, weight_market_size_bps: 0 };
  // PPP 63,375 / 65,000 = 0.975 exactly → EUR 48,750 exactly → half up to EUR 50,000.
  const half = recommend(pppOnly, at({ ppp_gdp_per_capita: 63_375 }));
  assert.equal(half.country_index, 975_000);
  assert.equal(half.recommended_annual_fee_cents, 5_000_000);
  assert.equal((half.trace.fees as any).annual.exact_microcents, 4_875_000 * PPM);
  // PPP 63,374 → 0.974985 → EUR 48,749.25 → down to EUR 47,500.
  const below = recommend(pppOnly, at({ ppp_gdp_per_capita: 63_374 }));
  assert.equal(below.country_index, 974_985);
  assert.equal(below.recommended_annual_fee_cents, 4_750_000);
  assert.equal(below.recommended_minimum_royalty_cents, 2_000_000, '40% of the ROUNDED EUR 47,500 is 19,000, which rounds to 20,000');
  const fine = recommend({ ...pppOnly, fee_rounding_cents: 1 }, at({ ppp_gdp_per_capita: 63_374 }));
  assert.equal(fine.recommended_annual_fee_cents, 4_874_925, 'a 1-cent increment keeps the cents');
  assert.equal(roundToIncrement(124_999_999n, 250_000), 0n);
  assert.equal(roundToIncrement(125_000_000_000n, 250_000), 250_000n);
});

test('fixed-point boundaries: integer log10, square root and division are exact where they should be', () => {
  assert.equal(log10Ppm(1n, 1n), 0n);
  assert.equal(log10Ppm(10n, 1n), 1_000_000n);
  assert.equal(log10Ppm(1000n, 1n), 3_000_000n);
  assert.equal(log10Ppm(1n, 100n), -2_000_000n);
  assert.equal(log10Ppm(2n, 1n), 301_030n);
  assert.equal(log10Ppm(1_430_000_000n, 50_000_000n), 1_456_366n);
  for (const k of [0n, 1n, 4n, 999_999_999_999n * 999_999_999_999n]) assert.equal(isqrt(k * k), k);
  assert.equal(isqrt(15n), 3n);
  assert.equal(divRound(5n, 2n), 3n);
  assert.equal(divRound(-5n, 2n), -3n);
  assert.equal(divRound(4n, 3n), 1n);
  for (const v of Object.values(recommend(MODEL, at({ population: 123_456_789, ppp_gdp_per_capita: 54_321 })).factors)) assert.ok(Number.isInteger(v));
});

test('the digest is deterministic: same inputs, same digest, whatever the key order; any input changes it', async () => {
  const a = await sourceDigest(MODEL, REF);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  const reordered: EngineModel = { ...MODEL, normalization: { market_size: N.market_size, startup_ecosystem: N.startup_ecosystem, purchasing_power: N.purchasing_power } };
  assert.equal(await sourceDigest(reordered, { ...REF }), a);
  assert.notEqual(await sourceDigest(MODEL, at({ ppp_as_of: '2025-12-31' })), a, 'the as-of date is part of the source');
  assert.notEqual(await sourceDigest(MODEL, REF, { allowProvisional: true }), a);
  assert.notEqual(await sourceDigest({ ...MODEL, version: 'v2' }, REF), a);
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: null }] }), '{"a":[{"c":null,"d":2}],"b":1}');
});

// ── Snapshots over the real schema ───────────────────────────────────────────

function db() {
  const d = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(d);
  // D5016 seeds the 49-market catalogue and a v1 draft; these cases build their own, so they start empty.
  d.exec("DELETE FROM country_market_profiles; DELETE FROM pricing_models WHERE status = 'draft'");
  const m = V1_MODEL_DRAFT;
  d.prepare(`INSERT INTO pricing_models (uid, version, status, currency, reference_annual_fee_cents, reference_initial_fee_cents, default_royalty_bps,
      minimum_royalty_ratio_bps, weight_purchasing_power_bps, weight_startup_ecosystem_bps, weight_market_size_bps, fee_rounding_cents,
      normalization_json, regulatory_surcharge_json, tier_thresholds_json, effective_from)
    VALUES ('m-v1', 'v1', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-12-01')`).run(
    m.currency, m.reference_annual_fee_cents, m.reference_initial_fee_cents, m.default_royalty_bps, m.minimum_royalty_ratio_bps,
    m.weight_purchasing_power_bps, m.weight_startup_ecosystem_bps, m.weight_market_size_bps, m.fee_rounding_cents,
    JSON.stringify(m.normalization), JSON.stringify(m.regulatory_surcharge), JSON.stringify(m.tier_thresholds));
  d.exec(`INSERT INTO pricing_models (uid, version, status, reference_annual_fee_cents, reference_initial_fee_cents, default_royalty_bps,
      minimum_royalty_ratio_bps, weight_purchasing_power_bps, weight_startup_ecosystem_bps, weight_market_size_bps, effective_from)
    VALUES ('m-draft', 'v2-draft', 'draft', 5000000, 5000000, 600, 4000, 4000, 3500, 2500, '2027-01-01')`);
  const p = d.prepare(`INSERT INTO country_market_profiles (country_code, country_name, population, population_status, population_source, population_as_of,
      ppp_gdp_per_capita, ppp_status, ppp_source, ppp_as_of, startup_ecosystem_score, startup_ecosystem_rank, startup_score_status,
      startup_source, startup_as_of, regulatory_class) VALUES (?, ?, ?, 'recorded', 'World Bank WDI', '2024-12-31', ?, 'recorded', 'IMF WEO', '2024-12-31',
      ?, ?, ?, 'StartupBlink 2025', '2025-06-01', ?)`);
  p.run('FR', 'France', 68_400_000, 60_000, 33_100, 6, 'recorded', 'medium');
  p.run('DE', 'Germany', 83_300_000, 70_000, 34_900, 5, 'recorded', 'medium');
  d.exec("INSERT INTO country_market_profiles (country_code, country_name, population, population_status, ppp_gdp_per_capita, ppp_status) VALUES ('MT', 'Malta', 540000, 'recorded', 65000, 'recorded')");
  return { d, env: { DB: d1Over(d) } as any };
}

test('a snapshot freezes inputs, figures and digest; unrelated changes leave the recommendation alone', async () => {
  const { d, env } = db();
  const s = await createSnapshot(env, { modelUid: 'm-v1', countryCode: 'FR', actor: 'user:1' });
  const row = { ...(d.prepare('SELECT * FROM country_pricing_snapshots WHERE uid = ?').get(s.uid) as any) };
  assert.equal(row.population, 68_400_000);
  assert.equal(row.ppp_source, 'IMF WEO');
  assert.equal(row.pricing_model_version, 'v1');
  assert.equal(row.complete, 1);
  assert.equal(row.recommended_annual_fee_cents, s.recommendation.recommended_annual_fee_cents);
  assert.equal(row.recommended_regulatory_surcharge_cents, 500_000);
  assert.equal(row.source_digest, s.source_digest);
  // Unrelated rows change: another country, another table.
  d.exec("UPDATE country_market_profiles SET ppp_gdp_per_capita = 99000, revision = revision + 1 WHERE country_code = 'DE'");
  d.exec("INSERT INTO country_market_profiles (country_code, country_name) VALUES ('ES', 'Spain')");
  const again = await previewRecommendation(env, { modelUid: 'm-v1', countryCode: 'FR' });
  assert.equal(again.source_digest, s.source_digest);
  assert.deepEqual(again.recommendation, s.recommendation);
  assert.deepEqual(await verifySnapshot(env, s.uid), { matches: true, stored_digest: s.source_digest, recomputed_digest: s.source_digest, differences: [] });
  // France itself changes: the next recommendation differs, the old snapshot still reproduces from its own columns.
  d.exec("UPDATE country_market_profiles SET ppp_gdp_per_capita = 61000, ppp_as_of = '2025-12-31', revision = revision + 1 WHERE country_code = 'FR'");
  const next = await previewRecommendation(env, { modelUid: 'm-v1', countryCode: 'FR' });
  assert.notEqual(next.source_digest, s.source_digest);
  assert.equal((await verifySnapshot(env, s.uid)).matches, true);
});

test('an unavailable market is snapshotted as such; a draft model is never snapshotted', async () => {
  const { d, env } = db();
  const mt = await createSnapshot(env, { modelUid: 'm-v1', countryCode: 'MT', actor: 'user:1' });
  const row = { ...(d.prepare('SELECT complete, country_index, recommended_annual_fee_cents, missing_inputs_json FROM country_pricing_snapshots WHERE uid = ?').get(mt.uid) as any) };
  assert.deepEqual(row, { complete: 0, country_index: null, recommended_annual_fee_cents: null, missing_inputs_json: '["startup_ecosystem"]' });
  await assert.rejects(createSnapshot(env, { modelUid: 'm-draft', countryCode: 'FR', actor: 'user:1' }), (e: any) => e.code === 'model_invalid' || e.code === 'model_not_frozen');
  await assert.rejects(previewRecommendation(env, { modelUid: 'm-draft', countryCode: 'FR' }), (e: any) => e.code === 'model_invalid', 'the bare draft states no normalization');
  await assert.rejects(previewRecommendation(env, { modelUid: 'nope', countryCode: 'FR' }), (e: any) => e.status === 404);
});
