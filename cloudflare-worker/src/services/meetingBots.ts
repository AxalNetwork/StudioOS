import { doNamespace } from '../util/doNamespace';
/** D886 B1: authenticated dispatch and a content-free public view. The DO alone changes run status. */
import { refusalBody } from '../util/refusal';
import type { Env, User } from '../types';
import { encryptColumn } from './columnCipher';
import { loadAiBudget, aiPaused, memberChargeMultiplier } from './aiBudget';
import { limitRefusal } from './aiSpendLimit';
import { AI_MARKUP, billedMicro } from './ai/pricing';
import { hydrateSuperAdmin, isSuperAdmin } from '../auth';
import { budgetRefusalMessage } from './aiRouter';
import { userMeetsTier } from '../middleware/requireTier';
import { AUDIO_CHANNELS, type SessionRow } from './interviewSessions';
import { writableSession } from './interviewIntake';
import { runtimeOrigin } from './meetingBotRuntime';

export const BOT_COMMISSION_MULTIPLIER = AI_MARKUP;
export const BOT_SCHEDULE_MAX_MS = 7 * 86400_000;
export const BOT_HEARTBEAT_MS = 60_000;
export const BOT_PROCESSING_MAX_MS = 5 * 60_000;
export const BOT_STATUSES = ['queued','joining','waiting_room','recording','processing','done','failed','stopped'] as const;
export type BotStatus = typeof BOT_STATUSES[number];
export type BotPlatform = 'zoom' | 'google_meet' | 'teams';
export const terminal = (s: BotStatus) => ['done','failed','stopped'].includes(s);
export interface BotRun {
  participants_enc: string | null;
  uid: string; user_id: number; project_id: number; session_id: number; platform: BotPlatform; meeting_url_enc: string;
  status: BotStatus; failure_code: string | null; scheduled_at: number; started_at: number | null; ended_at: number | null;
  minutes: number | null; participant_count: number | null; heartbeat_at: number | null; limit_minutes: number;
  cost_per_minute_microusd: number; rate_per_minute_microusd: number; reservation_uid: string | null; settled_at: number | null; created_at: number;
}
/** B2/B8 provide an idempotent runtime: start/stop use uid as their idempotency key. Never log the input. */
export interface BotRuntime {
  start(run: { uid: string; platform: BotPlatform; meeting_url: string; limit_minutes: number; deadline_at: number; budget_deadline_at: number; notice: string; venture_name: string | null }): Promise<void>;
  stop(run: { uid: string }): Promise<void>;
  heartbeat?(run: {uid:string;deadline_at:number;budget_deadline_at:number}): Promise<void>;
}
export class BotError extends Error {
  status: number; code: string;
  body() { return refusalBody({code:this.code,message:this.message,extra:{code:this.code}}); }
  constructor(status: number, code: string, message: string) { super(message); this.status=status; this.code=code; }
}
export function botRate(cost: number, multiplier = BOT_COMMISSION_MULTIPLIER): number {
  if (!Number.isSafeInteger(cost) || cost <= 0 || cost > 1_000_000_000) throw new BotError(503, 'bot_price_unavailable', 'The meeting bot price has not been measured yet.');
  return Math.ceil(cost * multiplier);
}
export function botLimit(user: User): number { return userMeetsTier(user, 'growth') ? 120 : 30; }
export function botPlatform(value: unknown): { platform: BotPlatform; url: string } {
  try {
    if (typeof value !== 'string' || value.length > 2048) throw 0;
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || u.hash) throw 0;
    const h = u.hostname.toLowerCase();
    let platform: BotPlatform;
    if ((h === 'zoom.us' || h.endsWith('.zoom.us')) && /^\/(?:j\/|wc\/join\/)\d{6,20}\/?$/.test(u.pathname)) platform = 'zoom';
    else if (h === 'meet.google.com' && /^\/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}\/?$/i.test(u.pathname)) platform = 'google_meet';
    else if ((h === 'teams.microsoft.com' || h === 'teams.cloud.microsoft') && /^\/(?:l\/meetup-join\/|meet\/)[^\s]+$/.test(u.pathname)) platform = 'teams';
    else if (h === 'teams.live.com' && /^\/meet\/[^\s]+$/.test(u.pathname)) platform = 'teams';
    else throw 0;
    return { platform, url: u.href };
  } catch { throw new BotError(400, 'unsupported_link', 'Use a Zoom, Google Meet or Microsoft Teams meeting link.'); }
}
export async function botRow(env: Env, uid: string): Promise<BotRun | null> {
  return env.DB.prepare('SELECT * FROM meeting_bots WHERE uid = ?').bind(uid).first<BotRun>();
}
export async function sessionBot(env: Env, sessionId: number, userId: number): Promise<BotRun | null> {
  return env.DB.prepare('SELECT * FROM meeting_bots WHERE session_id = ? AND user_id = ? ORDER BY created_at DESC, uid DESC LIMIT 1').bind(sessionId, userId).first<BotRun>();
}
export function botView(run: BotRun) {
  return { uid: run.uid, platform: run.platform, status: run.status, failure_code: run.failure_code,
    scheduled_at: run.scheduled_at, started_at: run.started_at, ended_at: run.ended_at,
    minutes: run.minutes, participant_count: run.participant_count, limit_minutes: run.limit_minutes,
    rate_per_minute_microusd: run.rate_per_minute_microusd };
}
export function botEnabled(env: Env) { return env.MEETING_BOT === 'on' || env.MEETING_BOT === 'canary'; }
export function botConfigured(env: Env, platform?: BotPlatform) {
  if (!botEnabled(env) || !env.MEETING_BOT_RUN || (env.MEETING_BOT_SECRET?.length ?? 0)<32) return false;
  if (env.MEETING_BOT_RUNTIME) return true;
  if (!env.MEETING_BOT_CONTAINER) return false;
  try { runtimeOrigin(env); } catch { return false; }
  return platform!=='zoom' || !!(env.MEETING_BOT_ZOOM_CLIENT_ID?.trim() && env.MEETING_BOT_ZOOM_CLIENT_SECRET?.trim());
}
export async function botMemberEnabled(env: Env, user: User): Promise<boolean> {
  if (env.MEETING_BOT === 'on') return true;
  return env.MEETING_BOT === 'canary' && isSuperAdmin(await hydrateSuperAdmin(env,user));
}
/** S1: a full-limit balance check, not a reservation. Every actual block still takes an atomic hold. */
export async function checkBotBudget(env: Env, userId: number, quote: number, now = new Date()) {
  if (await aiPaused(env,userId)) throw new BotError(402,'ai_paused',budgetRefusalMessage('ai_paused'));
  const report=await loadAiBudget(env,userId,now);
  if (report.held_for_review.length) throw new BotError(402,'budget_review',budgetRefusalMessage('budget_review'));
  const limited=await limitRefusal(env,userId,quote,now);
  if (limited) throw new BotError(402,'spend_limit',budgetRefusalMessage('spend_limit',limited));
  const day=Math.max(0,report.daily_microusd-report.day_spend_microusd-report.day_reserved_microusd);
  const month=Math.max(0,report.monthly_microusd-report.month_spend_microusd-report.month_reserved_microusd);
  if (quote>Math.min(day,month)+report.balance_microusd) {
    const code=report.daily_capped && day<=month?'budget_user_day':'budget_user_month';
    throw new BotError(402,code,budgetRefusalMessage(code));
  }
}
export async function botSession(env: Env, run: Pick<BotRun, 'user_id'|'session_id'|'project_id'>): Promise<SessionRow> {
  const { session } = await writableSession(env, run.user_id, run.session_id);
  if (session.created_by_user_id !== run.user_id || session.project_id !== run.project_id) throw new BotError(404, 'session_not_found', 'That session is not available.');
  if (session.consent_status !== 'given') throw new BotError(409, 'consent_required', 'Record the interviewee’s agreement before sending the meeting bot.');
  if (session.audio_removed_at) throw new BotError(409, 'audio_removed', 'The audio for this session was removed.');
  return session;
}
/** The label belongs to the run's currently authorized company, never a request parameter. */
export async function botVentureName(env: Env, run: BotRun): Promise<string | null> {
  const { scoped } = await writableSession(env, run.user_id, run.session_id);
  if (scoped.project.id !== run.project_id) throw new BotError(404, 'session_not_found', 'That session is not available.');
  if (scoped.project.company_id === null) return null;
  const company = await env.DB.prepare('SELECT company_name FROM company_profiles WHERE id = ?')
    .bind(scoped.project.company_id).first<{ company_name: string }>();
  if (!company) throw new BotError(503, 'bot_company_unavailable', 'The venture label could not be read.');
  return company.company_name;
}
export async function botControl(env: Env, uid: string, action: string, init?: RequestInit): Promise<Response> {
  if (!env.MEETING_BOT_RUN) throw new BotError(503, 'bot_unavailable', 'The meeting bot is not set up here.');
  const ns = doNamespace(env, env.MEETING_BOT_RUN);
  return ns.get(ns.idFromName(uid)).fetch(new Request(`https://meeting-bot.internal/${action}`, {
    ...({ duplex: 'half' } as Record<string, string>), method: 'POST', ...init, headers: { 'x-bot-run': uid, ...Object.fromEntries(new Headers(init?.headers)) },
  }));
}
export async function dispatchBot(env: Env, user: User, session: SessionRow, args: { meeting_url?: unknown; scheduled_at?: unknown }, now = Date.now()) {
  session = await botSession(env, { user_id: user.id, session_id: session.id, project_id: session.project_id });
  if (!AUDIO_CHANNELS.has(session.channel)) throw new BotError(400,'bot_needs_audio','Choose an audio recording session for the meeting bot.');
  const parsed = botPlatform(args.meeting_url);
  if (!botConfigured(env,parsed.platform) || !await botMemberEnabled(env,user)) throw new BotError(503, 'bot_unavailable', 'The meeting bot is not set up here.');
  const active = await env.DB.prepare("SELECT uid FROM meeting_bots WHERE session_id = ? AND status NOT IN ('done','failed','stopped')").bind(session.id).first();
  if (active) { await botControl(env,String(active.uid),'init'); throw new BotError(409, 'bot_already_running', 'A meeting bot is already running for this session.'); }
  if (session.status !== 'draft' || session.audio_bytes > 0) throw new BotError(409, 'session_in_use', 'Create a fresh session for this meeting bot.');
  const at = args.scheduled_at === undefined ? now : typeof args.scheduled_at === 'string' ? Date.parse(args.scheduled_at) : NaN;
  if (!Number.isFinite(at) || at < now - 60_000 || at > now + BOT_SCHEDULE_MAX_MS) throw new BotError(400, 'invalid_schedule', 'Choose a start time within the next seven days.');
  if (!botConfigured(env,parsed.platform) || !await botMemberEnabled(env,user)) throw new BotError(503, 'bot_unavailable', 'The meeting bot is not set up here.');
  const cost = env.MEETING_BOT === 'canary' ? 2232 : Number(env.MEETING_BOT_COST_MICROUSD_PER_MINUTE);
  const multiplier=await memberChargeMultiplier(env,user.id);
  const rate = botRate(cost,multiplier), limit = botLimit(user), uid = crypto.randomUUID(), scheduled = Math.max(at, now);
  const link = await encryptColumn(env, 'meeting_bots', 'meeting_url_enc', uid, parsed.url);
  // Conservative mixed-audio quote; B6 charges actual transcription separately through aiRouter.
  const transcription=billedMicro('@cf/deepgram/nova-3',{audio_minutes:limit},multiplier);
  await checkBotBudget(env,user.id,rate*limit+transcription,new Date(now));
  try {
    const inserted=await env.DB.batch([env.DB.prepare(`INSERT INTO meeting_bots(uid,user_id,project_id,session_id,platform,meeting_url_enc,scheduled_at,limit_minutes,cost_per_minute_microusd,rate_per_minute_microusd,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM interview_sessions WHERE id = ? AND status = 'draft' AND audio_bytes = 0)`).bind(uid,user.id,session.project_id,session.id,parsed.platform,link,scheduled,limit,cost,rate,now,session.id),
      env.DB.prepare("UPDATE interview_sessions SET submitted_via = 'meeting_bot' WHERE id = ? AND status = 'draft' AND EXISTS (SELECT 1 FROM meeting_bots WHERE uid = ?)").bind(session.id,uid),
    ]);
    if (!inserted[0].meta.changes) throw new BotError(409,'session_in_use','Create a fresh session for Eadwyn AI.');
  } catch (e) {
    if (e instanceof BotError) throw e;
    const raced = await env.DB.prepare("SELECT uid FROM meeting_bots WHERE session_id = ? AND status NOT IN ('done','failed','stopped')").bind(session.id).first();
    if (raced) throw new BotError(409, 'bot_already_running', 'A meeting bot is already running for this session.');
    throw new BotError(503, 'bot_unavailable', 'The meeting bot could not be queued.');
  }
  // GET and duplicate dispatch can initialize a persisted queued row after an interrupted request.
  const response = await botControl(env, uid, 'init');
  if (!response.ok) throw new BotError(response.status, 'bot_unavailable', 'The meeting bot could not be started.');
  return botView((await botRow(env, uid))!);
}
export async function stopSessionBot(env: Env, sessionId: number, userId: number, drain = false) {
  if (!env.MEETING_BOT_RUN) return;
  const run = await sessionBot(env, sessionId, userId);
  if (run && !terminal(run.status)) {
    const r = await botControl(env, run.uid, drain ? 'drain' : 'stop');
    if (!r.ok) throw new BotError(503, 'bot_stop_pending', 'The meeting bot is still stopping. Try again.');
  }
}
