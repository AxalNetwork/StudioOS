import React, { useCallback, useRef, useState } from 'react';
import { ghostButtonClass } from '../kit';

/**
 * Offers · one way to write a record and tell the truth about it (#4688).
 *
 * Visibility, Proof and Audience fit each wrote through their own `run()`, and
 * each `run()` caught the failure and returned normally. The caller's cleanup
 * (`setAdding(false)`, reset the fields, close the row editor) came after the
 * await, so it ran whether the write had persisted or not: a refused save
 * closed the form and threw away what the partner had typed. This hook is the
 * one place that decides what "saved" means.
 *
 * THE CONTRACT.
 *
 *   `save(write, { scope, saved, onSaved })`
 *
 *   - `write` is an async function that performs ONE write and throws if it
 *     did not persist. It is kept on the failure note, so Retry repeats exactly
 *     that write without the partner retyping anything.
 *   - `onSaved` is the success cleanup (close the editor, reset the fields).
 *     It runs ONLY after `write` resolved, and it runs on a Retry too, because
 *     it belongs to the save rather than to the click that started it.
 *   - The editor stays mounted and every field stays filled on failure; the
 *     note names the failure beside the form.
 *   - `load` is the zone's refresh and must resolve to true/false rather than
 *     throw. A write that persisted but whose refresh failed is a DIFFERENT
 *     result from a write that failed: the note says it saved, offers only a
 *     reload of the read, and never offers the write again, because offering
 *     it again is how a duplicate gets created.
 *
 * `reload` is the zone's own `load` plus one rule: a read that succeeds clears
 * the "saved, could not refresh" note, so an old warning cannot outlive the
 * read it was about.
 */
export function useGuardedWrite(load) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const save = useCallback(async (write, opts = {}) => {
    const { scope, saved = 'Saved.', onSaved, failed = 'That did not save.' } = opts;
    setBusy(true);
    setNote(null);
    try {
      await write();
    } catch (e) {
      setNote({
        ok: false, scope, text: e?.message || failed,
        retry: () => save(write, opts),
      });
      setBusy(false);
      return { ok: false };
    }
    // Persisted. Everything below is about the READ, never about the write.
    try { onSaved?.(); } catch { /* cleanup must not turn a saved write into a failure */ }
    const refreshed = await loadRef.current();
    setNote(refreshed
      ? { ok: true, scope, text: saved }
      : {
        ok: true, scope, refreshFailed: true,
        text: `${saved.replace(/\.$/, '')}. The list could not be refreshed, so it may not show this yet. Nothing needs to be done again: reload it.`,
      });
    setBusy(false);
    return { ok: true, refreshed };
  }, []);

  const reload = useCallback(async () => {
    const ok = await loadRef.current();
    if (ok) setNote((n) => (n?.refreshFailed ? null : n));
    return ok;
  }, []);

  const clearNote = useCallback(() => setNote(null), []);

  return { busy, note, save, reload, clearNote };
}

/** The note that belongs to one form or row; a saved-but-unrefreshed note is the zone's. */
export const scopedNote = (note, scope) => (note && note.scope === scope && !note.refreshFailed ? note : null);

/** The note the zone itself shows: a refresh that failed, or the first record being added. */
export const zoneNote = (note) => (note && (note.refreshFailed || (note.ok && note.scope === 'new')) ? note : null);

/**
 * The note, with the one button its state allows. A failed write offers Retry
 * (the same write). A saved write whose refresh failed offers Reload and
 * nothing that writes. A plain success offers nothing.
 */
export function WriteNote({ note, busy = false, onReload }) {
  if (!note) return null;
  const tone = !note.ok
    ? 'text-red-700 dark:text-red-300'
    : note.refreshFailed ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-300';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="write-note">
      <p role={note.ok ? 'status' : 'alert'} className={`text-[12px] font-semibold ${tone}`}>{note.text}</p>
      {!note.ok && note.retry && (
        <button type="button" className={ghostButtonClass} disabled={busy} onClick={() => note.retry()}>
          Retry
        </button>
      )}
      {note.refreshFailed && onReload && (
        <button type="button" className={ghostButtonClass} disabled={busy} onClick={() => onReload()}>
          Reload the list
        </button>
      )}
    </div>
  );
}
