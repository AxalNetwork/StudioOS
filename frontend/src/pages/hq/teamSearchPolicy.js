/**
 * D5042 (#5042) — the browser's half of the HQ Team search contract.
 *
 * `cloudflare-worker/src/util/teamSearch.ts` is the contract: the Worker decides WHEN TO ASK
 * the branches, and answers with `search.state`. This file mirrors its two numbers and its
 * normalization so the page does not send a request the Worker would only decline, and so the
 * words under the field agree with what the Worker will do. A test holds the numbers equal.
 *
 * Local filtering of HQ's own administrators is a different thing and is NOT governed by this:
 * the roster is complete in the browser and narrows on every keystroke. Only the branch
 * search, which costs a request to every branch, is.
 */
export const TEAM_SEARCH_MIN = 2;
export const TEAM_SEARCH_MAX = 64;

/** Trimmed, whitespace collapsed, and its state: none | too_short | too_long | asked. */
export function normalizeTeamSearch(raw) {
  const query = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const length = Array.from(query).length;
  const state = length === 0 ? 'none'
    : length < TEAM_SEARCH_MIN ? 'too_short'
      : length > TEAM_SEARCH_MAX ? 'too_long'
        : 'asked';
  return { state, query };
}

/** The query to send to the branches: the normalized text when it is askable, else ''. */
export function branchQueryFor(raw) {
  const { state, query } = normalizeTeamSearch(raw);
  return state === 'asked' ? query : '';
}

/**
 * What to tell the operator about the branch search, from what they typed, what was
 * last sent, what is in flight and what the Worker last answered. Pure; the page
 * puts the result in one polite status region.
 *
 *   hint     the field is below the minimum: no request is made
 *   pending  a request for `sent` is in flight
 *   result   the branches answered for `sent`
 */
export function searchStatus({ typed, sent, pending, answeredFor, hits, failed }) {
  const { state } = normalizeTeamSearch(typed);
  if (state === 'too_short') return { kind: 'hint', text: `Type at least ${TEAM_SEARCH_MIN} characters to search the branches.` };
  if (state === 'too_long') return { kind: 'hint', text: `Branch search is limited to ${TEAM_SEARCH_MAX} characters.` };
  if (pending && sent) return { kind: 'pending', text: `Searching the branches for “${sent}”…` };
  if (!sent) return { kind: 'idle', text: '' };
  if (answeredFor !== sent) return { kind: 'pending', text: `Searching the branches for “${sent}”…` };
  if (failed) return { kind: 'result', text: `${failed} ${failed === 1 ? 'branch' : 'branches'} could not be read for “${sent}”.` };
  return { kind: 'result', text: `${hits} ${hits === 1 ? 'match' : 'matches'} on the branches for “${sent}”.` };
}
