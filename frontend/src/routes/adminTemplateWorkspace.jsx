import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

// The same page module as `/admin/contracts` (App.jsx's HqContractsPage), so the desk is one routed component.
const HqContractsPage = lazy(() => import('../pages/hq/ContractsPage'));

/**
 * `/admin/contracts/templates/doc/:slug` — D4811 (#4811) part 10: one
 * template's workspace (Overview · Document · Versions · Legal Review ·
 * Activity · Related), drawn by the Contracts desk under its Templates tab.
 * Read-only; its reads are the admin template routes, which re-check the
 * admin (`requireAdmin`).
 */
export default function adminTemplateWorkspaceRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/contracts/templates/doc/:slug" element={guard(['admin'], <HqContractsPage section="template" />)} />
    </>
  );
}
