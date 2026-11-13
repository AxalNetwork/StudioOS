import React from 'react';
import { useLocation } from 'react-router-dom';
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
export function DdListPage({ me: given }) {
  const signedIn = useAuth()?.user ?? null;
  const me = given ?? signedIn;
  const { listTab } = viewOf(useLocation().pathname);
  const tab = listTab || 'cases';
  return (
    <div>
      <DdListHeader />
      <DdListTabs active={tab} />
      {tab === 'cases' ? <DdCasesTab me={me} /> : null}
      {tab === 'templates' ? <DdTemplates /> : null}
      {tab === 'my-reviews' ? <DdListTabBody tab="my-reviews" /> : null}
    </div>
  );
}

// DDL17: a founder never reaches this page; App.jsx sends them to their requests.
export default function AdminDueDiligencePage() {
  return (
    <AdminBoardFrame workspace="Due diligence" note="Eadwyn reads the cases listed here. A verdict is recorded only when you record it." data-testid="admin-board-due-diligence">
      <DdListPage />
    </AdminBoardFrame>
  );
}
