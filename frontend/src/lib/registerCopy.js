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
    desc: "Creating an account is free — no password to remember, we'll email you a secure link. Your partner membership and profile are reviewed before deals open.",
  },
  // #6983 (X1): the investor page's own lane. No claim about deals or evidence.
  investor: {
    title: 'Create your investor account',
    desc: 'Creating an account is free. Your membership is reviewed before your workspace opens.',
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
    title: 'Create your founder account',
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
export const MEMBERSHIP_STEPS = 'We create your account when you request your signup link. Confirm your email to sign in. The Axal team reviews your membership and sends an agreement to sign. After you sign it, the team enables your workspace.';

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

/**
 * D6989 (#6989): /register with `product=spinout-lab`. Applying to the Lab starts with an account, so the heading says
 * so, and the stages are the order the code allows: `POST /api/auth/register` creates the account (role `exploring`);
 * confirming the email signs the member in; `POST /api/spinout-lab/apply` takes an explorer's application at once
 * (`routes/spinout_lab.ts`: founder or exploring); the team reviews the membership and sends the agreement; once it is
 * signed an admin gives the role that opens the workspace (`MEMBERSHIP_STEPS`). No timing is promised.
 */
export const SPINOUT_LAB_PRODUCT = 'spinout-lab';
export const SPINOUT_LAB_SIGNUP = Object.freeze({
  title: 'Apply to Spin-Out Lab: start by creating your account.',
  context: 'Programme: Spin-Out Lab',
  stages: Object.freeze([
    'Create your account',
    'Confirm your email',
    'Complete your application',
    'Axal VC reviews your membership and sends an agreement',
    'Sign the agreement and your workspace opens',
  ]),
});

/**
 * The heading and the line under it: the chosen plan when one is ready, else the Lab's heading when the sign-up is
 * for it, else the audience's own words. The line under it is always the lane's.
 */
export function registerHeading(lane, selection, product = null) {
  const own = lane && LANE_COPY[lane] ? LANE_COPY[lane] : null;
  const lab = product === SPINOUT_LAB_PRODUCT ? SPINOUT_LAB_SIGNUP.title : null;
  const title = selection?.state === 'ready' ? `Create your account to get ${selection.name}` : lab || own?.title || 'Create Your Account';
  const desc = own?.desc || "Creating an account is free. Your membership is reviewed before your workspace opens. No password to remember — we'll email you a secure link.";
  return { title, desc };
}

/**
 * #6984 (X2): how long a lane chosen on an earlier visit is kept. `gvpn:intent` is `{ lane, ts }`; an entry older than
 * this, or one with no `ts` (written before the timestamp was read), is expired and not used.
 */
export const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

/** The lane this visit signs up under: the address's lane always wins; else a stored lane under 24 hours old; else none. */
export function laneForVisit(search, saved, now = Date.now()) {
  const fromUrl = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('lane');
  if (fromUrl && LANES.includes(fromUrl)) return { lane: fromUrl, store: true };
  const ts = saved && typeof saved === 'object' ? saved.ts : null;
  const fresh = typeof ts === 'number' && Number.isFinite(ts) && ts <= now && now - ts < INTENT_TTL_MS;
  return { lane: fresh && LANES.includes(saved.lane) ? saved.lane : null, store: false };
}

/** #6984 (X2): who the context line says is signing up, by lane. */
export const LANE_SIGNUP_ROLE = Object.freeze({ founder: 'a founder', investor: 'an investor', lp: 'an LP', partner: 'an operating partner', advisor: 'an advisor' });

/**
 * The one context line above the form: the role, and the plan only when the catalogue read returned it (`state:
 * 'ready'`); a plan that is not offered, or could not be read, is never named here. Null when there is nothing to say.
 */
export function registerContextLine(lane, selection) {
  const role = lane && LANE_SIGNUP_ROLE[lane] ? `You are signing up as ${LANE_SIGNUP_ROLE[lane]}.` : '';
  const plan = selection?.state === 'ready' && selection.name ? `Plan: ${selection.name}, ${selection.interval === 'yearly' ? 'yearly' : 'monthly'}.` : '';
  const line = [role, plan].filter(Boolean).join(' ');
  return line || null;
}
