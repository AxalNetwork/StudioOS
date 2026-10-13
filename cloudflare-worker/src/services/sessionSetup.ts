/**
 * D685 §5.1–§5.2 (#1583) — the rules behind "Record a session" set up in one
 * call: how the call is held, the language, the talking points, and what the
 * interview row says when a session opens and when it stops.
 *
 * Pure checks first (each a function a test can call), then the reads and
 * writes the routes share. Nothing here takes a value from the client that
 * decides a time, a price or a duration.
 */
import type { Env } from '../types';
import { FLUX, WHISPER } from './sttFormats';
import { setInterviewStage } from './validateWriters';

// ---------------------------------------------------------------------------
// How the call is held
// ---------------------------------------------------------------------------

/** The channels the setup offers. `manual` stays accepted on the old route only. */
export const SETUP_CHANNELS = ['in_person', 'video', 'phone', 'text'] as const;

/** Which call providers each channel admits. In person admits none. */
export const CALL_PROVIDERS: Record<string, readonly string[]> = {
  in_person: [],
  video: ['zoom', 'google_meet', 'teams', 'whatsapp', 'telegram'],
  phone: ['phone_speaker', 'whatsapp', 'telegram', 'signal'],
  text: ['whatsapp', 'telegram', 'paste'],
  manual: [],
};

const PROVIDER_NAMES: Record<string, string> = {
  zoom: 'Zoom', google_meet: 'Google Meet', teams: 'Microsoft Teams', whatsapp: 'WhatsApp',
  telegram: 'Telegram', phone_speaker: 'phone on speaker', signal: 'Signal', paste: 'pasted transcript',
};

/** Hosts a pasted meeting link may have, per provider. Only these three carry a link. */
const MEETING_HOSTS: Record<string, (host: string) => boolean> = {
  zoom: (h) => h === 'zoom.us' || h.endsWith('.zoom.us'),
  google_meet: (h) => h === 'meet.google.com',
  teams: (h) => h === 'teams.microsoft.com' || h === 'teams.live.com',
};

/**
 * The call, checked. Returns the refusal sentence, or null when the pair (and
 * any link) is valid. A link is accepted on video only, HTTPS only, and only
 * on the provider's own host.
 */
export function callRefusal(channel: string, provider: string | null, meetingUrl: string | null): string | null {
  const allowed = CALL_PROVIDERS[channel];
  if (!allowed) return 'That channel is not offered.';
  if (provider == null) {
    if (meetingUrl) return 'A meeting link needs the call it belongs to: Zoom, Google Meet or Microsoft Teams.';
    return null;
  }
  if (!allowed.includes(provider)) {
    return channel === 'in_person'
      ? 'An in-person session has no call provider.'
      : `${PROVIDER_NAMES[provider] || 'That provider'} is not offered for this kind of session.`;
  }
  if (!meetingUrl) return null;
  if (channel !== 'video') return 'Only a video call has a meeting link.';
  const hostOk = MEETING_HOSTS[provider];
  if (!hostOk) return `A ${PROVIDER_NAMES[provider]} call has no meeting link to check, so none is stored. Leave the link empty.`;
  let url: URL;
  try { url = new URL(meetingUrl); } catch { return 'That meeting link is not a web address.'; }
  if (url.protocol !== 'https:') return 'A meeting link must start with https://.';
  if (!hostOk(url.hostname.toLowerCase())) return `That link is not a ${PROVIDER_NAMES[provider]} link.`;
  return null;
}

/** The session's call, in words. Derived on every read, never stored. Null in person. */
export function callLabel(channel: string, provider: string | null): string | null {
  if (channel === 'in_person') return null;
  const kind = channel === 'video' ? 'Video call' : channel === 'phone' ? 'Audio call'
    : channel === 'text' ? 'Text chat' : channel === 'manual' ? 'Entered by hand' : null;
  if (!kind) return null;
  if (!provider) return kind;
  if (provider === 'paste') return 'Text chat · Pasted transcript';
  if (provider === 'phone_speaker') return 'Audio call · Phone on speaker';
  const name = PROVIDER_NAMES[provider] || provider;
  return channel === 'phone' && (provider === 'whatsapp' || provider === 'telegram' || provider === 'signal')
    ? `${kind} · ${name} call` : `${kind} · ${name}`;
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

/**
 * The languages both final models take: Nova-3 on Workers AI supports these
 * ten (Cloudflare's Nova-3 and Realtime transcription docs), and Whisper
 * Large v3 Turbo takes all of them. NULL means Detect.
 */
export const LANGUAGES: readonly { code: string; name: string }[] = [
  { code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' }, { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' }, { code: 'hi', name: 'Hindi' }, { code: 'ru', name: 'Russian' },
  { code: 'pt', name: 'Portuguese' }, { code: 'ja', name: 'Japanese' }, { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
];

/** The language as stored, or the refusal. Flux is English-only. */
export function languageFor(raw: unknown, liveModel: string | null):
  { ok: true; language: string | null } | { ok: false; message: string } {
  if (raw == null || raw === '') return { ok: true, language: liveModel === FLUX ? 'en' : null };
  const code = String(raw).trim().toLowerCase();
  if (!LANGUAGES.some((l) => l.code === code)) return { ok: false, message: 'That language is not offered. Choose one from the list, or Detect.' };
  if (liveModel === FLUX && code !== 'en') {
    return { ok: false, message: 'Flux transcribes English only. Choose Nova-3 for the live transcript, or turn it off.' };
  }
  return { ok: true, language: code };
}

/** Whether a final model is given the language. Whisper v1 is not. */
export function takesLanguage(model: string): boolean {
  return model !== WHISPER;
}

// ---------------------------------------------------------------------------
// Talking points
// ---------------------------------------------------------------------------

export const MAX_POINTS = 10;

/** Statements writing the picked hypotheses as points, checked against the project. */
export async function pointStatements(env: Env, sessionId: number, projectId: number, raw: unknown) {
  const ids = Array.isArray(raw)
    ? [...new Set(raw.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, MAX_POINTS)
    : [];
  if (!ids.length) return [];
  const rows = await env.DB.prepare(
    `SELECT id, code, claim FROM hypotheses
      WHERE project_id = ? AND retired_at IS NULL AND id IN (SELECT value FROM json_each(?))`,
  ).bind(projectId, JSON.stringify(ids)).all<{ id: number; code: string; claim: string }>();
  const byId = new Map((rows.results || []).map((r) => [r.id, r]));
  return ids.filter((id) => byId.has(id)).map((id, i) => {
    const h = byId.get(id)!;
    return env.DB.prepare(
      'INSERT INTO interview_session_points (session_id, hypothesis_id, text, sort_order) VALUES (?, ?, ?, ?)',
    ).bind(sessionId, id, `${h.code} · ${h.claim}`.slice(0, 600), i);
  });
}

export async function listPoints(env: Env, sessionId: number) {
  const rows = await env.DB.prepare(
    `SELECT id, hypothesis_id, text, covered_at, covered_offset_ms FROM interview_session_points
      WHERE session_id = ? ORDER BY sort_order, id`,
  ).bind(sessionId).all<{ id: number; hypothesis_id: number | null; text: string; covered_at: string | null; covered_offset_ms: number | null }>();
  return (rows.results || []).map((p) => ({
    id: p.id, hypothesis_id: p.hypothesis_id, text: p.text, covered: p.covered_at != null, covered_offset_ms: p.covered_offset_ms,
  }));
}

// ---------------------------------------------------------------------------
// The interview, on the reads and as sessions move
// ---------------------------------------------------------------------------

export interface InterviewCard { id: number; interviewee_name: string | null; interviewee_company: string | null; project_id: number; stage: string | null }

export async function interviewCard(env: Env, interviewId: number): Promise<InterviewCard | null> {
  return await env.DB.prepare(
    'SELECT id, interviewee_name, interviewee_company, project_id, stage FROM discovery_interviews WHERE id = ?',
  ).bind(interviewId).first<InterviewCard>() ?? null;
}

/**
 * The meeting link a read shows: a pasted one, else the join link of a call
 * scheduled through D684 (interview_channel_refs) for this session.
 */
export async function meetingLink(env: Env, session: { id: number; meeting_url?: string | null }): Promise<string | null> {
  if (session.meeting_url) return session.meeting_url;
  try {
    const ref = await env.DB.prepare(
      'SELECT join_url FROM interview_channel_refs WHERE session_id = ? AND join_url IS NOT NULL ORDER BY id DESC LIMIT 1',
    ).bind(session.id).first<{ join_url: string }>();
    return ref?.join_url ?? null;
  } catch {
    return null;
  }
}

/** Everything a session read carries beside the row. */
export async function sessionExtras(env: Env, session: { id: number; interview_id: number; channel: string; call_provider?: string | null; meeting_url?: string | null }) {
  const [interview, points, link] = await Promise.all([
    interviewCard(env, session.interview_id), listPoints(env, session.id), meetingLink(env, session),
  ]);
  return {
    interview,
    call_label: callLabel(session.channel, session.call_provider ?? null),
    meeting_url: link,
    points,
    points_covered: points.filter((p) => p.covered).length,
  };
}

/**
 * "It lands in Interviews when you stop": the interview moves to `done`, and
 * its channel is filled from the session if it had none. Best-effort and
 * idempotent: an interview already done is left alone, and a failure here
 * never fails the stop that called it.
 */
export async function markInterviewHeld(env: Env, session: { interview_id: number; project_id: number; channel: string }, userId: number | null): Promise<void> {
  try {
    await env.DB.prepare(
      'UPDATE discovery_interviews SET channel = COALESCE(channel, ?) WHERE id = ?',
    ).bind(session.channel, session.interview_id).run();
    const row = await env.DB.prepare('SELECT stage FROM discovery_interviews WHERE id = ?')
      .bind(session.interview_id).first<{ stage: string | null }>();
    if (!row || row.stage === 'done') return;
    await setInterviewStage(env, { projectId: session.project_id, userId, interviewId: session.interview_id, stage: 'done' });
  } catch (e) {
    console.warn('[sessions] marking the interview held failed', (e as Error)?.message);
  }
}

/** The member's own session that is recording or paused, if any. Channel and assistant sessions are not counted. */
export async function activeSessionOf(env: Env, userId: number, exceptId = 0): Promise<{ id: number } | null> {
  return await env.DB.prepare(
    `SELECT id FROM interview_sessions
      WHERE created_by_user_id = ? AND status IN ('recording', 'paused') AND submitted_via IS NULL AND id != ?
      ORDER BY id DESC LIMIT 1`,
  ).bind(userId, exceptId).first<{ id: number }>() ?? null;
}
