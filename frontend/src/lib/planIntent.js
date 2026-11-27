/**
 * #4651 (Pricing audit 1/5) — the plan a visitor chose on /pricing, kept through registration.
 *
 * THE CONTRACT, traced on main before this file:
 *   - a signed-out paid card went to `/register?lane=<lane>` and said nothing of the plan or the interval; an Advisor
 *     card had no lane at all (`/register`), so registration read as the founder pitch form;
 *   - back from sign-in, Pricing already reopens the checkout sheet on `?checkout=<plan key>&interval=monthly|yearly`
 *     (D1053), and registration already keeps any same-origin `?next=` through the email link and Google (Task #1,
 *     `pendingNext.js`, consumed by RequireAuth);
 *   - checkout buys a plan of the caller's own profile family only: a new account is `exploring` until its profile
 *     is chosen, and `POST /api/billing/checkout/*` answers 403 `choose_profile` before that.
 *
 * So the only thing missing was the hand-off: the card now carries `plan`, `interval` and a `next` that is exactly the
 * Pricing return D1053 already understands. No new billing mechanism and no new state: the chosen plan lives in the
 * address and in the same `next` that survives sign-up.
 *
 * `seen` is the amount, in cents, that the card showed for that interval, so that Pricing can say plainly if the
 * price it finds on return is not the one that was chosen. Nothing here reads or writes money.
 */
import { PLAN_CARDS } from './sitePricing';
import { sanitizeNextPath } from './pendingNext';

export const INTERVALS = Object.freeze(['monthly', 'yearly']);
const PLAN_KEY = /^(founder|investor|advisor|partner):[a-z][a-z_-]{1,23}$/;
const lastWord = (iv) => (iv === 'yearly' ? 'yearly' : 'monthly');

/** The plan key of a paid card: its storage plan key, which is the catalogue's key for that plan (a test holds them equal). */
export const planKeyOfSpec = (spec) => (spec && !spec.free && !spec.custom && PLAN_KEY.test(spec.storage || '') ? spec.storage : null);

/** The paid card for a plan key, with the tab it is on, or null. */
export function specFor(planKey) {
  for (const [tab, specs] of Object.entries(PLAN_CARDS)) {
    const spec = specs.find((s) => planKeyOfSpec(s) === planKey);
    if (spec) return { tab, spec };
  }
  return null;
}

/** Where Pricing opens the checkout sheet again, once the visitor has an account (D1053): `?checkout=` and `&interval=`. */
export function pricingReturnPath({ tab, planKey, interval, seen = null }) {
  const q = new URLSearchParams();
  if (tab) q.set('for', tab);
  q.set('checkout', planKey);
  q.set('interval', lastWord(interval));
  if (Number.isSafeInteger(seen) && seen > 0) q.set('seen', String(seen));
  return `/pricing?${q.toString()}`;
}

/**
 * The register address for a card. Without a plan (a free card, or a read with no price) it is the old `?lane=` only.
 * With one it carries `plan`, `interval` and the Pricing return as `next`; a `next` that would not pass the
 * same-origin rule is left out, never half-written.
 */
export function registerPathFor({ lane = null, tab = null, planKey = null, interval = 'monthly', seen = null } = {}) {
  const q = new URLSearchParams();
  if (lane) q.set('lane', lane);
  if (planKey && PLAN_KEY.test(planKey)) {
    q.set('plan', planKey);
    q.set('interval', lastWord(interval));
    const next = pricingReturnPath({ tab, planKey, interval, seen });
    if (sanitizeNextPath(next)) q.set('next', next);
  }
  const s = q.toString();
  return s ? `/register?${s}` : '/register';
}

/** The plan and interval an address names, or null: a key or an interval that is not well formed is ignored, never guessed. */
export function planIntentFrom(search) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const planKey = q.get('plan');
  if (!planKey || !PLAN_KEY.test(planKey)) return null;
  const iv = q.get('interval');
  return { planKey, interval: INTERVALS.includes(iv) ? iv : 'monthly' };
}
