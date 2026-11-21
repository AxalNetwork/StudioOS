/**
 * #5310 part 2 — NW2 "My relationships" and NW2.1 the Person Sheet, on a
 * founder's Network › Relationships (`workspaces/NetworkWorkspace`, which
 * draws the crumb, heading, zone pills and rail). Built to
 * `design/incoming/network-workspace/NW2-Relationships.dc.html` (D4799); the
 * words and rules are `relationshipBookModel.js`'s, and D5310-p2 lists where
 * this departs from the board.
 *
 * READS. The member's own book (`GET /api/contacts/book` with `q`, `source`,
 * `follow_up=open` and `page`), and on a sheet that contact's notes and
 * follow-ups. A failed read says so with Try again, and is never an empty
 * book. Writes are the member's own: a note, a follow-up, a follow-up done.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { contactsBookApi } from '../../lib/api/contacts';
import { Sheet } from '../../ui';
import WhoKnowsStrip from '../relationships/WhoKnowsStrip.jsx';
import { reportError } from '../../lib/log';
import {
  ADD_PERSON_UNBUILT, NOT_RECORDED, ROLE_NOTE, SOURCE_FILTERS, STRENGTH_LINE,
  bookCountLine, bookRows, contextLine, followUpBody, followUpRows, historyRows, noteBody, pageCount, rangeLabel,
} from './relationshipBookModel';

const CARD = 'flex min-w-0 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-4 py-4 text-[13px] text-axal-ink sm:px-[18px] dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const LABEL = 'm-0 text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-300 max-sm:min-h-[44px]';
const INPUT = 'rounded-axal-sm border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink placeholder:text-axal-faint focus:outline-none focus:ring-2 focus:ring-axal-violet/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]';
const BTN = 'inline-flex items-center justify-center rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 max-sm:min-h-[44px]';
const BTN_P = 'inline-flex items-center justify-center rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400 max-sm:min-h-[44px]';
const TONE = {
  overdue: 'font-semibold text-axal-amber-deep dark:text-amber-300',
  open: 'text-axal-ink dark:text-gray-200',
  none: 'text-axal-muted dark:text-gray-400',
  done: 'text-axal-muted line-through dark:text-gray-500',
};
const TH = 'border-b border-axal-hairline px-2 py-2 text-left text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:border-gray-800 dark:text-gray-400';
const TD = 'border-b border-axal-ground px-2 py-2.5 align-top dark:border-gray-800';
const today = () => new Date().toISOString().slice(0, 10);

/** NW2: the member's own book, filtered and paged by the Worker. */
export default function FounderRelationshipBook({ books = contactsBookApi }) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [read, setRead] = useState({ status: 'loading', data: null });
  const [open, setOpen] = useState(null);
  const serial = useRef(0);

  const load = useCallback(async () => {
    const mine = ++serial.current;
    setRead((r) => ({ status: r.data ? 'refreshing' : 'loading', data: r.data }));
    try {
      const data = await books.book(q.trim(), page, { ...(source ? { source } : {}), ...(openOnly ? { follow_up: 'open' } : {}) });
      if (serial.current === mine) setRead({ status: 'ready', data });
    } catch (e) {
      reportError('FounderRelationshipBook:book', e);
      if (serial.current === mine) setRead({ status: 'unreadable', data: null });
    }
  }, [books, q, page, source, openOnly]);
  // A typed search waits 250 ms for the next keystroke; anything else (a filter, a page, the first read) reads at once.
  useEffect(() => {
    if (!q) { load(); return undefined; }
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, q]);
  useEffect(() => () => { serial.current += 1; }, []);

  const data = read.data;
  const rows = bookRows(data?.contacts);
  const pages = pageCount(data);
  const filtered = Boolean(q.trim() || source || openOnly);
  const contact = open == null ? null : (data?.contacts || []).find((c) => c.id === open) || null;

  return (
    <section aria-labelledby="nw2-book" className={CARD} data-testid="nw2-book">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id="nw2-book" className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">My relationships</h2>
          <p className={MUTED} data-testid="nw2-book-count">{bookCountLine(data)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/account/connectors/linkedin" className={BTN} data-testid="nw2-import">Import contacts</Link>
          <button type="button" className={BTN} disabled title={ADD_PERSON_UNBUILT} data-testid="nw2-add-person">Add person</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter your relationships">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by name or organization"
          aria-label="Search your relationships" className={`${INPUT} min-w-[220px] flex-1`} data-testid="nw2-search" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-axal-muted dark:text-gray-400">Source
          <select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} className={INPUT} data-testid="nw2-source">
            {SOURCE_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-axal-ink dark:text-gray-200">
          <input type="checkbox" checked={openOnly} onChange={(e) => { setOpenOnly(e.target.checked); setPage(1); }} data-testid="nw2-open-only" />
          Has open follow-up
        </label>
        <button type="button" className={BTN} onClick={load} aria-label="Read your relationships again" data-testid="nw2-refresh">↻</button>
      </div>

      {read.status === 'loading' && <p className={MUTED} aria-live="polite">Reading your relationships…</p>}
      {read.status === 'unreadable' && (
        <p className={MUTED} role="alert" data-testid="nw2-unreadable">Your relationships could not be read. This is not an empty book. <button type="button" className={LINK} onClick={load}>Try again</button></p>
      )}
      {data && rows.length === 0 && (
        <p className={MUTED} data-testid="nw2-empty">{filtered ? 'No one in your book matches these filters.' : 'Your book is empty. Import your LinkedIn connections or a spreadsheet to start.'}</p>
      )}
      {data && rows.length > 0 && (
        // Below 640px the rows stack, one card each, so the page never scrolls sideways (NW8's pattern).
        <ul className="m-0 flex list-none flex-col p-0 sm:hidden" data-testid="nw2-list">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-axal-ground py-2.5 last:border-b-0 dark:border-gray-800">
              <button type="button" className="flex w-full min-w-0 flex-col items-start gap-0.5 text-left max-sm:min-h-[44px]" onClick={() => setOpen(r.id)} data-testid={`nw2-card-${r.id}`}>
                <span className="font-semibold text-axal-ink dark:text-gray-100">{r.name}</span>
                <span className={MUTED}>{r.organization} · {r.role}</span>
                <span className={`text-[12.5px] ${TONE[r.followUps.tone]}`}>{r.followUps.tone === 'overdue' ? '◷ ' : ''}{r.followUps.text}</span>
                <span className={MUTED}>{r.lastActivity} · {r.source}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && rows.length > 0 && (
        <div className="hidden max-w-full overflow-x-auto sm:block">
          <table className="w-full min-w-[760px] border-collapse text-[13px]" data-testid="nw2-table">
            <thead><tr>
              <th className={TH}>Person</th><th className={TH}>Organization</th><th className={TH} title={ROLE_NOTE}>Role / context</th>
              <th className={TH}>Last activity</th><th className={TH}>Open follow-ups</th><th className={TH}>Source</th><th className={TH}><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`nw2-row-${r.id}`}>
                  <td className={`${TD} font-semibold`}><button type="button" className="text-left font-semibold text-axal-ink hover:underline dark:text-gray-100" onClick={() => setOpen(r.id)} data-testid={`nw2-open-${r.id}`}>{r.name}</button></td>
                  <td className={TD}>{r.organization}</td>
                  <td className={TD}>{r.role}</td>
                  <td className={TD}>{r.lastActivity}</td>
                  <td className={`${TD} ${TONE[r.followUps.tone]}`} data-testid={`nw2-follow-${r.id}`}>{r.followUps.tone === 'overdue' ? '◷ ' : ''}{r.followUps.text}</td>
                  <td className={TD}>{r.source}</td>
                  <td className={TD}><button type="button" className={LINK} onClick={() => setOpen(r.id)} aria-label={`Open ${r.name}`}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={MUTED} data-testid="nw2-range">{rangeLabel(data)}</span>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" className={BTN} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" data-testid="nw2-prev">‹</button>
              <span className={MUTED}>Page {page} of {pages}</span>
              <button type="button" className={BTN} disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page" data-testid="nw2-next">›</button>
            </div>
          )}
        </div>
      )}
      {contact && <PersonSheet contact={contact} books={books} onClose={() => setOpen(null)} onChanged={load} />}
    </section>
  );
}

/** NW2.1: one person in the member's own book. */
export function PersonSheet({ contact, books = contactsBookApi, onClose, onChanged }) {
  const [notes, setNotes] = useState({ status: 'loading', data: [] });
  const [tasks, setTasks] = useState({ status: 'loading', data: [] });
  const [draft, setDraft] = useState('');
  const [warn, setWarn] = useState(false);
  const [noteErr, setNoteErr] = useState('');
  const [fu, setFu] = useState({ title: '', due: '', err: '', busy: false });
  const followRef = useRef(null);

  const loadNotes = useCallback(() => {
    setNotes((s) => ({ ...s, status: 'loading' }));
    books.notes(contact.id).then((r) => setNotes({ status: 'ready', data: Array.isArray(r?.notes) ? r.notes : (Array.isArray(r) ? r : []) }))
      .catch((e) => { reportError('PersonSheet:notes', e); setNotes({ status: 'unreadable', data: [] }); });
  }, [books, contact.id]);
  const loadTasks = useCallback(() => {
    setTasks((s) => ({ ...s, status: 'loading' }));
    books.tasks(contact.id).then((r) => setTasks({ status: 'ready', data: Array.isArray(r?.tasks) ? r.tasks : (Array.isArray(r) ? r : []) }))
      .catch((e) => { reportError('PersonSheet:tasks', e); setTasks({ status: 'unreadable', data: [] }); });
  }, [books, contact.id]);
  useEffect(() => { loadNotes(); loadTasks(); }, [loadNotes, loadTasks]);

  // An unsaved note is never lost to Escape, the ×, or the scrim: the first close says so; a second discards it.
  const close = () => { if (draft.trim() && !warn) { setWarn(true); return; } onClose(); };

  const saveNote = async () => {
    const b = noteBody(draft);
    if (b.error) { setNoteErr(b.error); return; }
    setNoteErr('');
    try { await books.addNote(contact.id, b.body); setDraft(''); setWarn(false); loadNotes(); onChanged?.(); }
    catch (e) { setNoteErr(e?.message || 'The note was not saved. Try again.'); }
  };
  const addFollowUp = async (event) => {
    event.preventDefault();
    const b = followUpBody(fu.title, fu.due);
    if (b.error) { setFu((s) => ({ ...s, err: b.error })); return; }
    setFu((s) => ({ ...s, busy: true, err: '' }));
    try { await books.addTask(contact.id, b.title, b.due_on); setFu({ title: '', due: '', err: '', busy: false }); loadTasks(); onChanged?.(); }
    catch (e) { setFu((s) => ({ ...s, busy: false, err: e?.message || 'The follow-up was not added. Try again.' })); }
  };
  const toggle = async (row) => {
    try { await books.setTaskDone(contact.id, row.uid, !row.done); loadTasks(); onChanged?.(); }
    catch (e) { reportError('PersonSheet:done', e); setTasks((s) => ({ ...s, toggleErr: row.uid })); }
  };

  const follow = followUpRows(tasks.data, today());
  const history = notes.status === 'ready' && tasks.status === 'ready' ? historyRows(contact, notes.data, tasks.data) : null;
  const sub = [contact.title, contact.company].filter(Boolean).join(' · ') || 'No title or organization recorded';

  return (
    <Sheet eyebrow="Relationship" title={contact.name || NOT_RECORDED} label={`Relationship: ${contact.name || 'this person'}`} sub={sub} width={560}
      testId="nw2-sheet" onClose={close} onEscape={close}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BTN} onClick={() => followRef.current?.focus()} data-testid="nw2-sheet-add-follow">Add follow-up</button>
          <Link to="/network/introductions" state={{ person: contact.name }} className={BTN_P} data-testid="nw2-sheet-request">Request introduction</Link>
        </div>
      )}>
      <div className="flex flex-col gap-4 px-5 py-4 text-[13px] text-axal-ink dark:text-gray-200">
        {contact.linkedin_url && <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" className={LINK} data-testid="nw2-sheet-linkedin">LinkedIn profile ↗</a>}
        {warn && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-axal-sm border border-axal-amber/40 bg-axal-amber/10 px-3 py-2 text-axal-amber-deep dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300" data-testid="nw2-sheet-unsaved">
            <span><b>! Unsaved note.</b> Your note is not saved yet.</span>
            <span className="flex gap-2"><button type="button" className={BTN_P} onClick={saveNote}>Save note</button><button type="button" className={BTN} onClick={onClose} data-testid="nw2-sheet-discard">Discard</button></span>
          </div>
        )}

        <section aria-label="Relationship context" className="flex flex-col gap-1">
          <h3 className={LABEL}>Relationship context</h3>
          <p className="m-0" data-testid="nw2-sheet-context">{contextLine(contact)}</p>
          <p className={MUTED}>{STRENGTH_LINE}</p>
        </section>

        <section aria-label="Follow-ups" className="flex flex-col gap-1.5" data-testid="nw2-sheet-follow">
          <h3 className={LABEL}>Follow-ups</h3>
          {tasks.status === 'loading' && <p className={MUTED}>Reading follow-ups…</p>}
          {tasks.status === 'unreadable' && <p className={MUTED} role="alert">The follow-ups could not be read. <button type="button" className={LINK} onClick={loadTasks}>Try again</button></p>}
          {tasks.status === 'ready' && follow.length === 0 && <p className={MUTED}>No follow-ups on this person.</p>}
          {follow.map((t) => (
            <label key={t.uid} className="flex items-start gap-2" data-testid={`nw2-sheet-task-${t.uid}`}>
              <input type="checkbox" checked={t.done} onChange={() => toggle(t)} aria-label={`${t.done ? 'Reopen' : 'Mark done'}: ${t.title}`} />
              <span className="min-w-0"><span className={t.done ? TONE.done : 'font-semibold'}>{t.title}</span> <span className={TONE[t.tone]}>{t.tone === 'overdue' ? '◷ ' : ''}{t.line}</span></span>
            </label>
          ))}
          {tasks.toggleErr && <p className={MUTED} role="alert">That follow-up was not changed. Try again.</p>}
          <form className="flex flex-wrap items-center gap-2" onSubmit={addFollowUp} data-testid="nw2-sheet-follow-form">
            <input ref={followRef} value={fu.title} onChange={(e) => setFu((s) => ({ ...s, title: e.target.value }))} placeholder="Add follow-up" aria-label="New follow-up" className={`${INPUT} min-w-[180px] flex-1`} data-testid="nw2-sheet-follow-title" />
            <input type="date" value={fu.due} onChange={(e) => setFu((s) => ({ ...s, due: e.target.value }))} aria-label="Due date" className={INPUT} data-testid="nw2-sheet-follow-due" />
            <button type="submit" className={BTN} disabled={fu.busy} data-testid="nw2-sheet-follow-add">Add</button>
          </form>
          {fu.err && <p className={MUTED} role="alert" data-testid="nw2-sheet-follow-err">{fu.err}</p>}
        </section>

        <section aria-label="Private notes" className="flex flex-col gap-1.5" data-testid="nw2-sheet-notes">
          <h3 className={LABEL}>Private notes · only you can read these</h3>
          <textarea value={draft} onChange={(e) => { setDraft(e.target.value); setWarn(false); }} rows={3} placeholder="New private note" aria-label="New private note" className={INPUT} data-testid="nw2-sheet-note" />
          <div className="flex justify-end"><button type="button" className={BTN} onClick={saveNote} disabled={!draft.trim()} data-testid="nw2-sheet-note-save">Save note</button></div>
          {noteErr && <p className={MUTED} role="alert" data-testid="nw2-sheet-note-err">{noteErr}</p>}
          {notes.status === 'loading' && <p className={MUTED}>Reading notes…</p>}
          {notes.status === 'unreadable' && <p className={MUTED} role="alert">The notes could not be read. <button type="button" className={LINK} onClick={loadNotes}>Try again</button></p>}
          {notes.status === 'ready' && notes.data.length === 0 && <p className={MUTED}>No notes yet.</p>}
          {notes.data.map((n) => <p key={n.uid} className="m-0 whitespace-pre-wrap border-l-2 border-axal-hairline pl-2 dark:border-gray-700"><span className={MUTED}>{String(n.created_at || '').slice(0, 10) || NOT_RECORDED} · </span>{n.body}</p>)}
        </section>

        <section aria-label="Interaction history" className="flex flex-col gap-1" data-testid="nw2-sheet-history">
          <h3 className={LABEL}>Interaction history</h3>
          {history == null
            ? <p className={MUTED}>{notes.status === 'unreadable' || tasks.status === 'unreadable' ? 'Not shown while notes or follow-ups could not be read.' : 'Reading…'}</p>
            : history.map((h) => <p key={h.key} className="m-0"><span className={MUTED}>{h.day} · </span>{h.text}</p>)}
          <p className={MUTED}>Introductions are listed in Introductions, not joined to this record.</p>
        </section>

        <section aria-label="Who on my team knows them" className="flex flex-col gap-1">
          <h3 className={LABEL}>Who on my team knows them</h3>
          <WhoKnowsStrip query={{ person: contact.name }} subject={contact.name} testId="nw2-sheet-who-knows" />
        </section>
      </div>
    </Sheet>
  );
}
