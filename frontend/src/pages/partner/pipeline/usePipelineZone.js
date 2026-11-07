/**
 * The read/write loop the four partner Pipeline zones share (#4685, D4685):
 * one loader that refreshes in the background, and one write helper that says
 * whether the write happened.
 *
 * WHY THIS IS A FILE AND NOT FOUR COPIES. Leads, Proposals, Negotiations and
 * Retainers each carried their own `load` and `run`, and both were wrong the
 * same way. `load` set `loading: true` on every call, so saving one record
 * swapped the whole zone for a skeleton and unmounted every open editor, which
 * threw away unsaved work in the others. `run` caught a failed write, printed
 * a note, and resolved normally, so the caller went on to clear and close the
 * form as if it had saved.
 *
 * - `load` shows the skeleton only while there is nothing to show. Once rows
 *   have arrived a later load is a background refresh: the rows and the
 *   mounted editors stay, and a refresh that fails keeps the last good rows.
 * - A response from an older load is dropped, so a slow read cannot overwrite
 *   a newer one.
 * - `run` resolves `true` only after the server accepted the write, and
 *   `false` otherwise. A caller clears or closes its inputs on `true` only.
 *   It never prints the server's own text: a failed write reads one fixed
 *   sentence, and the load error keeps the one reason a person can act on.
 * - One write at a time. A second call while one is in flight resolves `false`
 *   without sending anything.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isNoPartnerProfile } from '../kit';

export const WRITE_FAILED = 'That did not save. What you typed is still here, so try again.';
export const NO_PROFILE_LINE = 'No partner profile is linked to this account.';

export function usePipelineZone(fetcher, loadFailed) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const gen = useRef(0);
  const hasData = useRef(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /** Resolves `true` when this call's rows are the ones now on screen. */
  const load = useCallback(async () => {
    const mine = ++gen.current;
    if (!hasData.current) setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await fetchRef.current();
      if (!alive.current || mine !== gen.current) return false;
      hasData.current = true;
      setState({ loading: false, error: '', data: r || {} });
      return true;
    } catch (e) {
      if (!alive.current || mine !== gen.current) return false;
      // Keep the last good rows rather than blanking a zone over a failed refresh.
      if (hasData.current) return false;
      setState({
        loading: false,
        error: isNoPartnerProfile(e?.message) ? NO_PROFILE_LINE : loadFailed,
        data: null,
      });
      return false;
    }
  }, [loadFailed]);
  useEffect(() => { load(); }, [load]);

  /** One write. Resolves `true` only when the server accepted it. */
  const run = useCallback(async (fn, ok, scope) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setNote(null);
    let wrote = false;
    try {
      await fn();
      wrote = true;
    } catch {
      if (alive.current) setNote({ ok: false, text: WRITE_FAILED, scope });
    }
    if (wrote) {
      if (alive.current) setNote({ ok: true, text: ok, scope });
      const fresh = await load();
      if (!fresh && alive.current) {
        setNote({ ok: true, text: `${ok} The list did not refresh, so reload to see it.`, scope });
      }
    }
    busyRef.current = false;
    if (alive.current) setBusy(false);
    return wrote;
  }, [load]);

  return { state, load, run, busy, note };
}
