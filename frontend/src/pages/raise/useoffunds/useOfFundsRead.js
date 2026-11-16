import { useCallback, useEffect, useState } from 'react';
import { useOfFundsApi } from '../../../lib/api/useOfFunds';

/**
 * D1177 (#3104) — the Use of funds tool's reads, in a small file of their own (D5081, #5081) so
 * CycleRoute can hold Home's plan read without loading the tool's page step (D4574, H5).
 *
 * D5081: Home's plan read and its open dialog live in `useUseOfFundsHome`, which CycleRoute calls,
 * so the module header's primary action (Set raise & allocation, `homeAction`) and Home draw from
 * one read and open one Edit split. `UseOfFundsParts.jsx` re-exports `useRead` and `usePlan`.
 */

/** One read, its state and its retry. `read` is called with nothing; a null `key` makes no read. */
export function useRead(read, key) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (key == null) return undefined;
    let alive = true;
    setState((s) => ({ status: 'loading', data: s.data }));
    Promise.resolve().then(read)
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch((error) => { if (alive) setState({ status: 'unreadable', data: null, code: error?.code || null }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { ...state, reload };
}

/** The plan read (D1176's `GET /plan`). */
export const usePlan = (projectId, api = useOfFundsApi) => useRead(() => api.plan(projectId), projectId ? `plan:${projectId}` : null);

/** D5081: Home's plan read and its open dialog, shared by the module header and Home. No venture, no read. */
export function useUseOfFundsHome(projectId, api = useOfFundsApi) {
  const read = usePlan(projectId, api);
  const [dialog, setDialog] = useState(null);
  return { read, dialog, setDialog };
}
