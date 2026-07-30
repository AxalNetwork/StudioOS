// Advisor Network workspace — tabbed shell for the advisor's people,
// relationships, and organizations surface. Each tab deep-links to its own
// route (/advisor/network/{introductions,relationships,organizations}); every
// one of those routes renders this workspace, which derives the active tab from
// the URL and renders the matching tab page in `embedded` mode so a single
// header + tab bar governs. Tab pages are stubs the Advisor Network section
// task replaces with real content.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Network, Sparkles, Users, Building2 } from 'lucide-react';
import WorkspaceTabs, { WorkspaceHeader } from '../../../components/WorkspaceTabs';
import IntroductionsPage from './IntroductionsPage';
import RelationshipsPage from './RelationshipsPage';
import OrganizationsPage from './OrganizationsPage';

export default function AdvisorNetworkWorkspace() {
  const { pathname } = useLocation();
  const active = pathname.includes('/relationships')
    ? 'relationships'
    : pathname.includes('/organizations')
      ? 'organizations'
      : 'introductions';

  const tabs = [
    { to: '/advisor/network/introductions', label: 'Introductions', icon: Sparkles },
    { to: '/advisor/network/relationships', label: 'Relationships', icon: Users },
    { to: '/advisor/network/organizations', label: 'Organizations', icon: Building2 },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Network}
        title="Network"
        description="Discover contacts, map relationships, and review organization profiles in one place."
      />
      <WorkspaceTabs tabs={tabs} />
      {active === 'introductions' && <IntroductionsPage embedded />}
      {active === 'relationships' && <RelationshipsPage embedded />}
      {active === 'organizations' && <OrganizationsPage embedded />}
    </div>
  );
}
