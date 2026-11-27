/**
 * D9071 (#9071): distinct published people per organization for the organizations on screen, from
 * `GET /api/network/directory/organizations/people-counts`. A uid reads `undefined` while counting, its count
 * once read, and `null` when the read failed or the Worker left it out: never 0 for an unknown.
 */
import { useCallback, useEffect, useState } from 'react';
import { networkDirectoryApi } from '../../../lib/api/networkDirectory.js';

export function usePeopleCounts(uids, api = networkDirectoryApi) {
  const key = (uids || []).join(',');
  const [read, setRead] = useState({ key: '', state: 'loading', counts: {} });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) { setRead({ key, state: 'ready', counts: {} }); return undefined; }
    let live = true;
    setRead({ key, state: 'loading', counts: {} });
    api.peopleCounts(key.split(',')).then((out) => {
      if (!live) return;
      const got = out?.counts && typeof out.counts === 'object' ? out.counts : {};
      setRead({ key, state: 'ready', counts: Object.fromEntries(key.split(',').map((u) => [u, got[u] ?? null])) });
    }, () => {
      if (live) setRead({ key, state: 'error', counts: Object.fromEntries(key.split(',').map((u) => [u, null])) });
    });
    return () => { live = false; };
  }, [key, attempt, api]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // A count read for another page of organizations is never shown against this one.
  const counts = read.key === key ? read.counts : {};
  return { state: read.key === key ? read.state : 'loading', counts, retry };
}
