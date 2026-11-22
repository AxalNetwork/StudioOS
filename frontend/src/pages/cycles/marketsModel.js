/**
 * D6120 (#6120, Grow v2 Markets GR-21 to GR-28) — the Markets page's rules, pure: no React, no read.
 *
 * The list read (`GET /api/cycles/grow/modules/market-expansion`) and the market record's `parts.market`
 * (`services/records/grow.ts`) send the stored values; this file says how each one reads. Every figure
 * has its source beside it or reads Not recorded with the reason: an unscored part is never a 0, a
 * measured 0 says so, and a read that failed (`*_state: 'unreadable'`) is Unavailable, never "none".
 */
import { toMajorString } from '../../lib/money.js';

export const MARKET_PARTS = Object.freeze([
  ['demand', 'Demand'], ['regulation', 'Regulation'], ['partners', 'Partners'], ['cost', 'Cost to enter'],
]);

/** A state is a word and a glyph, never a colour alone (GR-21). */
export const MARKET_STATES = Object.freeze({
  considering: { label: 'Considering', glyph: '◌' },
  entering: { label: 'Entering', glyph: '▸' },
  served: { label: 'Served', glyph: '✓' },
  not_now: { label: 'Not now', glyph: '–' },
});
export const MARKET_DECISIONS = Object.freeze({
  enter: { label: 'Enter', glyph: '✓' },
  not_yet: { label: 'Not yet', glyph: '◷' },
  exit: { label: 'Exit', glyph: '✕' },
});
export const STATE_ORDER = Object.freeze(['considering', 'entering', 'served', 'not_now']);

export const SORTS = Object.freeze([
  { key: '-readiness', label: 'Readiness, highest first' },
  { key: 'name', label: 'Name' },
]);

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (v == null ? '' : String(v).trim());
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-02" → "2 Oct 2026" (or "2 Oct" with `short`); anything else is null. */
export function dayLabel(v, short = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(v));
  if (!m) return null;
  const month = MON[Number(m[2]) - 1];
  if (!month) return null;
  return `${Number(m[3])} ${month}${short ? '' : ` ${m[1]}`}`;
}

/** Whole days from `a` to `b` (both YYYY-MM-DD); null when either is not a day. */
export function daysBetween(a, b) {
  const da = Date.parse(`${str(a).slice(0, 10)}T00:00:00Z`);
  const db = Date.parse(`${str(b).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(da) && Number.isFinite(db) ? Math.round((db - da) / 86400000) : null;
}

export const todayOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** The four parts of a market, from the list row's `<k>_score`/`<k>_source` or the record's `scores`. */
export function partsOf(m) {
  if (Array.isArray(m?.scores)) {
    return MARKET_PARTS.map(([key, part]) => {
      const s = m.scores.find((x) => x?.key === key) || {};
      return { key, part, score: num(s.score) ? s.score : null, source: str(s.source) || null };
    });
  }
  return MARKET_PARTS.map(([key, part]) => ({
    key, part, score: num(m?.[`${key}_score`]) ? m[`${key}_score`] : null, source: str(m?.[`${key}_source`]) || null,
  }));
}

/** Readiness out of 40 only when all four are scored; otherwise null with the missing parts named. */
export function readinessOf(parts) {
  const missing = parts.filter((p) => p.score == null).map((p) => p.part);
  return { score: missing.length ? null : parts.reduce((n, p) => n + p.score, 0), missing };
}

/** The weakest part: the first unscored one, else the lowest score (the first of equals). */
export function weakestOf(parts) {
  const gap = parts.find((p) => p.score == null);
  if (gap) return { part: gap.part, score: null };
  if (!parts.length) return null;
  const low = parts.reduce((a, b) => (b.score < a.score ? b : a));
  return { part: low.part, score: low.score };
}

/** "Regulation, Cost to enter not scored". */
export const missingLine = (missing) => `${missing.join(', ')} not scored`;

/** A list row as the page draws it. Counts the read could not supply stay null (Not recorded on the page). */
export function marketView(row) {
  const parts = partsOf(row);
  const rd = readinessOf(parts);
  const replies = Array.isArray(row?.replies) ? row.replies : null;
  const plan = num(row?.steps_total) ? {
    total: row.steps_total, open: num(row.steps_open) ? row.steps_open : 0, overdue: num(row.steps_overdue) ? row.steps_overdue : 0,
  } : null;
  const loc = num(row?.localisation_done) ? {
    done: row.localisation_done, open: Array.isArray(row.localisation_open) ? row.localisation_open.map(String) : [],
  } : null;
  return {
    uid: row?.uid == null ? null : String(row.uid),
    name: str(row?.name),
    state: Object.hasOwn(MARKET_STATES, row?.state) ? row.state : null,
    decision: Object.hasOwn(MARKET_DECISIONS, row?.decision) ? row.decision : null,
    decidedOn: str(row?.decided_on) || null,
    parts, readiness: rd.score, missing: rd.missing, weakest: weakestOf(parts),
    country: row?.country_name ? { name: String(row.country_name), region: str(row.country_region) || null } : null,
    geography: str(row?.geography_ref) || null,
    replies,
    size: num(row?.size_cents) ? { cents: row.size_cents, currency: str(row.size_currency) || null, source: str(row.size_source) || null } : null,
    plan, localisation: loc,
  };
}

/**
 * A market's money size, compact ("€4.2M"), from its minor units through `lib/money.js` (never a bare /100).
 * A currency that is not a listed one prints its amount in minor units' plain digits beside its code.
 */
export function sizeLabel(size) {
  if (!size || !num(size.cents)) return null;
  const cur = str(size.currency).toUpperCase();
  const major = cur ? toMajorString(size.cents, cur) : null;
  if (major == null) return cur ? `${size.cents.toLocaleString('en-US')} ${cur} (minor units)` : `${size.cents.toLocaleString('en-US')} (minor units, no currency)`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 1 }).format(Number(major));
}

const LOC_LABEL = { language: 'Language', payments: 'Payments', legal_entity: 'Legal entity' };
export const localisationLabel = (key) => LOC_LABEL[key] || str(key);

/**
 * GR-21's next step for a row: the first unscored part ("Score regulation, and say where it came from");
 * then, once all four are scored, the first entry step when there is none, then the first open
 * localisation check. A market Not now or decided Exit has none, and nor does a row whose plan counts
 * could not be read. `edit` and `step` name the record action the link opens.
 */
export function nextStep(view) {
  const gap = view.parts.find((p) => p.score == null);
  if (gap) return { text: `Score ${gap.part.toLowerCase()}, and say where it came from`, open: 'edit' };
  if (view.state === 'not_now' || view.decision === 'exit') return null;
  if (!view.plan) return null;
  if (view.plan.total === 0) return { text: 'Add the first entry step', open: 'add-entry-step' };
  if (view.localisation?.open?.length) return { text: `Tick ${localisationLabel(view.localisation.open[0])}`, open: null, hash: 'localisation' };
  return null;
}

/** The state chips: All and each state, with the read's count over every market (never the filtered page). */
export function stateChips(counts) {
  const c = counts && typeof counts === 'object' ? counts : null;
  const of = (k) => (c && num(c[k]) ? c[k] : null);
  const all = c ? STATE_ORDER.reduce((n, k) => n + (of(k) ?? 0), 0) : null;
  return [{ value: '', label: 'All', count: all }, ...STATE_ORDER.map((k) => ({ value: k, label: MARKET_STATES[k].label, count: of(k) }))];
}

/** GR-23: one part's difference, in words. An unscored side is never compared. */
export function diffWords(a, b, key) {
  const x = a.parts.find((p) => p.key === key); const y = b.parts.find((p) => p.key === key);
  if (!x || !y) return null;
  if (x.score == null || y.score == null) {
    return { compared: false, text: `Can’t compare: ${x.score == null ? a.name : b.name} has no ${x.part.toLowerCase()} score` };
  }
  if (x.score === y.score) return { compared: true, text: `Level at ${x.score}` };
  return { compared: true, text: `${x.score > y.score ? a.name : b.name} leads on ${x.part} by ${Math.abs(x.score - y.score)}` };
}

/** GR-23: the panel's rows after the four parts — readiness, weakest part, localisation, open steps, size, decision. */
export function compareSummary(a, b) {
  const both = a.readiness != null && b.readiness != null;
  return {
    readiness: both
      ? { compared: true, text: a.readiness === b.readiness ? `Level at ${a.readiness}` : `${a.readiness > b.readiness ? a.name : b.name} leads by ${Math.abs(a.readiness - b.readiness)}` }
      : { compared: false, text: 'Can’t compare until both are fully scored' },
    weakest: a.weakest && b.weakest && a.weakest.part === b.weakest.part ? `Both weakest on ${a.weakest.part}` : null,
    size: a.size && b.size && a.size.source && a.size.source === b.size.source ? 'Same source; compare with care' : null,
  };
}

/** An entry step is overdue when it has a due day before today and is not done. */
export function stepOverdue(step, today) {
  if (!step || step.done_at) return null;
  const due = str(step.due_on).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due >= today) return null;
  return daysBetween(due, today);
}

/** "2 of 5 done · 1 overdue" over the steps the record read (it reads 30 at most; `total` says how many exist). */
export function planLine(steps, total, today) {
  const list = Array.isArray(steps) ? steps : [];
  const done = list.filter((s) => s?.done_at).length;
  const over = list.filter((s) => stepOverdue(s, today) != null).length;
  const n = num(total) ? total : list.length;
  return [`${done} of ${n} done`, over ? `${over} overdue` : null, n > list.length ? `${list.length} shown` : null].filter(Boolean).join(' · ');
}

/**
 * D8255: a country's governance and AML context from the stored indices, one line per source, each with its
 * publisher, edition and as-of day. A country an edition holds no figure for is Not recorded, never a 0; a list
 * edition that does not name the country says so; a failed read is Unavailable.
 */
export function indexLines(name, read) {
  if (read == null) return [{ state: 'not_recorded', label: `Governance and AML indices for ${name}`, reason: 'Not sent with this record.' }];
  const lines = Array.isArray(read.lines) ? read.lines : null;
  if (!lines) return [{ state: 'unavailable', label: `Governance and AML indices for ${name}`, reason: 'They could not be read.' }];
  return lines.map((l) => {
    const who = `${str(l.publisher)} ${l.key === 'wgi' ? 'governance indicators' : 'high-risk list'}${str(l.edition) ? ` ${str(l.edition)}` : ''}`;
    if (l.state === 'ok' && Array.isArray(l.values) && l.values.length) {
      const parts = l.values.map((v) => `${str(v.label).replace(/, percentile rank$/, '')} ${v.value}`).join(' · ');
      return { state: 'value', label: `${who}, ${name}: ${parts}${l.key === 'wgi' ? ' (percentile rank, 0 to 100)' : ''}`, asOf: dayLabel(l.as_of), source: str(l.citation_url) || null };
    }
    if (l.state === 'not_named') return { state: 'value', label: `${who}: ${name} is not named`, asOf: dayLabel(l.as_of), source: str(l.citation_url) || null };
    if (l.state === 'unreadable') return { state: 'unavailable', label: who, reason: str(l.reason) || 'It could not be read.' };
    return { state: 'not_recorded', label: who, reason: str(l.reason) || 'Not recorded.' };
  });
}

/**
 * GR-22's evidence strip, one list per part, from `GET /api/research/geographies/:code`. A line the
 * store does not hold (per-country demand, customers by country, partners covering the country, the
 * WGI and FATF indices) reads Not recorded with its reason, never a count.
 */
export function evidenceFor(geo, indices = null) {
  const name = str(geo?.item?.name) || 'this country';
  const signals = Array.isArray(geo?.signals) ? geo.signals : [];
  const asOf = geo?.as_of || {};
  const named = signals.filter((s) => s?.match === 'country').length;
  const regional = signals.filter((s) => s?.match === 'region').length;
  const byMarket = (Array.isArray(geo?.companies_by_market) ? geo.companies_by_market : []).filter((r) => r?.name && num(r.count)).slice(0, 2);
  const nr = (label, reason) => ({ state: 'not_recorded', label, reason });
  const v = (label, at) => ({ state: 'value', label, asOf: dayLabel(at) });
  return {
    demand: [
      v(`Signals naming ${name}: ${named}`, asOf.signals),
      nr('Per-country demand', str(geo?.demand?.reason) || 'Demand data is global only.'),
      nr(`Customers or sign-ups from ${name}`, 'Customers and prospects carry no country yet.'),
    ],
    regulation: [
      v(`Signals naming only ${str(geo?.item?.region) || 'its region'}: ${regional}`, asOf.signals),
      ...indexLines(name, indices),
    ],
    partners: [
      v(`Companies in ${name}: ${num(geo?.company_count) ? geo.company_count : 0}`, asOf.companies),
      nr(`Partners covering ${name}`, 'Partners are not linked to a market yet.'),
    ],
    cost: [
      v(`Funds headquartered in ${name}: ${num(geo?.fund_count) ? geo.fund_count : 0}`, asOf.funds),
      ...(byMarket.length ? [v(`Companies by market: ${byMarket.map((r) => `${r.name} ${r.count}`).join(' · ')}`, asOf.companies)] : []),
    ],
  };
}

/** The record's handoffs keep the venture; Back from them returns to this market (`state.from`). */
export function handoffLinks(search = '') {
  const q = typeof search === 'string' && search.startsWith('?') ? search.split('#')[0] : '';
  return [
    { text: 'Plan a channel in Distribution', href: `/grow/distribution${q}` },
    { text: 'Add a partner in Partnerships', href: `/grow/partnerships${q}` },
  ];
}

/** Legal entity's handoff: the obligation is added in Company, the venture kept. */
export function legalEntityHref(search = '') {
  const q = typeof search === 'string' && search.startsWith('?') ? search.split('#')[0] : '';
  return `/grow/durable-company-building${q ? `${q}&add=1` : '?add=1'}`;
}
