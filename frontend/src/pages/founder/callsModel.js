/**
 * D878 (#2525) — Record a session › Calls, the rules behind its boards
 * (`design/incoming/Record a session · Calls Boards.dc.html`, MC1–MC7, over
 * `Session Channels Page.dc.html`). No React and no fetch, so
 * `frontend/test/record_calls_d878.test.mjs` holds each rule.
 *
 * THE BOARDS SHARE WHATSAPP'S PARTS (D862). The four states, the dialogs, the
 * Original · Translation · Both switch and the proposals list are
 * `ChannelSessionParts.jsx`; the transcript's turns build on
 * `transcriptTurns`, and a proposal's line and confidence on
 * `proposalTitle` and `confidenceOf` (`channelSessionModel.js`).
 *
 * WHAT IT READS, all on the Worker:
 *   GET    /founder/validate/meetings/setup        Zoom's and Meet's steps (D875)
 *   GET    /founder/validate/meetings/upcoming     the next 14 days, unattached (D875)
 *   GET    /founder/validate/meetings              calls, uploads, audio state (D878, this task's one read)
 *   POST   /founder/validate/interviews/:id/meetings  attach a Meet call from the calendar (D871)
 *   POST   /founder/validate/interviews/:id/meetings/:ref/import  try an import again (D684)
 *   GET    /founder/validate/sessions/:id          a call's transcript and summary (D657, D873)
 *   PATCH  /founder/validate/sessions/:id/segments/:seg  rename a speaker
 *   GET    /founder/validate/sessions/:id/audio    a chunk to play from a turn (D690)
 *   GET    /founder/validate/sessions/:id/placements  proposals (D859, D873's decisions and action items)
 *   GET|PUT /founder/validate/sessions/audio-retention, DELETE …/sessions/:id/audio  retention (D877)
 *   uploads go through `lib/recordingUpload.js` (D872), the attestation first.
 *
 * THINGS THIS FILE MUST NEVER DO: show a join link, a meeting id or a
 * passcode; turn a time the store does not hold into a time (it is Not
 * recorded); call Whisper's text the provider's transcript; or say a proposal
 * is in Validate before the founder accepts it.
 */
import { NOT_RECORDED, confidenceOf, proposalTitle, transcriptTurns } from './channelSessionModel.js';

export { NOT_RECORDED };

/* ------------------------------------------------------------------ *
 * Addresses: each tab is a path under D1309's `/validate/record/calls`
 * ------------------------------------------------------------------ */

export const MC_BASE = '/validate/record/calls';

/** The canvas's six tabs, in its order. */
export const MC_TABS = Object.freeze([
  { key: 'upcoming', label: 'Upcoming', to: MC_BASE },
  { key: 'calls', label: 'Calls', to: `${MC_BASE}/all` },
  { key: 'upload', label: 'Upload', to: `${MC_BASE}/upload` },
  { key: 'proposals', label: 'Proposals', to: `${MC_BASE}/proposals` },
  { key: 'connection', label: 'Connection', to: `${MC_BASE}/connection` },
  { key: 'retention', label: 'Retention', to: `${MC_BASE}/retention` },
]);
/** The tabs that open one session when its id follows them: a call's transcript (MC5) and its proposals (MC6). */
const WITH_ID = new Set(['calls', 'proposals']);
const SEG = { calls: 'all', upload: 'upload', proposals: 'proposals', connection: 'connection', retention: 'retention' };

/** The tab and the session a location names: `{ tab, id }`, or null for an address that is not the tool's. */
export function mcRoute(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === MC_BASE) return { tab: 'upcoming', id: null };
  if (!p.startsWith(`${MC_BASE}/`)) return null;
  const [seg, id, extra] = p.slice(MC_BASE.length + 1).split('/');
  const tab = Object.keys(SEG).find((k) => SEG[k] === seg);
  if (!tab || extra !== undefined) return null;
  if (id === undefined) return { tab, id: null };
  if (!WITH_ID.has(tab) || !/^[1-9]\d{0,9}$/.test(id)) return null;
  return { tab, id: Number(id) };
}

/** A tab's address, with a session for Calls and Proposals. */
export function mcHref(tab, id = null) {
  const t = MC_TABS.find((x) => x.key === tab);
  if (!t) throw new Error(`Unknown tab: ${tab}`);
  return id && WITH_ID.has(tab) ? `${t.to}/${Number(id)}` : t.to;
}

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

export const PROVIDER_WORD = Object.freeze({ zoom: 'Zoom', google_meet: 'Google Meet', upload: 'Uploaded' });
const providerWord = (p) => PROVIDER_WORD[p] || NOT_RECORDED;

const pad = (n) => String(n).padStart(2, '0');

/** "00:05:02" from milliseconds into the call; null when the store holds no offset. */
export function clock(ms) {
  const n = Number(ms);
  if (ms === null || ms === undefined || !Number.isFinite(n) || n < 0) return null;
  const s = Math.floor(n / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** A date and time in the founder's words, or null. `timeZone` is for the tests. */
export function when(iso, timeZone) {
  const t = Date.parse(String(iso || ''));
  if (!iso || !Number.isFinite(t)) return null;
  return new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
}

/* ------------------------------------------------------------------ *
 * MC1: Connect calls (D875's setup read)
 * ------------------------------------------------------------------ */

const STEP_T = {
  zoom: { set_up: 'Available on Axal', app_open: 'Open to your Zoom account', connected: 'Connected' },
  google_meet: { set_up: 'Available on Axal', connected: 'Connected', transcripts: 'Transcript access' },
};
const CONNECT_TO = { zoom: '/account/connectors/zoom', google_meet: '/account/connectors/google' };

/**
 * Each provider's card: its steps in the canvas's words, the Worker's own
 * sentence for a step still to do, what the provider requires that Axal
 * cannot see, and the one press the first open step asks for.
 */
export function setupCards(view) {
  return ['google_meet', 'zoom'].filter((p) => view && view[p]).map((p) => {
    const v = view[p];
    const steps = (Array.isArray(v.steps) ? v.steps : []).map((s) => ({
      key: s.key,
      n: s.step,
      t: STEP_T[p][s.key] || s.key,
      state: s.state === 'done' ? 'done' : s.state === 'blocked' ? 'blocked' : 'todo',
      pill: s.state === 'done' ? 'Done' : s.state === 'blocked' ? 'Waiting' : 'To do',
      action: s.state === 'done' ? null : (typeof s.action === 'string' && s.action ? s.action : null),
    }));
    const next = steps.find((s) => s.state !== 'done') || null;
    const pill = v.ready ? { t: 'Ready', tone: 'pos' }
      : p === 'zoom' && v.audience === 'beta' ? { t: 'Zoom beta: open to invited founders', tone: 'lav' }
        : next?.state === 'todo' ? { t: 'Your move', tone: 'amb' } : { t: 'Not available yet', tone: 'mut' };
    let press = null;
    if (next?.state === 'todo' && next.key === 'connected') press = { kind: 'link', t: p === 'zoom' ? 'Connect Zoom' : 'Connect Google', to: CONNECT_TO[p] };
    else if (next?.state === 'todo' && next.key === 'transcripts') press = { kind: 'allow', t: 'Allow transcript import' };
    return {
      key: p,
      name: providerWord(p),
      pill,
      steps,
      prerequisite: (Array.isArray(v.prerequisites) ? v.prerequisites : []).map((x) => x?.line).filter(Boolean)[0] || '',
      press,
      ready: v.ready === true,
    };
  });
}

/** Neither provider can be used yet: the not-connected state the other boards draw. */
export const noneConnected = (view) => !setupCards(view).some((c) => c.ready);

/* ------------------------------------------------------------------ *
 * MC2: upcoming calls, the next 14 days (D875)
 * ------------------------------------------------------------------ */

/**
 * The calls offered, soonest first. A Meet call the founder organizes can be
 * attached here (D871); a Zoom call is attached to the video recording that
 * captures it, so the row says where. A row the Worker refused says why.
 * Never the join link.
 */
export function upcomingRows(calls, timeZone) {
  return (Array.isArray(calls) ? calls : [])
    .filter((c) => c && Number.isFinite(Date.parse(c.starts_at)))
    .slice()
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .map((c, i) => {
      const d = new Date(Date.parse(c.starts_at));
      const part = (o) => d.toLocaleString('en-GB', { ...o, ...(timeZone ? { timeZone } : {}) });
      const end = Number.isFinite(Date.parse(c.ends_at)) ? new Date(Date.parse(c.ends_at)).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }) : null;
      const meet = c.provider === 'google_meet';
      return {
        key: `${c.provider}-${c.starts_at}-${i}`,
        provider: c.provider,
        word: providerWord(c.provider),
        day: part({ day: 'numeric' }),
        mon: part({ month: 'short' }).toUpperCase(),
        wd: part({ weekday: 'short' }).toUpperCase(),
        time: `${part({ hour: '2-digit', minute: '2-digit' })}${end ? ` – ${end}` : ''}`,
        title: String(c.title || '').trim() || 'Title not recorded',
        startsAt: c.starts_at,
        canAttach: meet && !!c.attach && !c.attach_blocked,
        join: meet && c.attach ? { join_url: c.join_url } : null,
        note: c.attach_blocked || (!meet && c.attach ? 'Attach it from Record a session when the call starts: start a video session, then attach the call to it.' : ''),
      };
    });
}

/* ------------------------------------------------------------------ *
 * MC3: a call's status
 * ------------------------------------------------------------------ */

const ORDER = ['scheduled', 'ended', 'transcript_ready', 'imported'];
const STEP_WORD = { scheduled: 'Scheduled', ended: 'Ended', transcript_ready: 'Transcript ready', imported: 'Imported' };
const STOP = {
  no_transcript: { t: 'No transcript', p: 'The call ended without a transcript Axal could read, and no audio to transcribe.' },
  failed: { t: 'Import failed', p: 'The import stopped. Nothing was lost; it can be tried again.' },
  cancelled: { t: 'Cancelled', p: 'The call was cancelled.' },
};

/** The source badge: how the call's text was made. Only an imported call has one. */
export function sourceBadge(call) {
  if (call?.state !== 'imported') return null;
  if (call.transcript_source === 'whisper') return 'Transcribed by Axal';
  if (call.transcript_source === 'native') return call.provider === 'zoom' ? 'Zoom transcript' : 'Meet transcript';
  return `Source: ${NOT_RECORDED}`;
}

/**
 * The timeline: scheduled → ended → transcript ready → imported, each done
 * once the call has passed it, or a stop with Axal's own sentence for why and
 * what to do next. Only the scheduled time is stored, so the other steps
 * carry no time rather than an invented one.
 */
export function callTimeline(call, timeZone) {
  const state = String(call?.state || '');
  const stop = STOP[state] || null;
  const reached = stop ? (state === 'cancelled' ? 0 : 1) : ORDER.indexOf(state);
  const steps = ORDER.slice(0, stop ? reached + 1 : ORDER.length).map((k, i) => ({
    key: k,
    t: STEP_WORD[k],
    at: k === 'scheduled' ? (when(call?.starts_at, timeZone) || NOT_RECORDED) : '',
    state: i <= reached ? 'done' : 'todo',
  }));
  if (stop) steps.push({ key: state, t: stop.t, at: call?.error || stop.p, state: 'stop' });
  const next = [];
  if (state === 'failed') next.push({ kind: 'retry', t: 'Try the import again' });
  if (state === 'no_transcript' || state === 'failed') next.push({ kind: 'upload', t: 'Upload the recording' });
  return {
    id: call?.id,
    word: providerWord(call?.provider),
    title: [call?.company?.name || null, `${providerWord(call?.provider)} call`].filter(Boolean).join(' · '),
    badge: sourceBadge(call),
    steps,
    next,
    sessionId: call?.session_id ?? null,
    interviewId: call?.interview_id ?? null,
    open: state === 'imported' && call?.session_id != null,
    whisperNote: state === 'transcript_ready' && call?.provider === 'zoom' ? 'Axal is transcribing the call’s audio. It reads “Transcribed by Axal” once it is in.' : '',
  };
}

/** An uploaded recording as a row of the Calls list: its interview and where its transcription stands. */
export function uploadRow(u, timeZone) {
  const stage = String(u?.processing_stage || '');
  const status = stage === 'done' ? { t: 'Transcript ready', tone: 'pos' }
    : stage === 'failed' ? { t: 'Transcription stopped', tone: 'neg' }
      : stage ? { t: 'Transcribing', tone: 'amb' }
        : u?.status === 'stopped' ? { t: 'Waiting for its parts', tone: 'amb' } : { t: NOT_RECORDED, tone: 'mut' };
  return {
    sessionId: Number(u?.session_id),
    title: [u?.interviewee || null, u?.company?.name || null, 'Uploaded recording'].filter(Boolean).join(' · '),
    at: when(u?.created_at, timeZone) || NOT_RECORDED,
    status,
    badge: 'Transcribed by Axal',
  };
}

/* ------------------------------------------------------------------ *
 * MC5: the transcript, speakers by name or "Speaker n"
 * ------------------------------------------------------------------ */

/** D872, D870: the label a passage carries until the founder names its speaker. */
export const UNKNOWN_SPEAKER = 'Speaker ?';

/**
 * A call's turns in the chosen view, each with its time into the call and
 * its speaker. "Me" is the founder; a missing label is "Speaker ?". The
 * translation rules are WhatsApp's (`transcriptTurns`).
 */
export function callTurns(segments, view = 'both') {
  const list = Array.isArray(segments) ? segments : [];
  const byId = new Map(list.map((s) => [s?.id, s]));
  return transcriptTurns(list, view)
    .map((t) => {
      const seg = byId.get(t.id) || {};
      const label = String(seg.speaker_label || '').trim();
      return {
        ...t,
        label: label || UNKNOWN_SPEAKER,
        who: label === 'Me' ? 'You' : (label || UNKNOWN_SPEAKER),
        at: clock(seg.start_ms),
        startMs: Number.isFinite(Number(seg.start_ms)) && seg.start_ms !== null ? Number(seg.start_ms) : null,
        canRename: label !== 'Me',
      };
    })
    .sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
}

/** The passages a rename changes: every passage by that speaker, the founder's own never. */
export function renameTargets(segments, label) {
  const l = String(label || '').trim() || UNKNOWN_SPEAKER;
  if (l === 'Me') return [];
  return (Array.isArray(segments) ? segments : [])
    .filter((s) => s?.source === 'final' && (String(s.speaker_label || '').trim() || UNKNOWN_SPEAKER) === l)
    .map((s) => s.id);
}

/** A new name as the route takes it: trimmed, at most 80 characters, never "Me". */
export function speakerName(input) {
  const t = String(input ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return t && t.toLowerCase() !== 'me' ? t : null;
}

/** The chunk a turn's audio is in, and where in it: `{ part, offset }` in seconds, or null. */
export function audioAt(parts, startMs) {
  if (startMs === null || startMs === undefined || !Array.isArray(parts) || !parts.length) return null;
  const known = parts.filter((p) => Number.isFinite(Number(p?.start_ms)) && p.start_ms !== null).sort((a, b) => a.start_ms - b.start_ms);
  const part = [...known].reverse().find((p) => Number(p.start_ms) <= startMs) || null;
  return part ? { part, offset: Math.max(0, (startMs - Number(part.start_ms)) / 1000) } : null;
}

/** The consent line for a call: the session's own record (D872's attestation, or what scheduling took). */
export function callConsent(session) {
  const METHOD = { verbal: 'out loud', written: 'in writing', pre_agreed: 'beforehand' };
  if (session?.consent_status === 'given' && METHOD[session.consent_method]) {
    return { tone: 'pos', t: `Everyone recorded agreed, ${METHOD[session.consent_method]}.`, p: session.consent_at ? `Recorded ${String(session.consent_at).replace('T', ' ').slice(0, 16)} UTC.` : '' };
  }
  return { tone: 'amb', t: 'Consent for this call is not recorded.', p: 'Nothing from it is used until it is.' };
}

/* ------------------------------------------------------------------ *
 * MC6: summary, decisions, action items and data points
 * ------------------------------------------------------------------ */

const isAction = (p) => p?.kind === 'follow_up' && ((p.edited_payload || p.payload || {}).kind === 'action_item');

/** A decision's and an action item's line (D873's kinds); the rest are WhatsApp's. */
export function callItemTitle(p) {
  const v = p?.edited_payload || p?.payload || {};
  if (p?.kind === 'decision') return v.statement ? `${v.statement}${v.owner_hint ? ` (${v.owner_hint})` : ''}` : 'Decision, wording not recorded';
  if (isAction(p)) return v.detail ? `${v.owner_hint ? `${v.owner_hint}: ` : ''}${v.detail}${v.due_hint ? ` by ${v.due_hint}` : ''}` : 'Action item, wording not recorded';
  return proposalTitle(p);
}

/** A data point's Validate module, as WhatsApp's groups name them. */
const MODULE = {
  demand_signal: 'Validate › Demand and urgency signals', budget: 'Validate › Demand and urgency signals',
  competitor_mention: 'Validate › Market intelligence', market_fact: 'Validate › Market intelligence',
  pain_severity: 'Validate › Problem discovery', job_to_be_done: 'Validate › Problem discovery',
  firmographic: 'Validate › Ideal customer profile', segment: 'Validate › Ideal customer profile', icp_fit: 'Validate › Ideal customer profile',
  follow_up: 'Validate › Customer research', prototype_ask: 'Validate › Customer research',
};

/**
 * The proposals waiting for the founder in the canvas's groups: Decisions,
 * Action items, then Data points, each with its module. Pending only, from
 * the latest run of each source, as `proposalGroups` reads them.
 */
export function callProposalGroups(read) {
  const runs = Array.isArray(read?.runs) ? read.runs : [];
  const latest = (src) => [...runs].reverse().find((r) => (r.source === 'assistant' ? 'assistant' : 'studioos') === src);
  const items = [latest('assistant'), latest('studioos')].filter(Boolean).flatMap((r) => r.placements || []).filter((p) => p.status === 'pending');
  const row = (p) => ({
    id: p.id,
    t: callItemTitle(p),
    q: p.cite?.quote || '',
    conf: confidenceOf(p),
    build: p.kind === 'prototype_ask' || (p.payload || {}).build_candidate === true,
    canAccept: p.can_accept !== false,
  });
  const groups = [
    { key: 'decisions', g: 'Decisions', mod: 'Validate › Customer research', items: items.filter((p) => p.kind === 'decision') },
    { key: 'actions', g: 'Action items', mod: 'Validate › Customer research', items: items.filter(isAction) },
    { key: 'data', g: 'Data points', mod: '', items: items.filter((p) => p.kind !== 'decision' && !isAction(p)) },
  ];
  return groups.filter((g) => g.items.length).map((g) => ({
    ...g,
    mod: g.key === 'data' ? [...new Set(g.items.map((p) => MODULE[p.kind]).filter(Boolean))].join(' · ') || 'Validate' : g.mod,
    items: g.items.map(row),
  }));
}

/** The summary the session holds: its sentences, or null when none was written. */
export function callSummary(read) {
  const s = read?.summary;
  if (!s || !String(s.text || '').trim()) return null;
  return { text: String(s.text), model: s.model || null, at: s.summarised_at || null };
}

/* ------------------------------------------------------------------ *
 * MC4: the upload, attestation first (D872)
 * ------------------------------------------------------------------ */

export const UPLOAD_TYPES = '.mp3,.m4a,.mp4,.webm,.wav,audio/*,video/mp4,video/webm';

/** The progress bar's cells: stored, the one in flight, and the rest. */
export function chunkCells(done, total, cells = 12) {
  const t = Math.max(0, Number(total) || 0);
  const d = Math.min(Math.max(0, Number(done) || 0), t);
  if (!t) return Array.from({ length: cells }, () => 'rest');
  const full = Math.floor((d / t) * cells);
  return Array.from({ length: cells }, (_, i) => (i < full ? 'done' : i === full && d < t ? 'now' : 'rest'));
}

/** What an upload costs in AI tokens, before it starts: the default model's price per minute (D872 §3). */
export const WHISPER_USD_PER_MINUTE = 0.00051293;
export function uploadEstimate(durationMs) {
  const min = Math.ceil(Math.max(0, Number(durationMs) || 0) / 60000);
  if (!min) return null;
  return { minutes: min, usd: Math.max(0.01, Math.round(min * WHISPER_USD_PER_MINUTE * 100) / 100) };
}

/* ------------------------------------------------------------------ *
 * MC7: retention (D877)
 * ------------------------------------------------------------------ */

export const RETENTION_CHOICES = Object.freeze([
  { key: '7', days: 7, t: '7 days' },
  { key: '30', days: 30, t: '30 days' },
  { key: '90', days: 90, t: '90 days' },
  { key: 'keep', days: null, t: 'Until I delete it' },
]);

/** The choice the member holds; a number of days the list does not offer is shown as itself. */
export function retentionChoice(r) {
  if (!r) return null;
  if (r.days === null) return RETENTION_CHOICES[3];
  return RETENTION_CHOICES.find((c) => c.days === r.days) || { key: String(r.days), days: r.days, t: `${r.days} days` };
}

/**
 * Each call and upload with its audio's state: kept until a date, deleted
 * (by the founder, or after the retention), or never held. Text stays in
 * every case until the session is deleted.
 */
export function retentionRows({ calls = [], uploads = [], audio = [] } = {}, timeZone) {
  const byId = new Map((Array.isArray(audio) ? audio : []).map((a) => [Number(a.session_id), a]));
  const day = (iso) => {
    const t = Date.parse(String(iso || ''));
    return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(timeZone ? { timeZone } : {}) }) : null;
  };
  const line = (a) => {
    if (!a) return { t: 'No audio kept · text kept', has: false };
    if (a.held) return { t: a.expires_at ? `Audio kept until ${day(a.expires_at)}` : 'Audio kept until you delete it', has: true };
    if (a.removed_at) return { t: `Audio ${a.removed_reason === 'retention' ? 'removed after your retention' : 'deleted'} ${day(a.removed_at) || ''} · text kept`.replace(/\s+·/, ' ·'), has: false };
    return { t: 'No audio kept · text kept', has: false };
  };
  const rows = [
    ...(Array.isArray(calls) ? calls : []).filter((c) => c.session_id != null).map((c) => ({ sessionId: Number(c.session_id), title: [c.company?.name || null, `${providerWord(c.provider)} call`].filter(Boolean).join(' · '), sub: `${providerWord(c.provider)} · ${day(c.starts_at) || NOT_RECORDED}`, ...line(byId.get(Number(c.session_id))) })),
    ...(Array.isArray(uploads) ? uploads : []).map((u) => ({ sessionId: Number(u.session_id), title: [u.interviewee || null, u.company?.name || null].filter(Boolean).join(' · ') || 'Uploaded recording', sub: `Uploaded · ${day(u.created_at) || NOT_RECORDED}`, ...line(byId.get(Number(u.session_id))) })),
  ];
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.sessionId) ? false : seen.add(r.sessionId)));
}
