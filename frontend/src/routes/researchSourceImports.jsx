import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const SourceImportsPage = lazy(() => import('../pages/research/imports/SourceImportsPage'));
const SourceImportRun = lazy(() => import('../pages/research/imports/SourceImportRun'));

/**
 * D7753 (#7753) — Research › Funds › Source imports, the private Super Admin console (canvas D7738, boards FND-I00 to
 * FND-I06; the owner's answer A on #7738: this address, Super Admins only on HQ, one link beside the Sheets card).
 *
 * THE GATE. `guard(['admin'], …)` draws the existing Admin only notice for anyone else, and `hqOnly` the existing
 * Super Admin only notice for an administrator without the elevation; in both the page never mounts, so it makes no
 * request. Writes need a recent step-up on the Worker (`requireSuperAdminWriteBar`). Records, columns, promotion and
 * the report (`/records`, `/columns/:source`, `/promote`, `/report`) are #7754 and #7755. Nothing from the file is
 * ever in an address: `:uid` is the Worker's own run id.
 */
export default function researchSourceImportsRoutes({ guard, hqOnly }) {
  return (
    <>
      <Route path="/research/source-imports" element={guard(['admin'], hqOnly(<SourceImportsPage />))} />
      <Route path="/research/source-imports/runs/:uid" element={guard(['admin'], hqOnly(<SourceImportRun />))} />
    </>
  );
}
