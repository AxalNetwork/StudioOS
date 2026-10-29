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

import { storageRefusal } from '../account/storagePageModel.js';
import { tokenRefusal } from '../../lib/aiTokens.js';
import { MEETING_PROVIDERS, safeJoinUrl } from './channelThreads.js';
import { consentTarget } from './chatConsent.js';

export const SETUP_FIELDS = Object.freeze({
  points: true, // §5.2: interview_session_points (migration 452, #1591)
  language: true, // §5.1.3: GET /sessions/models lists the languages; POST /sessions stores one
  call_provider: true, // §5.1.2
  meeting_url: true, // §5.1.2
  channels: true, // GET /api/channels (D684, #1581): the Text chips read their real status (#1586)
});

export const NOT_STORED = 'Not saved yet: the Worker does not store this field.';

/**
 * The four channels a session is stored with. The owner merged Video call and
 * Audio call into one "Call" (2026-10-21): How offers `HOW_OPTIONS`, and a
 * call's channel is the one its provider chip names (`callChannel`), so a
 * meeting link, a tab share or the microphone on speaker still follow the call
 * that was picked, and the Worker stores `video` or `phone` as before.
 */
export const MODES = [
  { key: 'in_person', label: 'In person', audio: true, start: 'Start recording', note: 'Put the phone on the table between you. It records this device’s microphone.' },
  { key: 'video', label: 'Call', audio: true, start: 'Start the call', note: 'Paste the meeting link or create a meeting. Eadwyn AI joins as a visible participant and records after being admitted. When the call ends, Axal VC transcribes the recording. This device’s microphone is not used.' },
  { key: 'phone', label: 'Call', audio: true, start: 'Start recording', note: 'Put the call on speaker. It records this device’s microphone.' },
  { key: 'text', label: 'Text chat', audio: false, start: 'Import the chat', note: 'No audio. Import the conversation from the app it happened in, or paste it.' },
];
export const modeOf = (key) => MODES.find((m) => m.key === key) || MODES[0];

/** The How choices: In person, Call (a video or an audio call) and Text chat. */
export const HOW_OPTIONS = Object.freeze([
  { value: 'in_person', label: 'In person' },
  { value: 'call', label: 'Call' },
  { value: 'text', label: 'Text chat' },
]);
/** The How choice a channel is drawn under. */
export const howOf = (mode) => (mode === 'video' || mode === 'phone' ? 'call' : mode);

/**
 * The mode's note. D1358: a Zoom, Google Meet or Teams call is never recorded
 * from this browser, on a computer or a phone, so the note no longer changes
 * with whether a tab can be shared. "This phone, on speaker" is the call that
 * records this device's microphone.
 */
export const modeNote = (mode) => modeOf(mode).note;

/**
 * A call's chips, one list for both channels since the owner merged them
 * (2026-10-21). `channel` is what the call is stored and recorded as: a
 * meeting (Zoom, Google Meet, Teams) is `video`, with its link and, on a
 * computer, a shared tab; an app call or the phone on speaker is `phone`,
 * recorded from this device's microphone.
 */
export const CALL_CHIPS = Object.freeze([
  { value: 'zoom', label: 'Zoom', link: 'zoom', channel: 'video' },
  { value: 'google_meet', label: 'Google Meet', link: 'google_meet', channel: 'video' },
  { value: 'teams', label: 'Microsoft Teams', ready: true, channel: 'video' },
  { value: 'whatsapp', label: 'WhatsApp', ready: true, channel: 'phone' },
  { value: 'telegram', label: 'Telegram', ready: true, channel: 'phone' },
  { value: 'signal', label: 'Signal', ready: true, channel: 'phone' },
  { value: 'phone_speaker', label: 'This phone, on speaker', ready: true, channel: 'phone' },
]);
/** The channel a call's chip is stored as, or null for no such chip. */
export const callChannel = (provider) => CALL_CHIPS.find((c) => c.value === provider)?.channel ?? null;

/**
 * The chips under How, per mode (§5.3). `link` names the connection a chip's
 * status reads; `ready` chips need none. `value` is the `call_provider` the
 * Worker will take (§5.1.2).
 */
export const PROVIDERS = {
  in_person: [],
  video: CALL_CHIPS,
  phone: CALL_CHIPS,
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
  // D1346 (#3554): Eadwyn AI joins a Meet call as a guest, so the chip never asks for a
  // connection. Connecting Google is offered only for Start to create the meeting (D1362).
  if (mode === 'video' && chip.value === 'google_meet') return { word: isConnected(conn, chip.link) ? 'Connected' : 'Ready', disabled: false };
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
  if (provider === 'teams' && !(host === 'teams.microsoft.com' || host === 'teams.live.com' || host === 'teams.cloud.microsoft')) return 'Use a Microsoft Teams meeting link.';
  if (provider === 'whatsapp' || provider === 'telegram') return 'A WhatsApp or Telegram call has no meeting link.';
  return null;
}
/**
 * Whether Start also attaches the call (D685 §5.8.7, #1588): a video session on
 * Zoom or Google Meet, a valid link, and that provider connected. The Worker
 * still decides whether the connected account hosts it.
 */
export function attachesCall(mode, provider, link, channels) {
  if (mode !== 'video' || !['zoom', 'google_meet'].includes(provider)) return false;
  if (!String(link || '').trim() || meetingLinkProblem(provider, link)) return false;
  return isConnected(connectionOf(channels, provider), provider);
}

/** What the share step says about the attach: the Worker's notice, or its refusal in its words. */
export function attachOutcome(result, error) {
  if (error) return { tone: 'refused', text: (typeof error.message === 'string' && error.message.trim()) || 'The call could not be attached. The recording is not affected.' };
  const text = result?.notice?.message;
  return { tone: 'attached', text: typeof text === 'string' && text.trim() ? text.trim() : 'The call is attached. Its transcript is imported after the call, if the provider makes one.' };
}

/** The link field is drawn for video, on a provider that has links. */
export const hasMeetingLink = (mode, provider) => mode === 'video' && ['zoom', 'google_meet', 'teams'].includes(provider);

/**
 * D1346 (#3554): creating the meeting — since D1362, Start does it when no
 * link is pasted. Zoom and Google Meet make a meeting starting now on the
 * member's own account (`POST /founder/validate/meetings/instant`), Teams on
 * the Microsoft calendar connection (D1359). `connected`
 * is null when the connections could not be read: the Worker then decides, and
 * says "Connect … first" in its own words.
 */
export const TEAMS_PASTE = 'Create the meeting in Microsoft Teams and paste its link here. Axal cannot create a Teams meeting yet.';
/** D1359: Teams is created on the member's Microsoft calendar connection, which needs a work or school account. */
export const TEAMS_CREATE_NOTE = 'Uses your Microsoft calendar connection, and needs a work or school Microsoft 365 account. A personal account: create it in Teams and paste the link.';
export const CREATE_CONNECT = Object.freeze({ zoom: 'Connect Zoom to create the meeting here', google_meet: 'Connect Google Calendar to create a Meet meeting here', teams: 'Connect Microsoft to create the meeting here' });
export function createMeetingOffer(mode, provider, channels) {
  if (mode !== 'video') return null;
  // D1359: Teams' connection is not in the channels read, so the Worker decides
  // (`connected: null`) and refuses "Connect Microsoft … first" in its own words.
  if (provider === 'teams') return { kind: 'create', connected: null, connectHref: null, connectLabel: CREATE_CONNECT.teams, note: TEAMS_CREATE_NOTE };
  if (provider !== 'zoom' && provider !== 'google_meet') return null;
  const label = provider === 'zoom' ? 'Zoom' : 'Google Meet';
  if (availableOf(channels, provider) === false) return { kind: 'unavailable', sentence: `${label} meetings cannot be created on Axal yet. Create it in ${label} and paste the link.` };
  const connected = channels ? isConnected(connectionOf(channels, provider), provider) : null;
  return { kind: 'create', connected, connectHref: connected === false ? (provider === 'google_meet' ? '/account/connectors/google' : '/account/connectors') : null, connectLabel: CREATE_CONNECT[provider] };
}
/**
 * "Open the meeting"'s href: the link re-serialised from a parsed https URL on
 * the provider's own host (`safeJoinUrl`, plus Teams' three hosts), never the
 * typed text itself. Null for anything else, so nothing else is ever opened.
 */
export function meetingHref(provider, raw) {
  if (provider === 'zoom' || provider === 'google_meet') return safeJoinUrl(String(raw || '').trim(), provider);
  if (provider !== 'teams') return null;
  try {
    const u = new URL(String(raw || '').trim());
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'teams.microsoft.com' || host === 'teams.live.com' || host === 'teams.cloud.microsoft') ? u.toString() : null;
  } catch { return null; }
}
/** The link the Worker made, or null: a reply that is not a link on the provider's own host fills nothing. */
export function createdLink(provider, reply) {
  const url = typeof reply?.join_url === 'string' ? reply.join_url.trim() : '';
  return url && !meetingLinkProblem(provider, url) ? url : null;
}

/**
 * D1346 (#3554): whether Eadwyn AI can join, from `GET
 * /founder/validate/meetings/bot`, read when the dialog opens. `undefined` is
 * still reading and `null` unreadable; neither is "available".
 */
export const BOT_UNAVAILABLE = 'Eadwyn AI can’t join calls yet on Axal.';
export const BOT_UNREADABLE = 'Unreadable: Axal could not read whether Eadwyn AI can join. This is not a claim that it cannot.';
export function botState(read, platform) {
  if (read === undefined) return { state: 'loading', canSend: false, sentence: 'Checking whether Eadwyn AI can join…' };
  if (read === null || typeof read !== 'object' || typeof read.platforms !== 'object' || read.platforms === null) return { state: 'unreadable', canSend: false, sentence: BOT_UNREADABLE };
  if (platform && read.platforms[platform] === true) return { state: 'available', canSend: true, sentence: null };
  return { state: 'unavailable', canSend: false, sentence: BOT_UNAVAILABLE };
}
/**
 * D1358: how a meeting (Zoom, Google Meet or Teams) is captured, decided once.
 * A meeting is captured by the platform, never by this browser:
 *   · `bot`: Eadwyn AI joins it (the bot is deployed here for that platform);
 *   · `import`: a Zoom or Google Meet call on the member's connected account,
 *     saved now and imported from the provider's own transcript after it ends;
 *   · `none`: nothing can capture it yet, with the reason, and Start is off.
 * Any other mode is `device` (in person, or a call on this phone's speaker).
 * `botLink` is whether the link is one Eadwyn AI can join (`botPlatform`).
 */
export const TEAMS_NO_CAPTURE = 'Axal can’t capture a Microsoft Teams call yet: Eadwyn AI is not available for Teams here, and Axal has no Teams connection. After the call, upload its recording or paste its transcript.';
export const IMPORT_NOTE = Object.freeze({
  zoom: 'Axal does not record this call. When it ends, Axal imports the transcript Zoom makes in your connected account’s cloud recording. Turn on cloud recording with audio transcripts in Zoom, and host the call from that account.',
  google_meet: 'Axal does not record this call. When it ends, Axal imports the transcript Google Meet makes, for a call organised from your connected Google account with transcription turned on in the call.',
});
export const IMPORT_START = 'Save for import after the call';
export function callCapture({ mode, provider, link, channels, bot, botLink }) {
  if (mode !== 'video') return { kind: 'device' };
  const text = String(link || '').trim();
  if (text && meetingLinkProblem(provider, text)) return { kind: 'none', reason: null };
  if (bot?.canSend && botLink) return { kind: 'bot' };
  // D1360: Eadwyn AI is the default. While its read is still out, a link it
  // can join waits for it rather than falling back to the import.
  if (botLink && bot?.state === 'loading') return { kind: 'none', reason: bot.sentence };
  if (!text) return { kind: 'none', reason: 'Paste the meeting link, or create the meeting.' };
  if (provider === 'teams') return { kind: 'none', reason: bot?.state === 'loading' ? bot.sentence : TEAMS_NO_CAPTURE };
  if (provider !== 'zoom' && provider !== 'google_meet') return { kind: 'none', reason: 'Choose Zoom, Google Meet or Microsoft Teams.' };
  if (attachesCall(mode, provider, text, channels)) return { kind: 'import', note: IMPORT_NOTE[provider] };
  const label = provider === 'zoom' ? 'Zoom' : 'Google';
  if (bot?.state === 'loading') return { kind: 'none', reason: bot.sentence };
  return { kind: 'none', reason: channels
    ? `Connect ${label} in Account › Connectors so Axal can import this call’s transcript after it ends.`
    : 'Unreadable: Axal could not read your connections, so it cannot tell whether this call can be imported. Try again.' };
}

/**
 * D1362: one Start for a meeting. It creates the meeting when no link is
 * pasted, saves the call, sends Eadwyn AI where it can join, opens the
 * meeting, and the call's transcript is imported when it ends. The plan says
 * which of those this call will get, decided before the press:
 *   · `import`: a Zoom or Google Meet call on the member's connected account.
 *     The Worker also sends Eadwyn AI when it can join (D1360), so the bot's
 *     recording and the provider's transcript are both on the way;
 *   · `bot`: no import is possible (Teams, or no connection), Eadwyn AI joins;
 *   · `none`: neither, with the reason, and Start is off.
 * `create` is whether Start makes the meeting first (no link pasted).
 */
const CALL_LABEL = Object.freeze({ zoom: 'Zoom', google_meet: 'Google Meet', teams: 'Microsoft Teams' });
export function callStartPlan({ mode, provider, link, channels, bot, botLink, offer }) {
  if (mode !== 'video' || !CALL_LABEL[provider]) return null;
  const text = String(link || '').trim();
  const importable = ['zoom', 'google_meet'].includes(provider);
  if (text) {
    const problem = meetingLinkProblem(provider, text);
    if (problem) return { kind: 'none', create: false, reason: null };
    if (attachesCall(mode, provider, text, channels)) return { kind: 'import', create: false, bot: !!bot?.canSend };
    if (bot?.canSend && botLink) return { kind: 'bot', create: false, bot: true };
    const capture = callCapture({ mode, provider, link: text, channels, bot, botLink });
    return { kind: 'none', create: false, reason: capture.kind === 'none' ? capture.reason : null };
  }
  if (offer?.kind !== 'create') {
    return { kind: 'none', create: false, reason: offer?.kind === 'unavailable' ? offer.sentence : 'Paste the meeting link.' };
  }
  if (offer.connected === false) return { kind: 'none', create: false, reason: `${CREATE_CONNECT[provider]}, or paste the meeting link.` };
  if (importable && offer.connected === true) return { kind: 'import', create: true, bot: !!bot?.canSend };
  if (bot?.canSend) return { kind: 'bot', create: true, bot: true };
  if (bot?.state === 'loading') return { kind: 'none', create: false, reason: bot.sentence };
  if (provider === 'teams') return { kind: 'none', create: false, reason: TEAMS_NO_CAPTURE };
  return { kind: 'none', create: false, reason: 'Unreadable: Axal could not read your connections, so it cannot tell whether this call can be imported. Try again.' };
}
/** What Start will do, in one sentence, from the plan. */
export function callStartNote(plan, provider) {
  if (!plan || plan.kind === 'none') return null;
  const label = CALL_LABEL[provider] || 'the';
  const make = plan.create ? `Start creates the ${label} meeting on your account, opens it` : `Start opens the ${label} meeting`;
  if (plan.kind === 'bot') return `${make} and sends Eadwyn AI to join. Its recording and transcript land in this interview when the call ends.`;
  return plan.bot
    ? `${make} and sends Eadwyn AI to join. When the call ends, the transcript lands in this interview.`
    : `${make}. When the call ends, Axal imports ${label}’s own transcript into this interview. Eadwyn AI can’t join ${label} calls on Axal yet.`;
}

const perMinute = (micro) => (Number.isSafeInteger(micro) && micro > 0 ? `$${(micro / 1e6).toFixed(4)} a minute` : 'not priced yet');
/** The bot's own transcript line and price (D886 §5), in place of the device's options. */
export function botTranscriptLine(read) {
  const p = read?.price || {};
  const limit = Number.isSafeInteger(read?.limit_minutes) && read.limit_minutes > 0 ? `${read.limit_minutes} minutes` : null;
  return {
    transcript: 'Eadwyn AI records the call’s audio, and its transcript names each speaker where the platform gives their names.',
    price: `Eadwyn AI’s time: ${perMinute(p.bot_microusd_per_minute)}. Its transcript: ${perMinute(p.transcription_microusd_per_minute)}.${limit ? ` A call stops at ${limit} on your plan.` : ''}`,
  };
}

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
/** D1363: what the dialog says once the tokens a refused Start needed have landed. */
export const TOKENS_ADDED_START = 'Tokens added. Press Start to continue.';
export function startRefusal(e) {
  // D1171 (STG4): a plan already full refuses the start (D1170); the room's
  // shared sentence and its links, never the Worker's longer one.
  const storage = storageRefusal(e);
  if (storage) return { text: storage.text, liveHref: null, storage };
  const text = (typeof e?.message === 'string' && e.message.trim()) || 'The session could not be created.';
  // D1363: refused for AI tokens: the dialog offers Top up in place.
  if (tokenRefusal(e)) return { text, liveHref: null, topUp: true };
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
export function assignTarget({ name, company, consent, chatConsent = null }, { projectId, interview = null }) {
  const target = interview?.id != null
    ? { interview_id: Number(interview.id) }
    : { create: { interviewee_name: String(name || '').trim(), interviewee_company: String(company || '').trim() || null, project_id: Number(projectId) } };
  if (CONSENTS.some(([k]) => k === consent)) target.quote_consent = true;
  // D754 (#1980): a chat that waits for consent — Ask in the chat, or the member's word.
  const asked = consentTarget(chatConsent);
  if (asked) target.consent = asked;
  return target;
}
