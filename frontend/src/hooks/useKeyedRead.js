import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One read, keyed to what it was asked about (#4701).
 *
 * THE ANSWER BELONGS TO ITS KEY. Pressing "Last quarter" and then "Year to
 * date" starts two requests, and the network is free to answer them in the
 * other order; an effect that sets state when its request settles then leaves
 * the first chip's figures on screen under the second chip's name. Every read
 * here carries the generation it started in, and a reply from an earlier
 * generation — or from an earlier key — is dropped.
 *
 * FOUR STATES, NOT TWO. `loading` is the first read of a key with nothing to
 * show; `ready` has data; `unreadable` is a first read that failed (it is not
 * an empty result); and `refreshing` is a background re-read over data that is
 * already on screen. A background re-read that fails keeps the old data and
 * sets `refreshError`, so a hiccup does not blank a board the reader is using.
 *
 * @param {string|number|null} key  anything that changes what is being asked
 * @param {() => Promise<any>} read
 * @param {{enabled?: boolean}} [opts]
 */
export default function useKeyedRead(key, read, { enabled = true } = {}) {
  const [state, setState] = useState({ key, status: 'loading', data: null, refreshing: false, refreshError: false });
  const generation = useRef(0);
  const keyRef = useRef(key);
  keyRef.current = key;
  const readRef = useRef(read);
  readRef.current = read;

  const run = useCallback((forKey, { background }) => {
    const mine = (generation.current += 1);
    setState((s) => {
      if (background && s.key === forKey && s.status === 'ready') return { ...s, refreshing: true };
      return { key: forKey, status: 'loading', data: null, refreshing: false, refreshError: false };
    });
    Promise.resolve()
      .then(() => readRef.current())
      .then(
        (data) => {
          if (generation.current !== mine || keyRef.current !== forKey) return;
          setState({ key: forKey, status: 'ready', data, refreshing: false, refreshError: false });
        },
        () => {
          if (generation.current !== mine || keyRef.current !== forKey) return;
          setState((s) => (s.key === forKey && s.status === 'ready'
            ? { ...s, refreshing: false, refreshError: true }
            : { key: forKey, status: 'unreadable', data: null, refreshing: false, refreshError: false }));
        },
      );
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    run(key, { background: false });
    // Leaving the key retires whatever is still in flight for it.
    return () => { generation.current += 1; };
  }, [key, enabled, run]);

  const reload = useCallback(() => run(keyRef.current, { background: true }), [run]);
  // An optimistic edit over data already on screen; the next read replaces it.
  const mutate = useCallback((update) => setState((s) => (s.status === 'ready' ? { ...s, data: update(s.data) } : s)), []);
  // A state that belongs to another key has not answered for this one yet.
  const current = state.key === key ? state : { key, status: 'loading', data: null, refreshing: false, refreshError: false };
  return { status: current.status, data: current.data, refreshing: current.refreshing, refreshError: current.refreshError, reload, mutate };
}
