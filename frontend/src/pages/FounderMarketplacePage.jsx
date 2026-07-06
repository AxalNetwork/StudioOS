import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, MessageSquare, Inbox, Package, FileText, Handshake, ShieldCheck } from 'lucide-react';
import {
  BrowseTab as ServicesBrowseTab,
  MineTab as OfferingsTab,
  StripeTab,
} from './ServiceCatalogPage';
import {
  BrowseTab as NeedsBrowseTab,
  MyNeedsTab,
  MyQuotesTab,
  EngagementsTab,
} from './NeedsBoardPage';

// Founder-facing Marketplace (Task #2). A single, deep-linkable page that merges
// the two halves of the partner-services marketplace — the Service Catalogue
// (supply: browse productised offerings and book them) and the Needs Board
// (demand: post needs/RFPs and collect quotes) — into one role-aware tab bar.
// Both source pages already funnel accepted work into the same Engagements
// lifecycle, so that tab is deduplicated to a single "Engagements" here.
//
// The individual tab bodies are the *exact* components from NeedsBoardPage and
// ServiceCatalogPage (reused via named exports, not re-implemented), so every
// action — post a need, submit/accept/reject/withdraw quotes, book a service,
// manage offerings, Stripe Connect and the engagement state machine — carries
// over unchanged. The standalone /needs and /services routes stay registered
// for the partner/investor/admin sidebars; founders are redirected here.

export default function FounderMarketplacePage({ user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isFounder = user?.role === 'founder';
  const isPartner = user?.role === 'partner';
  const isAdmin = user?.role === 'admin';

  const [tab, setTab] = useState(searchParams.get('tab') || 'services');
  useEffect(() => { setSearchParams({ tab }, { replace: true }); }, [tab]); // eslint-disable-line

  const tabs = [
    { key: 'services', label: 'Services', icon: Package },
    { key: 'needs', label: 'Needs', icon: Search },
    ...(isFounder ? [{ key: 'mine', label: 'My needs', icon: Inbox }] : []),
    ...(isPartner || isAdmin ? [{ key: 'offerings', label: 'My offerings', icon: MessageSquare }] : []),
    ...(isPartner ? [{ key: 'quotes', label: 'My quotes', icon: FileText }] : []),
    { key: 'engagements', label: 'Engagements', icon: Handshake },
    ...(isPartner ? [{ key: 'stripe', label: 'Stripe Connect', icon: ShieldCheck }] : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Marketplace</h1>
        <p className="text-sm text-gray-500 mt-1">
          Browse ready-made partner services with fixed price, scope and SLA — or post a need
          and collect quotes. Booked services and accepted quotes both run through the same
          engagements lifecycle.
        </p>
      </div>

      <div className="border-b border-gray-200 flex gap-6 overflow-x-auto dark:border-gray-800">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-1 py-3 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === t.key ? 'border-violet-600 text-violet-700 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-900'}`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'services' && <ServicesBrowseTab user={user} isFounder={isFounder} />}
      {tab === 'needs' && <NeedsBrowseTab user={user} />}
      {tab === 'mine' && isFounder && <MyNeedsTab user={user} />}
      {tab === 'offerings' && (isPartner || isAdmin) && <OfferingsTab user={user} />}
      {tab === 'quotes' && isPartner && <MyQuotesTab />}
      {tab === 'engagements' && <EngagementsTab user={user} />}
      {tab === 'stripe' && isPartner && <StripeTab />}
    </div>
  );
}
