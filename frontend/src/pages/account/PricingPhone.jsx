import { aiBudgetApi } from '../../lib/api/aiBudget';
import { FOUNDER_TIERS, INVESTOR_TIERS } from '../../data/pricing';
import { useAccountRead } from './AccountCenter';
import { useBillingStatus } from './AccountBilling';
import { AccountPhonePage, phonePending } from './AccountPhonePage';
import { ACCOUNT_PHONE_PAGES, ACCOUNT_PHONE_COPY } from './accountPhone';
import { budgetReadable, microUsd, topUpState } from './usageModel';
import { ADD_TOKENS_PATH, TOKENS_LINE, TOPUP_UNAVAILABLE_RUNS } from '../../lib/aiTokens';

/**
 * D700 (#1662) — A10m, `/plans-and-pricing` on a phone. It lives apart from
 * `ProductsPage.jsx` because that page loads Stripe's key at import, so a
 * test could not render this view from there.
 */

const TIERS_FOR = { founder: FOUNDER_TIERS, investor: INVESTOR_TIERS };
const priceOf = (t) => (t.priceMonthly ? `$${t.priceMonthly} / month` : '$0');
// D755 (#1916): the tokens line, the sentence and the path live in lib/aiTokens.js.
export { TOKENS_LINE } from '../../lib/aiTokens';

/** " · AI $1.00 a day, $5.00 a month", from the member's own `/ai-budget/me`; '' when it says neither. */
function aiLine(budget) {
  const b = budget?.status === 'ready' && budgetReadable(budget.data) ? budget.data : null;
  if (!b) return '';
  const parts = [];
  if (b.daily_microusd > 0) parts.push(`${microUsd(b.daily_microusd)} a day`);
  if (b.monthly_microusd > 0) parts.push(`${microUsd(b.monthly_microusd)} a month`);
  return parts.length ? ` · AI ${parts.join(', ')}` : '';
}

/**
 * A10m's sections. Plans lists the role's tiers (founders and investors; no
 * other role has a tier ladder, so it gets no Plans section). The current
 * tier, from the billing status, is the row whose price is a violet pill,
 * and only that row carries the AI allowance, because `/ai-budget/me` answers
 * for the member's own plan alone (decision 10). Tokens offers Add tokens
 * only when a top-up product is configured.
 */
export function pricingPhoneGroups({ role, billing, budget, product }) {
  const [plansTitle, tokensTitle] = ACCOUNT_PHONE_PAGES.pricing.sections;
  const groups = [];
  const tiers = TIERS_FOR[String(role || '').toLowerCase()];
  if (tiers) {
    const current = billing.status === 'ready' ? String(billing.data?.tier || 'free').toLowerCase() : null;
    groups.push({
      label: plansTitle,
      testid: 'pricing-phone-plans',
      rows: tiers.map((t) => (t.id === current
        ? { key: t.id, title: t.name, description: `${t.tagline}${aiLine(budget)}`, pill: { label: priceOf(t), tone: 'info' }, testid: 'pricing-phone-current' }
        : { key: t.id, title: t.name, description: t.tagline, value: priceOf(t), testid: 'pricing-phone-tier' })),
      cta: { label: 'Manage plan', to: '/account/billing', testid: 'pricing-phone-manage' },
      note: billing.status === 'ready' ? null : phonePending(billing.status, 'Your plan', 'The plans above are unaffected.', billing.reload),
    });
  }
  const topUp = product.status === 'ready' ? topUpState(product.data) : product.status;
  const tokens = { label: tokensTitle, testid: 'pricing-phone-tokens', rows: [{ title: 'Past your allowance', description: TOKENS_LINE, testid: 'pricing-phone-tokens-row' }] };
  if (topUp === 'available') Object.assign(tokens.rows[0], { pill: { label: ACCOUNT_PHONE_COPY.addTokens, tone: 'info' }, href: ADD_TOKENS_PATH });
  else if (topUp === 'unavailable') tokens.note = TOPUP_UNAVAILABLE_RUNS;
  else tokens.note = phonePending(topUp === 'loading' ? 'loading' : 'unreadable', 'The top-up option', 'Your allowance is unaffected.', product.reload);
  groups.push(tokens);
  return groups;
}

/** A10m — the bar and the sections, then `children`: the catalogue, the cart, the promo box and active licences. */
export function PricingPhoneView({ role, billing, budget, product, children = null }) {
  return (
    <AccountPhonePage pageKey="pricing" testid="pricing-phone" groups={pricingPhoneGroups({ role, billing, budget, product })}>
      {children}
    </AccountPhonePage>
  );
}

/** The view with its three reads, all for the member's own account. Mounted only on a phone, so the desktop makes none of them. */
export default function PricingPhone({ role, children = null }) {
  const billing = useBillingStatus(role);
  const budget = useAccountRead(() => aiBudgetApi.mine());
  const product = useAccountRead(() => aiBudgetApi.topUp());
  return <PricingPhoneView role={role} billing={billing} budget={budget} product={product}>{children}</PricingPhoneView>;
}
