/**
 * D941 (#2746, part 4 of #2375) — the Accounts address, by the answer #2375's
 * question 1 took (A): the Admin's Accounts page is `/admin/accounts`, and
 * HQ › Team is `/admin/hq-team`, beside `/admin/hq-support`. Pure, so
 * `frontend/test/accounts_address_d941.test.mjs` holds each rule.
 *
 * WHILE THE REDIRECT WINDOW RUNS. `/admin/accounts` was Team's for a long time:
 * the Super Admin transfer notices already sent carry it, and so do bookmarks.
 * So a Super Admin who opens it is forwarded to Team, keeping the query and
 * hash, with `?moved=team` for the one-line notice; an Admin gets the Accounts
 * page. `/admin/held/accounts`, the Accounts page's old address, forwards to
 * `/admin/accounts` with nothing to explain: it was never a door anyone kept.
 * Neither forward is kept for good (#2375's route map).
 */
export const ACCOUNTS_PATH = '/admin/accounts';
export const TEAM_PATH = '/admin/hq-team';

/** The one line Team shows after the forward. */
export const TEAM_MOVED_NOTICES = Object.freeze({
  team: 'Team has moved to its own address under HQ. /admin/accounts is the Admin’s Accounts page now.',
});

/** Where a Super Admin's `/admin/accounts` lands: Team, the query and hash kept, with `moved=team`. */
export function teamForward(search = '', hash = '') {
  const q = new URLSearchParams(String(search || ''));
  q.set('moved', 'team');
  return { pathname: TEAM_PATH, search: `?${q.toString()}`, hash: hash || '' };
}

/** Where `/admin/held/accounts` lands: the Accounts page, the query and hash kept. */
export function heldAccountsForward(search = '', hash = '') {
  return { pathname: ACCOUNTS_PATH, search: search || '', hash: hash || '' };
}
