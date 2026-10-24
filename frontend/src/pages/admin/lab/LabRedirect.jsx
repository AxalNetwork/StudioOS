import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LAB_PATH, movedTarget } from './labModel';

/**
 * D937 (#2374, #2375's redirect rules) — the Lab's old addresses forward to
 * /admin/programs/spinout-lab before any old console mounts. The query and
 * the hash travel, and `?moved=spinout-lab` shows "Spin-Out Lab has a new
 * address. Update your bookmark." under the title.
 *
 *   /admin/spinout-lab          → /admin/programs/spinout-lab  (this file)
 *   /admin/spinout-lab/preview  → /admin/programs/spinout-lab/preview  (LabPreviewRedirect)
 *
 * /admin/spinout-lab is kept for good (#2375): in-app and email notices sent
 * before the move carry it. The redirect is not guarded; the page it lands on
 * is, by guard(['admin']).
 */
export default function LabRedirect() {
  const loc = useLocation();
  return <Navigate to={movedTarget(LAB_PATH, loc.search, loc.hash, 'spinout-lab')} replace />;
}
