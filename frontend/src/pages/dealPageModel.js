/**
 * D1148 (#2421) — the deal page's tabs, each at its own address, and what a
 * tab says while nothing reads its blocks yet. Pure, so the tests read it
 * without a browser.
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
 * WHAT IS READ TODAY. Overview, Documents, Commitment, Activity, Invitations
 * and Transfers draw today's reads. Team, Market and Traction have no per-deal
 * read on `main`, so each says "Not read here yet" with its reason (D1148
 * §3). Notes reads part 2's store since D1152 (`deal/DealNotes.jsx`), and
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
  notes: { label: 'Notes', path: 'notes' },
  activity: { label: 'Activity', path: 'activity' },
  invitations: { label: 'Invitations', path: 'invitations' },
  transfers: { label: 'Transfers', path: 'transfers' },
};

const INVESTOR = ['overview', 'scorecard', 'evidence', 'team', 'market', 'traction', 'diligence', 'documents', 'terms', 'commitment', 'notes'];
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

/** The tab an address names for this role: a word the role does not draw is Overview. */
export function tabOf(param, role) {
  const word = String(param ?? '');
  const sub = Object.keys(SUB_PAGES).find((k) => SUB_PAGES[k].path === word);
  if (sub) return SUB_PAGES[sub].roles.includes(role) ? sub : 'overview';
  const id = Object.keys(TAB_DEFS).find((k) => TAB_DEFS[k].path === word);
  return id && dealTabsFor(role).includes(id) ? id : 'overview';
}

/** A tab's address; the deal id is digits only. */
export function tabHref(dealId, tab) {
  const id = /^[1-9]\d*$/.test(String(dealId)) ? String(dealId) : '';
  const path = (TAB_DEFS[tab] || SUB_PAGES[tab])?.path || '';
  return `/deals/${id}${path ? `/${path}` : ''}`;
}

export const NOT_YET = 'Not read here yet';

/** Why a tab draws no blocks today. Never a zero, never "none". */
export const WAITS = {
  scorecard: 'No per-deal score read exists yet. The scorecard is SCORING’s canvas (#2428), drawn here once its read lands. This is not a score of zero.',
  evidence: 'No per-deal evidence read exists yet. The evidence block is the Raise evidence canvas (#2430), shown here as the founder shares each item.',
  team: 'No per-deal team read exists yet. Founders and key hires show here as they published themselves, once the read lands.',
  market: 'No per-deal market read exists yet. TAM, SAM and SOM show here with their sources, once the read lands.',
  traction: 'No per-deal traction read exists yet. Only the figures the founder shares will show here; until then nothing is shown.',
};
