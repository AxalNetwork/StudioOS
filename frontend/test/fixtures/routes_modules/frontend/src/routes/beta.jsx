// Fixture module: exists but is NOT imported or composed by the fixture
// App.jsx, so missingRouteModules() must report it.
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const BetaPage = lazy(() => import('../pages/BetaPage'));

export default function betaRoutes({ guard }) {
  return (
    <>
      <Route path="/fixture-beta" element={guard(['founder'], <BetaPage />)} />
    </>
  );
}
