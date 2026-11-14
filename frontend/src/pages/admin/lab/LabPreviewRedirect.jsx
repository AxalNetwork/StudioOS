import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LAB_PREVIEW_PATH, movedTarget } from './labModel';

/**
 * D937 (#2374) — /admin/spinout-lab/preview forwards to the founder-journey
 * preview at its new address, with the query, the hash and `?moved=spinout-lab`.
 * See LabRedirect.jsx for the Lab's own address.
 */
export default function LabPreviewRedirect() {
  const loc = useLocation();
  return <Navigate to={movedTarget(LAB_PREVIEW_PATH, loc.search, loc.hash, 'spinout-lab')} replace />;
}
