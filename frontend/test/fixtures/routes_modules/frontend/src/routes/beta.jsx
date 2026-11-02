// Fixture module: collected by the fixture App.jsx's glob like alpha.jsx; it
// declares `order` = -1, so it composes first (#4105).
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const BetaPage = lazy(() => import('../pages/BetaPage'));

export const order = -1;

export default function betaRoutes({ guard }) {
  return (
    <>
      <Route path="/fixture-beta" element={guard(['founder'], <BetaPage />)} />
    </>
  );
}
