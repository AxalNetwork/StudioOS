import { useEffect, useState } from 'react';
import { reportError } from '../../lib/log';

/**
 * One read's state, in the four words every Learning surface draws (D562):
 *
 *   { status: 'loading' }
 *   { status: 'ready', ...data }      the reply, mapped by the read
 *   { status: 'missing', message }    a 404: no such course or item, or one
 *                                     the caller may not see (the route
 *                                     answers both alike, D557)
 *   { status: 'unreadable', message } any other failure: never an empty list
 *   { status: 'idle' }                not asked for (a closed tab)
 *
 * Returns `[state, retry, setState]`; `setState` lets a write put the reply it
 * got back in place of a second read. `scope` names the read in the error
 * report.
 */
export default function useLearningRead(load, deps, { enabled = true, scope = 'read' } = {}) {
  const [state, setState] = useState(() => (enabled ? { status: 'loading' } : { status: 'idle' }));
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' });
      return undefined;
    }
    let alive = true;
    setState({ status: 'loading' });
    load().then(
      (data) => { if (alive) setState({ status: 'ready', ...data }); },
      (err) => {
        if (!alive) return;
        if (err?.status === 404) {
          setState({ status: 'missing', message: err.message || '' });
          return;
        }
        reportError(`Learning:${scope}`, err);
        setState({ status: 'unreadable', message: err?.message || '' });
      },
    );
    return () => { alive = false; };
  }, [enabled, nonce, ...deps]);
  return [state, () => setNonce((n) => n + 1), setState];
}
