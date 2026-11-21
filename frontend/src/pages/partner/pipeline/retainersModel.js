// D4838 PP06 / PP06m (#5939): the pure rules the Retainers zone draws from, so the page and its tests agree.
//
// Exceptions first. The attention band's three items and the ledger they filter are ONE set each, taken with
// `commandCentre.js`'s own predicates (`isOverServiced`, `isRenewingSoon`, `isLowUse`, `retainerActive`) and its
// `LOW_USE_PCT` and `RENEWAL_WINDOW_DAYS`. Nothing here restates a threshold, so the Pipeline root and this zone
// cannot disagree about which retainer is low use.
//
//   attentionSets(items)  the three exception lists, each a list of rows.
//   retainerRows(items)   the ledger's population with no band item pressed: every row with a retainer.
//   utilisationRead(row)  utilization in words, with a shape, never colour alone; null when not recorded.
//   healthOf(row)         the Health column's word and tone.
//   monthlyEquivalent(row)  the Worker's monthly figure (quarterly ÷ 3) and how it was reached.
//   retainerStrip(d, items)  the four KPI tiles.
//   sheetTabs(row)        the sheet's tabs, only those with something recorded behind them.
import {
  LOW_USE_PCT, RENEWAL_WINDOW_DAYS, isLowUse, isOverServiced, isRenewingSoon, retainerActive, retainerUtilPct,
} from './commandCentre.js';
import { usdCents } from '../../../workspaces/boards/format.js';

export { LOW_USE_PCT, RENEWAL_WINDOW_DAYS };

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The band's keys are the toolbar chip keys (`partnerZoneFilters('pipeline/retainers')`), so both drive one view. */
export const BAND = [
  { key: 'over', icon: '▲', label: (n) => `${n} over-serviced`, rule: isOverServiced },
  { key: 'renewing', icon: '◷', label: (n) => `${n} renew${n === 1 ? 's' : ''} within ${RENEWAL_WINDOW_DAYS} days`, rule: isRenewingSoon },
  { key: 'under', icon: '▼', label: (n) => `${n} under ${LOW_USE_PCT}% utilization`, rule: isLowUse },
];

/** Rows that carry a retainer record, ended or not: the ledger's population. */
export const retainerRows = (items) => (items || []).filter((r) => r && r.retainer);

/** The three exception lists, each taken with the command centre's own predicate. */
export function attentionSets(items) {
  const rows = items || [];
  return Object.fromEntries(BAND.map((b) => [b.key, rows.filter(b.rule)]));
}

/**
 * Utilization in words. `{ pct, key, word, icon }`, or null when none is recorded (the Worker's
 * `utilisation_note` says which of the two nulls it is). The icon is a shape, so the reading survives
 * without colour.
 */
export function utilisationRead(r) {
  const pct = retainerUtilPct(r);
  if (pct === null) return null;
  if (pct > 100) return { pct, key: 'over', word: 'over scope', icon: '▲' };
  if (pct < LOW_USE_PCT) return { pct, key: 'low', word: 'low use', icon: '▼' };
  return { pct, key: 'healthy', word: 'healthy', icon: '●' };
}

/**
 * The Health column. Exceptions use the band's own predicates, most pressing first; an active retainer with
 * none of them reads Healthy only when its utilization is recorded, and "No exception" otherwise, because a
 * period nobody has logged is not a healthy one.
 */
export function healthOf(r) {
  if (!r?.retainer) return { key: 'none', word: 'Not a retainer', tone: 'neutral', icon: '○' };
  if (!retainerActive(r)) return { key: 'ended', word: 'Ended', tone: 'neutral', icon: '○' };
  if (isOverServiced(r)) return { key: 'over', word: 'Over scope', tone: 'danger', icon: '▲' };
  if (isRenewingSoon(r)) {
    const due = num(r.retainer.days_to_renewal);
    return { key: 'renewing', word: due === 0 ? 'Renews today' : `Renews in ${due} d`, tone: 'warn', icon: '◷' };
  }
  if (isLowUse(r)) return { key: 'under', word: 'Low use', tone: 'warn', icon: '▼' };
  if (retainerUtilPct(r) === null) return { key: 'unmeasured', word: 'No exception', tone: 'neutral', icon: '○' };
  return { key: 'healthy', word: 'Healthy', tone: 'ok', icon: '●' };
}

/**
 * The monthly equivalent: the Worker's `monthly_amount_cents` (quarterly ÷ 3, D4693), null for an ended
 * retainer or one with no amount. `basis` says how it was reached when it is not the recorded amount itself,
 * so a quarterly figure is never shown as if it were monthly.
 */
export function monthlyEquivalent(r) {
  const t = r?.retainer;
  if (!t) return { cents: null, basis: null, why: 'not a retainer' };
  if (!retainerActive(r)) return { cents: null, basis: null, why: 'ended' };
  const cents = num(t.monthly_amount_cents);
  if (cents === null) return { cents: null, basis: null, why: num(t.amount_cents) === null ? 'no amount recorded' : 'cadence not recorded' };
  const basis = t.cadence === 'quarterly' && num(t.amount_cents) !== null
    ? `${usdCents(num(t.amount_cents))} a quarter ÷ 3`
    : null;
  return { cents, basis, why: null };
}

/** Scope: retained hours per period, or the deal's shape when it is not sold by the hour. */
export function scopeText(r) {
  const t = r?.retainer;
  if (!t) return null;
  const per = t.cadence === 'quarterly' ? 'quarter' : t.cadence === 'monthly' ? 'month' : null;
  const hours = num(r.retained_hours ?? t.retained_hours);
  if (hours !== null) return per ? `${hours} h / ${per}` : `${hours} h`;
  return t.shape === 'embedded_seat' ? 'Embedded seat · not by the hour' : 'Not sold by the hour';
}

/** One KPI tile: `{ label, state: 'value' | 'none' | 'unrecorded', value, note }`. */
const tile = (label, state, value, note) => ({ label, state, value, note });

/**
 * The strip: Current recurring revenue · Active retainers · Renewal value next 30d · Utilization risk.
 * Recurring revenue and the active count are the Worker's whole-book figures; the other two are taken over the
 * rows read with the band's predicates, so the tile and its band items count the same rows.
 */
export function retainerStrip(d, items) {
  const sets = attentionSets(items);
  const active = num(d?.active_count) ?? (items || []).filter(retainerActive).length;
  const ended = num(d?.ended_count);

  const mrr = num(d?.mrr_cents);
  const revenue = mrr === null
    ? tile('Current recurring revenue', 'unrecorded', null, d?.mrr_note || 'no active retainer has an amount recorded')
    : tile('Current recurring revenue', 'value', `${usdCents(mrr)}`, ['per month · quarterly ÷ 3', d?.mrr_note].filter(Boolean).join(' · '));

  // BY SHAPE, because an embedded seat is recurring revenue and is not a retainer: the Worker's whole-book
  // `shape_counts`, never a count of whichever rows a band item left visible.
  const c = d?.shape_counts || {};
  const shapes = [
    num(c.retainer) ? plural(num(c.retainer), 'retainer') : null,
    num(c.embedded_seat) ? plural(num(c.embedded_seat), 'embedded seat') : null,
  ];
  const activeTile = tile('Active retainers', 'value', String(active),
    ['Not ended', ...shapes, ended ? `${ended} ended not counted` : null].filter(Boolean).join(' · '));

  const renewing = sets.renewing;
  let renewal;
  if (!renewing.length) {
    renewal = tile(`Renewal value next ${RENEWAL_WINDOW_DAYS}d`, 'none', `None in ${RENEWAL_WINDOW_DAYS} days`,
      'no active retainer has a recorded renewal inside the window');
  } else {
    const priced = renewing.filter((r) => num(r.retainer.current_monthly_cents) !== null);
    const sum = priced.reduce((a, r) => a + num(r.retainer.current_monthly_cents), 0);
    const unpriced = renewing.length - priced.length;
    renewal = priced.length
      ? tile(`Renewal value next ${RENEWAL_WINDOW_DAYS}d`, 'value', `${usdCents(sum)} / mo`,
        [plural(renewing.length, 'retainer'), unpriced ? `${unpriced} with no amount not in it` : null].filter(Boolean).join(' · '))
      : tile(`Renewal value next ${RENEWAL_WINDOW_DAYS}d`, 'unrecorded', null,
        `${plural(renewing.length, 'retainer')} renewing, none with an amount recorded`);
  }

  const measured = (items || []).filter((r) => retainerActive(r) && retainerUtilPct(r) !== null).length;
  const risk = measured
    ? tile('Utilization risk', 'value', String(sets.over.length + sets.under.length),
      `${sets.over.length} over 100% · ${sets.under.length} under ${LOW_USE_PCT}%`)
    : tile('Utilization risk', 'unrecorded', null,
      active ? 'no active retainer has hours logged this period' : 'no active retainer');

  return [revenue, activeTile, renewal, risk];
}

export const TAB_LABEL = { summary: 'Summary', usage: 'Usage', terms: 'Terms', history: 'History' };

/**
 * The sheet's tabs, only where something is recorded behind them. Summary is always there. Terms holds the
 * retainer's recorded terms, or the form that records the first one. Usage is there once a retainer is
 * recorded (hours are logged against one, never against a bare engagement). History is there only when a
 * period has been logged or the retainer has ended: no change log of the terms is kept.
 */
export function sheetTabs(r) {
  if (!r) return [];
  const tabs = ['summary'];
  if (r.retainer) tabs.push('usage');
  tabs.push('terms');
  if ((r.usage || []).length || r.retainer?.ended_at) tabs.push('history');
  return tabs;
}
