/**
 * D5042 (#5042) — the HQ Team search contract, in one place.
 *
 * The Team page asks every branch for accounts matching what the operator typed, over each
 * branch's private link. That fan-out is the cost, so WHEN TO ASK is the contract, and it used
 * to live only in the browser (two characters, after a debounce): the Worker treated any
 * non-empty `q` as a search and would fan a one-character query out to every branch when
 * called directly. The browser is not the API.
 *
 *   none       nothing typed (or only whitespace): nobody is asked
 *   too_short  fewer than MIN characters after trimming: nobody is asked
 *   too_long   more than MAX characters: nobody is asked (a truncated query would search for
 *              something the operator did not type, and say nothing)
 *   asked      MIN to MAX characters: every branch is asked THIS string, and only this string
 *
 * The normalized query is what is sent to a branch AND what the response names, so a branch
 * hit can always be tied to the exact query the operator sees.
 *
 * Length is counted in characters (code points), after trimming and collapsing runs of
 * whitespace to one space, so the browser and the Worker agree on a query typed with stray
 * spaces. `frontend/src/pages/hq/teamSearchPolicy.js` mirrors these numbers; a test holds
 * the two files to the same MIN and MAX.
 */
export const TEAM_SEARCH_MIN = 2;
export const TEAM_SEARCH_MAX = 64;

export type TeamSearchState = 'none' | 'too_short' | 'too_long' | 'asked';

export type TeamSearch = {
  state: TeamSearchState;
  /** The normalized query (trimmed, whitespace collapsed). Sent to a branch only when `state` is `asked`. */
  query: string;
  min_length: number;
  max_length: number;
};

export function normalizeTeamSearch(raw: unknown): TeamSearch {
  const query = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const length = Array.from(query).length;
  const state: TeamSearchState = length === 0 ? 'none'
    : length < TEAM_SEARCH_MIN ? 'too_short'
      : length > TEAM_SEARCH_MAX ? 'too_long'
        : 'asked';
  return { state, query, min_length: TEAM_SEARCH_MIN, max_length: TEAM_SEARCH_MAX };
}
