import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const PackageCatalogue = lazy(() => import('../pages/admin/licences/PackageCatalogue'));

/**
 * D5896 (#5896) — HQ's Axal VC package catalogue (Licences and Contracts v2 addendum, L29), at
 * `/admin/licences/packages`. A literal segment, so React Router ranks it above `/admin/licences/:uid`. HQ only, as
 * the catalogue read is Super Admin.
 */
export default function adminLicencePackagesRoutes({ guard, hqOnly }) {
  return (
    <>
      <Route path="/admin/licences/packages" element={guard(['admin'], hqOnly(<PackageCatalogue />))} />
    </>
  );
}
