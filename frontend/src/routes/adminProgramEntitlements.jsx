import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const ProgramGrants = lazy(() => import('../pages/admin/grants/ProgramGrants'));
const UserLicenceEntitlements = lazy(() => import('../pages/admin/grants/EntitlementViews'));

/**
 * D5059 (#5059) — program entitlements from held user licences. `/admin/licences/programs/holders` is Program
 * access by licence's User licences tab (the page's other tabs stay in `App.jsx`); `/admin/licences/programs/licence/:uid` is
 * one user licence's programs. Both sit under Program access; the licence page has six segments, so no `/admin/licences/:uid/:section` link can be read as it. HQ only, as
 * Program access is: the Worker reads are Super Admin.
 */
export default function adminProgramEntitlementsRoutes({ guard, hqOnly }) {
  return (
    <>
      <Route path="/admin/licences/programs/holders" element={guard(['admin'], hqOnly(<ProgramGrants />))} />
      <Route path="/admin/licences/programs/licence/:uid" element={guard(['admin'], hqOnly(<UserLicenceEntitlements />))} />
    </>
  );
}
