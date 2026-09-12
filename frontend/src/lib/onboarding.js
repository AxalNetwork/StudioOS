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
