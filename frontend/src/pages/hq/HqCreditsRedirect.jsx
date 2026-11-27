import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/**
 * #1412 — /hq/credits was #1399's copy of the credit rules page. D638's page at
 * /admin/credit-rules is the only one now; a bookmark keeps its query and hash.
 * The redirect is not guarded: the page it lands on is, by hqOnly.
 */
export default function HqCreditsRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/admin/credit-rules', search: loc.search, hash: loc.hash }} replace />;
}
