/**
 * #3708: the owner's staged meeting-bot diagnostic.
 *
 * Super Admin only, against a Meet or Zoom call the owner hosts. One table, in
 * order; each row passes or fails with a code and, when it fails, its fix:
 * - `site`: the Worker reaches the bot host (binding, secret, origin, health, version);
 * - `config`: Google's (or Zoom's) setup, each requirement set or missing, with the API's own error code;
 * - `container` … `audio`: reported by the container itself (`meeting-bot/src/diagnose.ts`);
 * - `last_run`: the owner's latest real run on that platform, its stored failure and detail (D1368).
 *
 * Nothing here is a meeting run: no session, no consent, no charge, no notice.
 * The record and its screenshot live in R2 under `meeting-bot-diagnostics/`,
 * read only by the Super Admin who started it. No page text, name, link or
 * audio is stored: the probe chunk the container sends is zeros, and only its
 * size is kept.
 */
import type { Env, User } from '../types';
import { BotError, botPlatform, type BotPlatform } from './meetingBots';
import { runtimeKey, runtimeOrigin, runtimeUid } from './meetingBotRuntime';
import { doNamespace } from '../util/doNamespace';
import { constantTimeEqual } from '../rpc/secret';
import { googleConnection, accessToken, MEET_SPACE_SCOPE, MEET_TRANSCRIPT_SCOPE } from './channels/googleMeet';
import { zoomConnection, mintObfToken } from './channels/zoom';
import { MeetingProviderError } from './channels/meetings';

export const DIAGNOSE_STAGES = ['site', 'config', 'container', 'browser', 'egress', 'join', 'admission', 'audio', 'last_run'] as const;
export type DiagnoseStage = typeof DIAGNOSE_STAGES[number];
/** The stages only the container reports. */
export const RUNTIME_STAGES = ['container', 'browser', 'egress', 'join', 'admission', 'audio'] as const;
export type DiagnoseResult = 'pass' | 'fail' | 'skipped' | 'running';
export type Fact = string | number | boolean;
export interface DiagnoseRow { stage: DiagnoseStage; result: DiagnoseResult; code: string; facts?: Record<string, Fact>; at: number }
export interface DiagnoseRecord {
  id: string; owner_id: number; platform: BotPlatform; created_at: number;
  rows: DiagnoseRow[]; screenshot: boolean; probe_bytes: number | null;
}

/** A diagnostic's container lives at most 8 minutes (`DIAGNOSE_MS`); its callbacks a little longer. */
export const DIAGNOSE_WINDOW_MS = 10 * 60_000;
const CALLBACK_WINDOW_MS = 5 * 60_000;
const KEY = (id: string) => `meeting-bot-diagnostics/${id}.json`;
const SHOT = (id: string) => `meeting-bot-diagnostics/${id}.png`;
const CODE = /^[a-z0-9_]{1,60}$/;
const FACT_KEY = /^[a-z0-9_.]{1,40}$/;
const FACT_TEXT = /^[a-z0-9_:@.]{1,80}$/;
const GOOGLE_CODE = /^[A-Z_]{1,60}$/;
const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/**
 * Each failing code's fix, in the owner's words. A code with none says
 * "No fix recorded for this code yet", so a new failure is never silent.
 */
export const DIAGNOSE_FIXES: Record<string, string> = {
  binding_missing: 'Bind MEETING_BOT_CONTAINER on the studioos Worker to the studioos-meeting-bot host (PRODUCTION.md, "Owner-only first deployment").',
  secret_missing: 'Set MEETING_BOT_SECRET (32+ characters) on the studioos Worker and the meeting-bot host.',
  origin_invalid: 'APP_URL must be the https origin the bot calls back to (https://app.axal.vc).',
  containers_disabled: 'Enable Cloudflare Containers on the account and deploy the meeting-bot host (meeting-bot-deploy.yml).',
  binding_no_answer: 'The meeting-bot host did not answer. Check its last deploy in Actions (Meeting bot deploy) and its Workers log.',
  image_unavailable: 'The host has no runtime image. Re-run Meeting bot deploy so the image is built and attached.',
  container_start_failed: 'Cloudflare refused to start the container. Check the account’s Containers quota and the host’s log.',
  runtime_no_answer: 'The image started but never answered on port 8080 within 20 s. Read the container log for runtime_failed.',
  runtime_refused: 'The runtime refused the signed command: the host and the Worker hold different MEETING_BOT_SECRET values.',
  runtime_busy: 'A diagnostic is already running on this instance. Wait for it, then start again.',
  launch_failed: 'Chromium did not launch in the image. Rebuild it (meeting-bot-image.yml) and read the container smoke step.',
  host_unreachable: 'The container cannot reach the meeting hosts. Check the host’s egress (enableInternet) and any account egress policy.',
  signin_wall: 'Google sent the bot to sign in. Allow guests in the call (Workspace admin: Meet › Access › let external participants join without sign-in), or use a signed-in bot account (#3678).',
  cannot_join: 'Meet answered “You can’t join this video call”: the meeting admits only its organisation or signed-in users. Change the meeting’s host access, or the Workspace’s external-participant policy.',
  page_unsupported: 'Google declined this browser. The routes left are a signed-in account (#3678) or Google’s own interfaces (D1373).',
  page_unread: 'Meet showed a page none of the bot’s hooks match. Open the screenshot and correct meet/selectors.ts against it.',
  page_name_only: 'The guest name field showed but no join button: the join button’s hook in meet/selectors.ts is out of date.',
  page_other_host: 'Meet redirected to another host. Open the screenshot to see where.',
  join_click_unanswered: 'The bot asked to join and the page showed neither the lobby nor the call. Open the screenshot; the lobby hook may be out of date.',
  join_button_failed: 'The join button could not be pressed. Open the screenshot and correct its hook.',
  navigation_failed: 'The Meet page did not load. Check egress, then try again.',
  link_invalid: 'Meet says the link names no meeting. Use the link of a call that is open now.',
  not_admitted: 'The host denied the request. Admit Eadwyn AI when it asks.',
  meeting_ended: 'The call ended before the bot was admitted. Keep it open during the check.',
  admission_timed_out: 'No one admitted the bot within 3 minutes. Admit Eadwyn AI from the call’s People panel.',
  no_frames: 'Admitted, but no audio frames arrived in 20 s. Speak in the call; if it still fails, the capture hook (meet/capture.ts) is not reading Meet’s audio.',
  upload_failed: 'Frames arrived but the probe chunk did not upload. Check the Worker’s /api/meeting-bots/diagnostics route and its log.',
  oauth_client_missing: 'Set GOOGLE_CAL_CLIENT_ID and GOOGLE_CAL_CLIENT_SECRET (or GOOGLE_CLIENT_*) on the studioos Worker.',
  not_connected: 'Connect Google Calendar from your own account (Settings › Connections).',
  meet_reconnect: 'Your Google grant was revoked or expired. Reconnect Google Calendar.',
  meet_api_disabled: 'Enable the Google Meet REST API in the Cloud project of the OAuth client (APIs & Services › Library).',
  meet_api_scope_missing: 'Reconnect Google with the Meet scopes. If Google refuses them, add them to the consent screen and submit it for verification.',
  meet_api_error: 'The Meet REST API refused with the code shown. Check the Cloud project’s API and quota pages.',
  zoom_bot_unconfigured: 'Set MEETING_BOT_ZOOM_CLIENT_ID and MEETING_BOT_ZOOM_CLIENT_SECRET (the Meeting SDK app) on the studioos Worker.',
  zoom_not_connected: 'Connect Zoom from your own account (Settings › Connections).',
  zoom_meeting_unread: 'Use a zoom.us/j/<number> link.',
  zoom_waiting_for_host: 'Zoom mints the bot’s pass only while you are in the meeting. Join it as the connected Zoom account, then run the check again.',
  zoom_obf_scope_missing: 'The Zoom grant lacks user:read:token. Add the scope to the Zoom app and reconnect Zoom.',
  zoom_reconnect: 'Your Zoom grant was revoked or expired. Reconnect Zoom.',
  never_reported: 'The container went quiet at this stage. Read the meeting-bot host’s log for diagnose_failed or runtime_failed around this time.',
  last_run_failed: 'Your last real run failed with the code shown. Its detail says where it stopped (D1368).',
};
const fixFor = (code: string) => DIAGNOSE_FIXES[code] ?? 'No fix recorded for this code yet.';

function cleanFacts(input: unknown): Record<string, Fact> | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 12) throw new Error('invalid_facts');
  const out: Record<string, Fact> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!FACT_KEY.test(k)) throw new Error('invalid_facts');
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)) out[k] = v;
    else if (typeof v === 'string' && FACT_TEXT.test(v)) out[k] = v;
    else throw new Error('invalid_facts');
  }
  return out;
}

function store(env: Env) {
  if (!env.FILES) throw new BotError(503, 'diagnostics_unavailable', 'Diagnostics need the FILES bucket.');
  return env.FILES;
}
async function load(env: Env, id: string): Promise<DiagnoseRecord | null> {
  if (!runtimeUid(id)) return null;
  const obj = await store(env).get(KEY(id));
  return obj ? JSON.parse(await obj.text()) as DiagnoseRecord : null;
}
/** Read, change, write only if no one wrote between: the container's reports and the start can race. */
async function update(env: Env, id: string, change: (rec: DiagnoseRecord) => boolean | void, create?: DiagnoseRecord): Promise<DiagnoseRecord | null> {
  const bucket = store(env);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const obj = await bucket.get(KEY(id));
    if (!obj && !create) return null;
    const rec: DiagnoseRecord = obj ? JSON.parse(await obj.text()) : structuredClone(create!);
    if (change(rec) === false) return rec;
    const written = await bucket.put(KEY(id), JSON.stringify(rec), {
      httpMetadata: { contentType: 'application/json' },
      // A new record's id is a fresh UUID: nothing else can be creating it.
      ...(obj ? { onlyIf: { etagMatches: obj.etag } } : {}),
    });
    if (written) return rec;
  }
  throw new Error('diagnosis_contended');
}
function put(rec: DiagnoseRecord, row: DiagnoseRow) {
  rec.rows = [...rec.rows.filter((r) => r.stage !== row.stage), row];
}

// ── the Worker's own stages ──

function container(env: Env, id: string) {
  const ns = doNamespace(env, env.MEETING_BOT_CONTAINER!);
  return ns.get(ns.idFromName(id));
}

export async function siteStage(env: Env, id: string, now: number): Promise<DiagnoseRow> {
  const facts: Record<string, Fact> = {
    rollout: ['on', 'canary'].includes(env.MEETING_BOT ?? '') ? env.MEETING_BOT! : 'off',
    binding: !!env.MEETING_BOT_CONTAINER, secret: (env.MEETING_BOT_SECRET?.length ?? 0) >= 32,
  };
  const fail = (code: string) => ({ stage: 'site' as const, result: 'fail' as const, code, facts, at: now });
  if (!env.MEETING_BOT_CONTAINER) return fail('binding_missing');
  if (!facts.secret) return fail('secret_missing');
  try { runtimeOrigin(env); } catch { return fail('origin_invalid'); }
  try {
    const res = await container(env, id).fetch(new Request('https://meeting-bot-container.internal/health', { signal: AbortSignal.timeout(9000) }));
    const body: any = await res.json().catch(() => null);
    if (res.status === 503 && body?.code === 'container_unavailable') return fail('containers_disabled');
    if (!res.ok) return fail('binding_no_answer');
    facts.version = typeof body?.version === 'string' && /^[a-f0-9]{7,40}$/.test(body.version) ? body.version.slice(0, 12) : 'unknown';
  } catch { return fail('binding_no_answer'); }
  return { stage: 'site', result: 'pass', code: 'bot_host_answered', facts, at: now };
}

const scopeFact = (scopes: string[], scope: string) => (!scopes.length ? 'unknown' : scopes.includes(scope) ? 'granted' : 'missing');

/** Google's own refusal, as its status and reason codes only (never its message), and the row's code. */
export function meetApiRefusal(httpStatus: number, body: any): { fact: string; failure: string } {
  const status = typeof body?.error?.status === 'string' && GOOGLE_CODE.test(body.error.status) ? body.error.status : `HTTP_${httpStatus}`;
  const reason = (Array.isArray(body?.error?.details) ? body.error.details : []).map((d: any) => d?.reason).find((r: unknown) => typeof r === 'string' && GOOGLE_CODE.test(r));
  return {
    fact: `${status}${reason ? `:${reason}` : ''}`.toLowerCase(),
    failure: reason === 'SERVICE_DISABLED' ? 'meet_api_disabled'
      : reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' || (status === 'PERMISSION_DENIED' && !reason) ? 'meet_api_scope_missing' : 'meet_api_error',
  };
}

/** Google's setup, each requirement set or missing. None of it gates a guest join; each gates a Meet feature the bot leans on. */
export async function googleStage(env: Env, userId: number, now: number, doFetch: typeof fetch = fetch): Promise<DiagnoseRow> {
  const client = !!((env as any).GOOGLE_CAL_CLIENT_ID || env.GOOGLE_CLIENT_ID);
  const conn = await googleConnection(env, userId);
  const scopes = conn ? conn.scope.split(/[\s,]+/).filter(Boolean) : [];
  const facts: Record<string, Fact> = {
    oauth_client: client ? 'set' : 'missing', connection: conn ? 'connected' : 'missing',
    scope_calendar_events: conn ? scopeFact(scopes, CALENDAR_EVENTS_SCOPE) : 'missing',
    scope_meetings_space_created: conn ? scopeFact(scopes, MEET_SPACE_SCOPE) : 'missing',
    scope_meetings_space_readonly: conn ? scopeFact(scopes, MEET_TRANSCRIPT_SCOPE) : 'missing',
    meet_api: 'not_checked',
    // Neither is readable through an API: the join stage answers the second.
    consent_screen: 'owner_check_in_cloud_console', guest_policy: 'read_by_join_stage',
  };
  let failure: string | null = !client ? 'oauth_client_missing' : !conn ? 'not_connected' : null;
  if (client && conn) {
    try {
      const token = await accessToken(env, userId);
      const res = await doFetch('https://meet.googleapis.com/v2/conferenceRecords?pageSize=1', { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
      if (res.ok) facts.meet_api = 'enabled';
      else ({ fact: facts.meet_api, failure } = meetApiRefusal(res.status, await res.json().catch(() => null)));
    } catch (e) {
      const code = e instanceof MeetingProviderError ? e.code : 'meet_unreachable';
      facts.meet_api = code;
      failure = code === 'meet_reconnect' ? 'meet_reconnect' : 'meet_api_error';
    }
  }
  return failure ? { stage: 'config', result: 'fail', code: failure, facts, at: now } : { stage: 'config', result: 'pass', code: 'configured', facts, at: now };
}

/** Zoom's setup: the Meeting SDK app, the owner's connection, and one OBF mint for this meeting (never returned). */
export async function zoomStage(env: Env, userId: number, meetingUrl: string, now: number): Promise<DiagnoseRow> {
  const sdk = !!(env.MEETING_BOT_ZOOM_CLIENT_ID?.trim() && env.MEETING_BOT_ZOOM_CLIENT_SECRET?.trim());
  const conn = await zoomConnection(env, userId);
  const meeting = /^\/(?:j\/|wc\/join\/)(\d{6,20})\/?$/.exec(new URL(meetingUrl).pathname)?.[1];
  const facts: Record<string, Fact> = { sdk_credentials: sdk ? 'set' : 'missing', connection: conn ? 'connected' : 'missing', meeting_id: meeting ? 'readable' : 'unread', obf: 'not_checked' };
  let failure: string | null = !sdk ? 'zoom_bot_unconfigured' : !conn ? 'zoom_not_connected' : !meeting ? 'zoom_meeting_unread' : null;
  if (!failure) {
    try { await mintObfToken(env, conn!, meeting!); facts.obf = 'minted'; }
    catch (e) {
      const code = e instanceof MeetingProviderError && /^zoom_[a-z_]{1,35}$/.test(e.code) ? e.code : 'zoom_obf_failed';
      facts.obf = code;
      failure = code;
    }
  }
  return failure ? { stage: 'config', result: 'fail', code: failure, facts, at: now } : { stage: 'config', result: 'pass', code: 'configured', facts, at: now };
}

/** The owner's latest real run on this platform: D886's code and D1368's detail, never its link or names. */
export async function lastRunStage(env: Env, userId: number, platform: BotPlatform, now: number): Promise<DiagnoseRow> {
  const run = await env.DB.prepare(`SELECT status, failure_code, failure_detail, created_at FROM meeting_bots
    WHERE user_id=? AND platform=? ORDER BY created_at DESC LIMIT 1`).bind(userId, platform)
    .first<{ status: string; failure_code: string | null; failure_detail: string | null; created_at: number }>();
  if (!run) return { stage: 'last_run', result: 'skipped', code: 'no_runs', at: now };
  const facts: Record<string, Fact> = { status: CODE.test(run.status) ? run.status : 'unknown', age_minutes: Math.max(0, Math.round((now - run.created_at) / 60_000)) };
  if (run.failure_code && CODE.test(run.failure_code)) facts.failure_code = run.failure_code;
  if (run.failure_detail && /^[a-z_]{1,40}(@[a-z_]{1,40}(:[a-z_]{1,20})?)?$/.test(run.failure_detail)) facts.failure_detail = run.failure_detail;
  return run.status === 'failed' ? { stage: 'last_run', result: 'fail', code: 'last_run_failed', facts, at: now }
    : { stage: 'last_run', result: 'pass', code: `last_run_${facts.status}`, facts, at: now };
}

// ── start, report, read ──

export interface DiagnoseDeps { now?: number; fetch?: typeof fetch; id?: string }

export async function startDiagnosis(env: Env, actor: Pick<User, 'id'>, meetingUrl: unknown, deps: DiagnoseDeps = {}) {
  store(env);
  const { platform, url } = botPlatform(meetingUrl);
  if (platform === 'teams') throw new BotError(400, 'diagnose_platform', 'The diagnostic covers Google Meet and Zoom.');
  const now = deps.now ?? Date.now(), id = deps.id ?? crypto.randomUUID();
  const rec: DiagnoseRecord = { id, owner_id: actor.id, platform, created_at: now, rows: [], screenshot: false, probe_bytes: null };
  const site = await siteStage(env, id, now);
  put(rec, site);
  put(rec, platform === 'google_meet' ? await googleStage(env, actor.id, now, deps.fetch) : await zoomStage(env, actor.id, url, now));
  put(rec, await lastRunStage(env, actor.id, platform, now));
  if (site.result !== 'pass') for (const stage of RUNTIME_STAGES) put(rec, { stage, result: 'skipped', code: 'site_failed', at: now });
  // Written before the container starts, so its first report has a record to land on.
  await update(env, id, () => {}, rec);
  if (site.result !== 'pass') return view(rec, now);
  let code = 'binding_no_answer';
  try {
    const res = await container(env, id).fetch(new Request('https://meeting-bot-container.internal/diagnose', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: id, platform, meeting_url: url }), signal: AbortSignal.timeout(25_000),
    }));
    const body: any = await res.json().catch(() => null);
    code = res.status === 202 ? 'starting' : typeof body?.code === 'string' && CODE.test(body.code) ? (body.code === 'container_unavailable' ? 'containers_disabled' : body.code) : 'binding_no_answer';
  } catch { /* binding_no_answer */ }
  const after = await update(env, id, (r) => {
    // The container reports `container: pass` itself once it holds the command; never overwrite it.
    if (code === 'starting') {
      if (r.rows.some((x) => x.stage === 'container')) return false;
      put(r, { stage: 'container', result: 'running', code, at: now });
    } else {
      put(r, { stage: 'container', result: 'fail', code, at: now });
      for (const stage of RUNTIME_STAGES.slice(1)) put(r, { stage, result: 'skipped', code: 'container_failed', at: now });
    }
  });
  return view(after ?? rec, now);
}

/** The runtime's signature over `v1:<ts>:POST:<path>:<body>`, with the diagnostic's own derived key. */
export async function validDiagnosisCallback(env: Env, req: Request, raw: string, id: string, now = Date.now()) {
  const ts = req.headers.get('x-meeting-bot-timestamp') ?? '', sig = req.headers.get('x-meeting-bot-signature') ?? '';
  if ((env.MEETING_BOT_SECRET?.length ?? 0) < 32 || !runtimeUid(id) || !/^\d{13}$/.test(ts) || Math.abs(now - Number(ts)) > CALLBACK_WINDOW_MS || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(await runtimeKey(env.MEETING_BOT_SECRET!, id)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v1:${ts}:POST:${new URL(req.url).pathname}:${raw}`)));
  return constantTimeEqual(sig, [...mac].map((b) => b.toString(16).padStart(2, '0')).join(''));
}

const base64 = (value: unknown, max: number) => {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('invalid_payload');
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
};
export const SCREENSHOT_MAX = 3 * 1024 * 1024;
export const PROBE_MAX = 64 * 1024;

/** One callback from the container. Returns an HTTP status; never echoes what it was sent. */
export async function diagnosisCallback(env: Env, id: string, kind: string, raw: string, now = Date.now()): Promise<number> {
  const existing = await load(env, id);
  if (!existing) return 404;
  if (now - existing.created_at > DIAGNOSE_WINDOW_MS) return 410;
  let body: any;
  try { body = JSON.parse(raw); } catch { return 400; }
  let change: (rec: DiagnoseRecord) => void;
  try {
    if (kind === 'report') {
      if (!RUNTIME_STAGES.includes(body?.stage) || !['pass', 'fail', 'skipped', 'running'].includes(body?.result) || typeof body?.code !== 'string' || !CODE.test(body.code)) return 400;
      const facts = cleanFacts(body.facts);
      const row: DiagnoseRow = { stage: body.stage, result: body.result, code: body.code, ...(facts && Object.keys(facts).length ? { facts } : {}), at: now };
      change = (rec) => put(rec, row);
    } else if (kind === 'screenshot') {
      const png = base64(body?.png, SCREENSHOT_MAX);
      if (png.byteLength < 8 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) return 400;
      await store(env).put(SHOT(id), png, { httpMetadata: { contentType: 'image/png' } });
      change = (rec) => { rec.screenshot = true; };
    } else if (kind === 'probe') {
      // Only its size is kept: the upload path is what is being checked.
      const wav = base64(body?.wav, PROBE_MAX);
      if (wav.byteLength < 44 || new TextDecoder().decode(wav.subarray(0, 4)) !== 'RIFF' || new TextDecoder().decode(wav.subarray(8, 12)) !== 'WAVE') return 400;
      change = (rec) => { rec.probe_bytes = wav.byteLength; };
    } else return 404;
  } catch { return 400; }
  await update(env, id, change);
  return 200;
}

export function view(rec: DiagnoseRecord, now = Date.now()) {
  // Past its window, a stage still waiting (or never heard from) is a failure: the container went quiet there.
  const over = now - rec.created_at > DIAGNOSE_WINDOW_MS;
  const rows = DIAGNOSE_STAGES.map((stage): DiagnoseRow => {
    const row = rec.rows.find((r) => r.stage === stage) ?? { stage, result: 'running', code: 'waiting', at: rec.created_at };
    return over && row.result === 'running' ? { ...row, result: 'fail', code: 'never_reported', facts: { last_code: row.code } } : row;
  });
  const settled = rows.every((r) => r.result !== 'running');
  return {
    id: rec.id, platform: rec.platform, created_at: new Date(rec.created_at).toISOString(), done: settled,
    // The first failing row in the order the bot meets them is the answer to "where does it fail".
    stops_at: rows.find((r) => r.result === 'fail' && r.stage !== 'last_run' && r.stage !== 'config')?.stage
      ?? rows.find((r) => r.result === 'fail')?.stage ?? null,
    rows: rows.map((r) => ({ stage: r.stage, result: r.result, code: r.code, facts: r.facts ?? {}, fix: r.result === 'fail' ? fixFor(r.code) : null })),
    screenshot: rec.screenshot, probe_bytes: rec.probe_bytes,
  };
}

export async function readDiagnosis(env: Env, ownerId: number, id: string, now = Date.now()) {
  const rec = await load(env, id);
  return rec && rec.owner_id === ownerId ? view(rec, now) : null;
}
export async function readDiagnosisScreenshot(env: Env, ownerId: number, id: string): Promise<ReadableStream | null> {
  const rec = await load(env, id);
  if (!rec || rec.owner_id !== ownerId || !rec.screenshot) return null;
  return (await store(env).get(SHOT(id)))?.body ?? null;
}
