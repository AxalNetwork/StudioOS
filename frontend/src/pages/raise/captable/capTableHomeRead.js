import { useCallback, useEffect, useState } from 'react';
import { capTableRecordApi } from '../../../lib/api/capTableRecord';
import { useAuth } from '../../../hooks/useAuthSync';
import { raiseReadState } from '../../../lib/raiseErrors.js';

/**
 * D5081 part 3 (#5081, RA-20) — the Cap table record read (D1017, `GET /api/captable/record/:projectId`) in a
 * small file of its own, so CycleRoute can hold it without loading the tool's step (D4574).
 *
 * Overview owns its page, and the module header's primary action (Record an issuance, Propose an issuance:
 * `homeAction` in `capTableModel.js`) is chosen from the same record read Overview draws, by the capability
 * map the record writes refuse from (D5074). `useCapTableHome` is that one read; CycleRoute calls it on the
 * module page and the tool's tabs and hands it to `CapTableOverview` (`home`). A null venture, or an
 * Explorer (who has no cap table, D1022), makes no read.
 */
export function useCapTableHome(projectId) {
  const { user } = useAuth() || {};
  const explorer = String(user?.role || '').toLowerCase() === 'exploring';
  const key = explorer ? null : projectId || null;
  const [n, setN] = useState(0);
  const [read, setRead] = useState({ status: 'loading', data: null, key });
  useEffect(() => {
    if (key == null) return undefined;
    let alive = true;
    setRead({ status: 'loading', data: null, key });
    Promise.resolve().then(() => capTableRecordApi.read(key))
      .then((data) => { if (alive) setRead({ status: 'ready', data, key }); })
      // D5079 (#5079): a refusal is not a failed read.
      .catch((error) => { if (alive) setRead({ status: raiseReadState(error, 'error'), data: null, error, key }); });
    return () => { alive = false; };
  }, [key, n]);
  const retry = useCallback(() => setN((x) => x + 1), []);
  // The frame before the effect runs still holds the previous venture's state: never draw it.
  const record = read.key === key ? { status: read.status, data: read.data, error: read.error } : { status: 'loading', data: null };
  return { record, retry };
}
