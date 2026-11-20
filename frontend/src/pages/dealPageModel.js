/**
 * D1148 (#2421) — the deal page's tabs, each at its own address. Pure, so
 * the tests read it without a browser. D6168 (#6168): the tabs' WAITS are
 * gone; every tab draws its own read.
 *
 * WHERE THE TABS LIVE. `/deals/:dealId` is Overview, and `/deals/:dealId/<tab>`
 * is every other tab (the canvas's `/deals/[id]/<tab>`). A tab word the
 * viewer's role does not draw opens Overview, never a blank page.
 *
 * WHAT EACH ROLE DRAWS. An investor gets the canvas's eleven tabs (DL1), a
 * founder its five (DL16), and an admin and an Operating Partner the
 * investor's tabs without Notes, with the tabs only they keep: Invitations
 * (admin) and Transfers (admin, Operating Partner), as D630 placed them (DL17).
 *
 * THE EIGHT TABS (D4815 part 4, #5903, board DE04). The views above are what
 * a role holds; the page draws them under `DEAL_TABS`, eight tabs in the
 * canvas's order, each view at its own address as before.
 *
 * D6164 PART 3 (#6164, the owner's answer A of 2026-11-19, D6163's canvas
 * DE27 and the Scorecard placement). Team, Market and Traction are views
 * under the Scorecard tab, each at its old address. An investor's firm notes
 * are a "Firm notes" filter in Activity (`?show=notes`): the investor holds
 * Activity, not a Notes view, and `/notes` forwards there with the filter on
 * (`forwardOf`).
 *
 * WHAT IS READ TODAY. Overview, Documents, Commitment, Activity, Invitations
 * and Transfers draw today's reads. Team, Market and Traction read D1151's
 * per-deal reads since D1154 (`deal/DealInsightTabs.jsx`). Notes reads part 2's store since D1152 (`deal/DealNotes.jsx`), and
 * Diligence, Documents, Terms and Commitment are part 5's working tabs since
 * D1153 (`deal/DealWorkTabs.jsx`).
 */

export const TAB_DEFS = {
  overview: { label: 'Overview', path: '' },
  scorecard: { label: 'Scorecard', path: 'scorecard' },
  evidence: { label: 'Evidence', path: 'evidence' },
  team: { label: 'Team', path: 'team' },
  market: { label: 'Market', path: 'market' },
  traction: { label: 'Traction', path: 'traction' },
  diligence: { label: 'Diligence', path: 'diligence' },
  documents: { label: 'Documents', path: 'documents' },
  terms: { label: 'Terms', path: 'terms' },
  commitment: { label: 'Commitment', path: 'commitment' },
  activity: { label: 'Activity', path: 'activity' },
  invitations: { label: 'Invitations', path: 'invitations' },
  transfers: { label: 'Transfers', path: 'transfers' },
};

const INVESTOR = ['overview', 'scorecard', 'evidence', 'team', 'market', 'traction', 'diligence', 'documents', 'terms', 'commitment', 'activity'];
const FOUNDER = ['overview', 'documents', 'terms', 'commitment', 'activity'];
const STAFF = ['overview', 'scorecard', 'evidence', 'team', 'market', 'traction', 'diligence', 'documents', 'terms', 'commitment', 'activity'];

/** The tab ids a role draws, in the canvas's order. */
export function dealTabsFor(role) {
  if (role === 'investor') return INVESTOR;
  if (role === 'founder') return FOUNDER;
  // D609: reference calls are an admin's and an investor's; an Operating Partner has no Diligence tab.
  if (role === 'partner') return [...STAFF.filter((t) => t !== 'diligence'), 'transfers'];
  if (role === 'admin') return [...STAFF, 'invitations', 'transfers'];
  return ['overview'];
}

/**
 * D1213 (#2424): pages under a deal that are not tabs. The closing room is the
 * canvas's "Deals › [company] › Closing" (CP2, CP14, CP19): its own address,
 * opened from the Commitment tab, with no place in the tab bar.
 */
export const SUB_PAGES = {
  closing: { label: 'Closing', path: 'closing', roles: ['investor', 'founder', 'admin', 'partner'] },
};

/**
 * D4815 part 4 (#5903, board DE04): the eight tabs the page draws, in the
 * canvas's order. Each holds one or more of the views above, so no view is
 * removed: a tab with two or more views the role holds draws them as a
 * second row of links (`dealViewsIn`). A view keeps its own address, so every
 * address that opened a tab before D4815 still opens it, now under its tab;
 * `data-room` and `investment` are the two new addresses, and each opens its
 * tab's first view the role holds. The closing room (a sub-page) sits under
 * Investment. The mapping is listed in `decisions/D4815-p4.md`.
 */
export const DEAL_TABS = [
  { id: 'overview', label: 'Overview', path: '', views: ['overview'] },
  { id: 'scorecard', label: 'Scorecard', path: 'scorecard', views: ['scorecard', 'team', 'market', 'traction'] },
  { id: 'evidence', label: 'Evidence', path: 'evidence', views: ['evidence'] },
  { id: 'diligence', label: 'Diligence', path: 'diligence', views: ['diligence'] },
  { id: 'dataroom', label: 'Data room', path: 'data-room', views: ['documents'] },
  { id: 'terms', label: 'Terms', path: 'terms', views: ['terms'] },
  { id: 'investment', label: 'Investment', path: 'investment', views: ['commitment', 'invitations', 'transfers'], subPages: ['closing'] },
  { id: 'activity', label: 'Activity', path: 'activity', views: ['activity'] },
];

/** A view's label in its tab's second row, where the tab's own word would repeat. */
const VIEW_LABEL = { scorecard: 'Eleven scopes' };

/** The tabs a role draws: each of the eight that holds a view the role holds, with those views. */
export function dealGroupsFor(role) {
  const held = dealTabsFor(role);
  return DEAL_TABS.map((g) => ({ ...g, views: g.views.filter((v) => held.includes(v)) })).filter((g) => g.views.length);
}

/** The tab a view (or the closing room) sits under. */
export function groupOf(view) {
  return DEAL_TABS.find((g) => g.views.includes(view) || g.subPages?.includes(view))?.id || 'overview';
}

/** The second row of a tab for this role: its views, when it holds two or more; none otherwise. */
export function dealViewsIn(groupId, role) {
  const g = dealGroupsFor(role).find((x) => x.id === groupId);
  if (!g || g.views.length < 2) return [];
  return g.views.map((v) => ({ id: v, label: VIEW_LABEL[v] || TAB_DEFS[v].label }));
}

/** A tab's address, the deal id digits only. */
export function groupHref(dealId, groupId) {
  const id = /^[1-9]\d*$/.test(String(dealId)) ? String(dealId) : '';
  const path = DEAL_TABS.find((g) => g.id === groupId)?.path || '';
  return `/deals/${id}${path ? `/${path}` : ''}`;
}

/**
 * The view an address names for this role: a view's own word, else one of
 * the eight tabs' words (its first view the role holds); a word the role does
 * not draw is Overview.
 */
export function tabOf(param, role) {
  const word = String(param ?? '');
  const sub = Object.keys(SUB_PAGES).find((k) => SUB_PAGES[k].path === word);
  if (sub) return SUB_PAGES[sub].roles.includes(role) ? sub : 'overview';
  const held = dealTabsFor(role);
  const id = Object.keys(TAB_DEFS).find((k) => TAB_DEFS[k].path === word);
  if (id && held.includes(id)) return id;
  const group = word ? DEAL_TABS.find((g) => g.path === word) : null;
  return group?.views.find((v) => held.includes(v)) || 'overview';
}

/**
 * D6164 part 3 (DE27): Activity's filter word for the firm's notes, in the
 * address (`/deals/:id/activity?show=notes`), so a refresh keeps it.
 */
export const SHOW_NOTES = 'notes';

/** An investor's firm notes: Activity with Firm notes on. */
export function notesHref(dealId) {
  return `${tabHref(dealId, 'activity')}?show=${SHOW_NOTES}`;
}

/**
 * D6164 part 3: an address whose content moved, and where it now opens for
 * this role; null when the address is still its own. `/notes` was an
 * investor's Notes tab: it opens Activity with Firm notes on. For anyone
 * else it is not theirs and `tabOf` opens Overview, as before.
 */
export function forwardOf(param, role, dealId) {
  if (String(param ?? '') === 'notes' && role === 'investor') return notesHref(dealId);
  return null;
}

/** A tab's address; the deal id is digits only. */
export function tabHref(dealId, tab) {
  const id = /^[1-9]\d*$/.test(String(dealId)) ? String(dealId) : '';
  const path = (TAB_DEFS[tab] || SUB_PAGES[tab])?.path || '';
  return `/deals/${id}${path ? `/${path}` : ''}`;
}

export const NOT_YET = 'Not read here yet';

/**
 * D6168 (#6168): one scope's drawer on the Scorecard tab, at its own address
 * (`/deals/:id/scorecard?scope=team`). Team, Market and Traction link each of
 * their scorecard rows here; Back from the drawer is the browser's own. A
 * scope word that is not a key opens the tab with no drawer.
 */
export function scopeHref(dealId, scope) {
  const base = tabHref(dealId, 'scorecard');
  return /^[a-z][a-z_]{1,31}$/.test(String(scope ?? '')) ? `${base}?scope=${scope}` : base;
}
