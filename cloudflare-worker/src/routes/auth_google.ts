/**
 * Task #51 — "Continue with Google" sign-in / sign-up / link.
 *
 * Optional OAuth path that sits ALONGSIDE the existing magic-link (A) and
 * TOTP (C) auth surfaces. It is NEVER the only way in: every account can
 * fall back to magic-link + TOTP. Google identity counts as ONE factor for
 * step-up purposes — sensitive routes still demand TOTP/passkey/SMS via
 * requireFactor(). See documentation/architecture/GOTCHAS.md "Backend / Worker".
 *
 * Endpoints (mounted at /api/auth/google in index.ts):
 *
 *   GET  /config             D722. Whether /login may open Google's own
 *                            window: {configured, popup, client_id}. A pure
 *                            read of env — no D1, no KV, no cookie, no
 *                            session — and rate-limit exempt, so asking it
 *                            can never be what breaks the page.
 *
 *   POST /popup              D722. Google's window (the GIS code client)
 *                            hands the page an authorization code; the page
 *                            posts it here with the attempt's state. The
 *                            code is exchanged with redirect_uri
 *                            'postmessage', the id_token is checked against
 *                            Google's keys (services/googleIdToken.ts), the
 *                            same rules below decide the account, and the
 *                            answer is {token, user} as passkey's is. Popup
 *                            first, redirect fallback: every click the popup
 *                            cannot take goes through /start.
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
 * /popup and /callback decide the account through ONE helper,
 * `resolveGoogleSignin`, and mint the session through ONE helper,
 * `mintGoogleSession`, so the two ways in cannot drift apart.
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
 *                                            'exploring', exactly as the
 *                                            email link creates one.
 *                                            User lands on the standard
 *                                            onboarding chatbot.
 *
 *   A matched row with is_active = 0 is refused BEFORE anything is linked
 *   (account_inactive). /popup adds one more refusal: when the person typed
 *   an email and Google signed in a different one that no matched row
 *   carries, it answers different_account and writes nothing — the chooser
 *   mistake that would otherwise open a second application.
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
import type { Context } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import {
  createJWT,
  getCurrentUser,
  setAuthCookies,
  generateCsrfToken,
  authCookieDomainAttr,
  revokeStaleCrossIdentitySession,
} from '../auth';
import { hashEmail } from '../util/hashEmail';
// Task #9 follow-up — fresh Google signups land in 'exploring' too, same
// as /register and magic-link. See exploringSchema.ts.
import { ensureExploringSchema } from '../services/exploringSchema';
import { withDeadline } from '../util/deadline';
import { verifyGoogleIdToken } from '../services/googleIdToken';
import { recordSecurityEvent } from '../services/securityEvents';
import { isProductionEnv } from '../util/paymentMode';

// A KV round trip that has not answered in this long is treated as a miss: the
// cookie fallback covers the put, and a missing bind nonce is already a
// 'bad_state', which is the honest answer when we cannot verify the binding.
const STATE_KV_DEADLINE_MS = 2_000;
// Google's token endpoint gets ten seconds. The catch below already returns
// null on a network failure; without a signal a hung connection never reaches
// it, and the user waits on a redirect that will not come.
const TOKEN_FETCH_TIMEOUT_MS = 10_000;

const authGoogle = new Hono<{ Bindings: Env }>();

// ----- helpers --------------------------------------------------------------

function appUrl(env: Env): string {
  return (env.PUBLIC_BASE_URL || env.APP_URL || 'https://axal.vc').replace(/\/$/, '');
}

// Google OAuth redirect URIs are registered in Google Cloud Console against
// the app.axal.vc host. Keep the callback on that host even after the
// canonical URL flip to axal.vc — the post-callback redirect (handled by
// appUrl() above) is what bounces the user back to axal.vc/dashboard.
function oauthCallbackHost(env: Env): string {
  return (env.OAUTH_CALLBACK_BASE_URL || 'https://app.axal.vc').replace(/\/$/, '');
}

function redirectUri(env: Env): string {
  return `${oauthCallbackHost(env)}/api/auth/google/callback`;
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
  // The signup lane ('founder' | 'partner' | 'investor'), carried through the
  // handshake so a fresh Google account records the same suggested role the
  // classic/magic-link path already does. Safe to round-trip here: the state is
  // HMAC-signed, so a tampered lane fails verification. It is only ever a
  // SUGGESTION for the admin queue — never applied to users.role.
  lane?: string;
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
  // Whitelisted, not passed through: an unrecognised lane is dropped rather
  // than stored, so the admin queue can never show an invented persona.
  const laneRaw = (c.req.query('lane') || '').trim().toLowerCase();
  const lane = ['founder', 'partner', 'investor'].includes(laneRaw) ? laneRaw : undefined;
  const state = await signState(c.env, {
    n: nonce,
    ts: Math.floor(Date.now() / 1000),
    action,
    uid,
    redirect,
    lane,
  });
  // Bind the nonce to this OAuth handshake via KV (keyed by the state's
  // own HMAC signature) AND via cookie for defence-in-depth. The KV
  // record is the source of truth — mobile in-app browsers (Instagram,
  // LinkedIn, etc.) commonly drop the third-party-cookie context across
  // the Google round-trip, which used to surface as 'bad_state'.
  const stateSig = state.slice(state.indexOf('.') + 1);
  // Bounded, and the catch below is why that matters: a KV that never answers
  // would hold up the redirect to Google for the life of the request, which is
  // what made /login stop offering the button at all — LoginPage probed this
  // very endpoint on mount and hid the control when the probe did not
  // resolve (until D185). The cookie written just below is the fallback, so a
  // skipped put degrades desktop-only rather than failing the handshake.
  try {
    await withDeadline(
      c.env.TOKENS.put(`gstate:${stateSig}`, nonce, { expirationTtl: 600 }),
      STATE_KV_DEADLINE_MS, 'gstate-put',
    );
  } catch (e) { console.error('[auth_google] state KV put failed', e); }
  // D722 — the cookie carries the session cookie's Domain. /start answers on
  // the host the SPA runs on (axal.vc) while Google sends the person back to
  // the registered callback host (app.axal.vc); a host-only cookie set here
  // never reached /callback, so the fallback this comment promises never
  // existed on HQ and a KV miss was always "Sign-in link expired". On HQ the
  // Domain is `.axal.vc`; a branch, localhost and preview stay host-only,
  // exactly as `setAuthCookies` decides for the session itself.
  c.header(
    'Set-Cookie',
    `studioos_google_state=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google${authCookieDomainAttr(c)}; Max-Age=600`,
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

/**
 * POST an authorization code to Google's token endpoint and return the raw
 * id_token, or null. `redirectUriValue` is the registered callback URI for a
 * code from the redirect flow, and the literal 'postmessage' for a code from
 * the GIS popup — Google's documented value for that case, which needs no
 * registration. A code is single-use either way.
 */
async function fetchIdToken(env: Env, code: string, redirectUriValue: string): Promise<string | null> {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_AUTH_CLIENT_ID!,
    client_secret: env.GOOGLE_AUTH_CLIENT_SECRET!,
    redirect_uri: redirectUriValue,
    grant_type: 'authorization_code',
  });
  let resp: Response;
  try {
    resp = await fetch('https://oauth2.googleapis.com/token', {
      signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
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
  return typeof data?.id_token === 'string' && data.id_token ? data.id_token : null;
}

async function exchangeCode(env: Env, code: string): Promise<IdTokenPayload | null> {
  const idToken = await fetchIdToken(env, code, redirectUri(env));
  if (!idToken) return null;
  const payload = decodeIdToken(idToken);
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
  const path = action === 'link' ? '/account/security' : '/login';
  const url = `${appUrl(env)}${path}?google_error=${encodeURIComponent(code)}`;
  return Response.redirect(url, 302);
}

// ----- the account and the session (shared by /callback and /popup) -------

type GoogleCtx = Context<{ Bindings: Env }>;
type Sql = ReturnType<typeof getSQL>;

export type GoogleSigninRefusal = 'link_blocked_unverified' | 'account_inactive' | 'different_account';

type GoogleSigninResult =
  | { ok: true; user: any; newSignup: boolean }
  | { ok: false; code: GoogleSigninRefusal; userId?: number };

/**
 * Decide which account a verified Google identity signs in to, through
 * `decideSigninAction` (rules 1–4 above). `identity.email` is lower-cased by
 * the caller. EVERY REFUSAL IS DECIDED BEFORE ANYTHING IS WRITTEN: no link
 * row, no user row, no log line exists for an attempt this answers with a
 * refusal.
 *
 * `expectedEmail` is the address the person typed on /login, when they typed
 * one. If Google signed in somebody else — an address that is neither the
 * Google account's nor the matched account's — the answer is
 * `different_account` and nothing is created: picking the wrong row in
 * Google's chooser must not open a second application.
 */
async function resolveGoogleSignin(
  c: GoogleCtx,
  sql: Sql,
  identity: { sub: string; email: string; name?: string | null },
  opts: { lane?: string; expectedEmail?: string } = {},
): Promise<GoogleSigninResult> {
  const { sub, email: googleEmail } = identity;
  // 1) lookup by google_sub via side-table join
  const bySub = (await sql`
    SELECT u.* FROM users u
    INNER JOIN user_google_links l ON l.user_id = u.id
    WHERE l.google_sub = ${sub} LIMIT 1` as any[])[0] as any | undefined;
  // 2/3) lookup by case-insensitive email, only when the sub is unknown
  const byEmail = bySub
    ? undefined
    : (await sql`SELECT * FROM users WHERE LOWER(email) = ${googleEmail} LIMIT 1` as any[])[0] as any | undefined;
  const decision = decideSigninAction(bySub, byEmail);
  const matched = bySub || byEmail;

  const expected = String(opts.expectedEmail || '').trim().toLowerCase();
  if (expected && expected !== googleEmail && expected !== String(matched?.email || '').toLowerCase()) {
    return { ok: false, code: 'different_account' };
  }
  // A suspended account is refused before it is linked — /callback used to
  // link it first and refuse after.
  if (matched && Number(matched.is_active ?? 1) === 0) {
    return { ok: false, code: 'account_inactive', userId: Number(matched.id) };
  }
  if (decision.kind === 'refuse_unverified_email') {
    // Rule 3 — block. Operator MUST complete magic-link round-trip first to
    // prove email ownership.
    return { ok: false, code: 'link_blocked_unverified', userId: Number(byEmail.id) };
  }
  if (decision.kind === 'signin_existing') return { ok: true, user: bySub, newSignup: false };

  if (decision.kind === 'link_then_signin') {
    // Rule 2 — link verified row. INSERT OR IGNORE so a double-click race (two
    // concurrent sign-ins for the same verified email) cannot 500 on the
    // UNIQUE constraint; the second insert becomes a no-op and the existing
    // link is reused.
    await sql`INSERT OR IGNORE INTO user_google_links (user_id, google_sub) VALUES (${byEmail.id}, ${sub})`;
    const eh = await hashEmail(byEmail.email);
    await sql`INSERT INTO activity_logs (action, details, actor, user_id)
              VALUES ('google_account_auto_linked',
                      'first-time Google sign-in matched verified email',
                      ${eh}, ${byEmail.id})`;
    return { ok: true, user: { ...byEmail }, newSignup: false };
  }

  // Rule 4 — fresh signup, exactly as /magic/verify creates an account (there
  // is no "account not found" here, as there is none there). Google already
  // verified the email.
  const name = (identity.name || googleEmail.split('@')[0] || 'New user').slice(0, 200);
  // Task #9 follow-up — fresh Google signups land directly in 'exploring'
  // (users.role CHECK relaxed by ensureExploringSchema), matching /register
  // and magic-link. The landing still routes newSignup users to onboarding so
  // the Workers AI chatbot can capture a persona into partner_profiles for
  // admin review; admin assigns the final role manually from the
  // exploring-users review queue (routes/admin_exploring.ts).
  await ensureExploringSchema(c.env);
  const inserted = await sql`
    INSERT INTO users (email, name, role, email_verified)
    VALUES (${googleEmail}, ${name}, 'exploring', true)
    RETURNING *` as any[];
  const user = inserted[0];
  // Parity with the classic path (routes/auth.ts:304): record the lane the
  // applicant picked as a SUGGESTION for the admin review queue. Best-effort:
  // a failure here must never break an otherwise-valid sign-in.
  if (opts.lane) {
    try {
      const { upsertSuggestedRole } = await import('../services/exploringSchema');
      await upsertSuggestedRole(c.env, (user as any).id, opts.lane);
    } catch (e) {
      console.error('[auth_google] suggested-role upsert failed:', (e as Error).message);
    }
  }
  // INSERT OR IGNORE defends against the rare case where a second concurrent
  // fresh-signup request for the same google_sub raced us between the
  // email-lookup miss and here. The new users row is already orphaned in that
  // race; we accept the leak rather than 500 the surviving caller.
  // (Belt-and-braces — the email UNIQUE constraint on users would also have
  // rejected one of the two INSERTs further upstream in most cases.)
  await sql`INSERT OR IGNORE INTO user_google_links (user_id, google_sub) VALUES (${user.id}, ${sub})`;
  // Task #66 — seed the onboarding-chatbot gate row. The frontend RequireAuth
  // guard pins this user to /onboarding/chat until the chatbot save flips
  // completed_at. INSERT OR IGNORE keeps a double-callback race a no-op.
  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO onboarding_progress (user_id, flow, step, total_steps, completed_at)
       VALUES (?, 'licence', 0, 0, NULL)`
    ).bind(user.id).run();
  } catch (e) { console.error('[auth_google] onboarding_progress seed failed', e); }
  const eh = await hashEmail(user.email);
  await sql`INSERT INTO activity_logs (action, details, actor, user_id)
            VALUES ('user_registered_google',
                    ${`Google sign-up (email_hash=${eh})`},
                    ${eh}, ${user.id})`;
  // Best-effort downstream seeding (mirrors POST /register and /magic/verify).
  try {
    const { seedObligations } = await import('../services/trust');
    await seedObligations(c.env, user.id, user.role || 'partner');
  } catch (e) { console.error('[auth_google] trust seed failed', e); }
  try {
    const { Jobs } = await import('../models/jobs');
    await Jobs.enqueue(c.env, 'embed_entity', { type: 'partner', id: user.id });
  } catch {}
  return { ok: true, user, newSignup: true };
}

/**
 * Mint the Google session: the same primitives in the same order as
 * /magic/verify (routes/auth.ts), which is the order every sign-in route
 * inlines — there is no shared mint function in the repo to call instead.
 *
 * factor='google' so requireFactor('totp') still gates sensitive routes —
 * Google is ONE factor, never a TOTP substitute. assurance_level and
 * step_up_due_at stay NULL, as they always were for a Google session, so
 * requireStepUp asks for a fresh TOTP and requireSuperAdminWriteBar refuses a
 * write until the person signs in with an authenticator code.
 */
async function mintGoogleSession(
  c: GoogleCtx,
  sql: Sql,
  user: any,
  newSignup: boolean,
): Promise<{ token: string; csrf: string }> {
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

  // Task #4 — kill any incoming stale cross-identity session before the new
  // cookie overwrites it. This is THE bug that caused the Google sign-in
  // account leak (a stale admin impersonation Bearer was still mounting an
  // active user_sessions row that would have remained replayable outside the
  // browser). The function never throws; the catch is belt-and-braces.
  try {
    await revokeStaleCrossIdentitySession(c, user.id);
  } catch (e) { console.warn('[auth_google] cross-session revoke failed', e); }

  const csrf = generateCsrfToken();
  // Domain `.axal.vc` on HQ, so the session holds on both hosts.
  setAuthCookies(c, token, csrf);
  return { token, csrf };
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
  // value stored in KV (or the cookie, for desktop browsers) at /start
  // time. This binds the OAuth handshake to a single browser/session and
  // defeats login-CSRF (attacker injecting their own {code,state} into
  // the victim's browser) and state-replay across sessions.
  //
  // KV is the primary source of truth because mobile in-app browsers
  // (Instagram, LinkedIn, etc.) frequently drop the third-party-cookie
  // context across the Google round-trip — using only the cookie would
  // surface as 'bad_state' for every such user.
  const stateSig = stateRaw.slice(stateRaw.indexOf('.') + 1);
  let bindNonce = '';
  try {
    bindNonce = (await withDeadline(
      c.env.TOKENS.get(`gstate:${stateSig}`), STATE_KV_DEADLINE_MS, 'gstate-get',
    )) || '';
  } catch (e) { console.error('[auth_google] state KV get failed', e); }
  if (!bindNonce) {
    // Cookie fallback for desktop browsers (KV write may have failed at /start).
    const cookieHeader = c.req.header('cookie') || '';
    const m = cookieHeader.match(/(?:^|;\s*)studioos_google_state=([^;]+)/);
    bindNonce = m ? m[1] : '';
  }
  if (!bindNonce || bindNonce !== state.n) {
    return callbackError(c.env, 'bad_state', state.action);
  }
  // One-shot: delete the KV record and clear the binding cookie so the
  // same {code,state} pair cannot be replayed even if it leaks (Google's
  // code is already single-use, but defence-in-depth).
  try {
    await withDeadline(c.env.TOKENS.delete(`gstate:${stateSig}`), STATE_KV_DEADLINE_MS, 'gstate-delete');
  } catch {}
  // Cleared with the Domain /start now sets (D722) and without it, so a
  // host-only cookie from a /start that ran before the change goes too.
  const stateDom = authCookieDomainAttr(c);
  c.header(
    'Set-Cookie',
    `studioos_google_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google${stateDom}; Max-Age=0`,
    { append: true },
  );
  if (stateDom) {
    c.header(
      'Set-Cookie',
      'studioos_google_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google; Max-Age=0',
      { append: true },
    );
  }

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
    // The account is decided and the session minted by the two helpers
    // /popup uses too (D722), so the redirect and the window cannot follow
    // different rules. Every refusal is decided before anything is written.
    const resolved = await resolveGoogleSignin(c, sql, { sub, email: googleEmail, name: idt.name }, { lane: state.lane });
    if (!resolved.ok) return callbackError(c.env, resolved.code, 'signin');
    const { user, newSignup } = resolved;
    await mintGoogleSession(c, sql, user, newSignup);

    // Fresh Google signups land on the licence picker (Auth v2). Existing users
    // honour the sanitized redirect target the caller passed to /start.
    //
    // Task #1 — invite/deep-link continuity: when the caller passed an
    // EXPLICIT redirect (e.g. /register?next=… → an invitation acceptance
    // page), honour it for new signups too instead of hard-routing them to
    // onboarding. Only the default '/dashboard' falls through to the licence
    // picker; the client-side gate still nudges un-profiled users there
    // on their next navigation.
    const requested = sanitizeRedirect(state.redirect);
    const landing = newSignup && requested === '/dashboard' ? '/onboarding' : requested;
    const url = `${appUrl(c.env)}${landing}${landing.includes('?') ? '&' : '?'}google=ok${newSignup ? '&google_signup=1' : ''}`;
    return c.redirect(url, 302);
  } catch (e: any) {
    console.error('[auth_google] callback error', e?.message || e, e?.stack);
    return callbackError(c.env, 'internal_error', state.action);
  } finally {
    try { await sql.end(); } catch {}
  }
});

// ----- /config and /popup (D722) --------------------------------------------
//
// "Continue with Google" on /login opens Google's own window — the GIS
// authorization-code client in popup mode, the library and window
// mail.axal.vc uses — and the page posts the code it gets back to /popup.
// No callback hop, no KV state and no cross-host cookie: the three things
// that turned a good Google sign-in into "Sign-in link expired" or a landing
// back on /login. The redirect above stays as the fallback for every click the
// window cannot take (switched off, not loaded yet, blocked).

/**
 * The cookie the page writes before it opens Google's window, holding that
 * attempt's state. Written by script on the page's own host, `SameSite=Strict`
 * and scoped to this mount, so it reaches /popup only from this site.
 */
const POPUP_STATE_COOKIE = 'studioos_google_popup';
const POPUP_STATE_RE = /^[A-Za-z0-9_-]{43}$/;
// A GIS authorization code: printable ASCII, no spaces, bounded.
const POPUP_CODE_RE = /^[\x21-\x7e]{1,1024}$/;
const POPUP_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Kept equal to index.ts's DEV_LOCALHOSTS, which the CORS allowlist reads.
const POPUP_DEV_ORIGINS = ['http://localhost:5000', 'http://localhost:5173'];

/**
 * The window may be used only when the client is configured AND the
 * deployment switched it on. `GOOGLE_SIGNIN_POPUP` ships "off": a JavaScript
 * origin missing from the Google client makes Google show its own error inside
 * the window, which the page cannot see, so the switch flips only after the
 * owner registers both origins. "off" is also the one-line rollback.
 */
function popupEnabled(env: Env): boolean {
  return !configMissing(env) && env.GOOGLE_SIGNIN_POPUP === 'on';
}

/**
 * The request must come from a page on this site. `Origin` must be this
 * request's own origin — so axal.vc answers axal.vc and app.axal.vc answers
 * app.axal.vc — and in production a `Sec-Fetch-Site`, when the browser sends
 * one, must say same-origin. Outside production the dev servers and
 * `EXTRA_DEV_ORIGINS` are admitted too, because there the SPA is served from a
 * different port than the Worker.
 */
function popupOriginOk(c: GoogleCtx): boolean {
  const origin = c.req.header('origin') || '';
  if (!origin) return false;
  const allowed = new Set<string>([new URL(c.req.url).origin]);
  const prod = isProductionEnv(c.env);
  if (!prod) {
    for (const o of POPUP_DEV_ORIGINS) allowed.add(o);
    for (const o of String(c.env.EXTRA_DEV_ORIGINS || '').split(',')) {
      const t = o.trim();
      if (/^https?:\/\//.test(t)) allowed.add(t);
    }
  }
  if (!allowed.has(origin)) return false;
  if (prod) {
    const site = c.req.header('sec-fetch-site');
    if (site && site !== 'same-origin') return false;
  }
  return true;
}

function readPopupCookie(c: GoogleCtx): string {
  const header = c.req.header('cookie') || '';
  for (const part of header.split(';')) {
    const t = part.trim();
    const eq = t.indexOf('=');
    if (eq > 0 && t.slice(0, eq) === POPUP_STATE_COOKIE) return t.slice(eq + 1);
  }
  return '';
}

/** Length-equal, constant-time string comparison, as verifyState does it. */
function sameString(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Every refusal is `{ error, code }` — a sentence we wrote and the flag the
 * page branches on (D278) — and none is a 401, so the SPA's request() never
 * mistakes a refused sign-in for an expired session and bounces the page.
 */
function popupRefuse(c: GoogleCtx, status: 400 | 403 | 409 | 500 | 502 | 503, code: string, error: string, extra: Record<string, unknown> = {}) {
  return c.json({ error, code, ...extra }, status);
}

authGoogle.get('/config', (c) => {
  const configured = !configMissing(c.env);
  const popup = popupEnabled(c.env);
  c.header('Cache-Control', 'no-store');
  // The client ID is public (it is in every Google sign-in URL), but it is
  // read from the deployment's own config and handed out only when the window
  // is on — nothing in the SPA bundle carries one.
  return c.json({ configured, popup, client_id: popup ? c.env.GOOGLE_AUTH_CLIENT_ID! : null });
});

authGoogle.post('/popup', async (c) => {
  if (configMissing(c.env)) {
    return popupRefuse(c, 503, 'not_configured', 'Google sign-in is not enabled on this environment.');
  }
  // Origin, then the header no cross-origin page can send (it is not in the
  // CORS allowHeaders, so a preflight for it is refused), then the body, then
  // the double-submitted state — all before anything leaves for Google.
  if (!popupOriginOk(c) || c.req.header('x-requested-with') !== 'XmlHttpRequest') {
    return popupRefuse(c, 403, 'bad_origin', 'Google sign-in failed. Please try again.');
  }
  let body: any;
  try { body = await c.req.json(); } catch { body = null; }
  const code = typeof body?.code === 'string' ? body.code : '';
  const state = typeof body?.state === 'string' ? body.state : '';
  if (!POPUP_CODE_RE.test(code) || !POPUP_STATE_RE.test(state)) {
    return popupRefuse(c, 400, 'bad_request', 'Google sign-in failed. Please try again.');
  }
  // Whitelisted, not passed through, as /start does it.
  const laneRaw = typeof body?.lane === 'string' ? body.lane.trim().toLowerCase() : '';
  const lane = ['founder', 'partner', 'investor'].includes(laneRaw) ? laneRaw : undefined;
  const expectedRaw = typeof body?.expected_email === 'string' ? body.expected_email.trim().toLowerCase() : '';
  const expectedEmail = expectedRaw.length <= 320 && POPUP_EMAIL_RE.test(expectedRaw) ? expectedRaw : undefined;

  // The page wrote the state into a SameSite=Strict cookie on this site before
  // it opened Google's window. A code another page captured cannot carry this
  // browser's cookie, so it cannot sign this browser in.
  if (!sameString(readPopupCookie(c), state)) {
    return popupRefuse(c, 403, 'bad_state', 'This sign-in attempt expired. Press Continue with Google again.');
  }
  // The attempt is spent whatever happens next; the cookie goes with it.
  c.header('Set-Cookie', `${POPUP_STATE_COOKIE}=; Path=/api/auth/google; Max-Age=0; Secure; SameSite=Strict`, { append: true });

  // D200 — the refusals that answer a presented credential are recorded. A
  // bad origin, a stale state and a different account are not a credential
  // being refused, and Google's keys not answering is our fault, not the
  // token's; none of those are written.
  const googleRefuse = (detail: string, subject?: { email?: string; userId?: number }) =>
    recordSecurityEvent(c.env, { kind: 'signin', factor: 'google', outcome: 'refused', detail, ip: c.req.header('cf-connecting-ip'), ...subject });

  try {
    const idToken = await fetchIdToken(c.env, code, 'postmessage');
    if (!idToken) {
      await googleRefuse('exchange_failed');
      return popupRefuse(c, 502, 'exchange_failed', "Google didn't confirm your sign-in. Please try again.");
    }
    const checked = await verifyGoogleIdToken(idToken, c.env.GOOGLE_AUTH_CLIENT_ID!);
    if (!checked.ok) {
      if (checked.code === 'email_unverified') {
        await googleRefuse('email_unverified');
        return popupRefuse(c, 403, 'email_unverified_at_google', 'Your Google email is not verified. Verify it with Google, then retry.');
      }
      console.warn('[auth_google] popup id_token refused', checked.reason);
      if (checked.reason !== 'jwks_unavailable') await googleRefuse('token_invalid');
      return popupRefuse(c, 502, 'token_invalid', "We couldn't verify your Google account. Please try again.");
    }
    const identity = checked.claims;

    const sql = getSQL(c.env);
    try {
      const resolved = await resolveGoogleSignin(c, sql, identity, { lane, expectedEmail });
      if (!resolved.ok) {
        if (resolved.code === 'different_account') {
          return popupRefuse(c, 409, 'different_account',
            `You typed ${expectedEmail}, but Google signed in ${identity.email}.`,
            { google_email: identity.email });
        }
        if (resolved.code === 'account_inactive') {
          await googleRefuse('inactive', { email: identity.email, userId: resolved.userId });
          return popupRefuse(c, 403, 'account_inactive', 'Your Axal VC account is inactive. Contact support.');
        }
        await googleRefuse('link_blocked_unverified', { email: identity.email, userId: resolved.userId });
        return popupRefuse(c, 409, 'link_blocked_unverified',
          "An Axal VC account already uses this email, but the address isn't confirmed yet. Use 'Email me a sign-in link' once to confirm it; after that, Continue with Google works.");
      }
      const { user, newSignup } = resolved;
      const { token, csrf } = await mintGoogleSession(c, sql, user, newSignup);
      return c.json({
        token,
        csrf_token: csrf,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        expires_in: 24 * 3600,
        new_signup: newSignup,
      });
    } finally {
      try { await sql.end(); } catch {}
    }
  } catch (e: any) {
    console.error('[auth_google] popup error', e?.message || e, e?.stack);
    return popupRefuse(c, 500, 'internal_error', 'Something went wrong on our side. Please try again.');
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
