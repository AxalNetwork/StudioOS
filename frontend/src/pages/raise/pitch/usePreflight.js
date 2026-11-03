/**
 * D1370 (#3661, PF2–PF5) — one "Check before you send" run for the open
 * editor: each slide is drawn off screen at export size (`PreflightMeasure`
 * in `PreflightPanel.jsx`, one at a time so the panel can say "Checking slide
 * 7 of 12"), measured with `preflightMeasure.js`, then `runPreflight` reads
 * the deck as it was when the run started. The founder can keep editing; the
 * result then reads "Out of date" (`currentResult`), never silently re-run.
 *
 * The check reads and measures only: nothing on the slides changes.
 *
 * Dismissals (D4208, `BUILD.P1`) are the version's, kept on the Worker:
 * read when the editor opens a version, and written on Dismiss and Undo, so
 * every editor of that version sees them and a reload keeps them. The set is
 * changed at once; a write the Worker refuses takes the change back and says
 * so (`notKept`). A reader (`readOnly`) reads them and writes nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deckPreflightApi } from '../../../lib/api/deckPreflight';
import { reportError } from '../../../lib/log';
import { currentResult, runPreflight } from './preflightModel.js';
import { BUILD, chipOf, groupsOf } from './preflightUiModel.js';

export default function usePreflight({ deck, kit = null, refresh = null, readOnly = false, api = deckPreflightApi }) {
  const [running, setRunning] = useState(null);
  const [done, setDone] = useState(null);
  const doneRef = useRef(null);
  const [previous, setPrevious] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());
  const [notKept, setNotKept] = useState(null);
  const deckId = deck?.id ?? null;
  const version = deck?.version ?? null;

  // P1: the version's dismissals, read when it opens. Another version starts clean.
  useEffect(() => {
    setDismissed(new Set());
    setNotKept(null);
    if (!BUILD.P1.live || deckId == null || version == null) return undefined;
    let live = true;
    Promise.resolve(api.dismissals(deckId, version)).then(
      (r) => { if (live && Array.isArray(r?.dismissed)) setDismissed(new Set(r.dismissed.filter((x) => typeof x === 'string'))); },
      (e) => reportError('pitch-preflight:dismissals', e),
    );
    return () => { live = false; };
  }, [deckId, version, api]);

  const run = useCallback(() => {
    setRunning((r) => r || { snapshot: deck, done: 0, total: Array.isArray(deck?.slides) ? deck.slides.length : 0, measurements: {}, failed: [] });
  }, [deck]);

  /** One slide measured: `m` the slide's measurements, `failed` true when the page could not draw it. */
  const onMeasured = useCallback((index, m, failed) => {
    setRunning((r) => (r && r.done === index
      ? { ...r, done: r.done + 1, measurements: { ...r.measurements, ...(m || {}) }, failed: failed ? [...r.failed, index] : r.failed }
      : r));
  }, []);

  // Every slide measured: the result is for the deck as it was when the run started.
  useEffect(() => {
    if (!running || running.done < running.total) return;
    const result = runPreflight(running.snapshot, { kit, refresh, measurements: running.measurements, now: Date.now() });
    const was = doneRef.current;
    const next = { result, snapshot: running.snapshot, failed: running.failed, at: Date.now() };
    doneRef.current = next;
    setPrevious(was ? groupsOf(was.result, { slides: was.snapshot.slides, dismissed: new Set(), failed: was.failed }) : null);
    setDone(next);
    setRunning(null);
  }, [running, kit, refresh]);

  // `deck` is memoised by the editor, so the key (a hash of every slide) is worked out once per edit.
  const current = useMemo(() => Boolean(done && currentResult(done.result, deck)), [done, deck]);
  const groups = useMemo(() => (done ? groupsOf(done.result, { slides: done.snapshot.slides, dismissed, failed: done.failed }) : null), [done, dismissed]);
  const progress = running ? { done: running.done, total: running.total } : null;
  const chip = chipOf({ groups, current, running: progress });

  const add = (id) => (s) => new Set(s).add(id);
  const drop = (id) => (s) => { const n = new Set(s); n.delete(id); return n; };
  /** Dismiss (`on`) or Undo: changed here at once, then kept for the version; a refusal takes it back. */
  const keep = useCallback((id, on, severity) => {
    setNotKept(null);
    setDismissed(on ? add(id) : drop(id));
    if (!BUILD.P1.live || readOnly || deckId == null || version == null) return;
    Promise.resolve(api.setDismissed(deckId, { version, finding_id: id, dismissed: on, ...(severity ? { severity } : {}) })).then(
      () => {},
      (e) => { reportError('pitch-preflight:dismiss', e); setDismissed(on ? drop(id) : add(id)); setNotKept(id); },
    );
  }, [deckId, version, readOnly, api]);
  const dismiss = useCallback((id, severity) => keep(id, true, severity), [keep]);
  const undismiss = useCallback((id) => keep(id, false), [keep]);

  return {
    run, onMeasured, running, progress, result: done?.result ?? null, snapshot: done?.snapshot ?? null, at: done?.at ?? null,
    failed: done?.failed ?? [], current, groups, previous: current ? previous : null, chip, dismissed, dismiss, undismiss, notKept,
  };
}
