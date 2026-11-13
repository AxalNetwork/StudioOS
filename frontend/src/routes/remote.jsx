import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const RemotePage = lazy(() => import('../pages/raise/pitch/RemotePage'));

/**
 * `/remote` — D1581 (#3828, PR2 to PR4): the phone's side of Present's remote.
 * Open to every visitor so a signed-out phone sees "Sign in to Axal VC to
 * control this presentation" (PR2d) with its code kept; joining needs a member
 * who can open the deck, which the Worker checks.
 */
export default function remoteRoutes() {
  return (
    <>
      <Route path="/remote" element={<RemotePage />} />
    </>
  );
}
