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

// ---------- D1299 (#2377): the Accounts canvas's addresses and widgets ----------

/** Accounts' two tabs (ACC1, ACC2); each is its own address. */
export const ACCOUNTS_TABS = Object.freeze([
  { key: 'overview', label: 'Overview', to: ACCOUNTS_PATH },
  { key: 'all', label: 'All accounts', to: `${ACCOUNTS_PATH}/all` },
]);

/** One account's record, the address #2369 and #2370's "Open member record" target. */
export const accountRecordHref = (id) => `${ACCOUNTS_PATH}/all/${id}`;

/** The record id a location names, or null: a positive whole number under `/admin/accounts/all/`. */
export function recordIdOf(pathname) {
  const m = /^\/admin\/accounts\/all\/([1-9]\d{0,15})\/?$/.exec(String(pathname || ''));
  return m ? Number(m[1]) : null;
}

/** The page's line (ACC1). */
export const ACCOUNTS_LINE = 'Every account this studio holds, by profile: who joined, who is still exploring, and who needs you.';

/**
 * ACC1's widgets, one per profile, in #2377's order and words (G1's names).
 * `role` is the `users.role` the glance counts. The two sub-accounts have no
 * count on any read yet, so each says why rather than drawing a zero.
 */
export const PROFILE_WIDGETS = Object.freeze([
  { key: 'founder', label: 'Founders', role: 'founder' },
  { key: 'investor', label: 'Investors', role: 'investor' },
  { key: 'advisor', label: 'Advisors', role: 'advisor' },
  { key: 'partner', label: 'Operating Partners', role: 'partner' },
  { key: 'exploring', label: 'Explorers', role: 'exploring' },
  { key: 'lp', label: 'LPs', role: null, reason: 'An LP is an approved LP application, not a role, so no account count holds it yet. The overview read counts it (D1301).' },
  { key: 'tester', label: 'Product testers', role: null, reason: 'Not recorded: there is no Product tester sub-account yet. D1302 adds it.' },
]);

/**
 * A widget's count from the glance's `by_role`. The glance groups every active
 * account by role, so a role it does not list is a measured 0; a widget with no
 * role, or no `by_role` at all, is null (not read), never 0.
 */
export function widgetCount(byRole, role) {
  if (!role || !Array.isArray(byRole)) return null;
  const row = byRole.find((r) => r && r.role === role);
  return row && Number.isFinite(Number(row.count)) ? Number(row.count) : 0;
}
