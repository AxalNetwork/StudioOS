// D4666 (#4666) — reads the estimate for the operation on screen and ignores every late answer for another one.
import { useCallback, useEffect, useRef, useState } from 'react';
import { gateOf, operationKey } from './estimateGate.js';

/**
 * `fetcher()` asks the server to estimate the operation `op` (a plain object naming everything that
 * changes what runs). The gate is derived from `op` at render time, so the moment `op` changes the old answer
 * is no answer. `accept(estimate)` takes the fresh estimate a refused run came back with.
 */
export function useOperationEstimate(fetcher, op, { enabled = true, debounceMs = 0 } = {}) {
  const key = enabled && op ? operationKey(op) : null;
  const [result, setResult] = useState(null);
  const [tick, setTick] = useState(0);
  const ask = useRef(fetcher);
  ask.current = fetcher;

  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      Promise.resolve().then(() => ask.current())
        .then((r) => { if (live) setResult({ key, estimate: r?.estimate ?? null, error: null }); })
        .catch((e) => { if (live) setResult({ key, estimate: null, error: e?.message || 'The estimate could not be read. Try again.' }); });
    }, debounceMs);
    return () => { live = false; clearTimeout(timer); };
  }, [key, tick, debounceMs]);

  const retry = useCallback(() => { setResult(null); setTick((n) => n + 1); }, []);
  const accept = useCallback((estimate) => { if (key) setResult({ key, estimate, error: null }); }, [key]);
  return { ...gateOf(result, key), retry, accept };
}
