/**
 * Task #4 (ID) — Pricing surface data file.
 *
 * Single source of truth for the public /pricing page. Tier feature
 * lists are imported directly from `PaywallModal.TIER_PLANS` so the
 * in-app paywall and this page never drift — change the bullet list
 * in one place (PaywallModal) and both surfaces update.
 *
 * Local additions in this file:
 *   - the FREE tier (paywall only renders paid tiers)
 *   - annual price equivalents (paywall shows monthly only)
 *   - taglines, CTAs, FAQ — marketing copy that doesn't belong in
 *     the in-app paywall.
 */
import { TIER_PLANS } from '../components/PaywallModal';

function tierFromPlan(id, extra) {
  const plan = TIER_PLANS[id];
  if (!plan) throw new Error(`Unknown tier id: ${id}`);
  const priceMonthly = Number(String(plan.price).replace(/[^0-9.]/g, '')) || 0;
  return {
    id,
    name: plan.label,
    priceMonthly,
    priceAnnual: extra.priceAnnual,
    tagline: plan.blurb,
    features: plan.features.slice(),
    cta: extra.cta,
    highlight: extra.highlight || false,
  };
}

export const FOUNDER_TIERS = [
  {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceAnnual: 0,
    tagline: 'Validate one idea end-to-end.',
    features: [
      '1 active startup',
      'Spin-Out Lab — 4-week sprint',
      'Public profile + referral link',
      'Community support',
    ],
    cta: { label: 'Start free', to: '/register?plan=free' },
  },
  tierFromPlan('growth', {
    priceAnnual: 65,
    highlight: true,
    cta: { label: 'Start 14-day trial', to: '/register?plan=growth' },
  }),
  tierFromPlan('studio', {
    priceAnnual: 199,
    cta: { label: 'Start 14-day trial', to: '/register?plan=studio' },
  }),
];

export const INVESTOR_TIERS = [
  {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceAnnual: 0,
    tagline: 'Browse deals & follow founders.',
    features: [
      'Public deal index',
      'Watch up to 10 companies',
      'Market intel pulses (read-only)',
      'Community office hours',
    ],
    cta: { label: 'Sign up', to: '/register?plan=investor_free' },
  },
  tierFromPlan('professional', {
    priceAnnual: 119,
    highlight: true,
    cta: { label: 'Start 14-day trial', to: '/register?plan=professional' },
  }),
  tierFromPlan('institutional', {
    priceAnnual: 479,
    cta: { label: 'Talk to sales', to: '/demo?topic=investor' },
  }),
];

export const PRICING_FAQ = [
  {
    q: 'Can I switch plans later?',
    a: 'Yes — upgrades take effect immediately and we prorate the first invoice. Downgrades take effect at the end of the current billing period.',
  },
  {
    q: 'Do you offer annual billing?',
    a: 'Yes — annual billing saves roughly 20% on every paid tier. You can flip between monthly and annual anytime from Settings → Billing.',
  },
  {
    q: 'What happens after the 14-day trial?',
    a: 'Your account converts to the tier you selected. You can cancel inside the trial with one click and pay nothing.',
  },
  {
    q: 'Are there discounts for venture studios or accelerators?',
    a: 'Yes — programs supporting 5+ founders qualify for our Studio Partner program. Reach out via the demo page.',
  },
  {
    q: 'Where is my data stored?',
    a: 'In Cloudflare D1 (US East). At-rest encryption is enabled on every column that holds personal data. See our Trust Center for details.',
  },
];

export function tierSchemaOffer(tier, audience) {
  return {
    '@type': 'Offer',
    name: `${tier.name} — ${audience}`,
    description: tier.tagline,
    price: tier.priceMonthly,
    priceCurrency: 'USD',
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: tier.priceMonthly,
      priceCurrency: 'USD',
      unitText: 'MONTH',
    },
    eligibleCustomerType: audience,
    availability: 'https://schema.org/InStock',
  };
}
