/** D4439 (#4439) — only the founder's old address forwards and counts a D2301 hit. */
import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { fireAnalytics } from '../../lib/seo';
import { redirectKey } from '../../../../cloudflare-worker/src/services/redirectRoutes.ts';

export default function CoMarketingFounderRedirect({ send = fireAnalytics }) {
  const { search, hash } = useLocation();
  useEffect(() => { send(redirectKey('/comarketing')); }, [send]);
  return <Navigate to={{ pathname: '/grow/partner-network/co-marketing', search, hash }} replace />;
}
