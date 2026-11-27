import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const PortfolioAddress = lazy(() => import('../pages/account/companies/PortfolioAddress'));

/**
 * Portfolio's canonical addresses (D1413, #3696): `/c/<company>`,
 * `/c/<company>/p/<project>` and `/p/<project>`, each with an optional
 * `/settings[/<tab>]`. A new area, so its routes live here (D528); the
 * Account pages they open stay in `App.jsx` with their siblings.
 *
 * Every signed-in profile may follow one: `GET /api/account/resolve` decides
 * what it names for this account, and anything it cannot see reads "This is
 * not yours to open".
 */
export default function portfolioRoutes({ guard }) {
  return (
    <>
      <Route path="/c/*" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <PortfolioAddress />)} />
      <Route path="/p/*" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring'], <PortfolioAddress />)} />
    </>
  );
}
