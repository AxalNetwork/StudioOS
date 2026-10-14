/**
 * D685 (#1587) — the model behind the "Record a session" lightbox
 * (`RecordLightbox.jsx`), to `design/canvases/integrated/Cycle Overview.dc.html`
 * (`lbOpen`). Pure, so every rule is tested without a screen.
 *
 * COPY IS THE CANVAS'S, WORD FOR WORD (D685 §5.5): the four mode notes, the
 * consent note, the Start labels and the estimate suffix. PRICES ARE THE
 * WORKER'S: the estimate is priced from `GET /sessions/models`, never from the
 * canvas's sample figures, and a model with no price makes the estimate "Not
 * priced", never $0.
 *
 * WHAT THE WORKER STORES. `SETUP_FIELDS` says, field by field, whether the
 * Worker accepts it. Since D685 §5.1 (#1591) the one setup call, `POST
 * /sessions`, stores all of them: the talking points, the language, the call
 * provider and the meeting link. A control for a field turned off here is
 * drawn, disabled, with that reason: it never takes a choice and drops it.
 */

import { MEETING_PROVIDERS, safeJoinUrl } from './channelThreads.js';

export const SETUP_FIELDS = Object.freeze({
  points: true, // §5.2: interview_session_points (migration 452, #1591)
  language: true, // §5.1.3: GET /sessions/models lists the languages; POST /sessions stores one
  call_provider: true, // §5.1.2
  meeting_url: true, // §5.1.2
  channels: true, // GET /api/channels (D684, #1581): the Text chips read their real status (#1586)
});

export const NOT_STORED = 'Not saved yet: the Worker does not store this field.';

export const MODES = [
  { key: 'in_person', label: 'In person', audio: true, start: 'Start recording', note: 'Put the phone on the table between you. It records this device’s microphone.' },
  { key: 'video', label: 'Video call', audio: true, start: 'Start the call', note: 'Paste the meeting link. It records the call’s audio.' },
  { key: 'phone', label: 'Audio call', audio: true, start: 'Start recording', note: 'Put the call on speaker. It records this device’s microphone.' },
  { key: 'text', label: 'Text chat', audio: false, start: 'Import the chat', note: 'No audio. Import the conversation from the app it happened in, or paste it.' },
];
export const modeOf = (key) => MODES.find((m) => m.key === key) || MODES[0];

/** On a phone a video call records the microphone only: there is no tab to share (§5.8.6). */
export const PHONE_VIDEO_NOTE = 'On a phone it records this device’s microphone only.';
/** The mode's note, with the phone sentence on Video where this browser cannot share a tab. */
export const modeNote = (mode, canShareTab = true) => (mode === 'video' && !canShareTab ? `${modeOf(mode).note} ${PHONE_VIDEO_NOTE}` : modeOf(mode).note);

/**
 * The chips under How, per mode (§5.3). `link` names the connection a chip's
 * status reads; `ready` chips need none. `value` is the `call_provider` the
 * Worker will take (§5.1.2).
 */
export const PROVIDERS = {
  in_person: [],
  video: [
    { value: 'zoom', label: 'Zoom', link: 'zoom' },
    { value: 'google_meet', label: 'Google Meet', link: 'google_meet' },
    { value: 'teams', label: 'Microsoft Teams', ready: true },
    { value: 'whatsapp', label: 'WhatsApp video', ready: true },
    { value: 'telegram', label: 'Telegram video', ready: true },
  ],
  phone: [
    { value: 'phone_speaker', label: 'This phone, on speaker', ready: true },
    { value: 'whatsapp', label: 'WhatsApp call', ready: true },
    { value: 'telegram', label: 'Telegram call', ready: true },
    { value: 'signal', label: 'Signal call', ready: true },
  ],
  text: [
    { value: 'whatsapp', label: 'WhatsApp', link: 'whatsapp' },
    { value: 'telegram', label: 'Telegram', link: 'telegram' },
    { value: 'paste', label: 'Paste a transcript', ready: true },
    { value: 'signal', label: 'Signal', gone: true },
    { value: 'sms', label: 'SMS', gone: true },
    { value: 'linkedin', label: 'LinkedIn', gone: true },
    { value: 'slack', label: 'Slack', gone: true },
  ],
};

/**
 * The mode's default chip: the first one that can be chosen, so Text chat opens
 * on "Paste a transcript" while importing from WhatsApp is not available.
 * Switching mode resets to it.
 */
export function defaultProvider(mode, channels = null) {
  const chips = PROVIDERS[mode] || [];
  return (chips.find((c) => !chipStatus(mode, c, channels).disabled) || chips[0])?.value ?? null;
}

/** "Video call · Zoom": the call's name on the recording view. Null for in person. */
export function callLabel(mode, provider) {
  const chip = (PROVIDERS[mode] || []).find((p) => p.value === provider);
  if (!chip || mode === 'in_person' || mode === 'text') return null;
  return `${modeOf(mode).label} · ${chip.label}`;
}

/** One connection from `GET /api/channels`, whether it lists them as an array or by key. */
export function connectionOf(channels, key) {
  const c = channels?.connections;
  if (!c) return null;
  if (Array.isArray(c)) return c.find((x) => x?.provider === key) || null;
  return Object.hasOwn(c, key) ? c[key] : null;
}
/**
 * Whether a connection from `GET /api/channels` is one a chat can be imported
 * from. The Worker answers `{ status: 'active', … }` per provider
 * (routes/channels.ts); a Telegram account counts once Telegram Business is
 * linked too (`business_connected`), because only then do its chats arrive.
 * `connected: true` is accepted as well, for a read that says it that way.
 */
export function isConnected(conn, key) {
  if (!conn) return false;
  if (conn.connected === true) return true;
  if (conn.status !== 'active') return false;
  return key === 'telegram' ? conn.business_connected !== false : true;
}
const availableOf = (channels, key) => {
  const p = Array.isArray(channels?.providers) ? channels.providers.find((x) => x?.provider === key) : null;
  return p ? p.available !== false : null;
};

/**
 * One chip's status word and whether it can be chosen (§5.3).
 *   Connected          an active connection
 *   Connect            available here, not connected; opens Connectors and can still be chosen to record
 *   Ready              nothing to connect
 *   Not available yet  disabled
 * `channels` is the read from `GET /api/channels`, or null when it cannot be
 * read here (`SETUP_FIELDS.channels` false, or the read failed). Then a chip
 * that depends on a connection says "Not available yet" rather than guessing.
 */
export function chipStatus(mode, chip, channels) {
  if (chip.gone) return { word: 'Not available yet', disabled: true };
  if (chip.ready) return { word: 'Ready', disabled: false };
  const known = availableOf(channels, chip.link);
  const conn = connectionOf(channels, chip.link);
  if (!channels || known === null) return { word: 'Not available yet', disabled: mode === 'text' };
  if (known === false) return { word: 'Not available yet', disabled: mode === 'text' };
  if (isConnected(conn, chip.link)) return { word: 'Connected', disabled: false };
  return { word: 'Connect', disabled: false, connectHref: '/account/connectors' };
}

/**
 * The four consent picks, none preselected (§5.5.7), with the Worker's methods
 * (migration 438). The words are the canvas's.
 */
export const CONSENTS = [
  ['verbal', 'Said yes out loud'],
  ['written', 'In writing'],
  ['in_app', 'In the app'],
  ['pre_agreed', 'Agreed beforehand'],
];

export function consentNote(mode, method) {
  if (!modeOf(mode).audio) return 'Optional for a text chat: needed only to quote it.';
  return method ? 'Consent recorded. Audio starts when you press Start.' : 'Audio starts only once consent is recorded.';
}

/**
 * "Meeting link": https, and the host must match the provider (§5.1.2). Returns
 * a sentence, or null when fine. Zoom and Google Meet are D684's own rule
 * (`safeJoinUrl`, the one that draws a scheduled call's join link), so the two
 * cannot disagree; Teams, which D684 does not schedule, is checked here.
 */
export function meetingLinkProblem(provider, raw) {
  const text = String(raw || '').trim();
  if (!text) return null; // optional: the link names the call, nothing more
  let url;
  try { url = new URL(text); } catch { return 'That is not a link.'; }
  if (url.protocol !== 'https:') return 'The link must start with https://.';
  const host = url.hostname.toLowerCase();
  const scheduled = MEETING_PROVIDERS.find((p) => p.key === provider);
  if (scheduled && !safeJoinUrl(text, provider)) return provider === 'zoom' ? 'A Zoom link is on zoom.us.' : `A ${scheduled.label} link is on meet.google.com.`;
  if (provider === 'teams' && !(host === 'teams.microsoft.com' || host === 'teams.live.com')) return 'A Teams link is on teams.microsoft.com or teams.live.com.';
  if (provider === 'whatsapp' || provider === 'telegram') return 'A WhatsApp or Telegram call has no meeting link.';
  return null;
}
/** The link field is drawn for video, on a provider that has links. */
export const hasMeetingLink = (mode, provider) => mode === 'video' && ['zoom', 'google_meet', 'teams'].includes(provider);

/** Flux, the live model the Worker transcribes in English only (D685 §5.1.3). */
export const FLUX = '@cf/deepgram/flux';

/**
 * The Language choices: Detect, then the Worker's own list from `GET
 * /sessions/models` (`languages`). With Flux live, English only, as the Worker
 * refuses any other. An unreadable list leaves Detect alone.
 */
export function languageOptions(models, live) {
  const list = (Array.isArray(models?.languages) ? models.languages : [])
    .filter((l) => l && typeof l.code === 'string' && l.code && typeof l.name === 'string');
  return [{ code: '', name: 'Detect' }, ...(live === FLUX ? list.filter((l) => l.code === 'en') : list)];
}

/** Dollars, to the cent, as the estimate prints them. `toFixed` prints $0.01 for 30 × $0.0005. */
export const cents = (usd) => Math.round(usd * 100) / 100;
export const money = (usd) => `$${cents(usd).toFixed(2)}`;
export const DURATIONS = [15, 30, 45, 60, 90];

/**
 * The estimate line (§5.5.6): minutes × (live price + final price), from the
 * Worker's own table. A missing price makes it "Not priced", never $0.
 */
export function estimate(models, live, final, minutes = 30) {
  const price = (list, id) => list?.find?.((m) => m.model === id)?.price_usd_per_minute;
  const f = price(models?.final, final);
  const l = live == null ? 0 : price(models?.live, live);
  if (!models || !Number.isFinite(f) || !Number.isFinite(l)) return { text: `${minutes} min · Not priced`, usd: null };
  const usd = minutes * (l + f);
  return { usd, text: `${minutes} min ≈ ${money(usd)} · ${live == null ? 'the transcript appears when you stop' : 'live captions while you talk'}` };
}

/** Hypothesis chips (§5.2): open claims only, the current sprint's first. */
export function talkingPoints(hypotheses) {
  const open = (Array.isArray(hypotheses) ? hypotheses : [])
    .filter((h) => h && h.retired_at == null && h.lane !== 'validated' && h.lane !== 'invalidated');
  const bySort = (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0);
  const sprint = open.filter((h) => h.lane === 'testing' && h.sprint != null).sort(bySort);
  const rest = open.filter((h) => !sprint.includes(h)).sort(bySort);
  return [...sprint, ...rest].map((h, i) => ({ id: h.id, text: [h.code, h.claim].filter(Boolean).join(' · ') || 'Not recorded', on: i < 2 }));
}

/**
 * May Start be pressed, and if not, why (§5.5.8)? Audio needs consent, and a
 * name when no interview was picked. The reason is the sentence the footer shows.
 */
export function startState({ mode, consent, name, interview, conversation, hasThread }) {
  const m = modeOf(mode);
  if (!interview && !String(name || '').trim()) return { ok: false, reason: 'Add who you are talking to.' };
  if (m.audio && !CONSENTS.some(([k]) => k === consent)) return { ok: false, reason: 'Audio starts only once consent is recorded.' };
  if (!m.audio && !hasThread && parseConversation(conversation).length === 0) return { ok: false, reason: 'Paste the conversation, or choose a chat to import.' };
  return { ok: true, reason: null };
}

/** "Name: words" lines → messages. A line with no name is the founder's. */
export function parseConversation(raw) {
  return String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const m = /^([^:]{1,80}):\s*(.+)$/.exec(line);
    return m ? { author: m[1].trim(), text: m[2].trim() } : { author: 'Me', text: line };
  });
}

/**
 * The session's part of the setup call (`POST /sessions`, D685 §5.1). Only
 * what the Worker stores is sent (`SETUP_FIELDS`); a choice it would drop is
 * not in the body.
 *
 * A text chat's consent pick is consent to QUOTE it (§5.1.4): it is sent as
 * the method alone, and the Worker sets the interview's `quote_consent`.
 */
export function sessionBody(s, fields = SETUP_FIELDS) {
  const m = modeOf(s.mode);
  const body = { channel: s.mode };
  if (m.audio) {
    body.consent = { status: 'given', method: s.consent };
    body.live_model = s.live ?? null;
    body.final_model = s.final ?? null;
    if (fields.language && s.language) body.language = s.language;
  } else {
    body.messages = parseConversation(s.conversation);
    if (fields.call_provider) body.call_provider = 'paste';
    if (CONSENTS.some(([k]) => k === s.consent)) body.consent = { method: s.consent };
  }
  if (fields.call_provider && m.audio && s.provider) body.call_provider = s.provider;
  if (fields.meeting_url && hasMeetingLink(s.mode, s.provider) && String(s.link || '').trim()) body.meeting_url = s.link.trim();
  if (fields.points && Array.isArray(s.points) && s.points.length) body.points = s.points;
  return body;
}

/**
 * The whole setup call (`POST /sessions`, D685 §5.1): the project, who (a
 * picked interview, or the name and company from Who), the session, and the
 * Start's `client_key`, so a repeated Start answers the same pair.
 */
export function setupBody(s, { projectId, interview = null, clientKey }, fields = SETUP_FIELDS) {
  const who = interview?.id != null
    ? { interview_id: Number(interview.id) }
    : { interviewee: { name: String(s.name || '').trim(), company: String(s.company || '').trim() || null } };
  return { project_id: Number(projectId), ...who, ...sessionBody(s, fields), client_key: clientKey };
}

/** A Start key: one per lightbox, kept across a refused Start (nothing was stored under it). */
export function newStartKey(rand = () => Math.random().toString(36).slice(2, 10)) {
  const c = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null;
  return `record-${c || `${Date.now().toString(36)}-${rand()}`}`;
}

/**
 * A refusal, in the Worker's words, and where it points. On 409
 * `session_active` the founder is already recording: the lightbox offers that
 * session's live view instead of a second recording.
 */
export function startRefusal(e) {
  const text = (typeof e?.message === 'string' && e.message.trim()) || 'The session could not be created.';
  const sid = e?.data?.session_id;
  if (e?.code === 'session_active' && Number.isSafeInteger(Number(sid)) && Number(sid) > 0) {
    return { text, liveHref: `/validate/record/live?session=${encodeURIComponent(Number(sid))}` };
  }
  return { text, liveHref: null };
}

/**
 * `/validate/record` while this tab's recorder holds a recording or paused
 * session: its live view, so the setup never opens over a recording.
 */
export function recordingHref(state) {
  const sid = state?.session?.id;
  if (sid == null || !['recording', 'paused'].includes(state?.phase)) return null;
  return `/validate/record/live?session=${encodeURIComponent(sid)}`;
}

/** The recruiting pipeline's rows (`customer-research`, `stage:pipeline`, booked first) as Who's picks. */
export function pipelineRows(read) {
  const rows = Array.isArray(read?.records?.rows) ? read.records.rows : [];
  return rows
    .filter((r) => Number.isSafeInteger(Number(r?.id)) && ['lead', 'invited', 'booked'].includes(r?.stage))
    .map((r) => ({
      id: Number(r.id),
      interviewee_name: typeof r.interviewee === 'string' ? r.interviewee : null,
      interviewee_company: typeof r.company === 'string' && r.company ? r.company : null,
      stage: r.stage,
    }));
}
export const STAGE_WORD = { lead: 'Lead', invited: 'Invited', booked: 'Booked' };

/**
 * The chats waiting in the inbox that one Text chip can import: `GET
 * /api/channels/threads?status=pending`, that app's only.
 */
export function threadsFor(read, provider) {
  const items = Array.isArray(read?.items) ? read.items : Array.isArray(read) ? read : [];
  return items.filter((t) => t && typeof t.uid === 'string' && t.uid && t.provider === provider);
}

/**
 * The assignment for an imported chat (`POST /channels/threads/:uid/assign`):
 * the interview Who names, or one made from Who. A consent pick is quote
 * consent (§5.1.4), sent only as the literal true.
 */
export function assignTarget({ name, company, consent }, { projectId, interview = null }) {
  const target = interview?.id != null
    ? { interview_id: Number(interview.id) }
    : { create: { interviewee_name: String(name || '').trim(), interviewee_company: String(company || '').trim() || null, project_id: Number(projectId) } };
  if (CONSENTS.some(([k]) => k === consent)) target.quote_consent = true;
  return target;
}
