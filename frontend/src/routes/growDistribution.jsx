// D4484: explicit Distribution tabs outrank the existing Grow record route.
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';
const CycleRoute = lazy(() => import('../pages/cycles/CycleRoute'));
export default function growDistributionRoutes({ guard }) {
  return (
    <>
      <Route path="/grow/distribution/channels" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" slug="distribution" tab="channels" />)} />
      <Route path="/grow/distribution/campaigns" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" slug="distribution" tab="campaigns" />)} />
      <Route path="/grow/distribution/campaigns/new" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" slug="distribution" tab="campaigns" />)} />
      <Route path="/grow/distribution/campaigns/:uid" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" slug="distribution" tab="campaigns" />)} />
      <Route path="/grow/distribution/calendar" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" slug="distribution" tab="calendar" />)} />
      <Route path="/grow/distribution/ads" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" slug="distribution" tab="ads" />)} />
      <Route path="/grow/distribution/newsletter" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" slug="distribution" tab="newsletter" />)} />
      <Route path="/grow/distribution/prospects" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" slug="distribution" tab="prospects" />)} />
      <Route path="/grow/distribution/inbox" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" slug="distribution" tab="inbox" />)} />
      <Route path="/grow/distribution/results" element={guard(['admin', 'founder'], <CycleRoute cycle="grow" slug="distribution" tab="results" />)} />
    </>
  );
}
