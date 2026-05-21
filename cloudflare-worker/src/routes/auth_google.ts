/**
 * Task #51 — "Continue with Google" sign-in / sign-up / link.
 *
 * Optional OAuth path that sits ALONGSIDE the existing magic-link (A) and
 * TOTP (C) auth surfaces. It is NEVER the only way in: every account can
 * fall back to magic-link + TOTP. Google identity counts as ONE factor for
 * step-up purposes — sensitive routes still demand TOTP/passkey/SMS via
 * requireFactor(). See replit.md "Persistent gotchas → Backend / Worker".
 *
 * Endpoints (mounted at /api/auth/google in index.ts):
 *
 *   GET  /start              kicks off OAuth. Accepts ?action=signin|link
 *                            and ?redirect=<absolute-path-on-app.axal.vc>.
 *                            Generates an HMAC-signed state cookie + URL
 *                            so the callback can't be replayed.
 *
 *   GET  /callback           Google redirects here with ?code & ?state.
 *                            Exchanges code → id_token, lookups by
 *                            google_sub (preferred) then email, applies
 *                            the linking precedence rules below, mints a
 *                            session, and 302s back to the SPA.
 *
 * Linking precedence (deterministic — every branch is unit-tested by the
 * route-level Vitest in cloudflare-worker/test/auth_google.test.ts):
 *
 *   1.  Row found via google_sub          → sign in (no merge needed).
 *   2.  Row found via case-insensitive
 *       email AND email_verified=true     → link (UPDATE google_sub),
 *                                            sign in. NEVER creates a
 *                                            second silo row.
 *   3.  Row found via email AND
 *       email_verified=false              → REFUSE. Returns
 *                                            link_blocked_unverified.
 *                                            Operator policy: the user
 *                                            must first complete the
 *                                            magic-link round-trip so
 *                                            we can prove ownership of
 *                                            the email before binding a
 *                                            Google identity to it.
 *                                            Otherwise an attacker who
 *                                            controls a Google account
 *                                            could squat on any
 *                                            half-finished signup row
 *                                            keyed by the same email.
 *   4.  No row                            → fresh signup. email_verified
 *                                            is set to TRUE (Google
 *                                            already verified it), role
 *                                            defaults to 'partner' to
 *                                            match /register's default.
 *                                            User lands on the standard
 *                                            onboarding chatbot.
 *
 *   Linking from an authenticated session (action=link) follows a
 *   parallel set of rules:
 *
 *   L1. Caller's user row already has
 *       google_sub set                    → 409 already_linked.
 *   L2. The returned google_sub is
 *       attached to a DIFFERENT user      → 409 sub_owned_by_other. We
 *                                            refuse to silently steal
 *                                            the link from a sibling
 *                                            account — the user must
 *                                            unlink there first.
 *   L3. Email on the Google id_token
 *       differs from the caller's
 *       email_verified=true address       → ACCEPT. Linking by sub, not
 *                                            by email; the email
 *                                            mismatch is intentional
 *                                            (work vs personal Google
 *                                            account, etc.). We log it
 *                                            to activity_logs so an
 *                                            admin can investigate
 *                                            suspicious patterns.
 *   L4. Caller's email is unverified      → REFUSE. Mirrors rule (3) —
 *                                            we never link to a row
 *                                            whose email isn't proven.
 *
 * Unlink lives in routes/settings.ts at POST /connected-accounts/google/unlink
 * with a no-orphan guard (must keep ≥1 sign-in path: TOTP enrolled OR
 * verified email + recovery codes).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import {
  createJWT,
  getCurrentUser,
  setAuthCookies,
  generateCsrfToken,
} from '../auth';
import { hashEmail } from '../util/hashEmail';

const authGoogle = new Hono<{ Bindings: Env }>();

// ----- helpers --------------------------------------------------------------

function appUrl(env: Env): string {
  return (env.PUBLIC_BASE_URL || env.APP_URL || 'https://app.axal.vc').replace(/\/$/, '');
}

function redirectUri(env: Env): string {
  return `${appUrl(env)}/api/auth/google/callback`;
}

function hmacKey(env: Env): string {
  // Reuse JWT_SECRET as the HMAC key for the state token. The state is a
  // 10-min nonce; a JWT_SECRET leak already implies full session compromise.
  return env.JWT_SECRET || '';
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const norm = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return b64urlEncode(new Uint8Array(sig));
}

interface StatePayload {
  n: string;          // random nonce
  ts: number;         // seconds since epoch
  action: 'signin' | 'link';
  uid?: number;       // present for action=link
  redirect: string;   // absolute path inside app.axal.vc (no host)
}

async function signState(env: Env, payload: StatePayload): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSha256(hmacKey(env), body);
  return `${body}.${sig}`;
}

async function verifyState(env: Env, token: string): Promise<StatePayload | null> {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacSha256(hmacKey(env), body);
  // Constant-time compare via length-equal char accumulation.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  let parsed: StatePayload;
  try {
    parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as StatePayload;
  } catch {
    return null;
  }
  const ageSec = Math.floor(Date.now() / 1000) - (parsed.ts || 0);
  if (ageSec < 0 || ageSec > 600) return null; // 10-minute window
  if (parsed.action !== 'signin' && parsed.action !== 'link') return null;
  return parsed;
}

// ----- pure linking-decision helper (unit-tested) ---------------------------
//
// Encapsulates the precedence rules documented at the top of this file so
// they can be exercised without standing up a real D1/Postgres harness.
// Returns the outcome + reason; the caller (the route handler) is
// responsible for executing the SQL writes.
export type SigninDecision =
  | { kind: 'signin_existing'; userId: number }                     // rule 1
  | { kind: 'link_then_signin'; userId: number }                    // rule 2
  | { kind: 'refuse_unverified_email' }                             // rule 3
  | { kind: 'fresh_signup' };                                       // rule 4

export interface SigninLookupRow {
  id: number;
  email_verified: 0 | 1 | boolean;
}

export function decideSigninAction(
  bySub: SigninLookupRow | null | undefined,
  byEmail: SigninLookupRow | null | undefined,
): SigninDecision {
  if (bySub) return { kind: 'signin_existing', userId: bySub.id };
  if (byEmail) {
    if (byEmail.email_verified) return { kind: 'link_then_signin', userId: byEmail.id };
    return { kind: 'refuse_unverified_email' };
  }
  return { kind: 'fresh_signup' };
}

export type LinkDecision =
  | { kind: 'link_ok' }
  | { kind: 'refuse'; code: 'already_linked' | 'sub_owned_by_other' | 'caller_email_unverified' };

export function decideLinkAction(opts: {
  callerHasSub: boolean;
  callerEmailVerified: boolean;
  subAlreadyOwnedByOtherUser: boolean;
}): LinkDecision {
  if (opts.callerHasSub) return { kind: 'refuse', code: 'already_linked' };
  if (!opts.callerEmailVerified) return { kind: 'refuse', code: 'caller_email_unverified' };
  if (opts.subAlreadyOwnedByOtherUser) return { kind: 'refuse', code: 'sub_owned_by_other' };
  return { kind: 'link_ok' };
}

// State sign/verify is exported for unit tests; consumers in the route
// continue to use the un-exported wrappers below.
/**
 * Pure no-orphan unlink decision (extracted for unit-testing).
 *
 * A Google unlink is only safe when the user has at least one OTHER
 * working sign-in path. In this codebase that means TOTP (the canonical
 * /api/auth/login route) or SMS (/api/auth/sms/*). Verified email alone
 * is NOT a standalone sign-in path — the email-verification token only
 * unlocks the TOTP setup step. Returning `true` here when only
 * email_verified is set would silently lock Google-only users out.
 */
export function decideUnlinkAllowed(opts: {
  totpConfigured: boolean;
  smsConfigured: boolean;
}): { allowed: boolean; reason: 'last_sign_in_path' | null } {
  const allowed = !!(opts.totpConfigured || opts.smsConfigured);
  return { allowed, reason: allowed ? null : 'last_sign_in_path' };
}

export const __testing = { signState, verifyState };

function sanitizeRedirect(raw: unknown): string {
  // Only allow absolute paths on app.axal.vc; never a full URL (open-redirect
  // class bug). Default to /dashboard.
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  if (raw.length > 200) return '/dashboard';
  // Strip control chars.
  if (/[\u0000-\u001f]/.test(raw)) return '/dashboard';
  return raw;
}

function configMissing(env: Env): boolean {
  return !env.GOOGLE_AUTH_CLIENT_ID || !env.GOOGLE_AUTH_CLIENT_SECRET;
}

// ----- /start ---------------------------------------------------------------

authGoogle.get('/start', async (c) => {
  if (configMissing(c.env)) {
    return c.json({ error: 'Google sign-in is not configured on this environment.' }, 503);
  }
  const action = c.req.query('action') === 'link' ? 'link' : 'signin';
  const redirect = sanitizeRedirect(c.req.query('redirect') || '/dashboard');

  let uid: number | undefined;
  if (action === 'link') {
    const user = await getCurrentUser(c);
    if (!user) return c.json({ error: 'Sign in first to link a Google account.' }, 401);
    uid = user.id;
  }

  // Session-bind the OAuth state to defeat login-CSRF / state-replay.
  // We mint a random nonce, embed it in the signed state JWT, AND set
  // the same nonce in an httpOnly Secure same-site=Lax cookie. The
  // /callback handler refuses any state whose `n` doesn't match the
  // cookie, so an attacker who phishes a {code,state} pair cannot
  // bounce the victim's browser through /callback to mint a session
  // bound to the attacker's Google account (or vice-versa).
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = b64urlEncode(nonceBytes);
  const state = await signState(c.env, {
    n: nonce,
    ts: Math.floor(Date.now() / 1000),
    action,
    uid,
    redirect,
  });
  c.header(
    'Set-Cookie',
    `studioos_google_state=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google; Max-Age=600`,
    { append: true },
  );

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_AUTH_CLIENT_ID!,
    redirect_uri: redirectUri(c.env),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
    include_granted_scopes: 'true',
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  // Some callers (the SPA buttons) will fetch this endpoint and follow the
  // redirect themselves; others (anchor tag) navigate directly. We return a
  // 302 either way and ALSO surface the URL in JSON when the Accept header
  // asks for it, so the SPA can use window.location.href without depending
  // on fetch following redirects across origins.
  const accept = c.req.header('accept') || '';
  if (accept.includes('application/json')) {
    return c.json({ url });
  }
  return c.redirect(url, 302);
});

// ----- /callback ------------------------------------------------------------

interface IdTokenPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  aud?: string;
  iss?: string;
}

/**
 * Decode the id_token payload WITHOUT verifying the signature locally.
 * Safe here because we just received the token over TLS from Google's
 * `/token` endpoint in direct response to our code-exchange POST — Google
 * has already validated everything. (This is the pattern documented in
 * Google's "Server flow" docs; full JWKS verification is only required
 * when the id_token arrives via an untrusted channel.)
 *
 * We still defence-in-depth check `aud === GOOGLE_AUTH_CLIENT_ID` and
 * `iss` ∈ {accounts.google.com, https://accounts.google.com}.
 */
function decodeIdToken(idToken: string): IdTokenPayload | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = new TextDecoder().decode(b64urlDecode(parts[1]));
    return JSON.parse(json) as IdTokenPayload;
  } catch {
    return null;
  }
}

async function exchangeCode(env: Env, code: string): Promise<IdTokenPayload | null> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_AUTH_CLIENT_ID!,
    client_secret: env.GOOGLE_AUTH_CLIENT_SECRET!,
    redirect_uri: redirectUri(env),
    grant_type: 'authorization_code',
  });
  let resp: Response;
  try {
    resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (e) {
    console.error('[auth_google] token endpoint fetch failed', e);
    return null;
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.warn('[auth_google] token exchange failed', resp.status, txt.slice(0, 200));
    return null;
  }
  const data = await resp.json().catch(() => null) as { id_token?: string } | null;
  if (!data?.id_token) return null;
  const payload = decodeIdToken(data.id_token);
  if (!payload) return null;
  if (payload.aud !== env.GOOGLE_AUTH_CLIENT_ID) {
    console.warn('[auth_google] aud mismatch', payload.aud);
    return null;
  }
  const okIss = payload.iss === 'accounts.google.com' || payload.iss === 'https://accounts.google.com';
  if (!okIss) {
    console.warn('[auth_google] iss mismatch', payload.iss);
    return null;
  }
  if (!payload.sub) return null;
  return payload;
}

// Land the user on a small SPA route with a one-shot toast hint when the
// callback can't sign them in. We never echo raw provider errors to the
// query string because they could carry attacker-controlled text.
function callbackError(env: Env, code: string, action: 'signin' | 'link'): Response {
  const path = action === 'link' ? '/settings/security' : '/login';
  const url = `${appUrl(env)}${path}?google_error=${encodeURIComponent(code)}`;
  return Response.redirect(url, 302);
}

authGoogle.get('/callback', async (c) => {
  if (configMissing(c.env)) {
    return callbackError(c.env, 'not_configured', 'signin');
  }
  const code = c.req.query('code');
  const stateRaw = c.req.query('state');
  const providerError = c.req.query('error');
  if (providerError) {
    // User clicked "Cancel" on the Google consent screen.
    const action = (await peekStateAction(c.env, stateRaw || '')) || 'signin';
    return callbackError(c.env, providerError === 'access_denied' ? 'cancelled' : 'provider_error', action);
  }
  if (!code || !stateRaw) return callbackError(c.env, 'missing_code', 'signin');

  const state = await verifyState(c.env, stateRaw);
  if (!state) return callbackError(c.env, 'bad_state', 'signin');

  // Session-bind check: the nonce inside the HMAC'd state MUST equal the
  // value of the studioos_google_state cookie set by /start. This binds
  // the OAuth handshake to a single browser/session and defeats
  // login-CSRF (attacker injecting their own {code,state} into the
  // victim's browser) and state-replay across sessions.
  const cookieHeader = c.req.header('cookie') || '';
  const m = cookieHeader.match(/(?:^|;\s*)studioos_google_state=([^;]+)/);
  const cookieNonce = m ? m[1] : '';
  if (!cookieNonce || cookieNonce !== state.n) {
    return callbackError(c.env, 'bad_state', state.action);
  }
  // One-shot: clear the binding cookie so the same {code,state} pair
  // cannot be replayed even if it leaks (Google's code is already
  // single-use, but defence-in-depth).
  c.header(
    'Set-Cookie',
    'studioos_google_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google; Max-Age=0',
    { append: true },
  );

  const idt = await exchangeCode(c.env, code);
  if (!idt) return callbackError(c.env, 'exchange_failed', state.action);

  const sub = idt.sub;
  const googleEmail = (idt.email || '').toLowerCase();
  const googleEmailVerified = !!idt.email_verified;
  if (!googleEmail || !googleEmailVerified) {
    // Google should never return an unverified primary email for an
    // authenticated user, but defence-in-depth: refuse.
    return callbackError(c.env, 'email_unverified_at_google', state.action);
  }

  const sql = getSQL(c.env);
  try {
    if (state.action === 'link') {
      const uid = state.uid;
      if (!uid) return callbackError(c.env, 'missing_uid', 'link');
      const me = await sql`SELECT id, email, email_verified FROM users WHERE id = ${uid}` as any[];
      if (!me.length) return callbackError(c.env, 'user_gone', 'link');
      const meRow = me[0];
      const meLink = await sql`SELECT google_sub FROM user_google_links WHERE user_id = ${uid}` as any[];
      if (meLink.length) {
        // L1
        return callbackError(c.env, 'already_linked', 'link');
      }
      if (!meRow.email_verified) {
        // L4 — never link to an unverified email row.
        return callbackError(c.env, 'caller_email_unverified', 'link');
      }
      const conflict = await sql`SELECT user_id FROM user_google_links WHERE google_sub = ${sub} AND user_id <> ${uid}` as any[];
      if (conflict.length) {
        // L2
        return callbackError(c.env, 'sub_owned_by_other', 'link');
      }
      // INSERT OR IGNORE: defends against double-click on the Link button —
      // a second concurrent request would otherwise 500 on the UNIQUE
      // constraint on (user_id) or (google_sub) and surface as
      // `internal_error` to the user. The L1/L2 guards above already
      // ensure the no-op is the correct outcome here.
      await sql`INSERT OR IGNORE INTO user_google_links (user_id, google_sub) VALUES (${uid}, ${sub})`;
      const eh = await hashEmail(meRow.email);
      const mismatch = googleEmail !== (meRow.email || '').toLowerCase();
      await sql`INSERT INTO activity_logs (action, details, actor, user_id)
                VALUES ('google_account_linked',
                        ${`linked google_sub (email_mismatch=${mismatch})`},
                        ${eh}, ${uid})`;
      // No new session minted — the caller already had one. Just redirect
      // back to Settings → Security with a success flag.
      const url = `${appUrl(c.env)}${sanitizeRedirect(state.redirect)}?google_linked=1`;
      return Response.redirect(url, 302);
    }

    // --- action === 'signin' ---------------------------------------------
    // 1) lookup by google_sub via side-table join
    let users = await sql`
      SELECT u.* FROM users u
      INNER JOIN user_google_links l ON l.user_id = u.id
      WHERE l.google_sub = ${sub} LIMIT 1` as any[];
    let user = users[0] as any | undefined;
    let newSignup = false;

    if (!user) {
      // 2/3) lookup by case-insensitive email
      const byEmail = await sql`SELECT * FROM users WHERE LOWER(email) = ${googleEmail} LIMIT 1` as any[];
      if (byEmail.length) {
        const existing = byEmail[0];
        if (!existing.email_verified) {
          // Rule 3 — block. Operator MUST complete magic-link round-trip
          // first to prove email ownership.
          return callbackError(c.env, 'link_blocked_unverified', 'signin');
        }
        // Rule 2 — link verified row. INSERT OR IGNORE so a double-click
        // race (two concurrent sign-in callbacks for the same verified
        // email) cannot 500 on the UNIQUE constraint; the second insert
        // becomes a no-op and the existing link is reused.
        await sql`INSERT OR IGNORE INTO user_google_links (user_id, google_sub) VALUES (${existing.id}, ${sub})`;
        const eh = await hashEmail(existing.email);
        await sql`INSERT INTO activity_logs (action, details, actor, user_id)
                  VALUES ('google_account_auto_linked',
                          'first-time Google sign-in matched verified email',
                          ${eh}, ${existing.id})`;
        user = { ...existing };
      } else {
        // Rule 4 — fresh signup. Google already verified the email.
        const name = (idt.name || googleEmail.split('@')[0] || 'New user').slice(0, 200);
        // Fresh Google signups land with role='partner' — the lowest-trust
        // CHECK-compliant default (users.role has a CHECK constraint that
        // only permits admin/founder/partner/investor, see sql/schema.sql).
        // The post-callback redirect still routes newSignup users to
        // /onboarding/chat so the Workers AI Llama chatbot can capture a
        // persona into partner_profiles for admin review. Admin assigns
        // the final role manually from the profiling review queue.
        const inserted = await sql`
          INSERT INTO users (email, name, role, email_verified)
          VALUES (${googleEmail}, ${name}, 'partner', true)
          RETURNING *` as any[];
        user = inserted[0];
        // INSERT OR IGNORE defends against the rare case where a second
        // concurrent fresh-signup request for the same google_sub raced
        // us between the email-lookup miss and here. The new users row
        // is already orphaned in that race; we accept the leak rather
        // than 500 the surviving caller. (Belt-and-braces — the email
        // UNIQUE constraint on users would also have rejected one of
        // the two INSERTs further upstream in most cases.)
        await sql`INSERT OR IGNORE INTO user_google_links (user_id, google_sub) VALUES (${user.id}, ${sub})`;
        newSignup = true;
        const eh = await hashEmail(user.email);
        await sql`INSERT INTO activity_logs (action, details, actor, user_id)
                  VALUES ('user_registered_google',
                          ${`Google sign-up (email_hash=${eh})`},
                          ${eh}, ${user.id})`;
        // Best-effort downstream seeding (mirrors POST /register).
        try {
          const { seedObligations } = await import('../services/trust');
          await seedObligations(c.env, user.id, user.role || 'partner');
        } catch (e) { console.error('[auth_google] trust seed failed', e); }
        try {
          const { Jobs } = await import('../models/jobs');
          await Jobs.enqueue(c.env, 'embed_entity', { type: 'partner', id: user.id });
        } catch {}
      }
    }

    if (!user.is_active && user.is_active !== undefined && user.is_active !== null && Number(user.is_active) === 0) {
      return callbackError(c.env, 'account_inactive', 'signin');
    }

    // Mint a session. factor='google' so requireFactor('totp') still gates
    // sensitive routes — Google is ONE factor, never a TOTP substitute.
    const jti = crypto.randomUUID();
    const token = await createJWT(c.env, user.id, user.email, user.role, undefined, jti);
    const ua = (c.req.header('user-agent') || '').slice(0, 500);
    const ip = (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64);
    try {
      await sql`INSERT INTO user_sessions (user_id, jti, user_agent, ip, factor)
                VALUES (${user.id}, ${jti}, ${ua || null}, ${ip || null}, 'google')`;
    } catch (e) { console.error('[auth_google] session insert failed', e); }

    const eh = await hashEmail(user.email);
    const actionLabel = newSignup ? 'user_login_google_signup' : 'user_login_google';
    await sql`INSERT INTO activity_logs (action, details, actor, user_id)
              VALUES (${actionLabel}, 'sign-in via Google', ${eh}, ${user.id})`;

    const csrf = generateCsrfToken();
    setAuthCookies(c, token, csrf);

    // Fresh Google signups land on the onboarding chatbot (Workers AI
    // Llama 3.1 8B via /api/profiling/chat) which classifies persona and
    // saves a partner_profiles row for admin review. Existing users honour
    // the sanitized redirect target the caller passed to /start.
    const landing = newSignup ? '/onboarding/chat' : sanitizeRedirect(state.redirect);
    const url = `${appUrl(c.env)}${landing}${landing.includes('?') ? '&' : '?'}google=ok${newSignup ? '&google_signup=1' : ''}`;
    return c.redirect(url, 302);
  } catch (e: any) {
    console.error('[auth_google] callback error', e?.message || e, e?.stack);
    return callbackError(c.env, 'internal_error', state.action);
  } finally {
    try { await sql.end(); } catch {}
  }
});

// Peek the action out of an opaque state token WITHOUT requiring a fresh
// signature check — used only for routing error redirects when the user
// hits Cancel on Google's consent screen. If verification fails we
// default to 'signin' which is harmless.
async function peekStateAction(env: Env, raw: string): Promise<'signin' | 'link' | null> {
  if (!raw) return null;
  const p = await verifyState(env, raw);
  return p?.action || null;
}

export default authGoogle;
