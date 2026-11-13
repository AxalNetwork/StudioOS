// The two things the onboarding wizards and the app shell must agree on.
//
// Both live here rather than in a page or a component because a guard test
// can import a module and not a page: importing a page pulls React and a
// stylesheet through its component tree and the test loader cannot resolve
// it. Keeping the event NAME and the landing RULE here is what lets each be
// asserted directly, in both directions.
//
// No React, no I/O.

/**
 * Fired on `window` the moment POST /onboarding/complete succeeds, so the
 * app shell can retire its own cached "still onboarding" belief without a
 * second round trip.
 *
 * WHY IT EXISTS. App.jsx reads onboarding progress in an effect keyed on
 * `[user?.id]`: once per session, never again. Finish a wizard mid-session
 * and the shell still believes the user is mid-wizard, so the moment the
 * wizard navigates anywhere outside /onboarding the resume gate fires and
 * sends them back to `WIZARD_FOR_LICENCE[their role]`. That is how an
 * investor who had just finished ended up in the FOUNDER wizard.
 *
 * `detail` carries `{ flow }` — 'founder' | 'investor' | 'partner'.
 */
export const ONBOARDING_COMPLETE_EVENT = 'axal:onboarding-complete';

/**
 * Fired on `window` the moment POST /onboarding/licence succeeds, so the
 * app shell can retire its cached "still on the licence step" belief.
 *
 * THE SAME EFFECT, ONE GATE EARLIER. Progress is read once per session,
 * keyed on `[user?.id]`. Choosing Founder, Investor, Advisor or Partner
 * writes a new flow on the server and the page then navigates to that
 * profile's wizard (or the holding dashboard, for an advisor). The shell
 * still believes `flow === 'licence'`, so the licence gate sends the
 * navigation straight back to `/onboarding`. The click looks dead. A full
 * reload re-reads progress and the next click works, which is the whole
 * of the report.
 *
 * `detail` is `{ licence }` — 'founder' | 'investor' | 'advisor' | 'partner'.
 * Advisor is the one licence the server marks complete; the other three
 * open a wizard.
 */
export const ONBOARDING_LICENCE_CHOSEN_EVENT = 'axal:onboarding-licence-chosen';

/**
 * Fired on `window` the moment POST /auth/accept-terms succeeds, so the app
 * shell can retire its own cached "still owes an acceptance" belief.
 *
 * Task #178's interstitial has exactly the problem the event above was built
 * for, one gate along. `RequireAuth` reads `terms_acceptance_pending` off /me in
 * the same effect keyed on `[user?.id]` — once per session, never again — so
 * without this the screen the user just accepted on would re-render itself
 * immediately, with no way past it short of a full reload. Announcing is
 * cheaper and more reliable than re-fetching a fact we have already been told,
 * and it is the same reasoning, so it is the same mechanism rather than a
 * second one.
 *
 * No `detail`: there is one thing to say and it is in the name.
 */
export const TERMS_ACCEPTED_EVENT = 'axal:terms-accepted';

/**
 * Where an investor goes when their wizard ends.
 *
 * The finish button says "See deal flow" and this used to answer `/studio`,
 * the generic workspace root. `/deals` is the investor's deal flow and is
 * guarded ['admin', 'partner', 'investor'], so it is reachable the moment
 * the role is real.
 *
 * An `exploring` account is NOT an investor yet — membership is still under
 * review and the /deals guard would reject it — so it goes to the holding
 * dashboard that exists for exactly that state. Sending it to /deals would
 * trade one wrong destination for another.
 */
export function investorLanding(role) {
  return role === 'exploring' ? '/exploring' : '/deals';
}
