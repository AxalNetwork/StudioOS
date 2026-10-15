/**
 * D701 (#1663) — the founder's Studio, read from its URL. Pure: no React, no
 * fetch, so a Node test imports it as it is.
 *
 * THE TAB LIVES IN THE URL, AT EVERY WIDTH (decision 3). `?tab=tasks` opens
 * Tasks and `?tab=tickets` opens My tickets; no `tab`, `?tab=conversations`
 * and any other value open Conversation. The ids are `PANEL_TABS`'s
 * (`components/advisor/EadwynPanels.jsx`).
 *
 * OPEN A TICKET IS A ROUTE, `/studio/tickets/new` (decision 4). `?type=` picks
 * the form's type only when it is one the form offers; anything else opens it
 * with no type, as D544 and D606 require.
 *
 * `project_id` FOLLOWS EVERY STUDIO LINK THIS TASK WRITES (decision 3). It
 * picks the venture the page reads, so a founder with several ventures keeps
 * theirs through the tabs and the ticket card.
 */

export const STUDIO_PATH = '/studio';
export const STUDIO_TICKET_PATH = '/studio/tickets/new';

const TABS = { tasks: 'tasks', tickets: 'tickets' };
const TICKET_TYPES = ['task', 'bug', 'feature'];

const paramsOf = (search) => new URLSearchParams(typeof search === 'string' ? search : '');

/** `'conversation'`, `'tasks'` or `'tickets'`. */
export function studioTabOf(search) {
  return TABS[paramsOf(search).get('tab')] || 'conversation';
}

/** `'task'`, `'bug'`, `'feature'` or null. */
export function ticketTypeOf(search) {
  const type = paramsOf(search).get('type');
  return TICKET_TYPES.includes(type) ? type : null;
}

/**
 * `to` with `search`'s `project_id` added after `to`'s own query, or `to`
 * unchanged when `search` has none. Nothing else in `search` is carried.
 */
export function withProjectId(to, search) {
  const projectId = paramsOf(search).get('project_id');
  if (!projectId) return to;
  const [path, query = ''] = String(to).split('?');
  const params = new URLSearchParams(query);
  params.set('project_id', projectId);
  return `${path}?${params.toString()}`;
}

/**
 * The search a tab change writes: `search` with `?tab=` set, or removed for
 * Conversation, and every other parameter kept, `project_id` among them.
 */
export function searchWithTab(search, tab) {
  const params = paramsOf(search);
  if (TABS[tab]) params.set('tab', tab);
  else params.delete('tab');
  const next = params.toString();
  return next ? `?${next}` : '';
}
