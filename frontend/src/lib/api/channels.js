// D684 (#1575, S02 #1578) — interview channels: a member's business Telegram
// and WhatsApp (routes/channels.ts, S19) and the Zoom and Google Meet calls an
// interview schedules (routes/founder_validate_meetings.ts, S18).
//
//   overview         GET    /channels                      availability, the member's connections, pending counts
//   linkTelegram     POST   /channels/telegram/link        → { code, url, expires_at }
//   telegramClaim    GET    /channels/telegram/link        → { claim }: the member's latest code and who claimed it (#1625)
//   confirmTelegram  POST   /channels/telegram/link/:uid/confirm  Axal's half of the two-sided confirm → { linked, claim }
//   connectWhatsApp  POST   /channels/whatsapp/connect     { code, waba_id, phone_number_id } from Embedded Signup
//   disconnect       DELETE /channels/:provider
//   test             POST   /channels/:provider/test
//   threads          GET    /channels/threads?status=      → { items: ThreadView[] }
//   thread           GET    /channels/threads/:uid         → { thread, messages }
//   assign           POST   /channels/threads/:uid/assign  { interview_id } | { create: { interviewee_name, interviewee_company?, project_id } }, quote_consent?
//   ignore           POST   /channels/threads/:uid/ignore  { ignored }
//   reply            POST   /channels/threads/:uid/reply   { text, client_key }
//   meetings         GET    /founder/validate/interviews/:id/meetings
//   scheduleMeeting  POST   /founder/validate/interviews/:id/meetings  { provider, starts_at, duration_min, topic?, consent, auto_record? }
//   cancelMeeting    DELETE /founder/validate/interviews/:id/meetings/:refUid
//   importMeeting    POST   /founder/validate/interviews/:id/meetings/:refUid/import
//   attachMeeting    POST   /founder/validate/interviews/:id/meetings  { attach: { join_url }, session_id, provider } (D685 §5.3.2, #1588)
//
// Every path is written out in full (no shared prefix constant) so the drift
// check (scripts/check-api-drift.mjs) reads each one against the Worker.
import { request } from '../api.js';

const enc = encodeURIComponent;
const PROVIDERS = new Set(['telegram', 'whatsapp', 'zoom', 'google_meet']);
const THREAD_STATUSES = new Set(['pending', 'assigned', 'ignored']);
const MEETING_PROVIDERS = new Set(['zoom', 'google_meet']);

function provider(p) {
  if (!PROVIDERS.has(p)) throw new Error(`Unknown channel provider: ${p}`);
  return p;
}

/** The thread list's query: one of the three statuses, or none for all of them. */
function threadsQuery(status) {
  if (status == null || status === '') return '';
  if (!THREAD_STATUSES.has(status)) throw new Error(`Unknown thread status: ${status}`);
  return `?status=${status}`;
}

/**
 * The assignment body: an interview the member already has, or one made from
 * this chat (with Who's company, D685 §5.3). Quote consent (§5.1.4) is sent
 * only as the literal true.
 */
function assignBody(target) {
  const body = target && target.create
    ? { create: {
      interviewee_name: String(target.create.interviewee_name ?? '').trim(),
      ...(typeof target.create.interviewee_company === 'string' && target.create.interviewee_company.trim()
        ? { interviewee_company: target.create.interviewee_company.trim() } : {}),
      project_id: Number(target.create.project_id),
    } }
    : { interview_id: Number(target?.interview_id) };
  if (target?.quote_consent === true) body.quote_consent = true;
  return body;
}

export const channelsApi = {
  overview: () => request('/channels'),
  linkTelegram: () => request('/channels/telegram/link', { method: 'POST', body: JSON.stringify({}) }),
  telegramClaim: () => request('/channels/telegram/link'),
  confirmTelegram: (uid) => request(`/channels/telegram/link/${enc(uid)}/confirm`, { method: 'POST', body: JSON.stringify({}) }),
  connectWhatsApp: ({ code, waba_id, phone_number_id }) => request('/channels/whatsapp/connect', {
    method: 'POST', body: JSON.stringify({ code, waba_id, phone_number_id: phone_number_id ?? null }),
  }),
  disconnect: (p) => request(`/channels/${enc(provider(p))}`, { method: 'DELETE' }),
  test: (p) => request(`/channels/${enc(provider(p))}/test`, { method: 'POST', body: JSON.stringify({}) }),
  threads: (status) => request(`/channels/threads${threadsQuery(status)}`),
  thread: (uid) => request(`/channels/threads/${enc(uid)}`),
  assign: (uid, target) => request(`/channels/threads/${enc(uid)}/assign`, {
    method: 'POST', body: JSON.stringify(assignBody(target)),
  }),
  ignore: (uid, ignored = true) => request(`/channels/threads/${enc(uid)}/ignore`, {
    method: 'POST', body: JSON.stringify({ ignored: !!ignored }),
  }),
  reply: (uid, text, clientKey) => request(`/channels/threads/${enc(uid)}/reply`, {
    method: 'POST', body: JSON.stringify({ text, client_key: clientKey }),
  }),
  meetings: (interviewId) => request(`/founder/validate/interviews/${enc(interviewId)}/meetings`),
  scheduleMeeting: (interviewId, { provider: p, starts_at, duration_min, topic, consent, auto_record }) => {
    if (!MEETING_PROVIDERS.has(p)) throw new Error(`Unknown meeting provider: ${p}`);
    return request(`/founder/validate/interviews/${enc(interviewId)}/meetings`, {
      method: 'POST',
      body: JSON.stringify({
        provider: p, starts_at, duration_min: Number(duration_min), ...(topic ? { topic } : {}), consent,
        ...(auto_record === true ? { auto_record: true } : {}),
      }),
    });
  },
  cancelMeeting: (interviewId, refUid) => request(`/founder/validate/interviews/${enc(interviewId)}/meetings/${enc(refUid)}`, { method: 'DELETE' }),
  importMeeting: (interviewId, refUid) => request(`/founder/validate/interviews/${enc(interviewId)}/meetings/${enc(refUid)}/import`, {
    method: 'POST', body: JSON.stringify({}),
  }),
  /** Attach the Zoom or Meet call a video session records, so its own transcript can be imported after it (D685 §5.8.7). */
  attachMeeting: (interviewId, { session_id, join_url, provider: p }) => {
    if (!MEETING_PROVIDERS.has(p)) throw new Error(`Unknown meeting provider: ${p}`);
    return request(`/founder/validate/interviews/${enc(interviewId)}/meetings`, {
      method: 'POST', body: JSON.stringify({ attach: { join_url }, session_id: Number(session_id), provider: p }),
    });
  },
};
