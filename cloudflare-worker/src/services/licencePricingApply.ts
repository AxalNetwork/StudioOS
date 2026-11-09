/**
 * D5017 (#5017) — country pricing reaches a licence: its pricing basis, its
 * frozen recommendation, HQ's apply or override, and the annual review.
 *
 * A RECOMMENDATION NEVER CHANGES A LICENCE. A snapshot, a refresh or a review
 * writes only its own rows. The one write that changes `territory_licences` is
 * `applyStatements`, and it is the D4694 revision-safe terms write: it names the
 * `terms_revision` the editor read, and a stale one changes no row and records
 * no decision (the decision insert is guarded by the same revision, in the same
 * batch, so the two land together or not at all).
 *
 * WHAT AN APPLY WRITES. The licence's core terms hold two of the five figures:
 * the annual fee (`annual_fee_cents`) and the royalty (`revenue_share_bps`).
 * The initial fee, the minimum royalty and the regulatory surcharge have no
 * core-term column; they are recorded as accepted on the decision and shown,
 * never written anywhere they would be invoiced. Issued invoices
 * (`licence_fee_invoices`) and executed agreements (`licence_contracts`) are
 * never touched: future invoices read the annual fee under their own rules,
 * and a changed contractual figure marks the agreement as no longer matching,
 * which HQ resolves through the existing replacement (instantiate a new
 * contract, which supersedes the current one).
 *
 * NO INVISIBLE AVERAGE. One country prices itself. Several need a recorded
 * basis (`primary_country`, `basket_weighted` with weights totalling 10000
 * basis points, or `hq_override`), and the weights used are frozen on the
 * snapshot.
 */
import type { Env } from '../types';
import { PricingError, activeModel } from './licencePricingStore';
import { createSnapshot } from './licencePricingSnapshots';
import { divRound, roundToIncrement } from './licencePricing';
import { isIsoDay } from './licenceTerms';
import type { LicenceRow } from './licenceLedgerCore';

export const BASES = ['primary_country', 'basket_weighted', 'hq_override'] as const;
export type Basis = (typeof BASES)[number];
export const VALUE_KEYS = ['initial_fee_cents', 'annual_fee_cents', 'royalty_bps', 'minimum_royalty_cents', 'regulatory_surcharge_cents'] as const;
export type ValueKey = (typeof VALUE_KEYS)[number];
export type Values = Record<ValueKey, number | null>;
/** The figures an apply writes into the licence's core terms, and the column each lands in. */
export const CONTRACTUAL: ReadonlyArray<{ key: ValueKey; column: 'annual_fee_cents' | 'revenue_share_bps' }> = [
  { key: 'annual_fee_cents', column: 'annual_fee_cents' },
  { key: 'royalty_bps', column: 'revenue_share_bps' },
];
export const REVIEW_ACTIONS = ['keep', 'postpone'] as const;
const MAX_CENTS = 1_000_000_000_000;

export type Policy = { licence_uid: string; basis: Basis; primary_country: string | null; weights: Record<string, number>; reason: string; revision: number; updated_at: string; updated_by: string };
export type Effective = { basis: Basis; primary_country: string | null; weights: Record<string, number>; policy_revision: number; implied: boolean };

// ── The basis ────────────────────────────────────────────────────────────────

export async function territoryOf(env: Env, licenceId: number): Promise<string[]> {
  const r = await env.DB.prepare('SELECT country_code FROM licence_territories WHERE licence_id = ? ORDER BY country_code').bind(licenceId).all<{ country_code: string }>();
  return (r.results || []).map((x) => String(x.country_code));
}

export async function policyOf(env: Env, licenceUid: string): Promise<Policy | null> {
  const r = await env.DB.prepare('SELECT * FROM licence_pricing_policies WHERE licence_uid = ?').bind(licenceUid).first<Record<string, any>>();
  if (!r) return null;
  let weights: Record<string, number> = {};
  try { weights = JSON.parse(String(r.weights_json || '{}')); } catch { weights = {}; }
  return {
    licence_uid: String(r.licence_uid), basis: r.basis, primary_country: r.primary_country ?? null, weights,
    reason: String(r.reason), revision: Number(r.revision), updated_at: String(r.updated_at), updated_by: String(r.updated_by),
  };
}

/** Why a basis cannot price this territory, in a sentence; null when it can. */
export function basisProblem(p: { basis: Basis; primary_country: string | null; weights: Record<string, number> }, territory: string[]): string | null {
  if (!territory.length) return 'This licence has no territory yet, so there is no country to price it from.';
  if (p.basis === 'basket_weighted') {
    const keys = Object.keys(p.weights).sort();
    if (keys.join(',') !== [...territory].sort().join(',')) return `The basket names ${keys.join(', ') || 'no country'}, but the territory is ${territory.join(', ')}. Give every country of the territory a weight.`;
    const total = keys.reduce((a, k) => a + p.weights[k], 0);
    if (total !== 10000) return `The weights total ${total} basis points; they must total 10000.`;
    return null;
  }
  if (!p.primary_country || !territory.includes(p.primary_country)) return `The pricing country ${p.primary_country ?? '(none)'} is not in the territory (${territory.join(', ')}).`;
  return null;
}

/** The basis that prices the licence now, or a refusal. One country with no recorded basis is priced from that country. */
export function effectiveBasis(policy: Policy | null, territory: string[]): { ok: true; value: Effective } | { ok: false; code: string; sentence: string } {
  if (!policy) {
    if (territory.length === 1) return { ok: true, value: { basis: 'primary_country', primary_country: territory[0], weights: { [territory[0]]: 10000 }, policy_revision: 0, implied: true } };
    if (!territory.length) return { ok: false, code: 'no_territory', sentence: 'This licence has no territory yet, so there is no country to price it from.' };
    return { ok: false, code: 'pricing_basis_required', sentence: `This licence covers ${territory.length} countries (${territory.join(', ')}). Record a pricing basis first: one pricing country, a weighted basket, or HQ-set figures.` };
  }
  const problem = basisProblem(policy, territory);
  if (problem) return { ok: false, code: 'pricing_basis_stale', sentence: `${problem} The territory changed since the basis was recorded; record it again.` };
  const weights = policy.basis === 'basket_weighted' ? policy.weights : { [policy.primary_country as string]: 10000 };
  return { ok: true, value: { basis: policy.basis, primary_country: policy.primary_country, weights, policy_revision: policy.revision, implied: false } };
}

/** A basis a person sent, checked against the territory. */
export function validatePolicyBody(body: Record<string, unknown> | null, territory: string[]):
  { ok: true; value: { basis: Basis; primary_country: string | null; weights: Record<string, number> } } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const basis = body?.basis;
  if (typeof basis !== 'string' || !(BASES as readonly string[]).includes(basis)) {
    return { ok: false, errors: { basis: `must be one of ${BASES.join(', ')}` } };
  }
  let primary: string | null = null;
  const weights: Record<string, number> = {};
  if (basis === 'basket_weighted') {
    const raw = body?.weights;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) errors.weights = 'must be an object of country code to basis points';
    else {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const code = k.trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(code)) { errors[`weights.${k}`] = 'is not an ISO 3166-1 alpha-2 code'; continue; }
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 10000) { errors[`weights.${k}`] = 'must be whole basis points from 1 to 10000'; continue; }
        weights[code] = v;
      }
    }
  } else {
    const raw = typeof body?.primary_country === 'string' ? body.primary_country.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(raw)) errors.primary_country = 'must be an ISO 3166-1 alpha-2 code';
    else primary = raw;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const value = { basis: basis as Basis, primary_country: primary, weights };
  const problem = basisProblem(value, territory);
  if (problem) return { ok: false, errors: { [basis === 'basket_weighted' ? 'weights' : 'primary_country']: problem } };
  return { ok: true, value };
}

// ── Combining country recommendations ────────────────────────────────────────

export type Component = { country_code: string; weight_bps: number; snapshot_uid: string; available: boolean; values: Values; unavailable_reason: string | null; provisional: string[]; country_index?: number | null; tier?: string | null };

/**
 * The licence's figures from its countries' figures, weighted. Pure. Any
 * country without a recommendation makes the whole recommendation unavailable:
 * a basket is never priced from the countries that happen to have data. Fees
 * are re-rounded to the model's commercial increment; the unrounded weighted
 * value is kept in the trace.
 */
export function combine(components: Component[], feeRoundingCents: number): { available: boolean; unavailable_reason: string | null; values: Values; trace: Record<string, unknown> } {
  const empty: Values = { initial_fee_cents: null, annual_fee_cents: null, royalty_bps: null, minimum_royalty_cents: null, regulatory_surcharge_cents: null };
  const missing = components.filter((c) => !c.available);
  if (!components.length || missing.length) {
    const reason = missing.length
      ? `No recommendation for ${missing.map((c) => c.country_code).join(', ')}: ${missing.map((c) => c.unavailable_reason || 'inputs not recorded').join(' ')}`
      : 'No country to price.';
    return { available: false, unavailable_reason: reason, values: empty, trace: { components: components.map((c) => ({ country_code: c.country_code, weight_bps: c.weight_bps, available: c.available })) } };
  }
  const values: Values = { ...empty };
  const unrounded: Record<string, string> = {};
  for (const k of VALUE_KEYS) {
    // A component with no figure for this key (an unrecorded regulatory class gives no surcharge) leaves it unknown.
    if (components.some((c) => c.values[k] === null)) { values[k] = null; continue; }
    const sum = components.reduce((a, c) => a + BigInt(c.values[k] as number) * BigInt(c.weight_bps), 0n);
    if (k === 'initial_fee_cents' || k === 'annual_fee_cents') {
      // sum is cents × bps; cents → micro-cents is × 10^6, ÷ 10^4 for the weights: × 100.
      unrounded[k] = (Number(sum) / 10000).toString();
      values[k] = components.length === 1 ? (components[0].values[k] as number) : Number(roundToIncrement(sum * 100n, feeRoundingCents));
    } else {
      values[k] = Number(divRound(sum, 10000n));
    }
  }
  return {
    available: true, unavailable_reason: null, values,
    trace: {
      components: components.map((c) => ({ country_code: c.country_code, weight_bps: c.weight_bps, snapshot_uid: c.snapshot_uid, country_index: c.country_index ?? null, tier: c.tier ?? null, values: c.values, provisional: c.provisional })),
      unrounded_fees: unrounded, fee_rounding_cents: feeRoundingCents,
    },
  };
}

// ── The licence snapshot ─────────────────────────────────────────────────────

export type LicenceSnapshot = {
  uid: string; licence_uid: string; basis: Basis; policy_revision: number; territory: string[];
  components: Array<{ country_code: string; weight_bps: number; snapshot_uid: string }>;
  lead_snapshot_uid: string; pricing_model_uid: string; pricing_model_version: string; currency: string;
  available: boolean; unavailable_reason: string | null; recommended: Values; trace: Record<string, unknown>;
  created_at: string; created_by: string;
};

const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function snapshotOf(r: Record<string, any>): LicenceSnapshot {
  const j = (s: unknown, d: unknown) => { try { return JSON.parse(String(s)); } catch { return d; } };
  return {
    uid: String(r.uid), licence_uid: String(r.licence_uid), basis: r.basis, policy_revision: Number(r.policy_revision),
    territory: j(r.territory_json, []), components: j(r.components_json, []), lead_snapshot_uid: String(r.lead_snapshot_uid),
    pricing_model_uid: String(r.pricing_model_uid), pricing_model_version: String(r.pricing_model_version), currency: String(r.currency),
    available: Number(r.available) === 1, unavailable_reason: r.unavailable_reason ?? null,
    recommended: Object.fromEntries(VALUE_KEYS.map((k) => [k, nOrNull(r[`recommended_${k}`])])) as Values,
    trace: j(r.trace_json, {}), created_at: String(r.created_at), created_by: String(r.created_by),
  };
}

export async function getLicenceSnapshot(env: Env, uid: string): Promise<LicenceSnapshot | null> {
  const r = await env.DB.prepare('SELECT * FROM licence_pricing_snapshots WHERE uid = ?').bind(uid).first<Record<string, any>>();
  return r ? snapshotOf(r) : null;
}

export async function latestLicenceSnapshot(env: Env, licenceUid: string): Promise<LicenceSnapshot | null> {
  const r = await env.DB.prepare('SELECT * FROM licence_pricing_snapshots WHERE licence_uid = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').bind(licenceUid).first<Record<string, any>>();
  return r ? snapshotOf(r) : null;
}

/**
 * A fresh recommendation for the licence, frozen: one country snapshot per
 * country of the basis (D5015's `createSnapshot`, under the ACTIVE model), then
 * the combined row. Writes no licence term.
 */
export async function createLicenceSnapshot(env: Env, licence: LicenceRow, eff: Effective, actor: string, opts: { allowProvisional?: boolean } = {}): Promise<LicenceSnapshot> {
  const model = await activeModel(env);
  if (!model) throw new PricingError(409, 'no_active_model', 'No pricing model is active, so there is nothing to recommend from. Activate one under Country pricing.');
  const territory = await territoryOf(env, licence.id);
  const countries = Object.keys(eff.weights).sort();
  const components: Component[] = [];
  for (const code of countries) {
    const s = await createSnapshot(env, { modelUid: model.uid, countryCode: code, allowProvisional: opts.allowProvisional === true, actor });
    const r = s.recommendation;
    components.push({
      country_code: code, weight_bps: eff.weights[code], snapshot_uid: s.uid, available: r.available, unavailable_reason: r.unavailable_reason, provisional: r.provisional,
      country_index: r.country_index, tier: r.tier,
      values: {
        initial_fee_cents: r.recommended_initial_fee_cents, annual_fee_cents: r.recommended_annual_fee_cents, royalty_bps: r.recommended_royalty_bps,
        minimum_royalty_cents: r.recommended_minimum_royalty_cents, regulatory_surcharge_cents: r.recommended_regulatory_surcharge_cents,
      },
    });
  }
  const c = combine(components, model.fee_rounding_cents);
  const lead = [...components].sort((a, b) => b.weight_bps - a.weight_bps || a.country_code.localeCompare(b.country_code))[0];
  const uid = crypto.randomUUID();
  const trace = { ...c.trace, basis: eff.basis, implied_basis: eff.implied, allow_provisional: opts.allowProvisional === true };
  await env.DB.prepare(
    `INSERT INTO licence_pricing_snapshots (uid, licence_uid, basis, policy_revision, territory_json, components_json, lead_snapshot_uid,
       pricing_model_uid, pricing_model_version, currency, available, unavailable_reason,
       recommended_initial_fee_cents, recommended_annual_fee_cents, recommended_royalty_bps, recommended_minimum_royalty_cents,
       recommended_regulatory_surcharge_cents, trace_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uid, licence.uid, eff.basis, eff.policy_revision, JSON.stringify(territory),
    JSON.stringify(components.map((x) => ({ country_code: x.country_code, weight_bps: x.weight_bps, snapshot_uid: x.snapshot_uid }))), lead.snapshot_uid,
    model.uid, model.version, model.currency, c.available ? 1 : 0, c.unavailable_reason,
    c.values.initial_fee_cents, c.values.annual_fee_cents, c.values.royalty_bps, c.values.minimum_royalty_cents, c.values.regulatory_surcharge_cents,
    JSON.stringify(trace), actor,
  ).run();
  return (await getLicenceSnapshot(env, uid)) as LicenceSnapshot;
}

// ── Apply ────────────────────────────────────────────────────────────────────

export type ApplyInput = {
  snapshot_uid: string; expected_terms_revision: number; accepted: Values; effective_from: string;
  reason: string; override_reason: string | null; acknowledge_agreement_mismatch: boolean;
  pricing_review_on: string | null; review_uid: string | null;
};

const text = (v: unknown, min: number, max: number) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length >= min && s.length <= max ? s : null;
};

/** One year after a YYYY-MM-DD day (29 February → 28 February). */
export function addYear(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y + 1, m - 1, d));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
}

/** An apply body, checked. Accepted figures left out take the recommendation's. */
export function validateApplyBody(body: Record<string, unknown> | null):
  { ok: true; value: Omit<ApplyInput, 'accepted'> & { accepted: Partial<Values> } } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const b = body || {};
  const snapshot = typeof b.snapshot_uid === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(b.snapshot_uid) ? b.snapshot_uid : null;
  if (!snapshot) errors.snapshot_uid = 'name the recommendation you are applying';
  const rev = b.expected_terms_revision;
  if (!(typeof rev === 'number' && Number.isSafeInteger(rev) && rev >= 0)) errors.expected_terms_revision = 'is required: the terms revision you read, a whole number';
  const accepted: Partial<Values> = {};
  if (b.accepted !== undefined) {
    if (!b.accepted || typeof b.accepted !== 'object' || Array.isArray(b.accepted)) errors.accepted = 'must be an object of figures';
    else for (const [k, v] of Object.entries(b.accepted as Record<string, unknown>)) {
      if (!(VALUE_KEYS as readonly string[]).includes(k)) { errors[`accepted.${k}`] = 'is not a pricing figure'; continue; }
      const max = k === 'royalty_bps' ? 10000 : MAX_CENTS;
      if (v === null) { accepted[k as ValueKey] = null; continue; }
      if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max) accepted[k as ValueKey] = v;
      else errors[`accepted.${k}`] = k === 'royalty_bps' ? 'must be whole basis points from 0 to 10000' : 'must be whole cents, not negative';
    }
  }
  const eff = b.effective_from;
  if (!isIsoDay(eff)) errors.effective_from = 'must be a real date as YYYY-MM-DD';
  const reason = text(b.reason, 3, 500);
  if (!reason) errors.reason = 'say why, in 3 to 500 characters';
  let override: string | null = null;
  if (b.override_reason !== undefined && b.override_reason !== null) {
    override = text(b.override_reason, 3, 1000);
    if (!override) errors.override_reason = 'must be 3 to 1000 characters';
  }
  let reviewOn: string | null = null;
  if (b.pricing_review_on !== undefined && b.pricing_review_on !== null) {
    if (!isIsoDay(b.pricing_review_on)) errors.pricing_review_on = 'must be a real date as YYYY-MM-DD';
    else reviewOn = b.pricing_review_on as string;
  }
  if (reviewOn && isIsoDay(eff) && reviewOn <= (eff as string)) errors.pricing_review_on = 'must be after the effective date';
  const review = typeof b.review_uid === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(b.review_uid) ? b.review_uid : null;
  if (b.review_uid !== undefined && b.review_uid !== null && !review) errors.review_uid = 'is not a review id';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      snapshot_uid: snapshot as string, expected_terms_revision: rev as number, accepted, effective_from: eff as string,
      reason: reason as string, override_reason: override, acknowledge_agreement_mismatch: b.acknowledge_agreement_mismatch === true,
      pricing_review_on: reviewOn, review_uid: review,
    },
  };
}

export type ApplyPlan = { decision: 'accepted' | 'overridden'; accepted: Values; differs: ValueKey[]; contractual_change: boolean; changed_terms: Record<string, { before: number | null; after: number | null }> };

/**
 * What an apply would do, decided without writing. Pure. An override is any
 * accepted figure that differs from the recommendation, or any apply on an
 * `hq_override` basis or an unavailable recommendation; an override needs its
 * reason. A contractual change is an annual fee or royalty that differs from
 * the licence's current core terms.
 */
export function planApply(snap: LicenceSnapshot, licence: Pick<LicenceRow, 'annual_fee_cents' | 'revenue_share_bps'>, accepted: Partial<Values>, overrideReason: string | null):
  { ok: true; plan: ApplyPlan } | { ok: false; code: string; sentence: string } {
  const full = { ...snap.recommended } as Values;
  for (const k of VALUE_KEYS) if (k in accepted) full[k] = accepted[k] as number | null;
  for (const { key } of CONTRACTUAL) {
    if (full[key] === null) return { ok: false, code: 'accepted_value_required', sentence: `Give the accepted ${key === 'royalty_bps' ? 'royalty' : 'annual fee'}: there is no recommendation to take it from.` };
  }
  const differs = VALUE_KEYS.filter((k) => full[k] !== snap.recommended[k]);
  const isOverride = differs.length > 0 || !snap.available || snap.basis === 'hq_override';
  if (isOverride && !overrideReason) {
    return { ok: false, code: 'override_reason_required', sentence: !snap.available ? 'There is no recommendation to accept, so these figures are an override: say why.' : snap.basis === 'hq_override' ? 'This licence is priced by HQ-set figures, so every apply is an override: say why.' : `These figures differ from the recommendation (${differs.join(', ')}): say why you are overriding it.` };
  }
  const current: Record<string, number | null> = { annual_fee_cents: licence.annual_fee_cents ?? null, royalty_bps: licence.revenue_share_bps ?? null };
  const changed_terms: ApplyPlan['changed_terms'] = {};
  for (const { key, column } of CONTRACTUAL) {
    if (full[key] !== current[key]) changed_terms[column] = { before: current[key], after: full[key] };
  }
  return { ok: true, plan: { decision: isOverride ? 'overridden' : 'accepted', accepted: full, differs, contractual_change: Object.keys(changed_terms).length > 0, changed_terms } };
}

/** The licence's current agreement, as an apply sees it. Throws when the store cannot be read. */
export async function currentContract(env: Env, licenceUid: string): Promise<{ uid: string; status: string; created_at: string; signed_at: string | null } | null> {
  const r = await env.DB.prepare(
    'SELECT uid, status, created_at, signed_at FROM licence_contracts WHERE licence_uid = ? AND superseded_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1',
  ).bind(licenceUid).first<Record<string, any>>();
  return r ? { uid: String(r.uid), status: String(r.status), created_at: String(r.created_at), signed_at: r.signed_at ?? null } : null;
}

/**
 * The statements of one apply, for one batch: the decision first, then the
 * terms, then the review. EVERY ONE is guarded by the licence still being at
 * `expected_terms_revision` — the decision and review by an EXISTS, the terms
 * by their WHERE — so a stale editor's batch writes nothing at all.
 */
export function applyStatements(env: Env, a: {
  licence: LicenceRow; snap: LicenceSnapshot; input: ApplyInput; plan: ApplyPlan; actor: string; decisionUid: string; now: string;
  contractUid: string | null; reviewOn: string;
}): D1PreparedStatement[] {
  const { licence, snap, input, plan } = a;
  const rev = input.expected_terms_revision;
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO licence_pricing_decisions (uid, licence_uid, snapshot_uid, currency,
         recommended_initial_fee_cents, recommended_annual_fee_cents, recommended_royalty_bps, recommended_minimum_royalty_cents, recommended_regulatory_surcharge_cents,
         accepted_initial_fee_cents, accepted_annual_fee_cents, accepted_royalty_bps, accepted_minimum_royalty_cents, accepted_regulatory_surcharge_cents,
         decision, override_reason, effective_from, created_at, created_by,
         licence_snapshot_uid, reason, terms_revision_before, terms_revision_after, pricing_review_on, contractual_change, agreement_acknowledged,
         contract_uid_at_decision, review_uid)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM territory_licences WHERE id = ? AND terms_revision = ?)`,
    ).bind(
      a.decisionUid, licence.uid, snap.lead_snapshot_uid, snap.currency,
      snap.recommended.initial_fee_cents, snap.recommended.annual_fee_cents, snap.recommended.royalty_bps, snap.recommended.minimum_royalty_cents, snap.recommended.regulatory_surcharge_cents,
      plan.accepted.initial_fee_cents, plan.accepted.annual_fee_cents, plan.accepted.royalty_bps, plan.accepted.minimum_royalty_cents, plan.accepted.regulatory_surcharge_cents,
      plan.decision, plan.decision === 'overridden' ? input.override_reason : null, input.effective_from, a.now, a.actor,
      snap.uid, input.reason, rev, rev + 1, a.reviewOn, plan.contractual_change ? 1 : 0, input.acknowledge_agreement_mismatch ? 1 : 0,
      a.contractUid, input.review_uid,
      licence.id, rev,
    ),
    // D4694's write: one literal UPDATE, guarded by the revision the editor read. Currency is the recommendation's
    // (the route refuses a licence held in another currency), so the figures and their unit move together.
    env.DB.prepare(
      `UPDATE territory_licences SET annual_fee_cents = ?, revenue_share_bps = ?, currency = ?,
              terms_revision = terms_revision + 1, revision = revision + 1, updated_at = ?
        WHERE id = ? AND terms_revision = ?`,
    ).bind(plan.accepted.annual_fee_cents, plan.accepted.royalty_bps, snap.currency, a.now, licence.id, rev),
  ];
  if (input.review_uid) {
    // Runs after the UPDATE above, so its guard names the revision that UPDATE made.
    stmts.push(env.DB.prepare(
      `UPDATE licence_pricing_reviews SET state = ?, decision_uid = ?, resolution_reason = ?, resolved_at = ?, resolved_by = ?, revision = revision + 1
        WHERE uid = ? AND licence_uid = ? AND state = 'open' AND EXISTS (SELECT 1 FROM licence_pricing_decisions WHERE uid = ?)`,
    ).bind(plan.decision === 'overridden' ? 'overridden' : 'applied', a.decisionUid, input.reason, a.now, a.actor, input.review_uid, licence.uid, a.decisionUid));
  }
  return stmts;
}

// ── Reviews ──────────────────────────────────────────────────────────────────

export type ReviewKind = 'unchanged' | 'increase' | 'decrease' | 'incomplete';

/** How a fresh recommendation compares with the licence's current terms. Pure. */
export function classifyReview(snap: Pick<LicenceSnapshot, 'available' | 'recommended'>, licence: Pick<LicenceRow, 'annual_fee_cents' | 'revenue_share_bps'>): ReviewKind {
  if (!snap.available || snap.recommended.annual_fee_cents === null) return 'incomplete';
  const cur = licence.annual_fee_cents;
  if (cur === null || cur === undefined) return 'incomplete';
  const rec = snap.recommended.annual_fee_cents;
  if (rec > cur) return 'increase';
  if (rec < cur) return 'decrease';
  return snap.recommended.royalty_bps === (licence.revenue_share_bps ?? null) ? 'unchanged' : (Number(snap.recommended.royalty_bps) > Number(licence.revenue_share_bps ?? 0) ? 'increase' : 'decrease');
}

export type Review = {
  uid: string; licence_uid: string; licence_snapshot_uid: string; kind: ReviewKind; due_on: string;
  state: 'open' | 'kept' | 'applied' | 'overridden' | 'postponed'; current_annual_fee_cents: number | null; current_royalty_bps: number | null;
  resolution_reason: string | null; postponed_until: string | null; decision_uid: string | null; revision: number;
  opened_at: string; opened_by: string; resolved_at: string | null; resolved_by: string | null;
};

const reviewOf = (r: Record<string, any>): Review => ({
  uid: String(r.uid), licence_uid: String(r.licence_uid), licence_snapshot_uid: String(r.licence_snapshot_uid), kind: r.kind, due_on: String(r.due_on),
  state: r.state, current_annual_fee_cents: nOrNull(r.current_annual_fee_cents), current_royalty_bps: nOrNull(r.current_royalty_bps),
  resolution_reason: r.resolution_reason ?? null, postponed_until: r.postponed_until ?? null, decision_uid: r.decision_uid ?? null,
  revision: Number(r.revision), opened_at: String(r.opened_at), opened_by: String(r.opened_by), resolved_at: r.resolved_at ?? null, resolved_by: r.resolved_by ?? null,
});

export async function reviewsFor(env: Env, licenceUid: string): Promise<Review[]> {
  const r = await env.DB.prepare('SELECT * FROM licence_pricing_reviews WHERE licence_uid = ? ORDER BY opened_at DESC, rowid DESC LIMIT 20').bind(licenceUid).all<Record<string, any>>();
  return (r.results || []).map(reviewOf);
}

export async function getReview(env: Env, uid: string): Promise<Review | null> {
  const r = await env.DB.prepare('SELECT * FROM licence_pricing_reviews WHERE uid = ?').bind(uid).first<Record<string, any>>();
  return r ? reviewOf(r) : null;
}

/** Opens the licence's review on a fresh snapshot. Refuses a second open review. */
export async function openReview(env: Env, licence: LicenceRow, snap: LicenceSnapshot, dueOn: string, actor: string): Promise<Review> {
  const uid = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO licence_pricing_reviews (uid, licence_uid, licence_snapshot_uid, kind, due_on, current_annual_fee_cents, current_royalty_bps, opened_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, licence.uid, snap.uid, classifyReview(snap, licence), dueOn, licence.annual_fee_cents ?? null, licence.revenue_share_bps ?? null, actor).run();
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String((e as Error)?.message))) throw new PricingError(409, 'review_open', 'This licence already has an open pricing review. Close it first.');
    throw e;
  }
  return (await getReview(env, uid)) as Review;
}

/** Keep the current terms, or postpone; both say why. A stale revision changes nothing. */
export async function resolveReview(env: Env, a: { review: Review; action: 'keep' | 'postpone'; reason: string; postponedUntil: string | null; expectedRevision: number; actor: string; now: string }): Promise<Review> {
  const res = await env.DB.prepare(
    `UPDATE licence_pricing_reviews SET state = ?, resolution_reason = ?, postponed_until = ?, resolved_at = ?, resolved_by = ?, revision = revision + 1
      WHERE uid = ? AND state = 'open' AND revision = ?`,
  ).bind(a.action === 'keep' ? 'kept' : 'postponed', a.reason, a.action === 'postpone' ? a.postponedUntil : null, a.now, a.actor, a.review.uid, a.expectedRevision).run();
  if (Number(res?.meta?.changes ?? 0) !== 1) throw new PricingError(409, 'review_conflict', 'This review changed since you opened it, so nothing was saved. Reload it.');
  return (await getReview(env, a.review.uid)) as Review;
}

// ── The read ─────────────────────────────────────────────────────────────────

/** The next pricing review date: a postponement's date if later than the latest decision's, else the decision's. */
export function nextReviewOn(latestDecisionReviewOn: string | null, reviews: Review[]): string | null {
  const postponed = reviews.filter((r) => r.state === 'postponed' && r.postponed_until).map((r) => r.postponed_until as string).sort().pop() ?? null;
  const open = reviews.find((r) => r.state === 'open');
  if (open) return open.due_on;
  if (postponed && (!latestDecisionReviewOn || postponed > latestDecisionReviewOn)) return postponed;
  return latestDecisionReviewOn;
}

/** The difference between a recommendation and the licence's current terms, for the two figures the terms hold. */
export function driftOf(snap: LicenceSnapshot | null, licence: Pick<LicenceRow, 'annual_fee_cents' | 'revenue_share_bps' | 'currency'>) {
  const current = { annual_fee_cents: licence.annual_fee_cents ?? null, royalty_bps: licence.revenue_share_bps ?? null };
  if (!snap || !snap.available) return { available: false, current, fields: null };
  const fields = Object.fromEntries((['annual_fee_cents', 'royalty_bps'] as const).map((k) => {
    const rec = snap.recommended[k];
    const cur = current[k];
    return [k, { recommended: rec, current: cur, difference: rec === null || cur === null ? null : rec - cur }];
  }));
  return { available: true, current, currency_matches: snap.currency === licence.currency, fields };
}

