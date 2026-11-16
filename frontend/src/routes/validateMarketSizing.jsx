import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const SpinoutLabMarketPage = lazy(() => import('../pages/SpinoutLabMarketPage'));

/**
 * `/validate/market-intelligence/sizing?project=<id>` — D6010 (#6010): the
 * market sizing tool opened from Validate › Market intelligence, for the
 * venture in the query. `/spinout-lab/market` stays the Lab's own door.
 *
 * THE GATE is Validate's own (`/validate/:slug` in `App.jsx`): any founder,
 * an admin, and an active Lab member whatever their account role. The page
 * draws no Lab week locks here. Writing is the Worker's to refuse: the
 * figures go through `PUT /api/projects/:id` and the assumptions, marks and
 * sources through routes that admit only the venture's own founders (and an
 * admin), so a partner or investor who reached this page still saves nothing.
 * The static path outranks `/validate/:slug/:id`, so `sizing` is never read
 * as a record id.
 */
export default function validateMarketSizingRoutes({ guard, labRoles }) {
  return (
    <>
      <Route path="/validate/market-intelligence/sizing" element={guard(labRoles(['admin', 'founder']), <SpinoutLabMarketPage from="validate" />)} />
    </>
  );
}
