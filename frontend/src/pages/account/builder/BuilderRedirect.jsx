/** D1315 — /account/developer… is /account/builder…, the sub-path, query and hash kept. */
import { Navigate, useLocation } from 'react-router-dom';
import { BUILDER_ROOT, legacyBuilderPath } from './builderModel';

export function BuilderRedirect() {
  const loc = useLocation();
  return <Navigate to={{ pathname: legacyBuilderPath(loc.pathname) ?? BUILDER_ROOT, search: loc.search, hash: loc.hash }} replace />;
}
