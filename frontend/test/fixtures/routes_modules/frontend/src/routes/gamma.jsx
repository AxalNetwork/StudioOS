// Fixture module: IMPORTED by the fixture App.jsx but never composed, so
// missingRouteModules() must report it with `composed: false`.
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const GammaPage = lazy(() => import('../pages/GammaPage'));

export default function gammaRoutes({ authOnly }) {
  return (
    <>
      <Route path="/fixture-gamma" element={authOnly(<GammaPage />)} />
    </>
  );
}
