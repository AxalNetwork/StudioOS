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
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Rocket, Users, Building2, Banknote, GraduationCap } from 'lucide-react';
import WorkspaceTabs, { WorkspaceHeader } from '../../components/WorkspaceTabs';
import TalentPage from './TalentPage';
import CustomersPage from './CustomersPage';
import CapitalPage from './CapitalPage';
import ExpertsPage from './ExpertsPage';

export default function GrowthWorkspace() {
  const { pathname } = useLocation();
  // Role-aware prefix so the same workspace works under both profiles.
  const prefix = pathname.startsWith('/partner') ? '/partner' : '/advisor';

  const active = pathname.includes('/customers')
    ? 'customers'
    : pathname.includes('/capital')
      ? 'capital'
      : pathname.includes('/experts')
        ? 'experts'
        : 'talent';

  const tabs = [
    { to: `${prefix}/growth/talent`, label: 'Talent', icon: Users },
    { to: `${prefix}/growth/customers`, label: 'Customers', icon: Building2 },
    { to: `${prefix}/growth/capital`, label: 'Capital', icon: Banknote },
    { to: `${prefix}/growth/experts`, label: 'Experts', icon: GraduationCap },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Rocket}
        title="Growth"
        description="Match founders to the resources they need to grow — the right talent, customers, capital, and experts, on and off the platform."
      />
      <WorkspaceTabs tabs={tabs} />
      {active === 'talent' && <TalentPage />}
      {active === 'customers' && <CustomersPage />}
      {active === 'capital' && <CapitalPage />}
      {active === 'experts' && <ExpertsPage />}
    </div>
  );
}
