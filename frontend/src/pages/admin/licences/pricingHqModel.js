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
    // D7715: the profile revision the import file names for this country (LCD-01, the catalogue's Revision column).
    revision: Number.isInteger(r.profile_revision) ? r.profile_revision : null,
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

// ── D7715 (#7715): the Import country data and Record observation sheets (canvas LCD-00 to LCD-08, D7703) ──────
//
// WHAT THE SHEETS SEND. The three D5016 writes (`lib/api/licencePricing.js`, `licencePricingCatalogueApi`), each
// behind the Super Admin write bar with a reason and the revision read. The Worker validates every value; these
// rules only read the file, say what it will change, and turn the Worker's answer into words. A refusal is shown in
// the Worker's own sentence, and a failed send changes nothing on the page.

/** The four observed fields, in the Worker's order (`OBSERVED_FIELDS`, D5016). */
export const OBSERVED_FIELDS = Object.freeze(['population', 'ppp_gdp_per_capita', 'startup_ecosystem_score', 'startup_ecosystem_rank']);
const FIELD_LABEL = Object.freeze({
  population: 'Population',
  ppp_gdp_per_capita: 'PPP GDP per capita',
  startup_ecosystem_score: 'Startup ecosystem score',
  startup_ecosystem_rank: 'Startup ecosystem rank',
});
const FIELD_UNIT = Object.freeze({
  population: 'persons',
  ppp_gdp_per_capita: 'international dollars, whole',
  startup_ecosystem_score: 'thousandths of a point',
  startup_ecosystem_rank: 'position, 1 is first',
});
export const fieldLabel = (f) => FIELD_LABEL[f] || String(f || '').replace(/_/g, ' ');
export const fieldUnit = (f) => FIELD_UNIT[f] || '';

/** The most rows one import holds (the Worker refuses more, `invalid_import`). */
export const IMPORT_MAX_ROWS = 500;

/** The profile columns each field lives in. A rank has a value only: it is recorded or not, never provisional. */
const PROFILE_COLUMNS = Object.freeze({
  population: { value: 'population', status: 'population_status', source: 'population_source', ref: 'population_source_ref', asOf: 'population_as_of' },
  ppp_gdp_per_capita: { value: 'ppp_gdp_per_capita', status: 'ppp_status', source: 'ppp_source', ref: 'ppp_source_ref', asOf: 'ppp_as_of' },
  startup_ecosystem_score: { value: 'startup_ecosystem_score', status: 'startup_score_status', source: 'startup_source', ref: 'startup_source_ref', asOf: 'startup_as_of' },
  startup_ecosystem_rank: { value: 'startup_ecosystem_rank' },
});

/** What a profile holds today for one field: `{ value, status, source, source_ref, as_of }`, nulls where nothing. */
export function profileField(profile, field) {
  const c = PROFILE_COLUMNS[field];
  const p = profile || {};
  if (!c) return { value: null, status: 'not_recorded', source: null, source_ref: null, as_of: null };
  const value = p[c.value] ?? null;
  const fallback = value === null ? 'not_recorded' : 'recorded';
  return {
    value,
    status: c.status ? (p[c.status] || fallback) : fallback,
    source: c.source ? p[c.source] ?? null : null,
    source_ref: c.ref ? p[c.ref] ?? null : null,
    as_of: c.asOf ? p[c.asOf] ?? null : null,
  };
}

/** A field's value in words with its unit; a score also in points. Never a 0 for nothing. */
export function fieldValueWords(field, value) {
  if (value === null || value === undefined || value === '') return NOT_RECORDED;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const whole = n.toLocaleString('en-US');
  if (field === 'startup_ecosystem_score') return `${whole} = ${(n / 1000).toFixed(3)} points`;
  if (field === 'startup_ecosystem_rank') return `rank ${whole}`;
  return `${whole} ${fieldUnit(field)}`.trim();
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const listWords = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * The file the import-file builder wrote (`scripts/build-country-import.mjs`, D7714): `{ observations,
 * expected_revisions, reason }`, read in the browser and kept nowhere. Refused here, before anything is sent, is
 * only what the Worker would refuse whole (LCD-01 E): a file that is not that body, 0 or more than 500 rows, a
 * country with no revision named. Each row's fields are the Worker's to judge, in its words.
 *   → { ok: true, body, summary } | { ok: false, problem }
 */
export function parseImportFile(text, name = 'The file') {
  let raw;
  try { raw = JSON.parse(String(text ?? '')); } catch { return { ok: false, problem: `${name} is not the JSON body the import-file builder writes. Nothing was imported.` }; }
  const rows = raw && typeof raw === 'object' && Array.isArray(raw.observations) ? raw.observations : null;
  if (!rows) return { ok: false, problem: `${name} has no observations list, so it is not the body the import-file builder writes. Nothing was imported.` };
  if (rows.length === 0) return { ok: false, problem: `${name} holds 0 observations. Nothing to review.` };
  if (rows.length > IMPORT_MAX_ROWS) {
    return { ok: false, problem: `An import holds 1 to ${IMPORT_MAX_ROWS} observations. ${name} has ${rows.length} rows. Nothing was imported. Split it into files of at most ${IMPORT_MAX_ROWS} rows.` };
  }
  const revs = raw.expected_revisions && typeof raw.expected_revisions === 'object' ? raw.expected_revisions : {};
  const revOf = (code) => { const v = revs[code]; return Number.isInteger(v) && v >= 0 ? v : null; };
  const codes = [...new Set(rows.map((r) => String(r?.country_code ?? '').trim().toUpperCase()))];
  const unnamed = codes.filter((c) => revOf(c) === null);
  if (unnamed.length) {
    return { ok: false, problem: `Name the revision you read for every country in the import. No revision is named for ${listWords(unnamed.map((c) => c || 'a row with no country'))}. Nothing was imported.` };
  }
  const body = {
    observations: rows,
    expected_revisions: Object.fromEntries(codes.map((c) => [c, revOf(c)])),
    reason: typeof raw.reason === 'string' ? raw.reason : '',
  };
  return { ok: true, body, summary: importSummary(body) };
}

/**
 * What an import will change (LCD-01 B): its rows, each field's row count (0 said, never left out), and each
 * country with its rows and the revision it was read at.
 */
export function importSummary(body) {
  const rows = body?.observations || [];
  const fields = Object.fromEntries(OBSERVED_FIELDS.map((f) => [f, 0]));
  const per = new Map();
  for (const r of rows) {
    const code = String(r?.country_code ?? '').trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(fields, r?.field)) fields[r.field] += 1;
    per.set(code, (per.get(code) || 0) + 1);
  }
  const countries = [...per.entries()].map(([code, n]) => ({ code, rows: n, revision: body?.expected_revisions?.[code] ?? null }));
  return { rows: rows.length, countries, fields: OBSERVED_FIELDS.map((f) => ({ field: f, label: fieldLabel(f), rows: fields[f] })) };
}

/** One file row as the review table draws it, numbered from 1 as in the file. */
export function importRowView(r, i, body) {
  const code = String(r?.country_code ?? '').trim().toUpperCase();
  return {
    n: i + 1, code, field: fieldLabel(r?.field), value: fieldValueWords(r?.field, r?.value),
    status: statusWord(r?.status === undefined ? 'recorded' : r.status),
    source: r?.source || NOT_RECORDED, ref: r?.source_ref || '—', asOf: r?.as_of || NOT_RECORDED,
    revision: body?.expected_revisions?.[code] ?? null,
  };
}

/**
 * The Worker's answer to an import (200 or 207, LCD-01 C and D) against the body sent: the countries written with
 * their rows and revisions, and the countries that changed since the file was built, which got nothing.
 */
export function importOutcome(result, body) {
  const summary = importSummary(body);
  const byCode = Object.fromEntries(summary.countries.map((c) => [c.code, c]));
  const written = Object.entries(result?.applied || {}).map(([code, n]) => {
    const read = byCode[code]?.revision ?? null;
    return { code, rows: Number(n), revisionRead: read, revisionNow: read === null ? null : read + Number(n) };
  });
  const notWritten = (Array.isArray(result?.conflicts) ? result.conflicts : []).map((c) => ({
    code: c.country_code, rows: byCode[c.country_code]?.rows ?? 0,
    revisionInFile: byCode[c.country_code]?.revision ?? null, revisionNow: c.current_revision ?? null,
  }));
  const rowsWritten = written.reduce((s, w) => s + w.rows, 0);
  const partial = notWritten.length > 0;
  const names = listWords(notWritten.map((c) => c.code));
  const them = notWritten.length === 1 ? 'it' : 'them';
  const recorded = `${plural(rowsWritten, 'observation', 'observations')} recorded for ${plural(written.length, 'country', 'countries')}.`;
  return {
    partial, written, notWritten, rowsWritten,
    line: partial ? `${recorded} ${plural(notWritten.length, 'country', 'countries')} changed since this file was built: ${names}. Nothing was written for ${them}.` : recorded,
    live: partial ? `${recorded} ${names} changed since the file was built; nothing was written for ${them}.` : recorded,
  };
}

/**
 * A refused or failed write in words (LCD-01 E, LCD-02 B and C, LCD-05): the Worker's sentence and code, its
 * problems by field (`fields`) or by row (`rows`, renumbered from 1 as in the file), the countries it names and the
 * revision the country is at now. `answered` is false when no answer came back (no status, or a 5xx): what the
 * Worker did is then unknown, and the page says so instead of the error.
 */
export function refusalOf(e, body) {
  const data = e?.data && typeof e.data === 'object' ? e.data : {};
  const answered = Number.isInteger(e?.status) && e.status > 0 && e.status < 500;
  const rows = Array.isArray(data.rows) ? data.rows.flatMap((r) => Object.entries(r?.fields || {}).map(([field, words]) => ({
    n: Number(r.row) + 1,
    code: String(body?.observations?.[r.row]?.country_code ?? '').trim().toUpperCase() || NOT_RECORDED,
    field, words: String(words),
  }))) : [];
  return {
    answered,
    status: e?.status ?? null,
    code: e?.code || null,
    sentence: e?.message || 'The Worker refused this without a sentence.',
    fields: data.fields && typeof data.fields === 'object' ? data.fields : {},
    rows,
    countries: Array.isArray(data.countries) ? data.countries : [],
    currentRevision: Number.isInteger(data.current_revision) ? data.current_revision : null,
  };
}

/** The problems a refusal puts under the form's fields: the Worker's `fields`, and its reason or status sentence. */
export function formErrors(refusal) {
  if (!refusal) return {};
  const out = { ...(refusal.fields || {}) };
  if (refusal.code === 'reason_required') out.reason = refusal.sentence;
  if (refusal.code === 'invalid_status' && !out.status) out.status = refusal.sentence;
  return out;
}

/**
 * Which statuses each mode of the Record observation sheet offers for a field (LCD-02, LCD-03, owner Q9 A).
 * Record a value: Recorded or Provisional; a rank, Recorded only. Change a field's status: Provisional only where a
 * value exists and is not already provisional (never for a rank), Not recorded where a value exists, and nothing for
 * a field already Not recorded (it offers only Record a value).
 */
export function statusChoices(field, now) {
  const rank = field === 'startup_ecosystem_rank';
  const has = now?.value !== null && now?.value !== undefined;
  return {
    record: rank ? ['recorded'] : ['recorded', 'provisional'],
    status: !has ? [] : rank ? ['not_recorded'] : [...(now?.status === 'provisional' ? [] : ['provisional']), 'not_recorded'],
  };
}

/** A typed number with its grouping (`41,250`, `41 250`) read as a number; anything else sent as typed. */
export function typedValue(s) {
  const t = String(s ?? '').trim().replace(/[,\s_]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

/** The body of `POST …/countries/:code/observations`: the form as typed, with the revision read on screen. */
export function observationBody(form, revision) {
  return {
    field: form.field,
    value: typedValue(form.value),
    status: form.status || 'recorded',
    source: String(form.source ?? ''),
    source_ref: String(form.source_ref ?? '').trim() || null,
    as_of: String(form.as_of ?? '').trim(),
    reason: String(form.reason ?? ''),
    expected_revision: revision,
  };
}

/** The body of `PUT …/fields/:field/status`. */
export const statusBody = (status, reason, revision) => ({ status, reason: String(reason ?? ''), expected_revision: revision });

const KIND_WORDS = Object.freeze({
  value_without_history: 'No history row for this value',
  differs_from_history: 'Differs from its latest history row',
  cleared_but_history_holds_value: 'Not recorded, yet its latest history row holds a value',
  history_ahead_of_profile: 'Its latest history row names a later revision than the profile',
});

/**
 * The consistency read (#7714, `GET …/consistency`) as the flags draw it (LCD-04, owner Q8 A): `reading` until it
 * answers, `unavailable` when it failed (no flag, and never "all consistent"), else `ok` with the findings by
 * country and field and how much was checked.
 */
export function consistencyFlags(res) {
  if (!res || res.state === 'loading') return { state: 'reading', byCountry: {}, countries: [], total: 0, checked: null };
  if (res.state !== 'ok' || !res.data || !Array.isArray(res.data.findings)) return { state: 'unavailable', byCountry: {}, countries: [], total: 0, checked: null };
  const byCountry = {};
  for (const f of res.data.findings) (byCountry[f.country_code] ||= {})[f.field] = f;
  return { state: 'ok', byCountry, countries: Object.keys(byCountry), total: res.data.findings.length, checked: res.data.checked || null };
}

/** One finding in words: what differs, the history's side, and the frozen snapshots holding the value. */
export function findingLine(f) {
  if (!f) return null;
  let line = KIND_WORDS[f.kind] || 'Differs from its history';
  if (f.kind === 'differs_from_history' && f.history) {
    const diffs = f.differences || [];
    const others = diffs.filter((d) => d !== 'value').map((d) => (d === 'source_ref' ? 'reference' : d === 'as_of' ? 'as-of date' : d));
    const value = diffs.includes('value') ? `profile ${fieldValueWords(f.field, f.profile?.value)} · history ${fieldValueWords(f.field, f.expected?.value)}` : null;
    const parts = [value, others.length ? `${listWords(others)} ${others.length === 1 ? 'differs' : 'differ'}` : null].filter(Boolean);
    line += `: ${parts.join(' · ')} (${f.history.as_of || NOT_RECORDED}, revision ${f.history.profile_revision})`;
  }
  const n = f.snapshots?.count;
  if (Number.isFinite(n) && n > 0) line += ` · ${plural(n, 'frozen pricing snapshot holds', 'frozen pricing snapshots hold')} it`;
  return line;
}

/** The checked-and-clean line (LCD-04 C), or null when there is something to flag or the check did not answer. */
export function consistencyClearLine(flags) {
  if (flags.state !== 'ok' || flags.total > 0 || !flags.checked) return null;
  return `Checked ${flags.checked.countries} countries and ${flags.checked.fields} fields: every value matches its history.`;
}

/** One history row as the country page draws it, newest first. */
export function historyRow(o) {
  const cleared = o.kind === 'status' && o.status === 'not_recorded';
  return {
    key: o.uid,
    at: o.ingested_at ? String(o.ingested_at).slice(0, 16).replace('T', ' ') : NOT_RECORDED,
    field: fieldLabel(o.field),
    value: cleared ? NOT_RECORDED : fieldValueWords(o.field, o.value),
    status: statusWord(o.status),
    statusKey: o.status === 'recorded' ? 'value' : o.status,
    source: o.source ? `${o.source}${o.source_ref ? ` · ${o.source_ref}` : ''}` : '—',
    asOf: o.as_of || '—',
    by: o.recorded_by || NOT_RECORDED,
    reason: o.reason || NOT_RECORDED,
    revision: o.profile_revision,
  };
}
