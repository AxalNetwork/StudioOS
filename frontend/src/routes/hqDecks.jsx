import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const HqDecksPage = lazy(() => import('../pages/hq/decks/HqDecksPage'));

/**
 * `/admin/platform/decks` — D4155 (#4155), HQ › Decks: a Platform tab after
 * Promo codes, one address per tab (D936). HQ only; each route behind it
 * re-checks (`requireHqAdmin`, `requireAdmin`, the Super Admin for writes).
 */
export default function hqDecksRoutes({ guard, hqOnly }) {
  return (
    <>
      <Route path="/admin/platform/decks" element={guard(['admin'], hqOnly(<HqDecksPage />))} />
      <Route path="/admin/platform/decks/flags" element={guard(['admin'], hqOnly(<HqDecksPage />))} />
      <Route path="/admin/platform/decks/beta" element={guard(['admin'], hqOnly(<HqDecksPage />))} />
      <Route path="/admin/platform/decks/templates" element={guard(['admin'], hqOnly(<HqDecksPage />))} />
      <Route path="/admin/platform/decks/norms" element={guard(['admin'], hqOnly(<HqDecksPage />))} />
      <Route path="/admin/platform/decks/models" element={guard(['admin'], hqOnly(<HqDecksPage />))} />
    </>
  );
}
