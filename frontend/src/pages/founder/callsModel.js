/**
 * D878 (#2525) — Record a session › Calls, the rules behind its boards
 * (`design/incoming/Record a session · Calls Boards.dc.html`, MC1–MC7, over
 * `Session Channels Page.dc.html` variants `mc1`–`mcs`). No React and no
 * fetch, so `frontend/test/record_calls_d878.test.mjs` holds each rule.
 *
 * THE TABS (the canvas's six), each a path under `/validate/record/calls`:
 *   Upcoming    MC2  the next 14 days: calls already on an interview, and the
 *                    calendar's calls that can be attached (D875)
 *   Calls       MC3  each call's status and its source; with a session id,
 *               MC5  its transcript by speaker
 *   Upload      MC4  a recording file, after the attestation (D872)
 *   Proposals   MC6  the summary, decisions, action items and data points
 *                    Eadwyn proposed for a call; nothing lands until accepted
 *   Connection  MC1  Google Meet and Zoom, step by step (D875)
 *   Retention   MC7  how long call audio is kept (D877)
 *
 * WHAT IT READS, all in the Worker:
 *   GET   /founder/validate/meetings/setup        D875: { zoom, google_meet } steps from stored rows
 *   GET   /founder/validate/meetings/upcoming     D875: { connected, calls } from the founder's own calendar
 *   GET   /founder/validate/meetings/calls        D878: one venture's calls, each with its ref and its audio
 *   GET   /calendar/google/status                 the Google sign-in, and whether it was refused
 *   GET   /founder/validate/sessions/:id          the transcript, translation beside the original (D857)
 *   PATCH /founder/validate/sessions/:id/speakers D878: Rename speaker, every passage at once
 *   GET   /founder/validate/sessions/:id/placements  the proposals (D757, D859, D873)
 *   GET/PUT /founder/validate/sessions/audio-retention, DELETE …/sessions/:id/audio  (D877)
 *
 * THINGS THIS FILE MUST NEVER DO: turn a figure the store does not hold into
 * 0 or a date (it is Not recorded, or says why); say a call was transcribed
 * before it was; say a proposal is in Validate before the founder accepts it;
 * or offer the meeting bot's live join, which waits on #2581, #2582 and #2587.
 */
import { NOT_RECORDED } from '../../lib/absence.js';
import { usageMoney } from '../../lib/aiTokens.js';
import { PROPOSAL_GROUPS, confidenceOf, proposalTitle, transcriptTurns } from './channelSessionModel.js';

/* ------------------------------------------------------------------ *
 * Addresses
 * ------------------------------------------------------------------ */

export const MC_BASE = '/validate/record/calls';

export const MC_TABS = Object.freeze([
  { key: 'upcoming', label: 'Upcoming', to: MC_BASE },
  { key: 'calls', label: 'Calls', to: `${MC_BASE}/calls` },
  { key: 'upload', label: 'Upload', to: `${MC_BASE}/upload` },
  { key: 'proposals', label: 'Proposals', to: `${MC_BASE}/proposals` },
  { key: 'connection', label: 'Connection', to: `${MC_BASE}/connection` },
  { key: 'retention', label: 'Retention', to: `${MC_BASE}/retention` },
]);

/** The tabs that read one call (its session) when an id follows them. */
const RECORD_TABS = new Set(['calls', 'proposals']);

/** The tab and the call a location names: `{ tab, id }`, or null for an address that is not this tool's. */
export function mcRoute(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === MC_BASE) return { tab: 'upcoming', id: null };
  if (!p.startsWith(`${MC_BASE}/`)) return null;
  const [tab, id, extra] = p.slice(MC_BASE.length + 1).split('/');
  if (!MC_TABS.some((t) => t.key === tab) || tab === 'upcoming' || extra !== undefined) return null;
  if (id === undefined) return { tab, id: null };
  if (!RECORD_TABS.has(tab) || !/^[1-9]\d{0,9}$/.test(id)) return null;
  return { tab, id: Number(id) };
}

/** A tab's address, with a call's session for Calls and Proposals. */
export function mcHref(tab, id = null) {
  const t = MC_TABS.find((x) => x.key === tab);
  if (!t) throw new Error(`Unknown tab: ${tab}`);
  return id && RECORD_TABS.has(tab) ? `${t.to}/${Number(id)}` : t.to;
}

export const ZOOM_PAGE = '/account/connectors/zoom';
export const GOOGLE_PAGE = '/account/connectors/google';

/* ------------------------------------------------------------------ *
 * Times
 * ------------------------------------------------------------------ */

const DAY = 86400000;
const parse = (v) => {
  if (!v) return NaN;
  const s = String(v);
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) || !/\d\d:\d\d/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`);
};

/** "Tue 21 Oct 2026, 10:00", or Not recorded. `timeZone` is the reader's own unless a test fixes it. */
export function when(v, timeZone) {
  const t = parse(v);
  if (!Number.isFinite(t)) return NOT_RECORDED;
  const d = new Date(t);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone });
  return `${day.replace(/,/g, '')}, ${clockOf(d, timeZone)}`;
}

/** "21 Oct 2026", or Not recorded. */
export function dayOf(v, timeZone) {
  const t = parse(v);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }) : NOT_RECORDED;
}

const clockOf = (d, timeZone) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });

/** A call's span: "10:00 – 10:45", or its start alone when its end is not known. */
export function spanOf(start, end, timeZone) {
  const a = parse(start);
  const b = parse(end);
  if (!Number.isFinite(a)) return NOT_RECORDED;
  return Number.isFinite(b) ? `${clockOf(new Date(a), timeZone)} – ${clockOf(new Date(b), timeZone)}` : clockOf(new Date(a), timeZone);
}

/** Whole minutes between two times, or null. */
export function minutesOf(start, end) {
  const a = parse(start);
  const b = parse(end);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? Math.round((b - a) / 60000) : null;
}

/** A transcript offset as 00:05:02; a missing one is null, never 00:00:00. */
export function offset(ms) {
  const n = Number(ms);
  if (ms == null || !Number.isFinite(n) || n < 0) return null;
  const s = Math.floor(n / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, '0')).join(':');
}

/* ------------------------------------------------------------------ *
 * MC1: Connect calls
 * ------------------------------------------------------------------ */

const STEP_LABELS = {
  zoom: { set_up: 'Available on Axal', app_open: 'Open to your Zoom account', connected: 'Connected' },
  google_meet: { set_up: 'Available on Axal', connected: 'Connected', transcripts: 'Transcript access' },
};

/** Zoom's distribution in words (D757 §2.12): a pill for each audience but public. */
const AUDIENCE = {
  beta: ['Zoom beta: open to invited founders', 'lav'],
  own_account: ['Zoom: Axal’s own Zoom account only, for now', 'amb'],
};

/**
 * The two cards of MC1 from the setup read (and Google's status). Each step is
 * the Worker's: its state and, when not done, its sentence. A sign-in Google
 * refused reads "Sign-in expired" with Reconnect; the plan each tool needs is a
 * line Axal cannot check. `press` is what this page offers: Google's own
 * sign-in or transcript permission, or Zoom's connector page.
 */
export function setupCards(view, googleStatus = null) {
  const out = [];
  for (const provider of ['google_meet', 'zoom']) {
    const v = view?.[provider];
    if (!v || !Array.isArray(v.steps)) continue;
    const steps = v.steps.map((s) => ({
      key: s.key, n: Number(s.step) || null, state: ['done', 'todo', 'blocked'].includes(s.state) ? s.state : 'blocked',
      label: STEP_LABELS[provider][s.key] || s.key, line: s.state === 'done' ? null : (s.action || null),
    }));
    const pills = [];
    let press = null;
    if (provider === 'google_meet') {
      const refused = googleStatus?.connected && googleStatus?.sync_error?.code === 'connection_refused';
      const step = Object.fromEntries(steps.map((s) => [s.key, s]));
      if (refused) { pills.push(['Sign-in expired', 'neg']); press = 'google_reconnect'; }
      else if (step.connected?.state === 'todo') press = 'google_connect';
      else if (step.transcripts?.state === 'todo') press = 'meet_allow';
      if (googleStatus?.connected && googleStatus.google_email) steps.forEach((s) => { if (s.key === 'connected' && s.state === 'done') s.line = `Signed in as ${googleStatus.google_email}.`; });
      if (refused) steps.forEach((s) => { if (s.key === 'connected') { s.state = 'failed'; s.line = 'Google no longer accepts Axal’s sign-in. Reconnect to read your calendar and transcripts again.'; } });
    } else {
      if (AUDIENCE[v.audience] && !v.ready) pills.push(AUDIENCE[v.audience]);
      if (steps.find((s) => s.key === 'connected')?.state === 'todo') press = 'zoom_connect';
    }
    if (v.ready && !pills.some(([, t]) => t === 'neg')) pills.unshift(['Ready', 'pos']);
    out.push({
      provider, name: provider === 'zoom' ? 'Zoom' : 'Google Meet', steps, pills, press,
      page: provider === 'zoom' ? ZOOM_PAGE : GOOGLE_PAGE,
      prerequisite: (v.prerequisites || [])[0]?.line || null,
      ready: !!v.ready,
    });
  }
  return out;
}

/** Neither tool is connected: the "not connected" state of MC1–MC3 (MC-S). */
export function noneConnected(view) {
  const on = (v, key) => (v?.steps || []).some((s) => s.key === key && s.state === 'done');
  return !!view && !on(view.zoom, 'connected') && !on(view.google_meet, 'connected');
}

/* ------------------------------------------------------------------ *
 * MC2: Upcoming calls, the next 14 days
 * ------------------------------------------------------------------ */

export const UPCOMING_DAYS = 14;
export const PROVIDER_NAME = { zoom: 'Zoom', google_meet: 'Google Meet', upload: 'Upload', meeting_bot: 'Notetaker' };

/**
 * One list, by start: the calls already on an interview (scheduled, from the
 * venture's calls) and the calendar's own, not yet attached. A Meet call the
 * founder organizes is attached here, with consent; a Zoom call is attached
 * when it starts, to the recording Record a session opens for it (D685: the
 * Worker checks the host then). The calendar's reason stands where attach
 * cannot.
 */
export function upcomingRows({ upcoming, calls }, now = Date.now(), timeZone) {
  const end = now + UPCOMING_DAYS * DAY;
  const attached = (calls || [])
    .filter((c) => c.meeting?.status === 'scheduled' && parse(c.meeting.starts_at) >= now - 60 * 60000 && parse(c.meeting.starts_at) <= end)
    .map((c) => ({
      key: `a-${c.session_id}`, at: parse(c.meeting.starts_at), day: dayOf(c.meeting.starts_at, timeZone), span: spanOf(c.meeting.starts_at, c.meeting.ends_at, timeZone),
      title: c.interviewee_name ? `${c.interviewee_name}${c.interviewee_company ? ` · ${c.interviewee_company}` : ''}` : 'Interviewee not recorded',
      provider: c.meeting.provider, attached: { interviewId: c.interview_id, sessionId: c.session_id }, attach: null, blocked: null, zoomLater: false,
    }));
  const free = (upcoming?.calls || []).map((c, i) => ({
    key: `u-${i}`, at: parse(c.starts_at), day: dayOf(c.starts_at, timeZone), span: spanOf(c.starts_at, c.ends_at, timeZone),
    title: c.title || 'Untitled call', provider: c.provider, attached: null,
    attach: c.attach && c.provider === 'google_meet' ? { join_url: c.join_url } : null,
    zoomLater: !!c.attach && c.provider === 'zoom',
    blocked: c.attach ? null : (c.attach_blocked || 'This call cannot be attached from here.'),
  }));
  return [...attached, ...free].filter((r) => Number.isFinite(r.at)).sort((a, b) => a.at - b.at);
}

/** How the interviewee agreed, as attaching takes it (CONSENT_METHODS). */
export const CONSENT_CHOICES = Object.freeze([
  { method: 'verbal', label: 'Out loud, at the start' },
  { method: 'written', label: 'In writing' },
  { method: 'pre_agreed', label: 'Agreed beforehand' },
]);

/* ------------------------------------------------------------------ *
 * MC3: a call's status
 * ------------------------------------------------------------------ */

/** The source badge: where the call's text came from, or that none has come. */
export function sourceBadge(call) {
  const m = call?.meeting;
  if (call?.source === 'upload') return { t: 'Uploaded recording', tone: 'out' };
  if (call?.source === 'meeting_bot') return { t: 'Notetaker recording', tone: 'out' };
  if (m?.status === 'imported' && m.transcript_source === 'whisper') return { t: 'Transcribed by Axal', tone: 'out' };
  if (m?.status === 'imported') return { t: m.provider === 'zoom' ? 'Zoom transcript' : 'Meet transcript', tone: 'pos' };
  return { t: 'No transcript yet', tone: 'mut' };
}

/** The ref errors whose next step is to try again: the provider did not answer, or tokens ran out. */
const RETRY = new Set(['zoom_unreachable', 'zoom_fetch_failed', 'meet_unreachable', 'meet_fetch_failed', 'import_failed', 'stt_failed', 'stt_budget', 'stt_paused']);
/** The ref errors that need the founder's connection first. */
const RECONNECT = new Set(['zoom_reconnect', 'zoom_not_connected', 'meet_reconnect', 'meet_not_connected', 'meet_transcripts_unavailable', 'zoom_obf_scope_missing']);
/** The ref errors after which only the recording file can bring the call in. */
const UPLOAD = new Set(['zoom_no_transcript', 'meet_no_transcript', 'meet_no_record', 'meet_no_transcript_recording', 'zoom_audio_unreadable', 'zoom_audio_too_large', 'transcript_empty']);
/** Transcribing the call's audio uses AI tokens (D870). */
const AUDIO_RUN = new Set(['stt_failed', 'stt_budget', 'stt_paused']);

const step = (t, at, state, line = null) => ({ t, at, state, line });

/**
 * MC3: a call's timeline, its next steps and why. Each step is the store's:
 * a time it does not hold reads Not recorded. A Zoom or Meet call reads
 * Scheduled → Ended → Transcript ready → Imported, or stops where it stopped
 * with the Worker's own sentence; an upload reads Uploaded → Transcribing →
 * Transcript ready.
 */
export function callTimeline(call, timeZone) {
  const m = call?.meeting;
  const s = call?.session || {};
  if (!m) {
    const stage = s.processing_stage;
    const steps = [step('Uploaded', when(s.created_at, timeZone), 'done')];
    if (stage === 'failed') steps.push(step('Transcription stopped', '', 'stop', s.processing_error || 'The transcription stopped before it finished.'));
    else if (stage === 'done' || ['summarising', 'placing'].includes(stage)) steps.push(step('Transcript ready', '', 'done'));
    else if (stage === 'uploading' || stage === 'transcribing') steps.push(step('Transcribing', '', 'now'));
    else steps.push(step('Waiting for the upload to finish', '', 'now', 'Open Upload and drop the same file: it carries on from the part it stopped at.'));
    const next = stage === 'failed' ? [{ key: 'process', t: 'Try again' }] : stage == null ? [{ key: 'upload', t: 'Finish the upload' }] : [];
    return { steps, next, why: null };
  }
  const code = m.error_code || null;
  const ORDER = ['scheduled', 'ended', 'transcript_ready', 'imported'];
  const reached = ORDER.indexOf(m.status);
  const mins = minutesOf(m.starts_at, m.ends_at);
  const audioRun = m.transcript_source === 'whisper' || AUDIO_RUN.has(code);
  const base = [
    step('Scheduled', when(m.starts_at, timeZone), 'done'),
    step('Ended', m.ends_at ? `${spanOf(m.ends_at, null, timeZone)}${mins ? ` · ${mins} min` : ''}` : NOT_RECORDED, 'done'),
    step(audioRun ? 'Transcribing with Axal' : 'Transcript ready', '', 'done'),
    step('Imported', `Interview with ${call.interviewee_name || 'the interviewee'}`, 'done'),
  ];
  let steps;
  if (m.status === 'cancelled') steps = [base[0], step('Cancelled', '', 'stop', m.error || null)];
  else if (m.status === 'failed' || m.status === 'no_transcript') {
    const label = m.status === 'no_transcript' ? 'No transcript' : 'Stopped';
    steps = [base[0], ...(m.ends_at ? [base[1]] : []), step(label, '', 'stop', m.error || 'The Worker did not say why.')];
  } else {
    steps = base.map((b, i) => ({ ...b, state: i < reached ? 'done' : i === reached ? (i === 3 ? 'done' : 'now') : 'todo' }));
    if (reached === 0) steps[0].state = 'done';
  }
  const next = [];
  if (RETRY.has(code)) next.push({ key: 'import', t: audioRun ? 'Transcribe with Axal' : 'Try again', tokens: audioRun, minutes: mins });
  if (RECONNECT.has(code)) next.push({ key: 'connection', t: 'Open Connection' });
  if (UPLOAD.has(code) || (m.status === 'no_transcript' && !next.length)) next.push({ key: 'upload', t: 'Upload the recording' });
  if (code === 'meet_no_transcript_recording') next.push({ key: 'drive', t: 'Find the recording in Drive' });
  const why = code === 'stt_budget' ? 'There are no AI tokens left for this. Add tokens, then Transcribe with Axal.'
    : audioRun && next.some((n) => n.key === 'import') ? 'The badge reads “Transcribed by Axal” once it is done.' : null;
  return { steps, next, why };
}

/** The AI tokens an audio run would use: minutes × the default final model's price, or null when either is not known. */
export function tokenEstimate(minutes, models) {
  const id = models?.defaults?.final;
  const price = Number((models?.final || []).find((m) => m.model === id)?.price_usd_per_minute);
  const mins = Number(minutes);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(mins) || mins <= 0) return null;
  return `about ${usageMoney(Math.max(1, Math.round(mins * price * 1e6)))} in AI tokens`;
}

/** The calls list: one line per call, newest first, as the Worker sends it. */
export function callRows(read, timeZone) {
  return (read?.calls || []).map((c) => ({
    id: c.session_id,
    title: c.interviewee_name ? `${c.interviewee_name}${c.interviewee_company ? ` · ${c.interviewee_company}` : ''}` : 'Interviewee not recorded',
    provider: PROVIDER_NAME[c.source] || NOT_RECORDED,
    at: when(c.meeting?.starts_at || c.session?.created_at, timeZone),
    status: statusWord(c),
    badge: sourceBadge(c),
    pending: Number(c.pending_proposals) || 0,
  }));
}

const STATUS = {
  scheduled: ['Scheduled', 'mut'], ended: ['Ended · waiting for the transcript', 'amb'], transcript_ready: ['Transcript coming in', 'amb'],
  imported: ['Imported', 'pos'], no_transcript: ['No transcript', 'neg'], failed: ['Stopped', 'neg'], cancelled: ['Cancelled', 'mut'],
};
function statusWord(c) {
  if (c.meeting) return STATUS[c.meeting.status] || [NOT_RECORDED, 'mut'];
  const st = c.session?.processing_stage;
  return st === 'failed' ? ['Stopped', 'neg'] : st === 'done' || st === 'summarising' || st === 'placing' ? ['Transcript ready', 'pos']
    : st ? ['Transcribing', 'amb'] : ['Upload not finished', 'amb'];
}

/* ------------------------------------------------------------------ *
 * MC5: the transcript, by speaker
 * ------------------------------------------------------------------ */

/**
 * The call's turns: speaker, offset, original and translation (the chat
 * boards' rule, D857). A speaker the provider could not name keeps its label
 * ("Speaker 3") until the founder renames it.
 */
export function callTurns(segments, view = 'both') {
  const list = Array.isArray(segments) ? segments : [];
  const byId = new Map(list.map((s) => [s.id, s]));
  return transcriptTurns(list, view).map((t) => {
    const s = byId.get(t.id) || {};
    const label = String(s.speaker_label || '').trim();
    return { ...t, who: label || 'Speaker not recorded', label, startMs: Number.isFinite(Number(s.start_ms)) && s.start_ms != null ? Number(s.start_ms) : null, at: offset(s.start_ms) };
  });
}

/** Each speaker once, in order of first turn, with how many turns they have. */
export function speakersOf(segments) {
  const out = new Map();
  for (const s of Array.isArray(segments) ? segments : []) {
    const label = String(s?.speaker_label || '').trim();
    if (!label || s.source !== 'final') continue;
    out.set(label, (out.get(label) || 0) + 1);
  }
  return [...out].map(([label, turns]) => ({ label, turns, unnamed: /^(Speaker \S+|Unknown Speaker)$/i.test(label) }));
}

/** A new name for a speaker: trimmed, at most 80 characters, not empty and not the same. */
export function renameCheck(from, to) {
  const name = String(to ?? '').trim().slice(0, 80);
  if (!name) return { error: 'Give the speaker a name.' };
  if (name === from) return { error: 'That is already this speaker’s name.' };
  return { name };
}

/** The consent line over the transcript: how everyone recorded agreed, or that it is not recorded. */
export function callConsent(session) {
  const how = { verbal: 'out loud', written: 'in writing', pre_agreed: 'beforehand', in_app: 'in Axal' }[session?.consent_method];
  if (session?.consent_status === 'given' && how) return { tone: 'pos', t: `Everyone recorded agreed, ${how}.` };
  if (session?.consent_status === 'given') return { tone: 'pos', t: 'Everyone recorded agreed. How is not recorded.' };
  return { tone: 'amb', t: 'Consent is not recorded for this call. Nothing from it is summarised or proposed until it is.' };
}

/* ------------------------------------------------------------------ *
 * MC6: summary, decisions, action items, data points
 * ------------------------------------------------------------------ */

const MODULE_OF = Object.fromEntries(PROPOSAL_GROUPS.flatMap((g) => g.kinds.map((k) => [k, g.mod])));
const ACTION_KINDS = new Set(['follow_up', 'prototype_ask']);

const item = (p) => ({
  id: p.id,
  t: p.kind === 'decision'
    ? ((p.edited_payload || p.payload || {}).statement || 'Decision, statement not recorded')
    : proposalTitle(p),
  q: p.cite?.quote || '',
  conf: confidenceOf(p),
  build: p.kind === 'prototype_ask' || (p.payload || {}).build_candidate === true,
  canAccept: p.can_accept !== false,
  mod: MODULE_OF[p.kind] || (p.kind === 'decision' || ACTION_KINDS.has(p.kind) ? null : 'Validate'),
});

/**
 * The call's pending proposals as the canvas groups them: Decisions, Action
 * items, then Data points with the module each lands in. The latest run of
 * each source counts, as the chat boards read them. An accepted or dismissed
 * one is never offered again.
 */
export function callProposalGroups(read) {
  const runs = Array.isArray(read?.runs) ? read.runs : [];
  const latest = (src) => [...runs].reverse().find((r) => (r.source === 'assistant' ? 'assistant' : 'studioos') === src);
  const pending = [latest('assistant'), latest('studioos')].filter(Boolean).flatMap((r) => r.placements || []).filter((p) => p.status === 'pending');
  const groups = [
    { key: 'decisions', g: 'Decisions', mod: 'Validate › Customer research', items: pending.filter((p) => p.kind === 'decision').map(item) },
    { key: 'actions', g: 'Action items', mod: 'Validate › Customer research', items: pending.filter((p) => ACTION_KINDS.has(p.kind)).map(item) },
    { key: 'data', g: 'Data points', mod: '', items: pending.filter((p) => p.kind !== 'decision' && !ACTION_KINDS.has(p.kind)).map(item) },
  ];
  return groups.filter((g) => g.items.length);
}

/** The summary's lines, as the digest holds them, or none. */
export function summaryLines(digest) {
  return (Array.isArray(digest?.overview) ? digest.overview : [])
    .map((o) => (typeof o === 'string' ? o : o?.text))
    .filter((t) => typeof t === 'string' && t.trim());
}

/* ------------------------------------------------------------------ *
 * MC4: upload
 * ------------------------------------------------------------------ */

/** "42 min" from a duration, or Not recorded. */
export function durationOf(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return NOT_RECORDED;
  const m = Math.round(n / 60000);
  return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** The upload's parts as the canvas draws them: stored, the one in flight, and to come. */
export function chunkBar(done, total) {
  const t = Math.max(0, Number(total) || 0);
  const d = Math.min(t, Math.max(0, Number(done) || 0));
  return Array.from({ length: t }, (_, i) => (i < d ? 'done' : i === d ? 'now' : 'todo'));
}

/* ------------------------------------------------------------------ *
 * MC7: retention
 * ------------------------------------------------------------------ */

export const RETENTION_CHOICES = Object.freeze([7, 30, 90, 365, null]);

/** The founder's setting in words. */
export function retentionWord(days) {
  if (days === null) return 'Until I delete it';
  const n = Number(days);
  if (!Number.isSafeInteger(n) || n <= 0) return NOT_RECORDED;
  return n === 365 ? '1 year' : `${n} day${n === 1 ? '' : 's'}`;
}

/** One call's audio in words: kept until a day, kept until deleted, deleted with its text kept, or text only. */
export function audioLine(audio, timeZone) {
  if (audio?.state === 'held') return audio.kept_until ? `Audio kept until ${dayOf(audio.kept_until, timeZone)}` : 'Audio kept until you delete it';
  if (audio?.state === 'removed') {
    const by = audio.removed_reason === 'retention' ? ' by your retention' : audio.removed_reason === 'deleted' ? ' by you' : '';
    return `Audio deleted ${dayOf(audio.removed_at, timeZone)}${by} · text kept`;
  }
  if (audio?.state === 'none') return 'No audio held · the call’s text only';
  return `Audio ${NOT_RECORDED.toLowerCase()}`;
}
