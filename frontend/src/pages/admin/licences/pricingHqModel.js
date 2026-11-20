/**
 * D5020 (#5020, the HQ screens) — Country pricing across the ledger, as pure functions over the five D5020 reads
 * (`lib/api/licencePricingHq.js`): the catalogue (addendum board L23), a country's inputs and calculation trace (L24),
 * the model versions (L25), the annual review queue (L27) and the ledger's Needs HQ pricing signals (L28).
 *
 * THREE RECORDS, NEVER BLURRED. A recommendation is what a model calculates now and stores nowhere; accepted terms
 * are what the licence holds; an override is a decision that set terms different from the recommendation. The
 * screens name each as that.
 *
 * NEVER A ZERO STANDING IN. An unknown figure, index, tier, class or date reads "Not recorded" (or the read's own
 * reason); a store that could not be read reads "Unavailable". Every recommendation names its model version and how
 * fresh its sources are.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { bpsPercent } from '../../../lib/bps.js';
import { figure, indexLabel } from './countryPricingModel.js';

export { NOT_RECORDED };

/** A source older than this many months is stale: the recommendation still calculates, and says so. */
export const STALE_MONTHS = 12;

/** The catalogue's addresses. Static segments, so none of them is read as `/admin/licences/:uid/:section`. */
export const PRICING_PATHS = Object.freeze({
  catalogue: '/admin/licences/pricing',
  models: '/admin/licences/pricing/models',
  reviews: '/admin/licences/pricing/reviews',
  country: (code) => `/admin/licences/pricing/country/${encodeURIComponent(String(code || '').toUpperCase())}`,
});

/** The three pages under Pricing, in their tab order. */
export const PRICING_TABS = Object.freeze([
  { key: 'catalogue', label: 'Country catalogue', href: PRICING_PATHS.catalogue },
  { key: 'reviews', label: 'Annual reviews', href: PRICING_PATHS.reviews },
  { key: 'models', label: 'Pricing models', href: PRICING_PATHS.models },
]);

const INPUT_LABEL = Object.freeze({
  market_size: 'Population',
  purchasing_power: 'PPP GDP per capita',
  startup_ecosystem: 'Startup ecosystem score',
});
export const inputLabel = (key) => INPUT_LABEL[key] || String(key || '').replace(/_/g, ' ');

const STATUS_WORD = Object.freeze({ recorded: 'Recorded', provisional: 'Provisional', not_recorded: 'Not recorded' });
export const statusWord = (s) => STATUS_WORD[s] || NOT_RECORDED;

/** Whole months from `from` to `to` (YYYY-MM-DD), counting only completed months. */
export function monthsBetween(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(from || '')) || !/^\d{4}-\d{2}-\d{2}/.test(String(to || ''))) return null;
  const [fy, fm, fd] = from.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = to.slice(0, 10).split('-').map(Number);
  let m = (ty - fy) * 12 + (tm - fm);
  if (td < fd) m -= 1;
  return m;
}

/**
 * How fresh a market's newest source is: `{ state: current | stale | not_recorded, label, months }`. Stale is a
 * source older than STALE_MONTHS; the date is said either way.
 */
export function sourceFreshness(lastUpdate, today) {
  if (!lastUpdate) return { state: 'not_recorded', label: NOT_RECORDED, months: null };
  const months = monthsBetween(lastUpdate, today);
  if (months !== null && months >= STALE_MONTHS) return { state: 'stale', label: `Stale · ${months} months · ${lastUpdate}`, months };
  return { state: 'current', label: `Updated ${lastUpdate}`, months };
}

/** Data completeness as a word and a count: "3 of 3 recorded", "2 recorded · 1 provisional", "2 of 3 recorded". */
export function completenessCell(c) {
  if (!c || !Number.isFinite(Number(c.of))) return { state: 'unavailable', label: 'Unavailable' };
  if (c.state === 'complete') return { state: 'complete', label: `${c.recorded} of ${c.of} recorded` };
  if (c.state === 'provisional') return { state: 'provisional', label: `${c.recorded} recorded · ${c.provisional} provisional` };
  const prov = c.provisional ? ` · ${c.provisional} provisional` : '';
  return { state: 'incomplete', label: `${c.recorded} of ${c.of} recorded${prov}` };
}

/** "Tier B · 1.180×"; the reason when the model could not price the market. */
export function tierIndexCell(rec, reason) {
  if (!rec) return { state: 'not_recorded', label: reason || NOT_RECORDED };
  if (!rec.available) return { state: 'not_recorded', label: rec.unavailable_reason || NOT_RECORDED };
  return { state: 'value', label: `Tier ${rec.tier || NOT_RECORDED} · ${indexLabel(rec.country_index)}` };
}

/** A recommended fee, flagged provisional when the market's data is; never 0 when it is unknown. */
export function feeCell(rec, key) {
  const v = rec?.available ? rec[key] : null;
  if (v === null || v === undefined) return { state: 'not_recorded', label: rec ? 'No recommendation' : NOT_RECORDED };
  return { state: rec.complete ? 'value' : 'provisional', label: `${figure(v, 'cents', rec.currency)}${rec.complete ? '' : ' · provisional'}` };
}

/** One catalogue row as the table draws it. */
export function catalogueRow(r, today) {
  return {
    code: r.country_code,
    name: r.country_name || r.country_code,
    href: PRICING_PATHS.country(r.country_code),
    region: r.region_code || NOT_RECORDED,
    currency: r.currency_code || NOT_RECORDED,
    completeness: completenessCell(r.data_completeness),
    freshness: sourceFreshness(r.last_source_update, today),
    regulatory: r.regulatory_class || NOT_RECORDED,
    tierIndex: tierIndexCell(r.recommendation, r.recommendation_reason),
    annual: feeCell(r.recommendation, 'recommended_annual_fee_cents'),
    initial: feeCell(r.recommendation, 'recommended_initial_fee_cents'),
  };
}

/** The distinct values a filter offers, sorted, "Not recorded" last. */
function facet(rows, pick) {
  const vals = [...new Set(rows.map(pick))];
  return vals.filter((v) => v !== NOT_RECORDED).sort().concat(vals.includes(NOT_RECORDED) ? [NOT_RECORDED] : []);
}
export function catalogueFacets(rows) {
  return { regions: facet(rows, (r) => r.region), classes: facet(rows, (r) => r.regulatory), currencies: facet(rows, (r) => r.currency) };
}

/**
 * The catalogue filters, applied to drawn rows: a search over country name and code, "Incomplete data" (incomplete
 * or provisional), and region, regulatory class and currency (empty means every one).
 */
export function filterCatalogue(rows, { q = '', incomplete = false, region = '', regulatory = '', currency = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return (rows || []).filter((r) => (!needle || r.name.toLowerCase().includes(needle) || r.code.toLowerCase() === needle)
    && (!incomplete || r.completeness.state !== 'complete')
    && (!region || r.region === region)
    && (!regulatory || r.regulatory === regulatory)
    && (!currency || r.currency === currency));
}

/** The model line every priced screen carries: "Model v3 · active · EUR", or why there is none. */
export function modelLine(model, reason) {
  if (!model) return reason || 'No pricing model is active, so nothing is recommended.';
  return `Model ${model.version} · ${model.status} · ${model.currency}`;
}

const millionths = (ppm) => (ppm === null || ppm === undefined ? NOT_RECORDED : (Number(ppm) / 1_000_000).toFixed(3));

function inputValue(key, i) {
  if (!i || i.value === null || i.value === undefined) return NOT_RECORDED;
  if (key === 'market_size') return `${Number(i.value).toLocaleString('en-US')} people`;
  if (key === 'purchasing_power') return `${Number(i.value).toLocaleString('en-US')} international dollars`;
  const score = (Number(i.value) / 1000).toFixed(1);
  return i.rank ? `${score} · rank ${i.rank}` : score;
}

/** The profile's inputs with their provenance: value, status, source (with its reference) and as-of date. */
export function inputRows(inputs) {
  return ['market_size', 'purchasing_power', 'startup_ecosystem'].map((key) => {
    const i = inputs?.[key] || null;
    const source = i?.source ? `${i.source}${i.source_ref ? ` · ${i.source_ref}` : ''}` : NOT_RECORDED;
    return { key, label: inputLabel(key), value: inputValue(key, i), status: i?.status || 'not_recorded', statusWord: statusWord(i?.status), source, asOf: i?.as_of || NOT_RECORDED };
  });
}

/**
 * The calculation trace, step by step, from the engine's own trace (D5015): each factor with its weight, the index,
 * the tier and royalty, then each fee from its reference and rounding. A step the engine did not reach is not drawn.
 */
export function traceRows(calculation, inputs) {
  const rec = calculation?.recommendation;
  if (!rec) return [];
  const t = rec.trace || {};
  const cur = rec.currency;
  const w = t.index?.weights_bps || {};
  const rows = [];
  for (const key of ['market_size', 'purchasing_power', 'startup_ecosystem']) {
    const f = t[key];
    const status = inputs?.[key]?.status;
    rows.push({
      step: `${inputLabel(key)} factor`,
      value: f ? millionths(f.factor_ppm) : NOT_RECORDED,
      weight: w[key] !== undefined ? bpsPercent(w[key]) : '—',
      note: f ? `${statusWord(status)} input` : `${statusWord(status)} input; not used`,
      total: false,
    });
  }
  if (t.index) {
    rows.push({ step: 'Country index', value: indexLabel(t.index.index_ppm), weight: '—', note: 'Σ weight × factor', total: true });
    const roy = t.fees?.royalty_bps;
    rows.push({
      step: 'Tier', value: t.index.tier ? `Tier ${t.index.tier}` : NOT_RECORDED, weight: '—',
      note: roy ? `Royalty ${bpsPercent(roy.value)} · from the ${roy.from}` : NOT_RECORDED, total: true,
    });
  }
  const fees = t.fees;
  if (fees) {
    const rounding = figure(fees.fee_rounding_cents, 'cents', cur);
    rows.push({ step: 'Annual licence', value: figure(fees.annual?.rounded_cents, 'cents', cur), weight: '—', note: `${figure(fees.annual?.reference_cents, 'cents', cur)} × index, rounded to ${rounding}`, total: false });
    rows.push({ step: 'Initial fee', value: figure(fees.initial?.rounded_cents, 'cents', cur), weight: '—', note: `${figure(fees.initial?.reference_cents, 'cents', cur)} × index, rounded to ${rounding}`, total: false });
    rows.push({ step: 'Minimum royalty', value: figure(fees.minimum_royalty?.rounded_cents, 'cents', cur), weight: '—', note: `${bpsPercent(fees.minimum_royalty?.ratio_bps)} of the annual licence, rounded to ${rounding}`, total: false });
  }
  const reg = t.regulatory;
  rows.push({
    step: `Regulatory surcharge${reg?.class ? ` · ${reg.class}` : ''}`,
    value: figure(reg?.surcharge_cents ?? null, 'cents', cur), weight: '—',
    note: reg?.class ? 'Fixed by class, added once a year' : 'No regulatory class recorded, so the surcharge is unknown, not free',
    total: false,
  });
  return rows;
}

/** The figures a calculation recommends, one line: "annual … · initial … · royalty … · surcharge …". */
export function recommendationLine(rec) {
  if (!rec) return NOT_RECORDED;
  if (!rec.available) return rec.unavailable_reason || NOT_RECORDED;
  const c = rec.currency;
  return `Annual ${figure(rec.recommended_annual_fee_cents, 'cents', c)} · initial ${figure(rec.recommended_initial_fee_cents, 'cents', c)} · royalty ${figure(rec.recommended_royalty_bps, 'bps', c)} · minimum royalty ${figure(rec.recommended_minimum_royalty_cents, 'cents', c)} · surcharge ${figure(rec.recommended_regulatory_surcharge_cents, 'cents', c)}`;
}

/** The whole result's standing: complete, provisional (say which inputs), or not calculable (say why). */
export function calculationStanding(detail) {
  const rec = detail?.calculation?.recommendation;
  if (!rec) return { state: 'unavailable', label: detail?.calculation_reason || 'No recommendation can be calculated.' };
  if (!rec.available) return { state: 'incomplete', label: rec.unavailable_reason || 'No recommendation can be calculated.' };
  if (!rec.complete) return { state: 'provisional', label: `Provisional: ${rec.provisional.map(inputLabel).join(', ')} ${rec.provisional.length === 1 ? 'is' : 'are'} provisional.` };
  return { state: 'complete', label: 'Every input is recorded.' };
}

const pct = (bps) => (bps === null || bps === undefined ? NOT_RECORDED : bpsPercent(bps));

/** One model version as the table draws it. Active and retired versions are immutable; that is said, not offered. */
export function modelRow(m) {
  const u = m.usage || {};
  return {
    uid: m.uid,
    version: m.version,
    state: m.status,
    effectiveFrom: m.effective_from || NOT_RECORDED,
    activated: m.activated_at ? `${m.activated_by || 'Not recorded'} · ${String(m.activated_at).slice(0, 10)}` : 'Not activated',
    weights: `${pct(m.weight_market_size_bps)} / ${pct(m.weight_purchasing_power_bps)} / ${pct(m.weight_startup_ecosystem_bps)}`,
    rounding: figure(m.fee_rounding_cents ?? null, 'cents', m.currency),
    reference: `${figure(m.reference_annual_fee_cents ?? null, 'cents', m.currency)} annual · ${figure(m.reference_initial_fee_cents ?? null, 'cents', m.currency)} initial`,
    usage: `${u.country_snapshots || 0} country snapshots · ${u.licence_snapshots || 0} licence snapshots · ${u.decisions || 0} decisions`,
    note: m.status === 'draft' ? 'Draft: preview it on the catalogue' : m.status === 'active' ? 'Active models are immutable' : 'Read-only',
  };
}

/** The versions in reading order: current, then drafts, then retired. */
export function modelRows(mv) {
  return [...(mv?.current ? [mv.current] : []), ...(mv?.drafts || []), ...(mv?.retired || [])].map(modelRow);
}

/** The review queue's windows: due now, or due within 120 days (the canvas's default). */
export const REVIEW_WINDOWS = Object.freeze([
  { key: 'due', label: 'Due now', within: 0 },
  { key: '120', label: 'Due in 120 days', within: 120 },
]);
export const reviewWindowFromParam = (p) => REVIEW_WINDOWS.find((w) => w.key === p) || REVIEW_WINDOWS[0];

/** One review-queue row. `review_row: none` says no review is open for a due licence, so it is not missed. */
export function reviewRow(i) {
  const due = i.due ? (i.days_overdue > 0 ? `${i.due_on} · ${i.days_overdue}d overdue` : `${i.due_on} · due today`) : i.due_on;
  const decision = i.latest_decision
    ? (i.latest_decision.decision === 'overridden' ? `Overridden · effective ${i.latest_decision.effective_from}` : `Accepted · effective ${i.latest_decision.effective_from}`)
    : 'No pricing decision recorded';
  return {
    uid: i.licence_uid,
    href: `/admin/licences/${encodeURIComponent(i.licence_uid)}/terms`,
    name: i.brand_name || i.licence_ref,
    ref: i.licence_ref,
    status: i.status,
    due,
    overdue: Boolean(i.due && i.days_overdue > 0),
    review: i.review_row === 'open' ? 'Review open' : 'No review open',
    decision,
    annual: figure(i.terms?.annual_fee_cents ?? null, 'cents', i.terms?.currency),
    data: i.pricing_data_incomplete === null ? 'Unavailable' : i.pricing_data_incomplete ? 'Incomplete' : 'Complete',
  };
}

// ── The ledger's Needs HQ pricing signals (L28) ─────────────────────────────

export const PRICING_SIGNALS = Object.freeze([
  ['pricing_review_due', 'Pricing review due'],
  ['pricing_data_incomplete', 'Pricing data incomplete'],
  ['pricing_overridden', 'Overridden pricing'],
  ['exclusivity_at_risk', 'Exclusivity at risk'],
]);

/**
 * The `/signals` read as the ledger joins it: `{ state: 'reading' }` before it answers, `{ state: 'unavailable' }`
 * when it failed, else `{ state: 'ok', byUid }`. A licence the read does not list (terminated) has no signal.
 */
export function pricingSignalsRead(res) {
  if (res === undefined) return { state: 'reading', byUid: {} };
  if (!res || res.error || !Array.isArray(res.items)) return { state: 'unavailable', byUid: {} };
  return { state: 'ok', byUid: Object.fromEntries(res.items.map((s) => [s.licence_uid, { signals: s.signals || {}, reasons: s.reasons || {} }])) };
}

// ── The licence's Pricing & Market section (L26) ────────────────────────────

/**
 * What the licence's Pricing & Market section says above its figures, from the D5017 licence read: which of its
 * markets have a stale source, whether the recommendation shown is the one the licence's terms came from, and the
 * line naming the accepted terms (or that no pricing decision is recorded).
 */
export function licenceMarketFacts(view, today) {
  const stale = [];
  for (const c of view?.countries || []) {
    if (!c?.recorded) continue;
    const dates = Object.values(c.inputs || {}).filter((v) => v && v.status !== 'not_recorded' && v.as_of).map((v) => v.as_of).sort();
    const m = dates.length ? monthsBetween(dates[0], today) : null;
    if (m !== null && m >= STALE_MONTHS) stale.push({ code: c.country_code, oldest: dates[0], months: m });
  }
  const snap = view?.recommendation || null;
  const latest = view?.latest_decision || null;
  const recommendation = snap
    ? `From model ${snap.pricing_model_version} · snapshot ${String(snap.created_at).slice(0, 10)} · ${latest?.snapshot_uid === snap.uid ? 'applied' : 'not applied'}`
    : null;
  const accepted = latest
    ? `${latest.decision === 'overridden' ? 'Overridden' : 'Accepted'} ${String(latest.created_at).slice(0, 10)} · effective ${latest.effective_from}${latest.decision === 'overridden' && latest.override_reason ? ` · ${latest.override_reason}` : ''}`
    : null;
  return { stale, recommendation, accepted, noDecision: !latest };
}
