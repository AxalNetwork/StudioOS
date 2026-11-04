// D4484: static Distribution tabs and project-scoped campaign navigation.
import { budgetReadable } from '../../account/usageModel.js';
export const DISTRIBUTION_PAGE = 'Founder · Grow · Distribution';
export const DISTRIBUTION_TABS = Object.freeze([
  ['overview', 'Overview'], ['channels', 'Channels'], ['campaigns', 'Campaigns'],
  ['calendar', 'Calendar'], ['ads', 'Ads'], ['newsletter', 'Newsletter'],
  ['prospects', 'Prospects'], ['inbox', 'Inbox'], ['results', 'Results'],
].map(([key, label]) => ({ key, label })));
export function distributionSearch(search = '') {
  const q = new URLSearchParams(search);
  const id = q.get('project_id') || q.get('project');
  return id && /^[1-9]\d*$/.test(id) ? `?project_id=${id}` : '';
}
export function distributionPath(tab = 'overview', search = '') {
  return `/grow/distribution${tab === 'overview' ? '' : `/${tab}`}${distributionSearch(search)}`;
}
export const distributionPrimary = (search) => ({ label: '+ New campaign', href: `/grow/distribution/campaigns/new${distributionSearch(search)}` });
/** Missing budget data is unknown, never evidence that the member is out. */
export function distributionAskState(aiOff, reading) {
  if (aiOff) return 'off';
  const b = reading?.budget;
  if (reading?.loading || reading?.budgetError || !budgetReadable(b) || b.unlimited === true) return 'rest';
  const included = Math.max(0, b.monthly_microusd - b.month_spend_microusd - b.month_reserved_microusd);
  const tokens = Math.max(0, b.balance_microusd - b.topup_reserved_microusd);
  return included + tokens === 0 ? 'out' : 'rest';
}
