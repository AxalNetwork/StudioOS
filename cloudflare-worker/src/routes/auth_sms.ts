/**
 * Task #6 — SMS 2FA endpoints (Google Cloud Identity Platform / Firebase Phone).
 *
 *   GET  /api/auth/factors?email=…             discovery (rate-limited; only
 *                                              "totp"/"sms" booleans, never PII)
 *   POST /api/auth/sms/start-enrollment        body: { phone, country, recaptcha_token? }
 *                                              must be authenticated; sends SMS
 *   POST /api/auth/sms/confirm-enrollment      body: { session_info, code }
 *                                              persists encrypted phone + sets tfa_methods
 *   POST /api/auth/sms/disable                 deletes auth_sms row, drops "sms" from
 *                                              tfa_methods (TOTP must remain enrolled
 *                                              — server refuses to leave the user with
 *                                              zero factors)
 *   POST /api/auth/sms/start-challenge         body: { email, recaptcha_token? }
 *                                              login flow — sends SMS to the stored
 *                                              phone (the phone itself is NEVER
 *                                              echoed to the caller)
 *   POST /api/auth/sms/verify-challenge        body: { email, session_info, code }
 *                                              issues JWT + cookie, mirrors /login
 *
 * Phone numbers stored at rest are AES-GCM ciphertext via the column cipher
 * (services/columnCipher.ts). Only the country + last-4 are stored / surfaced
 * in the clear. Country is checked against `SMS_COUNTRY_ALLOWLIST` at
 * enrollment time (no allow-list, no SMS).
 *
 * High-risk routes (impersonation, billing, contract void, DD report mint)
 * are deliberately TOTP-only — see `requireFactor()` in `src/auth.ts`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import {
  createJWT, requireAuth, setAuthCookies, generateCsrfToken,
} from '../auth';
import { hashEmail } from '../util/hashEmail';
import { hasTotpConfigured } from '../services/authTotp';
import {
  hasSmsConfigured, loadSms, persistSmsEnrollment, clearSms, markSmsUsed,
  getUserFactors, setUserFactor, clearUserFactor, isCountryAllowed,
} from '../services/authSms';
import { isGcipConfigured, sendVerificationCode, signInWithPhoneNumber, deleteGcipPhone } from '../services/gcip';

const sms = new Hono<{ Bindings: Env }>();

// Per-IP + per-user rate limit primitives — same KV bucket model as
// auth.ts:checkRateLimit, duplicated here so this file can be lifted
// out without dragging the parent module along.
async function rate(env: Env, key: string, max: number, windowSec: number): Promise<boolean> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const slot = Math.floor(now / windowSec);
    const k = `rl:${key}:${slot}`;
    const cur = parseInt((await env.RATE_LIMITS.get(k)) || '0', 10);
    if (cur >= max) return false;
    await env.RATE_LIMITS.put(k, String(cur + 1), { expirationTtl: windowSec + 5 });
    return true;
  } catch (e) {
    // Fail-CLOSED on KV outage (audit M1): SMS OTP enroll/challenge/verify are
    // sensitive, so deny rather than disable the throttle. Log only the bucket
    // prefix — the key tail carries email/phone (PII, L5).
    console.error('auth_sms rate KV error (failing closed) bucket=%s', key.split(':')[0], e);
    return false;
  }
}

function clientIp(c: any): string {
  return (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '')
    .split(',')[0].trim().slice(0, 64) || 'unknown';
}

// E.164 must start with '+' followed by 7-15 digits.
function isE164(p: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(p || '');
}

function gcip503(c: any) {
  return c.json({ error: 'sms_unavailable', message: 'SMS 2FA is not configured on this server.' }, 503);
}

// -------- factor discovery --------------------------------------------------

sms.get('/factors', async (c) => {
  const email = (c.req.query('email') || '').toLowerCase().trim().slice(0, 320);
  if (!email) return c.json({ error: 'Email required' }, 400);
  // Rate-limit per IP so this can't be used as an enumeration oracle.
  const ip = clientIp(c);
  const ok = await rate(c.env, `factors-ip:${ip}`, 30, 60);
  if (!ok) return c.json({ error: 'Too many requests' }, 429);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  await sql.end();
  // Always return the same shape regardless of whether the user exists, to
  // avoid a leak via response-shape diff. Booleans are false on miss.
  if (!rows.length) return c.json({ totp: false, sms: false, sms_available: isGcipConfigured(c.env) });
  const uid = Number(rows[0].id);
  const [totp, sms_] = await Promise.all([
    hasTotpConfigured(c.env, uid),
    hasSmsConfigured(c.env, uid),
  ]);
  return c.json({ totp: !!totp, sms: !!sms_, sms_available: isGcipConfigured(c.env) });
});

// -------- enrollment (authenticated) ----------------------------------------

sms.post('/sms/start-enrollment', async (c) => {
  if (!isGcipConfigured(c.env)) return gcip503(c);
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const phone = String(body?.phone || '').trim();
  const country = String(body?.country || '').trim().toUpperCase();
  const recaptcha = body?.recaptcha_token ? String(body.recaptcha_token) : null;
  if (!isE164(phone)) return c.json({ error: 'invalid_phone', message: 'Phone must be E.164 (e.g. +14155551234).' }, 400);
  if (!country || country.length !== 2) return c.json({ error: 'invalid_country' }, 400);
  if (!isCountryAllowed(c.env, country)) {
    return c.json({ error: 'country_not_allowed', message: `SMS to ${country} is not enabled.` }, 400);
  }
  // 10/min/IP, 5/min/user — matches the brief.
  if (!(await rate(c.env, `sms-enroll-ip:${clientIp(c)}`, 10, 60))) return c.json({ error: 'Too many requests' }, 429);
  if (!(await rate(c.env, `sms-enroll-user:${user.id}`, 5, 60))) return c.json({ error: 'Too many requests' }, 429);
  const r = await sendVerificationCode(c.env, phone, recaptcha);
  if (!r.ok) {
    return c.json({ error: r.code, message: r.message }, r.code === 'recaptcha_required' ? 412 : 502);
  }
  // Stash the candidate {phone, country} in KV against the sessionInfo so
  // the confirm step doesn't have to trust the client to round-trip these.
  await c.env.RATE_LIMITS.put(
    `sms-enroll:${user.id}:${r.sessionInfo}`,
    JSON.stringify({ phone, country, ts: Date.now() }),
    { expirationTtl: 600 },
  );
  return c.json({ session_info: r.sessionInfo });
});

sms.post('/sms/confirm-enrollment', async (c) => {
  if (!isGcipConfigured(c.env)) return gcip503(c);
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const sessionInfo = String(body?.session_info || '');
  const code = String(body?.code || '').trim();
  if (!sessionInfo || !code) return c.json({ error: 'session_info and code required' }, 400);
  const stashed = await c.env.RATE_LIMITS.get(`sms-enroll:${user.id}:${sessionInfo}`);
  if (!stashed) return c.json({ error: 'session_expired', message: 'Verification session expired. Restart enrollment.' }, 410);
  let phone: string, country: string;
  try {
    const obj = JSON.parse(stashed);
    phone = String(obj.phone); country = String(obj.country);
  } catch {
    return c.json({ error: 'session_corrupted' }, 500);
  }
  const v = await signInWithPhoneNumber(c.env, sessionInfo, code);
  if (!v.ok) return c.json({ error: v.code, message: v.message }, v.code === 'invalid_code' ? 401 : 502);
  // GCIP echoes back the verified phoneNumber; trust THAT, not the stash.
  // The stash is only authoritative for the country/jurisdiction binding.
  await persistSmsEnrollment(c.env, user.id, v.phoneNumber, country, v.localId);
  await setUserFactor(c.env, user.id, 'sms');
  await c.env.RATE_LIMITS.delete(`sms-enroll:${user.id}:${sessionInfo}`);
  try {
    const eh = await hashEmail(user.email);
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind(
      'sms_2fa_enrolled',
      `User enrolled SMS 2FA (country=${country}, last4=${v.phoneNumber.slice(-4)})`,
      eh, user.id,
    ).run();
  } catch {}
  return c.json({ ok: true, last4: v.phoneNumber.slice(-4), country });
});

sms.post('/sms/disable', async (c) => {
  const user = await requireAuth(c);
  // Refuse to remove the user's only factor.
  if (!(await hasTotpConfigured(c.env, user.id))) {
    return c.json({
      error: 'totp_required_first',
      message: 'Configure TOTP before disabling SMS — every account must keep at least one 2FA method.',
    }, 412);
  }
  // Task #6 — call the GCIP Admin API FIRST so an upstream failure surfaces
  // before we wipe local state (admins can retry). We only ignore the
  // upstream call when admin creds aren't configured at all — in that case
  // the local DB is the only source of truth anyway, so wiping it is safe.
  const existing = await loadSms(c.env, user.id);
  if (existing?.firebaseUid) {
    const r = await deleteGcipPhone(c.env, existing.firebaseUid);
    if (!r.ok && r.code !== 'admin_unconfigured' && r.code !== 'no_local_id') {
      return c.json({
        error: 'upstream_delete_failed',
        message: 'Could not remove phone factor from the auth provider. Try again or contact support.',
        detail: r.message,
      }, 502);
    }
    if (!r.ok) {
      console.warn(`[sms.disable] upstream delete skipped (${r.code}) for user=${user.id}`);
    }
  }
  await clearSms(c.env, user.id);
  await clearUserFactor(c.env, user.id, 'sms');
  try {
    const eh = await hashEmail(user.email);
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind('sms_2fa_disabled', 'User removed SMS 2FA', eh, user.id).run();
  } catch {}
  return c.json({ ok: true });
});

// -------- login challenge (unauthenticated; mirrors /login) -----------------

sms.post('/sms/start-challenge', async (c) => {
  if (!isGcipConfigured(c.env)) return gcip503(c);
  const body = await c.req.json().catch(() => ({} as any));
  const email = String(body?.email || '').toLowerCase().trim();
  const recaptcha = body?.recaptcha_token ? String(body.recaptcha_token) : null;
  if (!email) return c.json({ error: 'Email required' }, 400);
  if (!(await rate(c.env, `sms-chal-ip:${clientIp(c)}`, 10, 60))) return c.json({ error: 'Too many requests' }, 429);
  if (!(await rate(c.env, `sms-chal-email:${email}`, 5, 60))) return c.json({ error: 'Too many requests' }, 429);

  const sql = getSQL(c.env);
  const users = await sql`SELECT id, email_verified, is_active FROM users WHERE email = ${email}`;
  await sql.end();
  // Don't leak account existence — return a generic 200 with no session_info
  // when the user / SMS factor / verified email is missing. The frontend
  // surfaces the same "If we can text you, we just did" copy either way.
  if (!users.length || !users[0].email_verified || !users[0].is_active) {
    return c.json({ session_info: null });
  }
  const userId = Number(users[0].id);
  const sms_ = await loadSms(c.env, userId);
  if (!sms_) return c.json({ session_info: null });
  const r = await sendVerificationCode(c.env, sms_.phone, recaptcha);
  if (!r.ok) return c.json({ error: r.code, message: r.message }, r.code === 'recaptcha_required' ? 412 : 502);
  // Bind the sessionInfo to (email, userId) so verify can't be replayed
  // against a different account.
  await c.env.RATE_LIMITS.put(
    `sms-login:${r.sessionInfo}`,
    JSON.stringify({ user_id: userId, email, ts: Date.now() }),
    { expirationTtl: 600 },
  );
  return c.json({ session_info: r.sessionInfo, last4: sms_.last4 });
});

sms.post('/sms/verify-challenge', async (c) => {
  if (!isGcipConfigured(c.env)) return gcip503(c);
  const body = await c.req.json().catch(() => ({} as any));
  const email = String(body?.email || '').toLowerCase().trim();
  const sessionInfo = String(body?.session_info || '');
  const code = String(body?.code || '').trim();
  if (!email || !sessionInfo || !code) return c.json({ error: 'Missing parameters' }, 400);
  if (!(await rate(c.env, `sms-verify-email:${email}`, 5, 300))) return c.json({ error: 'Too many attempts. Try again later.' }, 429);

  const stashed = await c.env.RATE_LIMITS.get(`sms-login:${sessionInfo}`);
  if (!stashed) return c.json({ error: 'session_expired' }, 410);
  let bound: { user_id: number; email: string };
  try { bound = JSON.parse(stashed); }
  catch { return c.json({ error: 'session_corrupted' }, 500); }
  if (bound.email !== email) return c.json({ error: 'session_email_mismatch' }, 401);

  const v = await signInWithPhoneNumber(c.env, sessionInfo, code);
  if (!v.ok) return c.json({ error: v.code, message: v.message }, v.code === 'invalid_code' ? 401 : 502);

  // Cross-check the verified phone against the stored row. Defense-in-depth
  // in case GCIP ever returns a phoneNumber that's been re-bound to another
  // localId since enrollment.
  const stored = await loadSms(c.env, bound.user_id);
  if (!stored || stored.phone !== v.phoneNumber) {
    return c.json({ error: 'phone_mismatch' }, 401);
  }
  await c.env.RATE_LIMITS.delete(`sms-login:${sessionInfo}`);

  // Mint the session JWT — same code path as the TOTP login flow but with
  // factor='sms' so requireFactor('totp') will refuse high-risk routes.
  const sql = getSQL(c.env);
  const users = await sql`SELECT * FROM users WHERE id = ${bound.user_id}`;
  if (!users.length) { await sql.end(); return c.json({ error: 'Account not found' }, 401); }
  const user = users[0];
  const jti = crypto.randomUUID();
  const jwtToken = await createJWT(c.env, user.id, user.email, user.role, undefined, jti);
  const ua = (c.req.header('user-agent') || '').slice(0, 500);
  const ip = clientIp(c);
  try {
    await sql`INSERT INTO user_sessions (user_id, jti, user_agent, ip, factor)
              VALUES (${user.id}, ${jti}, ${ua || null}, ${ip || null}, 'sms')`;
  } catch {}
  const eh = await hashEmail(user.email);
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('user_login_sms', ${`login via SMS (email_hash=${eh})`}, ${eh}, ${user.id})`;
  await sql.end();
  await markSmsUsed(c.env, user.id);

  // Task #4 — defence-in-depth: revoke any lingering cross-identity session
  // before the SMS-minted cookie/Bearer overwrites it.
  try {
    const { revokeStaleCrossIdentitySession } = await import('../auth');
    await revokeStaleCrossIdentitySession(c, user.id);
  } catch (e) { console.warn('[auth_sms] cross-session revoke failed', e); }

  const csrfToken = generateCsrfToken();
  setAuthCookies(c, jwtToken, csrfToken);
  return c.json({
    token: jwtToken,
    csrf_token: csrfToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    expires_in: 24 * 3600,
    factor: 'sms',
  });
});

// -------- read-only summary for SettingsPage --------------------------------

sms.get('/sms/status', async (c) => {
  const user = await requireAuth(c);
  const row = await loadSms(c.env, user.id);
  return c.json({
    configured: !!row,
    last4: row?.last4 || null,
    country: row?.country || null,
    enrolled_at: row?.enrolledAt || null,
    factors: await getUserFactors(c.env, user.id),
    sms_available: isGcipConfigured(c.env),
  });
});

export default sms;
