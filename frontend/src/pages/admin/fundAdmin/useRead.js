import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One read for a tab: `loading`, `ready` with its data, or `unreadable` with
 * the failure. A read that has not run (`enabled` false) stays `idle`, so a
 * branch admin's console makes no request at all.
 */
export function useRead(reader, deps, { enabled = true } = {}) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null, error: null });
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(reader, deps);
  const reload = useCallback(async () => {
    if (!enabled) return;
    const current = ++generation.current;
    setState({ status: 'loading', data: null, error: null });
    try {
      const data = await run();
      if (current === generation.current) setState({ status: 'ready', data, error: null });
    } catch (error) {
      if (current === generation.current) setState({ status: 'unreadable', data: null, error });
    }
  }, [run, enabled]);
  useEffect(() => { reload(); return () => { generation.current += 1; }; }, [reload]);
  return { ...state, reload };
}
