import { Navigate, useLocation } from 'react-router-dom';
import { validateZoneTarget } from './validateRedirects';

/**
 * D704 (#1666, decision 1): a retired Validate page (`interviews`,
 * `pain-map`, `hypotheses`) lands on the module that holds its work now, the
 * rest of the query and the hash kept (`validateRedirects.js`). App.jsx
 * re-exports it beside `HistoryRedirect`; it lives here so a test can mount
 * it. #1666's PR 2b and closing PR mount it on the three addresses.
 */
export function ValidateZoneRedirect({ zone }) {
  const location = useLocation();
  return <Navigate replace to={validateZoneTarget(zone, location.search, location.hash)} />;
}

export default ValidateZoneRedirect;
