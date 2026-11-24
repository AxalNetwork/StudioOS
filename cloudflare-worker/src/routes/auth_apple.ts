/**
 * D6957 (#6957) — "Continue with Apple": Sign in with Apple for the web.
 *
 * Mounted at /api/auth/apple. Beside magic link, passkey, authenticator code
 * and Google, never instead of them: an account Apple cannot serve still has
 * every other way in, and /login shows the Apple button only when /config
 * says this deployment is configured.
 *
 *   GET  /config     {configured}. Env only: no D1, no KV, no cookie.
 *   GET  /start      ?redirect=<path>&lane=<lane>&action=signin|link. Sets a
 *                    one-shot nonce cookie and sends the browser to Apple
 *                    with an HMAC-signed state and SHA-256(nonce) as `nonce`.
 *                    action=link needs a session (the explicit
 *                    proof-of-ownership path, from Account → Security).
 *   POST /callback   Apple's form_post return: code, id_token, state, and on
 *                    the first authorization a `user` JSON with the name.
 *
 * THE RETURN IS A CROSS-SITE POST from appleid.apple.com, so:
 *   - the nonce cookie is `SameSite=None; Secure` (a Lax cookie is not sent
 *     on a cross-site POST, which is what fails Safari otherwise), HttpOnly,
 *     scoped to this mount and ten minutes long;
 *   - the session cookie is not sent either, so a link carries its user id
 *     inside the signed state, as Google's does;
 *   - the path is exempt from the cookie-CSRF check (middleware/csrf.ts):
 *     the binding here is the state's HMAC plus the nonce cookie plus the
 *     id_token's nonce, all three checked before anything is written;
 *   - the answer is a 303, so the browser follows it with a GET.
 *
 * CHECKS, ALL BEFORE ANY WRITE: state signature and age; the nonce cookie
 * equals the state's nonce (this browser started this attempt); the posted
 * id_token's signature, issuer, audience, clock and nonce; the code exchange
 * at Apple's token endpoint and that answer's id_token; both tokens name the
 * same subject. The cookie is cleared on every callback, so a replayed POST
 * in the same browser has no nonce to match, and Apple's code is single-use.
 *
 * WHICH ACCOUNT (resolveAppleSignin):
 *   1. apple_sub already linked                → sign in.
 *   2. no link, an account has the email,
 *      the email is verified at Axal VC, and
 *      Apple is authoritative for the address  → link, sign in.
 *   3. same, but the Axal VC address is
 *      unverified                              → link_blocked_unverified.
 *   4. same, but Apple is not authoritative     → link_requires_email_proof:
 *                                                 email link first, then
 *                                                 Link Apple in Settings.
 *   5. no account, Apple authoritative          → new account, onboarding.
 *   6. no account, not authoritative            → link_requires_email_proof.
 *   7. no link and no email from Apple          → email_missing.
 * Apple is authoritative for Hide My Email relay addresses and iCloud
 * mailboxes (appleIsAuthoritative), the same rule D722 applies to Google.
 * An inactive account is refused before anything is linked.
 *
 * The session is minted as Google's is (factor 'apple'): one factor, so
 * step-up still asks for an authenticator code or passkey.
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
import { ensureExploringSchema } from '../services/exploringSchema';
import { recordSecurityEvent } from '../services/securityEvents';
import { claimLpRowsAtSignIn } from '../services/lpClaim';
import {
  APPLE_AUTHORIZE_URL,
  appleConfig,
  appleIsAuthoritative,
  exchangeAppleCode,
  hashNonce,
  verifyAppleIdToken,
} from '../services/appleIdToken';
import type { AppleIdentity } from '../services/appleIdToken';
import { sanitizeRedirect } from './auth_google';
import type { RouteMount } from '../util/routeRegistry';

const authApple = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;
type Sql = ReturnType<typeof getSQL>;

const STATE_COOKIE = 'studioos_apple_state';
const COOKIE_PATH = '/api/auth/apple';
const STATE_MAX_AGE_SEC = 600;
const LANES = ['founder', 'partner', 'investor'];

// ----- helpers --------------------------------------------------------------

function appUrl(env: Env): string {
  return (env.PUBLIC_BASE_URL || env.APP_URL || 'https://axal.vc').replace(/\/$/, '');
}

/**
 * The return URL registered on the Services ID. It sits on the host the SPA
 * runs on, so the nonce cookie /start sets is the one /callback reads, with no
 * cross-host Domain needed. APPLE_SIGNIN_RETURN_BASE_URL overrides it for an
 * environment whose registered domain differs.
 */
export function appleReturnUrl(env: Env): string {
  const base = (env.APPLE_SIGNIN_RETURN_BASE_URL || appUrl(env)).replace(/\/$/, '');
  return `${base}/api/auth/apple/callback`;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(norm + '='.repeat((4 - (norm.length % 4)) % 4));
}

async function hmac(env: Env, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.JWT_SECRET || ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  // Domain-separated from Google's state, so neither provider accepts the other's.
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`apple-state.${msg}`));
  return b64url(new Uint8Array(sig));
}

/** Length-equal, constant-time comparison. */
function sameString(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface AppleState {
  n: string;
  ts: number;
  action: 'signin' | 'link';
  uid?: number;
  redirect: string;
  lane?: string;
}

async function signState(env: Env, p: AppleState): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(p)));
  return `${body}.${await hmac(env, body)}`;
}

async function verifyState(env: Env, token: string, now = Math.floor(Date.now() / 1000)): Promise<AppleState | null> {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  if (!sameString(token.slice(dot + 1), await hmac(env, body))) return null;
  let p: AppleState;
  try { p = JSON.parse(b64urlDecode(body)); } catch { return null; }
  const age = now - Number(p.ts || 0);
  if (!(age >= 0 && age <= STATE_MAX_AGE_SEC)) return null;
  if (p.action !== 'signin' && p.action !== 'link') return null;
  if (typeof p.n !== 'string' || !p.n) return null;
  return p;
}

function cookieValues(c: Ctx, name: string): string[] {
  const out: string[] = [];
  for (const part of (c.req.header('cookie') || '').split(';')) {
    const t = part.trim();
    const eq = t.indexOf('=');
    if (eq > 0 && t.slice(0, eq) === name) out.push(t.slice(eq + 1));
  }
  return out;
}

function clearStateCookie(c: Ctx): void {
  const dom = authCookieDomainAttr(c);
  c.header('Set-Cookie', `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=${COOKIE_PATH}${dom}; Max-Age=0`, { append: true });
  if (dom) c.header('Set-Cookie', `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=${COOKIE_PATH}; Max-Age=0`, { append: true });
}

/**
 * Back to the chooser (or Settings, for a link) with a code the page maps to
 * our own sentence. Provider text never reaches the query string.
 */
function backWithError(c: Ctx, code: string, action: 'signin' | 'link', redirect?: string): Response {
  const path = action === 'link' ? '/account/security' : '/login';
  const qs = new URLSearchParams({ apple_error: code });
  // The chooser keeps the protected destination it was opened for.
  if (action === 'signin' && redirect && redirect !== '/dashboard') qs.set('next', redirect);
  return c.redirect(`${appUrl(c.env)}${path}?${qs.toString()}`, 303);
}

// ----- the account ----------------------------------------------------------

export type AppleRefusal =
  | 'link_blocked_unverified' | 'link_requires_email_proof' | 'account_inactive' | 'email_missing';

type AppleResult =
  | { ok: true; user: any; newSignup: boolean }
  | { ok: false; code: AppleRefusal; userId?: number };

/** First-authorization name from Apple's `user` field, bounded; null when absent. */
export function nameFromAppleUser(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 2000) return null;
  try {
    const u = JSON.parse(raw);
    const first = typeof u?.name?.firstName === 'string' ? u.name.firstName.trim() : '';
    const last = typeof u?.name?.lastName === 'string' ? u.name.lastName.trim() : '';
    const full = `${first} ${last}`.trim().replace(/[\u0000-\u001f]/g, '');
    return full ? full.slice(0, 200) : null;
  } catch {
    return null;
  }
}

/** Every refusal is decided before anything is written. */
async function resolveAppleSignin(
  c: Ctx,
  sql: Sql,
  id: AppleIdentity,
  opts: { name?: string | null; lane?: string },
): Promise<AppleResult> {
  const bySub = (await sql`
    SELECT u.* FROM users u INNER JOIN user_apple_links l ON l.user_id = u.id
    WHERE l.apple_sub = ${id.sub} LIMIT 1` as any[])[0];
  if (bySub) {
    if (Number(bySub.is_active ?? 1) === 0) return { ok: false, code: 'account_inactive', userId: Number(bySub.id) };
    return { ok: true, user: bySub, newSignup: false };
  }
  if (!id.email) return { ok: false, code: 'email_missing' };
  const byEmail = (await sql`SELECT * FROM users WHERE LOWER(email) = ${id.email} LIMIT 1` as any[])[0];
  if (byEmail && Number(byEmail.is_active ?? 1) === 0) {
    return { ok: false, code: 'account_inactive', userId: Number(byEmail.id) };
  }
  if (byEmail && !byEmail.email_verified) {
    return { ok: false, code: 'link_blocked_unverified', userId: Number(byEmail.id) };
  }
  if (!appleIsAuthoritative(id.email, id.privateEmail)) {
    return { ok: false, code: 'link_requires_email_proof', userId: byEmail ? Number(byEmail.id) : undefined };
  }
  const priv = id.privateEmail ? 1 : 0;
  if (byEmail) {
    await sql`INSERT OR IGNORE INTO user_apple_links (user_id, apple_sub, private_email) VALUES (${byEmail.id}, ${id.sub}, ${priv})`;
    const eh = await hashEmail(byEmail.email);
    await sql`INSERT INTO activity_logs (action, details, actor, user_id)
              VALUES ('apple_account_auto_linked', 'first Apple sign-in matched a verified email Apple hosts', ${eh}, ${byEmail.id})`;
    return { ok: true, user: byEmail, newSignup: false };
  }

  // A new account, as Google's rule 4 makes one: role 'exploring', the email
  // verified (Apple hosts it), the onboarding gate seeded.
  const name = (opts.name || (id.privateEmail ? 'New member' : id.email.split('@')[0]) || 'New member').slice(0, 200);
  await ensureExploringSchema(c.env);
  const user = (await sql`
    INSERT INTO users (email, name, role, email_verified)
    VALUES (${id.email}, ${name}, 'exploring', true)
    RETURNING *` as any[])[0];
  if (opts.lane) {
    try {
      const { upsertSuggestedRole } = await import('../services/exploringSchema');
      await upsertSuggestedRole(c.env, Number(user.id), opts.lane);
    } catch (e) { console.error('[auth_apple] suggested-role upsert failed:', (e as Error).message); }
  }
  await sql`INSERT OR IGNORE INTO user_apple_links (user_id, apple_sub, private_email) VALUES (${user.id}, ${id.sub}, ${priv})`;
  try {
    const { readRefCookie } = await import('../services/referralAttribution');
    const { attachSignupReferral } = await import('../services/referrals/handleAttribution');
    await attachSignupReferral(c.env, Number(user.id), readRefCookie(c.req.header('cookie')));
  } catch (e) { console.error('[auth_apple] referral not attached:', (e as Error).message); }
  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO onboarding_progress (user_id, flow, step, total_steps, completed_at)
       VALUES (?, 'licence', 0, 0, NULL)`,
    ).bind(user.id).run();
  } catch (e) { console.error('[auth_apple] onboarding_progress seed failed', e); }
  const eh = await hashEmail(user.email);
  await sql`INSERT INTO activity_logs (action, details, actor, user_id)
            VALUES ('user_registered_apple', ${`Apple sign-up (email_hash=${eh}, relay=${priv})`}, ${eh}, ${user.id})`;
  try {
    const { seedObligations } = await import('../services/trust');
    await seedObligations(c.env, user.id, user.role || 'partner');
  } catch (e) { console.error('[auth_apple] trust seed failed', e); }
  try {
    const { Jobs } = await import('../models/jobs');
    await Jobs.enqueue(c.env, 'embed_entity', { type: 'partner', id: user.id });
  } catch {}
  return { ok: true, user, newSignup: true };
}

/** The same primitives, in the same order, as Google's session (factor 'apple'). */
async function mintAppleSession(c: Ctx, sql: Sql, user: any, newSignup: boolean): Promise<void> {
  const jti = crypto.randomUUID();
  const token = await createJWT(c.env, user.id, user.email, user.role, undefined, jti);
  const ua = (c.req.header('user-agent') || '').slice(0, 500);
  const ip = (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64);
  try {
    await sql`INSERT INTO user_sessions (user_id, jti, user_agent, ip, factor)
              VALUES (${user.id}, ${jti}, ${ua || null}, ${ip || null}, 'apple')`;
  } catch (e) { console.error('[auth_apple] session insert failed', e); }
  const eh = await hashEmail(user.email);
  await sql`INSERT INTO activity_logs (action, details, actor, user_id)
            VALUES (${newSignup ? 'user_login_apple_signup' : 'user_login_apple'}, 'sign-in via Apple', ${eh}, ${user.id})`;
  try { await revokeStaleCrossIdentitySession(c, user.id); } catch (e) { console.warn('[auth_apple] cross-session revoke failed', e); }
  await claimLpRowsAtSignIn(c.env, user);
  setAuthCookies(c, token, generateCsrfToken());
}

// ----- /config --------------------------------------------------------------

authApple.get('/config', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ configured: !!appleConfig(c.env) });
});

// ----- /start ---------------------------------------------------------------

authApple.get('/start', async (c) => {
  const cfg = appleConfig(c.env);
  const wantsJson = (c.req.header('accept') || '').includes('application/json');
  if (!cfg) {
    if (wantsJson) return c.json({ error: 'Sign in with Apple is not available here yet. Use Email or Google.', code: 'not_configured' }, 503);
    return backWithError(c, 'not_configured', 'signin');
  }
  const action = c.req.query('action') === 'link' ? 'link' : 'signin';
  const redirect = sanitizeRedirect(c.req.query('redirect') || '/dashboard');
  let uid: number | undefined;
  if (action === 'link') {
    const user = await getCurrentUser(c);
    if (!user) return c.json({ error: 'Sign in first to link an Apple ID.', code: 'unauthenticated' }, 401);
    uid = Number(user.id);
  }
  const laneRaw = (c.req.query('lane') || '').trim().toLowerCase();
  const lane = LANES.includes(laneRaw) ? laneRaw : undefined;

  const raw = new Uint8Array(16);
  crypto.getRandomValues(raw);
  const nonce = b64url(raw);
  const state = await signState(c.env, { n: nonce, ts: Math.floor(Date.now() / 1000), action, uid, redirect, lane });
  c.header('Set-Cookie',
    `${STATE_COOKIE}=${nonce}; HttpOnly; Secure; SameSite=None; Path=${COOKIE_PATH}${authCookieDomainAttr(c)}; Max-Age=${STATE_MAX_AGE_SEC}`,
    { append: true });
  const params = new URLSearchParams({
    client_id: cfg.servicesId,
    redirect_uri: appleReturnUrl(c.env),
    response_type: 'code id_token',
    response_mode: 'form_post',
    scope: 'name email',
    state,
    nonce: await hashNonce(nonce),
  });
  const url = `${APPLE_AUTHORIZE_URL}?${params.toString()}`;
  c.header('Cache-Control', 'no-store');
  if (wantsJson) return c.json({ url });
  return c.redirect(url, 302);
});

// ----- /callback ------------------------------------------------------------

authApple.post('/callback', async (c) => {
  const cfg = appleConfig(c.env);
  let form: Record<string, unknown> = {};
  try { form = await c.req.parseBody(); } catch { form = {}; }
  const str = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : '');
  // Whatever happens next, this browser's attempt is spent.
  clearStateCookie(c);
  if (!cfg) return backWithError(c, 'not_configured', 'signin');

  const state = await verifyState(c.env, str('state'));
  const action = state?.action || 'signin';
  const redirect = state ? sanitizeRedirect(state.redirect) : undefined;
  const providerError = str('error');
  if (providerError) {
    return backWithError(c, providerError === 'user_cancelled_authorize' ? 'cancelled' : 'provider_error', action, redirect);
  }
  if (!state) return backWithError(c, 'bad_state', 'signin');
  if (!cookieValues(c, STATE_COOKIE).some((v) => sameString(v, state.n))) {
    return backWithError(c, 'bad_state', action, redirect);
  }
  const code = str('code');
  const postedToken = str('id_token');
  if (!code || code.length > 1024 || !postedToken || postedToken.length > 8192) {
    return backWithError(c, 'missing_code', action, redirect);
  }

  const refuse = (detail: string, subject?: { email?: string; userId?: number }) =>
    recordSecurityEvent(c.env, { kind: 'signin', factor: 'apple', outcome: 'refused', detail, ip: c.req.header('cf-connecting-ip'), ...subject });

  const expectedNonce = await hashNonce(state.n);
  const posted = await verifyAppleIdToken(postedToken, cfg.servicesId, expectedNonce);
  if (!posted.ok) {
    console.warn('[auth_apple] posted id_token refused', posted.reason);
    if (posted.code === 'email_unverified') {
      await refuse('email_unverified');
      return backWithError(c, 'email_unverified', action, redirect);
    }
    if (posted.reason !== 'jwks_unavailable') await refuse('token_invalid');
    return backWithError(c, 'token_invalid', action, redirect);
  }
  const exchanged = await exchangeAppleCode(cfg, code, appleReturnUrl(c.env));
  if (!exchanged.ok) {
    if (exchanged.reason === 'client_secret') return backWithError(c, 'not_configured', action, redirect);
    await refuse('exchange_failed');
    return backWithError(c, 'exchange_failed', action, redirect);
  }
  // The token endpoint's id_token: same checks; its nonce, when Apple
  // includes one, must be ours too.
  const fromApple = await verifyAppleIdToken(exchanged.idToken, cfg.servicesId, null);
  if (!fromApple.ok || fromApple.claims.sub !== posted.claims.sub) {
    await refuse('token_mismatch');
    return backWithError(c, 'token_invalid', action, redirect);
  }
  const tokenNonce = (() => {
    try { return JSON.parse(b64urlDecode(exchanged.idToken.split('.')[1] || '')).nonce; } catch { return undefined; }
  })();
  if (tokenNonce !== undefined && tokenNonce !== expectedNonce) {
    await refuse('token_mismatch');
    return backWithError(c, 'token_invalid', action, redirect);
  }
  const identity: AppleIdentity = {
    sub: fromApple.claims.sub,
    email: fromApple.claims.email || posted.claims.email,
    privateEmail: fromApple.claims.privateEmail || posted.claims.privateEmail,
  };

  const sql = getSQL(c.env);
  try {
    if (state.action === 'link') {
      const uid = Number(state.uid || 0);
      const me = (await sql`SELECT id, email, email_verified, is_active FROM users WHERE id = ${uid}` as any[])[0];
      if (!me) return backWithError(c, 'user_gone', 'link');
      if (Number(me.is_active ?? 1) === 0) return backWithError(c, 'account_inactive', 'link');
      if ((await sql`SELECT 1 FROM user_apple_links WHERE user_id = ${uid}` as any[]).length) {
        return backWithError(c, 'already_linked', 'link');
      }
      if (!me.email_verified) return backWithError(c, 'caller_email_unverified', 'link');
      if ((await sql`SELECT 1 FROM user_apple_links WHERE apple_sub = ${identity.sub} AND user_id <> ${uid}` as any[]).length) {
        return backWithError(c, 'sub_owned_by_other', 'link');
      }
      await sql`INSERT OR IGNORE INTO user_apple_links (user_id, apple_sub, private_email) VALUES (${uid}, ${identity.sub}, ${identity.privateEmail ? 1 : 0})`;
      const eh = await hashEmail(me.email);
      const mismatch = !!identity.email && identity.email !== String(me.email || '').toLowerCase();
      await sql`INSERT INTO activity_logs (action, details, actor, user_id)
                VALUES ('apple_account_linked', ${`linked apple_sub (email_mismatch=${mismatch}, relay=${identity.privateEmail})`}, ${eh}, ${uid})`;
      const back = sanitizeRedirect(state.redirect);
      return c.redirect(`${appUrl(c.env)}${back}${back.includes('?') ? '&' : '?'}apple_linked=1`, 303);
    }

    const resolved = await resolveAppleSignin(c, sql, identity, { name: nameFromAppleUser(form.user), lane: state.lane });
    if (!resolved.ok) {
      await refuse(resolved.code, { email: identity.email || undefined, userId: resolved.userId });
      return backWithError(c, resolved.code, 'signin', redirect);
    }
    await mintAppleSession(c, sql, resolved.user, resolved.newSignup);
    // As Google's callback: a new account with no explicit destination goes
    // to onboarding; an explicit one (an invitation, a protected page) is kept.
    const requested = sanitizeRedirect(state.redirect);
    const landing = resolved.newSignup && requested === '/dashboard' ? '/onboarding' : requested;
    return c.redirect(
      `${appUrl(c.env)}${landing}${landing.includes('?') ? '&' : '?'}apple=ok${resolved.newSignup ? '&apple_signup=1' : ''}`,
      303,
    );
  } catch (e: any) {
    console.error('[auth_apple] callback error', e?.message || e);
    return backWithError(c, 'internal_error', state.action, redirect);
  } finally {
    try { await sql.end(); } catch {}
  }
});

export const __testing = { signState, verifyState };

export const mount: RouteMount = { path: '/api/auth/apple', router: authApple };
export default authApple;
