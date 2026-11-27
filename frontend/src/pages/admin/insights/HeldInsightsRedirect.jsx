import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { INSIGHTS_PATH, MOVED_KEY } from './insightsModel';

/**
 * D893 (#2366, #2375's redirect rules) — /admin/held/insights was Insights'
 * address until the page was rebuilt to its canvas. A bookmark keeps its query
 * and hash and gains `?moved=held-insights`, which shows the one-line notice
 * "Insights has a new address. Update your bookmark." once, under the title.
 * The redirect is not guarded: the page it lands on is, by guard(['admin']).
 */
export default function HeldInsightsRedirect() {
  const loc = useLocation();
  const next = new URLSearchParams(loc.search);
  next.set('moved', MOVED_KEY);
  return <Navigate to={{ pathname: INSIGHTS_PATH, search: `?${next.toString()}`, hash: loc.hash }} replace />;
}
