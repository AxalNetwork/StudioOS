/**
 * D4707 (#4707) — the licence page's navigation, kept in the URL:
 *
 *   /admin/licences?licence=<uid>&tab=<key>&kind=<all|subsidiary|white_label>
 *
 * so a link reopens the same licence on the same tab, and the browser's Back
 * steps through what was opened. Pure, so the tests read it without a page.
 */

/** The detail tabs, in the order the tab bar draws them. `step` is the page's internal number. */
export const LICENCE_TABS = Object.freeze([
  { key: 'entity', step: 1, label: '1. Entity' },
  { key: 'territory', step: 2, label: '2. Territory' },
  { key: 'seats', step: 3, label: '3. Seats' },
  { key: 'terms', step: 4, label: '4. Terms' },
  { key: 'contract', step: 5, label: '5. Contract' },
  { key: 'deploy', step: 6, label: '6. Deploy' },
  { key: 'schedule', step: 11, label: 'Terms schedule', testId: 'licence-schedule-tab' },
  { key: 'brand', step: 10, label: 'Brand kit', testId: 'licence-brand-tab', whiteLabelOnly: true },
  { key: 'admins', step: 8, label: 'Administrators' },
  { key: 'notices', step: 9, label: 'Notices' },
  { key: 'fee-invoices', step: 12, label: 'Annual fee invoices', testId: 'licence-fee-invoices-tab' },
  { key: 'history', step: 7, label: 'History' },
]);

export const DEFAULT_TAB = 'entity';
export const KIND_KEYS = Object.freeze(['all', 'subsidiary', 'white_label']);

/** The tabs a licence of this kind shows. */
export function tabsFor(kind) {
  return LICENCE_TABS.filter((t) => !t.whiteLabelOnly || kind === 'white_label');
}

/** The tab a URL names, or the default when it names none this licence has. */
export function tabFromParam(param, kind) {
  return tabsFor(kind).find((t) => t.key === param) || tabsFor(kind)[0];
}

export const stepOfTab = (key) => (LICENCE_TABS.find((t) => t.key === key) || LICENCE_TABS[0]).step;
export const tabOfStep = (step) => (LICENCE_TABS.find((t) => t.step === step) || LICENCE_TABS[0]).key;

export const kindFromParam = (param) => (KIND_KEYS.includes(param) ? param : 'all');

/**
 * The licence the editor may show: the selected one only if it is in the
 * VISIBLE rows. A filter that hides it moves the selection to the first row
 * still shown (or to none), so the editor never edits a row the list hides.
 */
export function reconcileSelection(selected, visibleItems) {
  const list = Array.isArray(visibleItems) ? visibleItems : [];
  if (selected && list.some((l) => l.uid === selected)) return selected;
  return list[0]?.uid ?? null;
}

/** Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern). Returns the next index, or null. */
export function tabKeyMove(key, index, count) {
  if (!count) return null;
  switch (key) {
    case 'ArrowRight': return (index + 1) % count;
    case 'ArrowLeft': return (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}
