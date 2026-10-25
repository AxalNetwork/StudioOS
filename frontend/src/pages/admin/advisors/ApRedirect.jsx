import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AP_DECK_PATH, movedTarget } from './apModel';

/**
 * D972 (#2369, #2375's redirect rules) — /admin/network-profiles was the
 * roster's bare address. It forwards to the Deck roster tab, where that
 * roster now lives, keeping the query and the hash and adding
 * `?moved=network-profiles`: "Mentor & partner network is now Advisors &
 * Partners, under Community." The Admin Console's ?tab=network-profiles
 * forwards the same way, in LegacyContractsRedirect. Not guarded; the page it
 * lands on is.
 */
export default function ApRedirect() {
  const loc = useLocation();
  return <Navigate to={movedTarget(AP_DECK_PATH, loc.search, loc.hash, 'network-profiles')} replace />;
}
