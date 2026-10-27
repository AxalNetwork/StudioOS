import { Navigate, useLocation } from 'react-router-dom';
import { movedTo } from './scenariosForecastModel';

/**
 * D1178 (#3105) — the old financial model's addresses (`/raise/capital/model`,
 * `/build/financials`) land on Use of funds › Runway › Forecast, the query and
 * hash kept, `?project=` as `?project_id=`, and `?moved=capital-model` naming
 * the notice Forecast shows once. Its own file, as `CapTableMovedRedirect` is,
 * so a redirect never loads the page it forwards to.
 */
export default function UseOfFundsMovedRedirect() {
  const loc = useLocation();
  return <Navigate replace to={{ ...movedTo(loc.search), hash: loc.hash }} />;
}
