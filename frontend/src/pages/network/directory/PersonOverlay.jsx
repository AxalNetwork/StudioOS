/**
 * D9025 (#9025): the viewer's own private record on a directory person (D7676 NPD-02's dashed "Your
 * relationship" area): saved, and a private note. It reads and writes only the caller's own row
 * (`/api/network/directory/entries/:uid/overlay`); the Worker keys every statement to the caller, so
 * nothing here can show another member's overlay. A support session is refused by the Worker
 * (`support_session_refused`) and the area says so in plain words, with no control to press.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { networkDirectoryApi } from '../../../lib/api/networkDirectory.js';
import { DataState } from '../../../ui/Honesty.jsx';
import { GHOST, INK, MUTED, PRIMARY } from './DirectorySearch.jsx';
import { day, overlayFailure } from './directoryModel.js';

const NOTE_MAX = 2000;

export default function PersonOverlay({ uid, name, api = networkDirectoryApi }) {
  const noteId = useId();
  const [read, setRead] = useState({ state: 'loading', overlay: null, failure: null });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [saveError, setSaveError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setRead({ state: 'loading', overlay: null, failure: null });
    api.overlay(uid).then((out) => {
      if (!live) return;
      const overlay = out?.overlay || null;
      setRead({ state: 'ready', overlay, failure: null });
      setDraft(overlay?.private_note || '');
    }, (err) => {
      if (!live) return;
      setRead({ state: 'failed', overlay: null, failure: overlayFailure(err, 'read') });
    });
    return () => { live = false; };
  }, [uid, attempt, api]);

  const write = useCallback(async (run, done) => {
    setBusy(true); setSaveError(null); setSaid('');
    try {
      const out = await run();
      const overlay = out?.overlay || null;
      setRead({ state: 'ready', overlay, failure: null });
      setDraft(overlay?.private_note || '');
      setSaid(done);
    } catch (err) {
      const f = overlayFailure(err, 'write');
      if (f.kind === 'refused') setRead({ state: 'failed', overlay: null, failure: f });
      else setSaveError(f.text);
    } finally { setBusy(false); }
  }, []);

  const head = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className={`m-0 text-[14px] font-extrabold ${INK}`}>Your relationship</h3>
      <span className="text-[11px] font-bold uppercase tracking-[.06em] text-axal-violet dark:text-violet-300">Private to you</span>
    </div>
  );
  const frame = (body) => (
    <section aria-label="Your relationship, private to you" data-person-overlay={read.state}
      className="flex flex-col gap-3 rounded-[12px] border-[1.5px] border-dashed border-violet-300 bg-violet-50/40 p-4 dark:border-violet-700 dark:bg-violet-950/20">
      {head}{body}
    </section>
  );

  if (read.state === 'loading') return frame(<DataState state="loading" size="block" />);
  if (read.state === 'failed') {
    if (read.failure.kind === 'refused') {
      return frame(<DataState state="refused" size="block" claim={read.failure.text} data-overlay-refused="" />);
    }
    return frame(<DataState state="unavailable" size="block" announce="always" claim={`${read.failure.text} It is not a claim that you have none.`} onRetry={() => setAttempt((n) => n + 1)} retryLabel="Try again" />);
  }

  const o = read.overlay;
  const saved = !!o?.saved;
  const noteChanged = (draft.trim() || null) !== (o?.private_note || null);
  const tooLong = draft.trim().length > NOTE_MAX;
  return frame(<>
    {o ? (
      <dl className="m-0 grid grid-cols-[minmax(96px,auto)_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className={MUTED}>Saved</dt>
        <dd className={`m-0 ${INK}`}>{saved ? '✓ In your relationships' : '○ Not saved'}</dd>
        <dt className={MUTED}>Last changed</dt>
        <dd className={`m-0 font-mono ${INK}`}>{day(o.updated_at) || 'Not recorded'}</dd>
      </dl>
    ) : (
      <p className={`m-0 text-[12.5px] ${MUTED}`} data-no-private-record="">
        ○ No private record. You have not saved {name}. Saving keeps a note for you only; {name} is not contacted.
      </p>
    )}
    <div className="flex flex-wrap gap-2">
      {saved
        ? <button type="button" className={GHOST} disabled={busy} onClick={() => write(() => api.saveOverlay(uid, { saved: false }), `Removed ${name} from your relationships. Nobody was contacted.`)}>Remove from my relationships</button>
        : <button type="button" className={PRIMARY} disabled={busy} onClick={() => write(() => api.saveOverlay(uid, { saved: true }), `Saved ${name} to your relationships. Nobody was contacted.`)}>Save to my relationships</button>}
    </div>
    <div className="flex flex-col gap-1.5">
      <label htmlFor={noteId} className={`text-[12px] font-bold ${INK}`}>Private note <span className={`font-normal ${MUTED}`}>· only you can read it</span></label>
      <textarea id={noteId} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} aria-describedby={`${noteId}-count`}
        className="w-full rounded-[9px] border border-axal-hairline bg-white px-2.5 py-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
      <span id={`${noteId}-count`} className={`text-[11px] ${tooLong ? 'font-bold text-red-700 dark:text-red-400' : MUTED}`}>{draft.trim().length.toLocaleString('en-US')} of 2,000 characters</span>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={GHOST} disabled={busy || !noteChanged || tooLong}
          onClick={() => write(() => api.saveOverlay(uid, { private_note: draft.trim() || null }), 'Your private note is saved. Nobody else can read it.')}>Save note</button>
        {o ? <button type="button" className={GHOST} disabled={busy}
          onClick={() => write(() => api.clearOverlay(uid), `Your private record on ${name} is cleared.`)}>Clear my private record</button> : null}
      </div>
    </div>
    {saveError ? <DataState state="unavailable" announce="always" claim={saveError} data-overlay-save-failed="" /> : null}
    <p role="status" aria-live="polite" className={`m-0 min-h-[1em] text-[12px] ${INK}`}>{said}</p>
    <div className="flex flex-col gap-1 border-t border-axal-hairline pt-3 dark:border-gray-800">
      <h4 className={`m-0 text-[12.5px] font-extrabold ${INK}`}>Who on your team knows them</h4>
      <DataState state="not_recorded" reason="Teammates’ shared books are not linked to directory people yet." />
    </div>
  </>);
}
