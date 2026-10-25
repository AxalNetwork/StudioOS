/**
 * D1188 (#2457) — the Capital relationships tool's addresses and words, kept
 * pure so the tests read them without a browser.
 *
 * WHERE THE TOOL LIVES. `/raise/capital-relationships` is CycleRoute's module
 * page (Overview), and every `/raise/capital-relationships/<word>` is its
 * record route (`/raise/:slug/:id`). An investor record's id is its number, so
 * the tool's tabs are words CycleRoute reads as tabs, never records
 * (`isCapRelTab`), as D1101 did for the Data room. No route is added.
 *
 * WHAT IS READ TODAY. `GET /api/cycles/raise/modules/capital-relationships`
 * draws Overview as today, Pipeline's investors (as a list; the board is
 * part 4's) and Calls' history. Commitments draws today's closes and pro-rata
 * (`/api/contacts/raise-closes`, `/raise-pro-rata`), the panels the old
 * pipeline page draws. Match, Outreach and Activity have no read of their own
 * on `main`, so each says "Not read here yet" with its reason (D1188 §2).
 */

export const SLUG = 'capital-relationships';
export const HOME_PATH = `/raise/${SLUG}`;
export const TITLE = 'Capital relationships';
export const LINE = 'Every investor you are raising from: where each stands, what is next, and what they committed.';

/** The canvas's tab strip, in its order (CRL1). */
export const TABS = [
  { id: 'overview', label: 'Overview', path: '' },
  { id: 'pipeline', label: 'Pipeline', path: '/pipeline' },
  { id: 'match', label: 'Match', path: '/match' },
  { id: 'outreach', label: 'Outreach', path: '/outreach' },
  { id: 'commitments', label: 'Commitments', path: '/commitments' },
  { id: 'calls', label: 'Calls', path: '/calls' },
  { id: 'activity', label: 'Activity', path: '/activity' },
];
const TAB_WORDS = new Set(TABS.filter((t) => t.path).map((t) => t.id));

/** True when CycleRoute's record id under this module is a tab, not an investor. */
export const isCapRelTab = (slug, id) => slug === SLUG && TAB_WORDS.has(String(id ?? ''));

/** The query a tab keeps: the venture only. */
export function tabSearch(search = '') {
  const from = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const project = from.get('project_id') || from.get('project');
  return project && /^[1-9]\d*$/.test(project) ? `?project_id=${project}` : '';
}

export const tabHref = (tab, search = '') => `${HOME_PATH}${tab.path}${tabSearch(search)}`;

export const NOT_YET = 'Not read here yet';

/** Why a tab draws no blocks today. Never a zero, never "none". */
export const WAITS = {
  match: 'Matching funds to this venture is not read here yet. Each investor’s fit is on Pipeline, from the fund’s focus against your sector.',
  outreach: 'Outreach, follow-ups due and investor updates in one place are not read here yet. Each investor’s next step is on Pipeline.',
  activity: 'One timeline across every investor is not read here yet. Each investor’s record keeps its own.',
};
