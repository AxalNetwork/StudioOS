import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const PackageCatalogue = lazy(() => import('../pages/admin/licences/PackageCatalogue'));
const PackageCompare = lazy(() => import('../pages/admin/licences/PackageCompare'));

/**
 * D5896 (#5896) — HQ's Axal VC package catalogue (Licences and Contracts v2 addendum, L29), at
 * `/admin/licences/packages`. A literal segment, so React Router ranks it above `/admin/licences/:uid`. HQ only, as
 * the catalogue read is Super Admin.
 *
 * D5898 (#5898) — the comparison (L30) at `/admin/licences/packages/compare`, also literal, so it outranks
 * `/admin/licences/:uid` and the catalogue alike. The canvas gives no address; D5898 records this one.
 */
export default function adminLicencePackagesRoutes({ guard, hqOnly }) {
  return (
    <>
      <Route path="/admin/licences/packages" element={guard(['admin'], hqOnly(<PackageCatalogue />))} />
      <Route path="/admin/licences/packages/compare" element={guard(['admin'], hqOnly(<PackageCompare />))} />
    </>
  );
}
