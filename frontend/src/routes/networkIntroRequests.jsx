/**
 * D9068 (#9068): the member side of introduction requests through Axal (D7673), to the approved canvases D7677
 * (requester readiness) and D7678 (external introduction requests). Every licence that has Network asks the same way.
 */
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const RequesterReadinessPage = lazy(() => import('../pages/introRequests/RequesterReadinessPage'));
const IntroRequestsDesk = lazy(() => import('../pages/introRequests/IntroRequestsDesk'));
const IntroRequestSheet = lazy(() => import('../pages/introRequests/IntroRequestSheet'));
const IntroRequestDetail = lazy(() => import('../pages/introRequests/IntroRequestDetail'));

export default function networkIntroRequestsRoutes({ guard }) {
  return (
    <>
      <Route path="/network/introductions/readiness" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <RequesterReadinessPage />)} />
      <Route path="/network/introductions/requests" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <IntroRequestsDesk />)} />
      <Route path="/network/introductions/requests/new" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <IntroRequestSheet />)} />
      <Route path="/network/introductions/requests/:uid" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <IntroRequestDetail />)} />
    </>
  );
}
