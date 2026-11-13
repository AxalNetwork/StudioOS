// D4494: Distribution's real reply threads; Accept edits the composer, only confirmed Send sends.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Lightbox from '../../../ui/Lightbox';
import { growInboxApi } from '../../../lib/api/growInbox.js';
import { mailApi } from '../../../lib/api/mail.js';
import { Card, LoadingSkeleton, ProposalBlock, StatusNote } from './DistributionParts.jsx';
import { acceptedReply, bookingHref, bubbleDirection, channelLabel, INBOX_EMPTY, INBOX_EMPTY_NOTE, messageTime, REPLY_ACCEPT_NOTE, replySubject, sendConfirmedReply, threadName, unreadCount } from './inboxModel.js';
import './inbox.css';

/** The header badge and Overview row share one successful unread response. */
export function useInboxUnread(projectId, { enabled = true, api = growInboxApi } = {}) {
  const [reading, setReading] = useState(null), [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  const acceptRead = useCallback((data) => setReading({ projectId, state: data?.state === 'ready' ? 'ready' : 'unreadable', count: data?.state === 'ready' ? unreadCount(data.count ?? data.unread_count) : null, needsYou: data?.needs_you ?? null }), [projectId]);
  useEffect(() => {
    if (!projectId || !enabled) return undefined;
    let live = true; setReading({ projectId, state: 'loading', count: null });
    api.unread(projectId).then((data) => { if (live) acceptRead(data); }).catch(() => { if (live) setReading({ projectId, state: 'unreadable', count: null }); });
    return () => { live = false; };
  }, [projectId, enabled, api, attempt, acceptRead]);
  return { ...(reading?.projectId === projectId ? reading : { state: projectId && enabled ? 'loading' : 'idle', count: null }), refresh, acceptRead };
}

export function InboxNeedsYou({ reading, search = '' }) {
  const count = unreadCount(reading?.count);
  if (reading?.state === 'unreadable') return <StatusNote tone="warn">Unreadable: replies could not be counted. <Link to={'/grow/distribution/inbox' + search}>Open Replies</Link></StatusNote>;
  if (count == null || count === 0) return null;
  const org = reading?.needsYou?.organization;
  return <Card className="inbox-needs"><span><b className="ds-eyebrow">Replies</b> · {count} reply {count === 1 ? 'thread waits' : 'threads wait'}{org?.name && unreadCount(org.count) != null ? ', ' + org.count + ' from ' + org.name : ''}.</span><Link to={'/grow/distribution/inbox' + search}>Open Replies</Link></Card>;
}

export function MessageBubble({ message, name }) {
  const direction = bubbleDirection(message);
  return <article className={'inbox-bubble is-' + direction} data-direction={direction}>
    <p className="inbox-meta">{direction === 'outbound' ? 'You' : name || 'Not recorded'} · {channelLabel(message.channel)} · <time dateTime={message.at || undefined}>{messageTime(message.at)}</time></p>
    {message.subject && <p className="inbox-subject">{message.subject}</p>}
    <p className="inbox-message">{message.body ?? 'Message body: Not recorded.'}</p>
    {message.preview && <p className="inbox-meta">Mailbox preview</p>}
  </article>;
}

export function ReplyComposer({ projectId, detail, DraftIntent = null, proposal = null, api = mailApi, onSent }) {
  const [text, setText] = useState(''), [subject, setSubject] = useState(() => replySubject(detail.thread));
  const [accountUid, setAccountUid] = useState(() => detail.accounts?.find((a) => a.status === 'active')?.uid ?? '');
  const [drafting, setDrafting] = useState(false), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const [discarded, setDiscarded] = useState(null);
  const live = useRef(true), sending = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const accept = (rows) => { if (!live.current) return; const row = Array.isArray(rows) ? rows.find((r) => acceptedReply(r) != null) : rows; const reply = acceptedReply(row); if (reply != null) { setText(reply); setDrafting(false); } };
  const canSend = detail.can_write === true && !!accountUid && !!detail.recipient && !!text.trim() && !!subject.trim();
  const send = async () => {
    if (!canSend || sending.current) return;
    sending.current = true;
    setBusy(true); setError(null);
    try { await sendConfirmedReply(api, { accountUid, recipient: detail.recipient, subject, body: text }); if (live.current) { setText(''); setConfirm(false); onSent?.(); } }
    catch { if (live.current) { setConfirm(false); setError('The reply could not be sent. Check your mailbox before trying again.'); } }
    finally { sending.current = false; if (live.current) setBusy(false); }
  };
  return <section className="inbox-compose" aria-label="Reply composer">
    <p className="ds-eyebrow">From your own mailbox</p>
    {detail.can_write !== true && <StatusNote>This venture is read only. You can read these replies.</StatusNote>}
    <label>Mailbox<select aria-label="Mailbox" value={accountUid} disabled={busy || detail.can_write !== true} onChange={(e) => setAccountUid(e.target.value)}><option value="">Choose a mailbox</option>{detail.accounts?.filter((a) => a.status === 'active').map((a) => <option key={a.uid} value={a.uid}>{a.display_name || a.address}</option>)}</select></label>
    {!detail.accounts?.some((a) => a.status === 'active') && <p><Link to="/email">Connect a mailbox</Link> to send a reply.</p>}
    {!detail.recipient && <StatusNote>Email: Not recorded. Add an address in the prospect’s sheet before replying.</StatusNote>}
    <label>Subject<input aria-label="Reply subject" value={subject} maxLength={200} disabled={busy || detail.can_write !== true} onChange={(e) => setSubject(e.target.value)} /></label>
    <label className="sr-only" htmlFor="distribution-reply">Write a reply, or ask Eadwyn.</label>
    <textarea id="distribution-reply" aria-label="Write a reply, or ask Eadwyn." placeholder="Write a reply, or ask Eadwyn." value={text} maxLength={20000} disabled={busy || detail.can_write !== true} onChange={(e) => setText(e.target.value)} />
    {!text.trim() && <button type="button" className="inbox-secondary" disabled={!DraftIntent || detail.can_write !== true} title={!DraftIntent ? 'Reply drafting is not available yet.' : undefined} onClick={() => setDrafting(true)}>Ask</button>}
    {drafting && DraftIntent && <DraftIntent projectId={projectId} campaignUid={detail.thread.campaign?.uid} contactUid={detail.thread.contact.uid} kinds={['reply']} onAccept={accept} onClose={() => setDrafting(false)} />}
    {proposal && discarded !== proposal.uid && acceptedReply(proposal) != null && <><ProposalBlock proposal={{ ...proposal, status: 'proposed' }} title="Suggested reply · never sent without Accept" onAccept={() => { accept(proposal); setDiscarded(proposal.uid); }} onEdit={() => { accept(proposal); setDiscarded(proposal.uid); }} onDiscard={() => setDiscarded(proposal.uid)}>{acceptedReply(proposal)}</ProposalBlock><p className="inbox-meta">{REPLY_ACCEPT_NOTE}</p></>}
    {error && <StatusNote tone="negative">{error}</StatusNote>}
    <div className="inbox-actions"><button type="button" className="ds-primary" disabled={!canSend || busy} onClick={() => setConfirm(true)}>Send</button></div>
    {confirm && <Lightbox title={'Send this reply to ' + (detail.thread.contact.name || 'this prospect') + '?'} label="Confirm reply" onClose={() => { if (!busy) setConfirm(false); }} width={480}>
      <p>{REPLY_ACCEPT_NOTE}</p><p className="inbox-message">To {detail.thread.contact.name || 'this prospect'} · {detail.recipient}</p><p className="inbox-message">{text}</p><div className="inbox-actions"><button type="button" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button type="button" className="ds-primary" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send reply'}</button></div>
    </Lightbox>}
  </section>;
}

export default function InboxTab({ projectId, api = growInboxApi, mail = mailApi, DraftIntent = null, onUnreadChange }) {
  const [query, setQuery] = useState(''), [selection, setSelection] = useState(null), [list, setList] = useState(null), [detail, setDetail] = useState(null), [reload, setReload] = useState(0), [listVersion, setListVersion] = useState(0);
  const selected = selection?.projectId === projectId ? selection.uid : null;
  const countCallback = useRef(onUnreadChange); countCallback.current = onUnreadChange;
  useEffect(() => {
    if (!projectId) return undefined;
    let live = true; setList({ projectId, state: 'loading' });
    api.list(projectId, query).then((data) => { if (!Array.isArray(data?.threads) || !['ready', 'unreadable'].includes(data.state)) throw new Error('Unreadable inbox'); if (live) { setList({ projectId, ...data }); countCallback.current?.(data); } }).catch(() => { if (live) { setList({ projectId, state: 'unreadable' }); countCallback.current?.({ state: 'unreadable' }); } });
    return () => { live = false; };
  }, [projectId, query, reload, listVersion, api]);
  useEffect(() => {
    if (!projectId || !selected) return undefined;
    let live = true; setDetail({ projectId, selected, state: 'loading' });
    api.thread(projectId, selected).then(async (data) => {
      if (!live) return;
      if (data?.thread?.contact?.uid !== selected || !Array.isArray(data.thread.messages)) throw new Error('Unreadable thread');
      setDetail({ projectId, selected, ...data });
      if (data.state === 'ready') {
        const keys = data.thread?.messages?.filter((m) => m.direction === 'inbound').map((m) => m.key) ?? [];
        if (keys.length) { try { await api.read(projectId, selected, keys); if (live) setListVersion((n) => n + 1); } catch { /* Keep the read badge unknown; never invent a successful receipt. */ if (live) countCallback.current?.({ state: 'unreadable' }); } }
      }
    }).catch(() => { if (live) setDetail({ projectId, selected, state: 'unreadable' }); });
    return () => { live = false; };
  }, [projectId, selected, api, reload]);
  const current = list?.projectId === projectId ? list : { state: 'loading' };
  const thread = detail?.projectId === projectId && detail?.selected === selected ? detail : null;
  return <div className="distribution-inbox">
    <div className="inbox-connection-states" aria-label="Reply channels">{current.channels?.map((c) => <span key={c.channel}>{channelLabel(c.channel)} · {c.state === 'connected' ? 'Connected' : c.state === 'recorded' ? 'Recorded replies' : 'Not connected'}</span>)}</div>
    {current.state === 'unreadable' && <StatusNote tone="warn">Unreadable: some replies could not be read. Counts are not available. <button type="button" onClick={() => setReload((n) => n + 1)}>Try again</button></StatusNote>}
    <button type="button" className="inbox-secondary" onClick={() => setReload((n) => n + 1)}>Refresh replies</button>
    <div className="inbox-columns"><Card className="inbox-thread-list"><label>Search replies<input aria-label="Search replies" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={120} /></label>
      {current.state === 'loading' && <LoadingSkeleton label="Inbox" />}
      {current.threads?.length === 0 && current.state === 'ready' && <div className="inbox-empty"><h2>{query ? 'No matching replies.' : INBOX_EMPTY}</h2><p>{query ? 'Try a different search.' : INBOX_EMPTY_NOTE}</p></div>}
      {current.threads?.map((t) => <button type="button" key={t.contact.uid} className={'inbox-thread' + (selected === t.contact.uid ? ' is-selected' : '')} aria-pressed={selected === t.contact.uid} onClick={() => setSelection({ projectId, uid: t.contact.uid })}><span className="inbox-avatar" aria-hidden="true">{t.contact.name?.slice(0, 1) || '?'}</span><span><span className={t.unread === true ? 'inbox-unread' : ''}>{threadName(t)}</span><small>{channelLabel(t.channel)} · {messageTime(t.last_at)}</small><span className="inbox-preview">{t.last_line ?? 'Not recorded'}</span></span></button>)}
    </Card><Card className="inbox-thread-card">
      {!selected ? <p className="ds-not-recorded">Choose a thread to read its replies.</p> : !thread || thread.state === 'loading' ? <LoadingSkeleton label="thread" /> : !thread.thread ? <StatusNote tone="warn">Unreadable: this thread could not be read.</StatusNote> : <>
        <div className="inbox-thread-heading"><div><h2>{threadName(thread.thread)}</h2><p>One thread · every channel</p></div><Link className="inbox-secondary" to={bookingHref(thread.thread.contact.uid)}>Book a demo</Link></div>
        {thread.state === 'unreadable' && <StatusNote tone="warn">Unreadable: some messages could not be read.</StatusNote>}
        <div className="inbox-messages">{thread.thread.messages?.map((message) => <MessageBubble key={message.key} message={message} name={thread.thread.contact.name} />)}</div>
        <ReplyComposer key={projectId + ':' + selected} projectId={projectId} detail={thread} api={mail} DraftIntent={DraftIntent} onSent={() => setReload((n) => n + 1)} />
      </>}
    </Card></div>
  </div>;
}
