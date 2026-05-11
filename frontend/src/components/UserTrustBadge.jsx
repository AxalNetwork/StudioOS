import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import TrustScoreBadge from './TrustScoreBadge';

// Task #39 — fetch + render a user's trust score (size=sm) inline on
// directory rows (partner marketplace, mentor list) for admin/investor/
// partner viewers. Mirrors DealTrustBadge from DealsPage.jsx: silently
// no-ops on missing userId, on a backend 403 (e.g. founder viewer), or
// when the listing row has no resolved user_id (legacy unlinked rows).
// Optional `viewerRole` short-circuits the network call for roles that
// the backend would reject anyway, avoiding one wasted XHR per row.
export default function UserTrustBadge({ userId, viewerRole }) {
  const [data, setData] = useState(null);
  const allowed = !viewerRole || ['admin', 'investor', 'partner'].includes(viewerRole);
  useEffect(() => {
    let cancelled = false;
    setData(null); // clear stale score when userId / role changes
    if (!userId || !allowed) return;
    api.trustScore(userId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, allowed]);
  if (!allowed || !data) return null;
  return <TrustScoreBadge size="sm" score={data.score} missing={data.missing} label="Trust" />;
}
