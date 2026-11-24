/** #5026: L31/L32 HQ package offers; fixed child path outranks licence section routing. */
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';
const Offers = lazy(() => import('../pages/admin/licences/LicencePackageOffers'));
export default function adminLicencePackageOffersRoutes({ guard, hqOnly }) {
  return (
      <Route path="/admin/licences/:uid/packages/offers" element={guard(['admin'], hqOnly(<Offers />))} />
  );
}
