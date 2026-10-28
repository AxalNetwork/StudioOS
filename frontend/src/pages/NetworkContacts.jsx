import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { contactsBookApi } from '../lib/api/contacts';
import { sourceChips } from './account/linkedinModel';

/**
 * D1352 (#3567, part 3 of #3564) — the member's own contacts on Network ›
 * Relationships: every row of their book (`GET /api/contacts/book`), with its
 * source chips ("From LinkedIn", "From a spreadsheet", "Added by hand"), and
 * its notes and follow-ups (D1351's routes). Only the member's own rows exist
 * here; nothing is shared with anyone.
 */
export default function NetworkContacts({ books = contactsBookApi }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ status: 'loading', data: null });
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: s.data ? 'ready' : 'loading' }));
    try { setState({ status: 'ready', data: await books.book(q.trim(), page) }); }
    catch { setState({ status: 'unreadable', data: null }); }
  }, [books, q, page]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const data = state.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <section aria-labelledby="network-contacts" className={CARD} data-testid="network-contacts">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id="network-contacts" className="m-0 text-[15px] font-extrabold text-axal-ink dark:text-gray-100">Your contacts</h2>
          <p className={MUTED}>The people you keep, from LinkedIn, a spreadsheet or by hand. Only you see them.</p>
        </div>
        <Link to="/account/connectors/linkedin" className={LINK} data-testid="network-contacts-import">Import from LinkedIn</Link>
      </div>
      <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by name or company"
        aria-label="Search your contacts" className={INPUT} data-testid="network-contacts-search" />
      {state.status === 'loading' && <p className={MUTED}>Reading your contacts…</p>}
      {state.status === 'unreadable' && <p className={MUTED} data-testid="network-contacts-unreadable">Your contacts could not be read. <button type="button" className={LINK} onClick={load}>Try again</button></p>}
      {state.status === 'ready' && data && (data.contacts.length === 0
        ? <p className={MUTED} data-testid="network-contacts-empty">{q ? 'No contact matches that search.' : 'No contacts yet. Import your LinkedIn connections to start.'}</p>
        : (
          <ul className="m-0 list-none p-0" data-testid="network-contacts-list">
            {data.contacts.map((c) => (
              <li key={c.id} className="border-b border-axal-ground py-2.5 last:border-b-0 dark:border-gray-800" data-testid={`network-contact-${c.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-axal-ink dark:text-gray-100">{c.name}</div>
                    <div className={MUTED}>{[c.title, c.company].filter(Boolean).join(' · ') || 'No title or company recorded'}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {sourceChips(c.sources).map((s) => <span key={s.key} className={CHIP} data-testid={`network-contact-${c.id}-chip-${s.key}`}>{s.label}</span>)}
                    <button type="button" className={LINK} aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)} data-testid={`network-contact-${c.id}-open`}>
                      Notes{c.notes ? ` (${c.notes})` : ''} and follow-ups{c.open_tasks ? ` (${c.open_tasks} open)` : ''}
                    </button>
                  </div>
                </div>
                {open === c.id && <ContactNotes contactId={c.id} books={books} onChanged={load} />}
              </li>
            ))}
          </ul>
        ))}
      {data && pages > 1 && (
        <div className="flex items-center justify-between text-[12.5px]" data-testid="network-contacts-pages">
          <button type="button" className={LINK} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className={MUTED}>Page {page} of {pages} · {data.total} contacts</span>
          <button type="button" className={LINK} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </section>
  );
}

function ContactNotes({ contactId, books, onChanged }) {
  const [notes, setNotes] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [note, setNote] = useState('');
  const [task, setTask] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [n, t] = await Promise.all([books.notes(contactId), books.tasks(contactId)]);
      setNotes(n?.notes || []); setTasks(t?.tasks || []); setError('');
    } catch { setError('The notes could not be read. Try again.'); }
  }, [books, contactId]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn) => { setError(''); try { await fn(); await load(); onChanged?.(); } catch (e) { setError(e?.data?.detail || e?.message || 'That could not be saved. Try again.'); } };
  return (
    <div className="mt-2 grid gap-3 rounded-axal-sm bg-axal-ground/60 p-3 sm:grid-cols-2 dark:bg-gray-800/50" data-testid={`network-contact-${contactId}-notes`}>
      <div className="min-w-0">
        <div className={LABEL}>Notes</div>
        {notes === null ? <p className={MUTED}>Reading…</p> : notes.length === 0 ? <p className={MUTED}>No notes yet.</p> : (
          <ul className="m-0 list-none p-0 text-[12.5px]">{notes.map((n) => <li key={n.uid} className="py-1">{n.body}</li>)}</ul>
        )}
        <form className="mt-1.5 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (note.trim()) run(async () => { await books.addNote(contactId, note.trim()); setNote(''); }); }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} placeholder="Add a note" aria-label="Add a note" className={INPUT} data-testid={`network-contact-${contactId}-note-input`} />
          <button type="submit" className={LINK} data-testid={`network-contact-${contactId}-note-add`}>Add</button>
        </form>
      </div>
      <div className="min-w-0">
        <div className={LABEL}>Follow-ups</div>
        {tasks === null ? <p className={MUTED}>Reading…</p> : tasks.length === 0 ? <p className={MUTED}>No follow-ups yet.</p> : (
          <ul className="m-0 list-none p-0 text-[12.5px]">
            {tasks.map((t) => (
              <li key={t.uid} className="flex items-center gap-2 py-1">
                <input type="checkbox" checked={!!t.done_at} aria-label={`Done: ${t.title}`} onChange={(e) => run(() => books.setTaskDone(contactId, t.uid, e.target.checked))} data-testid={`network-task-${t.uid}`} />
                <span className={t.done_at ? 'text-axal-muted line-through dark:text-gray-500' : ''}>{t.title}{t.due_on ? ` · ${t.due_on}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
        <form className="mt-1.5 flex flex-wrap gap-1.5" onSubmit={(e) => { e.preventDefault(); if (task.trim()) run(async () => { await books.addTask(contactId, task.trim(), due || null); setTask(''); setDue(''); }); }}>
          <input value={task} onChange={(e) => setTask(e.target.value)} maxLength={300} placeholder="Add a follow-up" aria-label="Add a follow-up" className={`${INPUT} min-w-0 flex-1`} data-testid={`network-contact-${contactId}-task-input`} />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" className={`${INPUT} w-auto`} />
          <button type="submit" className={LINK} data-testid={`network-contact-${contactId}-task-add`}>Add</button>
        </form>
      </div>
      {error && <p role="alert" className="m-0 text-[12.5px] text-red-700 sm:col-span-2 dark:text-red-300">{error}</p>}
    </div>
  );
}

const CARD = 'flex min-w-0 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-4 py-4 text-[13px] text-axal-ink sm:px-[18px] dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const LABEL = 'mb-1 text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-300 max-sm:min-h-[44px]';
const CHIP = 'whitespace-nowrap rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-300';
const INPUT = 'w-full rounded-axal-sm border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink placeholder:text-axal-faint focus:outline-none focus:ring-2 focus:ring-axal-violet/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]';
