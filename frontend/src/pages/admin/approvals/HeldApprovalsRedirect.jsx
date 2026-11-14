import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { MOVED_KEY, PATH } from './approvalsModel';

/**
 * D1038 (#2390, #2375's redirect rules) — /admin/held/approvals was Approvals'
 * address until the page was rebuilt to its canvas. A bookmark keeps its query
 * and hash and gains `?moved=held-approvals`, which shows "Approvals has a new
 * address. Update your bookmark." once, under the title. The redirect is not
 * guarded: the page it lands on is, by guard(['admin']).
 */
export default function HeldApprovalsRedirect() {
  const loc = useLocation();
  const next = new URLSearchParams(loc.search);
  next.set('moved', MOVED_KEY);
  return <Navigate to={{ pathname: PATH, search: `?${next.toString()}`, hash: loc.hash }} replace />;
}
