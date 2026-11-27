// D4704 part 2: the remaining Clients and Contracts routes use this legacy
// shell. Opportunities and Engagements have their own mounted Practice zones.
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Briefcase } from 'lucide-react';
import { AdvisorWorkspaceShell, advisorTabs } from '../AdvisorWorkspaceShell';
import { RailFrame, WorkerRail } from '../../../ui';
import ClientsPage from './ClientsPage';
import DeliveryPage from './DeliveryPage';
import ContractsPage from './ContractsPage';

// The mounted legacy routes have no outer shell and keep their tabs.
// D773 (#2099): there it draws the advisor's Practice rail in the shared frame
// (the page map's alias of Practice), and the shell's static "AI assist" card,
// which stood where the rail docks, is off (`rail={false}`). Embedded, the
// outer WorkspaceShell's rail is the page's one rail.
export default function AdvisorAdvisoryWorkspace({ embedded = false }) {
  const { pathname } = useLocation();
  const active = pathname.includes('/clients')
    ? 'clients'
    : pathname.includes('/delivery')
      ? 'delivery'
      : pathname.includes('/contracts')
        ? 'contracts'
        : 'clients';

  const page = (
    <AdvisorWorkspaceShell
      embedded={embedded}
      rail={false}
      eyebrow="Practice"
      title="Run my advisory business"
      description="From inbound opportunities and clients to engagements, delivery, and contracts — all backed by your live advisory records."
      icon={Briefcase}
      tabs={advisorTabs}
    >
      {active === 'clients' && <ClientsPage embedded />}
      {active === 'delivery' && <DeliveryPage embedded />}
      {active === 'contracts' && <ContractsPage embedded />}
    </AdvisorWorkspaceShell>
  );
  if (embedded) return page;
  return (
    <RailFrame rail={<WorkerRail workspace="Practice" role="advisor" note="Eadwyn reads the clients and contracts on this page. Nothing is sent to a client until you send it." />}>
      {page}
    </RailFrame>
  );
}
