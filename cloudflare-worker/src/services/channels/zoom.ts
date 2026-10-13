/**
 * D684 (#1577) — Zoom: a member's own Zoom account hosts an interview's call,
 * and the call's cloud transcript becomes the interview's session.
 *
 * THREE PARTS, and only these:
 *   connect   A Connectors-registry OAuth provider (`zoom`), the same shape as
 *             the others: PKCE bound to the signed state, tokens returned to
 *             the route layer, which encrypts them into `integrations`
 *             (columnCipher, KEK_PII). Client id and secret are the platform's
 *             ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET.
 *   schedule  `createMeeting` / `cancelMeeting` on the member's own account.
 *   transcript
 *             One Axal Zoom app posts every member's events to ONE URL, so the
 *             webhook (`handleZoomWebhook`) proves the request is Zoom's
 *             (x-zm-signature over `v0:{ts}:{raw body}`, five-minute window,
 *             constant-time compare), then finds the call by its meeting id in
 *             `interview_channel_refs`. Tenancy is that row's — never the
 *             payload's host or account fields. `recording.transcript_completed`
 *             is claimed once (`claimEvent`) and queues `meeting_import` with
 *             the ref's uid; the job asks Zoom for the recording list WITH THE
 *             MEMBER'S TOKEN and downloads the VTT, so the queue carries ids,
 *             never a transcript or a download link. A call ended and started
 *             again on its link has more than one instance; each is imported,
 *             none over another (see "a restarted call" below).
 *
 * A call with no cloud transcript sends no event at all, so a sweep asks once
 * a day after the call should have ended, and the ref then says why there is
 * none in plain words.
 *
 * The access token is refreshed under a lease held in the connection's own
 * credentials (`accessToken`), so a rotating refresh token is spent once; a
 * disconnect revokes the refresh token, not only the short-lived access token.
 *
 * UNVERIFIED (no Zoom app exists yet; re-check when the owner creates it):
 *   - Scope names. The registry asks for granular scopes as a General app
 *     lists them: `meeting:write:meeting` (create), `meeting:delete:meeting`
 *     (cancel), `cloud_recording:read:list_recording_files` (list a meeting's
 *     recordings and download the transcript file). A classic-scope app would
 *     use `meeting:write` and `recording:read`. Zoom sets scopes on the app,
 *     not the authorize URL, and the callback refuses a grant wider than the
 *     registry's list (`hasScopeOverreach`).
 *   - Whether downloading the transcript file needs a scope beyond listing.
 *   - `x-zm-request-timestamp` is read as epoch seconds (milliseconds also
 *     accepted).
 */
import type { Context } from 'hono';
import type { Env, User } from '../../types';
import { callbackBase } from '../../util/url';
import {
  getDescriptor, registerProvider, type ConnectInput, type ConnectResult, type IntegrationRow,
} from '../../integrations/registry';
import { decryptCredentials, encryptCredentials, type CredentialBlob } from '../../integrations/secrets';
import { constantTimeEqual } from '../../rpc/secret';
import { IntakeError, openSession, writableInterview } from '../interviewIntake';
import { claimEvent, finishEvent, releaseEvent } from './events';
import { enqueueChannelJob, registerChannelJob, registerChannelSweep } from './jobs';
import { providerAvailable } from './connections';
import {
  MeetingProviderError, cancelRef, dueRefs, importMeetingRef, markEnded, meetingImportHandler, refByExternal, setRefStatus, touchRef, withinCallSlot,
  type ImportOutcome, type MeetingErrorCode, type MeetingRef, type TranscriptFetch, type TranscriptFetcher,
} from './meetings';
import type { ImportedSegment } from './types';

const PROVIDER_KEY = 'zoom';
const ZOOM_AUTH = 'https://zoom.us';
const ZOOM_API = 'https://api.zoom.us/v2';
/** Zoom's signature window, and ours: a request older than this is a replay. */
export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
/** A two-hour call's VTT is a few hundred KB; past this it is not a transcript. */
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;
const MAX_CUES = 5000;
/** A call with no transcript event this long after its end is asked about once. */
const QUIET_AFTER_END_MS = 24 * 60 * 60 * 1000;

// ───────────────────────────────────────────────────────────── OAuth

function redirectUri(env: Env): string {
  return `${callbackBase(env)}/api/integrations/oauth/${PROVIDER_KEY}/callback`;
}

function clientCreds(env: Env): { id: string; secret: string } {
  const id = String(env.ZOOM_CLIENT_ID ?? '').trim();
  const secret = String(env.ZOOM_CLIENT_SECRET ?? '').trim();
  // The route layer turns `<provider>_oauth_unconfigured` into a 503 the page can show.
  if (!id || !secret) throw new Error('zoom_oauth_unconfigured: set ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET on the worker.');
  return { id, secret };
}

function basicAuth(env: Env): string {
  const { id, secret } = clientCreds(env);
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

interface ZoomTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/**
 * POST /oauth/token. A refusal (400/401: a used, revoked or expired grant) is
 * not retryable — the member reconnects; anything else may pass later.
 */
async function tokenRequest(env: Env, params: Record<string, string>): Promise<ZoomTokenResponse> {
  let res: Response;
  try {
    res = await fetch(`${ZOOM_AUTH}/oauth/token`, {
      method: 'POST',
      headers: { Authorization: basicAuth(env), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
  } catch {
    throw new MeetingProviderError('zoom_unreachable', true);
  }
  if (res.status === 400 || res.status === 401) throw new MeetingProviderError('zoom_reconnect', false);
  if (!res.ok) throw new MeetingProviderError('zoom_unreachable', true);
  const tok = await res.json().catch(() => null) as ZoomTokenResponse | null;
  if (!tok?.access_token) throw new MeetingProviderError('zoom_unreachable', true);
  return tok;
}

const grantedScopes = (tok: ZoomTokenResponse) => String(tok.scope ?? '').split(/[\s,]+/).filter(Boolean);

async function connect(c: Context<{ Bindings: Env }>, _user: User, input: ConnectInput): Promise<ConnectResult> {
  if (!input.oauth_code) throw new Error('zoom_requires_oauth_code: complete the Zoom consent first.');
  const cfg = (input.config || {}) as Record<string, unknown>;
  const params: Record<string, string> = {
    grant_type: 'authorization_code', code: input.oauth_code, redirect_uri: redirectUri(c.env),
  };
  if (typeof cfg.pkce_verifier === 'string' && cfg.pkce_verifier) params.code_verifier = cfg.pkce_verifier;
  let tok: ZoomTokenResponse;
  try {
    tok = await tokenRequest(c.env, params);
  } catch (e) {
    // A code, never Zoom's body: the callback logs what it is thrown.
    throw new Error(`zoom_token_exchange_failed:${e instanceof MeetingProviderError ? e.code : 'error'}`);
  }
  const credentials: CredentialBlob = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    token_type: 'bearer',
    expires_at: Date.now() + Math.max(60, Number(tok.expires_in) || 3600) * 1000,
  };
  // D685: the extra user-read grant makes a deauthorization event resolvable
  // to one stored connection. Older grants lack it and must reconnect before
  // using attach-by-link; never guess an account from the webhook payload.
  let identity: { id?: string; account_id?: string } | null = null;
  if (grantedScopes(tok).includes('user:read:user')) {
    const res = await fetch(`${ZOOM_API}/users/me`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (!res.ok) throw new Error('zoom_identity_unreadable');
    identity = await res.json().catch(() => null) as { id?: string; account_id?: string } | null;
    if (!identity?.id || !identity.account_id) throw new Error('zoom_identity_unreadable');
  }
  return {
    credentials,
    scopes: grantedScopes(tok),
    external_account_id: identity?.id || null,
    external_account_name: null,
    capabilities: getDescriptor(PROVIDER_KEY)?.capabilities,
    config: identity?.account_id ? { zoom_account_id: identity.account_id } : {},
  };
}

/** POST /oauth/revoke for one token. True when Zoom accepted it; a refusal is logged by kind and status only. */
async function revokeToken(env: Env, token: string, kind: 'refresh' | 'access'): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(`${ZOOM_AUTH}/oauth/revoke`, {
      method: 'POST',
      headers: { Authorization: basicAuth(env), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    if (res.ok) return true;
    console.warn(`[zoom] revoke_refused kind=${kind} status=${res.status}`);
  } catch {
    console.warn(`[zoom] revoke_unreachable kind=${kind}`);
  }
  return false;
}

/**
 * Best-effort: Zoom forgets the grant, so the app no longer acts on the
 * member's account. The stored access token has usually expired by the time a
 * member disconnects (it lives an hour and is refreshed only when used), and
 * Zoom will not revoke an expired one, so the refresh token — which lives for
 * months — is revoked first. If Zoom refuses that, a live access token is
 * revoked instead: the stored one while it lasts, else one refreshed for the
 * purpose. UNVERIFIED (no Zoom app yet): whether /oauth/revoke takes a refresh
 * token; the access-token fallback covers it either way.
 */
async function revokeGrant(env: Env, creds: CredentialBlob | null): Promise<void> {
  const refresh = typeof creds?.refresh_token === 'string' ? creds.refresh_token : '';
  if (await revokeToken(env, refresh, 'refresh')) return;
  let access = liveToken(creds);
  if (!access && refresh) {
    try { access = (await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refresh })).access_token; }
    catch { /* the grant is already gone, or Zoom is away: the stored token is the last try */ }
  }
  await revokeToken(env, access || (typeof creds?.access_token === 'string' ? creds.access_token : ''), 'access');
}

async function buildAuthorizeUrl(c: Context<{ Bindings: Env }>, _user: User, state: string): Promise<string> {
  const { id } = clientCreds(c.env);
  const params = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: redirectUri(c.env), state });
  // The foundation stores the PKCE challenge beside the state (as Carta and
  // Salesforce read it); Zoom supports S256.
  try {
    const row = await c.env.DB.prepare('SELECT extra_json FROM oauth_state_tokens WHERE state = ?')
      .bind(state).first<{ extra_json: string | null }>();
    const extra = row?.extra_json ? JSON.parse(row.extra_json) as Record<string, unknown> : {};
    if (typeof extra.challenge === 'string' && extra.challenge) {
      params.set('code_challenge', extra.challenge);
      params.set('code_challenge_method', 'S256');
    }
  } catch { /* PKCE is defence in depth; the signed state still binds the callback */ }
  return `${ZOOM_AUTH}/oauth/authorize?${params.toString()}`;
}

registerProvider({
  key: PROVIDER_KEY,
  connect,
  buildAuthorizeUrl,
  async revokeGranted(env, result) {
    await revokeGrant(env, result.credentials);
  },
  async disconnect(c, _user, row) {
    await revokeGrant(c.env, await decryptCredentials(c.env, row.uid, row.credentials_enc));
  },
});

// ───────────────────────────────────────────────────────────── the member's connection

/** The member's active Zoom connection: the integrations row the registry wrote. */
export type ZoomConnection = Pick<IntegrationRow, 'id' | 'uid' | 'user_id' | 'credentials_enc'>;

export async function zoomConnection(env: Env, userId: number): Promise<ZoomConnection | null> {
  return (await env.DB.prepare(
    `SELECT id, uid, user_id, credentials_enc FROM integrations WHERE user_id = ? AND provider_key = 'zoom' AND status = 'active'`,
  ).bind(userId).first<{ id: number; uid: string; user_id: number; credentials_enc: string | null }>()) ?? null;
}

function liveToken(creds: CredentialBlob | null): string {
  const at = typeof creds?.access_token === 'string' ? creds.access_token : '';
  const exp = typeof creds?.expires_at === 'number' ? creds.expires_at
    : typeof creds?.expires_at === 'string' ? Date.parse(creds.expires_at) : 0;
  return at && exp - Date.now() > 60_000 ? at : '';
}

/** The stored credentials as read: the exact ciphertext (what a swap compares) and what it holds. */
interface StoredCreds { enc: string; creds: CredentialBlob }

async function readCreds(env: Env, conn: ZoomConnection): Promise<StoredCreds | null> {
  const row = await env.DB.prepare('SELECT credentials_enc FROM integrations WHERE id = ?')
    .bind(conn.id).first<{ credentials_enc: string | null }>();
  const enc = row?.credentials_enc ?? '';
  const creds = enc ? await decryptCredentials(env, conn.uid, enc) : null;
  return creds ? { enc, creds } : null;
}

/**
 * Replace the stored credentials only if they are still exactly `from`: true
 * when this write landed. Each encryption has a fresh nonce, so two writers
 * never produce the same ciphertext and only one swap from a given read lands.
 */
async function swapCreds(env: Env, conn: ZoomConnection, from: string, to: string, settled = false): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE integrations SET credentials_enc = ?, last_error = CASE WHEN ? = 1 THEN NULL ELSE last_error END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND credentials_enc = ?`,
  ).bind(to, settled ? 1 : 0, conn.id, from).run();
  return Number(res.meta?.changes ?? 0) > 0;
}

/** How long one refresh may hold the connection; a holder that died frees it after this. */
const REFRESH_LEASE_MS = 30_000;
const LEASE_POLL_MS = 500;
const LEASE_POLLS = 12;

/** The request holding a live refresh lease on these credentials, or null. */
function leaseHolder(creds: CredentialBlob): string | null {
  const lease = creds.refresh_lease as { holder?: unknown; until?: unknown } | undefined;
  return lease && typeof lease.holder === 'string' && Number(lease.until) > Date.now() ? lease.holder : null;
}

function withoutLease(creds: CredentialBlob): CredentialBlob {
  const { refresh_lease: _lease, ...rest } = creds;
  return rest as CredentialBlob;
}

/**
 * A live access token for the connection, refreshed when within a minute of
 * expiry. Zoom rotates the refresh token on every use, so a refresh token must
 * be spent by one request only.
 *
 * THE LEASE lives in the connection's own encrypted credentials: a request
 * takes it by swapping the credentials it read for a copy that names it and
 * when the lease ends (`swapCreds`, a compare-and-swap D1 runs as one write),
 * so exactly one request holds it. Every other request re-reads the stored
 * credentials until a live token appears or the lease is given back, and
 * never refreshes without holding it; one that waits too long gets a retryable
 * failure, not a refresh. The holder stores the new pair with a swap from its
 * leased copy, so credentials a reconnect wrote meanwhile are never
 * overwritten. A refused refresh is called `zoom_reconnect` only when the
 * refresh token it spent is still the stored one: if another writer stored a
 * newer pair, that pair is used instead.
 */
async function accessToken(env: Env, conn: ZoomConnection): Promise<string> {
  const first = await decryptCredentials(env, conn.uid, conn.credentials_enc);
  if (!first) throw new MeetingProviderError('zoom_reconnect', false);
  const live = liveToken(first);
  if (live) return live;

  const holder = crypto.randomUUID();
  let held: { enc: string; creds: CredentialBlob } | null = null;
  for (let poll = 0; poll <= LEASE_POLLS && !held; poll++) {
    const now = await readCreds(env, conn);
    if (!now) throw new MeetingProviderError('zoom_reconnect', false);
    const token = liveToken(now.creds);
    if (token) return token;
    if (leaseHolder(now.creds)) {
      if (poll < LEASE_POLLS) await new Promise((r) => setTimeout(r, LEASE_POLL_MS));
      continue;
    }
    const creds = withoutLease(now.creds);
    const leased = await encryptCredentials(env, conn.uid, { ...creds, refresh_lease: { holder, until: Date.now() + REFRESH_LEASE_MS } });
    // A lost swap means another request wrote first: the next read shows what.
    if (await swapCreds(env, conn, now.enc, leased)) held = { enc: leased, creds };
  }
  // Another request is still refreshing: its token will be there on a retry.
  if (!held) throw new MeetingProviderError('zoom_unreachable', true);

  const sent = typeof held.creds.refresh_token === 'string' ? held.creds.refresh_token : '';
  let tok: ZoomTokenResponse;
  try {
    if (!sent) throw new MeetingProviderError('zoom_reconnect', false);
    tok = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: sent });
  } catch (e) {
    // Give the lease back. If that swap does not land, someone stored other
    // credentials meanwhile; a refusal of a refresh token that is no longer the
    // stored one says nothing about the connection.
    const released = await swapCreds(env, conn, held.enc, await encryptCredentials(env, conn.uid, held.creds));
    if (!released && e instanceof MeetingProviderError && e.code === 'zoom_reconnect') {
      const now = await readCreds(env, conn);
      if (now && now.creds.refresh_token !== sent) {
        const theirs = liveToken(now.creds);
        if (theirs) return theirs;
        throw new MeetingProviderError('zoom_unreachable', true);
      }
    }
    throw e;
  }
  const next: CredentialBlob = {
    ...held.creds,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || sent,
    token_type: 'bearer',
    expires_at: Date.now() + Math.max(60, Number(tok.expires_in) || 3600) * 1000,
  };
  if (await swapCreds(env, conn, held.enc, await encryptCredentials(env, conn.uid, next), true)) return tok.access_token;
  // The credentials changed under the lease (the member reconnected, or the
  // lease ran out and another request took it): what is stored stands.
  const now = await readCreds(env, conn);
  return (now && liveToken(now.creds)) || tok.access_token;
}

async function zoomApi(env: Env, conn: ZoomConnection, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken(env, conn);
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  try {
    return await fetch(`${ZOOM_API}${path}`, { ...init, headers });
  } catch {
    throw new MeetingProviderError('zoom_unreachable', true);
  }
}

/** How a Zoom status maps to what the member is told. */
function zoomFailure(status: number, otherwise: 'zoom_create_failed' | 'zoom_fetch_failed'): MeetingProviderError {
  if (status === 401) return new MeetingProviderError('zoom_reconnect', false);
  if (status === 429 || status >= 500) return new MeetingProviderError('zoom_unreachable', true);
  return new MeetingProviderError(otherwise, false);
}

// ───────────────────────────────────────────────────────────── schedule

export interface MeetingInput { topic: string; startsAt: string; durationMin: number; autoRecord?: boolean }
export interface CreatedMeeting { externalRef: string; joinUrl: string; startsAt: string; endsAt: string }

/** Zoom wants `yyyy-MM-ddTHH:mm:ssZ`: no milliseconds. */
const zoomTime = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * A scheduled meeting (type 2) on the member's own account. Cloud recording is
 * set only when the member asks (`autoRecord`): recording a customer is the
 * member's decision, and Zoom shows its own recording notice when it starts.
 * The host's `start_url` carries a ZAK token and is never kept.
 */
export async function createMeeting(env: Env, conn: ZoomConnection, input: MeetingInput): Promise<CreatedMeeting> {
  const startsAt = zoomTime(input.startsAt);
  const res = await zoomApi(env, conn, '/users/me/meetings', {
    method: 'POST',
    body: JSON.stringify({
      topic: input.topic.slice(0, 200),
      type: 2,
      start_time: startsAt,
      duration: input.durationMin,
      timezone: 'UTC',
      settings: { auto_recording: input.autoRecord ? 'cloud' : 'none', waiting_room: true, join_before_host: false },
    }),
  });
  if (!res.ok) throw zoomFailure(res.status, 'zoom_create_failed');
  const body = await res.json().catch(() => null) as { id?: number | string; join_url?: string } | null;
  const id = String(body?.id ?? '').trim();
  const joinUrl = String(body?.join_url ?? '');
  if (!/^\d{6,20}$/.test(id) || !/^https:\/\//.test(joinUrl)) throw new MeetingProviderError('zoom_create_failed', false);
  return {
    externalRef: id, joinUrl, startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(Date.parse(startsAt) + input.durationMin * 60_000).toISOString(),
  };
}

/** Delete the meeting at Zoom. True when it is gone (a 404 is gone already). */
export async function cancelMeeting(env: Env, conn: ZoomConnection, externalRef: string): Promise<boolean> {
  if (!/^\d{6,20}$/.test(externalRef)) return false;
  const res = await zoomApi(env, conn, `/meetings/${externalRef}`, { method: 'DELETE' });
  return res.status === 204 || res.status === 200 || res.status === 404;
}

/** A pasted meeting must belong to this member's Zoom user, not just to someone in their account. */
export async function verifyHostedMeeting(env: Env, conn: ZoomConnection, meetingId: string): Promise<boolean> {
  if (!/^\d{6,20}$/.test(meetingId)) return false;
  const [me, meeting] = await Promise.all([
    zoomApi(env, conn, '/users/me'), zoomApi(env, conn, `/meetings/${meetingId}`),
  ]);
  if (me.status === 401 || me.status === 403 || meeting.status === 401 || meeting.status === 403) {
    throw new MeetingProviderError('zoom_reconnect', false);
  }
  if (meeting.status === 404) return false;
  if (!me.ok || !meeting.ok) throw new MeetingProviderError('zoom_unreachable', true);
  const self = await me.json().catch(() => null) as { id?: unknown; account_id?: unknown } | null;
  const call = await meeting.json().catch(() => null) as { host_id?: unknown; id?: unknown } | null;
  const hosted = !!self?.id && String(call?.id ?? '') === meetingId && String(call?.host_id ?? '') === String(self.id);
  if (hosted && self?.account_id) {
    await env.DB.prepare(
      `UPDATE integrations SET external_account_id = ?, config_json = json_set(COALESCE(config_json, '{}'), '$.zoom_account_id', ?),
         updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND provider_key = 'zoom' AND status = 'active'`,
    ).bind(String(self.id), String(self.account_id), conn.id, conn.user_id).run();
  }
  return hosted;
}

// ───────────────────────────────────────────────────────────── webhook

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type SignatureVerdict = 'ok' | 'missing' | 'stale' | 'mismatch';

/**
 * `x-zm-signature` must be `v0=` + hex HMAC-SHA256(secret, `v0:{timestamp}:{raw body}`)
 * and the timestamp within five minutes of now, either way.
 */
export async function verifyZoomSignature(
  secret: string, rawBody: string, headers: Headers, now = Date.now(),
): Promise<SignatureVerdict> {
  const sig = (headers.get('x-zm-signature') || '').trim();
  const tsRaw = (headers.get('x-zm-request-timestamp') || '').trim();
  if (!sig || !/^\d{9,14}$/.test(tsRaw)) return 'missing';
  const tsMs = tsRaw.length > 11 ? Number(tsRaw) : Number(tsRaw) * 1000;
  if (Math.abs(now - tsMs) > SIGNATURE_WINDOW_MS) return 'stale';
  const expected = `v0=${await hmacHex(secret, `v0:${tsRaw}:${rawBody}`)}`;
  return constantTimeEqual(sig.toLowerCase(), expected) ? 'ok' : 'mismatch';
}

export interface WebhookReply { status: 200 | 400 | 401 | 500 | 503; body: Record<string, unknown> }

/**
 * Zoom's `plainToken` is a short random string. Anything else is refused, so
 * the challenge can never be used to sign a `v0:` message of the caller's choosing.
 */
const PLAIN_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * One Zoom webhook request, already read as text (the router caps its size).
 *
 * The url_validation challenge is answered only on a signed request: Zoom
 * signs it like any other event, and answering an unsigned one would hand out
 * HMACs of strings the caller chose.
 *
 * Persist, then acknowledge (D684 §11): the claim and the ref's new status are
 * written and the job queued before the 200. If that fails, the claim is
 * released and Zoom's retry processes the event again.
 */
export async function handleZoomWebhook(env: Env, rawBody: string, headers: Headers, now = Date.now()): Promise<WebhookReply> {
  const secret = String(env.ZOOM_WEBHOOK_SECRET_TOKEN ?? '');
  if (!secret) return { status: 503, body: { error: 'zoom_unavailable', message: 'Zoom is not available on Axal yet.' } };
  const verdict = await verifyZoomSignature(secret, rawBody, headers, now);
  if (verdict !== 'ok') {
    return { status: 401, body: { error: `signature_${verdict}`, message: 'The request is not signed by Zoom.' } };
  }
  let event: { event?: unknown; event_id?: unknown; event_ts?: unknown;
    payload?: { plainToken?: unknown; client_id?: unknown; user_id?: unknown; account_id?: unknown;
      object?: { id?: unknown; uuid?: unknown } } };
  try { event = JSON.parse(rawBody); } catch {
    return { status: 400, body: { error: 'malformed', message: 'The request body is not JSON.' } };
  }
  const name = String(event?.event ?? '');

  if (name === 'endpoint.url_validation') {
    const plainToken = String(event.payload?.plainToken ?? '');
    if (!PLAIN_TOKEN.test(plainToken)) return { status: 400, body: { error: 'malformed', message: 'The challenge has no usable token.' } };
    return { status: 200, body: { plainToken, encryptedToken: await hmacHex(secret, plainToken) } };
  }
  if (name === 'app_deauthorized') {
    const clientId = String(event.payload?.client_id ?? '').trim();
    if (clientId && clientId !== env.ZOOM_CLIENT_ID) return { status: 200, body: { ok: true, ignored: 'other_app' } };
    const userId = String(event.payload?.user_id ?? '').trim().slice(0, 200);
    const accountId = String(event.payload?.account_id ?? '').trim().slice(0, 200);
    if (!userId && !accountId) return { status: 400, body: { error: 'malformed', message: 'The deauthorization has no account.' } };
    const key = String(event.event_id || `${name}:${accountId}:${userId}:${event.event_ts || ''}`).slice(0, 200);
    const claim = await claimEvent(env, 'zoom', key, 'connection');
    if (claim == null) return { status: 200, body: { ok: true, duplicate: true } };
    try {
      const rows = (await env.DB.prepare(
        `SELECT id, user_id FROM integrations WHERE provider_key = 'zoom' AND status = 'active'
           AND (? = '' OR external_account_id = ?)
           AND (? = '' OR json_extract(config_json, '$.zoom_account_id') = ?)`,
      ).bind(userId, userId, accountId, accountId).all<{ id: number; user_id: number }>()).results ?? [];
      for (const row of rows) {
        await env.DB.prepare(
          `UPDATE integrations SET status = 'disconnected', credentials_enc = NULL, webhook_secret_enc = NULL,
             config_json = NULL, scopes_json = NULL, external_account_id = NULL, external_account_name = NULL,
             updated_at = CURRENT_TIMESTAMP WHERE id = ? AND provider_key = 'zoom'`,
        ).bind(row.id).run();
        await env.DB.prepare(
          `UPDATE interview_channel_refs SET status = 'failed', join_url = NULL, last_error = ?, updated_at = datetime('now')
            WHERE provider = 'zoom' AND user_id = ? AND status IN ('scheduled', 'ended', 'transcript_ready')`,
        ).bind('Zoom is not connected to your Axal account. Connect it in Account › Connectors, then retry.', row.user_id).run();
      }
      await finishEvent(env, claim, rows.length ? 'done' : 'ignored', { userId: rows[0]?.user_id });
      return { status: 200, body: { ok: true } };
    } catch {
      await releaseEvent(env, claim).catch(() => undefined);
      return { status: 500, body: { error: 'not_stored', message: 'The connection change could not be stored. Zoom will send it again.' } };
    }
  }
  if (name !== 'meeting.ended' && name !== 'recording.transcript_completed') {
    return { status: 200, body: { ok: true, ignored: 'event' } };
  }

  const meetingId = String(event.payload?.object?.id ?? '').trim();
  const uuid = String(event.payload?.object?.uuid ?? '').trim().slice(0, 100);
  // Every member's every meeting reaches this URL; only an Axal-scheduled one is ours.
  const ref = meetingId ? await refByExternal(env, 'zoom', meetingId) : null;
  if (!ref) return { status: 200, body: { ok: true, ignored: 'unknown_meeting' } };

  const kind = name === 'meeting.ended' ? 'meeting' : 'transcript';
  const claim = await claimEvent(env, 'zoom', `${name}:${uuid || meetingId}`, kind);
  if (claim == null) return { status: 200, body: { ok: true, duplicate: true } };
  const who = { userId: Number(ref.user_id), sessionId: Number(ref.session_id) };
  try {
    if (name === 'meeting.ended') {
      await markEnded(env, ref.id);
      await finishEvent(env, claim, 'done', who);
      return { status: 200, body: { ok: true } };
    }
    if (ref.status === 'cancelled') {
      await finishEvent(env, claim, 'ignored', who);
      return { status: 200, body: { ok: true, ignored: ref.status } };
    }
    // An imported call still takes this event: a new uuid is another instance
    // of the call (it was ended and started again on the same link), and its
    // import adds that part beside the first rather than replacing it.
    if (ref.status !== 'imported') await setRefStatus(env, ref.id, 'transcript_ready', null);
    await enqueueChannelJob(env, 'meeting_import', 'zoom', `${ref.uid}:${uuid || meetingId}`, {
      refUid: ref.uid, meetingUuid: uuid || null,
    });
    await finishEvent(env, claim, 'stored', who);
    return { status: 200, body: { ok: true } };
  } catch (e) {
    await releaseEvent(env, claim).catch(() => undefined);
    console.error(`[zoom] webhook not stored ref=${ref.uid}`, e instanceof Error ? e.name : 'error');
    return { status: 500, body: { error: 'not_stored', message: 'The event could not be stored. Zoom will send it again.' } };
  }
}

// ───────────────────────────────────────────────────────────── the transcript

const vttTime = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;

function vttMs(t: string): number | null {
  const m = vttTime.exec(t.trim());
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, '0'));
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': '\'', '&lrm;': '', '&rlm;': '' };
const cleanText = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|nbsp|quot|#39|lrm|rlm);/g, (m) => ENTITIES[m] ?? m)
  .replace(/\s+/g, ' ').trim();

/** `Name: words` as Zoom writes a known speaker. Not a time (`10:30`), not a URL (`https://`). */
const NAMED = /^([^:<>]{1,80}?):\s+(\S[\s\S]*)$/;
const VOICE = /^<v(?:\.[^\s>]*)?\s+([^>]+)>/i;

/**
 * A WebVTT transcript as segments: one per cue, offsets in milliseconds,
 * the speaker from Zoom's `Name: text` (or a standard `<v Name>` tag).
 *
 * Robust to what VTT allows and Zoom varies: a BOM, CRLF, header metadata,
 * NOTE/STYLE/REGION blocks, cue ids or none, runs of blank lines, multi-line
 * cues, cue settings after the timing, inline tags and entities, `mm:ss.ttt`
 * timings. A cue without a timing line is skipped, not guessed at.
 *
 * A `Name:` prefix is believed only where it is the file's convention (at
 * least half the cues carry one) or the name recurs — so an unlabelled
 * transcript in which someone once says "Here's the thing: …" does not
 * invent a speaker called "Here's the thing".
 */
export function parseVtt(vtt: string): ImportedSegment[] {
  const blocks = String(vtt ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
  const cues: { startMs: number | null; endMs: number | null; voice: string | null; named: [string, string] | null; text: string }[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const head = lines[0].trim();
    if (/^WEBVTT\b/.test(head) || /^(NOTE|STYLE|REGION)\b/.test(head)) continue;
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0 || at > 1) continue;
    const [from, rest] = lines[at].split('-->');
    const to = (rest ?? '').trim().split(/\s+/)[0] ?? '';
    const payload = lines.slice(at + 1);
    if (!payload.length) continue;
    const first = payload[0];
    const voice = VOICE.exec(first)?.[1]?.trim() || null;
    const joined = payload.join('\n');
    const m = voice ? null : NAMED.exec(first);
    const named: [string, string] | null = m && !/^[\d\s.]+$/.test(m[1])
      ? [m[1].trim(), [m[2], ...payload.slice(1)].join('\n')] : null;
    cues.push({ startMs: vttMs(from), endMs: vttMs(to), voice, named, text: joined });
    if (cues.length >= MAX_CUES) break;
  }

  const counts = new Map<string, number>();
  for (const c of cues) if (c.named) counts.set(c.named[0], (counts.get(c.named[0]) ?? 0) + 1);
  const prefixed = cues.filter((c) => c.named).length;
  const convention = cues.length > 0 && prefixed * 2 >= cues.length;

  const out: ImportedSegment[] = [];
  for (const c of cues) {
    const believe = !!c.named && (convention || (counts.get(c.named[0]) ?? 0) >= 2);
    const speaker = c.voice ? cleanText(c.voice) : believe ? cleanText(c.named![0]) : '';
    const text = cleanText(believe ? c.named![1] : c.text).slice(0, 8000);
    if (!text) continue;
    out.push({ speaker: speaker.slice(0, 80), text, startMs: c.startMs, endMs: c.endMs });
  }
  return out;
}

interface RecordingFile {
  file_type?: string; file_extension?: string; status?: string; download_url?: string; recording_type?: string;
}

/** Zoom's own host, over https: the only place the member's token is sent. */
function zoomDownloadUrl(raw: unknown): URL | null {
  try {
    const u = new URL(String(raw ?? ''));
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'zoom.us' || host.endsWith('.zoom.us')) ? u : null;
  } catch { return null; }
}

/**
 * Meeting UUIDs that begin with `/` or contain `//` must be encoded twice
 * (Zoom's rule for /meetings/{meetingId} paths).
 */
function meetingPathId(id: string): string {
  return id.startsWith('/') || id.includes('//') ? encodeURIComponent(encodeURIComponent(id)) : encodeURIComponent(id);
}

async function readCapped(res: Response): Promise<string | null> {
  if (Number(res.headers.get('content-length') || 0) > MAX_TRANSCRIPT_BYTES) return null;
  const buf = await res.arrayBuffer();
  return buf.byteLength > MAX_TRANSCRIPT_BYTES ? null : new TextDecoder().decode(buf);
}

/**
 * The transcript file, downloaded with the member's token. Zoom answers a
 * download with a redirect to a signed file URL; that hop is followed WITHOUT
 * the token, so it never leaves Zoom's own host.
 */
async function downloadTranscript(env: Env, conn: ZoomConnection, url: URL): Promise<string | null> {
  const token = await accessToken(env, conn);
  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get('location') || '', url);
      if (next.protocol !== 'https:') throw new MeetingProviderError('zoom_fetch_failed', false);
      res = await fetch(next.toString(), { redirect: 'follow' });
    }
  } catch (e) {
    if (e instanceof MeetingProviderError) throw e;
    throw new MeetingProviderError('zoom_unreachable', true);
  }
  if (!res.ok) throw zoomFailure(res.status, 'zoom_fetch_failed');
  return readCapped(res);
}

/** One meeting instance's recordings, as Zoom lists them: its uuid, when it started, its files. */
type Recordings =
  | { kind: 'instance'; uuid: string; startTime: string; files: RecordingFile[] }
  | Extract<TranscriptFetch, { kind: 'none' | 'error' }>;

/**
 * GET /meetings/{id}/recordings with the member's token. `id` is an instance's
 * uuid, or the meeting id — which Zoom answers with its LATEST instance only.
 */
async function listRecordings(env: Env, conn: ZoomConnection, id: string): Promise<Recordings> {
  const res = await zoomApi(env, conn, `/meetings/${meetingPathId(id)}/recordings`);
  // 404 / Zoom code 3301: no recording for this meeting at all.
  if (res.status === 404) return { kind: 'none', code: 'zoom_no_transcript' };
  if (res.status === 400 || res.status === 403) {
    // Zoom's 4711 is "the access token does not contain scopes": a grant the
    // member must renew. Its other 4xx codes are about the request. The body
    // is read for that number only.
    const zc = Number((await res.json().catch(() => null) as { code?: unknown } | null)?.code);
    const reconnect = res.status === 403 || zc === 4711;
    return { kind: 'error', code: reconnect ? 'zoom_reconnect' : 'zoom_fetch_failed', retryable: false };
  }
  if (!res.ok) throw zoomFailure(res.status, 'zoom_fetch_failed');
  const body = await res.json().catch(() => null) as { uuid?: unknown; start_time?: unknown; recording_files?: RecordingFile[] } | null;
  return {
    kind: 'instance',
    uuid: String(body?.uuid ?? '').trim().slice(0, 100),
    startTime: String(body?.start_time ?? ''),
    files: Array.isArray(body?.recording_files) ? body!.recording_files : [],
  };
}

/**
 * An instance's TRANSCRIPT file (the audio transcript; a CC file, Zoom's live
 * captions, when there is no transcript), downloaded and parsed.
 */
async function transcriptOf(env: Env, conn: ZoomConnection, files: RecordingFile[]): Promise<TranscriptFetch> {
  const vttFiles = (type: string) => files.filter((f) => String(f.file_type ?? '').toUpperCase() === type);
  const candidates = vttFiles('TRANSCRIPT').length ? vttFiles('TRANSCRIPT') : vttFiles('CC');
  const ready = candidates.find((f) => (f.status ?? 'completed') === 'completed' && zoomDownloadUrl(f.download_url));
  if (!ready) return candidates.length ? { kind: 'waiting' } : { kind: 'none', code: 'zoom_no_transcript' };
  const vtt = await downloadTranscript(env, conn, zoomDownloadUrl(ready.download_url)!);
  if (vtt == null) return { kind: 'none', code: 'transcript_too_large' };
  const segments = parseVtt(vtt);
  return segments.length ? { kind: 'segments', segments } : { kind: 'none', code: 'transcript_empty' };
}

/** Whether an instance's files hold a transcript at all (made, or still being made). */
const hasTranscriptFile = (files: RecordingFile[]) =>
  files.some((f) => ['TRANSCRIPT', 'CC'].includes(String(f.file_type ?? '').toUpperCase()));

/**
 * A Zoom call's transcript, through the member's own connection: one
 * instance's recording list — an instance ref's own uuid, else the instance
 * the webhook named, else the meeting's latest — and its transcript.
 */
export async function fetchTranscript(env: Env, ref: MeetingRef, hint: Record<string, unknown>): Promise<TranscriptFetch> {
  const conn = await zoomConnection(env, Number(ref.user_id));
  if (!conn) return { kind: 'error', code: 'zoom_not_connected', retryable: false };
  const uuid = typeof hint.meetingUuid === 'string' && hint.meetingUuid ? hint.meetingUuid : '';
  const listed = await listRecordings(env, conn, instanceOf(ref)?.uuid || uuid || ref.external_ref);
  return listed.kind === 'instance' ? transcriptOf(env, conn, listed.files) : listed;
}

// ───────────────────────────────────────────────────────────── a restarted call

/**
 * A Zoom link outlives its first use: ending the call and starting it again on
 * the same link makes another INSTANCE of the meeting (same meeting id, new
 * uuid), with its own recording and its own transcript_completed event. Every
 * instance of the interview's call is imported, and none replaces another:
 *
 *   · Each instance is a ref of its own, external_ref `{meeting id}:{uuid}`,
 *     made the first time its transcript is looked for. The refs'
 *     UNIQUE(provider, external_ref) makes that once, however many jobs race.
 *   · The first instance takes the call's own session, and the scheduled ref
 *     shows its state. A later one opens a session of its own on the same
 *     interview, with the call's consent, and is listed beside the call. Each
 *     import replaces only its own session's segments.
 *   · From then on an instance is fetched by its own uuid — by its job, its
 *     retry and the sweep — never as "the meeting's latest", which after a
 *     restart is another instance.
 *
 * Only an instance that started within the scheduled slot (`withinCallSlot`)
 * is this interview's call; a later use of the link is another conversation.
 * An instance with no transcript file gets no ref and no session, and a call
 * the member cancelled imports none of its instances.
 */
const INSTANCE_REF = /^(\d{6,20}):(.+)$/;

/** The meeting id and uuid an instance ref names; null for the scheduled call's own ref. */
export function instanceOf(ref: Pick<MeetingRef, 'provider' | 'external_ref'>): { meetingId: string; uuid: string } | null {
  const m = ref.provider === 'zoom' ? INSTANCE_REF.exec(String(ref.external_ref ?? '')) : null;
  return m ? { meetingId: m[1], uuid: m[2] } : null;
}

/** The instance holding the call's own session, once one does. */
async function ownInstance(env: Env, call: MeetingRef): Promise<MeetingRef | null> {
  return (await env.DB.prepare(
    `SELECT * FROM interview_channel_refs
      WHERE provider = 'zoom' AND session_id = ? AND id <> ? AND external_ref LIKE ?
      ORDER BY id LIMIT 1`,
  ).bind(call.session_id, call.id, `${call.external_ref}:%`).first<MeetingRef>()) ?? null;
}

/**
 * The instance ref for `uuid`, made if it is not there yet: on the call's own
 * session when no instance holds it (one INSERT … WHERE NOT EXISTS, so two
 * instances racing cannot both take it), else on a new session. A session
 * made for a ref another request stored first is deleted again, still empty.
 */
async function bindInstance(env: Env, call: MeetingRef, uuid: string): Promise<MeetingRef> {
  const key = `${call.external_ref}:${uuid}`;
  const found = await refByExternal(env, 'zoom', key);
  if (found) return found;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO interview_channel_refs
       (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, ends_at, status)
     SELECT ?, 'zoom', ?, c.session_id, c.interview_id, c.user_id, c.join_url, c.starts_at, c.ends_at, 'transcript_ready'
       FROM interview_channel_refs c
      WHERE c.id = ? AND c.status NOT IN ('imported', 'cancelled')
        AND NOT EXISTS (SELECT 1 FROM interview_channel_refs o WHERE o.session_id = c.session_id AND o.id <> c.id)`,
  ).bind(crypto.randomUUID(), key, call.id).run();
  const own = await refByExternal(env, 'zoom', key);
  if (own) return own;

  // Re-checks that the interview is still the member's to write (IntakeError if not).
  const scoped = await writableInterview(env, Number(call.user_id), Number(call.interview_id));
  const consent = await env.DB.prepare('SELECT consent_status, consent_method FROM interview_sessions WHERE id = ?')
    .bind(call.session_id).first<{ consent_status: string | null; consent_method: string | null }>();
  const session = await openSession(env, scoped, 'zoom', 'video',
    consent?.consent_status === 'given' && consent.consent_method ? { method: consent.consent_method } : null);
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO interview_channel_refs
       (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, ends_at, status)
     SELECT ?, 'zoom', ?, ?, c.interview_id, c.user_id, c.join_url, c.starts_at, c.ends_at, 'transcript_ready'
       FROM interview_channel_refs c WHERE c.id = ?`,
  ).bind(crypto.randomUUID(), key, session.id, call.id).run();
  if (!Number(res.meta?.changes ?? 0)) {
    await env.DB.prepare(
      'DELETE FROM interview_sessions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM interview_transcript_segments WHERE session_id = ?)',
    ).bind(session.id, session.id).run();
  }
  const bound = await refByExternal(env, 'zoom', key);
  if (!bound) throw new Error('zoom_instance_not_stored');
  return bound;
}

/** The call shows its first instance's state: copied onto the scheduled ref that shares its session. */
async function mirrorOnCall(env: Env, instance: MeetingRef): Promise<void> {
  await env.DB.prepare(
    `UPDATE interview_channel_refs
        SET status = (SELECT status FROM interview_channel_refs WHERE id = ?),
            last_error = (SELECT last_error FROM interview_channel_refs WHERE id = ?),
            updated_at = datetime('now')
      WHERE session_id = ? AND id <> ? AND status NOT IN ('imported', 'cancelled')
        AND (SELECT status FROM interview_channel_refs WHERE id = ?) <> 'cancelled'`,
  ).bind(instance.id, instance.id, instance.session_id, instance.id, instance.id).run();
}

async function importInstance(env: Env, instance: MeetingRef, fetcher: TranscriptFetcher): Promise<ImportOutcome> {
  const out = await importMeetingRef(env, instance, fetcher);
  await mirrorOnCall(env, instance);
  return out;
}

const SKIPPED: ImportOutcome = { status: 'skipped', code: null, retryable: false, segments: 0 };

/**
 * Import a Zoom ref: the `meeting_import` job, the sweep and the retry route
 * all run this. An instance ref imports its own uuid. The scheduled call
 * imports the instance the job names (`meetingUuid`); without one (a retry, a
 * sweep) its own instance again, by uuid, or — before any is known — the
 * meeting's latest. The outcome of an instance is written to that instance;
 * a failure before any instance is known is written to the call, unless the
 * call already holds its own instance and this is a later one's event.
 */
export async function importZoomRef(env: Env, ref: MeetingRef, hint: Record<string, unknown> = {}): Promise<ImportOutcome> {
  if (ref.status === 'cancelled') return SKIPPED;
  const part = instanceOf(ref);
  if (part) {
    // A call the member cancelled (or whose session is gone) imports nothing,
    // even from an instance found before it was cancelled.
    const scheduled = await refByExternal(env, 'zoom', part.meetingId);
    if (!scheduled || scheduled.status === 'cancelled') {
      await cancelRef(env, ref.id);
      return SKIPPED;
    }
    return importInstance(env, ref, fetchTranscript);
  }
  const named = typeof hint.meetingUuid === 'string' ? hint.meetingUuid.trim().slice(0, 100) : '';
  const own = await ownInstance(env, ref);
  if (!named) {
    if (ref.status === 'imported') return SKIPPED;
    if (own) return importInstance(env, own, fetchTranscript);
  }
  // What happened, onto the call — or, for a later instance's event once the
  // call holds its own, onto nothing (a retryable failure still retries the job).
  const settle = async (got: TranscriptFetch): Promise<ImportOutcome> => {
    if (!own) return importMeetingRef(env, ref, async () => got);
    if (got.kind === 'error') return { status: 'failed', code: got.code, retryable: got.retryable, segments: 0 };
    return SKIPPED;
  };

  const conn = await zoomConnection(env, Number(ref.user_id));
  if (!conn) return settle({ kind: 'error', code: 'zoom_not_connected', retryable: false });
  let listed: Recordings;
  try {
    listed = await listRecordings(env, conn, named || ref.external_ref);
  } catch (e) {
    if (!(e instanceof MeetingProviderError)) throw e;
    return settle({ kind: 'error', code: e.code, retryable: e.retryable });
  }
  if (listed.kind !== 'instance') return settle(listed);
  const uuid = listed.uuid || named;
  // Zoom named no instance: nothing to keep apart, so the call imports it as before.
  if (!uuid) return importMeetingRef(env, ref, async () => transcriptOf(env, conn, listed.files));

  const started = Date.parse(listed.startTime);
  if (Number.isFinite(started) && Number.isFinite(Date.parse(String(ref.starts_at ?? ''))) && !withinCallSlot(started, ref)) {
    // Another conversation on the same link. A call this event had marked
    // transcript_ready goes back to waiting for its own instance.
    if (named) {
      if (!own && ref.status === 'transcript_ready') await setRefStatus(env, ref.id, 'ended', null);
      return SKIPPED;
    }
    return settle({ kind: 'none', code: 'zoom_no_transcript' });
  }
  if (!hasTranscriptFile(listed.files)) return settle({ kind: 'none', code: 'zoom_no_transcript' });

  let instance: MeetingRef;
  try {
    instance = await bindInstance(env, ref, uuid);
  } catch (e) {
    if (!(e instanceof IntakeError)) throw e;
    const code: MeetingErrorCode = e.status === 403 ? 'member_inactive' : 'interview_gone';
    return settle({ kind: 'error', code, retryable: false });
  }
  return importInstance(env, instance, async () => transcriptOf(env, conn, listed.files));
}

registerChannelJob('meeting_import', 'zoom', meetingImportHandler('zoom', importZoomRef));

/**
 * A call that produced no cloud transcript sends no event, and a lost job
 * leaves one found but never imported. A day after a call should have ended
 * (or half an hour after a found transcript went quiet) the import runs once;
 * it settles the ref either way — imported, or no_transcript with the reason.
 */
export async function sweepZoom(env: Env, now: Date): Promise<number> {
  if (!providerAvailable(env, 'zoom')) return 0;
  const refs = await dueRefs(env, 'zoom', {
    endedBefore: new Date(now.getTime() - QUIET_AFTER_END_MS).toISOString(),
    idleBefore: new Date(now.getTime() - 30 * 60_000).toISOString(),
    limit: 20,
  });
  for (const ref of refs) {
    await touchRef(env, ref.id);
    await enqueueChannelJob(env, 'meeting_import', 'zoom', `${ref.uid}:sweep:${now.getTime()}`, { refUid: ref.uid });
  }
  return refs.length;
}

registerChannelSweep('zoom', async (env, now) => { await sweepZoom(env, now); });
