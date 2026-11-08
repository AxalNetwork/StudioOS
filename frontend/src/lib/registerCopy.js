/**
 * #4651 — the entry copy of /register by audience, and its heading. Moved out of RegisterPage.jsx so it can be tested:
 * that page reads `import.meta.env` at load and cannot be imported under `node --test`.
 *
 * An advisor subscription is not a pitch: the `advisor` lane has its own words. The Worker's register route takes no
 * `advisor` role (only founder, partner and investor), so none is sent for it: the advisor profile is chosen after the
 * account exists (`LANE_ROLE.advisor` is undefined).
 */
export const LANES = Object.freeze(['partner', 'investor', 'lp', 'founder', 'advisor']);

export const LANE_COPY = Object.freeze({
  partner: {
    title: 'Join the Partner Network',
    desc: "Get matched with deals before they go public. Free to join — no password to remember, we'll email you a secure sign-in link.",
  },
  lp: {
    title: 'Open your LP Account',
    desc: "Track commitments, calls, and distributions. Free to join — no password to remember, we'll email you a secure sign-in link.",
  },
  advisor: {
    title: 'Create your Advisor account',
    desc: "Free to join — no password to remember, we'll email you a secure sign-in link. Your advisor profile is confirmed before you can subscribe.",
  },
  founder: {
    title: 'Submit your pitch',
    // Founder-journey audit — this used to promise a fixed scoring turnaround measured in hours. Nothing enforces any
    // such SLA: a fresh signup holds in the exploring review queue until an admin sends the binding agreement, and
    // scoring is SELF-SERVE (the founder runs it from /scoring / the Lab) once the workspace opens. Promise what the
    // system actually does. (founder_journey_guards.test.mjs greps RegisterPage.jsx for timed-SLA copy.)
    desc: "Free to join — after a short profile review, your workspace opens with self-serve venture scoring and the Spin-Out Lab tools. No password to remember; we'll email you a secure sign-in link.",
  },
});

/** The lane → the role the Worker's register route takes; `lp` folds into investor, and an advisor sends none. */
export const LANE_ROLE = Object.freeze({ partner: 'partner', investor: 'investor', lp: 'investor', founder: 'founder', advisor: undefined });

/** The heading and the line under it: the chosen plan when one is ready, else the audience's own words. */
export function registerHeading(lane, selection) {
  const own = lane && LANE_COPY[lane] ? LANE_COPY[lane] : null;
  const title = selection?.state === 'ready' ? `Create your account to get ${selection.name}` : own?.title || 'Create Your Account';
  const desc = own?.desc || "Free to join. No password to remember — we'll email you a secure sign-in link.";
  return { title, desc };
}
