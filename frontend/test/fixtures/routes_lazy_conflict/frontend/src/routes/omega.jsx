// Fixture module: declares `SettingsPage` for a different page than the
// fixture App.jsx does (a conflict), and `HomePage` for the same page (not
// one).
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const HomePage = lazy(() => import('../pages/HomePage'));
const SettingsPage = lazy(() => import('../pages/admin/SettingsPage'));

export default function omegaRoutes({ guard }) {
  return (
    <>
      <Route path="/fixture-omega-home" element={guard(['admin'], <HomePage />)} />
      <Route path="/fixture-admin-settings" element={guard(['admin'], <SettingsPage />)} />
    </>
  );
}
