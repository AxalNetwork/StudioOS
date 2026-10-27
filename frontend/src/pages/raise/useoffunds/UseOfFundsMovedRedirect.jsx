import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { fireAnalytics } from '../../../lib/seo';
import { redirectKey } from '../../../../../cloudflare-worker/src/services/redirectRoutes.ts';
import { movedTo } from './scenariosForecastModel';

/**
 * D1178 (#3105) — the old financial model's addresses (`/raise/capital/model`,
 * `/build/financials`) land on Use of funds › Runway › Forecast, the query and
 * hash kept, `?project=` as `?project_id=`, and `?moved=capital-model` naming
 * the notice Forecast shows once. Its own file, as `CapTableMovedRedirect` is,
 * so a redirect never loads the page it forwards to.
 *
 * D1180 (#3107): `count` names a forward the address bar cannot count, because
 * its address is also a page (`/raise/capital?mode=workspace`, the retired
 * Capital workspace's default tab); it is a `FORWARD_REDIRECTS` entry.
 */
export default function UseOfFundsMovedRedirect({ count = null, send = fireAnalytics }) {
  const loc = useLocation();
  useEffect(() => { if (count) send(redirectKey(count)); }, [count, send]);
  return <Navigate replace to={{ ...movedTo(loc.search), hash: loc.hash }} />;
}
