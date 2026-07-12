// Advisor Advisory workspace — tabbed shell for the full advisory lifecycle
// (opportunity → delivery → contracts). Each tab deep-links to its own route
// (/advisor/advisory/{opportunities,clients,engagements,delivery,contracts});
// every one of those routes renders this workspace, which derives the active tab
// from the URL and renders the matching tab page in `embedded` mode. Tab pages
// are stubs the Advisor Advisory section task replaces with real content.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Briefcase, Target, Users, Layers, Truck, FileText } from 'lucide-react';
import WorkspaceTabs, { WorkspaceHeader } from '../../../components/WorkspaceTabs';
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

  const tabs = [
    { to: '/advisor/advisory/opportunities', label: 'Opportunities', icon: Target },
    { to: '/advisor/advisory/clients', label: 'Clients', icon: Users },
    { to: '/advisor/advisory/engagements', label: 'Engagements', icon: Layers },
    { to: '/advisor/advisory/delivery', label: 'Delivery', icon: Truck },
    { to: '/advisor/advisory/contracts', label: 'Contracts', icon: FileText },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        icon={Briefcase}
        title="Advisory"
        description="Your advisory lifecycle — from opportunities and clients to engagements, delivery, and contracts."
      />
      <WorkspaceTabs tabs={tabs} />
      {active === 'opportunities' && <OpportunitiesPage embedded />}
      {active === 'clients' && <ClientsPage embedded />}
      {active === 'engagements' && <EngagementsPage embedded />}
      {active === 'delivery' && <DeliveryPage embedded />}
      {active === 'contracts' && <ContractsPage embedded />}
    </div>
  );
}
