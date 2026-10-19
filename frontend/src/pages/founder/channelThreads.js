/**
 * D684 (#1575, S02 #1578) — the rules behind the conversations inbox
 * (`/validate/inbox`), an interview's Connect and Schedule a call panels, and
 * a channel session's waiting panel. No React and no fetch, so
 * `frontend/test/interview_channels_d684.test.mjs` holds each rule.
 *
 * The thread shapes are the Worker's (`services/channels/threads.ts`):
 *   ThreadView  { uid, provider, contact_name, status, message_count,
 *                 last_message_at, last_inbound_at, interview_id,
 *                 interviewee_name, session_id, can_reply, reply_window_open }
 *   message     { uid, side: 'contact' | 'me', kind: 'text' | 'voice', text, sent_at,
 *                 transcription_failure: { reason, sentence, retry } | null }
 * and a meeting ref (`interview_channel_refs`):
 *   { uid, provider, join_url, starts_at, ends_at, status, last_error, session_id }
 *
 * THINGS THIS FILE MUST NEVER SAY: that a Telegram message was delivered
 * (Telegram reports acceptance only); that a reply was sent before a provider
 * took it; that a call works over Telegram or WhatsApp (neither reaches Axal);
 * and that a call will have a transcript, or was cancelled at Zoom or Google,
 * when the provider will not make one or did not confirm it.
 */
import { PROVIDER_LABEL } from '../account/channelsModel.js';
import { agoLabel } from '../account/connectorsModel.js';

export { PROVIDER_LABEL };

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** The inbox's three lists, in the member's words. */
export const THREAD_TABS = [
  { status: 'pending', label: 'Waiting' },
  { status: 'assigned', label: 'In interviews' },
  { status: 'ignored', label: 'Ignored' },
];

/** A thread list's items, from `{ threads }` (routes/channels.ts), `{ items }` or a bare list; anything else is none. */
export function threadItems(r) {
  const list = Array.isArray(r) ? r : Array.isArray(r?.threads) ? r.threads : Array.isArray(r?.items) ? r.items : [];
  return list.filter((t) => t && typeof t.uid === 'string' && t.uid);
}

export function contactLabel(t) {
  return str(t?.contact_name) || 'Name not shared';
}

/** One row of the inbox. */
export function threadRow(t, now = Date.now()) {
  const n = Number(t?.message_count) || 0;
  return {
    uid: t.uid,
    name: contactLabel(t),
    provider: PROVIDER_LABEL[t.provider] || 'Unknown',
    count: n === 1 ? '1 message' : `${n} messages`,
    when: agoLabel(t.last_message_at, now) || 'No message yet',
    status: t.status,
    interviewee: t.status === 'assigned' ? (str(t.interviewee_name) || 'an interview') : '',
  };
}

/** One message in the thread view: who wrote it, and a voice note said as one. */
export function messageView(m, contact) {
  const failure = m?.kind === 'voice' ? voiceFailure(m) : null;
  return {
    uid: m?.uid,
    mine: m?.side === 'me',
    who: m?.side === 'me' ? 'You' : (str(contact) || 'Contact'),
    label: m?.kind !== 'voice' ? '' : failure ? 'Voice note' : m?.awaiting_transcription === true ? 'Voice note, transcribed when you add this chat to an interview' : 'Voice note (transcribed)',
    text: typeof m?.text === 'string' && m.text ? m.text : null,
    failure,
  };
}

/** Where a spent AI allowance is read, until #1916 gives the top-up its own path. */
export const USAGE_HREF = '/account/usage';

/**
 * #1933: why a waiting voice note was not transcribed, and what the member can
 * do about it, from the thread read's `transcription_failure` (#1586,
 * services/channels/voiceFailures.ts). The sentence is the Worker's, drawn as
 * it was sent: a reason this file has never heard of still says itself, and
 * the code is never shown. `action` follows `retry`:
 *   'available'     { kind: 'retry' }: the retry route queues it now
 *   'after_assign'  { kind: 'note' }:  assigning the chat queues it
 *   'after_budget'  { kind: 'link' }:  once the allowance allows a run
 *   'unknown'       { kind: 'note' }:  the budget could not be read
 *   null, or anything else: no action.
 * Null when the message carries no failure.
 */
export function voiceFailure(m) {
  const f = m?.transcription_failure;
  if (!f || typeof f !== 'object') return null;
  return { sentence: str(f.sentence) || 'This voice note could not be transcribed.', action: VOICE_ACTIONS[f.retry] || null };
}

const VOICE_ACTIONS = {
  available: { kind: 'retry' },
  after_assign: { kind: 'note', text: 'Add this chat to an interview to try again.' },
  after_budget: { kind: 'link', text: 'Try again when your AI allowance resets, or after adding tokens.', href: USAGE_HREF, link: 'See usage' },
  unknown: { kind: 'note', text: 'Try again later.' },
};

/**
 * Whether the reply composer may send, and when it may not, why, in plain
 * words. The Worker refuses the same cases whatever this says.
 */
export function composerState(thread) {
  if (!thread) return { enabled: false, reason: '' };
  const p = thread.provider;
  if (thread.status === 'ignored') return { enabled: false, reason: 'You are ignoring this conversation. Stop ignoring it to reply.' };
  if (!thread.can_reply) {
    return {
      enabled: false,
      reason: p === 'telegram'
        ? 'The Axal bot is not allowed to reply in your chats. In Telegram, open Settings › Telegram Business › Chatbots and let it reply to messages.'
        : 'Replies from Axal are not available on this number right now. Reply from the WhatsApp Business app.',
    };
  }
  if (!thread.reply_window_open) {
    return {
      enabled: false,
      reason: p === 'whatsapp'
        ? 'WhatsApp only allows a free reply within 24 hours of the customer’s last message. Reply from the WhatsApp Business app instead; template messages are a later step.'
        : 'Telegram only lets the bot reply within 24 hours of your contact’s last message. Reply from Telegram instead.',
    };
  }
  return { enabled: true, reason: '' };
}

/**
 * What a sent reply says. Telegram reports acceptance only, so it is "Sent"
 * whatever the answer carries; only WhatsApp's own status reports may say more.
 */
export function sentLabel(provider, status) {
  if (provider === 'whatsapp') {
    if (status === 'read') return 'Read';
    if (status === 'delivered') return 'Delivered';
  }
  return 'Sent';
}

/** The outbound statuses that mean a provider took the message (`channel_outbound`). */
const TAKEN = new Set(['submitted', 'delivered', 'read']);

/**
 * The composer's idempotency key: one per composed message, kept across a
 * retry so the Worker never sends it twice, and dropped once it is sent.
 */
export function clientKeyFor(current, make = newClientKey) {
  return current || make();
}

/**
 * Whether a failed send keeps its key for the next press. The Worker spends a
 * key on its first attempt (`channel_outbound.client_key`): a repeat returns
 * that attempt's outcome and never sends again. So the key is dropped only
 * after an explicit refusal, a 4xx with the Worker's code, where nothing went;
 * the next press is then a new attempt and takes a new key. Every other
 * failure keeps it: no answer (offline, a timeout), and any 5xx, which can
 * come after the provider already took the message (a database error while
 * recording the outcome answers 500). The repeat then reads what the first
 * attempt did instead of sending a second copy.
 */
export function keepKeyAfter(error) {
  const status = Number(error?.status);
  const refused = status >= 400 && status < 500 && typeof error?.code === 'string' && error.code !== '';
  return !refused;
}

/**
 * What a failed send says. A 5xx without the Worker's code (its catch-all, when
 * something broke after the provider may already have taken the message) says
 * that nobody knows, and that the next press is safe (`keepKeyAfter` kept the
 * key); otherwise the Worker's sentence.
 */
export function replyFailureText(error) {
  if (Number(error?.status) >= 500 && !error?.code) return 'Axal could not confirm whether it went. Press Send again to check: it will not send twice.';
  return error?.message || 'No answer came back, so it may not have gone. Press Send again: it will not send twice.';
}

/**
 * A reply's answer read:
 *   { ok: true, label }           a provider took it ('submitted', 'delivered', 'read')
 *   { ok: false, text }           the attempt this key made failed; nothing went
 *   { ok: null, keepKey, text }   nobody knows yet whether it went
 * The last is a repeat of a key whose first attempt is still 'pending': still
 * waiting on the provider (`send_in_flight`, the key is kept so the next press
 * only asks again), or cut off before the provider answered (`send_unknown`,
 * and an answer with no status Axal can read). The member is told to look in
 * the chat; the key is retained so another press checks the same attempt. It is
 * never called sent: Axal claims "Sent" only on a provider's word.
 */
export function replyOutcome(provider, r) {
  const status = r?.outbound?.status ?? r?.status;
  if (r && (r.ok === false || status === 'failed')) return { ok: false, text: 'That message was not sent. Press Send to try again.' };
  if (r?.ok === true && TAKEN.has(status)) return { ok: true, label: sentLabel(provider, status) };
  const name = PROVIDER_LABEL[provider] || 'the provider';
  if (r?.code === 'send_in_flight') {
    return { ok: null, keepKey: true, text: `Sending… ${name} has not confirmed it yet. Press Send again in a moment to check: it will not send twice.` };
  }
  return { ok: null, keepKey: true, text: `Not confirmed yet: check the chat in ${name}. Press Send to check this attempt again; it will not send twice.` };
}

export function newClientKey() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** The sentence after an assignment. */
export function assignedSentence(result, intervieweeName) {
  const n = Number(result?.moved) || 0;
  const who = str(intervieweeName) || 'the interview';
  const into = who === 'the interview' ? 'the interview' : `the interview with ${who}`;
  if (!n) return `Assigned to ${into}. New messages in this chat go there from now on.`;
  return `Moved ${n} message${n === 1 ? '' : 's'} into ${into}. New messages in this chat go there too.`;
}

/** The session page a channel session opens on, with the interview it hangs off. */
export function sessionHref(sessionId) {
  return Number.isSafeInteger(Number(sessionId)) && Number(sessionId) > 0 ? `/validate/session/${Number(sessionId)}` : null;
}

/** An interview list read (`/progress/discovery/:projectId`), as rows a picker can name. */
export function interviewOptions(r) {
  const list = Array.isArray(r) ? r : Array.isArray(r?.interviews) ? r.interviews : [];
  return list
    .filter((i) => Number.isSafeInteger(Number(i?.id)))
    .map((i) => ({
      id: Number(i.id),
      label: [str(i.interviewee_name) || 'Name not recorded', str(i.interviewee_company), str(i.interview_date)].filter(Boolean).join(' · '),
      name: str(i.interviewee_name),
    }));
}

// ---------- Meetings -------------------------------------------------------

export const MEETING_PROVIDERS = [
  { key: 'zoom', label: 'Zoom' },
  { key: 'google_meet', label: 'Google Meet' },
];

export const DURATIONS = [15, 30, 45, 60, 90];

/** A meeting list read: `{ meetings }`, `{ items }` or a bare list. */
export function meetingItems(r) {
  const list = Array.isArray(r) ? r : Array.isArray(r?.meetings) ? r.meetings : Array.isArray(r?.items) ? r.items : [];
  return list.filter((m) => m && typeof m.uid === 'string' && m.uid);
}

/**
 * The meeting read's `providers` (routes/founder_validate_meetings.ts):
 * `{ zoom: { available, connected, transcriptAccess }, google_meet: … }`. A
 * field it does not send is null, never a "no".
 */
export function meetingProviders(r) {
  const out = {};
  for (const { key } of MEETING_PROVIDERS) out[key] = { available: null, connected: null, transcriptAccess: null };
  for (const p of Array.isArray(r?.providers) ? r.providers : []) {
    if (!out[p?.provider]) continue;
    out[p.provider] = {
      available: typeof p.available === 'boolean' ? p.available : null,
      connected: typeof p.connected === 'boolean' ? p.connected : null,
      transcriptAccess: typeof p.transcript_access === 'string' ? p.transcript_access : null,
    };
  }
  return out;
}

/** What the schedule form says about a provider before the member presses anything; '' when nothing. */
export function providerNote(key, p) {
  const name = PROVIDER_LABEL[key];
  if (p?.available === false) return `${name} calls are not set up on Axal yet.`;
  if (p?.connected === false) return key === 'zoom' ? 'Connect Zoom in Account › Connectors first.' : 'Connect Google in Account › Connectors first.';
  // Meet's transcript permission is said by MeetTranscripts, from the Calendar status read (D757 §2.12, #1926).
  return '';
}

const NO_TRANSCRIPT_WHY = {
  zoom: 'Zoom makes a transcript only on a paid plan with cloud recording and audio transcripts turned on, and only when the call was recorded to the cloud.',
  google_meet: 'Google Meet makes a transcript only on a Workspace edition with transcription turned on in the call, and keeps it for 30 days.',
};

const ERROR_WORDS = [
  [/scope|reconnect|insufficient|permission/i, 'Reconnect your account in Account › Connectors so Axal may read transcripts, then try again.'],
  [/not_connected|no_connection|disconnected/i, 'Your account is not connected. Connect it in Account › Connectors, then try again.'],
  [/no_transcript|no_record/i, ''],
  [/expired|retention|gone/i, 'The transcript is no longer kept by the provider.'],
  [/rate|429|busy|timeout|unreachable|5\d\d/i, 'The provider did not answer. Try again in a few minutes.'],
];

/**
 * Why a call stopped short, in plain words. The Worker stores a sentence
 * written for the member (`services/channels/meetings.ts`, MEETING_ERRORS) as
 * `last_error`, and its read sends it as `error` with the `error_code` beside
 * it: a sentence is kept as it is; a bare code is mapped, never shown alone.
 */
export function meetingError(ref) {
  const e = str(ref?.last_error ?? ref?.error);
  if (/\s/.test(e)) return e.slice(0, 400);
  const code = e || str(ref?.error_code);
  if (!code) return '';
  for (const [re, words] of ERROR_WORDS) if (re.test(code)) return words;
  return '';
}

function when(iso, fmt) {
  const t = Date.parse(str(iso));
  return Number.isFinite(t) ? fmt(new Date(t)) : null;
}

function defaultWhen(d) {
  try { return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d); } catch { return d.toISOString().slice(0, 16).replace('T', ' '); }
}

/** When a call is and how long it runs: "Tue 14 Oct, 10:00 · 30 min"; "Time not recorded" without a start. */
export function callWhen(ref, fmt = defaultWhen) {
  const at = when(ref?.starts_at, fmt);
  if (!at) return 'Time not recorded';
  const mins = Math.round((Date.parse(str(ref?.ends_at)) - Date.parse(str(ref?.starts_at))) / 60000);
  return Number.isFinite(mins) && mins > 0 ? `${at} · ${mins} min` : at;
}

/**
 * A scheduled call in plain words, with what the member can do about it:
 *   { tone, text, can: { cancel, import, retry, open } }
 * Every status the ref can hold has its own sentence; anything else is said
 * to be unknown rather than guessed.
 */
export function meetingStatus(ref, now = Date.now(), fmt = defaultWhen) {
  const name = PROVIDER_LABEL[ref?.provider] || 'The call';
  const start = Date.parse(str(ref?.starts_at));
  const end = Date.parse(str(ref?.ends_at));
  const can = { cancel: false, import: false, retry: false, open: false };
  const why = meetingError(ref);
  const fallback = ' You can still record a session with the in-app recorder, or paste the conversation.';
  switch (ref?.status) {
    case 'scheduled':
      if (Number.isFinite(end) && now >= end) {
        return { tone: 'info', text: `Waiting for the transcript. ${name} makes it after the call ends, which can take a while.`, can: { ...can, import: true } };
      }
      if (Number.isFinite(start) && now >= start) return { tone: why ? 'warn' : 'info', text: `In progress, or about to start.${why ? ` ${why}` : ''}`, can };
      // A scheduled call may already carry what to fix before it (Meet's transcript permission).
      return {
        tone: why ? 'warn' : 'neutral',
        text: `Scheduled${when(ref.starts_at, fmt) ? ` for ${when(ref.starts_at, fmt)}` : ''}.${why ? ` ${why}` : ''}`,
        can: { ...can, cancel: true },
      };
    case 'ended':
      return { tone: 'info', text: `The call ended. Waiting for the transcript from ${name}.`, can: { ...can, import: true } };
    case 'transcript_ready':
      return { tone: 'info', text: 'The transcript is ready to import.', can: { ...can, import: true } };
    case 'imported':
      return { tone: 'ok', text: 'Transcript imported. Open the session to review it.', can: { ...can, open: true } };
    case 'no_transcript': {
      const reason = why || NO_TRANSCRIPT_WHY[ref.provider] || '';
      // The Worker's own sentence may already say what to do instead.
      const tail = /recorder|paste/i.test(reason) ? '' : fallback;
      return { tone: 'warn', text: `No transcript was made. ${reason}${tail}`.replace(/\s+/g, ' ').trim(), can: { ...can, retry: true } };
    }
    case 'failed':
      return {
        tone: 'danger',
        text: why ? `The transcript was not imported. ${why}` : 'The transcript could not be imported. Try again.',
        can: { ...can, retry: true },
      };
    case 'cancelled':
      return { tone: 'neutral', text: 'Cancelled.', can };
    default:
      return { tone: 'neutral', text: 'Status not recorded.', can };
  }
}

/**
 * The question before a cancel. It promises only what the Worker does: it asks
 * the provider to cancel the call, which may not succeed (`cancelOutcome`).
 */
export function cancelQuestion(provider) {
  return provider === 'google_meet'
    ? 'Cancel this call? Axal also asks Google to delete it from your calendar.'
    : `Cancel this call? Axal also asks ${PROVIDER_LABEL[provider] || 'the provider'} to cancel it.`;
}

/**
 * What a cancel did, from the Worker's `provider_cancelled`
 * (routes/founder_validate_meetings.ts): `true` only when the provider
 * confirmed. Anything else (`false`: not connected, refused, unreachable;
 * `null`: no provider call was made) means the call may still be live there,
 * so the member is told to delete it themselves.
 */
export function cancelOutcome(provider, r) {
  if (r?.provider_cancelled === true) {
    return provider === 'google_meet'
      ? { tone: 'neutral', text: 'Cancelled, and deleted from your Google Calendar.' }
      : { tone: 'neutral', text: 'Cancelled in Zoom too: its link no longer works.' };
  }
  return provider === 'google_meet'
    ? { tone: 'warn', text: 'Removed from Axal, but Google did not confirm the event was deleted. It may still be in your Google Calendar with a working Meet link: delete it there.' }
    : { tone: 'warn', text: 'Removed from Axal, but Zoom did not confirm the call was cancelled. It may still exist in your Zoom account with a working link: delete it there.' };
}

/** A join link Axal can safely draw: https on the provider's own domain. */
export function safeJoinUrl(url, provider) {
  try {
    const u = new URL(str(url));
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (provider === 'zoom' && (host === 'zoom.us' || host.endsWith('.zoom.us'))) return u.toString();
    if (provider === 'google_meet' && host === 'meet.google.com') return u.toString();
    return null;
  } catch {
    return null;
  }
}

/**
 * The schedule form's starting values: the next full hour, half an hour, on
 * Zoom, not recorded. Recording a customer is the member's choice, made in the
 * form (`record`), never a default.
 */
export function defaultMeetingForm(now = Date.now()) {
  const d = new Date(now + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    provider: 'zoom',
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    duration: 30,
    topic: '',
    consent: '',
    record: false,
  };
}

/**
 * What the schedule form may say about the transcript, for the provider and
 * the recording choice in it. Zoom makes a transcript only from a cloud
 * recording, and Axal asks for one only when the member turns it on
 * (`auto_record`); Meet only when someone turns on transcription in the call.
 * Neither is promised when it will not be made.
 */
export function transcriptNote(provider, record) {
  if (provider === 'zoom') {
    return record
      ? 'Zoom records the call to the cloud, and when it ends Zoom’s transcript comes into that session for you to review. Zoom makes transcripts only on a paid plan with Audio transcript turned on.'
      : 'Zoom makes a transcript only from a cloud recording. Without it, no transcript comes into the session unless someone starts Record to the Cloud during the call.';
  }
  if (provider === 'google_meet') {
    return 'Google Meet makes a transcript only on a Workspace edition that includes it, and only when someone turns on transcription in the call.';
  }
  return '';
}

/** How the interviewee agreed to be recorded and transcribed: the Worker's CONSENT_METHODS. */
export const MEETING_CONSENT = [
  ['verbal', 'Said yes, out loud'],
  ['written', 'In writing'],
  ['in_app', 'In the app'],
  ['pre_agreed', 'Agreed beforehand'],
];

/**
 * The schedule form as the Worker's body, or the reason it cannot be sent.
 * The date and time are the member's local time; the body carries UTC.
 */
export function meetingBody(form, now = Date.now()) {
  if (!MEETING_PROVIDERS.some((p) => p.key === form?.provider)) return { error: 'Choose Zoom or Google Meet.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(form?.date)) || !/^\d{2}:\d{2}$/.test(str(form?.time))) return { error: 'Choose a date and a time.' };
  const start = new Date(`${form.date}T${form.time}:00`);
  if (!Number.isFinite(start.getTime())) return { error: 'Choose a date and a time.' };
  if (start.getTime() <= now) return { error: 'Choose a time in the future.' };
  const duration = Number(form.duration);
  if (!Number.isInteger(duration) || duration < 5 || duration > 240) return { error: 'Choose how long the call lasts.' };
  // No consent, no AI over the transcript (#1470): the Worker refuses the call without it.
  if (!MEETING_CONSENT.some(([m]) => m === form?.consent)) return { error: 'Record how the interviewee agreed to be recorded and transcribed.' };
  const topic = str(form.topic).slice(0, 200);
  // Zoom's cloud recording, only when the member turned it on: the Worker
  // creates the call with `auto_recording: 'none'` otherwise. Meet has no such setting.
  const record = form.provider === 'zoom' && form.record === true;
  return { body: {
    provider: form.provider, starts_at: start.toISOString(), duration_min: duration, ...(topic ? { topic } : {}),
    consent: { status: 'given', method: form.consent }, ...(record ? { auto_record: true } : {}),
  } };
}

/**
 * A refusal to schedule, with whether connecting in Connectors is the way out
 * (`connect_first`, `*_not_connected`, `*_reconnect`, `*_scope_missing`).
 */
export function scheduleRefusal(e, provider) {
  const name = PROVIDER_LABEL[provider] || 'that provider';
  const code = String(e?.code || '');
  return {
    text: e?.message || `The ${name} call could not be scheduled. Try again.`,
    connect: /connect_first|not_connected|reconnect|scope_missing/i.test(code),
  };
}
