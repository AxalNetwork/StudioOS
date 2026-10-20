/**
 * D804 (#2241) — the three Licences sub-pages on their own, until D800 (#2233)
 * builds the tab frame. Each draws the Admin board's frame and rail
 * (`AdminBoardFrame`, the same as `/admin/my-licence`), so every tab carries
 * the Admin rail keyed `Admin · Licences`. The tab components draw no rail of
 * their own: D800 mounts them inside its frame and drops these routes.
 */
import React from 'react';
import AdminBoardFrame from '../../admin/AdminBoardFrame';
import { LicenceTabsNav } from '../MyLicencePage';
import ContractTab from './ContractTab';
import StatementsTab from './StatementsTab';
import RequestsTab from './RequestsTab';

const TABS = {
  contract: { C: ContractTab, title: 'Contract' },
  statements: { C: StatementsTab, title: 'Statements' },
  requests: { C: RequestsTab, title: 'Requests' },
};

export default function LicenceTabRoute({ tab }) {
  const { C, title } = TABS[tab] || TABS.contract;
  return (
    <AdminBoardFrame workspace="Licences" note="Eadwyn reads your licence on this page. It changes nothing." data-testid={`admin-licences-${tab}`}>
      <LicenceTabsNav current={title} />
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Licences · {title}</h1>
        <C />
      </div>
    </AdminBoardFrame>
  );
}
