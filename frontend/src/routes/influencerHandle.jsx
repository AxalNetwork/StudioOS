import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const HandlePage = lazy(() => import('../pages/influencer/HandlePage'));

/**
 * `axal.vc/@handle` and `/@handle/<channel>` — D4289 P2 (#4291). React Router
 * matches whole segments only (`/@:handle` never matches), so the route is the
 * one-segment `/:at` and the page renders the app's 404 for a segment without
 * `@`. Static routes still win: React Router ranks them above a dynamic one.
 * Public: no guard. P8 (#4297) draws IN7 on the same page.
 */
export default function influencerHandleRoutes() {
  return (
    <>
      <Route path="/:at" element={<HandlePage />} />
      <Route path="/:at/:channel" element={<HandlePage />} />
    </>
  );
}
