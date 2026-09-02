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

// `embedded`: AdvisorBucketRoutes renders this inside `workspaces/WorkspaceShell`
// on /practice/{opportunities,engagements,delivery}. That shell draws the crumb,
// the h1, the zone pills and the rail, so the AdvisorWorkspaceShell below drops
// its own — including `advisorTabs`, whose Clients and Contracts entries have no
// zone and are linked instead from the "Still here, still working" card that
// AdvisorBucketRoutes renders on the Opportunities zone.
// `/advisor/advisory/*` mounts this with no outer shell and keeps its tabs.
export default function AdvisorAdvisoryWorkspace({ embedded = false }) {
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
      embedded={embedded}
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
