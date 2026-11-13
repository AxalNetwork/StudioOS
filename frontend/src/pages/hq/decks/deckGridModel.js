/**
 * D1537 (#3786, deck v2 B10) — HQ › Decks › Grid health and Funnel, the words
 * and figures the tabs draw by. Pure, for the Node test.
 *
 * A figure the Worker returned as null reads "Not recorded" (or, for a whole
 * read that failed, "Could not be read"), never 0. Money is in dollars from
 * microdollars. Nothing here names a founder or a deck.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';

export { NOT_RECORDED };

export const UNREADABLE = 'Could not be read';
export const DAY_CHOICES = [7, 30, 90];
export const GRID_LINE = 'Each element and model over the window: how often a step fails, its p95 against the target (text 5 s, image 10 s), what it cost, and whether the catalogue still serves it. Switch a model off on AI models.';
export const FUNNEL_LINE = 'Adoption over the window, from the deck stores: counts only, never a founder or a deck.';
export const BUDGET_LINE = '99% of generation batches succeed over 28 days. HQ admins are told when one hour burns a quarter of the budget.';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** A share as a percent to one decimal, or Not recorded. */
export function pct(v) {
  return isNum(v) ? `${Math.round(v * 1000) / 10}%` : NOT_RECORDED;
}
/** Microdollars as dollars, or Not recorded. */
export function usd(micro) {
  if (!isNum(micro)) return NOT_RECORDED;
  const d = micro / 1_000_000;
  return d > 0 && d < 0.01 ? '<$0.01' : `$${d.toFixed(2)}`;
}
export function secs(v) {
  return isNum(v) ? `${v} s` : NOT_RECORDED;
}
export function hours(v) {
  if (!isNum(v)) return NOT_RECORDED;
  return v < 48 ? `${v} h` : `${Math.round((v / 24) * 10) / 10} days`;
}

/** The grid's rows, with the words each cell shows and a tone for the p95. Null when the read failed. */
export function gridRows(reply) {
  if (!reply || !Array.isArray(reply.rows)) return null;
  return reply.rows.map((r) => ({
    key: `${r.element}|${r.kind}|${r.model ?? ''}`,
    element: r.element, kind: r.kind, model: r.model_label,
    steps: r.steps,
    errorRate: pct(r.error_rate),
    p95: secs(r.p95_seconds),
    p95Tone: r.p95_over_target === true ? 'over' : r.p95_over_target === false ? 'ok' : 'none',
    target: secs(r.p95_target_seconds),
    cost: usd(r.cost_microusd),
    fallbacks: r.fallbacks,
    drift: r.drift ? 'No longer in the catalogue' : null,
    evalScore: isNum(r.eval_score) ? String(r.eval_score) : NOT_RECORDED,
  }));
}

/** The budget card: success, what is used, the last hour, and whether it is alerting. Null when unreadable. */
export function budgetCard(b) {
  if (!b) return null;
  if (!b.finished) return { empty: true, line: 'No batch finished in the last 28 days.' };
  return {
    empty: false,
    success: pct(b.success_rate),
    used: pct(b.used_fraction),
    lastHour: `${b.last_hour_failed} failed · ${pct(b.last_hour_fraction)} of the budget`,
    budget: `${b.budget_failures} failed batches of ${b.finished}`,
    alerting: !!b.alerting,
  };
}

/** The KPI tiles, each with its figure and the counts behind it. A KPI the Worker could not read says so. */
export function kpiTiles(k) {
  if (!k) return null;
  const g = k.generations; const s = k.first_share; const r = k.retention_4w;
  return [
    { key: 'generations', label: 'Decks with 3+ area generations', value: g ? pct(g.rate) : UNREADABLE, sub: g ? `${g.decks_three_plus} of ${g.decks_generating} decks that generated` : null },
    { key: 'first_share', label: 'First deck to first share (median)', value: s ? hours(s.median_hours) : UNREADABLE, sub: s ? `${s.ventures} ventures shared` : null },
    { key: 'retention', label: '4-week retention', value: r ? pct(r.rate) : UNREADABLE, sub: r ? `${r.retained} of ${r.cohort} ventures that started 4 to 8 weeks ago` : null },
  ];
}

export function quoteBands(k) {
  if (!k || !Array.isArray(k.quote_conversion)) return null;
  return k.quote_conversion.map((b) => ({ label: b.label, shown: b.shown, confirmed: b.confirmed, conversion: pct(b.conversion) }));
}

export function acceptRows(k) {
  if (!k || !Array.isArray(k.accept_rates)) return null;
  return k.accept_rates.map((a) => ({
    key: `${a.element}|${a.model ?? ''}`, element: a.element, model: a.model_label || a.model || 'No model · free',
    proposals: a.proposals, decided: a.decided, rate: pct(a.accept_rate),
  }));
}

/** The ceiling line from D1510's read: "Not set" until the owner sets one. */
export function ceilingLine(gen) {
  const c = gen?.ceiling;
  if (!c) return NOT_RECORDED;
  if (c.ceiling_microusd == null) return 'Not set';
  return `${usd(c.spent_today_microusd)} of ${usd(c.ceiling_microusd)} today${c.percent != null ? ` (${c.percent}%)` : ''}${c.paused ? ' · paused' : ''}`;
}
