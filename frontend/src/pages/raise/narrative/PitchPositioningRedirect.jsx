import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { movedHref } from './narrativeModel';

/**
 * D911 (#2695) — /raise/pitch/positioning was the positioning workspace until
 * Positioning moved into the Investor narrative tool. A bookmark keeps its
 * query and hash and gains `?moved=positioning`, which shows NAR18's one-line
 * notice under the title. The redirect is not guarded: the Investor
 * narrative's own route is.
 */
export default function PitchPositioningRedirect() {
  const loc = useLocation();
  return <Navigate to={movedHref(loc.search, loc.hash)} replace />;
}
