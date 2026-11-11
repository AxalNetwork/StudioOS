/** D4485 (#4485): pure Distribution labels and calendar columns; missing figures never become zero. */
export const KPI_LABELS = Object.freeze({ reach: 'Reach', clicks: 'Clicks', leads: 'Leads', replies: 'Replies', cost_per_lead: 'Cost per lead', spend_vs_budget: 'Spend vs budget' });
export const UNREADABLE_NOTE = 'Couldn’t be read. This is not a claim that there are none.';
const SOURCE_LABELS = { mercury: 'Mercury', manual: 'Manual', connector: 'Connector' };
const number = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n);
const known = (n) => typeof n === 'number' && Number.isFinite(n);
export function sourceChips(sources) {
  return [...new Set(Array.isArray(sources) ? sources : [])].filter((source) => Object.hasOwn(SOURCE_LABELS, source)).map((source) => ({ source, label: SOURCE_LABELS[source] }));
}
export function metricView(key, metric) {
  if (metric?.reason?.startsWith('Unreadable:')) return { label: 'Unreadable', state: 'unreadable', reason: UNREADABLE_NOTE, chips: [] };
  const value = metric?.value;
  const chips = sourceChips(metric?.sources);
  if (value == null || !chips.length) return { label: 'Not recorded', state: 'not_recorded', reason: metric?.reason || 'Not recorded: no value and source are recorded', chips: [] };
  if (!known(value)) return { label: 'Unreadable', state: 'unreadable', reason: UNREADABLE_NOTE, chips: [] };
  const monetary = key === 'cost_per_lead' || key === 'spend_vs_budget';
  const label = monetary ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: key === 'cost_per_lead' ? 2 : 0, maximumFractionDigits: 2 }).format(value / 100) : number(value);
  return { label, state: 'recorded', reason: null, chips };
}
export function resultsLine(campaign) {
  const fields = campaign?.goal === 'signups' ? [['leads', 'sign-ups']] : campaign?.goal === 'sales' ? [['customers', 'customers']] : campaign?.goal === 'demos' ? [['leads', 'leads'], ['demos', 'demos']] : [];
  if (!fields.length || fields.every(([key]) => !known(campaign?.[key]))) return 'Not recorded';
  return fields.map(([key, label]) => known(campaign?.[key]) ? `${number(campaign[key])} ${label}` : `${label}: Not recorded`).join(' · ');
}
export function budgetView(campaign) {
  if (campaign?.budget_cents == null) return { label: 'Budget — Not recorded', percent: null, progress: null };
  if (campaign.budget_cents === 0) return { label: 'Budget — No paid budget · outreach only', percent: null, progress: null };
  const pct = campaign.budget_used_pct;
  if (!known(pct)) return { label: 'Budget used — Not recorded', percent: null, progress: null };
  return { label: 'Budget used', percent: `${number(pct)}%`, progress: Math.max(0, Math.min(100, pct)) };
}
/** Calendar-day identity follows the viewer's real local date; plans remain nominal YYYY-MM-DD days. */
export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function weekColumns(week, today = todayKey()) {
  if (!Array.isArray(week?.items) || !/^\d{4}-\d{2}-\d{2}$/.test(week?.from ?? '')) return { state: 'unreadable', reason: UNREADABLE_NOTE, days: [] };
  const start = new Date(`${week.from}T00:00:00Z`);
  if (Number.isNaN(start.valueOf()) || start.toISOString().slice(0, 10) !== week.from) return { state: 'unreadable', reason: UNREADABLE_NOTE, days: [] };
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name, i) => {
    const date = new Date(start.valueOf() + i * 86400_000).toISOString().slice(0, 10);
    const items = week.items.filter((item) => item.planned_on === date);
    return { date, name, today: date === today, heading: `${name}${date === today ? ' · today' : ''}`, items, empty: items.length ? null : 'Nothing scheduled' };
  });
  return { state: 'ready', reason: null, days };
}
