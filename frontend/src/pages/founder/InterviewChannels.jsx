import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { channelsApi } from '../../lib/api/channels.js';
import { BrandIcon, Unreadable } from '../../ui';
import { TelegramChannelCard, WhatsAppChannelCard, useChannelsOverview } from '../account/ChannelsGroup';
import { CHANNELS_HREF, INBOX_HREF, MESSAGING_PROVIDERS, channelCard } from '../account/channelsModel';
import { channelOf } from './assistantSession.js';
import {
  DURATIONS, MEETING_CONSENT, MEETING_PROVIDERS, PROVIDER_LABEL, assignedSentence, callWhen, cancelOutcome, cancelQuestion, defaultMeetingForm,
  meetingBody, meetingItems, meetingProviders, meetingStatus, providerNote, safeJoinUrl, scheduleRefusal, sessionHref, threadItems, threadRow,
  transcriptNote,
} from './channelThreads.js';

/**
 * D684 (#1575, S02 #1578) — an interview's channels, inside Record a session
 * (`RecordSessionSheet.jsx`) and on a channel session's page:
 *
 *   ConnectPanel         "From Telegram or WhatsApp": the member's waiting
 *                        conversations, each assigned to THIS interview with
 *                        one click; Telegram and WhatsApp linked or connected
 *                        in place when they are not yet (the Connectors cards).
 *   SchedulePanel        "Schedule a call": a Zoom or Google Meet call for this
 *                        interview, with its join link and its status in plain
 *                        words until the transcript is imported.
 *   ChannelSessionPanel  A channel session that has nothing yet: waiting for
 *                        messages, or for the call's transcript.
 *
 * Nothing here creates an interview, and nothing reaches one until the member
 * presses Assign. The rules are `channelThreads.js`.
 */

const TONE = 'rounded-axal-sm border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const SMALL = 'rounded-md border border-gray-200 px-2.5 py-1 text-[12px] font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800';
const PRIMARY = 'rounded-md bg-violet-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const NOTE = 'text-[12px] leading-snug text-axal-faint';
const FIELD = 'w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[13px] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const TAG = {
  telegram: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  whatsapp: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  zoom: 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200',
  google_meet: 'bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};
const STATUS_TONE = {
  ok: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-800 dark:text-amber-300',
  danger: 'text-red-700 dark:text-red-300',
  info: 'text-violet-800 dark:text-violet-200',
  neutral: 'text-gray-700 dark:text-gray-300',
};

/** The provider a conversation or call came through, as a small tag. */
export function ProviderTag({ provider }) {
  // D687: the bare mark before the name; `other` draws nothing (fallback none), never the assistant Bot.
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-bold ${TAG[provider] || TAG.other}`} data-testid="provider-tag" data-provider={provider}><BrandIcon provider={provider} size={14} variant="bare" fallback="none" />{PROVIDER_LABEL[provider] || 'Unknown'}</span>;
}

function Alert({ children }) {
  if (!children) return null;
  return <p role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-400">{children}</p>;
}

/** The waiting conversations, each one click from this interview. */
export function ConnectPanel({ interview, api = channelsApi, onAssigned, now }) {
  const { overview, status, reload } = useChannelsOverview(api);
  const [threads, setThreads] = useState({ status: 'loading', items: [] });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const load = useCallback(() => {
    api.threads('pending').then((r) => setThreads({ status: 'ready', items: threadItems(r) }), () => setThreads({ status: 'unreadable', items: [] }));
  }, [api]);
  useEffect(() => { load(); }, [load]);
  const name = (interview?.interviewee_name || '').trim();
  const connected = !!overview && MESSAGING_PROVIDERS.some((p) => overview.connections?.[p]);

  const assign = async (uid) => {
    setBusy(uid); setError(''); setDone(null);
    try {
      const r = await api.assign(uid, { interview_id: interview.id });
      setDone(r);
      load();
      onAssigned?.(r);
    } catch (e) {
      setError(e?.message || 'That conversation could not be assigned. Try again.');
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-3" data-testid="interview-connect">
      <p className="text-[12.5px] text-gray-700 dark:text-gray-300">
        Choose a customer conversation waiting in your inbox. Its messages become a Text session on this interview{name ? ` with ${name}` : ''}, and new messages in that chat follow.
      </p>
      {threads.status === 'loading' && <p className={NOTE}>Reading your conversations…</p>}
      {threads.status === 'unreadable' && <Unreadable what="Your waiting conversations" claim="This is not a claim that none is waiting." onRetry={load} />}
      {threads.status === 'ready' && threads.items.length > 0 && (
        <ul className={`${TONE} divide-y divide-axal-hairline dark:divide-gray-800`} data-testid="connect-threads">
          {threads.items.map((t) => {
            const row = threadRow(t, now);
            return (
              <li key={t.uid} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-900 dark:text-gray-100"><span className="truncate">{row.name}</span><ProviderTag provider={t.provider} /></div>
                  <div className={NOTE}>{row.count} · {row.when}</div>
                </div>
                <button type="button" className={PRIMARY} disabled={!!busy} onClick={() => assign(t.uid)} data-testid={`button-assign-here-${t.uid}`}>{busy === t.uid ? 'Assigning…' : 'Assign here'}</button>
              </li>
            );
          })}
        </ul>
      )}
      {threads.status === 'ready' && !threads.items.length && connected && (
        <p className={NOTE} data-testid="connect-none-waiting">No conversation is waiting. When a customer writes to your connected Telegram or WhatsApp, the chat appears here.</p>
      )}
      <Alert>{error}</Alert>
      {done && (
        <p role="status" className="text-[12px] text-emerald-700 dark:text-emerald-300" data-testid="connect-assigned">
          {assignedSentence(done, name)}{' '}
          {sessionHref(done.session_id) && <Link to={sessionHref(done.session_id)} state={{ interview }} className="font-semibold underline">Open the session</Link>}
        </p>
      )}
      {overview && !connected && (
        <div className="space-y-2" data-testid="connect-in-place">
          <p className="text-[12.5px] text-gray-700 dark:text-gray-300">Connect your business Telegram or WhatsApp first. You can also do this any time in Account › Connectors.</p>
          <div className="grid grid-cols-1 gap-2.5">
            <TelegramChannelCard card={channelCard('telegram', overview)} claim={overview.telegramLink ?? null} pending={overview.pending?.telegram ?? null} api={api} onChanged={() => { reload(); load(); }} />
            <WhatsAppChannelCard card={channelCard('whatsapp', overview)} overview={overview} api={api} onChanged={() => { reload(); load(); }} />
          </div>
        </div>
      )}
      {!overview && status === 'unreadable' && <Unreadable what="Your Telegram and WhatsApp connections" claim="This is not a claim that you have none." onRetry={reload} />}
      <Link to={INBOX_HREF} className="inline-block text-[12px] font-semibold text-violet-800 underline dark:text-violet-200" data-testid="link-inbox">Open all conversations</Link>
    </div>
  );
}

/**
 * One scheduled call: when, its status in plain words, its join link, and what
 * can be done. After a cancel, the row says what the provider confirmed
 * (`cancelOutcome`) in place of the bare "Cancelled.", for as long as it is on
 * screen: a call Zoom or Google did not confirm may still be live there.
 */
export function MeetingRow({ meeting, interview, api = channelsApi, onChanged, now = Date.now(), initialConfirming = false }) {
  const [confirming, setConfirming] = useState(initialConfirming);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [cancelled, setCancelled] = useState(null);
  const st = cancelled ? { ...meetingStatus({ ...meeting, status: 'cancelled' }, now), ...cancelled } : meetingStatus(meeting, now);
  const join = safeJoinUrl(meeting.join_url, meeting.provider);
  const href = sessionHref(meeting.session_id);
  const interviewId = interview?.id ?? meeting.interview_id;
  const act = async (kind) => {
    setBusy(kind); setError('');
    try {
      if (kind === 'cancel') {
        setCancelled(cancelOutcome(meeting.provider, await api.cancelMeeting(interviewId, meeting.uid)));
        setConfirming(false);
      } else await api.importMeeting(interviewId, meeting.uid);
      onChanged?.();
    } catch (e) {
      setError(e?.message || (kind === 'cancel' ? 'The call could not be cancelled. Try again.' : 'The transcript could not be imported. Try again.'));
    } finally { setBusy(null); }
  };
  return (
    <li className="space-y-1.5 px-3 py-2.5" data-testid={`meeting-${meeting.uid}`} data-status={meeting.status}>
      <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-gray-900 dark:text-gray-100">
        <ProviderTag provider={meeting.provider} />
        <span>{callWhen(meeting)}</span>
      </div>
      <p role={cancelled ? 'status' : undefined} className={`text-[12.5px] ${STATUS_TONE[st.tone] || STATUS_TONE.neutral}`} data-testid="meeting-status">{st.text}</p>
      {join && meeting.status !== 'cancelled' && !cancelled && (
        <div className="flex min-w-0 items-center gap-2">
          <a href={join} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-mono text-[12px] text-violet-800 underline dark:text-violet-200" data-testid="meeting-join">{join}</a>
          <button type="button" className={SMALL} onClick={async () => { try { await navigator.clipboard?.writeText(join); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {(st.can.import || st.can.retry) && (
          <button type="button" className={SMALL} disabled={!!busy} onClick={() => act('import')} data-testid={`button-meeting-import-${meeting.uid}`}>
            {busy === 'import' ? 'Checking…' : meeting.status === 'transcript_ready' ? 'Import the transcript' : st.can.retry ? 'Try again' : 'Check for the transcript'}
          </button>
        )}
        {st.can.open && href && <Link to={href} state={interview ? { interview } : undefined} className="text-[12px] font-semibold text-violet-800 underline dark:text-violet-200">Open the session</Link>}
        {st.can.cancel && !confirming && <button type="button" className={SMALL} onClick={() => setConfirming(true)} data-testid={`button-meeting-cancel-${meeting.uid}`}>Cancel the call</button>}
        {st.can.cancel && confirming && (
          <span className="inline-flex flex-wrap items-center gap-2" data-testid={`meeting-cancel-confirm-${meeting.uid}`}>
            <span className={NOTE}>{cancelQuestion(meeting.provider)}</span>
            <button type="button" className="rounded-md bg-red-700 px-2.5 py-1 text-[12px] font-bold text-white disabled:opacity-50" disabled={busy === 'cancel'} onClick={() => act('cancel')}>Cancel it</button>
            <button type="button" className={SMALL} onClick={() => setConfirming(false)}>Keep</button>
          </span>
        )}
      </div>
      <Alert>{error}</Alert>
    </li>
  );
}

/**
 * Schedule a Zoom or Google Meet call for this interview, and follow each
 * call to its transcript. One read (`GET …/meetings`) gives the calls and,
 * per provider, whether it is on here and whether the member is connected.
 * A transcript is promised only when the provider will make one: a Zoom call
 * is recorded to the cloud only when the member turns that on
 * (`auto_record`), and Meet only transcribes when someone turns it on in the
 * call (`transcriptNote`).
 */
export function SchedulePanel({ interview, api = channelsApi, now, initialForm }) {
  const [refs, setRefs] = useState({ status: 'loading', items: [], providers: meetingProviders(null) });
  const [form, setForm] = useState(() => initialForm || defaultMeetingForm());
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [notice, setNotice] = useState('');
  const load = useCallback(() => {
    api.meetings(interview.id).then(
      (r) => setRefs({ status: 'ready', items: meetingItems(r), providers: meetingProviders(r) }),
      () => setRefs((s) => ({ ...s, status: 'unreadable', items: [] })),
    );
  }, [api, interview.id]);
  useEffect(() => { load(); }, [load]);
  const available = (p) => refs.providers[p]?.available !== false;
  const note = providerNote(form.provider, refs.providers[form.provider]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const schedule = async () => {
    const out = meetingBody(form, now ?? Date.now());
    if (out.error) { setRefusal({ text: out.error, connect: false }); return; }
    setBusy(true); setRefusal(null); setNotice('');
    try {
      const r = await api.scheduleMeeting(interview.id, out.body);
      // Scheduled, with what to fix before the call when there is something (Meet's transcript permission).
      setNotice(typeof r?.notice?.message === 'string' ? r.notice.message : '');
      load();
    } catch (e) { setRefusal(scheduleRefusal(e, form.provider)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3" data-testid="interview-schedule">
      <p className="text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="schedule-intro">Axal creates the call and a session for it. {transcriptNote(form.provider, form.record)} Calls over Telegram or WhatsApp cannot be recorded this way; use the in-app recorder for those.</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Call on">
        {MEETING_PROVIDERS.map((p) => (
          <button key={p.key} type="button" role="radio" aria-checked={form.provider === p.key} disabled={!available(p.key)} data-testid={`meeting-provider-${p.key}`}
            onClick={() => setForm((f) => ({ ...f, provider: p.key }))}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${form.provider === p.key ? 'border-violet-700 bg-violet-700 text-white dark:border-violet-400 dark:bg-violet-500' : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'}`}>
            <BrandIcon provider={p.key} size={16} variant="bare" tone={form.provider === p.key ? 'current' : 'brand'} fallback="none" />{p.label}{available(p.key) ? '' : ' · not set up on Axal yet'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[12px] text-axal-faint">Date<input type="date" className={FIELD} value={form.date} onChange={set('date')} data-testid="input-meeting-date" /></label>
        <label className="space-y-1 text-[12px] text-axal-faint">Time<input type="time" className={FIELD} value={form.time} onChange={set('time')} data-testid="input-meeting-time" /></label>
        <label className="space-y-1 text-[12px] text-axal-faint">How long
          <select className={FIELD} value={form.duration} onChange={(e) => setForm((f) => ({ ...f, duration: Number(e.target.value) }))} data-testid="input-meeting-duration">
            {DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}
          </select>
        </label>
        <label className="space-y-1 text-[12px] text-axal-faint">Title (optional)<input type="text" maxLength={200} className={FIELD} value={form.topic} placeholder={`Interview${interview?.interviewee_name ? ` with ${interview.interviewee_name}` : ''}`} onChange={set('topic')} /></label>
      </div>
      <p className={NOTE}>Your local time. Share the join link with the person you are interviewing.</p>
      <fieldset className="space-y-1.5" data-testid="meeting-consent">
        <legend className="text-[12px] font-semibold text-axal-ink">How did they agree to be recorded and transcribed?</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How the interviewee agreed to be recorded and transcribed">
          {MEETING_CONSENT.map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={form.consent === m} data-testid={`meeting-consent-${m}`}
              onClick={() => setForm((f) => ({ ...f, consent: m }))}
              className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${form.consent === m ? 'border-violet-700 bg-violet-700 text-white dark:border-violet-400 dark:bg-violet-500' : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>
        <p className={NOTE}>When the call has a transcript, it lands in this interview and the Worker AI proposes the pain points and other findings for you to review. Nothing is added to Validate until you accept it.</p>
      </fieldset>
      {form.provider === 'zoom' && (
        <div className="space-y-1" data-testid="meeting-record">
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-gray-800 dark:text-gray-200">
            <input type="checkbox" className="h-4 w-4 accent-violet-700" checked={form.record === true}
              onChange={(e) => setForm((f) => ({ ...f, record: !!e.target.checked }))} data-testid="input-meeting-record" />
            Record in the cloud (needed for the transcript)
          </label>
          <p className={NOTE}>Zoom starts recording to your Zoom cloud when the call starts, and Zoom’s own recording notice tells everyone on the call that it is being recorded. Cloud recording needs a paid Zoom plan.</p>
        </div>
      )}
      {note && (
        <p className="text-[12px] text-amber-800 dark:text-amber-300" data-testid="schedule-provider-note">
          {note}{refs.providers[form.provider]?.available !== false && <> <Link to={CHANNELS_HREF} className="underline">Open Connectors</Link></>}
        </p>
      )}
      <button type="button" className={PRIMARY} disabled={busy || !available(form.provider)} onClick={schedule} data-testid="button-schedule-meeting">{busy ? 'Scheduling…' : `Schedule the ${PROVIDER_LABEL[form.provider]} call`}</button>
      {notice && <p role="status" className="text-[12px] text-amber-800 dark:text-amber-300" data-testid="schedule-notice">Scheduled. {notice}</p>}
      {refusal && (
        <div role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-400" data-testid="schedule-refusal">
          {refusal.text}{refusal.connect && <> <Link to={CHANNELS_HREF} className="underline">Open Connectors</Link></>}
        </div>
      )}
      {refs.status === 'unreadable' && <Unreadable what="This interview’s calls" claim="This is not a claim that none is scheduled." onRetry={load} />}
      {refs.status === 'ready' && refs.items.length > 0 && (
        <ul className={`${TONE} divide-y divide-axal-hairline dark:divide-gray-800`} data-testid="meeting-list">
          {refs.items.map((m) => <MeetingRow key={m.uid} meeting={m} interview={interview} api={api} onChanged={load} now={now} />)}
        </ul>
      )}
    </div>
  );
}

/**
 * A channel session with nothing in it yet. A chat's session fills as
 * messages arrive; a call's waits for its transcript, shown with the call's
 * own status and actions.
 */
export function ChannelSessionPanel({ session, api = channelsApi, onChanged, now }) {
  const provider = channelOf(session);
  const meeting = provider === 'zoom' || provider === 'google_meet';
  const [ref, setRef] = useState({ status: meeting ? 'loading' : 'none', item: null });
  const load = useCallback(() => {
    if (!meeting) return;
    api.meetings(session.interview_id).then(
      (r) => setRef({ status: 'ready', item: meetingItems(r).find((m) => Number(m.session_id) === Number(session.id)) || null }),
      () => setRef({ status: 'unreadable', item: null }),
    );
  }, [api, meeting, session.id, session.interview_id]);
  useEffect(() => { load(); }, [load]);
  const name = PROVIDER_LABEL[provider] || 'the channel';
  return (
    <section className="rounded-2xl border border-axal-hairline p-5 dark:border-gray-800" data-testid="channel-session-waiting" data-provider={provider || ''}>
      {!meeting && (
        <>
          <h2 className="text-[16px] font-bold">Waiting for messages</h2>
          <p className="mt-2 text-[13px] text-gray-700 dark:text-gray-300">New messages in this {name} chat are added here as they arrive. Nothing is recorded on this page.</p>
          <Link to={INBOX_HREF} className="mt-3 inline-block text-[12px] font-semibold text-violet-800 underline dark:text-violet-200">Open your conversations</Link>
        </>
      )}
      {meeting && (
        <>
          <h2 className="text-[16px] font-bold">Waiting for the {name} transcript</h2>
          {ref.status === 'loading' && <p className={`mt-2 ${NOTE}`}>Reading the call…</p>}
          {ref.status === 'unreadable' && <div className="mt-2"><Unreadable what="The call" claim="This is not a claim that it was cancelled." onRetry={load} /></div>}
          {ref.status === 'ready' && !ref.item && <p className="mt-2 text-[13px] text-gray-700 dark:text-gray-300">The {name} call for this session could not be found. Record with the in-app recorder, or paste the conversation, from the interview log.</p>}
          {ref.item && (
            <ul className="mt-2">
              <MeetingRow meeting={ref.item} interview={{ id: session.interview_id }} api={api} onChanged={() => { load(); onChanged?.(); }} now={now} />
            </ul>
          )}
        </>
      )}
    </section>
  );
}
