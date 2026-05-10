// Task #7 (W-2) — Investor pricing page (/pricing/investor).
//
// ROI-style comparison across the three investor tiers (Free / Professional /
// Institutional) with a Monthly ↔ Annual toggle. Yearly pricing is the same
// monthly headline number with the standard "2 months free" framing baked in
// — Stripe carries the actual price IDs (STRIPE_PRICE_INVESTOR_*_YEARLY).
//
// Checkout buttons hit `/api/billing/investor/checkout` via api.investorCheckout
// and redirect to Stripe's hosted page (or in dev, the dev-upgrade redirect).
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, Lock } from 'lucide-react';
import { api } from '../lib/api';

const PLANS = {
  free: {
    label: 'Free',
    monthly: '$0',
    yearly: '$0',
    blurb: 'Browse and try Axal — 14-day Pro trial on signup.',
  },
  professional: {
    label: 'Professional',
    monthly: '$149',
    yearly: '$1,490',
    yearlySaveBlurb: '2 months free on annual',
    blurb: 'Active investors who want full deal flow.',
  },
  institutional: {
    label: 'Institutional',
    monthly: '$599',
    yearly: '$5,990',
    yearlySaveBlurb: '2 months free on annual',
    blurb: 'Funds and family offices investing at scale.',
  },
};

const ROI_ROWS = [
  { feature: 'Pipeline browse + AI scoring',     free: '✓', pro: '✓',  inst: '✓' },
  { feature: 'Warm intros / quarter',            free: '3', pro: '25', inst: '100' },
  { feature: 'Deal rooms (concurrent)',          free: '1', pro: '5',  inst: 'Unlimited' },
  { feature: 'Calendar bookings with founders',  free: '—', pro: '✓',  inst: '✓' },
  { feature: 'Market Intelligence — read',       free: '✓', pro: '✓',  inst: '✓' },
  { feature: 'Market Intelligence — exports',    free: '—', pro: '✓',  inst: '✓' },
  { feature: 'Co-invest discovery',              free: '—', pro: '—',  inst: '✓' },
  { feature: 'Carta sync (write)',               free: '—', pro: '—',  inst: '✓' },
  { feature: 'LP reporting + peer benchmarks',   free: '—', pro: '—',  inst: '✓' },
  { feature: 'Founder reference checks',         free: '—', pro: '✓',  inst: '✓' },
  { feature: 'Colleague seats included',         free: '0', pro: '0',  inst: '4' },
];

export default function InvestorPricingPage() {
  const [billing, setBilling] = useState('monthly'); // 'monthly' | 'yearly'
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.investorBillingStatus()
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { /* anonymous or non-investor — fine */ });
    return () => { cancelled = true; };
  }, []);

  const startCheckout = async (tier) => {
    const plan = `investor_${tier === 'professional' ? 'pro' : 'inst'}_${billing === 'yearly' ? 'yearly' : 'monthly'}`;
    setBusy(tier);
    try {
      const res = await api.investorCheckout(plan);
      if (res?.url) window.location.href = res.url;
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e?.message || 'Checkout failed. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const currentTier = String(status?.tier || 'free').toLowerCase();
  const isCurrent = (t) => currentTier === t;

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="mb-6">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-violet-700 dark:text-violet-300 hover:underline">
          <ChevronLeft size={14} /> Back to dashboard
        </Link>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Investor plans</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2 text-sm max-w-2xl mx-auto">
          Pick the plan that matches how actively you invest. Every account starts with a
          <span className="font-semibold text-violet-700 dark:text-violet-300"> 14-day Professional trial</span> — no credit card required.
        </p>
      </div>

      {/* Monthly / Annual toggle */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-1 bg-white dark:bg-gray-900">
          {[
            { id: 'monthly', label: 'Monthly' },
            { id: 'yearly',  label: 'Annual · save 2 mo' },
          ].map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBilling(b.id)}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                billing === b.id
                  ? 'bg-violet-600 text-white font-medium'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid gap-4 md:grid-cols-3 mb-10">
        {(['free','professional','institutional']).map((tier) => {
          const plan = PLANS[tier];
          const featured = tier === 'professional';
          const price = billing === 'yearly' ? plan.yearly : plan.monthly;
          const period = tier === 'free' ? '' : (billing === 'yearly' ? '/ year' : '/ month');
          return (
            <div key={tier}
              className={`rounded-xl border p-6 flex flex-col bg-white dark:bg-gray-900 ${
                featured ? 'border-violet-600 shadow-lg' : 'border-gray-200 dark:border-gray-700'
              }`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">{plan.label}</span>
                {featured && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-600 text-white font-semibold">
                    Most popular
                  </span>
                )}
                {isCurrent(tier) && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-violet-600 text-violet-700 dark:text-violet-300 font-semibold">
                    Current
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">{price}</span>
                {period && <span className="text-sm text-gray-500 dark:text-gray-400">{period}</span>}
              </div>
              {billing === 'yearly' && plan.yearlySaveBlurb && (
                <div className="text-xs text-emerald-700 dark:text-emerald-400">{plan.yearlySaveBlurb}</div>
              )}
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 flex-1">{plan.blurb}</p>

              <div className="mt-5">
                {tier === 'free' ? (
                  <button type="button" disabled
                    className="w-full py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
                    Included by default
                  </button>
                ) : isCurrent(tier) ? (
                  <button type="button" disabled
                    className="w-full py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
                    Your current plan
                  </button>
                ) : (
                  <button type="button" disabled={busy === tier}
                    onClick={() => startCheckout(tier)}
                    className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      featured
                        ? 'bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50'
                        : 'border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50'
                    }`}>
                    {busy === tier ? 'Opening checkout…' : `Upgrade to ${plan.label}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ROI comparison table */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">What you get</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60">
              <tr>
                <th className="text-left font-medium text-gray-600 dark:text-gray-300 px-5 py-2.5">Capability</th>
                <th className="text-center font-medium text-gray-600 dark:text-gray-300 px-3 py-2.5">Free</th>
                <th className="text-center font-medium text-violet-700 dark:text-violet-300 px-3 py-2.5">Professional</th>
                <th className="text-center font-medium text-gray-600 dark:text-gray-300 px-3 py-2.5">Institutional</th>
              </tr>
            </thead>
            <tbody>
              {ROI_ROWS.map((r) => (
                <tr key={r.feature} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-5 py-2.5 text-gray-800 dark:text-gray-200">{r.feature}</td>
                  <td className="text-center text-gray-600 dark:text-gray-300 px-3 py-2.5">{r.free}</td>
                  <td className="text-center font-medium text-gray-900 dark:text-gray-100 bg-violet-50/40 dark:bg-violet-900/10 px-3 py-2.5">{r.pro}</td>
                  <td className="text-center text-gray-700 dark:text-gray-200 px-3 py-2.5">{r.inst}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-center text-xs text-gray-500 dark:text-gray-400 mt-6">
        Prices in USD. Cancel anytime from Settings &rsaquo; Billing. Questions?{' '}
        <a href="mailto:billing@axal.vc" className="text-violet-700 dark:text-violet-300 hover:underline">billing@axal.vc</a>
      </div>
    </div>
  );
}
