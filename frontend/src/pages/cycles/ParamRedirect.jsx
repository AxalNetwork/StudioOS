import { Navigate, useLocation, useParams } from 'react-router-dom';

/**
 * D696 (#1658, decision 13): an old or canvas-slug address that names a
 * record redirects to the app's, keeping the query and the hash. `to` names
 * the route's params as `:name`; each is filled from `useParams()` through
 * `encodeURIComponent`, so an id can never add a path segment. App.jsx
 * re-exports it beside `HistoryRedirect`; it lives here so a test can mount it.
 */
export function ParamRedirect({ to }) {
  const location = useLocation();
  const params = useParams();
  const pathname = String(to).replace(/:([A-Za-z_]\w*)/g, (_, name) => encodeURIComponent(params[name] ?? ''));
  return <Navigate replace to={{ pathname, search: location.search, hash: location.hash }} />;
}

export default ParamRedirect;
