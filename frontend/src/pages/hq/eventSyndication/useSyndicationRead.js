/** D1491 (#3725) — guarded reads: failures remain Unreadable and stale replies never replace a new event. */
import { useCallback, useEffect, useState } from 'react';

export function useSyndicationRead(load, valid) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null, load });
    Promise.resolve().then(load).then((data) => {
      if (!valid(data)) throw new Error('The response was incomplete.');
      if (alive) setState({ status: 'ready', data, load });
    }).catch(() => { if (alive) setState({ status: 'error', data: null, load }); });
    return () => { alive = false; };
  }, [load, valid, tick]);
  const reload = useCallback(() => setTick((v) => v + 1), []);
  return { ...(state.load === load ? state : { status: 'loading', data: null }), reload };
}
