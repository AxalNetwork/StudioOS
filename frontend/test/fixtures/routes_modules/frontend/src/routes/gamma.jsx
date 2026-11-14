// Fixture module: collected by the glob, but its default export is not the
// `gammaRoutes` function its file name implies, so missingRouteModules() must
// report it with `exported: false`.
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const GammaPage = lazy(() => import('../pages/GammaPage'));

export default function routes({ authOnly }) {
  return (
    <>
      <Route path="/fixture-gamma" element={authOnly(<GammaPage />)} />
    </>
  );
}
