import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api as appApi } from '../../lib/api';
import { channelsApi } from '../../lib/api/channels.js';
import { Unreadable } from '../../ui';
import { useChannelsOverview } from '../account/ChannelsGroup';
import { CHANNELS_HREF, MESSAGING_PROVIDERS } from '../account/channelsModel';
import { ProviderTag } from './InterviewChannels';
import { CHAT_CONSENT_METHODS, canAttest, chatConsentOf, consentLine, noticeBlocked, windowClosedSentence } from './chatConsent.js';
import {
  THREAD_TABS, assignedSentence, clientKeyFor, composerState, contactLabel, interviewOptions, keepKeyAfter, messageView,
  replyFailureText, replyOutcome, sessionHref, threadItems, threadRow,
} from './channelThreads.js';

/**
 * D684 (#1575, S02 #1578) — Validate › Conversations, `/validate/inbox`: the
 * customer chats from the member's business Telegram and WhatsApp.
 *
 * A CHAT REACHES AN INTERVIEW ONLY WHEN THE MEMBER SAYS WHICH. Each one waits
 * here until it is assigned to an interview (or one is created from it, by an
 * explicit form) or ignored; waiting chats are deleted after 30 days. Once
 * assigned, its messages are that interview's transcript and new ones follow.
 *
 * The reply composer sends through the member's own account and says why it
 * cannot when the provider's 24-hour rule or the bot's rights forbid it. A
 * Telegram reply is "Sent", never "Delivered": Telegram reports acceptance only.
 * No reply is "Sent" before a provider took it.
 *
 * The rules are `channelThreads.js`; the Worker's shapes are in its header.
 */

const TONE = 'rounded-axal-sm border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const SMALL = 'rounded-md border border-gray-200 px-2.5 py-1 text-[12px] font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800';
const PRIMARY = 'rounded-md bg-violet-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const NOTE = 'text-[12px] leading-snug text-axal-faint';
const FIELD = 'w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/**
 * The venture the sidebar has chosen, and its interviews, for the assign
 * picker and the create form. One company, one startup (#181): the venture is
 * named, never picked here.
 */
export function useVentureInterviews(source = appApi, enabled = true) {
  const [st, setSt] = useState({ status: 'loading', project: null, interviews: [] });
  const load = useCallback(async () => {
    try {
      const rows = await source.listProjects();
      const list = Array.isArray(rows) ? rows : (rows?.projects || []);
      const p = list[0] || null;
      if (!p) { setSt({ status: 'ready', project: null, interviews: [] }); return; }
      const r = await source.listInterviews(p.id);
      setSt({ status: 'ready', project: { id: Number(p.id), name: String(p.name || '').trim() || 'Your venture' }, interviews: interviewOptions(r) });
    } catch {
      setSt({ status: 'unreadable', project: null, interviews: [] });
    }
  }, [source]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  return { ...st, reload: load };
}

/** The list of conversations in one tab. */
export function ThreadList({ items, selected, onSelect, now }) {
  if (!items.length) return null;
  return (
    <ul className={`${TONE} divide-y divide-axal-hairline dark:divide-gray-800`} data-testid="thread-list">
      {items.map((t) => {
        const row = threadRow(t, now);
        return (
          <li key={t.uid}>
            <button type="button" onClick={() => onSelect(t.uid)} aria-current={selected === t.uid ? 'true' : undefined} data-testid={`thread-row-${t.uid}`}
              className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 ${selected === t.uid ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`}>
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-900 dark:text-gray-100"><span className="truncate">{row.name}</span><ProviderTag provider={t.provider} /></span>
              <span className={NOTE}>{row.count} · {row.when}</span>
              {row.interviewee && <span className="text-[11.5px] text-violet-800 dark:text-violet-200">In the interview with {row.interviewee}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The messages of a waiting conversation, oldest first, each side on its own
 * side. A voice note that was not transcribed says why, in the Worker's
 * sentence, with Retry when the Worker allows it (#1933, `voiceFailure`).
 */
export function MessageList({ messages, contact, threadUid, api = channelsApi, onRetried }) {
  // Per message: 'busy', 'sent' ("Trying again…", kept after the re-read clears the failure), or the Worker's refusal.
  const [retries, setRetries] = useState({});
  if (!messages.length) return null;
  const retry = async (uid) => {
    setRetries((r) => ({ ...r, [uid]: { state: 'busy' } }));
    try {
      await api.retryVoice(threadUid, uid);
      setRetries((r) => ({ ...r, [uid]: { state: 'sent' } }));
      onRetried?.();
    } catch (e) {
      setRetries((r) => ({ ...r, [uid]: { state: 'error', text: e?.message || 'That voice note could not be retried. Try again.' } }));
    }
  };
  return (
    <ol className="space-y-2" data-testid="thread-messages">
      {messages.map((m) => {
        const v = messageView(m, contact);
        const r = retries[v.uid];
        return (
          <li key={v.uid} className={`flex ${v.mine ? 'justify-end' : 'justify-start'}`} data-side={v.mine ? 'me' : 'contact'}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] ${v.mine ? 'bg-violet-50 text-gray-900 dark:bg-violet-950/40 dark:text-gray-100' : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'}`}>
              <div className="mb-0.5 text-[11px] font-semibold text-axal-faint">{v.who}{v.label ? ` · ${v.label}` : ''}</div>
              {v.text != null
                ? <p className="whitespace-pre-wrap break-words">{v.text}</p>
                : v.failure
                  ? <p className="text-amber-800 dark:text-amber-300" data-testid={`voice-failure-${v.uid}`}>{v.failure.sentence}</p>
                  : <p className="italic text-gray-500 dark:text-gray-400">This message could not be read.</p>}
              {v.failure?.action?.kind === 'retry' && r?.state !== 'sent' && (
                <button type="button" className={`${SMALL} mt-1`} disabled={r?.state === 'busy'} onClick={() => retry(v.uid)} data-testid={`button-voice-retry-${v.uid}`}>Retry</button>
              )}
              {v.failure?.action?.kind === 'note' && <p className={`${NOTE} mt-1`}>{v.failure.action.text}</p>}
              {v.failure?.action?.kind === 'link' && (
                <p className={`${NOTE} mt-1`}>{v.failure.action.text}{' '}<Link to={v.failure.action.href} className="font-semibold text-violet-800 underline dark:text-violet-200" data-testid={`link-voice-usage-${v.uid}`}>{v.failure.action.link}</Link></p>
              )}
              {r?.state === 'sent' && <p role="status" className={`${NOTE} mt-1`} data-testid={`voice-retrying-${v.uid}`}>Trying again…</p>}
              {r?.state === 'error' && <p role="alert" className="mt-1 text-[12px] font-semibold text-red-700 dark:text-red-400">{r.text}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The reply box. One `client_key` per composed message: kept after any failure
 * that is not the Worker's refusal (no answer, a 5xx), so pressing Send again
 * cannot send it twice; dropped once it is sent, once the Worker has refused
 * it (that key is spent), or when the words change (`keepKeyAfter`). A repeat
 * whose first attempt has no outcome yet is never "Sent": the words stay, with
 * what to do next (`replyOutcome`).
 */
export function ReplyComposer({ thread, api = channelsApi, onSent, makeKey }) {
  const [text, setText] = useState('');
  const key = useRef(null);
  const [st, setSt] = useState({ busy: false, sent: '', error: '', pending: '' });
  const cs = composerState(thread);
  const send = async () => {
    const body = text.trim();
    if (!body || !cs.enabled || st.busy) return;
    key.current = clientKeyFor(key.current, makeKey);
    setSt({ busy: true, sent: '', error: '', pending: '' });
    try {
      const out = replyOutcome(thread.provider, await api.reply(thread.uid, body, key.current));
      if (out.ok === null) {
        // Not known to have gone: the words stay, and the key stays while the first attempt may still be running.
        if (!out.keepKey) key.current = null;
        setSt({ busy: false, sent: '', error: '', pending: out.text });
        return;
      }
      key.current = null;
      if (!out.ok) { setSt({ busy: false, sent: '', error: out.text, pending: '' }); return; }
      setText('');
      setSt({ busy: false, sent: out.label, error: '', pending: '' });
      onSent?.();
    } catch (e) {
      if (!keepKeyAfter(e)) key.current = null;
      setSt({ busy: false, sent: '', error: replyFailureText(e), pending: '' });
    }
  };
  return (
    <div className="space-y-1.5 border-t border-axal-hairline pt-3 dark:border-gray-800" data-testid="reply-composer" data-enabled={cs.enabled ? 'true' : 'false'}>
      <label htmlFor="channel-reply" className="text-[11px] font-bold uppercase tracking-wide text-axal-faint">Reply</label>
      <textarea id="channel-reply" rows={3} maxLength={8000} className={FIELD} disabled={!cs.enabled || st.busy} value={text}
        onChange={(e) => { setText(e.target.value); key.current = null; setSt((s) => ({ ...s, sent: '', pending: '' })); }} data-testid="input-reply" />
      {!cs.enabled && cs.reason && <p className={NOTE} data-testid="reply-disabled-reason">{cs.reason}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px]">
          {st.sent && <span role="status" className="text-emerald-700 dark:text-emerald-300" data-testid="reply-sent">{st.sent}</span>}
          {st.pending && <span role="status" className="text-amber-800 dark:text-amber-300" data-testid="reply-pending">{st.pending}</span>}
          {st.error && <span role="alert" className="text-red-700 dark:text-red-300" data-testid="reply-error">{st.error}</span>}
        </span>
        <button type="button" className={PRIMARY} disabled={!cs.enabled || st.busy || !text.trim()} onClick={send} data-testid="button-reply-send">{st.busy ? 'Sending…' : 'Send'}</button>
      </div>
    </div>
  );
}

/**
 * Assign to an interview the member already has, or create one from this
 * chat with an explicit name in the venture the sidebar has chosen.
 */
export function AssignControls({ thread, venture, api = channelsApi, onAssigned, initialMode = 'pick' }) {
  const [mode, setMode] = useState(initialMode);
  const [pick, setPick] = useState('');
  const [name, setName] = useState(() => (thread?.contact_name || '').trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const others = venture.interviews.filter((i) => i.id !== Number(thread.interview_id));
  const run = async (target, label) => {
    setBusy(true); setError('');
    try { const r = await api.assign(thread.uid, target); onAssigned?.(r, label); }
    catch (e) { setError(e?.message || 'That conversation could not be assigned. Try again.'); }
    finally { setBusy(false); }
  };
  if (venture.status === 'loading') return <p className={NOTE}>Reading your interviews…</p>;
  if (venture.status === 'unreadable') return <Unreadable what="Your interviews" claim="This is not a claim that you have none." onRetry={venture.reload} />;
  if (!venture.project) return <p className={NOTE}>No venture yet. Create one in Build, then assign this conversation to one of its interviews.</p>;
  return (
    <div className="space-y-2" data-testid="assign-controls">
      {mode === 'pick' ? (
        <>
          <label htmlFor="assign-interview" className="block text-[11px] font-bold uppercase tracking-wide text-axal-faint">{thread.status === 'assigned' ? 'Move new messages to another interview' : 'Assign to an interview'}</label>
          {others.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <select id="assign-interview" className={`${FIELD} max-w-sm`} value={pick} onChange={(e) => setPick(e.target.value)} data-testid="select-assign-interview">
                <option value="">Choose an interview…</option>
                {others.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
              </select>
              <button type="button" className={PRIMARY} disabled={!pick || busy} onClick={() => run({ interview_id: Number(pick) }, others.find((i) => i.id === Number(pick))?.name)} data-testid="button-assign">{busy ? 'Assigning…' : 'Assign to interview'}</button>
            </div>
          ) : <p className={NOTE}>No other interview in {venture.project.name} yet.</p>}
          <button type="button" className="text-[12px] font-semibold text-violet-800 underline dark:text-violet-200" onClick={() => setMode('create')} data-testid="button-create-from-chat">Create an interview from this chat</button>
        </>
      ) : (
        <div className="space-y-2" data-testid="create-from-chat">
          <p className="text-[11px] font-bold uppercase tracking-wide text-axal-faint">Create an interview from this chat</p>
          <label htmlFor="create-interviewee" className="block text-[12px] text-axal-faint">Who you are interviewing</label>
          <input id="create-interviewee" type="text" maxLength={120} className={`${FIELD} max-w-sm`} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-create-interviewee" />
          <p className="text-[12px] text-gray-700 dark:text-gray-300" data-testid="create-venture">Venture: <strong>{venture.project.name}</strong> <span className={NOTE}>(the one chosen in the sidebar)</span></p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={!name.trim() || busy} onClick={() => run({ create: { interviewee_name: name.trim(), project_id: venture.project.id } }, name.trim())} data-testid="button-create-and-assign">{busy ? 'Creating…' : 'Create the interview and assign'}</button>
            <button type="button" className={SMALL} onClick={() => setMode('pick')}>Back</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}

/**
 * D754 (#1980) §4, §5: a chat that waits for consent. Its state, "Ask for
 * consent" (Axal's notice in the chat, only while its 24-hour window is open
 * and the Worker allows another), and the member's word once the notice was
 * delivered. The Worker's refusals are shown in its words.
 *
 * Telegram (D756 §1.5, #1981): asked while pending too; without the bot's
 * reply right or outside the window, the reason and "Copy the notice" (the
 * Worker's text); never the member's word.
 */
export function ThreadConsent({ thread, consent: raw, api = channelsApi, onChanged }) {
  const [state, setState] = useState({ busy: false, error: '', note: '' });
  const consent = chatConsentOf({ consent: raw });
  const tg = thread.provider === 'telegram';
  if (!consent.required) return null;
  const name = (thread.interviewee_name || thread.contact_name || '').trim();
  const line = consentLine(consent, name, { provider: thread.provider });
  const linked = thread.status === 'assigned';
  const act = async (fn, note) => {
    if (state.busy) return;
    setState({ busy: true, error: '', note: '' });
    try { const r = await fn(); setState({ busy: false, error: '', note: r?.ok === null ? (r.message || '') : note }); onChanged?.(); }
    catch (e) { setState({ busy: false, error: e?.message || 'That could not be done. Try again.', note: '' }); }
  };
  const open = consent.status === 'not_asked' || consent.status === 'requested';
  const blocked = tg ? noticeBlocked(thread, consent) : null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(consent.notice_text); setState({ busy: false, error: '', note: 'Copied. Paste it into the Telegram chat.' }); }
    catch { setState({ busy: false, error: 'The notice could not be copied. Select it and copy it by hand.', note: '' }); }
  };
  return (
    <div className="space-y-1.5 rounded-md border border-axal-hairline p-3 dark:border-gray-800" data-testid="thread-consent" data-status={consent.status}>
      <p className="m-0 text-[12.5px] font-semibold text-gray-900 dark:text-gray-100" data-testid="thread-consent-line">{line.text}</p>
      {open && !linked && !tg && <p className={NOTE}>Add this chat to an interview first. Axal asks for consent once it is linked.</p>}
      {open && (linked || tg) && !blocked && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={PRIMARY} disabled={state.busy || !consent.can_request || !consent.window_open}
            onClick={() => act(() => api.requestConsent(thread.uid), 'Axal asked in the chat.')} data-testid="button-ask-consent">{tg ? 'Ask for consent in Telegram' : 'Ask for consent'}</button>
        </div>
      )}
      {open && !tg && !consent.window_open && <p className="m-0 text-[12px] text-amber-800 dark:text-amber-300" data-testid="thread-consent-window">{windowClosedSentence(name, thread.provider)}</p>}
      {open && blocked && (
        <div className="space-y-1" data-testid="thread-consent-copy">
          <p className="m-0 text-[12px] text-amber-800 dark:text-amber-300" data-testid="thread-consent-copy-reason">{`${blocked}, so Axal cannot send the notice. Paste it into the chat yourself.`}</p>
          {consent.notice_text && <button type="button" className={SMALL} onClick={copy} data-testid="button-copy-notice">Copy the notice</button>}
        </div>
      )}
      {linked && canAttest(consent, thread.provider) && (
        <div className="space-y-1" data-testid="thread-consent-attest">
          <p className={NOTE}>{`${name || 'They'} already agreed? Say how:`}</p>
          <div className="flex flex-wrap gap-1.5">
            {CHAT_CONSENT_METHODS.map(([method, label]) => (
              <button key={method} type="button" className={SMALL} disabled={state.busy}
                onClick={() => act(() => api.attestConsent(thread.uid, method), 'Consent recorded.')} data-testid={`button-attest-${method}`}>{label}</button>
            ))}
          </div>
        </div>
      )}
      {state.note && <p role="status" className="m-0 text-[12px] text-emerald-700 dark:text-emerald-300">{state.note}</p>}
      {state.error && <p role="alert" className="m-0 text-[12px] font-semibold text-red-700 dark:text-red-400">{state.error}</p>}
    </div>
  );
}

/** One conversation: its messages, what can be done with it, and the reply box. */
export function ThreadPanel({ uid, api = channelsApi, venture, onChanged, makeKey }) {
  const [data, setData] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [assigned, setAssigned] = useState(null);
  const load = useCallback(() => {
    api.thread(uid).then((r) => setData(r?.thread ? { thread: r.thread, messages: Array.isArray(r.messages) ? r.messages : [], consent: r.consent ?? null } : null), () => setData(null));
  }, [api, uid]);
  useEffect(() => { setData(undefined); setAssigned(null); setError(''); load(); }, [load]);
  if (data === undefined) return <div className={`${TONE} p-4 ${NOTE}`}>Reading the conversation…</div>;
  if (data === null) return <div className={`${TONE} p-4`}><Unreadable what="This conversation" claim="It may have been deleted after 30 days, or disconnected." onRetry={load} /></div>;
  const { thread, messages } = data;
  const contact = contactLabel(thread);
  const ignore = async (ignored) => {
    setBusy(true); setError('');
    try { await api.ignore(thread.uid, ignored); load(); onChanged?.(); }
    catch (e) { setError(e?.message || 'That could not be saved. Try again.'); }
    finally { setBusy(false); }
  };
  const href = sessionHref(assigned?.session_id ?? thread.session_id);
  return (
    <section className={`${TONE} space-y-3 p-4`} data-testid="thread-panel" data-status={thread.status}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="truncate text-[15px] font-bold text-gray-900 dark:text-gray-100">{contact}</h2>
          <ProviderTag provider={thread.provider} />
        </div>
        {thread.status === 'ignored'
          ? <button type="button" className={SMALL} disabled={busy} onClick={() => ignore(false)} data-testid="button-unignore">Stop ignoring</button>
          : <button type="button" className={SMALL} disabled={busy} onClick={() => ignore(true)} data-testid="button-ignore">Ignore</button>}
      </header>
      {thread.status === 'ignored' && <p className={NOTE}>Ignored: its waiting messages were deleted and new ones are dropped. Stop ignoring to receive them again.</p>}
      {thread.status === 'assigned' && !assigned && (
        <p className="text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="thread-assigned">
          In the interview with {thread.interviewee_name || 'an interview'}. Its messages are that interview’s transcript, and new ones go there too.{' '}
          {href && <Link to={href} className="font-semibold text-violet-800 underline dark:text-violet-200">Open the session</Link>}
        </p>
      )}
      {assigned && (
        <p role="status" className="text-[12.5px] text-emerald-700 dark:text-emerald-300" data-testid="thread-assigned-now">
          {assignedSentence(assigned, assigned.label)}{' '}
          {href && <Link to={href} state={{ interview: { id: assigned.interview_id, interviewee_name: assigned.label } }} className="font-semibold underline">Open the session</Link>}
        </p>
      )}
      {thread.status !== 'ignored' && <ThreadConsent thread={thread} consent={data.consent} api={api} onChanged={load} />}
      {thread.status === 'pending' && !messages.length && <p className={NOTE}>No message is waiting in this conversation.</p>}
      <MessageList messages={messages} contact={thread.contact_name} threadUid={thread.uid} api={api} onRetried={load} />
      {thread.status !== 'ignored' && venture && (
        <AssignControls key={thread.uid} thread={thread} venture={venture} api={api}
          onAssigned={(r, label) => { setAssigned({ ...r, label }); load(); onChanged?.(); }} />
      )}
      {error && <p role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-400">{error}</p>}
      <ReplyComposer key={`reply-${thread.uid}`} thread={thread} api={api} onSent={load} makeKey={makeKey} />
    </section>
  );
}

export default function ChannelsInboxPage({ api = channelsApi, source = appApi, now }) {
  const [tab, setTab] = useState('pending');
  const [list, setList] = useState({ status: 'loading', items: [] });
  const [selected, setSelected] = useState(null);
  const { overview } = useChannelsOverview(api);
  const venture = useVentureInterviews(source);
  const load = useCallback(() => {
    api.threads(tab).then((r) => setList({ status: 'ready', items: threadItems(r) }), () => setList({ status: 'unreadable', items: [] }));
  }, [api, tab]);
  useEffect(() => { setList({ status: 'loading', items: [] }); load(); }, [load]);
  const connected = !!overview && MESSAGING_PROVIDERS.some((p) => overview.connections?.[p]);
  const tabLabel = THREAD_TABS.find((t) => t.status === tab)?.label || '';

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-testid="channels-inbox">
      <nav className="text-[12px]"><Link to="/validate/customer-research" className="text-axal-muted underline dark:text-gray-400">Customer research</Link></nav>
      <header>
        <h1 className="text-[22px] font-extrabold tracking-axal-heading text-gray-900 dark:text-gray-100">Conversations</h1>
        <p className="mt-1 max-w-3xl text-[13px] text-axal-muted dark:text-gray-400">Customer chats from your business Telegram and WhatsApp wait here until you put each one in an interview. Nothing reaches an interview until you assign it. Waiting chats are deleted after 30 days.</p>
      </header>
      {overview && !connected && (
        <p className={`${TONE} p-3 text-[13px] text-gray-700 dark:text-gray-300`} data-testid="inbox-not-connected">
          Neither Telegram nor WhatsApp is connected yet. <Link to={CHANNELS_HREF} className="font-semibold text-violet-800 underline dark:text-violet-200">Connect one in Account › Connectors</Link>.
        </p>
      )}
      <div className="flex rounded-[10px] border border-axal-hairline bg-white p-[3px] dark:border-gray-700 dark:bg-gray-900" role="tablist" aria-label="Conversations">
        {THREAD_TABS.map((t) => (
          <button key={t.status} type="button" role="tab" aria-selected={tab === t.status} onClick={() => { setTab(t.status); setSelected(null); }} data-testid={`tab-inbox-${t.status}`}
            className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold ${tab === t.status ? 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-2">
          {list.status === 'loading' && <p className={NOTE}>Reading your conversations…</p>}
          {list.status === 'unreadable' && <div className={`${TONE} p-3`}><Unreadable what="Your conversations" claim="This is not a claim that you have none." onRetry={load} /></div>}
          {list.status === 'ready' && !list.items.length && <p className={NOTE} data-testid="inbox-empty">Nothing in {tabLabel} right now.</p>}
          <ThreadList items={list.items} selected={selected} onSelect={setSelected} now={now} />
        </div>
        <div className="min-w-0">
          {selected
            ? <ThreadPanel uid={selected} api={api} venture={venture} onChanged={load} />
            : list.items.length > 0 && <p className={NOTE}>Choose a conversation to read it.</p>}
        </div>
      </div>
    </div>
  );
}
