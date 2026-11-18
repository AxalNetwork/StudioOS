// D6143 (#6143) — an IC decision's voting roster. Worker: routes/ic.ts.
//
// The person who opened the decision, or an Admin, picks who votes, from the
// firm's Investor licence holders (Q4 A of the #6153 brief). A decision with
// no roster has no eligible count: the read says null with its reason, never
// 0. A roster can also be sent when opening, as `voter_user_ids` on
// `api.icCreate`.
import { request } from '../api.js';

export const icRosterApi = {
  /**
   * {roster: {available, eligible, voted, recused, to_vote, counted, not_voted, off_roster, members, reason?},
   * may_edit, candidates: [{user_id, name}] | null}; candidates only for whoever may set the roster.
   */
  get: (uid) => request(`/ic/${encodeURIComponent(uid)}/roster`),
  /** Replaces the roster. Refusals: roster_invalid, roster_needs_firm, roster_voter_not_eligible, roster_omits_voter. */
  set: (uid, userIds) => request(`/ic/${encodeURIComponent(uid)}/roster`, {
    method: 'PUT',
    body: JSON.stringify({ user_ids: userIds }),
  }),
};
