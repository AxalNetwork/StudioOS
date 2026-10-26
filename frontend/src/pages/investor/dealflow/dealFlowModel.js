/**
 * D1236 (#2423) — Deal flow at /deals, from the owner's canvas "Deal flow"
 * (DLS1–DLS18): the view, the scope switch and the compare picks carried in
 * the address, the scoring scopes in SCORING's order, the round's status
 * words, and the words of every block no read carries yet. Pure, so
 * `frontend/test/deal_flow_d1236.test.mjs` holds each rule.
 *
 * WHAT IS READ TODAY. `GET /api/deals` (every round, or `scope=mine`: the
 * deals the investor is invited to or committed on) and
 * `GET /api/deals/invitations/mine`. The investor's own stages, the scores by
 * scope (SCORING #2428), fit to the thesis, saved views and the other ways a
 * venture reaches the investor have no read, so those blocks say "Not read
 * here yet" with their reason and never draw a zero (D1236 §2).
 */

import { SCOPE_LABELS } from '../../../components/scoring/scorecard/scorecardModel.js';

export const BASE = '/deals';
export const COMPARE = '/deals/compare';

/** The page's title (DLS1). The Deals bucket's root is this page. */
export const TITLE = 'Deal flow';

export const PAGE_LINE = 'Every venture you are looking at, how it scores by scope, and where it stands with you.';

export const VIEWS = Object.freeze(['board', 'table']);
/** The scope switch (DLS1): Mine, All deals, New for you. */
export const SCOPE_SWITCH = Object.freeze([
  { key: 'mine', label: 'Mine' },
  { key: 'all', label: 'All deals' },
  { key: 'new', label: 'New for you' },
]);

/** What the address names. Board and Mine by default; anything unknown is the default. */
export function viewOf(search = '') {
  const q = new URLSearchParams(String(search));
  const view = VIEWS.includes(q.get('view')) ? q.get('view') : 'board';
  const scope = SCOPE_SWITCH.some((s) => s.key === q.get('scope')) ? q.get('scope') : 'mine';
  return { view, scope };
}

/** The address of a view: the defaults are left out, so `/deals` is board and Mine. */
export function viewHref({ view = 'board', scope = 'mine' } = {}) {
  const q = new URLSearchParams();
  if (view !== 'board') q.set('view', view);
  if (scope !== 'mine') q.set('scope', scope);
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}

export const MAX_COMPARE = 4;
const ID = /^[1-9][0-9]{0,15}$/;

/** The deal ids `/deals/compare?ids=` names: digits only, no repeats, at most four, in order. */
export function compareIds(search = '') {
  const raw = new URLSearchParams(String(search)).get('ids') || '';
  const out = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (ID.test(id) && !out.includes(id)) out.push(id);
    if (out.length === MAX_COMPARE) break;
  }
  return out;
}

export function compareHref(ids = []) {
  const clean = compareIds(`ids=${ids.join(',')}`);
  return clean.length ? `${COMPARE}?ids=${clean.join(',')}` : COMPARE;
}

/** SCORING's eleven scopes (#2428), in its order, from the scorecard's one list (D1253). There is no Overall. */
export const SCOPES = SCOPE_LABELS;

/** The investor's own stages (DLS1). Passed sits outside the board, as a filter. */
export const MY_STAGES = Object.freeze(['Sourced', 'Screening', 'Diligence', 'Commit', 'Closing']);

/** The round's status, the studio's (`deals.status`), as the canvas words it. */
export const ROUND_WORD = Object.freeze({
  applied: 'In intake',
  scored: 'Screened',
  active: 'Raising',
  funded: 'Funded',
  rejected: 'Not raising',
});
export const roundWord = (s) => ROUND_WORD[s] || 'Not recorded';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** One table row (DLS2) from one `GET /api/deals` item. A value the read did not return stays null. */
export function dealRow(d = {}) {
  return {
    id: String(d.id ?? ''),
    name: d.project_name || 'Name not recorded',
    sector: d.project_sector || null,
    round: roundWord(d.status),
    ask: num(d.amount),
    currency: d.currency || null,
    daysInStage: num(d.days_in_stage),
    member: Number(d.is_member) === 1,
  };
}

/**
 * Who may open a deal from this list. An investor reads a deal only when
 * invited or committed (`deals.ts` canReadDeal), which is exactly Mine; a row
 * under All deals is not a door until then (#2423 broken item 2).
 */
export const opensDeal = (scope) => scope === 'mine';

/** An invitation (DLS6 "Invited by the studio") from `GET /api/deals/invitations/mine`. */
export function inviteRow(i = {}) {
  return {
    id: String(i.deal_id ?? ''),
    name: i.project_name || 'Name not recorded',
    status: i.status || null,
    message: i.message || null,
    at: i.created_at || null,
  };
}

export const NOT_YET = 'Not read here yet';

/** What the canvas draws that no read carries yet. Never a zero, never "none". */
export const WAITS = Object.freeze({
  stages: 'Your own stages (Sourced to Closing), moves and passes are not stored yet; today’s zones below follow the round’s status.',
  scores: 'Scores by scope with their confidence are not read here yet: they come from the scoring engine (#2428).',
  fit: 'Fit to your thesis is not read here yet.',
  views: 'Saved views, filters and sort by score are not stored yet.',
  entered: 'Matches to your thesis, introductions, open syndicates and your watchlist do not reach this list yet.',
  compare: 'The compare chart and its table wait for the scores by scope; the ventures you picked are listed.',
});
