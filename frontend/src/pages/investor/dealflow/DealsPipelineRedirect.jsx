import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { fireAnalytics } from '../../../lib/seo';
import { redirectKey } from '../../../../../cloudflare-worker/src/services/redirectRoutes.ts';
import { pipelineMovedHref } from './dealFlowModel';

/**
 * D1243 (#3256, part 7 of #2423) — the Pipeline zone is retired: its job is
 * Deal flow's table. `/deals/pipeline` and an investor's `/pipeline` land on
 * `/deals?view=table`, the query and hash kept (`pipelineMovedHref`).
 *
 * Counting (#2301): `/deals/pipeline` is a redirect for everyone, so the
 * address bar's beacon counts it. `/pipeline` is still a page for a partner,
 * a founder and an admin, so the address bar never counts it, and this
 * forward sends its key itself (`countAs`, a ROLE_REDIRECTS pattern) until
 * #2319 retires it.
 */
export default function DealsPipelineRedirect({ countAs = null, send = fireAnalytics }) {
  const { search, hash } = useLocation();
  useEffect(() => { if (countAs) send(redirectKey(countAs)); }, [countAs, send]);
  return <Navigate to={pipelineMovedHref(search, hash)} replace />;
}
