// Fixture for routes_modules_d528.test.mjs: a two-route App.jsx that composes
// ONE of the two modules beside it. Not an app; never imported by Vite.
import React, { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
// ── Route modules (D528) ──────────────────────────────────────────────────
import alphaRoutes from './routes/alpha';
import gammaRoutes from './routes/gamma';
// ── end route modules ─────────────────────────────────────────────────────
// gamma is imported and never composed ON PURPOSE: that is the case
// missingRouteModules() must report. The export keeps the import from reading
// as dead code to a static analyser; it composes nothing.
export const importedOnly = [gammaRoutes];
const HomePage = lazy(() => import('./pages/HomePage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

export default function App({ guard, hqOnly, authOnly }) {
  const routeTools = { guard, hqOnly, authOnly };
  return (
    <Routes>
      <Route path="/fixture-home" element={guard(['admin', 'founder'], <HomePage />)} />
      {/* ── Route modules (D528) ── */}
      {alphaRoutes(routeTools)}
      {/* ── end route modules ── */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
