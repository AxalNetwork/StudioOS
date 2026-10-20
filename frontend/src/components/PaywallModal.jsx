// Task #6 — Paywall modal for the FREE/GROWTH/STUDIO tier ladder.
// Task #7 (W-2) — Extended to also cover the investor tier ladder
//   (free / professional / institutional) via the same global event.
//
// Listens for the global `studioos:tier_required` custom event dispatched by
// `lib/api.js` whenever the worker returns 402 `{error:'tier_required'|
// 'investor_tier_required', required, message?}`. Also exposes
// `openPaywall(required, message?)` for imperative triggers (sidebar lock-pill
// click). `required` is one of: growth, studio, professional, institutional.

import React, { useEffect, useState, useCallback } from 'react';
import { Lock, Check, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import QuotaCard from './QuotaCard';
import { useEscapeClose } from './useEscapeClose';

// Task #4 (ID) — Exported so the public /pricing page can derive its
// feature lists from the same source-of-truth instead of duplicating
// them and drifting over time. See `frontend/src/data/pricing.js`.
export const TIER_PLANS = {
  // D683 (owner, 2026-10-13): the founder plans are the four cycles in two
  // groups, and the second keeps everything in the first. The tier ids stay
  // `growth` and `studio`; the price is the active Stripe price on the tier's
  // product, which `requireTier.ts` PLAN_PRICE_LABEL quotes too.
  growth: {
    label: 'Validate + Build',
    price: '$20',
    period: '/ month',
    blurb: 'Prove the idea, then build the company.',
    features: [
      'Unlimited startups',
      'Unlimited customer interviews and OKRs',
      'Venture-readiness scoring runs',
      'Company data for market research',
      'Your full archetype card',
      'Wellbeing sessions with experts',
      'Accept up to 10 proposed introductions a month',
    ],
  },
  studio: {
    label: 'Raise + Grow',
    price: '$100',
    period: '/ month',
    blurb: 'Raise the money, then grow the company.',
    features: [
      'Everything in Validate + Build',
      'Pitch decks: every template, share links, your own branding',
      'Cap table scenarios and the dilution simulator',
      'Capital, funds, reserves, and waterfall',
      'Legal, compliance, KYC, and the 83(b)',
      'Liquidity and co-founder matching',
      'Advisor booking, co-marketing, and partner office hours',
      'Watchlist, decision journal, and demand insights',
      'Accept up to 25 proposed introductions a month',
    ],
  },
  professional: {
    label: 'Professional',
    price: '$149',
    period: '/ month',
    blurb: 'Active investors who need full deal flow.',
    plan: 'investor_pro_monthly',
    features: [
      '25 warm intros / quarter',
      'Up to 5 active deal rooms',
      'Full pipeline + deal flow access',
      'Calendar bookings with founders',
      'Market Intelligence exports',
      'Founder reference checks',
    ],
  },
  institutional: {
    label: 'Institutional',
    price: '$599',
    period: '/ month',
    blurb: 'Funds and family offices investing at scale.',
    plan: 'investor_inst_monthly',
    features: [
      '100 warm intros / quarter',
      'Unlimited deal rooms',
      'Co-invest discovery & syndication',
      'Carta sync (write) + LP reporting',
      'Peer benchmarks',
      '4 colleague seats included',
    ],
  },
};

const FOUNDER_RANK = { free: 0, growth: 1, studio: 2 };
const INVESTOR_RANK = { free: 0, professional: 1, institutional: 2 };
const INVESTOR_TIERS = new Set(['professional', 'institutional']);

export function openPaywall(required = 'growth', message = '') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('studioos:tier_required', {
    detail: { required, message },
  }));
}

export default function PaywallModal({ user }) {
  const [open, setOpen] = useState(false);
  const [required, setRequired] = useState('growth');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    function onEvt(e) {
      const detail = e.detail || {};
      const raw = detail.required;
      // Normalize legacy / namespaced tier codes from the worker (some
      // older routes emit `investor_professional` / `investor_institutional`).
      const r = raw === 'investor_professional' ? 'professional'
        : raw === 'investor_institutional' ? 'institutional'
        : raw;
      const norm = (r === 'studio' || r === 'professional' || r === 'institutional') ? r : 'growth';
      // Auto-fires (background 402 from api.js, fired by data fetches on
      // page load) are gated to once-per-session per tier so refreshing the
      // page doesn't keep re-opening the same upsell. Explicit user actions
      // — sidebar lock pill, openPaywall(), CTA buttons — omit `source` and
      // always open the modal.
      if (detail.source === 'auto') {
        try {
          const key = `paywall_auto_shown:${norm}`;
          if (window.sessionStorage.getItem(key)) return;
          window.sessionStorage.setItem(key, '1');
        } catch { /* sessionStorage unavailable — fall through and show */ }
      }
      setRequired(norm);
      setMessage(typeof detail.message === 'string' ? detail.message : '');
      setOpen(true);
    }
    window.addEventListener('studioos:tier_required', onEvt);
    return () => window.removeEventListener('studioos:tier_required', onEvt);
  }, []);

  // Esc to close: on the one dialog stack, so only the top dialog acts (D686).
  useEscapeClose(() => setOpen(false), { active: open });

  const isInvestorMode = INVESTOR_TIERS.has(required);

  const startCheckout = useCallback(async (key) => {
    setBusy(key);
    try {
      const plan = TIER_PLANS[key]?.plan;
      const res = isInvestorMode && plan
        ? await api.investorCheckout(plan)
        : await api.tierCheckout(key);
      if (res?.url) window.location.href = res.url;
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e?.message || 'Checkout failed. Please try again.');
    } finally {
      setBusy(null);
    }
  }, [isInvestorMode]);

  if (!open) return null;

  let tiersToShow;
  if (isInvestorMode) {
    const userTier = String(user?.investor_tier || 'free').toLowerCase();
    const userRank = INVESTOR_RANK[userTier] ?? 0;
    tiersToShow = ['professional', 'institutional'].filter((t) => INVESTOR_RANK[t] > userRank);
    if (tiersToShow.length === 0) tiersToShow = [required];
  } else {
    const userTier = String(user?.subscription_tier || 'free').toLowerCase();
    const userRank = FOUNDER_RANK[userTier] ?? 0;
    tiersToShow = ['growth', 'studio'].filter((t) => FOUNDER_RANK[t] > userRank);
    if (tiersToShow.length === 0) tiersToShow = [required];
  }

  const titleLabel = TIER_PLANS[required]?.label || required;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
      className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 print:hidden overflow-y-auto"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-3xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 my-3 sm:my-0 max-h-[calc(100vh-1.5rem)] sm:max-h-[calc(100vh-2rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 sm:px-6 py-4 sm:py-5 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 rounded-t-2xl z-10">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-violet-700 dark:text-violet-300">
              <Lock size={18} />
            </div>
            <div>
              <h2 id="paywall-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {isInvestorMode ? 'Upgrade your investor plan' : 'Upgrade to keep building'}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                {message || `This is a ${titleLabel}-tier feature.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="-mr-2 -mt-2 p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-100 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X size={22} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
        {isInvestorMode && (
          <div className="px-5 sm:px-6 pt-5">
            <QuotaCard user={{ role: 'investor' }} />
          </div>
        )}
        <div className={`grid gap-4 p-5 sm:p-6 ${tiersToShow.length > 1 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
          {tiersToShow.map((tier) => {
            const plan = TIER_PLANS[tier];
            const featured = tier === required;
            return (
              <div
                key={tier}
                className={`rounded-xl border p-5 flex flex-col ${
                  featured
                    ? 'border-violet-600 bg-violet-50/50 dark:bg-violet-900/20'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold text-gray-900 dark:text-gray-100">{plan.label}</span>
                  {featured && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-600 text-white font-semibold">
                      Recommended
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">{plan.price}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{plan.period}</span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{plan.blurb}</p>
                <ul className="mt-4 space-y-1.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <Check size={14} className="text-violet-600 dark:text-violet-400 mt-1 flex-shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busy === tier}
                  onClick={() => startCheckout(tier)}
                  className={`mt-5 w-full py-2.5 rounded-lg font-medium text-sm transition-colors ${
                    featured
                      ? 'bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50'
                      : 'border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50'
                  }`}
                >
                  {busy === tier ? 'Opening checkout…' : `Upgrade to ${plan.label}`}
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-5 sm:px-6 pb-5 space-y-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full sm:w-auto sm:mx-auto sm:block py-2.5 px-4 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors min-h-[44px]"
          >
            Maybe later — stay on free plan
          </button>
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {isInvestorMode && (
              <Link
                to="/pricing?for=investor"
                onClick={() => setOpen(false)}
                className="text-violet-700 dark:text-violet-300 hover:underline mr-2"
              >
                Compare investor plans →
              </Link>
            )}
            Questions? Email{' '}
            <a href="mailto:billing@axal.vc" className="text-violet-700 dark:text-violet-300 hover:underline">
              billing@axal.vc
            </a>
            . You can cancel any time from Settings &rsaquo; Billing.
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
