import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { fireAnalytics } from '../../../lib/seo';
import { redirectKey } from '../../../../../cloudflare-worker/src/services/redirectRoutes.ts';
import { fundOpsTarget } from './fundAdminModel';

/**
 * D1160 (#3067, FND16) — Fund Ops is retired. An admin who opens `/funds` or
 * `/funds/performance` (not in investor view) lands on Fund administration,
 * with "Fund Ops is now Fund administration, under Fund admin.", the query
 * and hash kept. An investor's `/funds` is a page, so the address-bar beacon
 * never counts it; this forward counts each admin's opening itself, under the
 * route's pattern (#2301's ROLE_REDIRECTS), until #2319 retires it.
 */
export default function FundOpsRedirect({ send = fireAnalytics }) {
  const { pathname, search, hash } = useLocation();
  const pattern = String(pathname).replace(/\/+$/, '') === '/funds/performance' ? '/funds/performance' : '/funds';
  useEffect(() => { send(redirectKey(pattern)); }, [pattern, send]);
  return <Navigate to={fundOpsTarget(pathname, search, hash)} replace />;
}
