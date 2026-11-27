import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

// The same page module as `/admin/contracts` (App.jsx's HqContractsPage), so the desk is one routed component.
const HqContractsPage = lazy(() => import('../pages/hq/ContractsPage'));

/**
 * `/admin/contracts/agreements/doc/:uid` — D4811 (#4811) part 14: one
 * agreement's workspace (Overview · Document · Versions · Legal Review ·
 * Activity · Related), drawn by the Contracts desk under its Agreements tab.
 * Read-only; resend and void stay in the quick panel. Its reads are the admin
 * contract routes, which re-check the admin (`requireAdmin`).
 */
export default function adminAgreementWorkspaceRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/contracts/agreements/doc/:uid" element={guard(['admin'], <HqContractsPage section="agreement" />)} />
    </>
  );
}
