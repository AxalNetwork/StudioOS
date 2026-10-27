/**
 * D1152 (#3057) — DL14: your firm's notes on this deal (part 2's store), the
 * slot for Eadwyn's draft summary, and the deal's activity without other
 * investors' names (the Worker withholds them, D1152).
 *
 * WHO WRITES. Every member of your firm reads the notes; only a note's
 * author edits or deletes it (`author_user_id`, D1150). A new note is saved
 * from the form; an edit and a delete each open an in-page dialog that says
 * what changes. Nothing is ever a browser pop-up.
 */
import React, { useEffect, useState } from 'react';
import { Unreadable, actionPrimary, actionGhost, actionDanger } from '../../ui';
import { dealContextApi } from '../../lib/api/dealContext';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { CARD, EYE, SUB, H3, BTN_S } from './DealFrame';
import { EADWYN_DRAFT_WAITS, EMPTY, NOTE_MAX, NOTE_TAGS, noteError } from './dealFrameModel';
import Sheet from '../../ui/Sheet.jsx';

const FIELD = 'block w-full rounded-axal-xs border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const TAG = (on) => `inline-flex min-h-[28px] items-center rounded-axal-pill border px-3 text-[12px] font-semibold ${on
  ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300'
  : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`;

function TagPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tag">
      {NOTE_TAGS.map((t) => (
        <button key={t} type="button" role="radio" aria-checked={value === t} className={TAG(value === t)} onClick={() => onChange(value === t ? '' : t)}>{t}</button>
      ))}
    </div>
  );
}

function NoteDialog({ mode, note, dealId, onDone, onClose }) {
  const [body, setBody] = useState(note.body || '');
  const [tag, setTag] = useState(note.tag || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const del = mode === 'delete';
  const go = async () => {
    const bad = del ? null : noteError(body);
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr('');
    try {
      if (del) await dealContextApi.deleteNote(dealId, note.uid);
      else await dealContextApi.editNote(dealId, note.uid, { body: body.trim(), tag: tag || null });
      onDone();
    } catch (e) { setErr(e?.message || 'That did not save. Try again.'); } finally { setBusy(false); }
  };
  const title = del ? 'Delete this note?' : 'Edit your note';
  return (
    <Sheet label={title} title={title} onClose={onClose} testId={`deal-note-${mode}-dialog`}
      sub={del ? 'Your firm will no longer see it. This cannot be undone.' : 'Your firm sees the new text in place of the old.'}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={actionGhost} onClick={onClose}>Back</button>
          <button type="button" className={del ? actionDanger : actionPrimary} disabled={busy} onClick={go} data-testid={`deal-note-${mode}-confirm`}>{del ? 'Delete' : 'Save'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4">
        {del
          ? <p className="m-0 whitespace-pre-line text-[13px] text-axal-ink dark:text-gray-100">{note.body}</p>
          : (<>
            <textarea rows={5} maxLength={NOTE_MAX} value={body} onChange={(e) => setBody(e.target.value)} className={FIELD} aria-label="Note" />
            <TagPicker value={tag} onChange={setTag} />
          </>)}
        {err && <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{err}</p>}
      </div>
    </Sheet>
  );
}

function Notes({ dealId, userId }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [body, setBody] = useState('');
  const [tag, setTag] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // { mode, note }
  const load = () => {
    dealContextApi.notes(dealId).then((data) => setRead({ status: 'ready', data }))
      .catch((e) => { reportError('DealNotes:read', e); setRead({ status: 'unreadable' }); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealId]);
  const save = async () => {
    const bad = noteError(body);
    if (bad) { setErr(bad); return; }
    setBusy(true); setErr('');
    try {
      await dealContextApi.addNote(dealId, { body: body.trim(), tag: tag || null });
      setBody(''); setTag(''); load();
    } catch (e) { setErr(e?.message || 'That did not save. Try again.'); } finally { setBusy(false); }
  };
  const items = read.status === 'ready' ? read.data?.items || [] : [];
  return (
    <>
      <section className={`${CARD} flex flex-col gap-3 px-4 py-4`} data-testid="deal-note-form">
        <div className="flex items-center justify-between gap-3">
          <h3 className={H3}>Your notes</h3>
          {read.status === 'ready' && <span className={SUB}>{read.data?.total ?? items.length}</span>}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={EYE}>New note</span>
          <textarea rows={3} maxLength={NOTE_MAX} value={body} onChange={(e) => setBody(e.target.value)} className={FIELD} placeholder="Write a note…" data-testid="deal-note-body" />
        </label>
        <div className="flex flex-col gap-1.5"><span className={EYE}>Tag</span><TagPicker value={tag} onChange={setTag} /></div>
        {err && <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300" data-testid="deal-note-error">{err}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={SUB}>Visible to you and your firm.</span>
          <button type="button" className={BTN_S} disabled={busy} onClick={save} data-testid="deal-note-save">Save</button>
        </div>
      </section>
      <section className="flex flex-col gap-2 rounded-axal-lg border border-axal-lavender-edge bg-axal-lavender px-4 py-4 dark:border-violet-800 dark:bg-violet-950/40" data-testid="deal-eadwyn-draft">
        <span className={EYE}>Eadwyn · draft</span>
        <p className={`m-0 ${SUB}`}>{EADWYN_DRAFT_WAITS}</p>
      </section>
      <section className={`${CARD} flex flex-col gap-1 px-4 py-4`} data-testid="deal-notes">
        <h3 className={H3}>Notes</h3>
        {read.status === 'loading' && <p className={`m-0 ${SUB}`}>Reading…</p>}
        {read.status === 'unreadable' && <Unreadable what="Your firm’s notes" claim="That is not a claim that there are none." onRetry={load} />}
        {read.status === 'ready' && !items.length && (
          <div className="flex flex-col gap-1 py-2" data-testid="deal-notes-empty">
            <p className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{EMPTY.notes.title}</p>
            <p className={`m-0 ${SUB}`}>{EMPTY.notes.line}</p>
          </div>
        )}
        {items.map((n) => {
          const own = Number(n.author_user_id) === Number(userId);
          return (
            <article key={n.uid} className="flex flex-col gap-1 border-t border-axal-hairline py-2.5 dark:border-gray-700" data-testid={`deal-note-${n.uid}`}>
              <span className={EYE}>{String(n.created_at || '').slice(0, 10) || 'Date not recorded'} · {own ? 'You' : 'Your firm'}{n.tag ? ` · ${n.tag}` : ''}</span>
              <p className="m-0 whitespace-pre-line text-[13px] leading-[1.5] text-axal-ink dark:text-gray-100">{n.body}</p>
              {own && (
                <div className="flex gap-3">
                  <button type="button" className="text-[12px] font-bold text-axal-violet-deep dark:text-violet-300" onClick={() => setDialog({ mode: 'edit', note: n })} data-testid={`deal-note-edit-${n.uid}`}>Edit</button>
                  <button type="button" className="text-[12px] font-bold text-axal-destructive dark:text-red-300" onClick={() => setDialog({ mode: 'delete', note: n })} data-testid={`deal-note-delete-${n.uid}`}>Delete</button>
                </div>
              )}
            </article>
          );
        })}
      </section>
      {dialog && <NoteDialog {...dialog} dealId={dealId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
    </>
  );
}

/** The deal's activity: All or Mine. Other investors are never named (the Worker's rule, D1152). */
export function DealActivity({ dealId, mineFilter = false }) {
  const [events, setEvents] = useState(null);
  const [failed, setFailed] = useState(false);
  const [mine, setMine] = useState(false);
  const load = () => {
    setFailed(false);
    api.dealActivity(dealId).then(setEvents).catch((e) => { reportError('DealActivity', e); setFailed(true); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealId]);
  const shown = (events || []).filter((e) => !mine || e.mine);
  return (
    <section className={`${CARD} flex flex-col gap-1 px-4 py-4`} data-testid="deal-activity">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={H3}>Activity on this deal</h3>
        {mineFilter && (
          <div className="flex gap-1.5" role="radiogroup" aria-label="Show">
            {[['All', false], ['Mine', true]].map(([t, v]) => (
              <button key={t} type="button" role="radio" aria-checked={mine === v} className={TAG(mine === v)} onClick={() => setMine(v)} data-testid={`deal-activity-${t.toLowerCase()}`}>{t}</button>
            ))}
          </div>
        )}
      </div>
      {failed && <Unreadable what="The activity" claim="That is not a claim that nothing happened." onRetry={load} />}
      {!failed && events == null && <p className={`m-0 ${SUB}`}>Reading…</p>}
      {!failed && events != null && !shown.length && <p className={`m-0 ${SUB}`} data-testid="deal-activity-empty">{EMPTY.activity}</p>}
      {shown.map((e, i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 border-t border-axal-hairline py-2 dark:border-gray-700">
          <span className="text-[13px] text-axal-ink dark:text-gray-100">{e.label}</span>
          <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{e.at ? String(e.at).slice(0, 10) : 'Date not recorded'}</span>
        </div>
      ))}
      {mineFilter && <p className={`m-0 pt-1 ${SUB}`}>Rows about other investors never name them or their amounts.</p>}
    </section>
  );
}

/** DL14: the notes on the left, the activity beside them. */
export default function DealNotes({ dealId, userId }) {
  return (
    <div className="grid gap-3.5 lg:grid-cols-3" data-testid="deal-notes-tab">
      <div className="flex min-w-0 flex-col gap-3.5 lg:col-span-2"><Notes dealId={dealId} userId={userId} /></div>
      <div className="min-w-0"><DealActivity dealId={dealId} mineFilter /></div>
    </div>
  );
}
