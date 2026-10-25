/**
 * D786 (#2211) — the data layer for /pricing's five tabs (D785 D-a, D-b):
 * Founder, Investor, Advisors, Operating Partners and Models.
 *
 * Pure but for `useLandingTab`. The role tabs read the public plans
 * (`GET /api/public/plans-and-packs`, the catalogue mirror a visitor may read;
 * `/api/catalog` needs sign-in) and keep the plans of their family. A role
 * the catalogue sells no plan says so (`{ none: true }`) and never shows an
 * invented one (D783: top up AI tokens as you go). The Models tab reads
 * `GET /api/public/ai/models`. Part 2 draws both to the "Pricing" canvas.
 */
import { useViewMode } from '../contexts/ViewModeContext';

/** The switch's tabs, in the canvas's order: `key` is `?for=`, `family` the plans' family (`aiCredits.planOf`). */
export const PRICING_TABS = Object.freeze([
  { key: 'founder', label: 'Founder', family: 'founder' },
  { key: 'investor', label: 'Investor', family: 'investor' },
  { key: 'advisor', label: 'Advisors', family: 'advisor' },
  { key: 'operating-partner', label: 'Operating Partners', family: 'partner' },
  { key: 'models', label: 'Models', family: null },
]);
const KEYS = new Set(PRICING_TABS.map((t) => t.key));

/** What a role with no plan reads (D783). */
export const NO_PLAN_LINE = 'No plan: top up AI tokens as you go';

/** `?for=` when it names a tab, else null. */
export function tabFromSearch(search) {
  const value = new URLSearchParams(String(search || '')).get('for');
  return value && KEYS.has(value) ? value : null;
}

/** The tab a role lands on: its own, an Operating Partner's for `partner`; anyone else, and a visitor, on Founder. */
export function landingTab(shellRole) {
  if (shellRole === 'investor') return 'investor';
  if (shellRole === 'advisor') return 'advisor';
  if (shellRole === 'partner') return 'operating-partner';
  return 'founder';
}

/** `?for=` first, else the role's landing tab. */
export const initialTab = (search, shellRole) => tabFromSearch(search) ?? landingTab(shellRole);

/** The landing tab for whoever is viewing: `useViewMode().shellRole`, null for a visitor. */
export function useLandingTab() {
  return landingTab(useViewMode()?.shellRole ?? null);
}

/**
 * A role tab from the public plans read: `{ plans }` for its family, in the
 * read's order (free first), or `{ none: true }` when the catalogue sells that
 * role no plan. `{ unreadable: true }` when the read is not the plans' shape.
 */
export function roleTab(read, tab) {
  const family = PRICING_TABS.find((t) => t.key === tab)?.family;
  if (!family) return { unreadable: true };
  if (!read || !Array.isArray(read.plans)) return { unreadable: true };
  const plans = read.plans.filter((p) => p && p.family === family);
  return plans.length ? { plans } : { none: true, line: NO_PLAN_LINE };
}

/** The Models tab: the models as the Worker sends them, or `{ unreadable: true }`. */
export function modelsTab(read) {
  if (!read || !Array.isArray(read.models)) return { unreadable: true };
  return { models: read.models.filter((m) => m && typeof m.id === 'string') };
}

// ─────────────────────────────────────────────── part 2: what the page draws ──
// D786 (#2211) part 2. The cards join the canvas's copy (`sitePricing.js`) to
// the catalogue read: every figure is the read's, a plan the catalogue does
// not sell is "Not offered yet", and a yearly price it does not hold is
// "Yearly not offered yet" — never a computed one (the owner, 2026-10-20).

/** Whole dollars for a whole amount, else two decimals: 2000 → "$20", 142800 → "$1,428", 1975 → "$19.75". */
export function usd(cents) {
  if (!Number.isFinite(cents)) return null;
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}

/**
 * A plan's price for one interval (`month` | `year`), or null. D816 (#2262)
 * gives each plan `monthly` and `yearly` (null when the catalogue has none);
 * a read from before it is searched in `prices` for one charged every 1.
 */
export function priceOf(plan, interval) {
  const key = interval === 'month' ? 'monthly' : interval === 'year' ? 'yearly' : null;
  if (key && plan && key in plan) {
    const own = plan[key];
    return own && Number.isSafeInteger(own.unit_amount) ? { ...own, interval, interval_count: 1 } : null;
  }
  const prices = Array.isArray(plan?.prices) ? plan.prices : [];
  return prices.find((p) => p && p.interval === interval && (p.interval_count ?? 1) === 1 && Number.isSafeInteger(p.unit_amount)) ?? null;
}

/**
 * "Save n%" for a tab, never typed: each plan's `yearly_saving_percent`
 * (D816, computed by the Worker from its two prices), or the same sum here
 * for a read from before it. Null when no plan saves; "Save up to n%" when
 * the plans differ.
 */
export function yearlySaving(plans) {
  const pcts = (plans || []).map((p) => {
    if (p && 'yearly_saving_percent' in p) return p.yearly_saving_percent;
    const m = priceOf(p, 'month'); const y = priceOf(p, 'year');
    if (!m || !y || m.unit_amount <= 0) return null;
    return Math.round(100 * (1 - y.unit_amount / (12 * m.unit_amount)));
  }).filter((n) => Number.isFinite(n) && n > 0);
  if (!pcts.length) return null;
  const max = Math.max(...pcts);
  return Math.min(...pcts) === max ? `Save ${max}%` : `Save up to ${max}%`;
}

/** Statuses that hold a plan: PersonaBillingPanel's rule for "subscribed". */
export const HOLDS_PLAN = new Set(['active', 'trialing', 'past_due']);
/** The tabs whose plan lives in `account_subscriptions`, with the role and plan group each sells to. */
export const PLAN_GROUP_TABS = Object.freeze({ advisor: { role: 'advisor', group: 'advisor' }, 'operating-partner': { role: 'partner', group: 'partner' } });

/** Whether `heldCard` needs the member's `GET /billing/plan/status` for this tab. */
export const needsPlanStatus = (user, role, tab) => !!user && PLAN_GROUP_TABS[tab]?.role === role;

/**
 * The card id a signed-in member holds on `tab`; null for a visitor or another
 * role's tab. Founders and Investors read the session's own fields. An Advisor
 * or Operating Partner pays through `account_subscriptions` (D1049, #2900), so
 * `planRead` is their `GET /billing/plan/status` as `{ status, body }`: Pro
 * when it holds a plan in their group, Basic when it holds none, and nothing
 * marked while it is reading or could not be read.
 */
export function heldCard(user, role, tab, planRead = null) {
  if (!user) return null;
  if (tab === 'founder' && role === 'founder') {
    const t = String(user.subscription_tier || 'free').toLowerCase();
    return ['free', 'growth', 'studio'].includes(t) ? t : null;
  }
  if (tab === 'investor' && role === 'investor') {
    const t = String(user.investor_tier || 'free').toLowerCase();
    return ['free', 'professional', 'institutional'].includes(t) ? t : null;
  }
  const g = PLAN_GROUP_TABS[tab];
  if (g && g.role === role) {
    if (!planRead || planRead.status !== 'ready') return null;
    const b = planRead.body || {};
    return b.plan_group === g.group && HOLDS_PLAN.has(String(b.status || '').toLowerCase()) ? 'pro' : 'free';
  }
  return null;
}

/** Every checkout refusal ends here: nothing is charged before the member reaches Stripe's page. */
export const NOT_CHARGED = 'You were not charged.';
/**
 * The paywall's in-page line when a checkout could not open (D1049): it says
 * money did not move, and never shows a raw Stripe or Worker code.
 */
export function checkoutRefusal(err) {
  const code = err?.code || null;
  if (code === 'stripe_not_configured' || code === 'catalog_price_missing') return `Checkout is not open for this plan yet. ${NOT_CHARGED}`;
  if (code === 'investor_only') return `This plan is for investor accounts. ${NOT_CHARGED}`;
  if (code === 'timeout' || Number(err?.status) >= 500) return `Checkout could not be reached. ${NOT_CHARGED} Try again.`;
  return `Checkout could not start. ${NOT_CHARGED} Try again.`;
}

const REGISTER = (lane) => (lane ? `/register?lane=${lane}` : '/register');

/**
 * A role tab's cards: `{ cards, saving }`, or `{ unreadable: true }` when the
 * read failed. `specs` are the canvas's cards for the tab, `billing` is
 * `monthly` | `yearly`, `held` the card id the member holds, `signedIn` whether
 * anyone is.
 */
export function planCards(read, specs, { billing = 'monthly', held = null, signedIn = false } = {}) {
  if (!read || !Array.isArray(read.plans)) return { unreadable: true };
  const yearly = billing === 'yearly';
  const sold = [];
  const cards = (specs || []).map((spec, i) => {
    const plan = !spec.free && !spec.custom && spec.match ? read.plans.find((p) => p && p.licence_key === spec.match && !p.free) ?? null : null;
    const month = plan ? priceOf(plan, 'month') : null;
    const year = plan ? priceOf(plan, 'year') : null;
    if (plan && (month || year)) sold.push(plan);
    const offered = !!(spec.free || spec.custom || month || year);
    const current = held !== null && held === spec.id;
    const card = {
      id: spec.id, name: spec.name, kick: spec.kick || '', tag: spec.tag, highlight: !!spec.highlight, current,
      lead: i > 0 ? `Everything in ${specs[i - 1].name}, plus:` : '',
      feats: spec.feats.slice(), offered, price: null, unit: '', note: '', yearlyMissing: false,
      button: { label: '', to: null, disabled: false },
    };
    if (spec.free) {
      card.price = spec.id === 'free' && spec.name === 'Free' ? 'Free' : '$0';
      card.unit = card.price === 'Free' ? '' : '/ month';
    } else if (spec.custom) {
      card.price = 'Custom';
      card.note = 'Pricing agreed with our sales team';
    } else if (offered) {
      const shown = yearly && year ? year : month ?? year;
      if (shown.interval === 'year') {
        card.price = usd(Math.round(shown.unit_amount / 12));
        card.note = `${usd(shown.unit_amount)} billed yearly`;
      } else {
        card.price = usd(shown.unit_amount);
        if (yearly) { card.yearlyMissing = true; card.note = 'Yearly not offered yet'; }
      }
      card.unit = '/ month';
      if (shown.allowance_microusd > 0) card.feats.push(`${usd(Math.floor(shown.allowance_microusd / 10_000))} of AI tokens a month`);
    }
    if (current) card.button = { label: 'Current plan', to: null, disabled: true };
    else if (!offered) card.button = { label: 'Not offered yet', to: null, disabled: true };
    else if (spec.custom) card.button = { label: spec.cta || 'Contact Sales', to: '/contact', disabled: false };
    else if (!signedIn) card.button = { label: spec.cta || 'Get started', to: REGISTER(spec.lane), disabled: false };
    else if (spec.free) card.button = { label: held ? 'Manage plan' : 'Get started', to: held ? '/account/billing' : REGISTER(spec.lane), disabled: false };
    else card.button = { label: held ? 'Upgrade' : spec.cta || 'Get started', to: `/pricing/products/${encodeURIComponent(plan.product_id)}`, disabled: false };
    return card;
  });
  return { cards, saving: yearlySaving(sold), sells: sold.length > 0 };
}

/** A comparison cell: 1 a tick, 0 a dash, words as they are. */
export const compareCell = (v) => ({ tick: v === 1, dash: v === 0, text: typeof v === 'string' ? v : '' });

/** The Models tab's price columns for a model: up to two `{ label, value }`, each a billed unit price. */
export function modelPrices(m) {
  const billed = m?.billed || {};
  const words = m?.unit_words || {};
  const order = ['tokens_in', 'tokens_out', 'tokens_cached', 'audio_minutes', 'audio_minutes_websocket', 'characters', 'images', 'tiles', 'steps'];
  const units = [...order.filter((u) => u in billed), ...Object.keys(billed).filter((u) => !order.includes(u))];
  return units.map((u) => ({ unit: u, label: words[u] || u, value: unitPrice(billed[u]) }));
}

/** A billed unit price: at least three significant figures, never rounded to $0.00. */
export function unitPrice(v) {
  if (!Number.isFinite(v)) return null;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v === 0) return '$0';
  return `$${v.toPrecision(3)}`;
}

/** The models in the canvas's groups and order; a group with no model is left out. */
export function modelGroups(models, groups) {
  const by = new Map(groups.map((g) => [g, []]));
  for (const m of models || []) (by.get(m.group) ?? by.get(groups[0])).push(m);
  return groups.map((t) => ({ t, rows: by.get(t) })).filter((g) => g.rows.length);
}

/** The packs strip from the read: price, what it buys, and its live offer, if any. */
export function packCards(read) {
  const packs = Array.isArray(read?.packs) ? read.packs : [];
  return packs.filter((p) => Number.isSafeInteger(p?.unit_amount)).map((p) => {
    const bonusPct = p.bonus_microusd > 0 && p.credit_microusd > 0 ? Math.round((100 * p.bonus_microusd) / p.credit_microusd) : 0;
    const ends = bonusPct && p.offer_ends_at ? new Date(p.offer_ends_at) : null;
    const until = ends && !Number.isNaN(ends.getTime()) ? ` until ${ends.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : '';
    const offers = [bonusPct ? `+${bonusPct}% bonus${until}` : '', p.first_purchase_only ? 'First purchase only' : ''].filter(Boolean);
    return { uid: p.uid, price: usd(p.unit_amount), use: `${usd(Math.floor(p.credit_microusd / 10_000))} of AI use`, offers };
  });
}
