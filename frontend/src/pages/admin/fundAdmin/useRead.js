import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One read for a tab: `loading`, `ready` with its data, or `unreadable` with
 * the failure. A read that has not run (`enabled` false) stays `idle`, so a
 * branch admin's console makes no request at all.
 */
export function useRead(reader, deps, { enabled = true } = {}) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null, error: null });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(reader, deps);
  const reload = useCallback(async () => {
    if (!enabled) return;
    setState((s) => ({ ...s, status: s.data == null ? 'loading' : s.status }));
    try {
      const data = await run();
      if (alive.current) setState({ status: 'ready', data, error: null });
    } catch (error) {
      if (alive.current) setState({ status: 'unreadable', data: null, error });
    }
  }, [run, enabled]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
