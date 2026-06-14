/**
 * Task #4 (ID) — Public /pricing page.
 *
 * Two audience columns (Founders + Investors), three tiers each, FAQ
 * at the bottom. Tier data lives in `frontend/src/data/pricing.js` so
 * the in-app paywall and this page never drift. Schema.org Offer
 * markup is injected per tier so search engines can render rich pricing.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowLeft, Sparkles } from 'lucide-react';
import { FOUNDER_TIERS, INVESTOR_TIERS, PRICING_FAQ, tierSchemaOffer } from '../data/pricing';
import { usePageMeta, injectJsonLd } from '../lib/seo';

function TierCard({ tier, audience, billing }) {
  const price = billing === 'annual' ? tier.priceAnnual : tier.priceMonthly;
  const isFree = tier.priceMonthly === 0;
  return (
    <div
      className={`relative rounded-2xl border p-5 sm:p-6 flex flex-col bg-white ${
        tier.highlight
          ? 'border-violet-500 shadow-lg ring-1 ring-violet-500/30'
          : isFree
            ? 'border-emerald-400/70 ring-1 ring-emerald-400/20'
            : 'border-gray-200'
      }`}
      data-card
    >
      {tier.highlight && (
        <div className="absolute -top-3 left-4 sm:left-6 px-3 py-0.5 rounded-full bg-violet-600 text-white text-xs font-medium flex items-center gap-1">
          <Sparkles size={11} aria-hidden="true" /> Most popular
        </div>
      )}
      {isFree && (
        <div className="absolute -top-3 left-4 sm:left-6 px-3 py-0.5 rounded-full bg-emerald-600 text-white text-xs font-medium">
          Free forever
        </div>
      )}
      <h3 className="text-lg sm:text-xl font-bold text-gray-900">{tier.name}</h3>
      <p className="mt-1 text-sm text-gray-600 sm:min-h-[40px]">{tier.tagline}</p>
      <div className="mt-4 sm:mt-5 flex items-baseline gap-1 flex-wrap">
        <span className="text-3xl sm:text-4xl font-bold text-gray-900">${price}</span>
        <span className="text-xs sm:text-sm text-gray-500">/{billing === 'annual' ? 'mo, billed annually' : 'month'}</span>
      </div>
      <Link
        to={tier.cta.to}
        className={`mt-4 sm:mt-5 inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors ${
          tier.highlight
            ? 'bg-violet-600 hover:bg-violet-700 text-white'
            : isFree
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-gray-900 hover:bg-gray-700 text-white'
        }`}
      >
        {tier.cta.label}
      </Link>
      <ul className="mt-5 sm:mt-6 space-y-2.5">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
            <Check size={16} className="text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {/* Hidden offer label for screen readers / crawlers when JSON-LD is unavailable */}
      <span className="sr-only">
        {tier.name} for {audience} — ${tier.priceMonthly}/month USD
      </span>
    </div>
  );
}

export default function PricingPage() {
  const [billing, setBilling] = useState('monthly');

  usePageMeta({
    title: 'Pricing',
    description: 'Simple, transparent pricing for founders and investors. Start free, upgrade when you raise.',
    path: '/pricing',
  });

  useEffect(() => {
    const payload = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Axal VC StudioOS',
      description: 'Venture studio operating system — intake to portfolio monitoring.',
      offers: [
        ...FOUNDER_TIERS.map((t) => tierSchemaOffer(t, 'Founder')),
        ...INVESTOR_TIERS.map((t) => tierSchemaOffer(t, 'Investor')),
      ],
    };
    return injectJsonLd('pricing-jsonld', payload);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50/40 via-white to-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        <Link to="/" className="inline-flex items-center gap-2 text-violet-600 hover:text-violet-700 mb-6 sm:mb-8 min-h-[44px] text-sm sm:text-base">
          <ArrowLeft size={16} aria-hidden="true" /> Back to Axal VC
        </Link>

        <header className="text-center max-w-2xl mx-auto mb-8 sm:mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2 sm:mb-3">Pricing</h1>
          <p className="text-sm sm:text-base text-gray-600 px-2">
            <span className="font-semibold text-emerald-700">Start free — no card required.</span> Upgrade when you raise. Annual billing saves about 20% on every paid plan.
          </p>
          <div role="radiogroup" aria-label="Billing period" className="mt-5 sm:mt-6 inline-flex rounded-full border border-gray-200 bg-white p-1">
            {['monthly', 'annual'].map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={billing === b}
                onClick={() => setBilling(b)}
                className={`min-h-[40px] px-4 sm:px-5 rounded-full text-sm font-medium transition-colors ${
                  billing === b ? 'bg-violet-600 text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {b === 'monthly' ? 'Monthly' : 'Annual'}
              </button>
            ))}
          </div>
        </header>

        <section aria-labelledby="founder-tiers" className="mb-12 sm:mb-16">
          <h2 id="founder-tiers" className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">For founders</h2>
          <p className="text-sm text-gray-600 mb-5 sm:mb-6">From your first cold validation to your Series A.</p>
          <div className="grid md:grid-cols-3 gap-8 sm:gap-6">
            {FOUNDER_TIERS.map((t) => <TierCard key={t.id} tier={t} audience="Founder" billing={billing} />)}
          </div>
        </section>

        <section aria-labelledby="investor-tiers" className="mb-12 sm:mb-16">
          <h2 id="investor-tiers" className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">For investors</h2>
          <p className="text-sm text-gray-600 mb-5 sm:mb-6">Angels, emerging managers, and institutional funds.</p>
          <div className="grid md:grid-cols-3 gap-8 sm:gap-6">
            {INVESTOR_TIERS.map((t) => <TierCard key={t.id} tier={t} audience="Investor" billing={billing} />)}
          </div>
        </section>

        <section aria-labelledby="faq" className="max-w-3xl mx-auto">
          <h2 id="faq" className="text-xl sm:text-2xl font-bold text-gray-900 mb-5 sm:mb-6 text-center">Frequently asked</h2>
          <dl className="space-y-3 sm:space-y-4">
            {PRICING_FAQ.map((item) => (
              <div key={item.q} className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
                <dt className="font-semibold text-gray-900 mb-1 text-sm sm:text-base">{item.q}</dt>
                <dd className="text-sm text-gray-700">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
