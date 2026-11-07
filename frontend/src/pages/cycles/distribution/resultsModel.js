/** D4491 (#4491) — Results presentation: missing-value reasons, money, cost per lead, funnel widths and the window label. */
export const REVENUE_NOTE = 'Revenue stays on Revenue and traction. Nothing here changes MRR.';
export const REVENUE_PATH = '/grow/revenue-and-traction';
export const REVENUE_LINK = 'Open Revenue and traction ›';
export const RESULTS_READ_ERROR = 'Couldn’t be read. This is not a claim that there are none.';
export const WINDOW_INVALID = 'Choose a from date on or before the to date.';

const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
/** A figure is a recorded number or a named reason; a missing number never becomes 0 or a dash. */
export function figure(value, reason) {
  if (isCount(value)) return { value, reason: null };
  const text = typeof reason === 'string' ? reason.trim() : '';
  return { value: null, reason: !text ? 'Not recorded' : /^(Not recorded|Unreadable)/.test(text) ? text : `Not recorded: ${text}` };
}
/** Spend: whole dollars when the cents are round ($620), otherwise to the cent. */
export function money(cents) {
  if (!isCount(cents)) return null;
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(cents / 100);
}
/** Cost per lead always shows cents ($34.44), rounded half up from whole cents. */
export function costMoney(cents) {
  if (!isCount(cents)) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.round(cents) / 100);
}
/** Cents per lead, or null when either side is missing or there are no leads to divide by. */
export function costPerLead(spendCents, leads) {
  return !isCount(spendCents) || !isCount(leads) || leads === 0 ? null : Math.round(spendCents / leads);
}
/** Funnel bar width as a percent of the campaign's leads; null when either figure is missing. */
export function funnelWidth(value, leads) {
  if (!isCount(value) || !isCount(leads)) return null;
  return leads === 0 ? 0 : Math.max(0, Math.min(100, (value / leads) * 100));
}
/** Source chips: mercury/manual come from spend, attributed means UTM-tagged contacts. */
export const SOURCE_LABELS = Object.freeze({ mercury: 'Mercury', manual: 'Manual', attributed: 'UTM attribution' });
export const sourceList = (sources) => (Array.isArray(sources) ? sources.filter((s) => Object.hasOwn(SOURCE_LABELS, s)) : []);
/** The figures' scope: a labelled window, or the lifetime/campaign-window figures when none was given. */
export function windowLabel(data) {
  const w = data?.window;
  if (w?.from && w?.to) return `Window: ${w.from} to ${w.to}. Contacts created in these days; spend in these months.`;
  return 'No window chosen: lifetime figures. Every tagged contact counts; spend covers each campaign’s own months.';
}
/** Local check before reading; the server refuses the same cases with its own sentence. */
export function windowError(from, to) {
  if (!from && !to) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from || '') || !day.test(to || '') || from > to) return WINDOW_INVALID;
  return null;
}
export const FUNNEL_STEPS = Object.freeze([['leads', 'Leads'], ['demos', 'Demos'], ['customers', 'Customers']]);
