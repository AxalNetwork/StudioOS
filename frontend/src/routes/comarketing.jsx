/** D4439 (#4439) — founder co-marketing lives inside Grow › Partner network. */
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const FounderCoMarketingPage = lazy(() => import('../pages/founder/FounderCoMarketingPage'));

export default function comarketingRoutes({ guard, user }) {
  return (
    <>
      <Route path="/grow/partner-network/co-marketing" element={guard(['admin', 'founder'], <FounderCoMarketingPage user={user} />)} />
    </>
  );
}
