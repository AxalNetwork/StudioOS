/** #4862: approved GR-04 labels over existing paths; no module slug or deep link is retired. */
import { projectSearch } from './founderToolNavigation.js';

export const GROW_AREAS = Object.freeze([
  { key: '', name: 'Overview', path: '/grow', aliases: [] },
  { key: 'focus', name: 'Focus', path: '/grow/focus', aliases: ['revenue-and-traction'] },
  { key: 'customers', name: 'Customers', path: '/grow/customers', aliases: ['product-improvement'] },
  { key: 'distribution', name: 'Distribution', path: '/grow/distribution', aliases: ['launch'] },
  { key: 'talent', name: 'Talent', path: '/grow/talent', aliases: ['team-expansion'] },
  { key: 'partnerships', name: 'Partnerships', path: '/grow/partnerships', aliases: ['partner-network'] },
  { key: 'markets', name: 'Markets', path: '/grow/market-expansion', aliases: ['market-expansion'] },
  { key: 'company', name: 'Company', path: '/grow/durable-company-building', aliases: ['durable-company-building', 'brand'] },
]);
/**
 * #6109: the two module pages that share a tab with a desk say which half of
 * the pair they are. The tab still lights Talent or Partnerships (D4862); the
 * heading no longer claims to be that desk.
 */
export const GROW_MODULE_TITLES = Object.freeze({
  'team-expansion': 'Talent · Roles',
  'partner-network': 'Partnerships · Partners',
});
export const growArea = (key = '') => GROW_AREAS.find((a) => a.key === key || a.aliases.includes(key)) || null;
/** A Grow module page's heading: its own title where it has one, else its area's name. */
export const growModuleTitle = (slug = '') => GROW_MODULE_TITLES[slug] || growArea(slug)?.name || null;
export const growTabs = (search = '', active = '') => GROW_AREAS.map((a) => ({ key: a.key, name: a.name, href: a.path + projectSearch(search), active: a === growArea(active || '') }));
const GROW_SUBSECTIONS = [
  [{ key: 'focus', name: 'Focus' }, { key: 'revenue-and-traction', name: 'KPIs and revenue' }],
  [{ key: 'customers', name: 'Customers' }, { key: 'product-improvement', name: 'Feedback' }],
];

export function growSubsections(search, active) {
  const group = GROW_SUBSECTIONS.find(items => items.some(item => item.key === active));
  return (group || []).map(item => ({ ...item, href: '/grow/' + item.key + projectSearch(search), active: item.key === active }));
}
export const reportingHref = (search = '') => '/grow/reporting' + projectSearch(search);

/** No action survives a loading, refused, unreadable or stale in-flight overview. */
export function growPrimary(attention, status, readOnly = false) {
  if (status !== 'ready' || readOnly || attention?.writable !== true) return null;
  const action = attention.primary;
  return action && typeof action.href === 'string' && /^\/grow\/[a-z-]+\?project_id=[1-9]\d*$/.test(action.href) ? action : null;
}
export const signalCount = (signal) => signal?.state === 'recorded' && Number.isFinite(signal.value) ? signal.value : null;
export function focusValue(value, key) {
  if (!Number.isFinite(value)) return 'Not recorded';
  if (['monthly_churn_pct', 'nrr_pct'].includes(key)) return `${value.toLocaleString('en-US')}%`;
  if (['active_users', 'new_users', 'paying_accounts', 'headcount'].includes(key)) return value.toLocaleString('en-US');
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function growPeriod(period) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period || '') ? new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : null;
}
