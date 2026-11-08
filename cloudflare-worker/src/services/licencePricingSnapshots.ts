/**
 * D5015 (#5015) — recommendation snapshots: the pure engine's result, frozen.
 *
 * `previewRecommendation` reads one pricing model and one country profile,
 * runs `licencePricing.recommend`, and returns the result with its source
 * digest. It writes nothing. `createSnapshot` does the same, then appends a
 * `country_pricing_snapshots` row (migration 202611081906) that holds the input
 * values, statuses, sources and as-of dates, the factors, index, tier and
 * recommended figures, the trace, the model version and the digest.
 *
 * REPRODUCIBLE. The digest covers the model's calculation fields and every
 * input. The same model version and the same inputs give the same digest and
 * the same figures, so a snapshot can be recalculated and checked byte for
 * byte. Snapshots are append-only (the migration's triggers): a later
 * country-data or model change makes a new snapshot and never edits an old one.
 */
import type { Env } from '../types';
import { PricingError, getCountry, getModel, type CountryProfile, type PricingModel } from './licencePricingStore';
import { PricingEngineError, recommend, sourceDigest, type EngineModel, type EngineProfile, type Recommendation } from './licencePricing';

export const engineModelOf = (m: PricingModel): EngineModel => ({
  uid: m.uid, version: m.version, currency: m.currency,
  reference_annual_fee_cents: m.reference_annual_fee_cents, reference_initial_fee_cents: m.reference_initial_fee_cents,
  default_royalty_bps: m.default_royalty_bps, minimum_royalty_ratio_bps: m.minimum_royalty_ratio_bps,
  weight_purchasing_power_bps: m.weight_purchasing_power_bps, weight_startup_ecosystem_bps: m.weight_startup_ecosystem_bps,
  weight_market_size_bps: m.weight_market_size_bps, fee_rounding_cents: m.fee_rounding_cents,
  normalization: m.normalization, regulatory_surcharge: m.regulatory_surcharge, tier_thresholds: m.tier_thresholds,
});

export const engineProfileOf = (p: CountryProfile): EngineProfile => ({
  country_code: p.country_code,
  population: p.population, population_status: p.population_status, population_source: p.population_source, population_as_of: p.population_as_of,
  ppp_gdp_per_capita: p.ppp_gdp_per_capita, ppp_status: p.ppp_status, ppp_source: p.ppp_source, ppp_as_of: p.ppp_as_of,
  startup_ecosystem_score: p.startup_ecosystem_score, startup_ecosystem_rank: p.startup_ecosystem_rank,
  startup_score_status: p.startup_score_status, startup_source: p.startup_source, startup_as_of: p.startup_as_of,
  regulatory_class: p.regulatory_class, revision: p.revision,
});

export type Preview = { recommendation: Recommendation; source_digest: string; model: PricingModel; profile: CountryProfile };

/** The recommendation for a country under a model, calculated now and not stored. */
export async function previewRecommendation(
  env: Env, input: { modelUid: string; countryCode: string; allowProvisional?: boolean },
): Promise<Preview> {
  const [model, profile] = await Promise.all([getModel(env, input.modelUid), getCountry(env, input.countryCode)]);
  if (!model) throw new PricingError(404, 'not_found', 'No pricing model with that id.');
  if (!profile) throw new PricingError(404, 'not_found', `No market profile is recorded for ${input.countryCode}.`);
  const em = engineModelOf(model);
  const ep = engineProfileOf(profile);
  const opts = { allowProvisional: input.allowProvisional === true };
  let recommendation: Recommendation;
  try {
    recommendation = recommend(em, ep, opts);
  } catch (e) {
    if (e instanceof PricingEngineError) {
      throw new PricingError(409, 'model_invalid', `Model ${model.version} cannot price a country yet.`, { problems: e.problems });
    }
    throw e;
  }
  return { recommendation, source_digest: await sourceDigest(em, ep, opts), model, profile };
}

/**
 * Calculates and freezes a snapshot. A snapshot is written for an unavailable
 * recommendation too (`complete = 0`, its missing inputs listed, no figures),
 * so "we could not price this market on that day" is itself on record.
 */
export async function createSnapshot(
  env: Env, input: { modelUid: string; countryCode: string; allowProvisional?: boolean; actor: string },
): Promise<{ uid: string } & Preview> {
  const p = await previewRecommendation(env, input);
  const { recommendation: r, profile: pr, model } = p;
  // A draft can still be edited, so a snapshot naming it could stop reproducing. Only a frozen model is recorded.
  if (model.status === 'draft') throw new PricingError(409, 'model_not_frozen', `Model ${model.version} is a draft; activate it before recording a snapshot.`);
  const uid = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO country_pricing_snapshots (
       uid, country_code, pricing_model_uid, pricing_model_version,
       population, population_status, population_source, population_as_of,
       ppp_gdp_per_capita, ppp_status, ppp_source, ppp_as_of,
       startup_ecosystem_score, startup_ecosystem_rank, startup_score_status, startup_source, startup_as_of,
       regulatory_class, profile_revision,
       purchasing_power_factor, startup_ecosystem_factor, market_size_factor, country_index, tier, complete,
       provisional_inputs_json, missing_inputs_json,
       recommended_initial_fee_cents, recommended_annual_fee_cents, recommended_royalty_bps,
       recommended_minimum_royalty_cents, recommended_regulatory_surcharge_cents, currency, trace_json,
       source_digest, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uid, pr.country_code, model.uid, model.version,
    pr.population, pr.population_status, pr.population_source, pr.population_as_of,
    pr.ppp_gdp_per_capita, pr.ppp_status, pr.ppp_source, pr.ppp_as_of,
    pr.startup_ecosystem_score, pr.startup_ecosystem_rank, pr.startup_score_status, pr.startup_source, pr.startup_as_of,
    pr.regulatory_class, pr.revision,
    r.factors.purchasing_power, r.factors.startup_ecosystem, r.factors.market_size, r.country_index, r.tier, r.complete ? 1 : 0,
    JSON.stringify(r.provisional), JSON.stringify(r.missing),
    r.recommended_initial_fee_cents, r.recommended_annual_fee_cents, r.recommended_royalty_bps,
    r.recommended_minimum_royalty_cents, r.recommended_regulatory_surcharge_cents, r.currency, JSON.stringify(r.trace),
    p.source_digest, input.actor,
  ).run();
  return { uid, ...p };
}

/**
 * Recalculates a stored snapshot from ITS OWN columns and the (immutable) model
 * it names, and compares: the digest, the index and every recommended figure.
 * Nothing is read from the live profile, which may have changed since.
 */
export async function verifySnapshot(env: Env, uid: string): Promise<{ matches: boolean; stored_digest: string; recomputed_digest: string; differences: string[] }> {
  const row = await env.DB.prepare('SELECT * FROM country_pricing_snapshots WHERE uid = ?').bind(uid).first<Record<string, any>>();
  if (!row) throw new PricingError(404, 'not_found', 'No snapshot with that id.');
  const model = await getModel(env, String(row.pricing_model_uid));
  if (!model) throw new PricingError(409, 'model_missing', 'The model this snapshot names no longer exists.');
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const ep: EngineProfile = {
    country_code: String(row.country_code),
    population: n(row.population), population_status: row.population_status, population_source: row.population_source, population_as_of: row.population_as_of,
    ppp_gdp_per_capita: n(row.ppp_gdp_per_capita), ppp_status: row.ppp_status, ppp_source: row.ppp_source, ppp_as_of: row.ppp_as_of,
    startup_ecosystem_score: n(row.startup_ecosystem_score), startup_ecosystem_rank: n(row.startup_ecosystem_rank),
    startup_score_status: row.startup_score_status, startup_source: row.startup_source, startup_as_of: row.startup_as_of,
    regulatory_class: row.regulatory_class ?? null,
  };
  const trace = JSON.parse(String(row.trace_json || '{}'));
  const opts = { allowProvisional: trace.allow_provisional === true };
  const em = engineModelOf(model);
  const r = recommend(em, ep, opts);
  const recomputed = await sourceDigest(em, ep, opts);
  const differences: string[] = [];
  if (recomputed !== row.source_digest) differences.push('source_digest');
  const pairs: Array<[string, unknown, unknown]> = [
    ['country_index', n(row.country_index), r.country_index], ['tier', row.tier ?? null, r.tier],
    ['recommended_initial_fee_cents', n(row.recommended_initial_fee_cents), r.recommended_initial_fee_cents],
    ['recommended_annual_fee_cents', n(row.recommended_annual_fee_cents), r.recommended_annual_fee_cents],
    ['recommended_royalty_bps', n(row.recommended_royalty_bps), r.recommended_royalty_bps],
    ['recommended_minimum_royalty_cents', n(row.recommended_minimum_royalty_cents), r.recommended_minimum_royalty_cents],
    ['recommended_regulatory_surcharge_cents', n(row.recommended_regulatory_surcharge_cents), r.recommended_regulatory_surcharge_cents],
  ];
  for (const [k, a, b] of pairs) if (a !== b) differences.push(k);
  return { matches: differences.length === 0, stored_digest: String(row.source_digest), recomputed_digest: recomputed, differences };
}
