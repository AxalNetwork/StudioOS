// Fixture for routes_modules_d528.test.mjs: an App.jsx and one module that
// both declare `SettingsPage`, for DIFFERENT pages — the collision
// conflictingLazyImports() must report. `HomePage` is declared in both for
// the SAME page, which is a duplicate chunk and not a conflict. Not an app;
// never imported by Vite.
import React, { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
// ── Route modules (D528) ──────────────────────────────────────────────────
import omegaRoutes from './routes/omega';
// ── end route modules ─────────────────────────────────────────────────────
const HomePage = lazy(() => import('./pages/HomePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

export default function App({ guard }) {
  const routeTools = { guard };
  return (
    <Routes>
      <Route path="/fixture-home" element={guard(['founder'], <HomePage />)} />
      <Route path="/fixture-settings" element={guard(['founder'], <SettingsPage />)} />
      {/* ── Route modules (D528) ── */}
      {omegaRoutes(routeTools)}
      {/* ── end route modules ── */}
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}
