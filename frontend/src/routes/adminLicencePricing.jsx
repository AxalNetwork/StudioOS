import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const PricingCatalogue = lazy(() => import('../pages/admin/licences/PricingCatalogue'));
const PricingCountry = lazy(() => import('../pages/admin/licences/PricingCountry'));
const PricingModels = lazy(() => import('../pages/admin/licences/PricingModels'));
const PricingReviews = lazy(() => import('../pages/admin/licences/PricingReviews'));

/**
 * D5020 (#5020, the HQ screens) — Country pricing under Licences (addendum boards L23 to L25 and L27): the catalogue,
 * one market's calculation, the model versions and the annual review queue. HQ only, as the D5020 reads are Super
 * Admin. Every path's third segment is the static `pricing`, which React Router ranks above the `:uid` of
 * `/admin/licences/:uid` and `/admin/licences/:uid/:section` (as `/admin/licences/programs` already is), so no
 * licence uid is ever read as one of these pages.
 */
export default function adminLicencePricingRoutes({ guard, hqOnly }) {
  return (
    <>
      <Route path="/admin/licences/pricing" element={guard(['admin'], hqOnly(<PricingCatalogue />))} />
      <Route path="/admin/licences/pricing/country/:code" element={guard(['admin'], hqOnly(<PricingCountry />))} />
      <Route path="/admin/licences/pricing/models" element={guard(['admin'], hqOnly(<PricingModels />))} />
      <Route path="/admin/licences/pricing/reviews" element={guard(['admin'], hqOnly(<PricingReviews />))} />
    </>
  );
}
