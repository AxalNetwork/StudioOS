/**
 * D4866 (#4866, GR-02 "For this job", GR-04 finding P2, GR-10): the Grow overview's related links, chosen by the
 * founder's current growth task instead of the static "Also in Grow" list (`alsoInFor`), which named only Perks.
 *
 * The task is the overview's own ranked attention: the first item's area (Focus, Customers, Distribution,
 * Talent, Partnerships, Reporting …). With nothing ranked, a venture without a recorded focus is on the Focus
 * task; any other venture gets the canvas's general set. Each task names at most three existing destinations
 * that support it; Perks always closes the list, as a plain link with no detail, so it stays findable from Grow
 * without being promoted (`PAGE_HOMES['/perks']`'s door is `related`). Nothing here reads a store: a link's
 * detail is the attention item's own words where one exists (a report's due date), else a fixed purpose line.
 *
 * Pure data and functions: no React, so a Node test can import it directly.
 */
import { GROW_AREAS, reportingHref } from './growOverviewModel.js';
import { projectSearch } from './founderToolNavigation.js';

/** Every destination the list can name. `href(search)` keeps the venture where the route reads it. */
export const RELATED = Object.freeze({
  reporting: { label: 'Reporting', why: 'Updates and reporting duties', href: (s) => reportingHref(s) },
  connections: { label: 'Connections', why: 'Sources behind your figures', href: () => '/account/connectors' },
  calendar: { label: 'Calendar', why: 'Launch dates and meetings', href: () => '/calendar' },
  compliance: { label: 'Calendar', why: 'Filings and board dates', href: () => '/calendar?layer=compliance' },
  inbox: { label: 'Outreach inbox', why: 'Replies to your outreach', href: (s) => '/grow/distribution/inbox' + projectSearch(s) },
  email: { label: 'Email', why: 'Write to a customer or partner', href: () => '/email' },
  research: { label: 'Research', why: 'Market and customer research', href: () => '/research' },
  network: { label: 'Network', why: 'Relationships and introductions', href: () => '/network' },
  perks: { label: 'Perks', why: null, href: () => '/perks' },
});

/** Which destinations support each task, most useful first. Perks is appended to every list, never ranked. */
export const RELATED_BY_TASK = Object.freeze({
  overview: ['reporting', 'calendar', 'inbox', 'research'],
  reporting: ['reporting', 'connections', 'calendar'],
  focus: ['reporting', 'connections', 'research'],
  customers: ['inbox', 'email', 'research'],
  distribution: ['calendar', 'inbox', 'research'],
  talent: ['network', 'calendar'],
  partnerships: ['network', 'email', 'inbox'],
  markets: ['research', 'network'],
  company: ['reporting', 'compliance'],
});

/** The task's name as the list says it ("For this job · Customers"). */
export const TASK_NAMES = Object.freeze({
  overview: 'Growth review', reporting: 'Reporting', focus: 'Focus', customers: 'Customers', distribution: 'Distribution',
  talent: 'Talent', partnerships: 'Partnerships', markets: 'Markets', company: 'Company',
});

/** The task an attention item belongs to: its area's key, read from the area's name or, failing that, its href. */
export function taskOfItem(item) {
  if (!item || typeof item !== 'object') return null;
  const area = typeof item.area === 'string' ? item.area.trim().toLowerCase() : '';
  if (area === 'reporting') return 'reporting';
  const named = GROW_AREAS.find((a) => a.key && a.name.toLowerCase() === area);
  if (named) return named.key;
  const path = typeof item.href === 'string' ? item.href.split(/[?#]/)[0] : '';
  if (path === '/grow/reporting' || path.startsWith('/grow/reporting/')) return 'reporting';
  const seg = path.startsWith('/grow/') ? path.slice(6).split('/')[0] : '';
  const area2 = seg ? GROW_AREAS.find((a) => a.key && (a.key === seg || a.aliases.includes(seg))) : null;
  return area2 ? area2.key : null;
}

/**
 * The founder's current task from the overview's attention: the first ranked item with a known area; else
 * `focus` while the focus is recorded as missing; else `overview`. An unreadable attention read is `overview`,
 * never a guessed task.
 */
export function growTask(attention) {
  if (!attention || attention.state === 'unreadable') return 'overview';
  const items = Array.isArray(attention.items) ? attention.items : [];
  for (const item of items) {
    const task = taskOfItem(item);
    if (task) return task;
  }
  return attention.focus?.state === 'not_recorded' ? 'focus' : 'overview';
}

/**
 * The links for one overview read: `{ task, name, links: [{ key, label, why, href }] }`. A report that is due
 * lends Reporting its own words ("Due 2026-12-03"); read-only views get the same navigation, never an action.
 */
export function growRelated(attention, search = '') {
  const task = growTask(attention);
  const items = Array.isArray(attention?.items) ? attention.items : [];
  const due = items.find((i) => i?.key === 'report_due' && typeof i.why === 'string' && i.why);
  const keys = [...RELATED_BY_TASK[task], 'perks'];
  const links = keys.map((key) => {
    const r = RELATED[key];
    return { key, label: r.label, why: key === 'reporting' && due ? due.why : r.why, href: r.href(search) };
  });
  return { task, name: TASK_NAMES[task], links };
}
