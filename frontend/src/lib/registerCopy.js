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
    title: 'Create your Partner account',
    desc: "Get matched with deals before they go public. Creating an account is free — no password to remember, we'll email you a secure link. Your partner membership and profile are reviewed before deals open.",
  },
  lp: {
    title: 'Open your LP Account',
    desc: "Track commitments, calls, and distributions. Creating an account is free — no password to remember, we'll email you a secure link. Your membership is reviewed before your workspace opens.",
  },
  advisor: {
    title: 'Create your Advisor account',
    desc: "Creating an account is free — no password to remember, we'll email you a secure link. Your membership and advisor profile are confirmed before you can subscribe.",
  },
  founder: {
    title: 'Submit your pitch',
    // Founder-journey audit — this used to promise a fixed scoring turnaround measured in hours. Nothing enforces any
    // such SLA: a fresh signup holds in the exploring review queue until an admin sends the binding agreement, and
    // scoring is SELF-SERVE (the founder runs it from /scoring / the Lab) once the workspace opens. Promise what the
    // system actually does. (founder_journey_guards.test.mjs greps RegisterPage.jsx for timed-SLA copy.)
    desc: "Creating an account is free. Your founder workspace (Validate, Build, Raise and Grow, with self-serve venture scoring) opens once the Axal team has reviewed your profile and you have signed the membership agreement. No password to remember; we'll email you a secure link.",
  },
});

/**
 * #4578 (D4578): what the steps after this page are, as the Worker runs them. `POST /api/auth/register` creates the
 * account at once (role `exploring`); the Axal team reviews the membership and sends a membership agreement; only once
 * that agreement is signed does an admin give the account its role, and the role (not a plan) is what opens a member
 * workspace, Grow included. Nothing here is a timing promise.
 */
export const MEMBERSHIP_STEPS = 'Your account is created as soon as you confirm your email. The Axal team then reviews your membership and sends a membership agreement to sign; your workspace opens once it is signed.';

/**
 * The register page's email actions. A new account's link is not a sign-in link: the email says "Finish creating your
 * Axal VC account" (`auth_signup_link`), so the page says the same. A returning address (409 on register) keeps the
 * sign-in wording, because that is the email it gets.
 */
export const REGISTER_ACTIONS = Object.freeze({
  submit: 'Email me a link to create my account',
  sending: 'Sending link…',
  sentSignup: "We've sent a link to finish creating your account to",
  sentSignin: "This email already has an account. We've sent a sign-in link to",
  resendSignup: 'Resend the link',
  resendSignin: 'Resend sign-in link',
});

/** The lane → the role the Worker's register route takes; `lp` folds into investor, and an advisor sends none. */
export const LANE_ROLE = Object.freeze({ partner: 'partner', investor: 'investor', lp: 'investor', founder: 'founder', advisor: undefined });

/** The heading and the line under it: the chosen plan when one is ready, else the audience's own words. */
export function registerHeading(lane, selection) {
  const own = lane && LANE_COPY[lane] ? LANE_COPY[lane] : null;
  const title = selection?.state === 'ready' ? `Create your account to get ${selection.name}` : own?.title || 'Create Your Account';
  const desc = own?.desc || "Creating an account is free. Your membership is reviewed before your workspace opens. No password to remember — we'll email you a secure link.";
  return { title, desc };
}
