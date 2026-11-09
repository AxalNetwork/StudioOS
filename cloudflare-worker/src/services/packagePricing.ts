/**
 * D5023 (#5023, part 2 of #5021) — a package version's country-adjusted price, its bundle economics, and the
 * frozen record of both.
 *
 * THE CALCULATION (pure, `recommendPackage`), in exact integer micro-cents:
 *   1. recommended = package base annual fee × the licence's country index;
 *   2. clamped to [base × floor, base × ceiling] when the package version sets them;
 *   3. rounded to the pricing model's commercial increment (a package sets none of its own);
 *   4. the unrounded and clamped values are kept in the trace;
 *   5. compared with the sum of the included programs' own country-adjusted reference prices (D5018's
 *      `recommendProgramFee`, from the same index): the saving and the discount in basis points, or
 *      `bundle_value_warning` when the package costs more than its programs bought one by one.
 *
 * THE INDEX is the licence's own (D5017): its latest country recommendation — one country's index, or the
 * basket's weighted index under the recorded basis — unless HQ names an older snapshot, with a reason. So a
 * package is priced from the same snapshot and basket as the licence.
 *
 * WHAT A PACKAGE IS COMES FROM ITS VERSION. The included programs are the version's frozen
 * `program_package_items` (D5022), never the live program registry, so a program added since does not change a
 * version's price or its comparison.
 *
 * NO FAKE ZERO. A program with no reference price makes the standalone sum unknown, not smaller: the saving and
 * discount are then null, with a `missing_program_price` warning naming the programs.
 *
 * FROZEN. `createRecommendation` writes an append-only row naming every input. The same inputs (package version,
 * licence snapshot, program reference-price versions) give back the same row, so the same package version and
 * country snapshot always answer the same recommendation; a country-data update reaches only recommendations
 * made from a newer snapshot.
 */
import type { Env } from '../types';
import { divRound, roundToIncrement, PPM, canonicalJson } from './licencePricing';
import { activeDefault, indexOfSnapshot, recommendProgramFee, type PricingDefault, type ProgramRecommendation } from './programPricing';
import { getLicenceSnapshot, latestLicenceSnapshot, type LicenceSnapshot } from './licencePricingApply';
import type { ProgramPackageWithItems } from './licencePackagesStore';

const PPMn = BigInt(PPM);

/** A refusal with a status, a stable code and the sentence for the person. */
export class PackagePricingError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: string;
  readonly sentence: string;
  constructor(status: 400 | 404 | 409, code: string, sentence: string) {
    super(sentence);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
  }
}

export type PackageIndex = { ppm: number | null; currency: string | null; rounding_cents: number | null; model_version: string | null; reason: string | null };

export type Warning = { code: 'missing_program_price' | 'program_price_unavailable' | 'provisional_market_data' | 'bundle_value_warning'; sentence: string; detail?: Record<string, unknown> };

export type StandaloneProgram = {
  program_key: string;
  position: number;
  pricing_default_uid: string | null;
  pricing_default_version: number | null;
  base_annual_fee_cents: number | null;
  recommended_annual_fee_cents: number | null;
  unavailable_reason: string | null;
};

export type PackageRecommendation = {
  available: boolean;
  unavailable_reason: string | null;
  package_uid: string;
  package_key: string;
  package_version: number;
  currency: string;
  country_index_ppm: number | null;
  pricing_model_version: string | null;
  base_annual_fee_cents: number;
  recommended_annual_fee_cents: number | null;
  guidance_min_cents: number | null;
  guidance_max_cents: number | null;
  programs: StandaloneProgram[];
  standalone_sum_cents: number | null;
  bundle_saving_cents: number | null;
  bundle_discount_bps: number | null;
  bundle_value_warning: boolean;
  bundle_premium_cents: number | null;
  warnings: Warning[];
  trace: Record<string, unknown>;
};

/** base × index, clamped by the package's floor and ceiling, rounded. All in micro-cents until the round. */
function adjust(baseCents: number, indexPpm: number, floor: number | null, ceiling: number | null, rounding: number) {
  const base = BigInt(baseCents);
  const raw = base * BigInt(indexPpm);
  let micro = raw;
  let clamp: 'floor' | 'ceiling' | null = null;
  if (floor !== null && micro < base * BigInt(floor)) { micro = base * BigInt(floor); clamp = 'floor'; }
  if (ceiling !== null && micro > base * BigInt(ceiling)) { micro = base * BigInt(ceiling); clamp = 'ceiling'; }
  const rounded = Number(roundToIncrement(micro, rounding));
  return {
    value: rounded,
    trace: {
      base_cents: baseCents, index_ppm: indexPpm, unrounded_microcents: raw.toString(), unrounded_cents: Number(divRound(raw, PPMn)),
      floor_multiplier_ppm: floor, ceiling_multiplier_ppm: ceiling, clamped: clamp, clamped_microcents: micro.toString(),
      rounding_cents: rounding, rounded_cents: rounded,
    },
  };
}

/** A guidance bound moved by the country index, rounded the same way; never clamped (it is guidance, not a price). */
function guidance(cents: number | null, indexPpm: number, rounding: number): { value: number | null; unrounded_microcents: string | null } {
  if (cents === null) return { value: null, unrounded_microcents: null };
  const micro = BigInt(cents) * BigInt(indexPpm);
  return { value: Number(roundToIncrement(micro, rounding)), unrounded_microcents: micro.toString() };
}

/** Countries whose market inputs were provisional, from the licence snapshot's own trace. */
export function provisionalOf(snap: LicenceSnapshot | null): Array<{ country_code: string; inputs: string[] }> {
  const comps = Array.isArray((snap?.trace as any)?.components) ? (snap?.trace as any).components : [];
  return comps
    .filter((c: any) => Array.isArray(c?.provisional) && c.provisional.length)
    .map((c: any) => ({ country_code: String(c.country_code), inputs: c.provisional.map(String) }));
}

/**
 * The package version's recommendation. Pure: the same package version, index, program reference prices and
 * provisional list always give the same answer.
 */
export function recommendPackage(
  pkg: ProgramPackageWithItems,
  idx: PackageIndex,
  defaults: ReadonlyMap<string, PricingDefault | null>,
  provisional: Array<{ country_code: string; inputs: string[] }> = [],
): PackageRecommendation {
  const head = {
    package_uid: pkg.uid, package_key: pkg.package_key, package_version: pkg.version, currency: pkg.currency,
    country_index_ppm: idx.ppm, pricing_model_version: idx.model_version, base_annual_fee_cents: pkg.base_annual_fee_cents,
  };
  const none = {
    recommended_annual_fee_cents: null, guidance_min_cents: null, guidance_max_cents: null, programs: [] as StandaloneProgram[],
    standalone_sum_cents: null, bundle_saving_cents: null, bundle_discount_bps: null, bundle_value_warning: false, bundle_premium_cents: null,
    warnings: [] as Warning[], trace: {},
  };
  if (idx.ppm === null) return { available: false, unavailable_reason: idx.reason || 'The licence has no country index to price this package from.', ...head, ...none };
  if (idx.currency && idx.currency !== pkg.currency) {
    return { available: false, unavailable_reason: `This package version is priced in ${pkg.currency} and the licence's country recommendation in ${idx.currency}; publish a package version in ${idx.currency}.`, ...head, ...none };
  }
  const rounding = idx.rounding_cents ?? 100;
  const fee = adjust(pkg.base_annual_fee_cents, idx.ppm, pkg.floor_multiplier_ppm, pkg.ceiling_multiplier_ppm, rounding);
  const gMin = guidance(pkg.guidance_min_cents, idx.ppm, rounding);
  const gMax = guidance(pkg.guidance_max_cents, idx.ppm, rounding);

  // The standalone comparison: every program the version includes by default, priced as D5018 prices it alone.
  const included = pkg.items.filter((i) => i.included_by_default).sort((a, b) => a.position - b.position || a.program_key.localeCompare(b.program_key));
  const programs: StandaloneProgram[] = included.map((item) => {
    const d = defaults.get(item.program_key) ?? null;
    const rec: ProgramRecommendation = recommendProgramFee(d, { ppm: idx.ppm, currency: idx.currency, rounding_cents: idx.rounding_cents });
    return {
      program_key: item.program_key, position: item.position,
      pricing_default_uid: d?.uid ?? null, pricing_default_version: d?.version ?? null,
      base_annual_fee_cents: d?.base_annual_fee_cents ?? null,
      recommended_annual_fee_cents: rec.available ? rec.recommended_annual_fee_cents : null,
      unavailable_reason: rec.available ? null : rec.unavailable_reason,
    };
  });
  const warnings: Warning[] = [];
  const missing = programs.filter((p) => p.pricing_default_uid === null).map((p) => p.program_key);
  const unpriced = programs.filter((p) => p.pricing_default_uid !== null && p.recommended_annual_fee_cents === null);
  if (missing.length) {
    warnings.push({ code: 'missing_program_price', sentence: `No reference price is recorded for ${missing.join(', ')}, so the programs' standalone total is not known and no saving is shown.`, detail: { programs: missing } });
  }
  if (unpriced.length) {
    warnings.push({ code: 'program_price_unavailable', sentence: `No standalone price could be worked out for ${unpriced.map((p) => p.program_key).join(', ')}: ${unpriced.map((p) => p.unavailable_reason).join(' ')}`, detail: { programs: unpriced.map((p) => p.program_key) } });
  }
  if (provisional.length) {
    warnings.push({ code: 'provisional_market_data', sentence: `The country index uses provisional market data for ${provisional.map((p) => `${p.country_code} (${p.inputs.join(', ')})`).join(', ')}.`, detail: { countries: provisional } });
  }

  let sum: number | null = null;
  let saving: number | null = null;
  let discount: number | null = null;
  let premium: number | null = null;
  let valueWarning = false;
  if (programs.length && programs.every((p) => p.recommended_annual_fee_cents !== null)) {
    sum = programs.reduce((a, p) => a + (p.recommended_annual_fee_cents as number), 0);
    if (fee.value > sum) {
      valueWarning = true;
      premium = fee.value - sum;
      warnings.push({ code: 'bundle_value_warning', sentence: `This package costs more than its programs bought one by one (by ${premium} cents), so it is shown with no discount.`, detail: { premium_cents: premium } });
    } else {
      saving = sum - fee.value;
      discount = sum === 0 ? 0 : Number(divRound(BigInt(saving) * 10000n, BigInt(sum)));
    }
  }
  return {
    available: true, unavailable_reason: null, ...head,
    recommended_annual_fee_cents: fee.value, guidance_min_cents: gMin.value, guidance_max_cents: gMax.value,
    programs, standalone_sum_cents: sum, bundle_saving_cents: saving, bundle_discount_bps: discount,
    bundle_value_warning: valueWarning, bundle_premium_cents: premium, warnings,
    trace: {
      annual: fee.trace,
      guidance: { min_unrounded_microcents: gMin.unrounded_microcents, max_unrounded_microcents: gMax.unrounded_microcents, rounding_cents: rounding },
      rounding_from: 'model',
      standalone: { programs: programs.map((p) => ({ program_key: p.program_key, pricing_default_uid: p.pricing_default_uid, recommended_annual_fee_cents: p.recommended_annual_fee_cents })), sum_cents: sum },
    },
  };
}

/** The included programs' active reference prices, read once. */
export async function defaultsFor(env: Env, pkg: ProgramPackageWithItems): Promise<Map<string, PricingDefault | null>> {
  const out = new Map<string, PricingDefault | null>();
  for (const item of pkg.items) if (item.included_by_default && !out.has(item.program_key)) out.set(item.program_key, await activeDefault(env, item.program_key));
  return out;
}

/** The licence snapshot to price from: the latest, or an older one HQ names with a reason. */
export async function snapshotFor(env: Env, licenceUid: string, requested: { uid: string | null; reason: string | null }): Promise<{ snap: LicenceSnapshot; latest: boolean }> {
  const latest = await latestLicenceSnapshot(env, licenceUid);
  if (!requested.uid) {
    if (!latest) throw new PackagePricingError(409, 'no_licence_snapshot', 'This licence has no country recommendation yet. Make one under Country pricing first.');
    return { snap: latest, latest: true };
  }
  const snap = await getLicenceSnapshot(env, requested.uid);
  if (!snap || snap.licence_uid !== licenceUid) throw new PackagePricingError(404, 'snapshot_not_found', 'No country recommendation with that id for this licence.');
  const isLatest = latest?.uid === snap.uid;
  if (!isLatest && !requested.reason) {
    throw new PackagePricingError(400, 'snapshot_reason_required', 'This is not the licence\'s latest country recommendation. Say why the package is priced from it.');
  }
  return { snap, latest: isLatest };
}

export type StoredRecommendation = PackageRecommendation & {
  uid: string; licence_uid: string; licence_snapshot_uid: string; snapshot_is_latest: boolean; snapshot_reason: string | null;
  created_at: string; created_by: string;
};

const parse = (s: unknown, d: unknown) => { try { return JSON.parse(String(s)); } catch { return d; } };
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function storedOf(r: Record<string, any>): StoredRecommendation {
  const warnings = parse(r.warnings_json, []) as Warning[];
  const sum = n(r.standalone_sum_cents);
  const fee = Number(r.recommended_annual_fee_cents);
  return {
    uid: String(r.uid), licence_uid: String(r.licence_uid), licence_snapshot_uid: String(r.licence_snapshot_uid),
    snapshot_is_latest: Number(r.snapshot_is_latest) === 1, snapshot_reason: r.snapshot_reason ?? null,
    available: true, unavailable_reason: null,
    package_uid: String(r.package_uid), package_key: String(r.package_key), package_version: Number(r.package_version),
    currency: String(r.currency), country_index_ppm: Number(r.country_index_ppm), pricing_model_version: String(r.pricing_model_version),
    base_annual_fee_cents: Number(r.base_annual_fee_cents), recommended_annual_fee_cents: fee,
    guidance_min_cents: n(r.guidance_min_cents), guidance_max_cents: n(r.guidance_max_cents),
    programs: parse(r.programs_json, []), standalone_sum_cents: sum,
    bundle_saving_cents: n(r.bundle_saving_cents), bundle_discount_bps: n(r.bundle_saving_bps),
    bundle_value_warning: Number(r.bundle_value_warning) === 1,
    bundle_premium_cents: Number(r.bundle_value_warning) === 1 && sum !== null ? fee - sum : null,
    warnings, trace: parse(r.trace_json, {}),
    created_at: String(r.created_at), created_by: String(r.created_by),
  };
}

/** Every input the recommendation depends on, as one digest. */
export async function inputsKey(licenceUid: string, snapshotUid: string, rec: PackageRecommendation): Promise<string> {
  const doc = canonicalJson({
    licence_uid: licenceUid, licence_snapshot_uid: snapshotUid, package_uid: rec.package_uid,
    defaults: rec.programs.map((p) => [p.program_key, p.pricing_default_uid]),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(doc));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getRecommendation(env: Env, uid: string): Promise<StoredRecommendation | null> {
  const r = await env.DB.prepare('SELECT * FROM package_pricing_recommendations WHERE uid = ?').bind(uid).first<Record<string, any>>();
  return r ? storedOf(r) : null;
}

/** A licence's recommendations, newest first, optionally for one package key. */
export async function recommendationsFor(env: Env, licenceUid: string, packageKey: string | null): Promise<StoredRecommendation[]> {
  const r = await env.DB.prepare(
    `SELECT * FROM package_pricing_recommendations
      WHERE licence_uid = ?1 AND (?2 IS NULL OR package_key = ?2)
      ORDER BY created_at DESC, uid DESC LIMIT 500`,
  ).bind(licenceUid, packageKey).all<Record<string, any>>();
  return (r.results || []).map(storedOf);
}

/**
 * Prices the package version for the licence and freezes it. The same inputs return the row already made
 * (`created: false`); anything else is a new row.
 */
export async function createRecommendation(env: Env, a: {
  licenceUid: string; pkg: ProgramPackageWithItems; snapshotUid: string | null; snapshotReason: string | null; actor: string;
}): Promise<{ recommendation: StoredRecommendation; created: boolean }> {
  const { snap, latest } = await snapshotFor(env, a.licenceUid, { uid: a.snapshotUid, reason: a.snapshotReason });
  const idx = await indexOfSnapshot(env, snap);
  const rec = recommendPackage(a.pkg, idx, await defaultsFor(env, a.pkg), provisionalOf(snap));
  if (!rec.available) throw new PackagePricingError(409, 'package_price_unavailable', rec.unavailable_reason as string);
  const key = await inputsKey(a.licenceUid, snap.uid, rec);
  const existing = await env.DB.prepare('SELECT uid FROM package_pricing_recommendations WHERE inputs_key = ?').bind(key).first<{ uid: string }>();
  if (existing) return { recommendation: (await getRecommendation(env, existing.uid)) as StoredRecommendation, created: false };
  const uid = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO package_pricing_recommendations (uid, licence_uid, package_uid, package_key, package_version, licence_snapshot_uid,
         snapshot_is_latest, snapshot_reason, pricing_model_version, country_index_ppm, currency, base_annual_fee_cents,
         recommended_annual_fee_cents, guidance_min_cents, guidance_max_cents, standalone_sum_cents, bundle_saving_cents,
         bundle_saving_bps, bundle_value_warning, inputs_key, programs_json, warnings_json, trace_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      uid, a.licenceUid, rec.package_uid, rec.package_key, rec.package_version, snap.uid,
      latest ? 1 : 0, latest ? null : a.snapshotReason, rec.pricing_model_version ?? snap.pricing_model_version, rec.country_index_ppm, rec.currency,
      rec.base_annual_fee_cents, rec.recommended_annual_fee_cents, rec.guidance_min_cents, rec.guidance_max_cents, rec.standalone_sum_cents,
      rec.bundle_saving_cents, rec.bundle_discount_bps, rec.bundle_value_warning ? 1 : 0, key,
      JSON.stringify(rec.programs), JSON.stringify(rec.warnings), JSON.stringify(rec.trace), a.actor,
    ).run();
  } catch (e) {
    // Two identical requests raced: the unique inputs key kept one, and that one is the answer.
    if (/UNIQUE|constraint/i.test(String((e as Error)?.message))) {
      const row = await env.DB.prepare('SELECT uid FROM package_pricing_recommendations WHERE inputs_key = ?').bind(key).first<{ uid: string }>();
      if (row) return { recommendation: (await getRecommendation(env, row.uid)) as StoredRecommendation, created: false };
    }
    throw e;
  }
  return { recommendation: (await getRecommendation(env, uid)) as StoredRecommendation, created: true };
}
