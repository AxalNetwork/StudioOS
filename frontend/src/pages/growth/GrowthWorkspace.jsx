// Growth workspace — tabbed shell for the market-matching / resource-discovery
// section shared by the Advisor and Partner profiles. Each tab deep-links to its
// own route (/{advisor|partner}/growth/{talent,customers,capital,experts}); the
// component derives BOTH the active tab and the role route prefix from the URL,
// so a single workspace serves both profiles. Growth is deliberately distinct
// from the user-controlled sections (Advisory for advisors, Operations for
// partners): it is about finding the right people, companies, capital, and
// expertise — some already on the platform, some external/unmatched.
//
// UI shell only — tab pages render mock data (see src/data/growth.js).
//
// Founder-journey audit — for FOUNDERS specifically, that used to mean every
// account, free tier included, saw fully-interactive fake companies and
// candidates presented as a working feature, right next to this same profile's
// real, live Raise/Team surfaces. sidebarConfig.js now marks the founder
// Growth items `requiredTier: 'growth'`, the same lock-icon + PaywallModal
// treatment `/liquidity` already gets — but that only locks the SIDEBAR entry;
// a founder who already has the URL (or the lock hasn't loaded yet) would land
// here and see the mock page rendered exactly as before. This mirrors that
// same gate at the page level, via the same `hasTier` used by the sidebar (so
// a tab is never unlocked in the nav and locked here, or the reverse) and the
// same `LockedPreview` component the Fund Ops workspace already uses for this
// exact shape of problem (real admin-only tooling behind a blurred teaser).
//
// What this does NOT fix: a founder who genuinely has Growth tier — or is
// Spin-Out Lab-active, which also passes `hasTier`'s gate — still lands on the
// same mock data once unlocked. Wiring real talent/customer/partnership
// /capital/expert matching is a separate, materially larger effort than
// closing off the free tier's access to a placeholder.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Rocket, Users, Building2, Banknote, GraduationCap, Handshake } from 'lucide-react';
import { useAuth } from '../../hooks/useAuthSync';
import { hasTier } from '../../sidebarConfig';
import WorkspaceTabs, { WorkspaceHeader } from '../../components/WorkspaceTabs';
import LockedPreview from '../../components/LockedPreview';
import TalentPage from './TalentPage';
import CustomersPage from './CustomersPage';
import PartnershipsPage from './PartnershipsPage';
import CapitalPage from './CapitalPage';
import ExpertsPage from './ExpertsPage';

const TABS = {
  talent: { label: 'Talent', icon: Users, page: TalentPage, lockMessage: 'Curated candidate matching is part of the Growth plan.' },
  customers: { label: 'Customers', icon: Building2, page: CustomersPage, lockMessage: 'Customer-discovery matching is part of the Growth plan.' },
  partnerships: { label: 'Partnerships', icon: Handshake, page: PartnershipsPage, lockMessage: 'Partnership matching is part of the Growth plan.' },
  capital: { label: 'Capital', icon: Banknote, page: CapitalPage, lockMessage: 'Capital-source matching is part of the Growth plan.' },
  experts: { label: 'Experts', icon: GraduationCap, page: ExpertsPage, lockMessage: 'Mentor and expert matching is part of the Growth plan.' },
};

export default function GrowthWorkspace() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  // Role-aware prefix so the same workspace works under every profile that
  // exposes Growth (founder, partner, advisor).
  const prefix = pathname.startsWith('/founder')
    ? '/founder'
    : pathname.startsWith('/partner')
      ? '/partner'
      : '/advisor';

  const active = pathname.includes('/customers')
    ? 'customers'
    : pathname.includes('/partnerships')
      ? 'partnerships'
      : pathname.includes('/capital')
        ? 'capital'
        : pathname.includes('/experts')
          ? 'experts'
          : 'talent';

  const tabs = Object.entries(TABS).map(([key, t]) => (
    { to: `${prefix}/growth/${key}`, label: t.label, icon: t.icon }
  ));

  // `hasTier` bypasses admin/partner/investor/advisor and Spin-Out Lab-active
  // founders — this is deliberately the exact function the sidebar lock uses,
  // not a stricter local check, so the two never disagree about whether a
  // given founder can see this tab.
  const locked = !hasTier(user, 'growth');
  const current = TABS[active];
  const ActivePage = current.page;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Rocket}
        title="Growth"
        description="Match founders to the resources they need to grow — the right talent, customers, capital, and experts, on and off the platform."
      />
      <WorkspaceTabs tabs={tabs} />
      {locked ? (
        <LockedPreview
          icon={current.icon}
          title={`${current.label} matching`}
          message={current.lockMessage}
          tier="growth"
          user={user}
          ctaLabel="Unlock Growth"
        >
          <ActivePage />
        </LockedPreview>
      ) : (
        <ActivePage />
      )}
    </div>
  );
}
