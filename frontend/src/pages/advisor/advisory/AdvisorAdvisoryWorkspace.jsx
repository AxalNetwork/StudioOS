// Advisor Advisory workspace — tabbed shell for the full advisory lifecycle
// (opportunity → delivery → contracts). Each tab deep-links to its own route
// (/advisor/advisory/{opportunities,clients,engagements,delivery,contracts});
// every one of those routes renders this workspace, which derives the active tab
// from the URL and renders the matching tab page in `embedded` mode. Tab pages
// are stubs the Advisor Advisory section task replaces with real content.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Briefcase } from 'lucide-react';
import { AdvisorWorkspaceShell, advisorTabs } from '../AdvisorWorkspaceShell';
import OpportunitiesPage from './OpportunitiesPage';
import ClientsPage from './ClientsPage';
import EngagementsPage from './EngagementsPage';
import DeliveryPage from './DeliveryPage';
import ContractsPage from './ContractsPage';

export default function AdvisorAdvisoryWorkspace() {
  const { pathname } = useLocation();
  const active = pathname.includes('/clients')
    ? 'clients'
    : pathname.includes('/engagements')
      ? 'engagements'
      : pathname.includes('/delivery')
        ? 'delivery'
        : pathname.includes('/contracts')
          ? 'contracts'
          : 'opportunities';

  return (
    <AdvisorWorkspaceShell
      eyebrow="Practice"
      title="Run my advisory business"
      description="From inbound opportunities and clients to engagements, delivery, and contracts — all backed by your live advisory records."
      icon={Briefcase}
      tabs={advisorTabs}
    >
      {active === 'opportunities' && <OpportunitiesPage embedded />}
      {active === 'clients' && <ClientsPage embedded />}
      {active === 'engagements' && <EngagementsPage embedded />}
      {active === 'delivery' && <DeliveryPage embedded />}
      {active === 'contracts' && <ContractsPage embedded />}
    </AdvisorWorkspaceShell>
  );
}
