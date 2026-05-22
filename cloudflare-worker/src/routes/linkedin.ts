/**
 * LinkedIn — "Sign in with LinkedIn" (OpenID Connect) used by the Refer &
 * Earn page to attach a verified LinkedIn identity to the current user.
 *
 * IMPORTANT: LinkedIn does NOT expose a user's 1st-degree connections via
 * any public API (the v1 connections endpoint was deprecated in 2015). The
 * companion CSV-import flow on the frontend handles connections — this
 * worker route only handles OAuth identity.
 *
 * Three endpoints:
 *   POST /api/linkedin/oauth/start      → returns { authorize_url }
 *   GET  /api/linkedin/oauth/callback   → exchanges code, attaches identity,
 *                                          redirects back to /refer
 *   POST /api/linkedin/disconnect       → clears LinkedIn fields on user
 *
 * Security:
 *   - State token is HMAC-SHA256 signed with JWT_SECRET (same key the rest
 *     of the worker uses) and stored in KV with a 10-minute TTL. The KV
 *     entry is single-use: deleted on successful callback.
 *   - LinkedIn access_token is discarded after the userinfo fetch — we
 *     only need identity at sign-in time.
 *   - The three required secrets must be set via `wrangler secret put`.
 *     Missing any one of them returns 503 from /oauth/start; the UI hides
 *     the OAuth tab in that case.
 */
import { Hono } from 'hono';
import { stripTrailingSlashes, callbackBase } from '../util/url';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const linkedin = new Hono<{ Bindings: Env }>();

const LINKEDIN_AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const STATE_TTL_SECONDS = 600; // 10 minutes per task spec.

// ---------------------------------------------------------------------------
// Lazy migration. The `users` table is created by the worker's main schema
// long before LinkedIn was a feature, so the three columns may not exist on
// older deployments. We add them defensively on the first request to this
// router. SQLite ignores `ADD COLUMN` failures only via best-effort: we
// catch and swallow "duplicate column" errors so subsequent boots no-op.
// ---------------------------------------------------------------------------
let migrationDone = false;
const REQUIRED_COLS = ['linkedin_sub', 'linkedin_email', 'linkedin_name', 'linkedin_connected_at'];

async function ensureColumns(env: Env): Promise<void> {
  if (migrationDone) return;
  const sql = getSQL(env);
  // Try ALTERs (idempotent — duplicate-column errors are expected on warm
  // starts; most other failure modes are also benign).
  for (const col of REQUIRED_COLS) {
    try {
      await sql.unsafe(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
    } catch (e: any) {
      const msg = String(e?.message || e || '').toLowerCase();
      if (!msg.includes('duplicate') && !msg.includes('already exists')) {
        console.warn('[LINKEDIN] ensureColumns:', col, msg);
      }
    }
  }
  // Verify all required columns landed before flipping the cache flag.
  // Without this, a transient ALTER failure pins migrationDone=true for the
  // life of the isolate and every subsequent call would touch a missing
  // column. PRAGMA table_info is the SQLite-native introspection.
  let allPresent = false;
  try {
    const rows = await sql.unsafe(`PRAGMA table_info(users)`);
    const present = new Set((rows as any[]).map((r: any) => String(r?.name || '').toLowerCase()));
    allPresent = REQUIRED_COLS.every(c => present.has(c));
  } catch (e: any) {
    console.warn('[LINKEDIN] ensureColumns PRAGMA failed:', e?.message || e);
  }
  await sql.end();
  // Only cache the success — a partial migration will be retried on the next
  // request rather than silently failing forever.
  if (allPresent) migrationDone = true;
}

// Task #5 (DC) — derive the LinkedIn redirect URI from APP_URL when the
// LINKEDIN_REDIRECT_URI env var is unset. The explicit env var still wins
// when present (e.g. preview env pointing at a workers.dev URL), but the
// production deploy now self-bootstraps to https://axal.vc/api/linkedin/
// oauth/callback so the LinkedIn consent screen never shows workers.dev.
function linkedinRedirectUri(env: Env): string {
  // In production, ignore stale workers.dev overrides (see services/calendar.ts
  // for the same hardening — a workers.dev consent screen would 410-Gone on
  // the callback path and break the connect).
  const override = env.LINKEDIN_REDIRECT_URI;
  if (override) {
    const envName = String((env as { ENVIRONMENT?: string }).ENVIRONMENT || '').toLowerCase();
    const isProd = envName === 'production' || envName === 'prod';
    let host = '';
    try { host = new URL(override).hostname.toLowerCase(); } catch { host = ''; }
    const stale = isProd && host.endsWith('.workers.dev');
    if (host && !stale) return override;
  }
  const base = callbackBase(env);
  return base ? `${base}/api/linkedin/oauth/callback` : '';
}

/**
 * Env-first via `loadOauthCreds`, falls back to admin-managed
 * `provider_oauth_keys` row. Returns null if neither path yields creds
 * or the redirect URI isn't derivable. Mirrors the
 * slack/hubspot/calendly/stripe/carta pattern.
 */
async function loadLinkedinCreds(env: Env): Promise<{ id: string; secret: string } | null> {
  if (!linkedinRedirectUri(env)) return null;
  const { loadOauthCreds } = await import('../services/providerOauthKeys');
  const c = await loadOauthCreds(env, 'linkedin');
  return c ? { id: c.id, secret: c.secret } : null;
}

// ---------------------------------------------------------------------------
// HMAC-signed state. Format: `${nonce}.${b64url(hmac)}`. The nonce alone is
// the KV key; the HMAC binds the nonce to JWT_SECRET so an attacker who
// guessed a KV key still can't forge a valid state without the secret.
// ---------------------------------------------------------------------------
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmacSign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return b64url(sig);
}
async function makeState(env: Env, userId: number): Promise<string> {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const sig = await hmacSign(env.JWT_SECRET || '', nonce);
  // KV stores the signed user_id payload under the nonce. TTL is enforced by
  // KV itself; the callback also rechecks the HMAC.
  await env.RATE_LIMITS.put(`linkedin:state:${nonce}`, JSON.stringify({ user_id: userId }), {
    expirationTtl: STATE_TTL_SECONDS,
  });
  return `${nonce}.${sig}`;
}
async function consumeState(env: Env, raw: string | null | undefined): Promise<{ ok: true; userId: number } | { ok: false; reason: string }> {
  if (!raw || typeof raw !== 'string' || !raw.includes('.')) {
    return { ok: false, reason: 'malformed state' };
  }
  const [nonce, sig] = raw.split('.', 2);
  if (!nonce || !sig) return { ok: false, reason: 'malformed state' };
  const expected = await hmacSign(env.JWT_SECRET || '', nonce);
  if (expected !== sig) return { ok: false, reason: 'state signature mismatch' };
  const key = `linkedin:state:${nonce}`;
  const stored = await env.RATE_LIMITS.get(key);
  if (!stored) return { ok: false, reason: 'state expired or already used' };
  // Workers KV does not provide compare-and-delete; we narrow the replay
  // window by deleting *before* any downstream IO so a near-simultaneous
  // second callback is overwhelmingly likely to see the empty key.
  // Belt-and-braces: LinkedIn's authorization codes are themselves single-
  // use server-side, so the second-of-a-pair callback would fail at the
  // token-exchange step regardless of whether it cleared this guard.
  try { await env.RATE_LIMITS.delete(key); } catch {}
  try {
    const parsed = JSON.parse(stored);
    const userId = Number(parsed?.user_id);
    if (!userId) return { ok: false, reason: 'state payload invalid' };
    return { ok: true, userId };
  } catch {
    return { ok: false, reason: 'state payload invalid' };
  }
}

// ---------------------------------------------------------------------------
// POST /api/linkedin/oauth/start  (auth required)
// Returns { authorize_url } — the client opens this in a popup or top-level
// nav. Returns 503 if any required secret is missing.
// ---------------------------------------------------------------------------
linkedin.post('/oauth/start', async (c) => {
  const creds = await loadLinkedinCreds(c.env);
  if (!creds) {
    return c.json({
      detail: 'LinkedIn sign-in is not configured on this deployment yet. Please use the CSV import tab instead, or contact support.',
    }, 503);
  }
  // requireAuth's "Unauthorized" must propagate so the global onError maps it
  // to 401. Everything *after* it (DB / KV / crypto) is wrapped so a missing
  // binding or transient infra hiccup returns a friendly 503 to the modal
  // instead of a generic 500 ("Internal server error") that leaks into the UI.
  const user = await requireAuth(c);
  // Task #70 — Integrations page hand-off. The Connect button there posts
  // ?return_to=integrations (or { return_to: "integrations" } in the body)
  // so the callback can route the user back to /integrations instead of
  // the default /refer. Short-lived, scoped cookie keeps the round-trip
  // self-contained (mirrors the calendar return_to cookie).
  let returnTo = String(c.req.query('return_to') || '').toLowerCase();
  if (!returnTo) {
    try {
      const body: any = await c.req.json().catch(() => null);
      if (body && typeof body.return_to === 'string') returnTo = body.return_to.toLowerCase();
    } catch { /* body may be empty */ }
  }
  try {
    await ensureColumns(c.env);
    const state = await makeState(c.env, user.id);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: creds.id,
      redirect_uri: linkedinRedirectUri(c.env),
      scope: 'openid profile email',
      state,
    });
    if (returnTo === 'integrations') {
      c.header(
        'Set-Cookie',
        'studioos_li_return=integrations; HttpOnly; Secure; SameSite=Lax; Path=/api/linkedin; Max-Age=600',
        { append: true },
      );
    }
    return c.json({ authorize_url: `${LINKEDIN_AUTHORIZE_URL}?${params.toString()}` });
  } catch (e: any) {
    console.error('[LINKEDIN] oauth/start failed:', e?.message || e);
    return c.json({
      detail: "LinkedIn sign-in isn't available right now — please try again in a few minutes, or use the CSV import tab.",
    }, 503);
  }
});

// ---------------------------------------------------------------------------
// GET /api/linkedin/oauth/callback?code=&state=
// Exchanges code → access_token, fetches /v2/userinfo, attaches identity to
// the user row, discards the token, and redirects back to /refer.
// ---------------------------------------------------------------------------
const LINKEDIN_RETURN_COOKIE_RE = /(?:^|;\s*)studioos_li_return=([^;]+)/;
function readLinkedinReturnTo(c: any): string {
  const m = (c.req.header('cookie') || '').match(LINKEDIN_RETURN_COOKIE_RE);
  return m ? decodeURIComponent(m[1]).slice(0, 32) : '';
}
function clearLinkedinReturnCookie(): string {
  return 'studioos_li_return=; HttpOnly; Secure; SameSite=Lax; Path=/api/linkedin; Max-Age=0';
}
function redirectBack(env: Env, status: 'connected' | 'error', returnTo: string, message?: string) {
  const base = callbackBase(env);
  const params = new URLSearchParams({ linkedin: status });
  if (message) params.set('linkedin_error', message);
  const path = returnTo === 'integrations' ? '/integrations' : '/refer';
  return new Response(null, {
    status: 302,
    headers: { Location: `${base}${path}?${params.toString()}`, 'Set-Cookie': clearLinkedinReturnCookie() },
  });
}

// Coarse error codes the frontend's /refer flash mapper understands. Keep in
// sync with the FLASHES map in ReferEarnPage.jsx — never emit raw backend text
// here, since the value rides in a URL query param and would otherwise leak
// into the modal banner verbatim.
type LinkedInCallbackCode =
  | 'oauth_denied'
  | 'not_configured'
  | 'state_invalid'
  | 'token_unavailable'
  | 'identity_unavailable'
  | 'save_failed';

linkedin.get('/oauth/callback', async (c) => {
  const returnTo = readLinkedinReturnTo(c);
  const creds = await loadLinkedinCreds(c.env);
  if (!creds) {
    return redirectBack(c.env, 'error', returnTo, 'not_configured' satisfies LinkedInCallbackCode);
  }
  const code = c.req.query('code');
  const state = c.req.query('state');
  const oauthError = c.req.query('error');
  if (oauthError) {
    // CodeQL js/clear-text-logging: NO LOG on this branch. The user-supplied
    // `error` query param is tainted; even a literal log call inside this
    // gated block was being taint-flagged. The redirect carries the unified
    // `oauth_denied` code which is sufficient for the UI; if provider-side
    // diagnostics are ever needed, surface them via a structured metric
    // (not a console call) so CodeQL has no string sink to taint.
    return redirectBack(c.env, 'error', returnTo, 'oauth_denied' satisfies LinkedInCallbackCode);
  }
  if (!code || !state) {
    return redirectBack(c.env, 'error', returnTo, 'state_invalid' satisfies LinkedInCallbackCode);
  }

  const stateCheck = await consumeState(c.env, state);
  if (!stateCheck.ok) {
    console.warn('[LINKEDIN] callback state rejected:', stateCheck.reason);
    return redirectBack(c.env, 'error', returnTo, 'state_invalid' satisfies LinkedInCallbackCode);
  }
  const userId = stateCheck.userId;

  // Exchange code for an access_token. Body is form-encoded per OAuth 2 spec.
  let accessToken = '';
  try {
    const tokenRes = await fetch(LINKEDIN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: linkedinRedirectUri(c.env),
        client_id: creds.id,
        client_secret: creds.secret,
      }).toString(),
    });
    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => '');
      console.error('[LINKEDIN] token exchange failed:', tokenRes.status, txt.slice(0, 300));
      return redirectBack(c.env, 'error', returnTo, 'token_unavailable' satisfies LinkedInCallbackCode);
    }
    const tokenJson: any = await tokenRes.json();
    accessToken = String(tokenJson?.access_token || '');
    if (!accessToken) return redirectBack(c.env, 'error', returnTo, 'token_unavailable' satisfies LinkedInCallbackCode);
  } catch (e: any) {
    console.error('[LINKEDIN] token exchange threw:', e?.message || e);
    return redirectBack(c.env, 'error', returnTo, 'token_unavailable' satisfies LinkedInCallbackCode);
  }

  // Fetch verified identity. /v2/userinfo (OIDC) returns { sub, email, name, ... }
  let sub = '', email = '', name = '';
  try {
    const uiRes = await fetch(LINKEDIN_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!uiRes.ok) {
      const txt = await uiRes.text().catch(() => '');
      console.error('[LINKEDIN] userinfo failed:', uiRes.status, txt.slice(0, 300));
      return redirectBack(c.env, 'error', returnTo, 'identity_unavailable' satisfies LinkedInCallbackCode);
    }
    const ui: any = await uiRes.json();
    sub = String(ui?.sub || '');
    email = String(ui?.email || '');
    name = String(ui?.name || [ui?.given_name, ui?.family_name].filter(Boolean).join(' ') || '');
    if (!sub) return redirectBack(c.env, 'error', returnTo, 'identity_unavailable' satisfies LinkedInCallbackCode);
  } catch (e: any) {
    console.error('[LINKEDIN] userinfo threw:', e?.message || e);
    return redirectBack(c.env, 'error', returnTo, 'identity_unavailable' satisfies LinkedInCallbackCode);
  } finally {
    // Discard the token — we never persist it.
    accessToken = '';
  }

  // Attach to the user row.
  try {
    await ensureColumns(c.env);
    const sql = getSQL(c.env);
    const nowIso = new Date().toISOString();
    await sql`UPDATE users
              SET linkedin_sub = ${sub},
                  linkedin_email = ${email || null},
                  linkedin_name = ${name || null},
                  linkedin_connected_at = ${nowIso}
              WHERE id = ${userId}`;
    await sql`INSERT INTO activity_logs (action, details, actor, user_id)
              VALUES ('linkedin_connected',
                      ${`User #${userId} linked LinkedIn identity sub=${sub}`},
                      ${email || `user_${userId}`},
                      ${userId})`;
    await sql.end();
  } catch (e: any) {
    console.error('[LINKEDIN] persist failed:', e?.message || e);
    return redirectBack(c.env, 'error', returnTo, 'save_failed' satisfies LinkedInCallbackCode);
  }

  return redirectBack(c.env, 'connected', returnTo);
});

// ---------------------------------------------------------------------------
// POST /api/linkedin/disconnect — clears LinkedIn fields on the current user.
// ---------------------------------------------------------------------------
linkedin.post('/disconnect', async (c) => {
  const user = await requireAuth(c);
  try {
    await ensureColumns(c.env);
    const sql = getSQL(c.env);
    await sql`UPDATE users
              SET linkedin_sub = NULL, linkedin_email = NULL, linkedin_name = NULL, linkedin_connected_at = NULL
              WHERE id = ${user.id}`;
    await sql`INSERT INTO activity_logs (action, details, actor, user_id)
              VALUES ('linkedin_disconnected', ${`User #${user.id} disconnected LinkedIn`}, ${user.email}, ${user.id})`;
    await sql.end();
    return c.json({ ok: true });
  } catch (e: any) {
    console.error('[LINKEDIN] disconnect failed:', e?.message || e);
    return c.json({
      detail: "Couldn't disconnect LinkedIn right now — please try again in a few minutes.",
    }, 503);
  }
});

// ---------------------------------------------------------------------------
// GET /api/linkedin/status — small helper the UI calls on mount to show
// whether the current user has a connected LinkedIn identity. Also reports
// whether the worker is configured for OAuth at all so the UI can hide the
// "Sign in with LinkedIn" tab gracefully on dev/test deployments.
// ---------------------------------------------------------------------------
linkedin.get('/status', async (c) => {
  const user = await requireAuth(c);
  // If the DB/columns aren't reachable, degrade to a "not connected" payload
  // (with `configured` honestly reported) rather than 500-ing — the UI uses
  // this on every page load and a 500 here would noisily flash banners.
  try {
    await ensureColumns(c.env);
    const sql = getSQL(c.env);
    const rows = await sql`SELECT linkedin_sub, linkedin_email, linkedin_name, linkedin_connected_at
                           FROM users WHERE id = ${user.id}`;
    await sql.end();
    const r = rows[0] || {};
    return c.json({
      configured: !!(await loadLinkedinCreds(c.env)),
      connected: !!r.linkedin_sub,
      linkedin_email: r.linkedin_email || null,
      linkedin_name: r.linkedin_name || null,
      connected_at: r.linkedin_connected_at || null,
    });
  } catch (e: any) {
    console.error('[LINKEDIN] status failed:', e?.message || e);
    return c.json({
      configured: !!(await loadLinkedinCreds(c.env)),
      connected: false,
      linkedin_email: null,
      linkedin_name: null,
      connected_at: null,
    });
  }
});

export default linkedin;
