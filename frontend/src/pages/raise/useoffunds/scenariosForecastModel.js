/**
 * D1178 (#3105) — Use of funds part 5: Scenarios (UF9), Scenarios compared
 * (UF10, UF11) and Runway › Forecast (UF8), and the old financial model's
 * addresses forwarding there. Pure, so `frontend/test/use_of_funds_d1178.test.mjs`
 * holds each rule without a browser.
 *
 * READS. Scenarios and Compare draw D1176's `GET /scenarios` and `GET
 * /compare` (each scenario with its lines, milestones and D1175's model).
 * Forecast draws the financial model's own store, `GET /api/financials/:id`:
 * its ten drivers, each with the source `_sources` records, and the projection
 * and sensitivity the Worker computed when it was saved. Every figure the
 * forecast shows is Modelled, and the forecast is never runway today
 * (#2455 owner question 1). No Capital score is drawn (owner question 2).
 */
import { HOME_PATH, NOT_RECORDED, SECTIONS, afterRaiseView, dayText, money, monthsText, runwayTodayView, tabSearch } from './useOfFundsModel';

/* Addresses ------------------------------------------------------------- */

export const FORECAST_PATH = `${HOME_PATH}/runway/forecast`;
export const COMPARE_PATH = `${HOME_PATH}/scenarios/compare`;
export const forecastPath = (search = '') => `${FORECAST_PATH}${tabSearch(search)}`;

/** The words a moved address shows once it lands (UF8's notice). */
export const MOVED = Object.freeze({
  'capital-model': 'Financial model is now Forecast, under Use of funds › Runway.',
});

/**
 * Where an old financial-model address lands: Runway › Forecast, the query
 * and hash kept, `?project=` as the tool's `?project_id=`, and `moved` naming
 * the notice.
 */
export function movedTo(search = '', moved = 'capital-model') {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (q.has('project')) {
    if (!q.has('project_id')) q.set('project_id', q.get('project'));
    q.delete('project');
  }
  if (moved) q.set('moved', moved);
  const out = q.toString();
  return { pathname: FORECAST_PATH, search: out ? `?${out}` : '' };
}

/** The moved notice's words for this address, or null. */
export const movedNotice = (search = '') => MOVED[new URLSearchParams(String(search || '').replace(/^\?/, '')).get('moved')] || null;

/** Compare's address for these scenarios, the venture kept. */
export function compareHref(ids = [], search = '') {
  const q = new URLSearchParams(tabSearch(search).replace(/^\?/, ''));
  if (ids.length) q.set('ids', ids.join(','));
  const out = q.toString();
  return `${COMPARE_PATH}${out ? `?${out}` : ''}`;
}

/** The scenario ids an address compares: one to four distinct whole ids, in order. */
export function compareIds(search = '') {
  const raw = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('ids') || '';
  const out = [];
  for (const part of raw.split(',')) {
    if (/^[1-9]\d{0,9}$/.test(part) && !out.includes(Number(part))) out.push(Number(part));
    if (out.length === 4) break;
  }
  return out;
}

export const MAX_COMPARE = 4;

/* Forecast (UF8) -------------------------------------------------------- */

/** The ten drivers, in the canvas's order, with the store's keys. Values are whole dollars, percents, counts or months. */
export const DRIVERS = [
  { key: 'starting_cash', label: 'Starting cash', kind: 'money' },
  { key: 'price_per_unit', label: 'Price per customer a month', kind: 'money' },
  { key: 'units_month_0', label: 'Starting customers', kind: 'count' },
  { key: 'monthly_growth_pct', label: 'Monthly growth', kind: 'pct', min: -100, max: 200 },
  { key: 'monthly_churn_pct', label: 'Monthly churn', kind: 'pct' },
  { key: 'cac', label: 'CAC', kind: 'money' },
  { key: 'gross_margin_pct', label: 'Gross margin', kind: 'pct' },
  { key: 'salaries_monthly', label: 'Payroll a month', kind: 'money' },
  { key: 'opex_monthly', label: 'Other costs a month', kind: 'money' },
  { key: 'horizon_months', label: 'Forecast length', kind: 'months' },
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const dollars = (v) => (isNum(v) ? money(Math.round(v * 100), 'usd') : null);

/** A driver's value as the page shows it, or null when it is empty. */
export function driverText(kind, v) {
  if (!isNum(v)) return null;
  if (kind === 'money') return dollars(v);
  if (kind === 'pct') return `${Math.round(v * 10) / 10}%`;
  if (kind === 'months') return `${Math.round(v)} months`;
  return Math.round(v).toLocaleString('en-US');
}

/** The source a driver's store records: Typed, a connector, or nothing recorded. */
export function driverSource(raw) {
  if (raw === 'typed') return { source: 'Typed', detail: '' };
  if (raw === 'stripe') return { source: 'Connector', detail: 'Stripe' };
  if (typeof raw === 'string' && raw) return { source: 'Connector', detail: raw };
  return { source: null, detail: 'Source not recorded' };
}

/** Each driver with its value and source; an empty one is Not recorded and stops the forecast. */
export function driverRows(read) {
  const a = read?.assumptions || {};
  const sources = a._sources || {};
  return DRIVERS.map((d) => {
    const value = driverText(d.kind, a[d.key]);
    return { ...d, value, missing: value == null, ...driverSource(sources[d.key]) };
  });
}

/** Why the forecast does not run, or null when every driver is recorded and it was saved. */
export function forecastGap(read) {
  if (!read || read.exists === false) return 'No forecast is saved yet. Set the ten drivers to run it.';
  const missing = driverRows(read).filter((d) => d.missing);
  if (missing.length) return `Add ${missing[0].label.toLowerCase()} to run the forecast.`;
  return null;
}

/** The four Modelled tiles: forecast runway, average burn, breakeven month and LTV to CAC. */
export function forecastTiles(read) {
  const gap = forecastGap(read);
  const c = read?.computed || {};
  if (gap) {
    return [
      { key: 'runway', label: 'Forecast runway', value: null, sub: gap },
      { key: 'burn', label: 'Average burn', value: null, sub: 'Waits for the drivers.' },
      { key: 'breakeven', label: 'Breakeven month', value: null, sub: 'Waits for the drivers.' },
      { key: 'ltv', label: 'LTV to CAC', value: null, sub: 'Waits for the drivers.' },
    ];
  }
  const horizon = read.assumptions.horizon_months;
  return [
    { key: 'runway', label: 'Forecast runway', value: isNum(c.runway_months) ? monthsText(c.runway_months) : null,
      sub: c.runway_capped === false ? 'ƒ Modelled · cash lasts past the forecast’s length; the figure is extended from its last month' : 'ƒ Modelled' },
    { key: 'burn', label: 'Average burn', value: isNum(c.avg_monthly_burn) ? `${dollars(c.avg_monthly_burn)} a month` : null, sub: 'ƒ Modelled' },
    { key: 'breakeven', label: 'Breakeven month', value: isNum(c.breakeven_month) ? `Month ${c.breakeven_month}` : `Not within ${horizon} months`,
      sub: isNum(c.breakeven_month) ? 'ƒ Modelled · counted from the forecast’s first month' : 'ƒ Modelled · net never turns positive in the forecast' },
    { key: 'ltv', label: 'LTV to CAC', value: isNum(c.ltv_cac_ratio) ? `${Math.round(c.ltv_cac_ratio * 10) / 10}` : null,
      sub: isNum(c.ltv_cac_ratio) ? 'ƒ Modelled · from price, margin, churn and CAC' : 'Not recorded: CAC is zero, so there is no ratio' },
  ];
}

/** The cash trajectory and revenue against net, month by month, in whole cents. */
export function forecastSeries(read) {
  if (forecastGap(read)) return null;
  const months = Array.isArray(read?.computed?.months) ? read.computed.months : [];
  if (!months.length) return null;
  return {
    cash: months.map((m) => ({ month: `M${m.month}`, cents: Math.round(Number(m.cash) * 100) })),
    revenue: months.map((m) => ({ month: `M${m.month}`, cents: Math.round(Number(m.revenue) * 100) })),
    net: months.map((m) => ({ month: `M${m.month}`, cents: Math.round(Number(m.net) * 100) })),
    cashOut: months.findIndex((m) => Number(m.cash) <= 0),
  };
}

/** The sensitivity table: each driver's forecast runway at −20% to +20%; the 0% column is the forecast as set. */
export function sensitivityRows(read) {
  if (forecastGap(read)) return null;
  const rows = read?.sensitivity?.rows;
  if (!Array.isArray(rows) || !rows.length) return null;
  const LABEL = { price_per_unit: 'Price', units_month_0: 'Starting customers', cac: 'CAC' };
  return rows.map((r) => ({
    key: r.driver,
    label: LABEL[r.driver] || r.label,
    cells: (r.cells || []).map((cell) => ({ delta: cell.delta_pct, base: cell.delta_pct === 0, text: isNum(cell.runway_months) ? (Math.round(cell.runway_months * 10) / 10).toFixed(1) : NOT_RECORDED })),
  }));
}

/** Each driver's rule in the Edit drivers dialog, as the store's strict validation reads it. */
export function driverError(kind, raw, bounds = {}) {
  const t = String(raw ?? '').trim().replace(/[$,\s]/g, '').replace(/%$/, '');
  if (t === '') return 'An empty driver stops the forecast.';
  const n = Number(t);
  // Growth alone may shrink: the store takes −100% to 200% (`routes/financials.ts`).
  const min = bounds.min ?? 0;
  if (!Number.isFinite(n) || n < min) return min < 0 ? `Type a number from ${min} to ${bounds.max}.` : 'Type a number, 0 or more.';
  if (bounds.max != null && n > bounds.max) return `Type a number from ${min} to ${bounds.max}.`;
  if (kind === 'pct' && bounds.max == null && n > 100) return 'A percentage is 100 at most.';
  if (kind === 'months' && (!Number.isInteger(n) || n < 3 || n > 60)) return 'The forecast runs 3 to 60 whole months.';
  if (kind === 'count' && !Number.isInteger(n)) return 'Type a whole number.';
  return null;
}

/** The body the store takes: every driver as a number, and only when each is valid. */
export function driversBody(values) {
  const errors = {};
  const assumptions = {};
  for (const d of DRIVERS) {
    const e = driverError(d.kind, values[d.key], d);
    if (e) errors[d.key] = e;
    else assumptions[d.key] = Number(String(values[d.key]).trim().replace(/[$,\s]/g, '').replace(/%$/, ''));
  }
  return Object.keys(errors).length ? { errors } : { assumptions };
}

/** The drivers that change between what is saved and what is typed, by name: the dialog says what it changes. */
export function changedDrivers(read, values) {
  const a = read?.assumptions || {};
  return DRIVERS.filter((d) => String(a[d.key] ?? '') !== String(values[d.key] ?? '').trim().replace(/[$,\s]/g, '').replace(/%$/, '')).map((d) => d.label);
}

/* Scenarios (UF9) ------------------------------------------------------- */

const share = (s, key) => s?.lines?.find((l) => l.category_key === key)?.share_pct ?? null;

/** "3 of 4 · 1 not costed", from the model's milestones; "No milestones yet" when there are none. */
export function fundedLine(s) {
  const list = s?.model?.milestones?.value;
  if (!Array.isArray(list)) return s?.model?.milestones?.reason || NOT_RECORDED;
  if (!list.length) return 'No milestones yet';
  const funded = list.filter((m) => m.state === 'Funded').length;
  const notCosted = list.filter((m) => m.state === 'Not costed').length;
  return `${funded} of ${list.length}${notCosted ? ` · ${notCosted} not costed` : ''}`;
}

/** One scenario's card: its raise, split, runway after the raise, milestones funded and cap-table link. */
export function scenarioCard(s) {
  const after = afterRaiseView(s);
  return {
    id: s.id,
    name: s.name || 'Unnamed scenario',
    base: !!s.is_base,
    raise: money(s.amount_to_raise_cents, s.currency),
    currency: s.currency || 'USD',
    split: SECTIONS.map((sec) => ({ key: sec.key, short: sec.short, label: sec.label, share: share(s, sec.key) })),
    splitKnown: SECTIONS.every((sec) => share(s, sec.key) != null),
    runway: after,
    target: s.target_runway_months ?? null,
    milestones: fundedLine(s),
    // Migration 606 stores no link to a cap-table scenario (D1176), so none is shown.
    capTable: 'No cap-table scenario linked',
    changed: dayText(s.updated_at || s.created_at),
  };
}

/** Make this the base (UF9m): what the deck and readiness will read, and whether it runs short of the target. */
export function makeBaseView(s) {
  const card = scenarioCard(s);
  const r = card.runway;
  const short = r.months != null && r.relation === 'exact' && card.target != null && r.months < card.target ? Math.round((card.target - r.months) * 10) / 10 : null;
  return { ...card, short, warning: short != null ? `${card.name} runs ${short} months short of your target.` : null, blocked: !card.splitKnown ? 'Record a complete split totalling 100% before making this scenario the base.' : null };
}

/** The body for a scenario's Edit: only what is typed; an empty raise is not recorded, never 0. */
export function scenarioBody(f) {
  const out = {};
  const name = String(f.name ?? '').trim();
  if (!name) return { error: 'Name the scenario.' };
  out.name = name.slice(0, 120);
  const raise = String(f.raise ?? '').trim().replace(/[$,\s]/g, '');
  if (raise === '') out.amount_to_raise_cents = null;
  else if (!/^\d+(\.\d{1,2})?$/.test(raise)) return { error: 'Type the raise in whole dollars, such as 1500000.' };
  else out.amount_to_raise_cents = Math.round(Number(raise) * 100);
  const target = Number(f.target);
  if (!Number.isInteger(target) || target < 1 || target > 120) return { error: 'The target runway is 1 to 120 whole months.' };
  out.target_runway_months = target;
  const shares = SECTIONS.map((s) => String(f.shares?.[s.key] ?? '').trim());
  if (shares.every((v) => v === '')) return { body: out };
  if (shares.some((v) => !/^\d{1,3}$/.test(v) || Number(v) > 100)) return { error: 'Each share is a whole percent from 0 to 100, or leave all five empty.' };
  const total = shares.reduce((a, v) => a + Number(v), 0);
  if (total !== 100) return { error: `The shares add to ${total}%. They must add to 100%.` };
  out.lines = SECTIONS.map((s, i) => ({ key: s.key, share_pct: Number(shares[i]) }));
  return { body: out };
}

/* Compare (UF10, UF11) -------------------------------------------------- */

const avgBurn = (s) => {
  const b = s?.model?.burn?.value;
  return Array.isArray(b) && b.length ? Math.round(b.reduce((a, x) => a + x.spendCents, 0) / b.length) : null;
};
const cashOutMonth = (s) => {
  const out = s?.model?.cashOut?.value;
  const path = s?.model?.cashPath?.value;
  if (!out || !Array.isArray(path)) return null;
  if (!out.withinHorizon) return `after ${path[path.length - 1].month}`;
  return path[Math.min(path.length - 1, Math.floor(out.months))]?.month ?? null;
};

/**
 * The comparison table: Today (the record, no raise) and each scenario
 * (Modelled). A figure nobody recorded is Not recorded with why, never 0.
 */
export function compareTable(read, viewer = {}) {
  const today = runwayTodayView(read?.today, viewer);
  const scenarios = Array.isArray(read?.scenarios) ? read.scenarios : [];
  const cols = scenarios.map((s) => ({ id: s.id, name: `${s.name || 'Unnamed scenario'}${s.is_base ? ' · base' : ''}` }));
  const cell = (text, reason = null) => ({ text: text ?? NOT_RECORDED, missing: text == null, reason: text == null ? reason : null });
  const rows = [
    { key: 'raise', label: 'Raise', today: { text: 'No raise' }, cells: scenarios.map((s) => cell(money(s.amount_to_raise_cents, s.currency), 'No raise is recorded')) },
    ...SECTIONS.map((sec) => ({
      key: sec.key, label: sec.label, today: { text: '—' },
      cells: scenarios.map((s) => {
        const pct = share(s, sec.key);
        return cell(pct != null && s.amount_to_raise_cents != null ? money(Math.round((s.amount_to_raise_cents * pct) / 100), s.currency) : null, 'The share or the raise is not recorded');
      }),
    })),
    { key: 'burn', label: 'Planned burn', today: { text: today.burn ? `${today.burn} · burn today` : NOT_RECORDED, missing: !today.burn },
      cells: scenarios.map((s) => cell(avgBurn(s) != null ? `${money(avgBurn(s), s.currency)} a month` : null, s?.model?.burn?.reason)) },
    { key: 'runway', label: 'Runway after the raise', today: { text: today.value ? `${today.value} · runway today` : NOT_RECORDED, missing: !today.value },
      cells: scenarios.map((s) => { const a = afterRaiseView(s); return cell(a.value, a.sub); }) },
    { key: 'cashout', label: 'Cash out', today: { text: '—' }, cells: scenarios.map((s) => cell(cashOutMonth(s), s?.model?.cashOut?.reason)) },
    { key: 'milestones', label: 'Milestones funded', today: { text: '—' }, cells: scenarios.map((s) => cell(fundedLine(s))) },
    // Neither is read here yet: migration 606 links no cap-table scenario, and no read carries a round's commitments (D1177 §9).
    { key: 'founders', label: 'Founders after the round', today: { text: NOT_RECORDED, missing: true }, cells: scenarios.map(() => cell(null, 'No cap-table scenario linked')) },
    { key: 'committed', label: 'Committed so far', today: { text: NOT_RECORDED, missing: true }, cells: scenarios.map(() => cell(null, 'Commitments are not read here yet')) },
  ];
  return { cols, rows, today };
}

/** Each scenario's cash path, closing cash by month, for the chart and its table. */
export function cashPaths(read) {
  return (Array.isArray(read?.scenarios) ? read.scenarios : []).map((s) => {
    const path = s?.model?.cashPath?.value;
    return { id: s.id, name: s.name || 'Unnamed scenario', currency: s.currency, points: Array.isArray(path) ? path.map((p) => ({ month: p.month, cents: p.closingCents })) : null, reason: s?.model?.cashPath?.reason || null };
  });
}

/** Milestones funded, by section, for each scenario: counts only, with Not costed apart. */
export function fundedBySection(read) {
  const scenarios = Array.isArray(read?.scenarios) ? read.scenarios : [];
  return SECTIONS.map((sec) => ({
    key: sec.key, label: sec.short,
    values: scenarios.map((s) => {
      const mine = (s.milestones || []).filter((m) => m.category_key === sec.key).map((m) => String(m.id));
      const states = (s?.model?.milestones?.value || []).filter((m) => mine.includes(String(m.id)));
      return { id: s.id, funded: states.filter((m) => m.state === 'Funded').length, notCosted: states.filter((m) => m.state === 'Not costed').length, total: mine.length };
    }),
  }));
}

/** A cash path's sentence for the chart's label: where each one runs out. */
export function cashSentence(paths) {
  const parts = paths.map((p) => {
    if (!p.points) return `${p.name}: not recorded`;
    const out = p.points.findIndex((x) => x.cents <= 0);
    return out >= 0 ? `${p.name} runs out in ${p.points[out].month}` : `${p.name} lasts past ${p.points[p.points.length - 1].month}`;
  });
  return `Cash paths: ${parts.join('; ')}.`;
}
