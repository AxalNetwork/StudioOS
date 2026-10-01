/**
 * Which HQ routes the view-as scope actually reaches (D289, task 340).
 *
 * THE BAR'S SENTENCE WAS A CLAIM ABOUT EVERY PAGE, AND TRUE ON TWO. H12's bar
 * says "Every figure below was read from this branch alone — none of it is a
 * platform total." It mounts in the shell, so it drew on every HQ page while
 * the scope was set; the scope itself is read by five files. Two narrow: HQ
 * Home swaps in the branch overlay, and Team (`/admin/accounts`) asks the
 * server for the branch's administrators. Two decline, in their own words:
 * Analytics and Topology say "Viewing as {branch} does not narrow this page".
 * Every other HQ page — Content, Contracts, Revenue, Funds, Platform, the
 * switches, Support, Security — never reads the scope, and the sentence was
 * false there: their figures are HQ's own.
 *
 * ONE REGISTRY, NO PER-PAGE EDIT. The bar reads this by pathname and says the
 * true thing for the route it is on. A page that starts reading the scope
 * registers here, and the guard (`view_as_scope_d289.test.mjs`) holds the
 * two lists equal in both directions: a registered route's page reads the
 * scope, and a page that reads the scope is registered. A route nobody
 * registered — ContentPage, the /admin/funds page — gets the out-of-scope
 * sentence without touching it.
 *
 * D153 decided the scope survives navigation, and it still does: the scope
 * is not cleared by moving to an unscoped page, the bar just stops claiming
 * the page narrows. `Return to HQ view` is the one way out.
 */
export const NARROWS = 'narrows';
export const DECLINES = 'declines';
export const UNSCOPED = 'unscoped';

/** Route → how the page treats the scope, and the file that does it. */
export const VIEW_AS_SCOPE = {
  '/hq': { scope: NARROWS, page: 'HqHomePage' },
  '/admin/accounts': { scope: NARROWS, page: 'AccountsPage' },
  '/admin/analytics': { scope: DECLINES, page: 'HqAnalyticsPage' },
  '/admin/platform/topology': { scope: DECLINES, page: 'PlatformTopologyPage' },
};

/** `narrows`, `declines` or `unscoped` for a pathname; exact match, no prefixes. */
export function viewAsScopeFor(pathname) {
  const entry = VIEW_AS_SCOPE[String(pathname || '')];
  return entry ? entry.scope : UNSCOPED;
}

/** H12's sentence, drawn only where it is true. */
export const NARROWED_CLAIM = 'Every figure below was read from this branch alone — none of it is a platform total.';

export function declinesSentence(branch) {
  return `This page does not narrow to ${branch}, and says so below: what is drawn here is HQ’s own, read across every branch.`;
}

export function outOfScopeSentence(branch) {
  return `This page does not read the view-as scope: everything below is HQ’s own, not ${branch}’s. `
    + 'The scope is kept until you return to HQ view.';
}

/** The sentence the bar draws for a location while `branch` is scoped. */
export function viewAsSentence(pathname, branch) {
  const scope = viewAsScopeFor(pathname);
  if (scope === NARROWS) return NARROWED_CLAIM;
  if (scope === DECLINES) return declinesSentence(branch);
  return outOfScopeSentence(branch);
}
