// D703 (#1665) — each cycle's phone root (One Next Thing), for Validate,
// Build, Raise and Grow, to `Cycle Overviews · Mobile.dc.html` (COM) over
// `Cycle Overview.dc.html` (CO:26-27, CO:278-282). It began as D685 §5.12's
// Validate-only focus (#1589).
//
// THE WORKER'S FIRST. Each cycle's overview read returns `focus`, `meter` and
// `index` (#1701's decision 1; Validate's since #1609) beside its figures and
// cards. A part is null when the Worker could not read it, and only then does
// this fall back, to what the same read's figures and cards say:
//   · the focus: Validate's rule 1 (the Customer research card read empty),
//     else the first card's `next`, under "<Cycle> · Next";
//   · the meter: Validate's alone, the interviews figure's count with "No
//     target set"; any other cycle with no `display` reads Not recorded;
//   · the index: one row per card in the read, each "Unreadable", linking its
//     module page. A module the Worker hides stays hidden: the browser never
//     adds a row.
// Until #1701's PR 1b, Validate's read sends `index` as an object
// ({ interviews_total, booked }); Validate then keeps its client-built rows.
// Every fallback reads the RAW overview: adapting a card replaces its series
// with chart specs. A missing value reads "Not recorded", never 0, and the
// browser never formats money.

import { usdShort } from './adapters/validate.js';
import { safeHref } from './cycleModel.js';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const sentence = (t) => { const s = String(t || '').trim(); return !s ? '' : /[.!?]$/.test(s) ? s : `${s}.`; };

/** The canvas's words for a venture with no interview yet (`mobData.focus.new`). */
export const FIRST_FOCUS = {
  eyebrow: 'Validate · Next',
  headline: 'Record your first conversation.',
  why: 'Validate starts with one interview. Everything else in the venture builds on what it finds.',
  cta: 'Record a session',
  then: 'Write the claim you most need to be true.',
};

const figure = (raw, key) => (Array.isArray(raw?.figures) ? raw.figures : []).find((f) => f?.key === key) || null;
const card = (raw, slug) => (Array.isArray(raw?.cards) ? raw.cards : []).find((c) => c?.slug === slug) || null;

export const CYCLE_NAMES = { validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow' };
const nameOf = (cycle) => CYCLE_NAMES[cycle] || 'Validate';

/**
 * The cycle's own action route a root CTA may name (decision 2): opened
 * through `openAction` on a plain tap, so Back from it is one step. Grow's
 * root never opens Share an update (S1's ruling), so Grow has none here.
 */
export const ROOT_ACTION_PATHS = { validate: 'record', build: 'connect', raise: 'call' };

/** The focus: the Worker's when it has a headline and an in-app CTA, else rule 1 (Validate), else the first card's next. */
export function phoneFocus(raw, search = '', cycle = 'validate') {
  const f = raw?.focus;
  const href = safeHref(f?.cta?.href);
  if (f && typeof f === 'object' && f.headline && href) {
    return { eyebrow: f.eyebrow || `${nameOf(cycle)} · Next`, headline: f.headline, why: f.why || null, cta: f.cta.text || f.cta.label || 'Open', href, then: f.then || null };
  }
  if (cycle === 'validate') {
    const research = card(raw, 'customer-research');
    if (research?.state === 'empty') return { ...FIRST_FOCUS, href: `/validate/record${search}` };
  }
  const first = (Array.isArray(raw?.cards) ? raw.cards : []).find((c) => c?.next?.text && safeHref(c.next.href));
  if (!first) return null;
  return { eyebrow: `${nameOf(cycle)} · Next`, headline: sentence(first.next.text), why: first.reason || null, cta: `Open ${first.name || 'the module'}`, href: first.next.href, then: null };
}

/** "Then" once (decision 3): a leading "Then " is stripped and the first letter upper-cased. */
export function thenText(text) {
  const t = String(text ?? '').trim().replace(/^then\s*:?\s+/i, '');
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : null;
}

/**
 * The meter, drawn as the Worker sends it: its `label` and `display` ("14 of
 * 20", "$900k of $1.5M"), then "· <target_reason>" with no target, and a bar
 * at count / target when both are numbers and the target is above zero.
 * Validate alone falls back: the interviews figure's count, "<count> of
 * <target>" or "<count>", and "No target set". Another cycle with no meter
 * draws none (null); one with no `display` reads Not recorded.
 */
export function phoneMeter(raw, cycle = 'validate') {
  const m = raw?.meter && typeof raw.meter === 'object' ? raw.meter : null;
  const target = num(m?.target) && m.target > 0 ? m.target : null;
  if (cycle !== 'validate') {
    if (!m) return null;
    const count = num(m.count) ? m.count : null;
    return {
      label: m.label || 'Not recorded',
      count,
      target,
      pct: count != null && target != null ? Math.max(0, Math.min(100, Math.round((100 * count) / target))) : null,
      unreadable: false,
      display: typeof m.display === 'string' && m.display ? m.display : null,
      target_reason: target == null && m.target_reason ? m.target_reason : null,
    };
  }
  const fig = figure(raw, 'interviews_this_month');
  // The Worker's count first: it reads none logged as 0, a fact it counted.
  const count = num(m?.count) ? m.count : num(fig?.value) ? fig.value : null;
  const display = typeof m?.display === 'string' && m.display ? m.display
    : count == null ? null : target != null ? `${count} of ${target}` : `${count}`;
  return {
    label: m?.label || 'Interviews this month',
    count,
    target,
    pct: count != null && target != null ? Math.max(0, Math.min(100, Math.round((100 * count) / target))) : null,
    unreadable: count == null && fig?.state === 'unreadable',
    display,
    target_reason: target == null ? (m?.target_reason || 'No target set') : null,
  };
}

/**
 * "Everything else in <Cycle>": the Worker's rows as sent, each href in-app
 * only. `value: null` draws Not recorded, `''` nothing, any other string
 * (`"Unreadable"` included) is the value. A null index falls back to one
 * "Unreadable" row per card in the read.
 */
export function phoneIndex(raw, search = '', cycle = 'validate') {
  const index = raw?.index;
  if (Array.isArray(index)) {
    return index.filter((r) => r && r.key && r.title).map((r) => ({
      key: String(r.key), title: String(r.title), detail: r.detail == null ? '' : String(r.detail),
      value: r.value == null ? null : String(r.value), href: safeHref(r.href),
    }));
  }
  if (cycle === 'validate' && index !== null && (index === undefined || typeof index === 'object')) return validateRows(raw, search);
  return (Array.isArray(raw?.cards) ? raw.cards : []).filter((c) => c?.slug && /^[a-z0-9-]+$/.test(c.slug)).map((c) => ({
    key: c.slug, title: c.name || c.slug, detail: c.caption || '', value: 'Unreadable', href: `/${cycle}/${c.slug}${search}`,
  }));
}

/**
 * Validate's client-built rows, kept only while its read sends `index` as
 * the `{ interviews_total, booked }` object (S1's ruling). #1701's PR 1b
 * deletes this with `ValidatePhoneFocus.jsx`.
 */
function validateRows(raw, search = '') {
  const at = (slug) => `/validate/${slug}${search}`;
  const themes = figure(raw, 'pain_themes');
  const supported = figure(raw, 'hypotheses_supported');
  const research = card(raw, 'customer-research');
  const icp = card(raw, 'ideal-customer-profile');
  const market = card(raw, 'market-intelligence');
  const demand = card(raw, 'demand-signals');
  const funnel = research?.series?.funnel;
  const booked = num(raw?.index?.booked) ? raw.index.booked
    : num(funnel?.booked) && num(funnel?.done) ? Math.max(0, funnel.booked - funnel.done) : null;
  const segments = Array.isArray(icp?.series?.segments) ? icp.series.segments.length : null;
  const sam = market?.series?.sam?.value;
  const bar = demand?.series?.bar;
  return [
    { key: 'problem-discovery', title: 'Problem discovery',
      detail: num(themes?.value) ? `${plural(themes.value, 'pain theme', 'pain themes')}${num(themes.delta_30d) && themes.delta_30d > 0 ? ` · ${themes.delta_30d} new` : ''}` : 'Pain themes',
      value: num(themes?.value) ? '' : null, href: at('problem-discovery') },
    { key: 'customer-research', title: 'Customer research', detail: booked != null ? `Recruiting · ${booked} booked` : 'Recruiting', value: booked != null ? '' : null, href: at('customer-research') },
    { key: 'ideal-customer-profile', title: 'Ideal customer profile', detail: segments != null ? plural(segments, 'segment', 'segments') : 'Segments', value: segments != null ? '' : null, href: at('ideal-customer-profile') },
    { key: 'market-intelligence', title: 'Market intelligence', detail: 'Total, serviceable, obtainable', value: num(sam) ? usdShort(sam) : null, href: at('market-intelligence') },
    { key: 'demand-signals', title: 'Demand and urgency signals', detail: num(bar) ? `Waitlist against the bar of ${bar}` : 'Waitlist against the bar', value: num(bar) ? '' : null, href: at('demand-signals') },
    { key: 'experiments', title: 'Experiments and evidence', detail: 'Hypotheses supported',
      value: num(supported?.value) ? `${supported.value}${supported.unit && /^of \d+$/.test(supported.unit) ? ` ${supported.unit}` : ''}` : null, href: at('experiments') },
  ];
}

/** The target form's value as the Worker takes it: a positive whole number, null to clear, or a sentence. */
export function targetValue(text) {
  const t = String(text ?? '').trim();
  if (!t) return { value: null };
  const n = Number(t);
  if (!Number.isInteger(n) || n <= 0) return { error: 'Enter a whole number of interviews a month, above zero.' };
  return { value: n };
}
