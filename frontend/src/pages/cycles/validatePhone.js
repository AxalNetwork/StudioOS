// D685 §5.12 (#1589) — Validate's phone focus, below md: the one next thing,
// the interviews meter, and "Everything else in Validate", to
// `Cycle Overview.dc.html` (`mobData`).
//
// THE WORKER'S FIRST. `GET /cycles/validate/overview` returns `focus`, `meter`
// and `index` (§5.12, #1609) beside its figures and cards; each is null when
// its part could not be read, and then this falls back to what the figures
// and cards say:
//   · rule 1 (no interview) is the Customer research card read empty;
//   · rule 2 ("Review the interview with …") is the Worker's alone: the
//     overview's cards carry no session, so it is never guessed here;
//   · rule 3 is the first card's `next`;
//   · the meter's count is the figure's, and its target "No target set".
// Every fallback reads the RAW overview: adapting a card replaces its series
// with chart specs. A missing value reads "Not recorded", never 0.

import { usdShort } from './adapters/validate.js';

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

/** The focus card: the Worker's when it sends one, else rule 1, else the first card's next. */
export function phoneFocus(raw, search = '') {
  const f = raw?.focus;
  if (f && typeof f === 'object' && f.headline && f.cta?.href) {
    return { eyebrow: f.eyebrow || 'Validate · Next', headline: f.headline, why: f.why || null, cta: f.cta.text || f.cta.label || 'Open', href: f.cta.href, then: f.then || null };
  }
  const research = card(raw, 'customer-research');
  if (research?.state === 'empty') return { ...FIRST_FOCUS, href: `/validate/record${search}` };
  const first = (Array.isArray(raw?.cards) ? raw.cards : []).find((c) => c?.next?.text && typeof c.next.href === 'string' && /^\/(?!\/)/.test(c.next.href));
  if (!first) return null;
  return { eyebrow: 'Validate · Next', headline: sentence(first.next.text), why: first.reason || null, cta: `Open ${first.name || 'the module'}`, href: first.next.href, then: null };
}

/** The meter: interviews held this month against a stored target; none stored reads "No target set". */
export function phoneMeter(raw) {
  const fig = figure(raw, 'interviews_this_month');
  // The Worker's count first: it reads none logged as 0, a fact it counted.
  const count = num(raw?.meter?.count) ? raw.meter.count : num(fig?.value) ? fig.value : null;
  const target = num(raw?.meter?.target) && raw.meter.target > 0 ? raw.meter.target : null;
  return {
    label: 'Interviews this month',
    count,
    target,
    pct: count != null && target != null ? Math.max(0, Math.min(100, Math.round((100 * count) / target))) : null,
    unreadable: count == null && fig?.state === 'unreadable',
  };
}

/** "Everything else in Validate": the canvas's six rows, each from what the overview returns. */
export function phoneIndex(raw, search = '') {
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
