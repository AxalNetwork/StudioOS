/**
 * D5045 (#5045) — where keyboard focus goes around HQ Team's governed actions.
 *
 *   · An action form takes focus on its first field when it opens (`useFocusOnMount`).
 *   · Escape closes it, unless it is submitting (`escapeCloses`): a request in flight is never abandoned
 *     by a key press, because its answer still has to be shown.
 *   · Cancelling returns focus to the button that opened the form; finishing moves it to the line that
 *     says what happened. Both are asked for in the event handler and applied after the render that
 *     draws their target (`useFocusRequest`), because the opener is replaced while the form is open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** A ref whose element is focused once, when the component mounts. */
export function useFocusOnMount() {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus?.(); }, []);
  return ref;
}

/** A form's onKeyDown: Escape calls `close` when nothing is being submitted. */
export const escapeCloses = (busy, close) => (e) => {
  if (e?.key !== 'Escape' || busy || !close) return;
  e.preventDefault?.();
  e.stopPropagation?.();
  close();
};

/**
 * `[request, ask]`: `ask(target)` records which named element should take focus next. A component
 * passes `request` to `useFocusTargets` with its refs, which focuses the named one after the render.
 * Each ask is a new object, so asking for the same target twice focuses it twice.
 */
export function useFocusRequest() {
  const [request, setRequest] = useState(null);
  const ask = useCallback((target, key = null) => setRequest({ target, key }), []);
  return [request, ask];
}

/** Focuses `refs[request.target]` after the render that follows a request. */
export function useFocusTargets(request, refs) {
  useEffect(() => {
    if (!request) return;
    refs[request.target]?.current?.focus?.();
    // `refs` is rebuilt each render; only a new request should move focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
}
