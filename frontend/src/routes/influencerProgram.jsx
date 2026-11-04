import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const InfluencersPage = lazy(() => import('../pages/influencer/InfluencersPage'));

/**
 * `/influencers` — D4297 (#4297, D4289 P8, IN8): the public Influencer program
 * page, with the application sheet (IN9) for a signed-in member. Public: no
 * guard. A static path, so React Router ranks it above the `/:at` handle route.
 */
export default function influencerProgramRoutes() {
  return (
    <>
      <Route path="/influencers" element={<InfluencersPage />} />
    </>
  );
}
