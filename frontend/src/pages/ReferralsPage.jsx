/**
 * Referrals — the single workspace that merges the former standalone
 * "Refer & Earn" (/refer) and "Payouts" (/payouts) pages into one tabbed
 * surface. You refer people to earn commission, and payouts is where you
 * collect it, so they belong together.
 *
 * This is a pure information-architecture consolidation, not a rebuild. Both
 * pre-existing surfaces are composed here as tabs and reused as-is via an
 * `embedded` prop that suppresses each one's own page-level heading so a single
 * "Referrals" title governs:
 *
 *   - Refer & Earn → ReferEarnPage (referral link/QR, share templates,
 *                    LinkedIn import, Stripe Connect payouts panel, sent invites)
 *   - Payouts      → PayoutsPage   (available/lifetime/pending balances,
 *                    commission ledger, request-payout form + history)
 *
 * The active tab is stored in the `?tab=` query string so both sub-surfaces are
 * deep-linkable and the legacy /payouts route can redirect straight into the
 * Payouts tab (see App.jsx). Mirrors the /build/team?tab= pattern.
 */
import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Share2, Wallet } from 'lucide-react';
import PageExplainer from '../components/PageExplainer';
import ReferEarnPage from './ReferEarnPage';
import PayoutsPage from './PayoutsPage';

const TABS = [
  {
    id: 'refer',
    label: 'Refer & Earn',
    icon: Share2,
    blurb: 'Invite founders, partners, and LPs, and earn commissions when they reach milestones.',
  },
  {
    id: 'payouts',
    label: 'Payouts',
    icon: Wallet,
    blurb: 'Track your available and lifetime earnings, review commissions, and request a payout.',
  },
];

export default function ReferralsPage({ embedded = false }) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Resolve the active tab from ?tab=, defaulting to Refer & Earn.
  const requested = searchParams.get('tab');
  const activeId = useMemo(() => {
    if (requested && TABS.some((t) => t.id === requested)) return requested;
    return TABS[0].id;
  }, [requested]);

  const activeTab = TABS.find((t) => t.id === activeId) || TABS[0];

  const selectTab = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  return (
    <div
      className={embedded ? 'space-y-6' : 'p-6 max-w-6xl mx-auto space-y-6'}
      data-testid="referrals-page"
    >
      {/* When embedded inside Settings the section rail already labels this
          surface, so suppress the page-level heading/explainer and outer
          padding — a single "Referrals" title governs. */}
      {!embedded && (
        <div className="flex items-center gap-3">
          <Share2 className="text-violet-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Referrals</h1>
            <PageExplainer pageKey="refer_earn" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Refer founders, partners, and LPs — then collect the commissions you earn.
            </p>
          </div>
        </div>
      )}

      {/* Segmented tab bar. Deep-linkable via ?tab= and highlighted with the
          same violet accent the primary sidebar uses. */}
      <div
        role="tablist"
        aria-label="Referrals sections"
        className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab.id)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-violet-600 text-violet-700 dark:text-violet-300'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
              }`}
            >
              <Icon size={16} /> {tab.label}
            </button>
          );
        })}
      </div>

      <p className="-mt-2 text-sm text-gray-500 dark:text-gray-400">{activeTab.blurb}</p>

      {/* Each embedded page keeps its own loading / empty / results states. */}
      <div>
        {activeId === 'payouts' ? <PayoutsPage embedded /> : <ReferEarnPage embedded />}
      </div>
    </div>
  );
}
