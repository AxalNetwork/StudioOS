/**
 * D1054 (#2905, part 6 of #2451) — opening the checkout sheet from anywhere in
 * the app, and the renewal banner's model. No React here, so `node --test`
 * loads it alone.
 *
 * `openCheckout({ plan_key, interval, from })` asks the one `CheckoutHost`
 * (mounted in the signed-in shell, App.jsx) to open D1048's sheet over the
 * current page, with no route change. Every entry calls it: the paywall,
 * Billing's Change plan, Usage › Limits' Upgrade and each "Get …" or Upgrade
 * outside Pricing. `from` is the page the member was on (`{ label, href }`):
 * the Accepted view offers "Back to [label]" (PAYX7b).
 */

export const CHECKOUT_EVENT = 'studioos:checkout_open';

/** Opens the sheet on a catalogue key (`founder:studio`, `advisor:pro`, …). False when there is no window or no key. */
export function openCheckout({ plan_key, interval = 'monthly', from = null, unlocks = null } = {}) {
  if (typeof window === 'undefined' || typeof plan_key !== 'string' || !plan_key) return false;
  const detail = {
    plan_key,
    interval: interval === 'yearly' ? 'yearly' : 'monthly',
    from: from && typeof from.label === 'string' && typeof from.href === 'string' && from.href.startsWith('/') ? { label: from.label, href: from.href } : null,
    unlocks: typeof unlocks === 'string' && unlocks ? unlocks : null,
  };
  window.dispatchEvent(new CustomEvent(CHECKOUT_EVENT, { detail }));
  return true;
}

/**
 * The plans-read row for a catalogue key. A plan with no product (Investor
 * Plus, Institutional without one) is drawn from the read's own catalogue
 * entry, with no price, so the sheet says why it is not sold instead of
 * guessing one. Null when the key is not in the read at all.
 */
export function planForKey(data, key) {
  if (!data || !key) return null;
  const plans = Array.isArray(data.plans) ? data.plans : [];
  const row = plans.find((p) => p && p.free !== true && p.catalogue?.key === key);
  if (row) return row;
  const cat = (Array.isArray(data.catalogue) ? data.catalogue : []).find((c) => c && c.key === key);
  if (!cat) return null;
  const { family, licence_key, matches, ...fields } = cat;
  return { family, licence_key, product_id: null, plan_name: cat.label || null, free: false, prices: [], monthly: null, yearly: null, yearly_saving_percent: null, catalogue: fields };
}

/** The Pricing tab a family's plans are on, for `heldCard`. */
export const TAB_OF_FAMILY = Object.freeze({ founder: 'founder', investor: 'investor', advisor: 'advisor', partner: 'operating-partner' });

/** The family a catalogue key belongs to, or null. */
export const familyOfKey = (key) => (typeof key === 'string' && /^(founder|investor|advisor|partner):/.test(key) ? key.split(':')[0] : null);

/**
 * The plan an Upgrade offers a member, by profile and what they hold: the
 * next sold plan up, or null when there is none to offer here (the top plan,
 * staff, an Explorer, or a plan not read).
 */
const LADDER = Object.freeze({
  founder: { free: 'founder:growth', growth: 'founder:studio' },
  // D1334: Investor Plus sits between Basic and Pro.
  investor: { free: 'investor:plus', plus: 'investor:professional' },
  advisor: { free: 'advisor:pro' },
  partner: { free: 'partner:pro' },
});
export function nextPlanKey(role, held) {
  const steps = LADDER[String(role || '').toLowerCase()];
  if (!steps || held == null) return null;
  return steps[String(held).toLowerCase()] || null;
}

/**
 * Billing's Change plan (PAYX11): the plan it opens the sheet on. Up the
 * ladder, or the Founder's Raise + Grow down to Validate + Build; null when
 * there is no other plan sold here (Investor Pro: Institutional is sales';
 * a Pro Advisor or Operating Partner), and Billing offers Compare plans.
 */
export function changePlanKey(role, held) {
  const r = String(role || '').toLowerCase();
  if (r === 'founder' && String(held) === 'studio') return 'founder:growth';
  return nextPlanKey(r, held);
}

/** What a member holds, from their role's billing status read (`tier`, or a plan group's status). */
const PAID = new Set(['active', 'trialing', 'past_due']);
export function heldOfStatus(role, status) {
  if (!status || typeof status !== 'object') return null;
  const r = String(role || '').toLowerCase();
  if (r === 'founder' || r === 'investor') return String(status.tier || 'free').toLowerCase();
  if (r === 'advisor' || r === 'partner') {
    return status.plan_group === r && PAID.has(String(status.status || '').toLowerCase()) ? 'pro' : 'free';
  }
  return null;
}

/** A tier code a 402 or a lock names (`growth`, `studio`, `plus`, `professional`, `institutional`) as its catalogue key, or null. */
export function planKeyOfTier(tier) {
  const t = String(tier || '').toLowerCase().replace(/^investor_/, '');
  if (t === 'growth' || t === 'studio') return `founder:${t}`;
  if (t === 'plus' || t === 'professional' || t === 'institutional') return `investor:${t}`;
  return null;
}

/** The roles that hold no plan (PAYX16). A licence administrator is staff too. */
export const STAFF_ROLES = new Set(['admin', 'super_admin', 'branch_admin']);

// ─────────────────────────────────────────────── PAYX10, the renewal banner

/**
 * The banner over the app for the member's open billing alerts
 * (`GET /api/billing/alerts`, D1133), in the canvas's words:
 *   - `failed`  a renewal that did not go through, with a retry date: Update card, Pay now;
 *   - `confirm` the bank asks the member to confirm the payment: Confirm payment;
 *   - `ended`   Stripe stopped retrying (the subscription is unpaid, `next_attempt_at`
 *               cleared): the plan is off. Pay now settles the open invoice, which
 *               turns it back on; Open Billing shows the rest.
 * A dispute is HQ's to answer and draws no banner. One banner at a time: the
 * most urgent alert, then the newest.
 */
const PRIORITY = { confirm: 0, failed: 1, ended: 2 };
const FAMILY_WORD = { founder: 'your Founder plan', investor: 'your Investor plan', advisor: 'Advisor Pro', partner: 'Operating Partner Pro' };

const day = (at) => {
  if (at == null || at === '') return null;
  const d = typeof at === 'number' ? new Date(at * 1000) : new Date(String(at));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

export function bannerKind(alert) {
  if (!alert) return null;
  if (alert.kind === 'needs_confirmation') return alert.can_confirm === false ? null : 'confirm';
  if (alert.kind === 'payment_failed') return alert.next_attempt_at ? 'failed' : 'ended';
  return null;
}

export function bannerView(alerts) {
  const list = (Array.isArray(alerts) ? alerts : []).map((a) => ({ a, kind: bannerKind(a) })).filter((x) => x.kind);
  if (!list.length) return null;
  list.sort((x, y) => PRIORITY[x.kind] - PRIORITY[y.kind] || String(y.a.updated_at || y.a.created_at || '').localeCompare(String(x.a.updated_at || x.a.created_at || '')));
  const { a, kind } = list[0];
  const plan = FAMILY_WORD[a.plan_family] || 'your plan';
  const failedOn = day(a.updated_at || a.created_at);
  const next = day(a.next_attempt_at);
  if (kind === 'confirm') {
    return { kind, alert: a, title: 'Confirm your payment', line: `Your bank needs you to confirm the payment for ${plan}.`, actions: ['confirm'] };
  }
  if (kind === 'failed') {
    return {
      kind, alert: a, title: 'Your payment didn’t go through',
      line: `Your payment for ${plan}${failedOn ? ` on ${failedOn}` : ''} didn’t go through. We’ll try again${next ? ` on ${next}` : ''}.`,
      actions: ['update', 'pay'],
    };
  }
  return {
    kind, alert: a, title: 'Your plan has ended',
    line: `${plan.charAt(0).toUpperCase()}${plan.slice(1)} ended because the payment didn’t go through. You’re on Free. Nothing was deleted.`,
    actions: ['pay', 'billing'],
  };
}

export const BANNER_ACTION = Object.freeze({ update: 'Update card', pay: 'Pay now', confirm: 'Confirm payment', billing: 'Open Billing' });

/** Dismiss hides the banner for today only: the key names the alert, its state and the UTC day. */
export function dismissKey(view, now = new Date()) {
  if (!view?.alert) return null;
  return `axal:renewal-banner:${view.alert.id}:${view.kind}:${now.toISOString().slice(0, 10)}`;
}

// ─────────────────────────────────────────────── PAYX11, Billing's plan card

const longDay = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null;
};

/** A catalog product's plan key (D1050's catalogue), from its Stripe metadata, or null. */
export function planKeyOfProduct(p) {
  const m = p?.metadata || {};
  if (m.tier === 'growth' || m.tier === 'studio') return `founder:${m.tier}`;
  if (m.investor_tier === 'plus' || m.investor_tier === 'professional' || m.investor_tier === 'institutional') return `investor:${m.investor_tier}`;
  return null;
}

/** PAYX11: the Cancel dialog's words, and the cancelled card's. A date not read says so, never a guess. */
export function cancelWords(sub, planName) {
  const name = planName || 'your plan';
  const until = longDay(sub?.current_period_end);
  const ends = longDay(sub?.cancel_at || sub?.current_period_end);
  const on = longDay(sub?.canceled_at);
  return {
    title: `Cancel ${name}?`,
    line: `It stays on until ${until || 'the end of your paid period'}. After that you’re on Free, and the plan’s limits apply. Your files stay.`,
    pill: ends ? `Ends ${ends}` : 'Ends at period end',
    cancelled: `${on ? `Cancelled on ${on}. ` : ''}You’re on Free from ${ends || 'the end of your paid period'}. Files stay.`,
  };
}
