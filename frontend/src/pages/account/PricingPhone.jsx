import { aiBudgetApi } from '../../lib/api/aiBudget';
import { publicPricingApi } from '../../lib/api/publicPricing';
import { useAccountRead } from './AccountCenter';
import { AccountPhonePage, phonePending } from './AccountPhonePage';
import { ACCOUNT_PHONE_PAGES, ACCOUNT_PHONE_COPY } from './accountPhone';
import { topUpState } from './usageModel';
import { ADD_TOKENS_PATH, TOKENS_LINE, TOPUP_UNAVAILABLE_RUNS } from '../../lib/aiTokens';
import { phonePlans, planAi, YOUR_PLAN } from '../../lib/plansPricing';

/**
 * D700 (#1662) — A10m, `/pricing/products` on a phone (D786; `/plans-and-pricing` until then). It lives apart from
 * `ProductsPage.jsx` because that page loads Stripe's key at import, so a
 * test could not render this view from there.
 *
 * D755 §11 (#1915): the Plans rows are the public plans-and-packs read's, not
 * `data/pricing.js`: every family (Founder, Investor, Advisor, Operating
 * Partner, Market Intelligence Pro, Exploring or other), each row with its
 * price from the Stripe catalog's mirror and its own AI allowance.
 */

// D755 (#1916): the tokens line, the sentence and the path live in lib/aiTokens.js.
export { TOKENS_LINE } from '../../lib/aiTokens';

/**
 * A10m's sections. Plans lists every plan in the read, families in §11's
 * order; each row carries its price and its AI allowance, and the member's
 * plan (the licence `/ai-budget/me` names) is the row whose price is a violet
 * pill, under "Your plan". Tokens offers Add tokens only when a top-up product
 * is configured.
 */
export function pricingPhoneGroups({ pricing, budget, product }) {
  const [plansTitle, tokensTitle] = ACCOUNT_PHONE_PAGES.pricing.sections;
  const groups = [];
  const licence = budget?.status === 'ready' && typeof budget.data?.licence === 'string' ? budget.data.licence : null;
  const plans = phonePlans(pricing);
  groups.push({
    label: plansTitle,
    testid: 'pricing-phone-plans',
    rows: (plans || []).map((p) => {
      const ai = planAi(p, pricing, { licence });
      const row = { key: p.product_id || p.licence_key, title: p.title, description: ai.allowance };
      return ai.current
        ? { ...row, description: `${YOUR_PLAN} · ${ai.allowance}`, pill: { label: p.price || '—', tone: 'info' }, testid: 'pricing-phone-current' }
        : { ...row, value: p.price || '—', testid: 'pricing-phone-tier' };
    }),
    cta: { label: 'Manage plan', to: '/account/billing', testid: 'pricing-phone-manage' },
    note: plans ? null : phonePending(pricing?.status === 'loading' ? 'loading' : 'unreadable', 'The plans and their AI allowances', 'Your plan is unaffected.', pricing?.reload),
  });
  const topUp = product.status === 'ready' ? topUpState(product.data) : product.status;
  const tokens = { label: tokensTitle, testid: 'pricing-phone-tokens', rows: [{ title: 'Past your allowance', description: TOKENS_LINE, testid: 'pricing-phone-tokens-row' }] };
  if (topUp === 'available') Object.assign(tokens.rows[0], { pill: { label: ACCOUNT_PHONE_COPY.addTokens, tone: 'info' }, href: ADD_TOKENS_PATH });
  else if (topUp === 'unavailable') tokens.note = TOPUP_UNAVAILABLE_RUNS;
  else tokens.note = phonePending(topUp === 'loading' ? 'loading' : 'unreadable', 'The top-up option', 'Your allowance is unaffected.', product.reload);
  groups.push(tokens);
  return groups;
}

/** A10m — the bar and the sections, then `children`: the catalogue, the cart, the promo box and active licences. */
export function PricingPhoneView({ pricing, budget, product, children = null }) {
  return (
    <AccountPhonePage pageKey="pricing" testid="pricing-phone" groups={pricingPhoneGroups({ pricing, budget, product })}>
      {children}
    </AccountPhonePage>
  );
}

/**
 * The view with the page's two reads, `pricing` (the public plans-and-packs)
 * and `budget` (the member's own `/ai-budget/me`), handed in by ProductsPage so
 * the phone reads neither twice, plus the top-up read, mounted only on a phone.
 */
export default function PricingPhone({ pricing, budget, children = null }) {
  const product = useAccountRead(() => aiBudgetApi.topUp());
  return <PricingPhoneView pricing={pricing} budget={budget} product={product}>{children}</PricingPhoneView>;
}

/**
 * The two reads ProductsPage hands this view and its own cards. A visitor
 * (D755 §13) makes only the public one: `/ai-budget/me` needs a session.
 */
export function usePricingReads({ member = true } = {}) {
  const pricing = useAccountRead(() => publicPricingApi.plansAndPacks());
  const budget = useAccountRead(() => aiBudgetApi.mine(), { enabled: member });
  return { pricing, budget };
}
