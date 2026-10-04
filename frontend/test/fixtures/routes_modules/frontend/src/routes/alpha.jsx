// Fixture module: wired into the fixture App.jsx. One admin-only route.
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const AlphaPage = lazy(() => import('../pages/AlphaPage'));

export default function alphaRoutes({ guard }) {
  return (
    <>
      <Route path="/fixture-alpha" element={guard(['admin'], <AlphaPage />)} />
    </>
  );
}
