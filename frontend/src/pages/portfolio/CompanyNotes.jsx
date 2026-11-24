import React, { useCallback, useEffect, useRef, useState } from 'react';
import { portfolioNotesApi } from '../../lib/api/portfolioNotes';
import { dayOf } from '../investor/portfolioReportsModel';
import { Skeleton, SourceFailure } from './PortfolioParts';

/**
 * D6222 (#6222) — the investor's own notes on one portfolio company, on the
 * company workspace's Overview (`/api/portfolio-notes`, routes/portfolio_notes.ts).
 * Only the author reads them; the company and other investors never do. Each
 * note shows the day it was written and, once edited, the day of its last
 * edit. A note saved from Eadwyn's What changed says so.
 *
 * States: loading; Unreadable with a Retry (never "no notes"); none yet; the
 * list with add, edit and delete. A save that fails keeps the text in its box
 * with the Worker's sentence for the refusal's code. A support session reads
 * the notes and is shown why it cannot write. Delete asks in the page first;
 * nothing here is a browser pop-up.
 */

/** One sentence per refusal code the notes router gives (`NOTE_REFUSALS` in routes/portfolio_notes.ts). */
export const NOTE_SENTENCES = {
  not_found: 'This company is not one you hold or are owed reports by, so no note was saved.',
  note_not_found: 'That note is no longer here. It may have been deleted in another window.',
  invalid_note: 'Write a note of 1 to 10,000 characters.',
  invalid_source: 'What changed could not name the two reports it compared. Your text is kept; save it as a plain note.',
  source_not_received: 'Those reports are not ones this company sent you, so the note was not saved.',
  too_many_notes: 'You keep 500 notes on this company. Delete one to add another.',
  support_session_refused: 'A support session cannot write an investor’s notes.',
  notes_refused: 'This account cannot keep notes here.',
  notes_unreadable: 'Your notes could not be read. Try again.',
  note_write_failed: 'The note could not be saved. Nothing was changed. Try again.',
};
const FALLBACK = 'The note could not be saved. Your text is kept. Try again.';
export const noteSentence = (err) => NOTE_SENTENCES[err?.code] || FALLBACK;
export const NOTE_MAX = 10000;

/** The notes read and its writes, shared by the Notes card and What changed's "Save as my note". */
export function useCompanyNotes(uid) {
  const [state, setState] = useState({ status: 'loading', items: [], canWrite: false, refusal: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    portfolioNotesApi.list(uid).then(
      (r) => {
        if (!alive) return;
        // A read that answers without a list is not "no notes".
        if (!Array.isArray(r?.items)) { setState({ status: 'unreadable', items: [], canWrite: false, refusal: null }); return; }
        setState({ status: 'ready', items: r.items, canWrite: r.can_write !== false, refusal: r.write_refusal || null });
      },
      () => { if (alive) setState({ status: 'unreadable', items: [], canWrite: false, refusal: null }); },
    );
    return () => { alive = false; };
  }, [uid, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const create = useCallback(async (body) => {
    const r = await portfolioNotesApi.create(uid, body);
    if (r?.note) setState((s) => ({ ...s, items: [r.note, ...s.items.filter((n) => n.uid !== r.note.uid)] }));
    return r?.note || null;
  }, [uid]);
  const edit = useCallback(async (noteUid, body) => {
    const r = await portfolioNotesApi.edit(noteUid, body);
    if (r?.note) setState((s) => ({ ...s, items: s.items.map((n) => (n.uid === noteUid ? r.note : n)) }));
    return r?.note || null;
  }, []);
  const remove = useCallback(async (noteUid) => {
    await portfolioNotesApi.remove(noteUid);
    setState((s) => ({ ...s, items: s.items.filter((n) => n.uid !== noteUid) }));
  }, []);
  return { ...state, reload, create, edit, remove };
}

/** The dates a note carries, from the stored row. */
export function noteDates(n) {
  const written = dayOf(n?.created_at);
  const edited = n?.edited ? dayOf(n?.updated_at) : null;
  return [written ? `Written ${written}` : 'Written on a day not recorded', edited ? `edited ${edited}` : null].filter(Boolean).join(' · ');
}

function NoteBox({ id, value, onChange, label, testid, boxRef }) {
  return (
    <>
      <label className="pf-sm" htmlFor={id}>{label}</label>
      <textarea id={id} ref={boxRef} className="pf-co-note-box" rows={4} maxLength={NOTE_MAX} value={value}
        onChange={(e) => onChange(e.target.value)} data-testid={testid} />
    </>
  );
}

function NoteRow({ note, notes, canWrite }) {
  const [mode, setMode] = useState('read');
  const [text, setText] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try { await notes.edit(note.uid, text); setMode('read'); } catch (e) { setError(noteSentence(e)); } finally { setBusy(false); }
  };
  const del = async () => {
    setBusy(true); setError('');
    try { await notes.remove(note.uid); } catch (e) { setError(noteSentence(e)); setBusy(false); }
  };
  return (
    <li className="pf-co-note" data-testid={`company-note-${note.uid}`}>
      {mode === 'edit' ? (
        <div className="pf-co-note-form">
          <NoteBox id={`note-edit-${note.uid}`} label="Edit your note" value={text} onChange={setText} testid={`input-company-note-${note.uid}`} />
          {error ? <p className="pf-co-note-error" role="alert" data-testid={`company-note-error-${note.uid}`}>{error}</p> : null}
          <div className="pf-co-note-acts">
            <button type="button" className="pf-btn is-primary" disabled={busy || !text.trim()} onClick={save} data-testid={`button-save-company-note-${note.uid}`}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="pf-btn" disabled={busy} onClick={() => { setMode('read'); setText(note.body); setError(''); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className="pf-co-note-body" data-testid={`company-note-body-${note.uid}`}>{note.body}</p>
          <span className="pf-muted" data-testid={`company-note-dates-${note.uid}`}>
            {noteDates(note)}{note.source?.kind === 'what_changed' ? ' · from What changed' : ''}
          </span>
          {error ? <p className="pf-co-note-error" role="alert" data-testid={`company-note-error-${note.uid}`}>{error}</p> : null}
          {canWrite ? (
            mode === 'confirm' ? (
              <div className="pf-co-note-acts" data-testid={`company-note-confirm-${note.uid}`}>
                <span className="pf-sm">Delete this note? This cannot be undone.</span>
                <button type="button" className="pf-btn" disabled={busy} onClick={del} data-testid={`button-confirm-delete-company-note-${note.uid}`}>{busy ? 'Deleting…' : 'Delete'}</button>
                <button type="button" className="pf-btn is-quiet" disabled={busy} onClick={() => setMode('read')}>Keep</button>
              </div>
            ) : (
              <div className="pf-co-note-acts">
                <button type="button" className="pf-btn" onClick={() => { setText(note.body); setMode('edit'); }} data-testid={`button-edit-company-note-${note.uid}`}>Edit</button>
                <button type="button" className="pf-btn is-quiet" onClick={() => setMode('confirm')} data-testid={`button-delete-company-note-${note.uid}`}>Delete</button>
              </div>
            )
          ) : null}
        </>
      )}
    </li>
  );
}

/**
 * The Notes card. `draft` is text handed over by What changed when its save
 * failed ({ text, source, error }), so it is kept in the box with the reason.
 */
export function CompanyNotes({ notes, draft = null }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const box = useRef(null);
  useEffect(() => {
    if (!draft) return;
    setText(draft.text); setSource(draft.source || null); setError(draft.error || '');
    if (box.current && typeof box.current.focus === 'function') box.current.focus();
  }, [draft]);
  const add = async () => {
    setBusy(true); setError('');
    try {
      await notes.create({ body: text, ...(source || {}) });
      setText(''); setSource(null);
    } catch (e) { setError(noteSentence(e)); } finally { setBusy(false); }
  };
  let body;
  if (notes.status === 'loading') body = <div data-testid="company-notes-loading"><Skeleton rows={1} /></div>;
  else if (notes.status === 'unreadable') {
    body = <SourceFailure what="Your notes" claim="This is not a claim that you have none." onRetry={notes.reload} testid="company-notes-unreadable" retryTestid="button-retry-company-notes" />;
  } else {
    body = (
      <>
        {notes.items.length ? (
          <ul className="pf-co-notes" data-testid="company-notes-list">
            {notes.items.map((n) => <NoteRow key={n.uid} note={n} notes={notes} canWrite={notes.canWrite} />)}
          </ul>
        ) : <p className="pf-note" data-testid="company-notes-none">You have no notes on this company yet.</p>}
        {notes.canWrite ? (
          <div className="pf-co-note-form" data-testid="company-note-add">
            <NoteBox id="company-note-new" boxRef={box} label={source ? 'New note · from What changed' : 'New note'} value={text} onChange={setText} testid="input-company-note-new" />
            {error ? <p className="pf-co-note-error" role="alert" data-testid="company-note-add-error">{error}</p> : null}
            <div className="pf-co-note-acts">
              <button type="button" className="pf-btn is-primary" disabled={busy || !text.trim()} onClick={add} data-testid="button-add-company-note">{busy ? 'Saving…' : 'Add note'}</button>
            </div>
          </div>
        ) : <p className="pf-foot" data-testid="company-notes-readonly">{notes.refusal || NOTE_SENTENCES.support_session_refused}</p>}
      </>
    );
  }
  return (
    <section className="pf-card" aria-labelledby="pf-co-notes" data-testid="company-notes">
      <div className="pf-card-head">
        <h2 className="pf-h2" id="pf-co-notes">Your notes</h2>
        <span className="pf-sm">Private · only you can read them</span>
      </div>
      {body}
      <p className="pf-foot">The company and other investors never see these notes. Nothing here is sent.</p>
    </section>
  );
}
