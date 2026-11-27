/**
 * D5206 (#5206) — one latest-request rule for personal and scoped Calendar.
 *
 * A read owns a stable key (scope + window). Only the newest request may
 * publish state. Navigation clears the old window; Refresh keeps a successful
 * window rendered and marks it `refreshing` until the replacement settles.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const EMPTY_CALENDAR_READ = Object.freeze({
  status: 'loading', items: null, sources: [], coverage: null, error: null,
  refreshing: false, key: null, window: null, requestId: 0,
});

export function calendarReadResult(result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const sources = Array.isArray(result?.sources) ? result.sources : [];
  const coverage = result?.coverage && typeof result.coverage === 'object' ? result.coverage : null;
  const partial = coverage?.complete === false || sources.some((source) => source?.ok === false || source?.truncated === true);
  return { status: partial ? 'partial' : 'ready', items, sources, coverage };
}

export class CalendarReadController {
  constructor(listener = () => {}) {
    this.listener = listener;
    this.state = { ...EMPTY_CALENDAR_READ };
    this.active = 0;
  }

  setListener(listener) { this.listener = listener; }

  publish(next) {
    this.state = next;
    this.listener(next);
  }

  cancel() { this.active += 1; }

  async read({ key, window, request, preserve = false }) {
    const requestId = this.active + 1;
    this.active = requestId;
    const keep = preserve && this.state.key === key && Array.isArray(this.state.items);
    this.publish(keep
      ? { ...this.state, refreshing: true, error: null, requestId }
      : { ...EMPTY_CALENDAR_READ, key, window, requestId });
    try {
      const result = await request();
      if (this.active !== requestId) return false;
      this.publish({ ...calendarReadResult(result), error: null, refreshing: false, key, window, requestId });
      return true;
    } catch (error) {
      if (this.active !== requestId) return false;
      const message = error?.message || 'The calendar could not be read.';
      this.publish(keep
        ? { ...this.state, refreshing: false, error: message, requestId }
        : { status: 'unreadable', items: null, sources: [], coverage: null, error: message, refreshing: false, key, window, requestId });
      return true;
    }
  }

  /** A provider/source retry uses the same request identity as a whole read. */
  async readPart({ key, window, request, optimistic, success, failure }) {
    const requestId = this.active + 1;
    this.active = requestId;
    const base = this.state.key === key ? this.state : { ...EMPTY_CALENDAR_READ, key, window };
    this.publish({ ...(optimistic ? optimistic(base) : base), refreshing: true, error: null, key, window, requestId });
    try {
      const result = await request();
      if (this.active !== requestId) return false;
      const next = success(this.state, result);
      this.publish({ ...next, refreshing: false, error: null, key, window, requestId });
      return true;
    } catch (error) {
      if (this.active !== requestId) return false;
      const next = failure ? failure(this.state, error) : this.state;
      this.publish({ ...next, refreshing: false, key, window, requestId });
      return true;
    }
  }
}

export function useCalendarRead({ key, window, request }) {
  const [state, setState] = useState(() => ({ ...EMPTY_CALENDAR_READ, key, window }));
  const controller = useRef(null);
  if (!controller.current) controller.current = new CalendarReadController(setState);
  controller.current.setListener(setState);

  useEffect(() => {
    const current = controller.current;
    current.read({ key, window, request, preserve: false });
    return () => current.cancel();
  }, [key, window, request]);

  const refresh = useCallback(() => controller.current.read({ key, window, request, preserve: true }), [key, window, request]);
  const readPart = useCallback((part) => controller.current.readPart({ ...part, key, window }), [key, window]);
  // Effects start after render. Mask a previous key immediately so navigation
  // never paints the old window under the new heading for even one frame.
  const visible = state.key === key ? state : { ...EMPTY_CALENDAR_READ, key, window };
  return { ...visible, refresh, readPart };
}
