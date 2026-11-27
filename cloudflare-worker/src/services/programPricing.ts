/**
 * D5018 (#5018) — program prices from the country index, and the frozen grant
 * economics HQ accepts.
 *
 * THE CALCULATION (pure, `recommendProgramFee`):
 *   recommended = base × country index, clamped to [base × floor, base × ceiling]
 *   when the program sets them, then rounded to the program's increment or, when
 *   it sets none, the pricing model's. All in exact integer micro-cents; the
 *   unrounded value is kept in the trace.
 *
 * THE INDEX is the licence's own: the country index of D5017's licence snapshot
 * (the one HQ priced the licence package from), weighted by the basis' basket
 * weights when the licence covers several countries. So the licence and its
 * programs are priced from the same immutable snapshot unless HQ makes a newer
 * one.
 *
 * NO BASE IS NOT FREE. A program with no active reference price has no
 * recommendation; it reads "Not recorded", and a fee HQ sets for it anyway is
 * an override.
 *
 * FROZEN. A decision is append-only and names everything it came from. The
 * grant keeps `fee_cents` as its accepted price; a market refresh never touches
 * it, pausing and resuming do not reprice, and only a grant write (grant,
 * re-grant, change terms) records a new decision.
 */
import type { Env } from '../types';
import { PricingError, getModel } from './licencePricingStore';
import { divRound, roundToIncrement, PPM } from './licencePricing';
import { getLicenceSnapshot, latestLicenceSnapshot, type LicenceSnapshot } from './licencePricingApply';
import { isIsoDay } from './licenceTerms';
import { toCsv } from './csv';

const PPMn = BigInt(PPM);
const MAX_CENTS = 1_000_000_000_000;

export type PricingDefault = {
  uid: string; program_key: string; version: number; status: 'active' | 'retired'; currency: string;
  base_annual_fee_cents: number; base_initial_fee_cents: number | null;
  floor_multiplier_ppm: number | null; ceiling_multiplier_ppm: number | null; fee_rounding_cents: number | null;
  effective_from: string; reason: string; created_at: string; created_by: string; retired_at: string | null;
};

const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const defaultOf = (r: Record<string, any>): PricingDefault => ({
  uid: String(r.uid), program_key: String(r.program_key), version: Number(r.version), status: r.status, currency: String(r.currency),
  base_annual_fee_cents: Number(r.base_annual_fee_cents), base_initial_fee_cents: nOrNull(r.base_initial_fee_cents),
  floor_multiplier_ppm: nOrNull(r.floor_multiplier_ppm), ceiling_multiplier_ppm: nOrNull(r.ceiling_multiplier_ppm),
  fee_rounding_cents: nOrNull(r.fee_rounding_cents), effective_from: String(r.effective_from), reason: String(r.reason),
  created_at: String(r.created_at), created_by: String(r.created_by), retired_at: r.retired_at ?? null,
});

export async function allDefaults(env: Env): Promise<PricingDefault[]> {
  const r = await env.DB.prepare('SELECT * FROM program_pricing_defaults ORDER BY program_key, version DESC').all<Record<string, any>>();
  return (r.results || []).map(defaultOf);
}

export async function activeDefault(env: Env, programKey: string): Promise<PricingDefault | null> {
  const r = await env.DB.prepare("SELECT * FROM program_pricing_defaults WHERE program_key = ? AND status = 'active'").bind(programKey).first<Record<string, any>>();
  return r ? defaultOf(r) : null;
}

export async function getDefault(env: Env, uid: string): Promise<PricingDefault | null> {
  const r = await env.DB.prepare('SELECT * FROM program_pricing_defaults WHERE uid = ?').bind(uid).first<Record<string, any>>();
  return r ? defaultOf(r) : null;
}

export type DefaultInput = Pick<PricingDefault, 'currency' | 'base_annual_fee_cents' | 'base_initial_fee_cents' | 'floor_multiplier_ppm' | 'ceiling_multiplier_ppm' | 'fee_rounding_cents' | 'effective_from'>;

/** A reference price HQ publishes, checked. Nothing is coerced. */
export function validateDefaultBody(b: Record<string, unknown> | null): { ok: true; value: DefaultInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const x = b || {};
  const cents = (k: string, required: boolean, positive: boolean) => {
    const v = x[k];
    if (v === undefined || v === null) { if (required) errors[k] = 'is required, in whole cents'; return null; }
    if (typeof v === 'number' && Number.isSafeInteger(v) && v <= MAX_CENTS && (positive ? v > 0 : v >= 0)) return v;
    errors[k] = positive ? 'must be whole cents, more than 0' : 'must be whole cents, not negative';
    return null;
  };
  const ppm = (k: string) => {
    const v = x[k];
    if (v === undefined || v === null) return null;
    if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 100 * PPM) return v;
    errors[k] = 'must be a multiplier in millionths (0.8 = 800000), more than 0';
    return null;
  };
  const currency = typeof x.currency === 'string' && /^[A-Z]{3}$/.test(x.currency.trim().toUpperCase()) ? x.currency.trim().toUpperCase() : null;
  if (!currency) errors.currency = 'must be a three-letter currency code';
  const value: DefaultInput = {
    currency: currency || '',
    base_annual_fee_cents: cents('base_annual_fee_cents', true, true) as number,
    base_initial_fee_cents: cents('base_initial_fee_cents', false, false),
    floor_multiplier_ppm: ppm('floor_multiplier_ppm'),
    ceiling_multiplier_ppm: ppm('ceiling_multiplier_ppm'),
    fee_rounding_cents: cents('fee_rounding_cents', false, true),
    effective_from: isIsoDay(x.effective_from) ? (x.effective_from as string) : '',
  };
  if (!value.effective_from) errors.effective_from = 'must be a real date as YYYY-MM-DD';
  if (value.floor_multiplier_ppm !== null && value.ceiling_multiplier_ppm !== null && value.floor_multiplier_ppm > value.ceiling_multiplier_ppm) {
    errors.floor_multiplier_ppm = 'cannot be above the ceiling';
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/** Publishes the next version, retiring the active one in the same batch. `expectedVersion` is the active version read (0 for none). */
export async function publishDefault(env: Env, programKey: string, input: DefaultInput, expectedVersion: number, reason: string, actor: string): Promise<PricingDefault> {
  const current = await activeDefault(env, programKey);
  if ((current?.version ?? 0) !== expectedVersion) {
    throw new PricingError(409, 'default_conflict', 'This program\'s reference price changed since you opened it. Reload it.', { current });
  }
  const uid = crypto.randomUUID();
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  if (current) {
    stmts.push(env.DB.prepare("UPDATE program_pricing_defaults SET status = 'retired', retired_at = ? WHERE uid = ? AND status = 'active'").bind(now, current.uid));
  }
  stmts.push(env.DB.prepare(
    `INSERT INTO program_pricing_defaults (uid, program_key, version, status, currency, base_annual_fee_cents, base_initial_fee_cents,
       floor_multiplier_ppm, ceiling_multiplier_ppm, fee_rounding_cents, effective_from, reason, created_at, created_by)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, programKey, expectedVersion + 1, input.currency, input.base_annual_fee_cents, input.base_initial_fee_cents,
    input.floor_multiplier_ppm, input.ceiling_multiplier_ppm, input.fee_rounding_cents, input.effective_from, reason, now, actor));
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    // Two publishes raced: the unique (program, version) or the one-active index refused the second, whole.
    if (/UNIQUE|constraint/i.test(String((e as Error)?.message))) throw new PricingError(409, 'default_conflict', 'Another reference price was published at the same moment. Reload it.');
    throw e;
  }
  return (await getDefault(env, uid)) as PricingDefault;
}

// ── The recommendation ───────────────────────────────────────────────────────

export type ProgramRecommendation = {
  available: boolean;
  unavailable_reason: string | null;
  currency: string | null;
  base_annual_fee_cents: number | null;
  base_initial_fee_cents: number | null;
  country_index_ppm: number | null;
  recommended_annual_fee_cents: number | null;
  recommended_initial_fee_cents: number | null;
  trace: Record<string, unknown>;
};

function adjust(baseCents: number, indexPpm: number, d: Pick<PricingDefault, 'floor_multiplier_ppm' | 'ceiling_multiplier_ppm'>, rounding: number) {
  const base = BigInt(baseCents);
  let micro = base * BigInt(indexPpm); // cents × ppm = micro-cents
  const raw = micro;
  if (d.floor_multiplier_ppm !== null && micro < base * BigInt(d.floor_multiplier_ppm)) micro = base * BigInt(d.floor_multiplier_ppm);
  if (d.ceiling_multiplier_ppm !== null && micro > base * BigInt(d.ceiling_multiplier_ppm)) micro = base * BigInt(d.ceiling_multiplier_ppm);
  const rounded = roundToIncrement(micro, rounding);
  return {
    value: Number(rounded),
    trace: { base_cents: baseCents, index_ppm: indexPpm, unrounded_cents: Number(divRound(raw, PPMn)), unrounded_microcents: raw.toString(), clamped_microcents: micro.toString(), rounding_cents: rounding, rounded_cents: Number(rounded) },
  };
}

/** The program's country-adjusted price. Pure. */
export function recommendProgramFee(d: PricingDefault | null, index: { ppm: number | null; currency: string | null; rounding_cents: number | null; reason?: string | null }): ProgramRecommendation {
  const empty = { recommended_annual_fee_cents: null, recommended_initial_fee_cents: null };
  if (!d) {
    return { available: false, unavailable_reason: 'No reference price is recorded for this program.', currency: null, base_annual_fee_cents: null, base_initial_fee_cents: null, country_index_ppm: index.ppm, ...empty, trace: {} };
  }
  const base = { currency: d.currency, base_annual_fee_cents: d.base_annual_fee_cents, base_initial_fee_cents: d.base_initial_fee_cents, country_index_ppm: index.ppm };
  if (index.ppm === null) return { available: false, unavailable_reason: index.reason || 'The licence has no country recommendation to take an index from.', ...base, ...empty, trace: {} };
  if (index.currency && index.currency !== d.currency) {
    return { available: false, unavailable_reason: `The reference price is in ${d.currency} and the country recommendation in ${index.currency}; publish the reference price in ${index.currency}.`, ...base, ...empty, trace: {} };
  }
  const rounding = d.fee_rounding_cents ?? index.rounding_cents ?? 100;
  const annual = adjust(d.base_annual_fee_cents, index.ppm, d, rounding);
  const initial = d.base_initial_fee_cents === null ? null : adjust(d.base_initial_fee_cents, index.ppm, d, rounding);
  return {
    available: true, unavailable_reason: null, ...base,
    recommended_annual_fee_cents: annual.value,
    recommended_initial_fee_cents: initial ? initial.value : null,
    trace: { annual: annual.trace, initial: initial ? initial.trace : null, floor_multiplier_ppm: d.floor_multiplier_ppm, ceiling_multiplier_ppm: d.ceiling_multiplier_ppm, rounding_from: d.fee_rounding_cents === null ? 'model' : 'program' },
  };
}

/**
 * The licence snapshot's country index: one country's own, or the basket's
 * weighted index. Read from the frozen country snapshots it names, so it is the
 * index the licence was priced on. Null, with a reason, when any is unknown.
 */
export async function indexOfSnapshot(env: Env, snap: LicenceSnapshot | null): Promise<{ ppm: number | null; currency: string | null; rounding_cents: number | null; model_version: string | null; reason: string | null }> {
  if (!snap) return { ppm: null, currency: null, rounding_cents: null, model_version: null, reason: 'The licence has no country recommendation yet; refresh it under Country pricing.' };
  const model = await getModel(env, snap.pricing_model_uid);
  let sum = 0n;
  for (const c of snap.components) {
    const row = await env.DB.prepare('SELECT country_index FROM country_pricing_snapshots WHERE uid = ?').bind(c.snapshot_uid).first<{ country_index: number | null }>();
    if (!row || row.country_index === null || row.country_index === undefined) {
      return { ppm: null, currency: snap.currency, rounding_cents: model?.fee_rounding_cents ?? null, model_version: snap.pricing_model_version, reason: `No country index is recorded for ${c.country_code}.` };
    }
    sum += BigInt(row.country_index) * BigInt(c.weight_bps);
  }
  return { ppm: Number(divRound(sum, 10000n)), currency: snap.currency, rounding_cents: model?.fee_rounding_cents ?? null, model_version: snap.pricing_model_version, reason: null };
}

// ── Decisions ────────────────────────────────────────────────────────────────

export type PricingInput = {
  licence_snapshot_uid: string | null;
  accepted_annual_fee_cents: number | null;
  accepted_initial_fee_cents: number | null;
  override_reason: string | null;
  effective_from: string | null;
  effective_to: string | null;
};

/** The `pricing` object of a grant write, checked. Left out, the write records its fee as HQ's own (an override). */
export function validatePricingBody(raw: unknown): { ok: true; value: PricingInput | null } | { ok: false; errors: Record<string, string> } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: { pricing: 'must be an object' } };
  const b = raw as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const cents = (k: string) => {
    const v = b[k];
    if (v === undefined || v === null) return null;
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_CENTS) return v;
    errors[k] = 'must be whole cents, not negative';
    return null;
  };
  const snap = b.licence_snapshot_uid;
  if (snap !== undefined && snap !== null && !(typeof snap === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(snap))) errors.licence_snapshot_uid = 'is not a recommendation id';
  let override: string | null = null;
  if (b.override_reason !== undefined && b.override_reason !== null) {
    const s = typeof b.override_reason === 'string' ? b.override_reason.trim() : '';
    if (s.length < 3 || s.length > 1000) errors.override_reason = 'must be 3 to 1000 characters'; else override = s;
  }
  const day = (k: string) => {
    const v = b[k];
    if (v === undefined || v === null) return null;
    if (isIsoDay(v)) return v as string;
    errors[k] = 'must be a real date as YYYY-MM-DD';
    return null;
  };
  const value: PricingInput = {
    licence_snapshot_uid: typeof snap === 'string' ? snap : null,
    accepted_annual_fee_cents: cents('accepted_annual_fee_cents'),
    accepted_initial_fee_cents: cents('accepted_initial_fee_cents'),
    override_reason: override,
    effective_from: day('effective_from'),
    effective_to: day('effective_to'),
  };
  if (value.effective_from && value.effective_to && value.effective_to <= value.effective_from) errors.effective_to = 'must be after the effective date';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

export type ProgramPricingPlan = {
  decision: 'accepted' | 'overridden';
  fee_cents: number;
  currency: string;
  initial_fee_cents: number | null;
  override_reason: string | null;
  recommendation: ProgramRecommendation;
  default_uid: string | null;
  licence_snapshot_uid: string | null;
  model_version: string | null;
  effective_from: string;
  effective_to: string | null;
};

/**
 * What a grant write records about price. With `pricing`, the recommendation is
 * computed from the named (or the licence's latest) snapshot and either accepted
 * or overridden with a reason. Without it, a fee the write sets is HQ's own and
 * is recorded as an override whose reason is the write's own. Returns null when
 * the write sets no fee at all (nothing to record).
 */
export async function planProgramPricing(env: Env, a: {
  licenceUid: string; programKey: string; pricing: PricingInput | null; termsFee: number | null; termsCurrency: string | null;
  writeReason: string; startsOn: string | null; endsOn: string | null; today: string;
}): Promise<{ ok: true; plan: ProgramPricingPlan | null } | { ok: false; code: string; sentence: string }> {
  const d = await activeDefault(env, a.programKey);
  let snap: LicenceSnapshot | null = null;
  if (a.pricing?.licence_snapshot_uid) {
    snap = await getLicenceSnapshot(env, a.pricing.licence_snapshot_uid);
    if (!snap || snap.licence_uid !== a.licenceUid) return { ok: false, code: 'snapshot_not_found', sentence: 'No country recommendation with that id for this licence.' };
  } else {
    snap = await latestLicenceSnapshot(env, a.licenceUid);
  }
  const idx = await indexOfSnapshot(env, snap);
  const rec = recommendProgramFee(d, idx);
  const base = {
    recommendation: rec, default_uid: d?.uid ?? null, licence_snapshot_uid: snap?.uid ?? null, model_version: idx.model_version,
    effective_from: a.pricing?.effective_from ?? a.startsOn ?? a.today, effective_to: a.pricing?.effective_to ?? a.endsOn ?? null,
  };
  if (!a.pricing) {
    if (a.termsFee === null) return { ok: true, plan: null };
    const accepted = rec.available && a.termsFee === rec.recommended_annual_fee_cents && (a.termsCurrency ?? rec.currency) === rec.currency;
    return { ok: true, plan: { ...base, decision: accepted ? 'accepted' : 'overridden', fee_cents: a.termsFee, currency: a.termsCurrency ?? rec.currency ?? 'EUR', initial_fee_cents: null, override_reason: accepted ? null : a.writeReason } };
  }
  const fee = a.pricing.accepted_annual_fee_cents ?? rec.recommended_annual_fee_cents;
  if (fee === null) return { ok: false, code: 'accepted_value_required', sentence: rec.unavailable_reason ? `${rec.unavailable_reason} Give the accepted fee; it is recorded as an override.` : 'Give the accepted fee.' };
  const initial = a.pricing.accepted_initial_fee_cents ?? rec.recommended_initial_fee_cents;
  const differs = !rec.available || fee !== rec.recommended_annual_fee_cents || initial !== rec.recommended_initial_fee_cents;
  if (differs && !a.pricing.override_reason) {
    return { ok: false, code: 'override_reason_required', sentence: rec.available ? 'This fee differs from the recommendation: say why you are overriding it.' : 'There is no recommendation to accept, so this fee is an override: say why.' };
  }
  const currency = rec.currency ?? a.termsCurrency;
  if (!currency) return { ok: false, code: 'currency_required', sentence: 'Name the fee\'s currency in the terms: there is no reference price to take it from.' };
  return { ok: true, plan: { ...base, decision: differs ? 'overridden' : 'accepted', fee_cents: fee, currency, initial_fee_cents: initial, override_reason: differs ? a.pricing.override_reason : null } };
}

/**
 * The decision insert, for the grant write's own batch (after its decision
 * guard, so it lands only when the grant write did). The sequence is computed
 * in the statement, so two writes can never take the same number.
 */
export function decisionStatement(env: Env, a: {
  uid: string; licenceUid: string; programKey: string; grantUid: string | null; plan: ProgramPricingPlan; reason: string;
  grantTermsRevision: number | null; actor: string; now: string;
}): D1PreparedStatement {
  const p = a.plan;
  const r = p.recommendation;
  return env.DB.prepare(
    `INSERT INTO program_pricing_decisions (uid, licence_uid, program_key, grant_uid, sequence, pricing_default_uid, licence_snapshot_uid, pricing_model_version,
       country_index_ppm, currency, base_annual_fee_cents, recommended_annual_fee_cents, recommended_initial_fee_cents,
       accepted_annual_fee_cents, accepted_initial_fee_cents, decision, override_reason, reason, effective_from, effective_to,
       grant_terms_revision, trace_json, created_at, created_by)
     SELECT ?, ?, ?, ?, COALESCE((SELECT MAX(sequence) FROM program_pricing_decisions WHERE licence_uid = ? AND program_key = ?), 0) + 1,
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`,
  ).bind(
    a.uid, a.licenceUid, a.programKey, a.grantUid, a.licenceUid, a.programKey,
    p.default_uid, p.licence_snapshot_uid, p.model_version, r.country_index_ppm, p.currency, r.base_annual_fee_cents,
    r.recommended_annual_fee_cents, r.recommended_initial_fee_cents, p.fee_cents, p.initial_fee_cents, p.decision, p.override_reason,
    a.reason, p.effective_from, p.effective_to, a.grantTermsRevision, JSON.stringify(r.trace), a.now, a.actor,
  );
}

export type ProgramDecision = {
  uid: string; licence_uid: string; program_key: string; sequence: number; decision: 'accepted' | 'overridden';
  currency: string; base_annual_fee_cents: number | null; country_index_ppm: number | null; pricing_model_version: string | null;
  recommended_annual_fee_cents: number | null; recommended_initial_fee_cents: number | null;
  accepted_annual_fee_cents: number; accepted_initial_fee_cents: number | null;
  override_reason: string | null; reason: string; effective_from: string; effective_to: string | null;
  grant_terms_revision: number | null; created_at: string; created_by: string; trace: Record<string, unknown>;
};

const decisionOf = (r: Record<string, any>): ProgramDecision => {
  let trace: Record<string, unknown> = {};
  try { trace = JSON.parse(String(r.trace_json || '{}')); } catch { trace = {}; }
  return {
    uid: String(r.uid), licence_uid: String(r.licence_uid), program_key: String(r.program_key), sequence: Number(r.sequence), decision: r.decision,
    currency: String(r.currency), base_annual_fee_cents: nOrNull(r.base_annual_fee_cents), country_index_ppm: nOrNull(r.country_index_ppm),
    pricing_model_version: r.pricing_model_version ?? null, recommended_annual_fee_cents: nOrNull(r.recommended_annual_fee_cents),
    recommended_initial_fee_cents: nOrNull(r.recommended_initial_fee_cents), accepted_annual_fee_cents: Number(r.accepted_annual_fee_cents),
    accepted_initial_fee_cents: nOrNull(r.accepted_initial_fee_cents), override_reason: r.override_reason ?? null, reason: String(r.reason),
    effective_from: String(r.effective_from), effective_to: r.effective_to ?? null, grant_terms_revision: nOrNull(r.grant_terms_revision),
    created_at: String(r.created_at), created_by: String(r.created_by), trace,
  };
};

/** Decisions, newest first, filtered by licence and/or program. `limit` is clamped to 1–1000. */
export async function decisionsWhere(env: Env, f: { licenceUid?: string | null; programKey?: string | null; limit?: number }): Promise<ProgramDecision[]> {
  const lim = Math.max(1, Math.min(1000, Math.floor(f.limit ?? 200)));
  const r = await env.DB.prepare(
    `SELECT * FROM program_pricing_decisions
      WHERE (?1 IS NULL OR licence_uid = ?1) AND (?2 IS NULL OR program_key = ?2)
      ORDER BY created_at DESC, sequence DESC LIMIT ?3`,
  ).bind(f.licenceUid ?? null, f.programKey ?? null, lim).all<Record<string, any>>();
  return (r.results || []).map(decisionOf);
}

export const DECISION_CSV_HEADER = [
  'licence_uid', 'program_key', 'sequence', 'decision', 'currency', 'base_annual_fee_cents', 'country_index_ppm', 'pricing_model_version',
  'recommended_annual_fee_cents', 'accepted_annual_fee_cents', 'recommended_initial_fee_cents', 'accepted_initial_fee_cents',
  'override_reason', 'reason', 'effective_from', 'effective_to', 'grant_terms_revision', 'created_at', 'created_by',
] as const;

export function decisionsCsv(rows: ProgramDecision[]): string {
  return toCsv(DECISION_CSV_HEADER, rows.map((d) => DECISION_CSV_HEADER.map((k) => (d as any)[k] ?? '')));
}
