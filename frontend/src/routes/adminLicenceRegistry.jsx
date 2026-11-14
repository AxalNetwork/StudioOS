import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const UserLicenceDetail = lazy(() => import('../pages/admin/licences/UserLicenceDetail'));

/**
 * D5060 (#5060, part 3) — one user licence's type-aware detail (Licences and Contracts v2 addendum, L37), at
 * `/admin/licences/registry/user/:uid`. Three segments under Licences, as Program access's
 * `/admin/licences/programs/licence/:uid` has, so no `/admin/licences/:uid/:section` link can be read as it. HQ only, as the registry read is Super Admin.
 */
export default function adminLicenceRegistryRoutes({ guard, hqOnly }) {
  return (
    <>
      <Route path="/admin/licences/registry/user/:uid" element={guard(['admin'], hqOnly(<UserLicenceDetail />))} />
    </>
  );
}
