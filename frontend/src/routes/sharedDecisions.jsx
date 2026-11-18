import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const SharedDecisionPage = lazy(() => import('../pages/SharedDecisionPage'));

/**
 * `/shared/decisions/:id` — D6862 (#6862, D6021 V20; owner answer Q2 A): the
 * read-only page where a named Operating Partner or investor reads the one
 * Validate decision a founder shared with them. A placeholder route until the
 * owner names one (Q2 A says "a route the owner names"). Signed in only; the
 * Worker (`GET /api/shared-decisions/:id`) decides who reads what, so the gate
 * here is sign-in and nothing else.
 */
export default function sharedDecisionsRoutes({ authOnly }) {
  return (
    <>
      <Route path="/shared/decisions/:id" element={authOnly(<SharedDecisionPage />)} />
    </>
  );
}
