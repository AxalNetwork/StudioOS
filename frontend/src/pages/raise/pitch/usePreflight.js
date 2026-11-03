/**
 * D1370 (#3661, PF2–PF5) — one "Check before you send" run for the open
 * editor: each slide is drawn off screen at export size (`PreflightMeasure`
 * in `PreflightPanel.jsx`, one at a time so the panel can say "Checking slide
 * 7 of 12"), measured with `preflightMeasure.js`, then `runPreflight` reads
 * the deck as it was when the run started. The founder can keep editing; the
 * result then reads "Out of date" (`currentResult`), never silently re-run.
 *
 * It reads and measures only: no fetch, no write, nothing on the slides
 * changes. Dismissals are held here, per version, until P1 (#4208) keeps them
 * on the Worker (`BUILD.P1` in `preflightUiModel.js`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { currentResult, runPreflight } from './preflightModel.js';
import { chipOf, groupsOf } from './preflightUiModel.js';

export default function usePreflight({ deck, kit = null, refresh = null }) {
  const [running, setRunning] = useState(null);
  const [done, setDone] = useState(null);
  const doneRef = useRef(null);
  const [previous, setPrevious] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());

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

  const dismiss = useCallback((id) => setDismissed((s) => new Set(s).add(id)), []);
  const undismiss = useCallback((id) => setDismissed((s) => { const n = new Set(s); n.delete(id); return n; }), []);

  return {
    run, onMeasured, running, progress, result: done?.result ?? null, snapshot: done?.snapshot ?? null, at: done?.at ?? null,
    failed: done?.failed ?? [], current, groups, previous: current ? previous : null, chip, dismissed, dismiss, undismiss,
  };
}
