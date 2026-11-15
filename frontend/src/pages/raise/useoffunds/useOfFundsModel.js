/**
 * D1173 (#2455) — the Use of funds tool's addresses and words, kept pure so
 * the tests read them without a browser.
 *
 * WHERE THE TOOL LIVES. `/raise/use-of-funds` is CycleRoute's module page
 * (Home), and every `/raise/use-of-funds/<word>` is its record route
 * (`/raise/:slug/:id`). A section record's id is its key (`product`,
 * `go-to-market`, `infrastructure`, `operations`, `reserve`), so the tool's
 * tabs are other words, which CycleRoute reads as tabs and never as records
 * (`isUseOfFundsTab`), as D1101 did for the Data room. No route is added.
 *
 * WHAT IS READ TODAY. `GET /api/cycles/raise/modules/use-of-funds` draws Home
 * as today and Allocation's section rows. Milestones and hires, Runway,
 * Scenarios, Plan vs actual and History have no read of their own on `main`,
 * so each said "Not read here yet" with its reason (D1173 §2) until D1177
 * and D1178 drew them. D1178 (#3105) moved the financial model under Runway
 * as Forecast (`/raise/use-of-funds/runway/forecast`); the tool links it with
 * the venture kept, and the old addresses land there.
 */

// #4574 (H4): the addresses live in their own small file so a redirect can import them without this model.
import { SLUG, HOME_PATH } from './useOfFundsPaths.js';
export { SLUG, HOME_PATH };
export const TITLE = 'Use of funds';
export const LINE = 'What the raise pays for, by section, and how long it lasts.';

/** The canvas's tab strip, in its order (UF1). */
export const TABS = [
  { id: 'home', label: 'Home', path: '' },
  { id: 'allocation', label: 'Allocation', path: '/allocation' },
  { id: 'milestones', label: 'Milestones and hires', path: '/milestones' },
  { id: 'runway', label: 'Runway', path: '/runway' },
  { id: 'scenarios', label: 'Scenarios', path: '/scenarios' },
  { id: 'actuals', label: 'Plan vs actual', path: '/actuals' },
  { id: 'history', label: 'History', path: '/history' },
];
const TAB_WORDS = new Set(TABS.filter((t) => t.path).map((t) => t.id));

/** True when CycleRoute's record id under this module is a tab, not a section. */
export const isUseOfFundsTab = (slug, id) => slug === SLUG && TAB_WORDS.has(String(id ?? ''));

/** The query a tab keeps: the venture only. */
export function tabSearch(search = '') {
  const from = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const project = from.get('project_id') || from.get('project');
  return project && /^[1-9]\d*$/.test(project) ? `?project_id=${project}` : '';
}

export const tabHref = (tab, search = '') => `${HOME_PATH}${tab.path}${tabSearch(search)}`;

/** Runway › Forecast, the financial model moved there (D1178), with the venture kept (#2455 broken item 8). */
export const forecastHref = (search = '') => `${HOME_PATH}/runway/forecast${tabSearch(search)}`;


/** Runway's line under the wait: where the forecast is today. */
export const FORECAST_LINE = 'The forecast is a model you set. It is not your runway today.';

/* ------------------------------------------------------------------ *
 * D1177 (#3104) — the tool complete: what each tab draws from D1176's
 * reads (`GET /api/cycles/raise/use-of-funds/plan`, `/milestones`,
 * `/hires`, `/history`) and the module read's Mercury part. Pure.
 * ------------------------------------------------------------------ */

/** The five sections, in the plan's fixed order, with the canvas's names. */
export const SECTIONS = [
  { key: 'product', label: 'Product & engineering', short: 'Product' },
  { key: 'go-to-market', label: 'GTM: sales and marketing', short: 'GTM' },
  { key: 'infrastructure', label: 'Infrastructure & data', short: 'Infrastructure' },
  { key: 'operations', label: 'Operations, legal & compliance', short: 'Operations' },
  { key: 'reserve', label: 'Hiring / runway reserve', short: 'Reserve' },
];
export const sectionOf = (key) => SECTIONS.find((s) => s.key === key) || null;

import { NOT_RECORDED } from '../../../lib/absence.js';
import { formatMinorOrCount, parseMinor } from '../../../lib/money.js';

export { NOT_RECORDED };

/** "$1,500,000" from whole cents; null when the value is missing (never $0 for missing). */
export function money(cents, currency = 'usd') {
  const code = typeof currency === 'string' ? currency.toUpperCase() : currency;
  return formatMinorOrCount(cents, code, { locale: 'en-US', trimWhole: true });
}

/** "9.4 months"; "at least 18 months" when the model never ran out inside its horizon. */
export function monthsText(value, relation = 'exact') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.round(value * 10) / 10;
  const word = `${n} ${n === 1 ? 'month' : 'months'}`;
  return relation === 'at_least' ? `at least ${word}` : word;
}

/** "1 Oct 2026" from a date or timestamp; null when not a date. */
export function dayText(at) {
  if (!at) return null;
  const s = String(at);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const SOURCE_MARK = { Connector: '⇄', Document: '▤', Recorded: '●', Signed: '✎', Typed: 'Aa', Modelled: 'ƒ' };
/** A source pill's words: "⇄ Connector · Mercury, as of 1 Oct 2026". */
export function sourceText(source, detail = '') {
  if (!source) return null;
  return `${SOURCE_MARK[source] || '●'} ${source}${detail ? ` · ${detail}` : ''}`;
}

/** The read's block, or null when it is missing or not ok. */
const ok = (block) => (block && block.state === 'ok' ? block.value : null);

/** The plan's base scenario and its model, or null. */
export const baseOf = (plan) => ok(plan?.base);
/** Whether the plan read says its Base was never made (the empty tool, UF17). */
export const planEmpty = (plan) => plan?.base?.state === 'not_initialized'
  || (!!baseOf(plan) && baseOf(plan).amount_to_raise_cents == null && !(baseOf(plan).lines || []).some((l) => l.share_pct != null));

/** Runway today's words: the chosen measured source, never the forecast (UF7). */
export function runwayTodayView(rt, viewer = {}) {
  const chosen = rt?.chosen || null;
  const mercuryHidden = rt?.sources?.mercury?.state === 'founder_only';
  if (chosen) {
    const detail = chosen.kind === 'mercury' ? 'Mercury' : 'metrics snapshot';
    const asOf = dayText(chosen.as_of);
    return {
      state: 'recorded', value: monthsText(chosen.value), source: chosen.source,
      sub: sourceText(chosen.source, `${detail}${asOf ? `, as of ${asOf}` : ''}${rt.partial ? ' · Partial' : ''}`),
      cash: money(chosen.cash_cents), burn: money(chosen.burn_cents), partial: !!rt.partial,
    };
  }
  if (rt?.state === 'unreadable') return { state: 'unreadable', value: null, sub: 'Runway today could not be read. This is not a zero.' };
  if (mercuryHidden && viewer.kind === 'admin') return { state: 'founder_only', value: 'Founder only', sub: 'Mercury figures are visible to the founder only.' };
  return { state: 'not_recorded', value: null, sub: 'Connect Mercury or record a metrics snapshot.' };
}

/** "Other runways we found": every measured candidate, and the forecast apart (UF7). */
export function runwayCandidates(rt, forecast) {
  const rows = (rt?.candidates || []).map((c) => ({
    key: c.ref,
    label: c.kind === 'mercury' ? 'Mercury' : 'Metrics snapshot',
    value: c.value == null ? null : monthsText(c.value),
    reason: c.value == null ? c.reason : null,
    source: sourceText(c.source, dayText(c.as_of) ? `as of ${dayText(c.as_of)}` : ''),
    used: !!rt.chosen && rt.chosen.ref === c.ref,
  }));
  const f = ok(forecast);
  if (f) rows.push({ key: 'forecast', label: 'Forecast', value: null, reason: 'A model you set. Never runway today.', source: sourceText('Modelled'), used: false, forecast: true });
  return rows;
}

/** The raise the plan uses: the chosen round source, with its words (UF1, UF13). */
export function raiseView(plan) {
  const round = plan?.round;
  const chosen = round?.chosen;
  const KIND = { round_call: 'round call', round_record: 'round record', plan: 'base scenario' };
  if (!chosen) return { value: null, sub: round?.reason || 'Set your raise in Edit split.' };
  return { value: money(chosen.value, chosen.currency ?? null), sub: sourceText(chosen.source, `${KIND[chosen.kind] || chosen.kind}${chosen.name ? ` ${chosen.name}` : ''}`), cents: chosen.value, currency: chosen.currency };
}

/** Runway after the raise: the model's runway, labelled Modelled, against the target (UF1, UF7). */
export function afterRaiseView(base) {
  const r = base?.model?.runway;
  if (!r || r.value == null) return { value: null, sub: r?.reason || 'Needs a raise and a split.', source: 'Modelled' };
  const target = base.target_runway_months;
  return { value: monthsText(r.value.months, r.value.relation), months: r.value.months, relation: r.value.relation, source: 'Modelled',
    sub: sourceText('Modelled', target ? `your target ${target}` : 'no target recorded') };
}

/** The Home tiles (UF1): Raise, Runway today, Runway after the raise, Committed. */
export function homeTiles(plan) {
  const base = baseOf(plan);
  const raise = raiseView(plan);
  const today = runwayTodayView(plan?.runway_today, plan?.viewer);
  const after = afterRaiseView(base);
  return [
    { key: 'raise', label: 'Raise', value: raise.value, sub: raise.sub },
    { key: 'today', label: 'Runway today', value: today.value, sub: today.sub, muted: today.state === 'founder_only' },
    { key: 'after', label: 'Runway after the raise', value: after.value, sub: after.sub },
    // No read carries a round's commitments yet, so Committed says so rather than show a figure.
    { key: 'committed', label: 'Committed', value: null, sub: 'Commitments are not read here yet.' },
  ];
}

/** One row per section: share, amount, a month over the target, its first milestone and its hires (UF1, UF2). */
export function sectionRows(base, hireItems = null) {
  const model = base?.model;
  const target = base?.target_runway_months;
  const lines = base?.lines || [];
  const milestones = base?.milestones || [];
  return SECTIONS.map((s) => {
    const line = lines.find((l) => l.category_key === s.key);
    const alloc = model?.sections?.find((x) => x.key === s.key)?.allocation?.value ?? null;
    const hires = Array.isArray(hireItems) ? hireItems.filter((h) => h.category_key === s.key) : null;
    const hireCost = hires ? hires.reduce((sum, h) => (sum === null || typeof h.annual_cents !== 'number' ? null : sum + h.annual_cents), 0) : null;
    const first = milestones.filter((m) => m.category_key === s.key).sort((a, b) => String(a.due_on || '9999').localeCompare(String(b.due_on || '9999')))[0] || null;
    return {
      ...s,
      share: typeof line?.share_pct === 'number' ? line.share_pct : null,
      amountCents: alloc,
      monthlyCents: alloc != null && target ? Math.round(alloc / target) : null,
      milestone: first ? { label: first.label, by: first.due_on || null } : null,
      milestones: milestones.filter((m) => m.category_key === s.key).length,
      hires: hires ? hires.length : null,
      hireCostCents: hireCost,
      overBudget: hireCost != null && alloc != null && hireCost > alloc,
      source: line?.source || null,
    };
  });
}

/** The split check (UF3): whole shares from 0 to 100 that add to 100. */
export function splitCheck(shares) {
  const vals = SECTIONS.map((s) => shares?.[s.key]);
  const whole = vals.every((v) => v !== '' && v != null && /^\d{1,3}$/.test(String(v)) && Number(v) <= 100);
  const total = vals.reduce((a, v) => a + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
  return { whole, total, ok: whole && total === 100 };
}

/** "1500000" or "$1,500,000" typed → whole cents; null when it is not a whole amount. */
export function centsFromTyped(text) {
  const t = String(text ?? '').replace(/[$,\s]/g, '');
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(t)) return null;
  const parsed = parseMinor(t, 'USD');
  return parsed.ok ? parsed.minor : null;
}

/** Needs you (UF1): D1176's codes in words, each with where it is fixed. */
const NEED = {
  plan_unreadable: { pill: '! Unreadable', button: null },
  plan_not_initialized: { pill: '○ No plan yet', button: { text: 'Edit split', act: 'edit' } },
  round_disagreement: { pill: '! Raise differs', button: { text: 'Choose the round size', act: 'round' } },
  runway_missing: { pill: '○ Not recorded', button: null },
  deck_out_of_sync: { pill: '! Out of sync', button: { text: 'Open the slide', act: 'deck' } },
  model_inputs_missing: { pill: '○ Not recorded', button: { text: 'Edit split', act: 'edit' } },
  milestones_not_costed: { pill: '○ Not costed', button: { text: 'Open milestones', act: 'milestones' } },
  milestones_at_risk: { pill: '! At risk', button: { text: 'Open milestones', act: 'milestones' } },
  target_shortfall: { pill: '! Short of target', button: { text: 'Open runway', act: 'runway' } },
};
export function needsRows(plan) {
  return (plan?.needs_you || []).map((n) => ({ code: n.code, text: n.reason, ...(NEED[n.code] || { pill: '!', button: null }) }));
}

/** Where this plan is used (UF1, UF13): the round, the cap table and the deck, each with its state. */
export function tiesRows(plan) {
  const rows = [];
  const round = plan?.round;
  const raise = raiseView(plan);
  if (round) {
    rows.push({ key: 'round', eyebrow: 'Round', text: raise.value ? `The plan raises ${raise.value}` : 'No round size is recorded.',
      sub: raise.value ? raise.sub : round.reason, pill: round.disagreements?.length ? '! Different raise' : raise.value ? '✓ Same raise' : null,
      tone: round.disagreements?.length ? 'amber' : 'green' });
  }
  const cap = plan?.ties?.cap_table;
  if (cap?.state === 'ok' && cap.value) {
    const r = cap.value.rounds?.find((x) => x.value != null);
    rows.push({ key: 'cap', eyebrow: 'Cap table', text: `${cap.value.name || 'Cap-table scenario'}${r ? ` raises ${money(r.value)}` : ''}`,
      sub: sourceText('Modelled'), pill: r && raise.cents != null && r.value !== raise.cents ? '! Different raise' : r ? '✓ Same raise' : null,
      tone: r && raise.cents != null && r.value !== raise.cents ? 'amber' : 'green', href: '/raise/cap-table' });
  } else if (cap?.state === 'unreadable') rows.push({ key: 'cap', eyebrow: 'Cap table', text: 'The cap table could not be read.', sub: null, pill: null });
  const deck = plan?.ties?.deck;
  if (deck?.state === 'ok' && deck.value) {
    const d = deck.value;
    rows.push({ key: 'deck', eyebrow: 'Pitch deck', text: d.version ? `v${d.version} · Ask slide` : 'No pitch deck is recorded.',
      sub: null, pill: d.state === 'synced' ? '✓ In sync' : d.state === 'out_of_sync' ? `! Out of sync${dayText(d.synced_at) ? ` since ${dayText(d.synced_at)}` : ''}` : null,
      tone: d.state === 'synced' ? 'green' : 'amber', href: d.href ? d.href.replace(/^\/raise\/pitch\?project=(\d+)$/, '/raise/pitch?project_id=$1') : null });
  } else if (deck?.state === 'unreadable') rows.push({ key: 'deck', eyebrow: 'Pitch deck', text: 'The pitch deck could not be read.', sub: null, pill: null });
  return rows;
}

/** The round's sources and which one the plan uses (UF13). */
export function roundSourceRows(plan) {
  const KIND = { round_call: 'Round call', round_record: 'Round record', plan: 'This plan', cap_table: 'Cap-table scenario' };
  return (plan?.round?.candidates || []).map((c) => ({
    key: c.ref, label: `${KIND[c.kind] || c.kind}${c.name ? ` ${c.name}` : ''}`,
    raise: c.value == null ? null : money(c.value, c.currency ?? null), reason: c.value == null ? c.reason : null,
    source: sourceText(c.source, dayText(c.as_of) ? dayText(c.as_of) : ''),
    chosen: plan.round.chosen?.ref === c.ref, eligible: c.eligible !== false, cents: c.value, currency: c.currency,
  }));
}

/** Plan vs actual (UF12): planned share against Mercury's measured share, for one window. */
export function planVsActual(base, mercury, months = 3) {
  const rows = sectionRows(base);
  const sections = Array.isArray(mercury?.sections) ? mercury.sections : null;
  const spent = sections ? sections.reduce((a, s) => a + Number(s.actual_cents?.[months] ?? 0), 0) : null;
  const unmapped = Array.isArray(mercury?.categories)
    ? mercury.categories.filter((c) => c.months === months && !c.section).reduce((a, c) => a + Number(c.spent_cents ?? 0), 0) : null;
  return {
    rows: rows.map((r) => {
      const a = sections?.find((s) => s.key === r.key)?.actual_cents?.[months];
      const actual = sections && spent > 0 && typeof a === 'number' ? Math.round((a / spent) * 100) : null;
      return { key: r.key, short: r.short, label: r.label, planned: r.share,
        actual, actualCents: typeof a === 'number' ? a : null };
    }),
    spentCents: spent, unmappedCents: unmapped, asOf: mercury?.as_of || null, months,
  };
}

/** History rows (UF15): what changed, who, when, and the Admin tag. */
const ACTION_KIND = { split: 'Split', scenario: 'Scenario', milestone: 'Milestone', hire: 'Hire', mercury: 'Mapping', forecast: 'Forecast', target: 'Target' };
export function historyRows(items = []) {
  return (Array.isArray(items) ? items : []).map((x) => {
    const a = String(x.action || '');
    const kind = Object.keys(ACTION_KIND).find((k) => a.includes(k));
    const text = String(x.summary || a.replace(/_/g, ' ')).replace(/^Studio admin: /, '').replace(/^uof /, '');
    return { id: x.id, text: text.charAt(0).toUpperCase() + text.slice(1), who: x.who || 'Name not recorded', at: dayText(x.at), kind: kind ? ACTION_KIND[kind] : 'Change', admin: !!x.admin };
  });
}

/** Two letters for an avatar, from a name. */
export const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '·';

/* ------------------------------------------------------------------ *
 * D6083 (#6083) — the section sheet (UF4, UF21c) and Add a hire (UF6),
 * inside the tool. The sheet has its own address: `?section=<key>` on
 * whichever tab opened it, beside the venture, so it opens from Home,
 * Allocation and Milestones, survives a reload and closes with Back. A
 * tab link drops it (`tabSearch` keeps the venture only).
 * ------------------------------------------------------------------ */

export const SECTION_PARAM = 'section';

/** The open section's key from a query string, or null for none or an unknown key. */
export function sheetSectionFrom(search = '') {
  const key = new URLSearchParams(String(search || '').replace(/^\?/, '')).get(SECTION_PARAM);
  return sectionOf(key) ? key : null;
}

/** The same query with the section sheet opened on `key`, or closed when `key` is null. Every other part is kept. */
export function sectionSheetSearch(search = '', key = null) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  if (key && sectionOf(key)) q.set(SECTION_PARAM, key); else q.delete(SECTION_PARAM);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * What the section sheet draws: the section's row (share, amount, a month), its
 * milestones by month, its hires by start, what the hires cost against the
 * amount, and the planned share against Mercury's measured one. `mercury` is
 * the module read's Mercury part, the founder's alone (D1174); with none the
 * actual share is null and the sheet says why.
 */
export function sectionSheet(base, key, mercury = null, months = 3) {
  const s = sectionOf(key);
  if (!s) return null;
  const hireItems = base?.hires?.state === 'ok' ? base.hires.items : null;
  const row = sectionRows(base, hireItems).find((r) => r.key === key);
  const milestones = (base?.milestones || []).filter((m) => m.category_key === key)
    .sort((a, b) => String(a.due_on || '9999').localeCompare(String(b.due_on || '9999')));
  const hires = hireItems ? hireItems.filter((h) => h.category_key === key)
    .sort((a, b) => String(a.start_month || '9999').localeCompare(String(b.start_month || '9999'))) : null;
  const actual = mercury ? planVsActual(base, mercury, months).rows.find((r) => r.key === key) : null;
  return { ...row, milestoneItems: milestones, hireItems: hires, actual: actual?.actual ?? null, asOf: mercury?.as_of || null, months };
}

/** The Add a hire body (UF6), or the sentence that says what to fix. An empty cost stays missing, never 0. */
export function hireBody({ role, section, starts, cost, currency = 'usd' }) {
  const r = String(role ?? '').trim();
  if (!r) return { error: 'Name the role.' };
  if (!sectionOf(section)) return { error: 'Choose the section it is paid from.' };
  const from = String(starts ?? '').trim();
  if (from && !/^\d{4}-(0[1-9]|1[0-2])$/.test(from)) return { error: 'A month is written like 2027-03.' };
  const cur = String(currency || 'usd').trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(cur)) return { error: 'A currency is a three-letter code.' };
  // The cost is read in the chosen currency's own minor units, never through USD's.
  const typed = String(cost ?? '').trim().replace(/[$€£,\s]/g, '');
  const parsed = typed === '' ? null : /^\d{1,13}(\.\d{1,3})?$/.test(typed) ? parseMinor(typed, cur.toUpperCase()) : { ok: false };
  if (parsed && !parsed.ok) return { error: 'Write the cost a year as a number, like 140,000.' };
  const cents = parsed ? parsed.minor : null;
  return { body: { role: r, category_key: section, start_month: from || null, annual_cents: cents, currency: cur } };
}
