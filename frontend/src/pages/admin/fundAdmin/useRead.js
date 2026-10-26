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
  const load = useCallback(async (reset) => {
    if (!enabled) { setState({ status: 'idle', data: null, error: null }); return; }
    const current = ++generation.current;
    // Refresh a recorded result in place; a new read identity must start empty.
    setState(previous => reset || previous.data == null
      ? { status: 'loading', data: null, error: null }
      : { ...previous, error: null });
    try {
      const data = await run();
      if (current === generation.current) setState({ status: 'ready', data, error: null });
    } catch (error) {
      if (current === generation.current) setState({ status: 'unreadable', data: null, error });
    }
  }, [run, enabled]);
  const reload = useCallback(() => load(false), [load]);
  useEffect(() => { load(true); return () => { generation.current += 1; }; }, [load]);
  return { ...state, reload };
}
