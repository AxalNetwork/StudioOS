import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Mail, MailOpen, Search, PenLine, Send, Paperclip, ArrowLeft, ArrowUpRight, Archive, X, Loader2,
  UserCheck, Users, Briefcase, FileText, CalendarDays,
} from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import { Pill, Unrecorded, Unreadable } from '../ui';
import {
  FILTERS, SUBJECT_LABEL, nameOf, initialsOf, roleLine, money, timeOf, fmtWhen, groupMessages, threadMatches,
  ATTACHMENT_MAX_BYTES, ATTACHMENT_ACCEPT, fileSize,
} from '../lib/messagesView';

/**
 * Messages — /messages. Built from `design/canvases/backlog/Messages.dc.html`
 * (D414), on migration 185 and routes/messages.ts.
 *
 * WHAT THE CANVAS CALLS UNIFIED, THIS DOES NOT CLAIM. The canvas calls this a
 * "unified inbox". Nothing is being unified: the only other message-shaped
 * stores in D1 are the AI assistant transcript (`advisor_messages`) and a
 * Slack-bridged support thread, and neither is a conversation between two
 * members. The empty state says where those two live instead.
 *
 * EVERYTHING ABOUT THE OTHER PERSON AND THE THREAD'S SUBJECT IS THE WORKER'S.
 * Each counterparty is a card built by the public profile's own privacy rules,
 * so a member who hides their name publicly is not named here either, and no
 * email address reaches this page. The context strip is resolved by the Worker
 * and re-checked for the person reading on every open; when it is absent, the
 * page prints the Worker's sentence for why.
 *
 * ONE CANVAS SENTENCE IS NOT PRINTED because nothing makes it true: threads
 * do not "appear when an introduction is accepted or a match is made" (only a
 * person starts one), and the Worker says so. The other one D414 withheld —
 * "Attachments are visible to both parties only" — is printed since D415,
 * because it became true: files live in a private bucket and the only way to
 * one is a single-use link the Worker mints for a member of the thread.
 */

/** Each subject type's chip: the shared label, an icon and a tone. */
const SUBJECT = {
  introduction: { label: SUBJECT_LABEL.introduction, icon: UserCheck, tone: 'info' },
  match: { label: SUBJECT_LABEL.match, icon: Users, tone: 'seam' },
  job: { label: SUBJECT_LABEL.job, icon: Briefcase, tone: 'warn' },
  engagement: { label: SUBJECT_LABEL.engagement, icon: FileText, tone: 'cite' },
  service: { label: SUBJECT_LABEL.service, icon: FileText, tone: 'cite' },
  session: { label: SUBJECT_LABEL.session, icon: CalendarDays, tone: 'danger' },
};

function Avatar({ person, size = 38 }) {
  const style = { width: size, height: size, fontSize: size > 32 ? 13 : 11 };
  if (person?.headshot_url) {
    return <img src={person.headshot_url} alt="" className="flex-none rounded-[12px] object-cover" style={style} />;
  }
  return (
    <div aria-hidden="true" className="flex flex-none items-center justify-center rounded-[12px] bg-violet-600 font-bold text-white" style={style}>
      {initialsOf(person)}
    </div>
  );
}

/** A name, or the Worker's reason there is none. */
function PersonName({ person, reason }) {
  const n = nameOf(person);
  return n ? <>{n}</> : <Unrecorded reason={reason}>Name not shared</Unrecorded>;
}

function SubjectChip({ type, subject }) {
  const s = SUBJECT[type];
  if (!s) return null;
  const Icon = s.icon;
  return (
    <Pill tone={s.tone} className="max-w-full overflow-hidden text-ellipsis">
      <Icon size={11} aria-hidden="true" />{s.label}{subject ? ` · ${subject}` : ''}
    </Pill>
  );
}

function NewThread({ onClose, onCreated }) {
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const res = await api.messageStartThread({ to_email: email.trim(), body: body.trim() });
      onCreated(res?.uid);
    } catch (ex) { setErr(ex?.message || 'Could not start that conversation'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <form onSubmit={submit} className="relative w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">New message</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close"><X size={18} /></button>
        </div>
        {err && <p className="mb-3 rounded-lg bg-red-50 dark:bg-red-900/20 p-2 text-sm text-red-700 dark:text-red-300" role="alert">{err}</p>}
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="msg-to">To</label>
        <input
          id="msg-to" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="them@company.com"
          className="mb-1 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
        />
        <p className="mb-3 text-[11px] text-gray-500">
          They must already have an Axal account — this does not send an invitation.
        </p>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="msg-body">Message</label>
        <textarea
          id="msg-body" required rows={4} value={body} onChange={(e) => setBody(e.target.value)}
          className="mb-4 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy}
          className="w-full rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

/**
 * The canvas's composer: paperclip, growing textarea, send, and a note.
 *
 * A FILE IS SENT AS A MESSAGE (D415). Choosing one shows it above the
 * textarea; Send posts it with whatever was typed, as one message. The
 * Worker decides what may be attached — type from the bytes, size, a daily
 * count — and the page prints its sentence when it says no. The size check
 * here only saves an upload the Worker would refuse anyway.
 */
function Composer({ onSend, onAttach, disabled, hint, note, attachReason }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(null);
  const picker = useRef(null);
  // The canvas's growing textarea: one line, up to about six.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [text]);
  function choose(e) {
    const f = e.target.files?.[0] || null;
    e.target.value = '';
    setErr('');
    if (f && f.size > ATTACHMENT_MAX_BYTES) { setErr('Files up to 10 MB can be attached.'); return; }
    setFile(f);
  }
  async function submit(e) {
    e?.preventDefault();
    const body = text.trim();
    if ((!body && !file) || busy) return;
    setBusy(true); setErr('');
    try {
      if (file) await onAttach(file, body);
      else await onSend(body);
      setText(''); setFile(null);
    } catch (ex) { setErr(ex?.message || 'That message did not send.'); }
    finally { setBusy(false); }
  }
  const canAttach = !attachReason && !disabled;
  return (
    <form onSubmit={submit} className="border-t border-gray-200 p-3 dark:border-gray-800" data-testid="messages-composer">
      {file && (
        <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-lg border border-gray-200 px-2 py-1 text-[12px] dark:border-gray-700" data-testid="messages-chosen-file">
          <Paperclip size={12} className="flex-none text-gray-500" />
          <span className="truncate">{file.name}</span>
          <span className="flex-none text-gray-500">{fileSize(file.size)}</span>
          <button type="button" onClick={() => setFile(null)} aria-label="Remove the file" className="flex-none text-gray-400 hover:text-gray-700"><X size={12} /></button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input ref={picker} type="file" accept={ATTACHMENT_ACCEPT} onChange={choose} className="hidden" aria-hidden="true" tabIndex={-1} data-testid="messages-file-input" />
        {/* The canvas's paperclip. Disabled only with the Worker's reason. */}
        <button type="button" disabled={!canAttach || busy} title={attachReason || 'Attach a file'} aria-label="Attach a file"
          onClick={() => picker.current?.click()}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 dark:hover:bg-gray-800">
          <Paperclip size={16} />
        </button>
        <textarea
          ref={ref} rows={1} value={text} onChange={(e) => setText(e.target.value)} disabled={disabled || busy}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }}
          placeholder={disabled ? 'This conversation is archived' : hint}
          aria-label="Message"
          className="min-h-9 flex-1 resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 disabled:opacity-60"
        />
        <button type="submit" disabled={disabled || busy || (!text.trim() && !file)} aria-label="Send"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-800">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
      {err && <p className="mt-1.5 text-[12px] text-red-600" role="alert">{err}</p>}
      <p className="mt-1.5 text-[11px] text-gray-500">{note}</p>
    </form>
  );
}

/**
 * One file on a bubble. Opening it asks the Worker for a signed, single-use
 * link — only a member of the thread gets one — and follows it.
 */
function AttachmentChip({ threadUid, a, mine }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function open() {
    setBusy(true); setErr('');
    try {
      const r = await api.messageAttachmentLink(threadUid, a.uid);
      window.location.assign(r.url);
    } catch (e) { setErr(e?.message || 'That file could not be opened.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-1">
      <button type="button" onClick={open} disabled={busy} data-testid="messages-attachment"
        className={`inline-flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] ${mine ? 'border-violet-300 bg-violet-500/30 text-white' : 'border-gray-200 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>
        {busy ? <Loader2 size={13} className="flex-none animate-spin" /> : <Paperclip size={13} className="flex-none" />}
        <span className="truncate font-semibold">{a.filename}</span>
        <span className="flex-none opacity-70">{fileSize(a.size_bytes)}</span>
      </button>
      {err && <p className="mt-0.5 text-[11px] text-red-600" role="alert">{err}</p>}
    </div>
  );
}

function ContextStrip({ context, reason }) {
  if (context) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-800 dark:bg-gray-900/40" data-testid="messages-context">
        <Pill tone="cite"><FileText size={11} aria-hidden="true" />{context.kind}</Pill>
        <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{context.title}</span>
        {context.amount_cents != null && <span className="text-[12px] text-gray-600 dark:text-gray-400">· {money(context.amount_cents)}</span>}
        {context.status && <Pill tone="ok">{context.status}</Pill>}
        <span className="ml-auto">
          {context.link ? (
            <Link to={context.link.path} className="inline-flex items-center gap-1 text-[12px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
              {context.link.label} <ArrowUpRight size={12} />
            </Link>
          ) : null}
        </span>
      </div>
    );
  }
  if (!reason) return null;
  return (
    <div className="border-b border-gray-200 px-4 py-2 text-[11.5px] text-gray-500 dark:border-gray-800" data-testid="messages-context-absent">
      <Unrecorded reason={reason} /> — {reason}
    </div>
  );
}

export default function MessagesPage({ user }) {
  const [list, setList] = useState(null);
  const [listErr, setListErr] = useState('');
  const [openUid, setOpenUid] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailErr, setDetailErr] = useState('');
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const endRef = useRef(null);

  const loadList = useCallback(async () => {
    setListErr('');
    try { setList(await api.messageThreads()); }
    catch (e) { reportError('messages_list_failed', e); setListErr(e?.message || 'Could not load your messages'); }
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  const loadThread = useCallback(async (uid) => {
    if (!uid) { setDetail(null); return; }
    setDetailErr('');
    try {
      setDetail(await api.messageThread(uid));
      // Opening IS reading. The unread count is derived from last_read_at, so
      // this is the only thing that clears it.
      await api.messageMarkRead(uid);
      loadList();
    } catch (e) { reportError('messages_thread_failed', e); setDetailErr(e?.message || 'Could not open that conversation'); }
  }, [loadList]);
  useEffect(() => { loadThread(openUid); }, [openUid, loadThread]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [detail]);

  // There is no push channel for messages, so the page re-reads when the
  // window comes back into focus rather than showing a stale inbox.
  useEffect(() => {
    const onFocus = () => { loadList(); if (openUid) loadThread(openUid); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadList, loadThread, openUid]);

  const threads = list?.items || [];
  const visible = useMemo(() => threads.filter((t) => threadMatches(t, filter, query)), [threads, filter, query]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [
    f.k,
    f.k === 'All' ? null
      : f.k === 'Unread' ? threads.filter((t) => t.unread > 0).length
        : threads.filter((t) => f.types.includes(t.subject_type)).length,
  ])), [threads]);

  async function send(body) {
    await api.messageSend(openUid, body);
    await loadThread(openUid);
  }
  async function attach(file, body) {
    await api.messageAttach(openUid, file, body);
    await loadThread(openUid);
  }

  const meId = detail?.me?.user_id ?? user?.id;
  const other = detail?.participants?.[0] || null;
  const grouped = detail ? groupMessages(detail.messages || [], meId) : [];
  const empty = list && threads.length === 0;
  const sub = !list ? '' : empty ? 'No conversations yet'
    : list.unread_total > 0
      ? `${list.unread_total} unread across ${threads.length} conversation${threads.length === 1 ? '' : 's'}`
      : `${threads.length} conversation${threads.length === 1 ? '' : 's'} · all read`;
  const firstName = other?.name ? other.name.split(' ')[0] : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"><Mail size={18} /></span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Messages</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="messages-sub">{sub}</p>
          </div>
        </div>
        <button type="button" onClick={() => setComposing(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-2 text-sm font-medium text-white">
          <PenLine size={15} /> New message
        </button>
      </header>

      {listErr && <Unreadable what="Your conversations" claim="It is not a sign you have none." onRetry={loadList} />}

      {!list && !listErr ? (
        <p className="text-sm text-gray-500"><Loader2 size={13} className="inline animate-spin" /> Loading…</p>
      ) : list && (
        <div className="grid min-h-[32rem] overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 md:grid-cols-[minmax(0,340px)_1fr]">
          {/* ============ LIST PANE ============ */}
          <section className={`flex min-h-0 flex-col border-gray-200 dark:border-gray-800 md:border-r ${openUid ? 'hidden md:flex' : 'flex'}`} data-testid="messages-list">
            <div className="space-y-2 border-b border-gray-200 p-3 dark:border-gray-800">
              <label className="relative block">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-gray-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people or context"
                  aria-label="Search people or context" title={list.absent?.search_scope || undefined}
                  className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm dark:border-gray-700 dark:bg-gray-900" />
              </label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter conversations">
                {FILTERS.map((f) => (
                  <button key={f.k} type="button" onClick={() => setFilter(f.k)} aria-pressed={filter === f.k}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold ${
                      filter === f.k ? 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400'}`}>
                    {f.k}
                    {counts[f.k] ? <span className={`rounded-full px-1.5 text-[9.5px] font-extrabold ${filter === f.k ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>{counts[f.k]}</span> : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {empty ? (
                <div className="p-6 text-center" data-testid="messages-empty-list">
                  <Mail size={20} className="mx-auto text-violet-500" />
                  <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Your inbox is ready</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
                    No conversations yet. {list.absent?.auto_threads}
                  </p>
                </div>
              ) : visible.length === 0 ? (
                <div className="p-6 text-center" data-testid="messages-no-match">
                  <Search size={18} className="mx-auto text-gray-400" />
                  <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Nothing matches</p>
                  <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">
                    No conversations under this filter. Try{' '}
                    <button type="button" onClick={() => { setFilter('All'); setQuery(''); }} className="font-semibold text-violet-700 underline dark:text-violet-300">clearing filters</button>.
                  </p>
                </div>
              ) : visible.map((t) => {
                const p = t.participants?.[0] || null;
                const active = t.uid === openUid;
                return (
                  <button key={t.uid} type="button" onClick={() => setOpenUid(t.uid)} data-testid="messages-row"
                    className={`flex w-full gap-3 border-b border-gray-100 px-3 py-3 text-left dark:border-gray-800 ${active ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}>
                    <Avatar person={p} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-[13.5px] ${t.unread ? 'font-extrabold text-gray-900 dark:text-gray-100' : 'font-semibold text-gray-800 dark:text-gray-200'}`}>
                          <PersonName person={p} reason={list.absent?.name} />
                        </span>
                        <span className="flex-none text-[11px] text-gray-400">{fmtWhen(t.last_message_at || t.created_at)}</span>
                      </div>
                      {t.subject_type && <div className="mt-1"><SubjectChip type={t.subject_type} subject={t.subject} /></div>}
                      <div className="mt-1 flex items-start gap-2">
                        <span className={`line-clamp-2 flex-1 text-[12px] leading-snug ${t.unread ? 'text-gray-800 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'}`}>{t.preview || 'No messages'}</span>
                        {t.unread > 0 && <span className="flex-none rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white">{t.unread}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ============ THREAD PANE ============ */}
          <section className={`min-h-0 flex-col ${openUid ? 'flex' : 'hidden md:flex'}`} data-testid="messages-thread">
            {empty ? (
              <div className="m-auto max-w-md p-8 text-center" data-testid="messages-empty-thread">
                <p className="text-base font-bold text-gray-900 dark:text-gray-100">One inbox, whatever the reason</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
                  Each conversation carries the label its starter gave it, so you can tell an introduction from an engagement at a glance.
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {['introduction', 'match', 'job', 'engagement'].map((k) => <SubjectChip key={k} type={k} />)}
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
                  Your assistant conversations live in the <span className="font-medium">Eadwyn</span> rail, and support requests are in{' '}
                  <Link to="/help" className="text-violet-700 hover:underline dark:text-violet-300">Tickets</Link>
                  {' '}— neither is folded in here, because neither is a message between two people.
                </p>
              </div>
            ) : !openUid ? (
              <div className="m-auto max-w-sm p-8 text-center" data-testid="messages-none-selected">
                <MailOpen size={22} className="mx-auto text-gray-400" />
                <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Select a conversation</p>
                <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-400">Pick a thread on the left to read it here. Every conversation keeps the context it started from.</p>
              </div>
            ) : detailErr ? (
              <div className="p-4"><Unreadable what="This conversation" claim="It has not been deleted." onRetry={() => loadThread(openUid)} /></div>
            ) : !detail ? (
              <p className="m-auto text-sm text-gray-500"><Loader2 size={13} className="inline animate-spin" /> Opening…</p>
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800" data-testid="messages-thread-header">
                  <button type="button" onClick={() => setOpenUid(null)} className="md:hidden" aria-label="Back to conversations"><ArrowLeft size={18} /></button>
                  <Avatar person={other} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold text-gray-900 dark:text-gray-100"><PersonName person={other} reason={detail.absent?.name} /></div>
                    {roleLine(other) && <div className="truncate text-[11.5px] text-gray-500">{roleLine(other)}</div>}
                  </div>
                  {other?.profile_path && (
                    <Link to={other.profile_path} className="text-[12px] font-semibold text-violet-700 hover:underline dark:text-violet-300">View profile</Link>
                  )}
                  {detail.thread?.status === 'open' && (
                    <button type="button"
                      onClick={async () => { await api.messageArchive(openUid); setOpenUid(null); loadList(); }}
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">
                      <Archive size={13} /> Archive
                    </button>
                  )}
                </div>
                <ContextStrip context={detail.context} reason={detail.absent?.context} />
                {detail.absent?.context_link && (
                  <p className="border-b border-gray-200 px-4 py-1.5 text-[11px] text-gray-500 dark:border-gray-800">{detail.absent.context_link}</p>
                )}

                <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-4" data-testid="messages-bubbles">
                  {grouped.map((m) => (
                    <React.Fragment key={m.uid}>
                      {m.day && <div className="py-3 text-center text-[10.5px] font-bold uppercase tracking-wide text-gray-400">{m.day}</div>}
                      <div className={`flex items-end gap-2 ${m.mine ? 'justify-end' : 'justify-start'} ${m.showTime ? 'mb-2' : ''}`}>
                        {!m.mine && (m.showAvatar ? <Avatar person={other} size={26} /> : <div className="w-[26px] flex-none" />)}
                        <div className="max-w-[75%]">
                          {m.showName && <div className="mb-0.5 text-[11px] font-semibold text-gray-500"><PersonName person={other} reason={detail.absent?.name} /></div>}
                          <div className={`whitespace-pre-wrap rounded-[14px] px-3 py-2 text-sm ${m.mine ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'}`}>
                            {m.body}
                            {(m.attachments || []).map((a) => <AttachmentChip key={a.uid} threadUid={openUid} a={a} mine={m.mine} />)}
                          </div>
                          {m.showTime && <div className={`mt-0.5 text-[10px] text-gray-400 ${m.mine ? 'text-right' : ''}`}>{timeOf(m.created_at)}</div>}
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                  <div ref={endRef} />
                </div>

                <Composer
                  onSend={send}
                  onAttach={attach}
                  disabled={detail.thread?.status !== 'open'}
                  hint={firstName ? `Message ${firstName}…` : 'Write a message…'}
                  attachReason={detail.absent?.attachments}
                  note={detail.context
                    ? `This thread stays attached to ${detail.context.kind.toLowerCase()}: ${detail.context.title}.`
                    : (detail.absent?.attachments || 'Attachments are visible to both parties only.')}
                />
              </>
            )}
          </section>
        </div>
      )}

      {composing && (
        <NewThread
          onClose={() => setComposing(false)}
          onCreated={(uid) => { setComposing(false); loadList(); if (uid) setOpenUid(uid); }}
        />
      )}
    </div>
  );
}
