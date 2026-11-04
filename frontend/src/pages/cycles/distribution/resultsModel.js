/** D4491 — Results presentation preserves measured zero and missing figure reasons. */
export function figure(value, reason) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? { value, reason: null } : { value: null, reason: !reason ? 'Not recorded: this figure was not returned' : /^(Not recorded|Unreadable)/.test(reason) ? reason : `Not recorded: ${reason}` };
}
export function funnelWidth(value, leads) {
  const n = figure(value).value, total = figure(leads).value;
  return n === null || total === null ? null : total === 0 ? 0 : Math.max(0, Math.min(100, n / total * 100));
}
export function costPerLead(spendCents, leads) {
  const spend = figure(spendCents).value, count = figure(leads).value;
  return spend === null || count === null || count === 0 ? null : Math.round(spend / count) / 100;
}
export function money(cents) {
  const value = figure(cents).value;
  return value === null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
}
export const REVENUE_NOTE = 'Revenue stays on Revenue and traction. Nothing here changes MRR.';
export const REVENUE_PATH = '/grow/revenue-and-traction';
