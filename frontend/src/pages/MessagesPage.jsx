import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Inbox, Archive, Plus, X, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

/**
 * Messages — /messages. A person-to-person inbox on migration 185.
 *
 * The canvas calls this a "unified inbox". It is not unifying anything,
 * because there was nothing to unify: the only two message-shaped stores in
 * D1 are the AI assistant transcript (`advisor_messages`, whose roles are
 * user/assistant/tool) and a Slack-bridged support thread. Neither is a
 * conversation between two members. So this starts empty, and the empty state
 * says where those other two live rather than implying they were folded in.
 *
 * A thread can be pinned to the thing it is about — an introduction, a match,
 * an engagement, a service, a session or a job — which is what the context
 * line under each conversation shows. A thread pinned to nothing is a plain
 * direct message, and that is a legitimate state, not a missing field.
 */

const SUBJECT_LABEL = {
  introduction: 'Introduction',
  match: 'Co-founder match',
  engagement: 'Engagement',
  service: 'Service',
  session: 'Session',
  job: 'Role',
};

function personLabel(p) {
  return p?.name || p?.email || 'Someone';
}

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = (Date.now() - d.getTime()) / 86400000;
  if (days < 1) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Composer({ onSend, disabled }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try { await onSend(body); setText(''); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="flex gap-2 border-t border-gray-200 dark:border-gray-800 p-3">
      <input
        value={text} onChange={(e) => setText(e.target.value)} disabled={disabled || busy}
        placeholder={disabled ? 'This conversation is archived' : 'Write a message…'}
        className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm disabled:opacity-60"
      />
      <button type="submit" disabled={disabled || busy || !text.trim()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send
      </button>
    </form>
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
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        {err && <p className="mb-3 rounded-lg bg-red-50 dark:bg-red-900/20 p-2 text-sm text-red-700 dark:text-red-300">{err}</p>}
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">To</label>
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="them@company.com"
          className="mb-1 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
        />
        <p className="mb-3 text-[11px] text-gray-500">
          They must already have an Axal account — this does not send an invitation.
        </p>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Message</label>
        <textarea
          required rows={4} value={body} onChange={(e) => setBody(e.target.value)}
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

export default function MessagesPage({ user }) {
  const [threads, setThreads] = useState(null);
  const [openUid, setOpenUid] = useState(null);
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState('');
  const [composing, setComposing] = useState(false);
  const endRef = useRef(null);

  const loadThreads = useCallback(async () => {
    try { const d = await api.messageThreads(); setThreads(d?.items || []); }
    catch (e) { reportError('messages_list_failed', e); setErr(e?.message || 'Could not load your messages'); }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  const loadThread = useCallback(async (uid) => {
    if (!uid) { setDetail(null); return; }
    try {
      const d = await api.messageThread(uid);
      setDetail(d);
      // Opening IS reading. The unread count is derived from last_read_at, so
      // this is the only thing that clears it.
      await api.messageMarkRead(uid);
      loadThreads();
    } catch (e) { setErr(e?.message || 'Could not open that conversation'); }
  }, [loadThreads]);

  useEffect(() => { loadThread(openUid); }, [openUid, loadThread]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [detail]);

  async function send(body) {
    await api.messageSend(openUid, body);
    await loadThread(openUid);
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Messages</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Conversations with people across the network.
          </p>
        </div>
        <button type="button" onClick={() => setComposing(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-2 text-sm font-medium text-white">
          <Plus size={15} /> New
        </button>
      </header>

      {err && <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">{err}</div>}

      {threads === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : threads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
          <Inbox size={20} className="mx-auto text-gray-400" />
          <p className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300">No conversations yet.</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Start one above. Your assistant conversations live in the{' '}
            <span className="font-medium">Eadwyn</span> rail, and support requests are in{' '}
            <Link to="/tickets" className="text-violet-700 hover:underline dark:text-violet-300">Tickets</Link>
            {' '}— neither is folded in here, because neither is a message between two people.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr]">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
            {threads.map((t) => {
              const who = (t.participants || []).map(personLabel).join(', ') || 'Conversation';
              const active = t.uid === openUid;
              return (
                <button key={t.uid} type="button" onClick={() => setOpenUid(t.uid)}
                  className={`block w-full px-3 py-3 text-left ${active ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${t.unread ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-800 dark:text-gray-200'}`}>
                      {who}
                    </span>
                    <span className="shrink-0 text-[11px] text-gray-400">{fmtWhen(t.last_message_at || t.created_at)}</span>
                  </div>
                  {t.subject_type && (
                    <div className="mt-0.5 text-[11px] text-violet-700 dark:text-violet-300">
                      {SUBJECT_LABEL[t.subject_type] || t.subject_type}
                      {t.subject ? ` · ${t.subject}` : ''}
                    </div>
                  )}
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="flex-1 truncate text-xs text-gray-500 dark:text-gray-400">{t.preview || 'No messages'}</span>
                    {t.unread > 0 && (
                      <span className="rounded-full bg-violet-600 px-1.5 text-[10px] font-semibold text-white">{t.unread}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-800 flex flex-col min-h-[24rem]">
            {!detail ? (
              <p className="m-auto text-sm text-gray-500">Pick a conversation.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-800 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {(detail.participants || []).filter((p) => p.user_id !== user?.id).map(personLabel).join(', ')}
                    </div>
                    {detail.thread?.subject_type && (
                      <div className="text-[11px] text-violet-700 dark:text-violet-300">
                        {SUBJECT_LABEL[detail.thread.subject_type] || detail.thread.subject_type}
                        {detail.thread.subject ? ` · ${detail.thread.subject}` : ''}
                      </div>
                    )}
                  </div>
                  {detail.thread?.status === 'open' && (
                    <button type="button"
                      onClick={async () => { await api.messageArchive(openUid); setOpenUid(null); loadThreads(); }}
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">
                      <Archive size={13} /> Archive
                    </button>
                  )}
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-3">
                  {(detail.messages || []).map((m) => {
                    const mine = m.sender_user_id === user?.id;
                    return (
                      <div key={m.uid} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-xl px-3 py-2 ${
                          mine
                            ? 'bg-violet-600 text-white'
                            : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                        }`}>
                          {!mine && (
                            <div className="mb-0.5 text-[11px] font-medium opacity-70">{m.sender_name || m.sender_email}</div>
                          )}
                          <div className="whitespace-pre-wrap text-sm">{m.body}</div>
                          <div className={`mt-0.5 text-[10px] ${mine ? 'text-violet-200' : 'text-gray-400'}`}>{fmtWhen(m.created_at)}</div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={endRef} />
                </div>

                <Composer onSend={send} disabled={detail.thread?.status !== 'open'} />
              </>
            )}
          </div>
        </div>
      )}

      {composing && (
        <NewThread
          onClose={() => setComposing(false)}
          onCreated={(uid) => { setComposing(false); loadThreads(); if (uid) setOpenUid(uid); }}
        />
      )}
    </div>
  );
}
