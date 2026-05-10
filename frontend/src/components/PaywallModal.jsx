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

const TIER_PLANS = {
  growth: {
    label: 'Growth',
    price: '$79',
    period: '/ month',
    blurb: 'For founders shipping past discovery.',
    features: [
      'Unlimited projects',
      'Unlimited customer interviews + OKRs',
      'Pitch deck builder + share links',
      'Cap-table scenarios + simulator',
      'Mentor booking & office hours',
      'AI scoring + co-marketing',
    ],
  },
  studio: {
    label: 'Studio',
    price: '$249',
    period: '/ month',
    blurb: 'Capital, legal, and partner tooling.',
    features: [
      'Everything in Growth',
      'Capital + funds + reserves + waterfall',
      'Liquidity, legal cap, KYC, 83(b)',
      'Co-founder matching',
      'Watchlist + decision journal',
      'Partner office hours + demand insights',
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
      const r = detail.required;
      const norm = (r === 'studio' || r === 'professional' || r === 'institutional') ? r : 'growth';
      setRequired(norm);
      setMessage(typeof detail.message === 'string' ? detail.message : '');
      setOpen(true);
    }
    window.addEventListener('studioos:tier_required', onEvt);
    return () => window.removeEventListener('studioos:tier_required', onEvt);
  }, []);

  // Esc to close.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 print:hidden"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-3xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-200 dark:border-gray-700">
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
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className={`grid gap-4 p-6 ${tiersToShow.length > 1 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
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

        <div className="px-6 pb-5 text-xs text-gray-500 dark:text-gray-400 text-center">
          {isInvestorMode && (
            <Link
              to="/pricing/investor"
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
  );
}
