/**
 * D6278 (#6278) — what the benchmark page says about where "Ours" came from,
 * and what the "Use our figure from…" control offers. Pure, so Node tests read
 * the same sentences the page renders.
 */

export const FUND_METRICS = [
  { key: 'tvpi', label: 'TVPI' },
  { key: 'dpi', label: 'DPI' },
];
const LABEL = Object.fromEntries(FUND_METRICS.map((m) => [m.key, m.label]));

/**
 * The line under "Ours". A typed figure reads "As entered on this row"; a
 * copied one names the fund, the metric and the date it was recorded as of,
 * or says the fund is no longer one the reader can open. No figure, no line.
 */
export function oursProvenance(item) {
  if (!item?.our_value) return null;
  const from = item.our_from;
  if (!from) return 'As entered on this row';
  const metric = LABEL[from.metric] || String(from.metric || '').toUpperCase();
  const fund = from.fund_name || 'a fund you can no longer open';
  return `Recorded ${metric} from ${fund}${from.as_of ? ` as of ${from.as_of}` : ''}`;
}

/** A typed figure is replaced only after the writer confirms (owner answer, 2026-11-15). */
export function typedOurs(item) {
  return Boolean(item?.our_value) && !item?.our_from;
}

/**
 * The figure the control would write for one fund and metric:
 * `{ recorded: true, display, as_of }` or `{ recorded: false, text: 'Not recorded: …' }`.
 */
export function fundChoice(figures, fundId, metric) {
  const fund = (figures || []).find((f) => String(f.fund_id) === String(fundId));
  if (!fund) return null;
  const fig = fund[metric];
  if (!fig || fig.display == null) {
    return { recorded: false, fund, text: `Not recorded: ${fig?.reason || 'This figure is not recorded for this fund.'}` };
  }
  return { recorded: true, fund, display: fig.display, as_of: fund.as_of };
}
