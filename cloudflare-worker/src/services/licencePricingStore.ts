/**
 * D5014 (#5014) — the country-pricing store: country market profiles, versioned
 * pricing models, frozen recommendation snapshots and licence pricing decisions
 * (migration 202611081906). Reads for HQ, plus the pricing-model lifecycle:
 * draft → active → retired.
 *
 * A RECOMMENDATION LAYER. Nothing here writes a licence term. Accepted values go
 * through the revision-safe licence terms write (#5017).
 *
 * IMMUTABILITY. A draft model may be edited. Activating it freezes it: the
 * migration's trigger refuses any later change to its calculation fields, so a
 * recommendation naming a model version can always be recalculated exactly. A
 * change to the model is a new version. Activating a draft retires the active
 * model in the same batch, so there is never a moment with two active models
 * (the partial unique index refuses it) or with none caused by a failed write.
 *
 * NUMBERS. Money is integer minor units, rates are basis points, factors are
 * millionths. A profile value that is not recorded is `null` with its status,
 * never 0.
 */
import type { Env } from '../types';
import { ISO2 } from './licenceLedgerCore';

export const MARKET_STATUSES = ['recorded', 'provisional', 'not_recorded'] as const;
export type MarketStatus = (typeof MARKET_STATUSES)[number];
export const REGULATORY_CLASSES = ['low', 'medium', 'high', 'very_high'] as const;
export type RegulatoryClass = (typeof REGULATORY_CLASSES)[number];
export const MODEL_STATUSES = ['draft', 'active', 'retired'] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

/** A refusal with a status and a stable code, for the routes to answer with. */
export class PricingError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  /** The sentence for the person, which this module wrote; never SQLite or provider text. */
  readonly sentence: string;
  constructor(status: 400 | 404 | 409, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(sentence);
    this.sentence = sentence;
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export type PricingModel = {
  uid: string;
  version: string;
  status: ModelStatus;
  currency: string;
  reference_annual_fee_cents: number;
  reference_initial_fee_cents: number;
  default_royalty_bps: number;
  minimum_royalty_ratio_bps: number;
  weight_purchasing_power_bps: number;
  weight_startup_ecosystem_bps: number;
  weight_market_size_bps: number;
  fee_rounding_cents: number;
  normalization: Record<string, unknown>;
  regulatory_surcharge: Record<string, unknown>;
  tier_thresholds: unknown[];
  note: string | null;
  effective_from: string;
  created_at: string;
  created_by: string | null;
  activated_at: string | null;
  activated_by: string | null;
  retired_at: string | null;
};

export type CountryProfile = {
  country_code: string;
  country_name: string;
  region_code: string | null;
  currency_code: string | null;
  population: number | null;
  population_status: MarketStatus;
  population_source: string | null;
  population_source_ref: string | null;
  population_as_of: string | null;
  ppp_gdp_per_capita: number | null;
  ppp_status: MarketStatus;
  ppp_source: string | null;
  ppp_source_ref: string | null;
  ppp_as_of: string | null;
  startup_ecosystem_score: number | null;
  startup_ecosystem_rank: number | null;
  startup_score_status: MarketStatus;
  startup_source: string | null;
  startup_source_ref: string | null;
  startup_as_of: string | null;
  regulatory_class: RegulatoryClass | null;
  regulatory_note: string | null;
  strategic_note: string | null;
  updated_at: string;
  updated_by: string | null;
  revision: number;
};

const parseJson = <T>(raw: unknown, fallback: T): T => {
  if (typeof raw !== 'string') return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

function modelOf(r: Record<string, any>): PricingModel {
  return {
    uid: String(r.uid), version: String(r.version), status: r.status, currency: String(r.currency),
    reference_annual_fee_cents: Number(r.reference_annual_fee_cents),
    reference_initial_fee_cents: Number(r.reference_initial_fee_cents),
    default_royalty_bps: Number(r.default_royalty_bps),
    minimum_royalty_ratio_bps: Number(r.minimum_royalty_ratio_bps),
    weight_purchasing_power_bps: Number(r.weight_purchasing_power_bps),
    weight_startup_ecosystem_bps: Number(r.weight_startup_ecosystem_bps),
    weight_market_size_bps: Number(r.weight_market_size_bps),
    fee_rounding_cents: Number(r.fee_rounding_cents),
    normalization: parseJson(r.normalization_json, {}),
    regulatory_surcharge: parseJson(r.regulatory_surcharge_json, {}),
    tier_thresholds: parseJson(r.tier_thresholds_json, []),
    note: r.note ?? null, effective_from: String(r.effective_from),
    created_at: String(r.created_at), created_by: r.created_by ?? null,
    activated_at: r.activated_at ?? null, activated_by: r.activated_by ?? null, retired_at: r.retired_at ?? null,
  };
}


export async function listModels(env: Env): Promise<PricingModel[]> {
  const res = await env.DB.prepare(
    `SELECT uid, version, status, currency, reference_annual_fee_cents, reference_initial_fee_cents, default_royalty_bps,
  minimum_royalty_ratio_bps, weight_purchasing_power_bps, weight_startup_ecosystem_bps, weight_market_size_bps, fee_rounding_cents,
  normalization_json, regulatory_surcharge_json, tier_thresholds_json, note, effective_from, created_at, created_by,
  activated_at, activated_by, retired_at FROM pricing_models
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, created_at DESC, uid`,
  ).all<Record<string, any>>();
  return (res.results || []).map(modelOf);
}

export async function getModel(env: Env, uid: string): Promise<PricingModel | null> {
  const r = await env.DB.prepare(`SELECT uid, version, status, currency, reference_annual_fee_cents, reference_initial_fee_cents, default_royalty_bps,
  minimum_royalty_ratio_bps, weight_purchasing_power_bps, weight_startup_ecosystem_bps, weight_market_size_bps, fee_rounding_cents,
  normalization_json, regulatory_surcharge_json, tier_thresholds_json, note, effective_from, created_at, created_by,
  activated_at, activated_by, retired_at FROM pricing_models WHERE uid = ?`).bind(uid).first<Record<string, any>>();
  return r ? modelOf(r) : null;
}

export async function activeModel(env: Env): Promise<PricingModel | null> {
  const r = await env.DB.prepare(`SELECT uid, version, status, currency, reference_annual_fee_cents, reference_initial_fee_cents, default_royalty_bps,
  minimum_royalty_ratio_bps, weight_purchasing_power_bps, weight_startup_ecosystem_bps, weight_market_size_bps, fee_rounding_cents,
  normalization_json, regulatory_surcharge_json, tier_thresholds_json, note, effective_from, created_at, created_by,
  activated_at, activated_by, retired_at FROM pricing_models WHERE status = 'active'`).first<Record<string, any>>();
  return r ? modelOf(r) : null;
}

// ── Model input ──────────────────────────────────────────────────────────────

const INT_FIELDS = [
  'reference_annual_fee_cents', 'reference_initial_fee_cents', 'default_royalty_bps', 'minimum_royalty_ratio_bps',
  'weight_purchasing_power_bps', 'weight_startup_ecosystem_bps', 'weight_market_size_bps', 'fee_rounding_cents',
] as const;
const BPS_FIELDS = new Set(['default_royalty_bps', 'minimum_royalty_ratio_bps', 'weight_purchasing_power_bps', 'weight_startup_ecosystem_bps', 'weight_market_size_bps']);
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ModelInput = {
  version: string;
  currency: string;
  reference_annual_fee_cents: number;
  reference_initial_fee_cents: number;
  default_royalty_bps: number;
  minimum_royalty_ratio_bps: number;
  weight_purchasing_power_bps: number;
  weight_startup_ecosystem_bps: number;
  weight_market_size_bps: number;
  fee_rounding_cents: number;
  normalization: Record<string, unknown>;
  regulatory_surcharge: Record<string, unknown>;
  tier_thresholds: unknown[];
  note: string | null;
  effective_from: string;
};

/**
 * A model body, validated whole. Every calculation field is required (a model
 * with a guessed default is not a model anyone chose), weights are basis points
 * that sum to exactly 10000, and money is a non-negative integer of minor units.
 * Returns the problems keyed by field rather than the first one.
 */
export function validateModelInput(body: unknown): { ok: true; value: ModelInput } | { ok: false; errors: Record<string, string> } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const out: Record<string, unknown> = {};
  const version = typeof b.version === 'string' ? b.version.trim() : '';
  if (!VERSION.test(version)) errors.version = 'version must be 1–40 letters, digits, dots, dashes or underscores';
  out.version = version;
  const currency = typeof b.currency === 'string' && b.currency.trim() ? b.currency.trim().toUpperCase() : 'EUR';
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'currency must be an ISO 4217 code';
  out.currency = currency;
  for (const f of INT_FIELDS) {
    const v = b[f];
    if (f === 'fee_rounding_cents' && (v === undefined || v === null)) { out[f] = 250000; continue; }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) { errors[f] = `${f} must be a non-negative integer`; continue; }
    if (BPS_FIELDS.has(f) && v > 10000) { errors[f] = `${f} is basis points, at most 10000`; continue; }
    if ((f === 'reference_annual_fee_cents' || f === 'fee_rounding_cents') && v === 0) { errors[f] = `${f} must be greater than zero`; continue; }
    out[f] = v;
  }
  const w = ['weight_purchasing_power_bps', 'weight_startup_ecosystem_bps', 'weight_market_size_bps'];
  if (w.every((f) => typeof out[f] === 'number')) {
    const sum = w.reduce((t, f) => t + (out[f] as number), 0);
    if (sum !== 10000) errors.weights = `the three weights must sum to 10000 basis points (they sum to ${sum})`;
  }
  for (const [f, kind] of [['normalization', 'object'], ['regulatory_surcharge', 'object'], ['tier_thresholds', 'array']] as const) {
    const v = b[f] ?? (kind === 'array' ? [] : {});
    const good = kind === 'array' ? Array.isArray(v) : (v !== null && typeof v === 'object' && !Array.isArray(v));
    if (!good) errors[f] = `${f} must be a JSON ${kind}`;
    out[f] = v;
  }
  const eff = typeof b.effective_from === 'string' ? b.effective_from.trim() : '';
  if (!DATE.test(eff) || Number.isNaN(Date.parse(`${eff}T00:00:00Z`))) errors.effective_from = 'effective_from must be a YYYY-MM-DD date';
  out.effective_from = eff;
  out.note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 2000) : null;
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: out as ModelInput };
}

export async function createDraftModel(env: Env, input: ModelInput, actor: string): Promise<PricingModel> {
  const uid = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO pricing_models (uid, version, status, currency, reference_annual_fee_cents, reference_initial_fee_cents,
         default_royalty_bps, minimum_royalty_ratio_bps, weight_purchasing_power_bps, weight_startup_ecosystem_bps,
         weight_market_size_bps, fee_rounding_cents, normalization_json, regulatory_surcharge_json, tier_thresholds_json,
         note, effective_from, created_by)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, input.version, input.currency, input.reference_annual_fee_cents, input.reference_initial_fee_cents,
      input.default_royalty_bps, input.minimum_royalty_ratio_bps, input.weight_purchasing_power_bps,
      input.weight_startup_ecosystem_bps, input.weight_market_size_bps, input.fee_rounding_cents,
      JSON.stringify(input.normalization), JSON.stringify(input.regulatory_surcharge), JSON.stringify(input.tier_thresholds),
      input.note, input.effective_from, actor).run();
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message))) throw new PricingError(409, 'version_taken', `A pricing model named ${input.version} already exists.`);
    throw e;
  }
  return (await getModel(env, uid))!;
}

/** Edits a DRAFT. An active or retired model is refused here, before the trigger would refuse it too. */
export async function updateDraftModel(env: Env, uid: string, input: ModelInput): Promise<PricingModel> {
  const before = await getModel(env, uid);
  if (!before) throw new PricingError(404, 'not_found', 'No pricing model with that id.');
  if (before.status !== 'draft') throw new PricingError(409, 'pricing_model_immutable', `Model ${before.version} is ${before.status}; publish a new version instead of editing it.`);
  try {
    const res = await env.DB.prepare(
      `UPDATE pricing_models SET version = ?, currency = ?, reference_annual_fee_cents = ?, reference_initial_fee_cents = ?,
         default_royalty_bps = ?, minimum_royalty_ratio_bps = ?, weight_purchasing_power_bps = ?, weight_startup_ecosystem_bps = ?,
         weight_market_size_bps = ?, fee_rounding_cents = ?, normalization_json = ?, regulatory_surcharge_json = ?,
         tier_thresholds_json = ?, note = ?, effective_from = ?
       WHERE uid = ? AND status = 'draft'`,
    ).bind(input.version, input.currency, input.reference_annual_fee_cents, input.reference_initial_fee_cents,
      input.default_royalty_bps, input.minimum_royalty_ratio_bps, input.weight_purchasing_power_bps,
      input.weight_startup_ecosystem_bps, input.weight_market_size_bps, input.fee_rounding_cents,
      JSON.stringify(input.normalization), JSON.stringify(input.regulatory_surcharge), JSON.stringify(input.tier_thresholds),
      input.note, input.effective_from, uid).run();
    if (!res.meta?.changes) throw new PricingError(409, 'pricing_model_immutable', 'The model was activated while you edited it; publish a new version.');
  } catch (e) {
    if (e instanceof PricingError) throw e;
    if (/UNIQUE/i.test(String((e as Error)?.message))) throw new PricingError(409, 'version_taken', `A pricing model named ${input.version} already exists.`);
    throw e;
  }
  return (await getModel(env, uid))!;
}

/**
 * Activates a draft and retires the model that was active, in one batch. The
 * retire is conditioned on the draft still being a draft, so a draft that was
 * activated (or deleted) by another request leaves the current model alone.
 */
export async function activateModel(env: Env, uid: string, actor: string): Promise<{ model: PricingModel; retired: string | null }> {
  const before = await getModel(env, uid);
  if (!before) throw new PricingError(404, 'not_found', 'No pricing model with that id.');
  if (before.status !== 'draft') throw new PricingError(409, 'not_draft', `Model ${before.version} is already ${before.status}.`);
  const previous = await activeModel(env);
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE pricing_models SET status = 'retired', retired_at = ?
        WHERE status = 'active' AND EXISTS (SELECT 1 FROM pricing_models d WHERE d.uid = ? AND d.status = 'draft')`,
    ).bind(now, uid),
    env.DB.prepare(`UPDATE pricing_models SET status = 'active', activated_at = ?, activated_by = ? WHERE uid = ? AND status = 'draft'`)
      .bind(now, actor, uid),
  ]);
  if (!results[1]?.meta?.changes) throw new PricingError(409, 'not_draft', 'The model is no longer a draft.');
  return { model: (await getModel(env, uid))!, retired: results[0]?.meta?.changes ? previous?.uid ?? null : null };
}

/** Retires the active model without a successor: recommendations then have no model, and say so. */
export async function retireModel(env: Env, uid: string): Promise<PricingModel> {
  const before = await getModel(env, uid);
  if (!before) throw new PricingError(404, 'not_found', 'No pricing model with that id.');
  if (before.status !== 'active') throw new PricingError(409, 'not_active', `Model ${before.version} is ${before.status}, not active.`);
  const res = await env.DB.prepare(`UPDATE pricing_models SET status = 'retired', retired_at = ? WHERE uid = ? AND status = 'active'`)
    .bind(new Date().toISOString(), uid).run();
  if (!res.meta?.changes) throw new PricingError(409, 'not_active', 'The model is no longer active.');
  return (await getModel(env, uid))!;
}

/** Deletes a DRAFT. Active and retired models are history and are never deleted. */
export async function deleteDraftModel(env: Env, uid: string): Promise<void> {
  const before = await getModel(env, uid);
  if (!before) throw new PricingError(404, 'not_found', 'No pricing model with that id.');
  if (before.status !== 'draft') throw new PricingError(409, 'pricing_model_immutable', `Model ${before.version} is ${before.status} and is kept.`);
  const used = await env.DB.prepare('SELECT 1 FROM country_pricing_snapshots WHERE pricing_model_uid = ? LIMIT 1').bind(uid).first();
  if (used) throw new PricingError(409, 'model_in_use', 'Snapshots were calculated with this draft; it is kept.');
  await env.DB.prepare(`DELETE FROM pricing_models WHERE uid = ? AND status = 'draft'`).bind(uid).run();
}

// ── Country profiles ─────────────────────────────────────────────────────────


function profileOf(r: Record<string, any>): CountryProfile {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    ...r,
    population: n(r.population), ppp_gdp_per_capita: n(r.ppp_gdp_per_capita),
    startup_ecosystem_score: n(r.startup_ecosystem_score), startup_ecosystem_rank: n(r.startup_ecosystem_rank),
    revision: Number(r.revision ?? 0),
  } as CountryProfile;
}

/** An upper-cased ISO 3166-1 alpha-2 code, or null; the licence ledger's own rule. */
export function countryCodeOf(raw: unknown): string | null {
  const c = String(raw ?? '').trim().toUpperCase();
  return ISO2.test(c) ? c : null;
}

/**
 * Every profile, or those matching `q` on code or name, and optionally only
 * those with a field still provisional or not recorded (`incomplete`).
 */
export async function listCountries(env: Env, opts: { q?: string; incomplete?: boolean } = {}): Promise<CountryProfile[]> {
  const q = (opts.q || '').trim().slice(0, 80);
  const like = `%${q.toLowerCase().replace(/[%_]/g, '')}%`;
  const res = await env.DB.prepare(
    `SELECT country_code, country_name, region_code, currency_code,
            population, population_status, population_source, population_source_ref, population_as_of,
            ppp_gdp_per_capita, ppp_status, ppp_source, ppp_source_ref, ppp_as_of,
            startup_ecosystem_score, startup_ecosystem_rank, startup_score_status, startup_source, startup_source_ref, startup_as_of,
            regulatory_class, regulatory_note, strategic_note, updated_at, updated_by, revision
       FROM country_market_profiles
      WHERE (? = '' OR country_code = ? OR lower(country_name) LIKE ?)
        AND (? = 0 OR population_status <> 'recorded' OR ppp_status <> 'recorded' OR startup_score_status <> 'recorded')
      ORDER BY country_name, country_code`,
  ).bind(q, q.toUpperCase(), like, opts.incomplete ? 1 : 0).all<Record<string, any>>();
  return (res.results || []).map(profileOf);
}

export async function getCountry(env: Env, code: string): Promise<CountryProfile | null> {
  const r = await env.DB.prepare(`SELECT country_code, country_name, region_code, currency_code,
  population, population_status, population_source, population_source_ref, population_as_of,
  ppp_gdp_per_capita, ppp_status, ppp_source, ppp_source_ref, ppp_as_of,
  startup_ecosystem_score, startup_ecosystem_rank, startup_score_status, startup_source, startup_source_ref, startup_as_of,
  regulatory_class, regulatory_note, strategic_note, updated_at, updated_by, revision FROM country_market_profiles WHERE country_code = ?`).bind(code).first<Record<string, any>>();
  return r ? profileOf(r) : null;
}

export type SnapshotSummary = {
  uid: string; country_code: string; pricing_model_uid: string; pricing_model_version: string;
  profile_revision: number; country_index: number | null; tier: string | null; complete: boolean;
  recommended_initial_fee_cents: number | null; recommended_annual_fee_cents: number | null;
  recommended_royalty_bps: number | null; recommended_minimum_royalty_cents: number | null;
  recommended_regulatory_surcharge_cents: number | null; currency: string; source_digest: string; created_at: string;
};

const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** A country's latest snapshots, newest first, as summaries; `limit` is clamped to 1–50. */
export async function recentSnapshots(env: Env, code: string, limit = 10): Promise<SnapshotSummary[]> {
  const res = await env.DB.prepare(
    `SELECT uid, country_code, pricing_model_uid, pricing_model_version, profile_revision, country_index, tier, complete,
            recommended_initial_fee_cents, recommended_annual_fee_cents, recommended_royalty_bps,
            recommended_minimum_royalty_cents, recommended_regulatory_surcharge_cents, currency, source_digest, created_at
       FROM country_pricing_snapshots WHERE country_code = ? ORDER BY created_at DESC, uid LIMIT ?`,
  ).bind(code, Math.max(1, Math.min(50, Math.floor(limit)))).all<Record<string, any>>();
  return (res.results || []).map((r) => ({
    uid: String(r.uid), country_code: String(r.country_code), pricing_model_uid: String(r.pricing_model_uid),
    pricing_model_version: String(r.pricing_model_version), profile_revision: Number(r.profile_revision),
    country_index: nOrNull(r.country_index), tier: r.tier ?? null, complete: Number(r.complete) === 1,
    recommended_initial_fee_cents: nOrNull(r.recommended_initial_fee_cents),
    recommended_annual_fee_cents: nOrNull(r.recommended_annual_fee_cents),
    recommended_royalty_bps: nOrNull(r.recommended_royalty_bps),
    recommended_minimum_royalty_cents: nOrNull(r.recommended_minimum_royalty_cents),
    recommended_regulatory_surcharge_cents: nOrNull(r.recommended_regulatory_surcharge_cents),
    currency: String(r.currency), source_digest: String(r.source_digest), created_at: String(r.created_at),
  }));
}

// ── Licence pricing decisions ────────────────────────────────────────────────

export type PricingDecision = {
  uid: string; licence_uid: string; snapshot_uid: string; currency: string;
  recommended: Record<'initial_fee_cents' | 'annual_fee_cents' | 'royalty_bps' | 'minimum_royalty_cents' | 'regulatory_surcharge_cents', number | null>;
  accepted: Record<'initial_fee_cents' | 'annual_fee_cents' | 'royalty_bps' | 'minimum_royalty_cents' | 'regulatory_surcharge_cents', number | null>;
  decision: 'accepted' | 'overridden'; override_reason: string | null; effective_from: string;
  created_at: string; created_by: string;
  snapshot: { pricing_model_version: string; country_code: string; source_digest: string } | null;
};

const VALUE_KEYS = ['initial_fee_cents', 'annual_fee_cents', 'royalty_bps', 'minimum_royalty_cents', 'regulatory_surcharge_cents'] as const;

/** Every decision recorded for a licence, newest first, each with the snapshot it was made from. */
export async function decisionsForLicence(env: Env, licenceUid: string): Promise<PricingDecision[]> {
  const res = await env.DB.prepare(
    `SELECT d.*, s.pricing_model_version AS s_version, s.country_code AS s_country, s.source_digest AS s_digest
       FROM licence_pricing_decisions d LEFT JOIN country_pricing_snapshots s ON s.uid = d.snapshot_uid
      WHERE d.licence_uid = ? ORDER BY d.created_at DESC, d.uid`,
  ).bind(licenceUid).all<Record<string, any>>();
  return (res.results || []).map((r) => ({
    uid: String(r.uid), licence_uid: String(r.licence_uid), snapshot_uid: String(r.snapshot_uid), currency: String(r.currency),
    recommended: Object.fromEntries(VALUE_KEYS.map((k) => [k, nOrNull(r[`recommended_${k}`])])) as PricingDecision['recommended'],
    accepted: Object.fromEntries(VALUE_KEYS.map((k) => [k, nOrNull(r[`accepted_${k}`])])) as PricingDecision['accepted'],
    decision: r.decision, override_reason: r.override_reason ?? null, effective_from: String(r.effective_from),
    created_at: String(r.created_at), created_by: String(r.created_by),
    snapshot: r.s_version ? { pricing_model_version: String(r.s_version), country_code: String(r.s_country), source_digest: String(r.s_digest) } : null,
  }));
}
