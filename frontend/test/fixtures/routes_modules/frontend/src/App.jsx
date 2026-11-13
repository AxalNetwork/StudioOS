// Fixture for routes_modules_d528.test.mjs: a two-route App.jsx that collects
// the modules beside it the way the real one does (#4105). Not an app; never
// imported by Vite.
import React, { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
// ── Route modules (D528) ──────────────────────────────────────────────────
import { collectRouteModules } from './lib/routeModules';
const ROUTE_MODULES = collectRouteModules(import.meta.glob('./routes/*.jsx', { eager: true }));
// ── end route modules ─────────────────────────────────────────────────────
const HomePage = lazy(() => import('./pages/HomePage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

export default function App({ guard, hqOnly, authOnly }) {
  const routeTools = { guard, hqOnly, authOnly };
  return (
    <Routes>
      <Route path="/fixture-home" element={guard(['admin', 'founder'], <HomePage />)} />
      {/* ── Route modules (D528) ── */}
      {ROUTE_MODULES.map(({ file, routes }) => <React.Fragment key={file}>{routes(routeTools)}</React.Fragment>)}
      {/* ── end route modules ── */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
