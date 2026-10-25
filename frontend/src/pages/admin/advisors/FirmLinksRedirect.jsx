import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AP_FIRMS_PATH, movedTarget } from './apModel';

/**
 * D952 (#2728, part 9 of #2370) — /admin/partner-invitations/firm-links was
 * D923's Firm links. Attaching a partner account to its firm now lives on the
 * Firms tab, so the old address forwards there, keeping the query and the hash
 * and adding `?moved=firm-links` for the moved notice. Not guarded; the page
 * it lands on is.
 */
export default function FirmLinksRedirect() {
  const loc = useLocation();
  return <Navigate to={movedTarget(AP_FIRMS_PATH, loc.search, loc.hash, 'firm-links')} replace />;
}
