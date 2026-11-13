/**
 * D5020 (#5020) — HQ's country-pricing reads across the whole ledger: the
 * 49-market catalogue, a country's calculation with its sources, the model
 * versions, the annual review queue and the ledger's Needs HQ pricing signals.
 *
 * READS ONLY. Nothing here writes a row: a catalogue figure is calculated now
 * with the pure engine (D5015) and stored nowhere, exactly like the D5016
 * preview. It reuses the D5014 store, the D5015 engine, the D5017 basis and
 * review-date rules and the D5019 exclusivity store; it has no pricing logic of
 * its own.
 *
 * HONEST UNKNOWNS. A figure that cannot be calculated is `null` with a reason,
 * never 0. A store that cannot be read makes its signal `null` ("Unreadable")
 * with the reason, never `false`.
 *
 * THE REVIEW QUEUE IS COMPUTED. A licence is due when its next review date
 * (D5017 `nextReviewOn`: an open review's due date, else the latest of the
 * decision's review date, a postponement and a kept review's anniversary) is on
 * or before today. That is read from the decisions and reviews themselves, so a
 * due review is listed whether or not anyone opened a review row for it. No
 * sweep opens rows by itself (D5020 §3).
 */
import type { Env } from '../types';
import {
  activeModel, getCountry, getModel, listCountries, listModels, recentSnapshots,
  type CountryProfile, type MarketStatus, type PricingModel,
} from './licencePricingStore';
import { PricingEngineError, recommend, sourceDigest, type InputKey, type Recommendation } from './licencePricing';
import { engineModelOf, engineProfileOf } from './licencePricingSnapshots';
import { observationsFor } from './licencePricingCatalogue';
import { effectiveBasis, nextReviewOn, type Policy, type Review } from './licencePricingApply';

export const SIGNALS = ['pricing_review_due', 'pricing_data_incomplete', 'pricing_overridden', 'exclusivity_at_risk'] as const;
export type Signal = (typeof SIGNALS)[number];

const INPUTS: Array<{ key: InputKey; status: keyof CountryProfile; asOf: keyof CountryProfile }> = [
  { key: 'purchasing_power', status: 'ppp_status', asOf: 'ppp_as_of' },
  { key: 'startup_ecosystem', status: 'startup_score_status', asOf: 'startup_as_of' },
  { key: 'market_size', status: 'population_status', asOf: 'population_as_of' },
];

export type Completeness = {
  state: 'complete' | 'provisional' | 'incomplete';
  recorded: number; provisional: number; not_recorded: number; of: number;
  missing: InputKey[]; provisional_inputs: InputKey[];
};

/** How much of a profile's three inputs is recorded. `incomplete` wins over `provisional`. */
export function completenessOf(p: CountryProfile): Completeness {
  const missing: InputKey[] = [];
  const provisional: InputKey[] = [];
  for (const i of INPUTS) {
    const s = p[i.status] as MarketStatus;
    if (s === 'provisional') provisional.push(i.key);
    else if (s !== 'recorded') missing.push(i.key);
  }
  return {
    state: missing.length ? 'incomplete' : provisional.length ? 'provisional' : 'complete',
    recorded: INPUTS.length - missing.length - provisional.length, provisional: provisional.length, not_recorded: missing.length,
    of: INPUTS.length, missing, provisional_inputs: provisional,
  };
}

/** The newest as-of date among the inputs' sources, or null when none is recorded. */
export function lastSourceUpdateOf(p: CountryProfile): string | null {
  const days = INPUTS.map((i) => p[i.asOf]).filter((d): d is string => typeof d === 'string' && d.length > 0);
  return days.length ? days.sort().pop() as string : null;
}

export type ModelChoice = { model: PricingModel | null; reason: string | null };

/** The model a read prices with: the one named, else the active one. Says why when there is none. */
export async function chooseModel(env: Env, uid: string | null): Promise<ModelChoice> {
  if (uid) {
    const m = await getModel(env, uid);
    return m ? { model: m, reason: null } : { model: null, reason: 'No pricing model with that id.' };
  }
  const m = await activeModel(env);
  return m ? { model: m, reason: null } : { model: null, reason: 'No pricing model is active, so no figure is recommended. Activate one, or name a version to preview with it.' };
}

const modelRef = (m: PricingModel | null) => (m ? { uid: m.uid, version: m.version, status: m.status, currency: m.currency, effective_from: m.effective_from } : null);

/** The engine's answer for one profile, or the reason it could not price, never a 0 standing in. */
function priced(model: PricingModel | null, p: CountryProfile, allowProvisional: boolean):
  { ok: true; recommendation: Recommendation } | { ok: false; code: string; reason: string; problems?: unknown } {
  if (!model) return { ok: false, code: 'no_model', reason: 'No pricing model to calculate with.' };
  try {
    return { ok: true, recommendation: recommend(engineModelOf(model), engineProfileOf(p), { allowProvisional }) };
  } catch (e) {
    if (e instanceof PricingEngineError) return { ok: false, code: 'model_invalid', reason: `Model ${model.version} cannot price a country yet.`, problems: e.problems };
    throw e;
  }
}

export type CatalogueRow = {
  country_code: string; country_name: string; region_code: string | null; currency_code: string | null;
  regulatory_class: string | null; regulatory_class_reason: string | null;
  data_completeness: Completeness; last_source_update: string | null; last_source_update_reason: string | null;
  profile_revision: number; profile_updated_at: string;
  recommendation: {
    available: boolean; complete: boolean; country_index: number | null; tier: string | null;
    recommended_annual_fee_cents: number | null; recommended_initial_fee_cents: number | null; currency: string;
    unavailable_reason: string | null;
  } | null;
  recommendation_reason: string | null;
};

/**
 * The catalogue: every market profile with its completeness, source freshness,
 * regulatory class and the figures the chosen model recommends now.
 */
export async function catalogue(env: Env, opts: { q?: string; incomplete?: boolean; modelUid?: string | null; allowProvisional?: boolean }) {
  const [choice, profiles] = await Promise.all([chooseModel(env, opts.modelUid ?? null), listCountries(env, { q: opts.q, incomplete: opts.incomplete })]);
  let modelProblem: { code: string; reason: string; problems?: unknown } | null = null;
  const rows: CatalogueRow[] = profiles.map((p) => {
    const r = priced(choice.model, p, opts.allowProvisional === true);
    if (!r.ok && r.code === 'model_invalid') modelProblem = { code: r.code, reason: r.reason, problems: r.problems };
    const last = lastSourceUpdateOf(p);
    return {
      country_code: p.country_code, country_name: p.country_name, region_code: p.region_code, currency_code: p.currency_code,
      regulatory_class: p.regulatory_class, regulatory_class_reason: p.regulatory_class ? null : 'Not recorded',
      data_completeness: completenessOf(p), last_source_update: last, last_source_update_reason: last ? null : 'Not recorded',
      profile_revision: p.revision, profile_updated_at: p.updated_at,
      recommendation: r.ok ? {
        available: r.recommendation.available, complete: r.recommendation.complete,
        country_index: r.recommendation.country_index, tier: r.recommendation.tier,
        recommended_annual_fee_cents: r.recommendation.recommended_annual_fee_cents,
        recommended_initial_fee_cents: r.recommendation.recommended_initial_fee_cents,
        currency: r.recommendation.currency, unavailable_reason: r.recommendation.unavailable_reason,
      } : null,
      recommendation_reason: r.ok ? r.recommendation.unavailable_reason : r.reason,
    };
  });
  const counts = { complete: 0, provisional: 0, incomplete: 0, priced: 0 };
  for (const r of rows) {
    counts[r.data_completeness.state] += 1;
    if (r.recommendation?.available) counts.priced += 1;
  }
  return {
    model: modelRef(choice.model), model_reason: choice.reason, model_problem: modelProblem,
    allow_provisional: opts.allowProvisional === true, stored: false,
    countries: rows, total: rows.length, counts,
  };
}

/**
 * One country: each input with its value, status and source (provenance), the
 * observation history, the calculation now with its full trace and source
 * digest, and the snapshots already frozen for it. Null when no profile exists.
 */
export async function countryDetail(env: Env, code: string, opts: { modelUid?: string | null; allowProvisional?: boolean }) {
  const profile = await getCountry(env, code);
  if (!profile) return null;
  const choice = await chooseModel(env, opts.modelUid ?? null);
  const allow = opts.allowProvisional === true;
  const r = priced(choice.model, profile, allow);
  const p = profile;
  const inputs = {
    purchasing_power: { field: 'ppp_gdp_per_capita', unit: 'international dollars', value: p.ppp_gdp_per_capita, status: p.ppp_status, source: p.ppp_source, source_ref: p.ppp_source_ref, as_of: p.ppp_as_of },
    startup_ecosystem: { field: 'startup_ecosystem_score', unit: 'thousandths of a point', value: p.startup_ecosystem_score, rank: p.startup_ecosystem_rank, status: p.startup_score_status, source: p.startup_source, source_ref: p.startup_source_ref, as_of: p.startup_as_of },
    market_size: { field: 'population', unit: 'people', value: p.population, status: p.population_status, source: p.population_source, source_ref: p.population_source_ref, as_of: p.population_as_of },
  };
  const last = lastSourceUpdateOf(p);
  return {
    profile,
    inputs,
    data_completeness: completenessOf(p),
    last_source_update: last, last_source_update_reason: last ? null : 'Not recorded',
    regulatory_class: p.regulatory_class, regulatory_class_reason: p.regulatory_class ? null : 'Not recorded',
    model: modelRef(choice.model), model_reason: choice.reason,
    calculation: r.ok ? {
      recommendation: r.recommendation,
      source_digest: await sourceDigest(engineModelOf(choice.model as PricingModel), engineProfileOf(p), { allowProvisional: allow }),
      allow_provisional: allow, stored: false,
    } : null,
    calculation_reason: r.ok ? null : r.reason,
    calculation_problems: r.ok ? null : (r.problems ?? null),
    observations: await observationsFor(env, code, null),
    snapshots: await recentSnapshots(env, code),
  };
}

/** The model versions: the current one, drafts, retired ones, and a dated history with how much each priced. */
export async function modelVersions(env: Env) {
  const models = await listModels(env);
  const usage = new Map<string, { country_snapshots: number; licence_snapshots: number; decisions: number }>();
  const count = async (sql: string) => (await env.DB.prepare(sql).all<{ uid: string; n: number }>()).results || [];
  const [cs, ls, ds] = await Promise.all([
    count('SELECT pricing_model_uid AS uid, COUNT(*) AS n FROM country_pricing_snapshots GROUP BY pricing_model_uid'),
    count('SELECT pricing_model_uid AS uid, COUNT(*) AS n FROM licence_pricing_snapshots GROUP BY pricing_model_uid'),
    count(`SELECT s.pricing_model_uid AS uid, COUNT(*) AS n FROM licence_pricing_decisions d
             JOIN country_pricing_snapshots s ON s.uid = d.snapshot_uid GROUP BY s.pricing_model_uid`),
  ]);
  const bump = (rows: Array<{ uid: string; n: number }>, k: 'country_snapshots' | 'licence_snapshots' | 'decisions') => {
    for (const r of rows) {
      const u = usage.get(String(r.uid)) ?? { country_snapshots: 0, licence_snapshots: 0, decisions: 0 };
      u[k] = Number(r.n); usage.set(String(r.uid), u);
    }
  };
  bump(cs, 'country_snapshots'); bump(ls, 'licence_snapshots'); bump(ds, 'decisions');
  const withUsage = models.map((m) => ({ ...m, usage: usage.get(m.uid) ?? { country_snapshots: 0, licence_snapshots: 0, decisions: 0 } }));
  const history: Array<{ at: string; event: 'drafted' | 'activated' | 'retired'; model_uid: string; version: string; by: string | null }> = [];
  for (const m of models) {
    history.push({ at: m.created_at, event: 'drafted', model_uid: m.uid, version: m.version, by: m.created_by });
    if (m.activated_at) history.push({ at: m.activated_at, event: 'activated', model_uid: m.uid, version: m.version, by: m.activated_by });
    if (m.retired_at) history.push({ at: m.retired_at, event: 'retired', model_uid: m.uid, version: m.version, by: null });
  }
  history.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.event.localeCompare(b.event)));
  const current = withUsage.find((m) => m.status === 'active') ?? null;
  return {
    current, current_reason: current ? null : 'No pricing model is active.',
    drafts: withUsage.filter((m) => m.status === 'draft'),
    retired: withUsage.filter((m) => m.status === 'retired'),
    history,
  };
}

// ── The ledger: per-licence pricing state ────────────────────────────────────

type Row = Record<string, any>;

/** A read that may fail on a database without its migration: the rows, or null (Unreadable). */
async function rowsOrNull(env: Env, sql: string): Promise<Row[] | null> {
  try { return (await env.DB.prepare(sql).all<Row>()).results || []; } catch (e) {
    console.warn('[licence-pricing-hq] unreadable', (e as Error)?.message);
    return null;
  }
}

const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export type LicencePricingState = {
  licence_uid: string; licence_ref: string; brand_name: string; status: string;
  terms: { annual_fee_cents: number | null; revenue_share_bps: number | null; currency: string | null };
  territory: string[];
  pricing_decision: 'recorded' | 'not_recorded';
  pricing_decision_reason: string | null;
  latest_decision: { uid: string; decision: 'accepted' | 'overridden'; override_reason: string | null; effective_from: string; pricing_review_on: string | null; created_at: string } | null;
  next_review_on: string | null;
  open_review: { uid: string; kind: string; due_on: string; revision: number; opened_at: string } | null;
  pricing_data: { countries: Array<{ country_code: string; state: Completeness['state'] | 'no_profile'; missing: InputKey[]; provisional: InputKey[] }>; basis_problem: string | null } | null;
  exclusivity: { state: string; scope_type: string; review_open: boolean; review_on: string | null; cure_until: string | null } | null;
  /** true / false, or null when the store it needs could not be read (Unreadable, never "no"). */
  signals: Record<Signal, boolean | null>;
  /** A sentence for every signal that is true or null; null when the signal is false. */
  reasons: Record<Signal, string | null>;
};

/**
 * Every licence that is not terminated, with its pricing state and the four
 * Needs HQ signals. Set-based: one read per store, whatever the ledger's size.
 */
export async function ledgerPricingStates(env: Env, today: string): Promise<LicencePricingState[]> {
  const licences = (await env.DB.prepare(
    `SELECT id, uid, licence_ref, brand_name, status, annual_fee_cents, revenue_share_bps, currency
       FROM territory_licences WHERE status <> 'terminated' ORDER BY licence_ref, uid`,
  ).all<Row>()).results || [];
  if (!licences.length) return [];
  const [territories, policies, decisions, reviews, profiles, exclusivity, exReviews] = await Promise.all([
    rowsOrNull(env, 'SELECT licence_id, country_code FROM licence_territories ORDER BY country_code'),
    rowsOrNull(env, 'SELECT * FROM licence_pricing_policies'),
    rowsOrNull(env, `SELECT uid, licence_uid, decision, override_reason, effective_from, pricing_review_on, created_at
                       FROM licence_pricing_decisions ORDER BY created_at DESC, rowid DESC`),
    rowsOrNull(env, 'SELECT * FROM licence_pricing_reviews ORDER BY opened_at DESC, rowid DESC'),
    listCountries(env).catch(() => null),
    rowsOrNull(env, 'SELECT licence_uid, state, scope_type, review_on, cure_until FROM licence_exclusivity_terms WHERE superseded_at IS NULL'),
    rowsOrNull(env, "SELECT licence_uid FROM licence_exclusivity_reviews WHERE state = 'open'"),
  ]);
  const terrBy = new Map<number, string[]>();
  for (const t of territories ?? []) terrBy.set(Number(t.licence_id), [...(terrBy.get(Number(t.licence_id)) ?? []), String(t.country_code)]);
  const policyBy = new Map<string, Policy>();
  for (const r of policies ?? []) {
    let weights: Record<string, number> = {};
    try { weights = JSON.parse(String(r.weights_json || '{}')); } catch { weights = {}; }
    policyBy.set(String(r.licence_uid), {
      licence_uid: String(r.licence_uid), basis: r.basis, primary_country: r.primary_country ?? null, weights,
      reason: String(r.reason), revision: Number(r.revision), updated_at: String(r.updated_at), updated_by: String(r.updated_by),
    });
  }
  const latestBy = new Map<string, Row>();
  for (const d of decisions ?? []) if (!latestBy.has(String(d.licence_uid))) latestBy.set(String(d.licence_uid), d);
  // The licence read (D5017) considers a licence's newest 20 reviews; so does this.
  const reviewsBy = new Map<string, Review[]>();
  for (const r of reviews ?? []) {
    const list = reviewsBy.get(String(r.licence_uid)) ?? [];
    if (list.length < 20) list.push({
      uid: String(r.uid), licence_uid: String(r.licence_uid), licence_snapshot_uid: String(r.licence_snapshot_uid), kind: r.kind,
      due_on: String(r.due_on), state: r.state, current_annual_fee_cents: nOrNull(r.current_annual_fee_cents),
      current_royalty_bps: nOrNull(r.current_royalty_bps), resolution_reason: r.resolution_reason ?? null,
      postponed_until: r.postponed_until ?? null, decision_uid: r.decision_uid ?? null, revision: Number(r.revision),
      opened_at: String(r.opened_at), opened_by: String(r.opened_by), resolved_at: r.resolved_at ?? null, resolved_by: r.resolved_by ?? null,
    });
    reviewsBy.set(String(r.licence_uid), list);
  }
  const profileBy = new Map((profiles ?? []).map((p) => [p.country_code, p]));
  const exBy = new Map((exclusivity ?? []).map((r) => [String(r.licence_uid), r]));
  const exOpen = new Set((exReviews ?? []).map((r) => String(r.licence_uid)));
  const pricingReadable = decisions !== null && reviews !== null;
  const dataReadable = territories !== null && policies !== null && profiles !== null;
  const exReadable = exclusivity !== null && exReviews !== null;

  return licences.map((l) => {
    const uid = String(l.uid);
    const territory = terrBy.get(Number(l.id)) ?? [];
    const latest = latestBy.get(uid) ?? null;
    const lr = reviewsBy.get(uid) ?? [];
    const open = lr.find((r) => r.state === 'open') ?? null;
    const next = pricingReadable ? nextReviewOn(latest?.pricing_review_on ?? null, lr) : null;
    // Data completeness over the countries the basis prices from; with no usable basis, over the whole territory.
    let pricingData: LicencePricingState['pricing_data'] = null;
    if (dataReadable) {
      const eff = effectiveBasis(policyBy.get(uid) ?? null, territory);
      const codes = eff.ok ? Object.keys(eff.value.weights).sort() : territory;
      pricingData = {
        countries: codes.map((code) => {
          const p = profileBy.get(code);
          if (!p) return { country_code: code, state: 'no_profile' as const, missing: [], provisional: [] };
          const c = completenessOf(p);
          return { country_code: code, state: c.state, missing: c.missing, provisional: c.provisional_inputs };
        }),
        basis_problem: eff.ok ? null : eff.sentence,
      };
    }
    const ex = exBy.get(uid) ?? null;
    const exclusivityState = exReadable && ex ? {
      state: String(ex.state), scope_type: String(ex.scope_type), review_open: exOpen.has(uid), review_on: ex.review_on ?? null, cure_until: ex.cure_until ?? null,
    } : null;

    const due = pricingReadable ? !!next && next <= today : null;
    const incompleteCountries = pricingData?.countries.filter((c) => c.state !== 'complete') ?? [];
    const incomplete = pricingData ? (pricingData.countries.length === 0 || incompleteCountries.length > 0) : null;
    const overridden = decisions === null ? null : latest?.decision === 'overridden';
    const atRisk = exReadable ? ex?.state === 'at_risk' || exOpen.has(uid) : null;

    const unreadable = 'Unreadable: the store this needs could not be read just now, so it is unknown, not clear.';
    const reasons: Record<Signal, string | null> = {
      pricing_review_due: due === null ? unreadable : due
        ? (open ? `The open pricing review was due on ${open.due_on}.` : `The pricing review was due on ${next}, and no review is open for it.`)
        : null,
      pricing_data_incomplete: incomplete === null ? unreadable : incomplete
        ? (pricingData!.countries.length === 0
          ? (pricingData!.basis_problem ?? 'No territory is recorded, so there is no market to price from.')
          : `Market data is not complete for ${incompleteCountries.map((c) => c.country_code).join(', ')}.`)
        : null,
      pricing_overridden: overridden === null ? unreadable : overridden
        ? `The current pricing decision overrides the recommendation: ${latest!.override_reason ?? 'no reason recorded'}.`
        : null,
      exclusivity_at_risk: atRisk === null ? unreadable : atRisk
        ? (ex?.state === 'at_risk' ? 'Exclusivity is at risk: a development commitment was missed.' : 'An exclusivity review is open.')
        : null,
    };
    return {
      licence_uid: uid, licence_ref: String(l.licence_ref), brand_name: String(l.brand_name ?? ''), status: String(l.status),
      terms: { annual_fee_cents: nOrNull(l.annual_fee_cents), revenue_share_bps: nOrNull(l.revenue_share_bps), currency: l.currency ?? null },
      territory,
      pricing_decision: latest ? 'recorded' : 'not_recorded',
      pricing_decision_reason: latest ? null : 'No pricing decision recorded',
      latest_decision: latest ? {
        uid: String(latest.uid), decision: latest.decision, override_reason: latest.override_reason ?? null,
        effective_from: String(latest.effective_from), pricing_review_on: latest.pricing_review_on ?? null, created_at: String(latest.created_at),
      } : null,
      next_review_on: next,
      open_review: open ? { uid: open.uid, kind: open.kind, due_on: open.due_on, revision: open.revision, opened_at: open.opened_at } : null,
      pricing_data: pricingData,
      exclusivity: exclusivityState,
      signals: { pricing_review_due: due, pricing_data_incomplete: incomplete, pricing_overridden: overridden, exclusivity_at_risk: atRisk },
      reasons,
    };
  });
}

/** The `?needs=` value as the signals it names, in SIGNALS order; anything unknown is dropped. */
export function signalsFromParam(raw: string | undefined | null): Signal[] {
  const asked = String(raw || '').split(',').map((s) => s.trim());
  return SIGNALS.filter((s) => asked.includes(s));
}

/** Per signal: how many licences it is true for, and how many it could not be read for. */
export function signalCounts(states: LicencePricingState[]) {
  return Object.fromEntries(SIGNALS.map((s) => [s, {
    count: states.filter((x) => x.signals[s] === true).length,
    unreadable: states.filter((x) => x.signals[s] === null).length,
  }])) as Record<Signal, { count: number; unreadable: number }>;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The annual review queue: every licence whose pricing review is due on or
 * before `today + withinDays`, whether or not a review row is open, oldest
 * first. Licences with no pricing decision at all are listed apart: they have
 * no review date yet, and HQ records their first recommendation at their next
 * review.
 */
export function reviewQueue(states: LicencePricingState[], today: string, withinDays: number) {
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + withinDays * 86_400_000).toISOString().slice(0, 10);
  const items = states
    .filter((s) => s.next_review_on !== null && s.next_review_on <= horizon)
    .sort((a, b) => (a.next_review_on as string).localeCompare(b.next_review_on as string) || a.licence_ref.localeCompare(b.licence_ref))
    .map((s) => ({
      licence_uid: s.licence_uid, licence_ref: s.licence_ref, brand_name: s.brand_name, status: s.status,
      due_on: s.next_review_on as string,
      due: (s.next_review_on as string) <= today,
      days_overdue: Math.max(0, daysBetween(s.next_review_on as string, today)),
      review_row: s.open_review ? 'open' as const : 'none' as const,
      open_review: s.open_review,
      latest_decision: s.latest_decision,
      terms: s.terms,
      pricing_data_incomplete: s.signals.pricing_data_incomplete,
    }));
  const noDecision = states.filter((s) => s.pricing_decision === 'not_recorded' && s.next_review_on === null)
    .map((s) => ({ licence_uid: s.licence_uid, licence_ref: s.licence_ref, brand_name: s.brand_name, status: s.status, reason: 'No pricing decision recorded' }));
  return {
    today, within_days: withinDays, horizon,
    items, total: items.length,
    due: items.filter((i) => i.due).length,
    without_open_review: items.filter((i) => i.due && i.review_row === 'none').length,
    no_decision: noDecision,
    sweep: 'none: the queue is computed from each licence\'s decisions and reviews on every read (D5020); nothing opens a review row by itself.',
  };
}
