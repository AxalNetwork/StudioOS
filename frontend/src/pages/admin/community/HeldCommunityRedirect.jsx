import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { COMMUNITY_PATH, MOVED_KEY } from './communityModel';

/**
 * D930 (#2367, #2375's redirect rules) — /admin/held/community was Community's
 * address until the page was rebuilt to its canvas. A bookmark keeps its query
 * and hash and gains `?moved=held-community`, which shows CM13's one-line
 * notice "Community has a new address. Update your bookmark." under the title.
 * The redirect is not guarded: the page it lands on is, by guard(['admin']).
 */
export default function HeldCommunityRedirect() {
  const loc = useLocation();
  const next = new URLSearchParams(loc.search);
  next.set('moved', MOVED_KEY);
  return <Navigate to={{ pathname: COMMUNITY_PATH, search: `?${next.toString()}`, hash: loc.hash }} replace />;
}
