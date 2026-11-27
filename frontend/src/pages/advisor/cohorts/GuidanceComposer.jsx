import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cohortGuidanceApi } from '../../../lib/api/advisorCohortGuidance.js';
import { createRequestGate } from './cohortModel';
import {
  SAVE_STATES, clearLocalDraft, guardedWrite, hasText, readLocalDraft, saveStateLine, validateWeek,
  writeFailure, writeLocalDraft,
} from './guidanceModel';

/**
 * D4813 (#4813, package 2) — the guidance composer (boards C6 and, at 390px, C14).
 *
 * Title, the selected cohort, an optional week, a plain-text body, a preview,
 * Save draft and Publish. Every save state is drawn in words and a glyph and
 * announced: unsaved, saving, saved, publishing, published, a week the cohort
 * does not have, a version conflict, a save that failed and a publish that
 * failed. A failure never clears the text.
 *
 * WHAT IS TYPED IS KEPT PER COHORT. Each change is written to local storage
 * under this cohort and this piece of guidance (`draftKey`), so moving to
 * another cohort and back finds it again; the provider remounts the composer
 * per cohort (`key`). A write in flight when the cohort changes is dropped on
 * arrival (`guardedWrite`), so cohort A's answer never lands in cohort B.
 *
 * A VERSION CONFLICT IS NEVER OVERWRITTEN SILENTLY. The Worker answers 409
 * with the guidance as it now stands; the composer keeps this text, offers to
 * compare, to load theirs, or to keep this one — which only takes the newer
 * version number, so the next save is a choice the advisor made.
 *
 * Plain text, deliberately: the repository has no rich-text editor and this
 * package adds no dependency for one.
 */
export default function GuidanceComposer({
  cycleId, cohortName, weekLimit, editing = null, currentCycle, onSaved, onClose,
}) {
  const uidInit = editing?.uid || null;
  const restored = useRef(readLocalDraft(cycleId, uidInit)).current;
  // A restored edit only counts when it was made against the version on screen;
  // otherwise the stored text is older than the guidance and would undo an edit.
  const useRestored = restored && (!editing || restored.baseVersion === Number(editing.version));
  const [title, setTitle] = useState(useRestored ? restored.title : (editing?.title || ''));
  const [body, setBody] = useState(useRestored ? restored.body : (editing?.body || ''));
  const [week, setWeek] = useState(useRestored ? restored.week : (editing?.week_number != null ? String(editing.week_number) : ''));
  const [uid, setUid] = useState(uidInit);
  const [version, setVersion] = useState(editing ? Number(editing.version) || 1 : null);
  const [isDraft, setIsDraft] = useState(editing ? editing.status === 'draft' : true);
  const [state, setState] = useState(useRestored && hasText(restored) ? 'unsaved' : 'idle');
  const [message, setMessage] = useState(useRestored && hasText(restored) ? 'Your unsaved text from this device was restored.' : '');
  const [weekError, setWeekError] = useState('');
  const [conflict, setConflict] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [stamp, setStamp] = useState('');
  const gate = useRef(createRequestGate()).current;
  const ids = { title: useId(), week: useId(), weekErr: useId(), body: useId(), head: useId() };
  const busy = state === 'saving' || state === 'publishing';
  const dirty = state === 'unsaved' || state === 'invalid' || state === 'failed_save' || state === 'failed_publish' || state === 'conflict';

  // Leaving with unsaved text asks first (C14). The text is also kept locally.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const keep = (next) => {
    writeLocalDraft(cycleId, uid, { title, body, week, baseVersion: version, ...next });
  };
  const change = (setter, field) => (e) => {
    setter(e.target.value);
    keep({ [field]: e.target.value });
    setState('unsaved'); setMessage('');
    if (field === 'week') setWeekError('');
  };

  const now = () => {
    try { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
  };

  const checkWeek = () => {
    const w = validateWeek(week, weekLimit);
    if (!w.ok) { setWeekError(w.message); setState('invalid'); setMessage(w.message); }
    return w;
  };

  const fail = (error, fallback) => {
    const f = writeFailure(error, fallback);
    setState(f.state);
    if (f.state === 'conflict') { setConflict(f.current); setMessage(''); return; }
    if (f.state === 'invalid') setWeekError(f.message);
    setMessage(f.message || (fallback === 'failed_publish'
      ? 'Guidance wasn’t published. Nothing was sent; your text is kept.'
      : 'This was not saved. Your text stays here.'));
  };

  /** Saves the text as a draft (or the edit of a published note); returns the item or null. */
  const save = async ({ asDraft }) => {
    const w = checkWeek();
    if (!w.ok) return null;
    if (!body.trim() && !(asDraft && title.trim())) {
      setState('failed_save'); setMessage('Write something first: a draft needs a title or a body.');
      return null;
    }
    const forCycle = cycleId;
    const forUid = uid;
    const payload = { title: title.trim() || null, body, week_number: w.week ?? '' };
    const r = await guardedWrite({
      gate, forCycle, currentCycle,
      write: () => (forUid
        ? cohortGuidanceApi.update(forUid, { ...payload, version })
        : cohortGuidanceApi.create(forCycle, { ...payload, week_number: w.week, draft: asDraft })),
    });
    const item = r.ok ? (r.result?.item || r.result) : null;
    // The text belongs to the cohort it was written for; it is cleared there
    // whether or not that cohort is still on screen.
    if (r.ok) clearLocalDraft(forCycle, forUid);
    if (!r.landed) return null;
    if (!r.ok) { fail(r.error, 'failed_save'); return null; }
    setUid(item.uid); setVersion(Number(item.version) || 1); setIsDraft(item.status === 'draft');
    setConflict(null); setComparing(false); setWeekError('');
    return item;
  };

  const saveDraft = async () => {
    setState('saving'); setMessage('');
    const item = await save({ asDraft: isDraft });
    if (!item) return;
    setStamp(now());
    setState('saved');
    setMessage(item.status === 'draft' ? 'Saved as a draft. Only you can see it.' : 'Your changes are saved.');
    onSaved?.(item);
  };

  const publish = async () => {
    const w = checkWeek();
    if (!w.ok) return;
    if (!body.trim()) { setState('failed_publish'); setMessage('Write the guidance before publishing it.'); return; }
    const wasDirty = dirty;
    setState('publishing'); setMessage('');
    const forCycle = cycleId;
    let item;
    if (!uid) {
      // A new note goes straight out: one write, published.
      const r = await guardedWrite({
        gate, forCycle, currentCycle,
        write: () => cohortGuidanceApi.create(forCycle, { title: title.trim() || null, body, week_number: w.week, draft: false }),
      });
      if (r.ok) clearLocalDraft(forCycle, null);
      if (!r.landed) return;
      if (!r.ok) { fail(r.error, 'failed_publish'); return; }
      item = r.result;
    } else {
      // A saved draft: its text first (if changed), then publish that version.
      const saved = wasDirty ? await save({ asDraft: true }) : { uid, version };
      // A save that failed has already said why (week, conflict, not saved).
      if (!saved) return;
      const r = await guardedWrite({
        gate, forCycle, currentCycle,
        write: () => cohortGuidanceApi.publish(saved.uid, Number(saved.version)),
      });
      if (!r.landed) return;
      if (!r.ok) { fail(r.error, 'failed_publish'); return; }
      item = r.result?.item;
    }
    setStamp(now());
    setState('published');
    setMessage(`Published to ${cohortName || 'this cohort'}.`);
    onSaved?.(item, { published: true });
    // The composer stays: a fresh note for this cohort, ready to write.
    setTitle(''); setBody(''); setWeek(''); setUid(null); setVersion(null); setIsDraft(true);
  };

  const loadTheirs = () => {
    if (!conflict) return;
    setTitle(conflict.title || ''); setBody(conflict.body || '');
    setWeek(conflict.week_number != null ? String(conflict.week_number) : '');
    setVersion(Number(conflict.version) || 1); setIsDraft(conflict.status === 'draft');
    clearLocalDraft(cycleId, uid);
    setConflict(null); setComparing(false); setState('saved'); setMessage('Their version is loaded. Your text was discarded.');
  };
  const keepMine = () => {
    if (!conflict) return;
    // Takes the newer version number only; nothing is written until Save.
    setVersion(Number(conflict.version) || 1);
    setConflict(null); setComparing(false); setState('unsaved');
    setMessage('Your text is kept. Saving now replaces their version, and the history keeps both.');
  };

  const line = saveStateLine(state, stamp);
  const meta = SAVE_STATES[state] || SAVE_STATES.idle;
  const publishLabel = uid && !isDraft ? null : `Publish to ${cohortName || 'this cohort'}`;
  const field = 'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 text-[13px] text-axal-ink focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
  const btn = 'inline-flex min-h-[48px] items-center justify-center rounded-lg px-4 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[36px]';

  return (
    <section
      aria-labelledby={ids.head}
      data-testid="guidance-composer"
      data-cohort={cycleId}
      data-state={state}
      // C14: full screen on a phone, a card beside the feed from md up.
      className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-white p-4 dark:bg-gray-950 md:static md:z-auto md:overflow-visible md:rounded-[12px] md:border md:border-axal-hairline md:p-4 md:dark:border-gray-800 md:dark:bg-gray-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={ids.head} className="text-[15px] font-extrabold tracking-tight">
          {uid ? (isDraft ? 'Edit draft' : 'Edit guidance') : 'New guidance'}
        </h3>
        <div className="flex items-center gap-2">
          <span
            role={meta.role}
            aria-live={meta.role === 'alert' ? 'assertive' : 'polite'}
            data-testid="guidance-save-state"
            className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${meta.role === 'alert'
              ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
              : 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'} ${line ? '' : 'sr-only'}`}
          >
            {line}
          </span>
          {onClose && (
            <button
              type="button"
              aria-label="Close the composer"
              onClick={() => {
                // eslint-disable-next-line no-alert
                if (dirty && !window.confirm('Close with unsaved text? It is kept on this device for this cohort.')) return;
                onClose();
              }}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-axal-hairline text-axal-muted hover:bg-axal-ground dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 md:h-8 md:w-8"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {message && (
        <p className={`mt-2 text-[12px] ${meta.role === 'alert' ? 'font-semibold text-red-700 dark:text-red-300' : 'text-axal-muted'}`}>
          {message}
        </p>
      )}

      {conflict && (
        <div role="alert" data-testid="guidance-conflict" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-bold">▲ This guidance changed somewhere else{conflict.updated_at ? ` (${String(conflict.updated_at).slice(11, 16)} UTC)` : ''}.</p>
          <p className="mt-1">Nothing was saved. Your text is kept below; compare and choose which to keep.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => setComparing((v) => !v)} aria-expanded={comparing} className={`${btn} border border-amber-300 bg-white text-amber-900 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-200`}>
              {comparing ? 'Hide comparison' : 'Compare'}
            </button>
            <button type="button" onClick={loadTheirs} className={`${btn} border border-amber-300 bg-white text-amber-900 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-200`}>
              Load their version
            </button>
            <button type="button" onClick={keepMine} className={`${btn} border border-amber-300 bg-white text-amber-900 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-200`}>
              Keep mine
            </button>
          </div>
          {comparing && (
            <div className="mt-3 grid gap-3 md:grid-cols-2" data-testid="guidance-compare">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em]">Theirs · version {conflict.version}</div>
                <p className="mt-1 font-bold">{conflict.title || 'Untitled'}</p>
                <p className="mt-1 whitespace-pre-wrap break-words">{conflict.body}</p>
              </div>
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em]">Yours · not saved</div>
                <p className="mt-1 font-bold">{title || 'Untitled'}</p>
                <p className="mt-1 whitespace-pre-wrap break-words">{body}</p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 space-y-3">
        <label className="block" htmlFor={ids.title}>
          <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Title</span>
          <input id={ids.title} type="text" maxLength={200} value={title} onChange={change(setTitle, 'title')}
            className={`${field} min-h-[44px] md:min-h-[36px]`} placeholder="Pricing test checklist" />
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Cohort</span>
            <p className="mt-1 flex min-h-[44px] items-center rounded-lg border border-axal-hairline bg-axal-ground px-2.5 text-[13px] font-bold dark:border-gray-700 dark:bg-gray-800 md:min-h-[36px]" data-testid="guidance-cohort">
              {cohortName || 'This cohort'}
            </p>
            <span className="mt-1 block text-[11px] text-axal-faint">Change the cohort in the header; this draft stays with {cohortName || 'this cohort'}.</span>
          </div>
          <label className="block" htmlFor={ids.week}>
            <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
              Week <span className="normal-case tracking-normal">· optional, 1–{weekLimit}</span>
            </span>
            <input
              id={ids.week} type="text" inputMode="numeric" value={week} onChange={change(setWeek, 'week')}
              aria-invalid={weekError ? 'true' : undefined}
              aria-describedby={weekError ? ids.weekErr : undefined}
              className={`${field} min-h-[44px] md:min-h-[36px] ${weekError ? 'border-red-500 dark:border-red-500' : ''}`}
              placeholder="General guidance"
            />
            {weekError && (
              <span id={ids.weekErr} role="alert" data-testid="guidance-week-error" className="mt-1 block text-[12px] font-semibold text-red-700 dark:text-red-300">
                ✕ {weekError}
              </span>
            )}
          </label>
        </div>

        <label className="block" htmlFor={ids.body}>
          <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Body</span>
          <textarea id={ids.body} rows={8} value={body} onChange={change(setBody, 'body')}
            className={`${field} min-h-[220px] py-2 md:min-h-[140px]`}
            placeholder="One thing every founder in this cohort should do or know." />
        </label>

        {previewing && (
          <div data-testid="guidance-preview" className="rounded-lg border border-dashed border-axal-hairline p-3 dark:border-gray-700">
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Preview · as founders would read it</div>
            <p className="mt-1.5 text-[14px] font-extrabold">{title.trim() || 'Untitled'}</p>
            <p className="mt-0.5 text-[11.5px] text-axal-faint">{cohortName || 'This cohort'} · {validateWeek(week, weekLimit).week ? `Week ${validateWeek(week, weekLimit).week}` : 'General'}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{body.trim() || 'Nothing written yet.'}</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 md:flex-row md:items-center md:justify-between">
        <button type="button" onClick={() => setPreviewing((v) => !v)} aria-pressed={previewing}
          className={`${btn} border border-axal-hairline text-axal-muted hover:bg-axal-ground dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800`}>
          {previewing ? 'Hide preview' : 'Preview'}
        </button>
        <div className="flex flex-col-reverse gap-2 md:flex-row">
          <button type="button" onClick={saveDraft} disabled={busy || Boolean(conflict)} data-testid="guidance-save"
            className={`${btn} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`}>
            {uid && !isDraft ? 'Save changes' : 'Save draft'}
          </button>
          {publishLabel && (
            <button type="button" onClick={publish} disabled={busy || Boolean(conflict)} data-testid="guidance-publish"
              className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800`}>
              {publishLabel}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
