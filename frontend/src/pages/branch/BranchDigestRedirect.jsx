/**
 * D473 — `/branch` opens Studio.
 *
 * The digest's three measured blocks are on the studio glance: the oldest
 * queue, the programme clock (with its zone, and the pending-account count
 * when one was recorded), and the share rate with no amount. `/branch/*`
 * stays. A bookmark's query string and hash travel, the same way the other
 * retired front doors do.
 */
import { Navigate, useLocation } from 'react-router-dom';

export default function BranchDigestRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/studio', search: loc.search, hash: loc.hash }} replace />;
}
