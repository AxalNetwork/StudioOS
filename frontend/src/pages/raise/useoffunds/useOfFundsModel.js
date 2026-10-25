/**
 * D1173 (#2455) — the Use of funds tool's addresses and words, kept pure so
 * the tests read them without a browser.
 *
 * WHERE THE TOOL LIVES. `/raise/use-of-funds` is CycleRoute's module page
 * (Home), and every `/raise/use-of-funds/<word>` is its record route
 * (`/raise/:slug/:id`). A section record's id is its key (`product`,
 * `go-to-market`, `infrastructure`, `operations`, `reserve`), so the tool's
 * tabs are other words, which CycleRoute reads as tabs and never as records
 * (`isUseOfFundsTab`), as D1101 did for the Data room. No route is added.
 *
 * WHAT IS READ TODAY. `GET /api/cycles/raise/modules/use-of-funds` draws Home
 * as today and Allocation's section rows. Milestones and hires, Runway,
 * Scenarios, Plan vs actual and History have no read of their own on `main`,
 * so each says "Not read here yet" with its reason (D1173 §2). Today's
 * financial model stays at `/raise/capital/model` until part 5 moves it under
 * Runway as Forecast; the tool links it with the venture kept.
 */

export const SLUG = 'use-of-funds';
export const HOME_PATH = `/raise/${SLUG}`;
export const TITLE = 'Use of funds';
export const LINE = 'What the raise pays for, by section, and how long it lasts.';

/** The canvas's tab strip, in its order (UF1). */
export const TABS = [
  { id: 'home', label: 'Home', path: '' },
  { id: 'allocation', label: 'Allocation', path: '/allocation' },
  { id: 'milestones', label: 'Milestones and hires', path: '/milestones' },
  { id: 'runway', label: 'Runway', path: '/runway' },
  { id: 'scenarios', label: 'Scenarios', path: '/scenarios' },
  { id: 'actuals', label: 'Plan vs actual', path: '/actuals' },
  { id: 'history', label: 'History', path: '/history' },
];
const TAB_WORDS = new Set(TABS.filter((t) => t.path).map((t) => t.id));

/** True when CycleRoute's record id under this module is a tab, not a section. */
export const isUseOfFundsTab = (slug, id) => slug === SLUG && TAB_WORDS.has(String(id ?? ''));

/** The query a tab keeps: the venture only. */
export function tabSearch(search = '') {
  const from = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const project = from.get('project_id') || from.get('project');
  return project && /^[1-9]\d*$/.test(project) ? `?project_id=${project}` : '';
}

export const tabHref = (tab, search = '') => `${HOME_PATH}${tab.path}${tabSearch(search)}`;

/** Today's financial model, with the venture kept (#2455 broken item 8). Part 5 makes it Runway › Forecast. */
export const forecastHref = (search = '') => `/raise/capital/model${tabSearch(search)}`;

export const NOT_YET = 'Not read here yet';

/** Why a tab draws no blocks today. Never a zero, never "none". */
export const WAITS = {
  milestones: 'Milestones and hires are not listed together yet. Each section’s milestone and the hires it funds are on its own record, opened from Allocation.',
  runway: 'Runway today, the cash path and the milestones it reaches are not read here yet. Runway today takes Mercury first, then a metrics snapshot, and is never the forecast.',
  scenarios: 'Scenarios are not stored yet. Today the plan is one split and one raise.',
  actuals: 'Plan against actual spend is not read here yet. Mercury’s spend by category, and each category’s proposed section, are on Home for the founder.',
  history: 'The plan’s history is not read here yet. Each section’s record keeps its own activity.',
};

/** Runway's line under the wait: where the forecast is today. */
export const FORECAST_LINE = 'The forecast is a model you set. It is not your runway today. It is still the financial model, until it moves here as Forecast.';
