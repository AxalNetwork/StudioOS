import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuthSync';
import AdminBoardFrame from './admin/AdminBoardFrame';
import { DdListTabBody, DdListTabs } from './duediligence/DdTabs';
import DdCasesTab from './duediligence/DdCasesTab';
import DdTemplates from './duediligence/DdTemplates';
import { PAGE_LINE, TITLE, viewOf } from './duediligence/ddModel';

// D1244 (#2385): the title and line are the canvas's (DDL1); no shield icon.
function DdListHeader() {
  return (
    <>
      <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">{TITLE}</h1>
      <p className="mb-4 text-gray-600 dark:text-gray-400">{PAGE_LINE}</p>
    </>
  );
}

// D774 (#2100): S11 drew no rail. The board's page, in the Admin boards' frame.
// D1244 (#2385): Cases, My reviews and Templates are their own addresses.
// D1250 (#3265): Cases is DDL1 (`DdCasesTab`) and Templates DDL13
// (`DdTemplates`); My reviews stays D1244's wait until part 8 (#3267).
export function DdListPage({ me }) {
  const { listTab, base } = viewOf(useLocation().pathname);
  const tab = listTab || 'cases';
  return (
    <div>
      <DdListHeader />
      <DdListTabs active={tab} />
      {tab === 'cases' ? <DdCasesTab me={me} base={base} /> : null}
      {tab === 'templates' ? <DdTemplates /> : null}
      {tab === 'my-reviews' ? <DdListTabBody tab="my-reviews" /> : null}
    </div>
  );
}

export default function AdminDueDiligencePage() {
  const me = useAuth()?.user ?? null;
  // DDL17: diligence is run by the investment team. A founder who reaches the
  // desk is sent to the requests addressed to them, never to a case.
  if (me?.role === 'founder') return <Navigate to="/due-diligence/requests" replace />;
  return (
    <AdminBoardFrame workspace="Due diligence" note="Eadwyn reads the cases listed here. A verdict is recorded only when you record it." data-testid="admin-board-due-diligence">
      <DdListPage me={me} />
    </AdminBoardFrame>
  );
}
