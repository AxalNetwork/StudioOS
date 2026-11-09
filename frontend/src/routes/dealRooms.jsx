import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const InvestorDealsRoutes = lazy(() => import('../workspaces/investor/InvestorDealsRoutes'));

/**
 * `/deals/rooms` — the deal rooms at their own route (D4815, #4815; the
 * owner's pick B, 2026-11-09). `InvestorDealsRoutes` answers it inside the
 * Deals shell, as it answers `/deals/compare` and the zones, so the page keeps
 * the bucket's heading, zone row and rail. Gated as the zones are: an admin
 * and an investor. The literal outranks `/deals/:dealId` in React Router, so
 * no deal page reads the word `rooms` as an id.
 */
export default function dealRoomsRoutes({ guard }) {
  return (
    <>
      <Route path="/deals/rooms" element={guard(['admin', 'investor'], <InvestorDealsRoutes />)} />
    </>
  );
}
