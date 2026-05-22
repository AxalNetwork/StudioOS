import { Hono } from 'hono';
import { TOTP, Secret } from 'otpauth';
import * as QRCode from 'qrcode';
import type { Env } from '../types';
import { getSQL } from '../db';
import { createJWT, hashToken, generateToken, requireAuth, setAuthCookies, clearAuthCookies, generateCsrfToken, revokeStaleCrossIdentitySession } from '../auth';
import { sendVerificationEmail } from '../services/email';
import { verifyTurnstile } from '../services/turnstile';
import { persistNewTotpEnrolment, loadTotp, updateRecoveryHashes, markTotpUsed, hasTotpConfigured, clearTotp } from '../services/authTotp';
import { setUserFactor } from '../services/authSms';
import smsRoutes from './auth_sms';

const auth = new Hono<{ Bindings: Env }>();

// T5 — Recovery codes are persisted as SHA-256 hex hashes in
// `users.totp_recovery_codes` (JSON array of strings; column added in
// epic3_settings.sql). Format is XXXX-XXXX-XXXX from a 32-char ambiguity-free
// alphabet (settings.ts:generateRecoveryCode). We intentionally re-use this
// existing column rather than introduce a separate `totp_backup_codes` table:
// the feature already ships against it (regenerate endpoint + Settings UI),
// and a single-row UPDATE gives us atomic single-use semantics for free.
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRecoveryCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars: string[] = [];
  for (let i = 0; i < 12; i++) chars.push(RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

async function mintRecoveryCodes(): Promise<{ plain: string[]; hashes: string[] }> {
  const plain: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const c = generateRecoveryCode();
    plain.push(c);
    hashes.push(await hashToken(c));
  }
  return { plain, hashes };
}

/**
 * T5 — try to consume a recovery code. Normalises the input (uppercase, strip
 * spaces, accept 12 raw chars OR XXXX-XXXX-XXXX), hashes it, and atomically
 * removes the matching hash from the user's recovery-code array. Returns true
 * if a code was consumed (caller should treat the login as successful and emit
 * an audit log). Returns false on any mismatch / parse failure / missing column.
 *
 * Uses a re-read + targeted UPDATE rather than a single CAS to keep the SQL
 * portable — under concurrent attempts the worst case is one extra failed
 * verify (the second writer's UPDATE is a no-op against the smaller array).
 */
async function tryConsumeRecoveryCode(env: Env, userId: number, raw: string): Promise<boolean> {
  const normalized = raw.replace(/[\s-]/g, '').toUpperCase();
  if (normalized.length !== 12) return false;
  const formatted = `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}`;
  let candidateHash: string;
  try {
    candidateHash = await hashToken(formatted);
  } catch {
    return false;
  }
  const sql = getSQL(env);
  try {
    const rows = await sql`SELECT totp_recovery_codes FROM users WHERE id = ${userId}`;
    if (!rows.length) return false;
    let stored: string[] = [];
    try {
      const json = rows[0].totp_recovery_codes;
      stored = json ? JSON.parse(json) : [];
      if (!Array.isArray(stored)) stored = [];
    } catch {
      return false;
    }
    const idx = stored.indexOf(candidateHash);
    if (idx === -1) return false;
    stored.splice(idx, 1);
    // Task #33 — keep the new auth_totp.recovery_hashes column in lockstep
    // with the legacy users.totp_recovery_codes column. updateRecoveryHashes
    // batches both writes; if auth_totp has no row yet (legacy user),
    // mirror the legacy update only.
    try {
      await updateRecoveryHashes(env, userId, stored);
    } catch {
      await sql`UPDATE users SET totp_recovery_codes = ${JSON.stringify(stored)} WHERE id = ${userId}`;
    }
    return true;
  } catch (e) {
    console.error('[AUTH:recovery-code] consume failed:', e);
    return false;
  } finally {
    try { await sql.end(); } catch {}
  }
}

/**
 * Defensive wrapper for auth handlers. Catches any unhandled exception and
 * returns a friendly, route-scoped error message instead of the global
 * "Internal server error" 500. Critical for the auth funnel — silent 500s
 * here cost real signups and lock users out of their accounts.
 *
 * Logs the actual cause to Cloudflare logs with the route label so we can
 * triage post-hoc without leaking internals to the client.
 */
// Known underlying errors that are safe to surface as a short, stable
// `code` on the 500 response. Lets the operator diagnose misconfiguration
// from the screenshot alone instead of having to dig through Cloudflare
// logs. Patterns must match throw messages used inside the auth routes
// and their direct services (columnCipher, authTotp).
const SAFE_ERROR_CODES: Array<{ re: RegExp; code: string; hint: string }> = [
  { re: /KEK_PII is required in production/i, code: 'kek_pii_missing',
    hint: 'Server is missing the column-encryption key (KEK_PII). Ask the operator to provision it.' },
  { re: /KEK_PII must be at least 32 bytes/i, code: 'kek_pii_too_short',
    hint: 'Server column-encryption key is too short (<32 bytes). Ask the operator to rotate it.' },
  { re: /Neither KEK_PII nor JWT_SECRET is set/i, code: 'encryption_keys_missing',
    hint: 'Server encryption keys are not configured. Ask the operator to provision KEK_PII.' },
];

function safe(label: string, friendlyError: string, handler: (c: any) => Promise<any>) {
  return async (c: any) => {
    try {
      return await handler(c);
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.error(`[AUTH:${label}] unhandled error:`, msg, e?.stack || '');
      const hit = SAFE_ERROR_CODES.find(s => s.re.test(msg));
      if (hit) {
        return c.json({ error: hit.hint, code: hit.code }, 500);
      }
      return c.json({ error: friendlyError }, 500);
    }
  };
}

async function readJson(c: any): Promise<{ ok: boolean; body: any; res: any }> {
  try {
    const body = await c.req.json();
    return { ok: true, body: body || {}, res: null };
  } catch (e: any) {
    console.error('[AUTH] invalid JSON body:', e?.message || e);
    return { ok: false, body: null, res: c.json({ error: 'Malformed request body' }, 400) };
  }
}

// T22.1 — hashEmail moved to ../util/hashEmail so admin.ts and other
// routes can reuse it without re-declaring the digest logic. Re-imported
// here so existing call sites (register/verify/login/referral) keep
// working unchanged.
import { hashEmail } from '../util/hashEmail';

async function checkRateLimit(env: Env, key: string, max: number, windowSec: number): Promise<boolean> {
  // Fail-open on any KV error (incl. daily-write-limit exceeded on the free
  // plan). Auth/registration must keep working; a small over-allowance during
  // a KV outage is acceptable for a venture-studio scale workload.
  let attempts: number[] = [];
  try {
    const data = await env.RATE_LIMITS.get(key);
    const now = Date.now();
    attempts = data ? JSON.parse(data) : [];
    attempts = attempts.filter(t => now - t < windowSec * 1000);
    if (attempts.length >= max) return false;
    attempts.push(now);
    await env.RATE_LIMITS.put(key, JSON.stringify(attempts), { expirationTtl: windowSec });
  } catch (e) {
    console.error('checkRateLimit KV error (failing open)', key, e);
    return true;
  }
  return true;
}

async function sendVerification(env: Env, email: string, name: string, userId: number): Promise<{ sent: boolean; verificationUrl: string; tokenStored: boolean }> {
  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const verificationUrl = `${env.APP_URL}/verify-email?token=${rawToken}`;

  let tokenStored = false;
  try {
    const sql = getSQL(env);
    await sql`UPDATE users SET verification_token = ${tokenHash}, verification_token_expires = ${expires} WHERE id = ${userId}`;
    await sql.end();
    tokenStored = true;
  } catch (e: any) {
    console.error(`[AUTH] Failed to persist verification token for ${email}: ${e?.message || 'Unknown error'}`);
    return { sent: false, verificationUrl, tokenStored: false };
  }

  // Task #2 (IB) — route through the unified send() pipeline first. It
  // renders the `auth_verify_email` template, mirrors into
  // notifications_inbox, and enqueues an `email_send` job (with
  // automatic DLQ on permanent failure). The legacy
  // sendVerificationEmail() stays as a fallback ONLY if the unified
  // pipeline throws before enqueueing — the queue itself handles its
  // own retries so we don't double-send on transient SMTP errors.
  try {
    const { send } = await import('../services/email/send');
    // `immediate: true` — verification emails are user-interactive
    // (the visitor is sitting on a loading button waiting for the
    // link), so we deliver synchronously instead of enqueueing.
    // Without this, send() returned ok:true the moment the job hit
    // JOB_QUEUE, and the API replied `email_sent: true` even when
    // Gmail later failed inside the queue consumer (expired refresh
    // token, mailbox bounce, queue not draining), so the user saw
    // "Email sent" and never received anything. Synchronous delivery
    // also gives us a truthful `delivered` flag we can surface to the
    // user as `email_sent: false` so RegisterPage's emailWarning kicks
    // in and shows the dev fallback verification_url.
    const r = await send(
      env,
      'auth_verify_email',
      email,
      { name, verify_url: verificationUrl, app_url: env.APP_URL },
      { userId, immediate: true },
    );
    if (r.ok && r.delivered !== false) return { sent: true, verificationUrl, tokenStored };
    console.warn(`[AUTH] unified send() returned not-ok/undelivered for ${email} (reason=${r.reason || 'unknown'}); falling back to legacy sender`);
  } catch (e: any) {
    console.error(`[AUTH] unified send() threw for ${email}: ${e?.message || 'Unknown error'} — falling back`);
  }
  try {
    const sent = await sendVerificationEmail(env, email, name, verificationUrl);
    if (!sent) {
      console.warn(`[AUTH] Email delivery failed for ${email}. Check GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN secrets.`);
    }
    return { sent, verificationUrl, tokenStored };
  } catch (e: any) {
    console.error(`[AUTH] Email service error for ${email}: ${e?.message || 'Unknown error'}`);
    return { sent: false, verificationUrl, tokenStored };
  }
}

auth.post('/register', safe('register', 'Registration failed. Please try again in a moment, or contact support if the problem persists.', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.res;
  const { email, name, role, turnstileToken, ref_code, defer_email } = parsed.body;
  if (!email || !name) return c.json({ error: 'Email and name required' }, 400);
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRe.test(String(email).trim())) return c.json({ error: 'Please enter a valid email address' }, 400);
  if (role && !['founder', 'partner', 'investor'].includes(role)) return c.json({ error: 'Invalid role' }, 400);

  const clientIp = c.req.header('cf-connecting-ip') || undefined;
  const turnstileOk = await verifyTurnstile(c.env, turnstileToken, clientIp);
  if (!turnstileOk) {
    // Audit-log the failed attempt so we can spot abuse patterns. We store
    // a SHA-256 hash of the email + a /24-truncated IP rather than raw PII —
    // the failed submitter never authenticated and we have no consent /
    // legitimate-interest basis to retain their plain email indefinitely.
    try {
      const emailHash = await hashEmail(email);
      // /24 for IPv4, /48 for IPv6 — coarse enough for abuse clustering, fine
      // enough to drop unique-host info.
      let ipBucket = 'unknown';
      if (clientIp) {
        if (clientIp.includes(':')) ipBucket = clientIp.split(':').slice(0, 3).join(':') + '::/48';
        else ipBucket = clientIp.split('.').slice(0, 3).join('.') + '.0/24';
      }
      const sql = getSQL(c.env);
      await sql`INSERT INTO activity_logs (action, details, actor)
                VALUES ('turnstile_failed',
                        ${`register attempt blocked: email_hash=${emailHash} ip_bucket=${ipBucket} ref=${ref_code ?? 'none'}`},
                        ${ipBucket})`;
      await sql.end();
    } catch (e) {
      console.error('[AUTH] failed to log turnstile failure', e);
    }
    return c.json({ error: 'Bot verification failed. Please try again.' }, 403);
  }

  const sql = getSQL(c.env);
  const existing = await sql`SELECT * FROM users WHERE email = ${email}`;

  if (existing.length > 0) {
    const user = existing[0];
    if (user.email_verified && (await hasTotpConfigured(c.env, user.id))) {
      await sql.end();
      return c.json({ error: 'Email already registered' }, 409);
    }
    await sql`UPDATE users SET name = ${name}, role = ${role || 'partner'} WHERE id = ${user.id}`;
    await sql.end();
    // Phase 0.1: investors embed under their own entity bucket; partners stay legacy.
    try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: role === 'investor' ? 'investor' : 'partner', id: user.id }); } catch {}
    // Task #50 — frontend signup is a multi-step flow (register → chatbot →
    // "Check Your Email"). When `defer_email` is true the frontend will
    // explicitly request the verification email at the final step via
    // /resend-verification, so it arrives the moment the user lands on the
    // "Check Your Email" screen instead of minutes earlier (which made users
    // think no email was ever sent).
    if (defer_email) {
      return c.json({
        message: 'Account updated, verification email deferred',
        email, name, requires_verification: true, email_sent: null, email_deferred: true,
      });
    }
    const { sent: emailSent, verificationUrl, tokenStored } = await sendVerification(c.env, email, name, user.id);
    return c.json({
      message: emailSent ? 'Verification email sent' : 'Account created but email delivery failed',
      email, name, requires_verification: true, email_sent: emailSent, verification_url: !emailSent && tokenStored ? verificationUrl : undefined
    });
  }

  const [user] = await sql`INSERT INTO users (email, name, role, email_verified) VALUES (${email}, ${name}, ${role || 'partner'}, false) RETURNING *`;
  // Task #6 (W-1) — investor signups get a 14-day Professional trial.
  // Cron in index.ts at 04:25 UTC downgrades expired trials to free.
  if (role === 'investor') {
    try {
      // Task #43 — source dealroom cap from INVESTOR_QUOTAS so the trial
      // initialisation tracks the canonical professional cap (still 5,
      // but no longer a magic number that drifts from the constant).
      const { ensureInvestorPaywallSchema, INVESTOR_QUOTAS } = await import('../middleware/requireInvestorTier');
      await ensureInvestorPaywallSchema(c.env);
      const trialEnds = new Date(Date.now() + 14 * 86400 * 1000).toISOString();
      await c.env.DB.prepare(
        `UPDATE users SET investor_tier = 'professional',
                           investor_subscription_status = 'trialing',
                           investor_trial_ends_at = ?,
                           investor_dealroom_max = ?
         WHERE id = ?`
      ).bind(trialEnds, INVESTOR_QUOTAS.professional.dealroom_max, user.id).run();
    } catch (e) { console.error('[auth] investor trial init failed', e); }
  }
  // Task #3 (Y-1) — Trust Center: seed role-conditional obligations the
  // moment the account exists. Idempotent (UNIQUE on user_id+key) so a
  // second pass from /me self-heals if this throws.
  try {
    const { seedObligations } = await import('../services/trust');
    await seedObligations(c.env, user.id, role || 'partner');
  } catch (e) { console.error('[auth] trust seed failed', e); }
  // T22.1 — PII redaction: details no longer carries the plaintext name +
  // email; actor stores an email_hash instead of the email itself. The
  // user_id FK is the canonical link back to the account row when joins
  // are needed for support/analytics.
  const regEmailHash = await hashEmail(email);
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('user_registered', ${`registered as ${role || 'partner'} — pending email verification (email_hash=${regEmailHash})`}, ${regEmailHash}, ${user.id})`;
  // Task #66 — seed the onboarding-chatbot gate row. The frontend
  // RequireAuth guard pins this user to /onboarding/chat until the
  // chatbot save flips completed_at. INSERT OR IGNORE so this is safe
  // to re-run (the row's UNIQUE on user_id makes a second pass a no-op).
  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO onboarding_progress (user_id, flow, step, total_steps, completed_at)
       VALUES (?, 'chat', 0, 0, NULL)`
    ).bind(user.id).run();
  } catch (e) { console.error('[auth] onboarding_progress seed failed', e); }
  await sql.end();
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: role === 'investor' ? 'investor' : 'partner', id: user.id }); } catch {}

  if (ref_code) {
    try {
      const code = String(ref_code).toUpperCase();
      // Task #8 (X-1) — partner referral codes (PART-XXXXXXXX) grant tier
      // benefits per the partner deal's terms; non-partner codes fall
      // through to the legacy network referral chain.
      if (code.startsWith('PART-')) {
        try {
          const { redeemPartnerReferralCode } = await import('../services/partnerDeals');
          const redeemed = await redeemPartnerReferralCode(c.env, user.id, code);
          if (redeemed) {
            const sql2 = getSQL(c.env);
            const refEmailHash = await hashEmail(email);
            await sql2`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('partner_referral_redeemed', ${JSON.stringify({ partner_deal_id: redeemed.partner_deal_id, code })}, ${refEmailHash}, ${user.id})`;
            await sql2.end();
          }
        } catch (e) { console.error('redeemPartnerReferralCode failed:', e); }
      } else {
        const { attachReferral } = await import('./network');
        const linked = await attachReferral(c.env, user.id, code);
        if (linked) {
          // T22.1 — actor uses email_hash, never the plaintext email.
          const sql2 = getSQL(c.env);
          const refEmailHash = await hashEmail(email);
          await sql2`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('referral_attached', ${`Joined via referral code ${ref_code}`}, ${refEmailHash}, ${user.id})`;
          await sql2.end();
        }
      }
    } catch (e) { console.error('attachReferral failed:', e); }
  }

  // Task #50 — see note above; defer when the multi-step signup will request
  // verification email at the final step.
  if (defer_email) {
    return c.json({
      message: 'Account created, verification email deferred',
      email: user.email, name: user.name, requires_verification: true, email_sent: null, email_deferred: true,
    });
  }
  const { sent: emailSent, verificationUrl, tokenStored } = await sendVerification(c.env, email, name, user.id);
  return c.json({
    message: emailSent ? 'Verification email sent' : 'Account created but email delivery failed',
    email: user.email, name: user.name, requires_verification: true, email_sent: emailSent, verification_url: !emailSent && tokenStored ? verificationUrl : undefined
  });
}));

auth.post('/resend-verification', async (c) => {
  const { email } = await c.req.json().catch(() => ({} as any));
  const genericMsg = 'If an account exists with that email, a verification link has been sent.';

  if (!email || typeof email !== 'string') {
    return c.json({ error: 'Email required' }, 400);
  }

  const allowed = await checkRateLimit(c.env, `resend:${email.toLowerCase()}`, 3, 3600);
  if (!allowed) return c.json({ error: 'Maximum resend limit reached. Please try again in an hour.' }, 429);

  let users: any[] = [];
  try {
    const sql = getSQL(c.env);
    users = await sql`SELECT * FROM users WHERE email = ${email}`;
    await sql.end();
  } catch (e: any) {
    console.error(`[AUTH] resend lookup failed for ${email}: ${e?.message || 'Unknown error'}`);
    return c.json({ message: genericMsg, email_sent: false });
  }

  if (users.length === 0) {
    return c.json({ message: genericMsg, email_sent: false });
  }

  const user = users[0];

  const totpConfigured = await hasTotpConfigured(c.env, user.id);
  if (user.email_verified && totpConfigured) {
    return c.json({ message: genericMsg, email_sent: false, already_verified: true });
  }

  if (!user.email_verified || !totpConfigured) {
    try {
      const sql = getSQL(c.env);
      // Task #1 — clear half-finished TOTP state on resend so the user gets
      // a fresh enrolment slot. We delete the auth_totp row directly (no
      // password_hash mutation needed: it's already independent now).
      await sql`UPDATE users SET email_verified = false WHERE id = ${user.id}`;
      await sql.end();
      try { await clearTotp(c.env, user.id); } catch (e) { console.error('[AUTH] clearTotp on resend failed', e); }
    } catch (e: any) {
      console.error(`[AUTH] resend reset failed for ${email}: ${e?.message || 'Unknown error'}`);
    }
  }

  try {
    const { sent, verificationUrl, tokenStored } = await sendVerification(c.env, email, user.name, user.id);
    return c.json({
      message: genericMsg,
      email_sent: sent,
      verification_url: !sent && tokenStored ? verificationUrl : undefined,
    });
  } catch (e: any) {
    console.error(`[AUTH] resend send failed for ${email}: ${e?.message || 'Unknown error'}`);
    return c.json({ message: genericMsg, email_sent: false });
  }
});

auth.get('/verify-email', safe('verify-email', 'Could not verify your email link. Please try again or request a new verification email.', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'Token required' }, 400);

  // T5 — IP-keyed brute-force cap. The verify-email link is a 32-byte secret,
  // so guessing is computationally infeasible — but enumerating against a
  // single IP is still cheap noise we can drop. 10/15min/IP is generous enough
  // that a real user retrying after a typo or refreshing the tab is fine.
  const verifyIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const allowedIp = await checkRateLimit(c.env, `verify-email-ip:${verifyIp}`, 10, 900);
  if (!allowedIp) return c.json({ error: 'Too many verification attempts. Please try again in 15 minutes.' }, 429);

  const tokenHash = await hashToken(token);
  const sql = getSQL(c.env);
  const users = await sql`SELECT * FROM users WHERE verification_token = ${tokenHash}`;
  await sql.end();

  if (users.length === 0) return c.json({ error: 'Invalid or expired verification link.' }, 400);
  const user = users[0];
  if (user.verification_token_expires && new Date() > new Date(user.verification_token_expires)) {
    return c.json({ error: 'Verification link has expired. Please request a new one.' }, 400);
  }

  // T22.2 — narrow response to `{ valid: true }`. Previously echoed
  // user.email + user.name, which leaked PII to anyone replaying the
  // verification token (and to log scrapers capturing the response body).
  // The frontend re-derives email/name via the subsequent
  // POST /confirm-verify-email step, which already requires presenting
  // the same token.
  return c.json({ valid: true });
}));

auth.post('/confirm-verify-email', safe('confirm-verify-email', 'Could not confirm your email. Please try the verification link again or request a new one.', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.res;
  const { token } = parsed.body;
  if (!token) return c.json({ error: 'Token required' }, 400);

  const tokenHash = await hashToken(token);
  const sql = getSQL(c.env);
  const users = await sql`SELECT * FROM users WHERE verification_token = ${tokenHash}`;

  if (users.length === 0) { await sql.end(); return c.json({ error: 'Invalid or expired verification link.' }, 400); }
  const user = users[0];
  if (user.verification_token_expires && new Date() > new Date(user.verification_token_expires)) {
    await sql.end();
    return c.json({ error: 'Verification link has expired.' }, 400);
  }

  const setupToken = generateToken();
  const setupHash = await hashToken(setupToken);
  const setupExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await sql`UPDATE users SET email_verified = true, verification_token = ${setupHash}, verification_token_expires = ${setupExpires} WHERE id = ${user.id}`;
  // T22.1 — PII redaction: drop name/email from details; actor stores hash.
  const verifEmailHash = await hashEmail(user.email);
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('email_verified', ${`email verified (email_hash=${verifEmailHash})`}, ${verifEmailHash}, ${user.id})`;
  await sql.end();

  return c.json({ verified: true, email: user.email, name: user.name, setup_token: setupToken });
}));

auth.post('/setup-totp', safe('setup-totp', 'Could not set up authenticator. Please try again or request a new verification email.', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.res;
  const { email, token } = parsed.body;
  if (!email || !token) return c.json({ error: 'Email and token required' }, 400);

  const sql = getSQL(c.env);
  const users = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (users.length === 0) { await sql.end(); return c.json({ error: 'User not found' }, 404); }

  const user = users[0];
  if (!user.email_verified) { await sql.end(); return c.json({ error: 'Email not verified.' }, 403); }

  const tokenHash = await hashToken(token);
  if (user.verification_token !== tokenHash) { await sql.end(); return c.json({ error: 'Invalid setup token.' }, 403); }
  if (user.verification_token_expires && new Date() > new Date(user.verification_token_expires)) {
    await sql.end(); return c.json({ error: 'Setup token expired.' }, 403);
  }
  if (await hasTotpConfigured(c.env, user.id)) { await sql.end(); return c.json({ error: 'TOTP is already configured.' }, 409); }

  const secret = new Secret();
  const totp = new TOTP({ issuer: 'Axal VC StudioOS', label: email, secret });
  const totpSecret = secret.base32;

  // T5 — mint 10 single-use recovery codes at enrolment so the user is never
  // permanently locked out if they lose their authenticator. Plaintext codes
  // are returned to the caller exactly once in this response; the server only
  // ever stores SHA-256 hashes.
  const { plain: recoveryCodes, hashes: recoveryHashes } = await mintRecoveryCodes();

  // Task #1 — TOTP secrets live exclusively in `auth_totp` (encrypted).
  // `users.password_hash` is deliberately untouched here: the column is
  // reserved for real credential storage and "is TOTP configured?" is
  // now derived from `hasTotpConfigured(env, userId)` (auth_totp row
  // presence) at every call site.
  await persistNewTotpEnrolment(c.env, user.id, totpSecret, recoveryHashes);
  // Task #6 — keep tfa_methods in lock-step with the auth_totp row so the
  // factor-discovery endpoint and SettingsPage Security tab both see TOTP
  // immediately. Best-effort; older DBs without the column silently no-op.
  try { await setUserFactor(c.env, user.id, 'totp'); } catch {}
  await sql`UPDATE users SET totp_recovery_codes = ${JSON.stringify(recoveryHashes)}, verification_token = NULL, verification_token_expires = NULL WHERE id = ${user.id}`;
  await sql.end();

  const uri = totp.toString();
  let qrBase64: string | null = null;
  try {
    qrBase64 = await QRCode.toDataURL(uri);
    qrBase64 = qrBase64.replace('data:image/png;base64,', '');
  } catch {}

  return c.json({
    user_id: user.id, email: user.email, name: user.name, role: user.role,
    totp_secret: totpSecret, provisioning_uri: uri, qr_code: qrBase64,
    recovery_codes: recoveryCodes,
    message: 'Scan the QR code with your authenticator app, then use the TOTP code to log in. Save the recovery codes — they will not be shown again.',
  });
}));

auth.post('/login', safe('login', 'Login failed. Please try again in a moment, or contact support if the problem persists.', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.res;
  const { email, totp_code, turnstileToken } = parsed.body;
  if (!email || !totp_code) return c.json({ error: 'Email and TOTP code required' }, 400);

  // Cloudflare Turnstile — bot-protect the password-equivalent factor on
  // login (mirrors /register). verifyTurnstile() fails CLOSED in
  // production when TURNSTILE_SECRET_KEY is missing and fails OPEN in
  // dev/preview so local sign-in still works without the secret.
  const clientIp = c.req.header('cf-connecting-ip') || undefined;
  const turnstileOk = await verifyTurnstile(c.env, turnstileToken, clientIp);
  if (!turnstileOk) {
    try {
      const emailHash = await hashEmail(email);
      let ipBucket = 'unknown';
      if (clientIp) {
        if (clientIp.includes(':')) ipBucket = clientIp.split(':').slice(0, 3).join(':') + '::/48';
        else ipBucket = clientIp.split('.').slice(0, 3).join('.') + '.0/24';
      }
      const sql = getSQL(c.env);
      await sql`INSERT INTO activity_logs (action, details, actor)
                VALUES ('turnstile_failed',
                        ${`login attempt blocked: email_hash=${emailHash} ip_bucket=${ipBucket}`},
                        ${ipBucket})`;
      await sql.end();
    } catch (e) {
      console.error('[AUTH] failed to log turnstile failure on login', e);
    }
    return c.json({ error: 'Bot verification failed. Please try again.' }, 403);
  }

  const allowed = await checkRateLimit(c.env, `login:${email.toLowerCase()}`, 5, 300);
  if (!allowed) return c.json({ error: 'Too many attempts. Try again in 5 minutes.' }, 429);

  const sql = getSQL(c.env);
  const users = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (users.length === 0) { await sql.end(); return c.json({ error: 'Invalid credentials' }, 401); }

  const user = users[0];
  if (!user.email_verified) { await sql.end(); return c.json({ error: 'Please verify your email before logging in.' }, 403); }
  if (!user.is_active) { await sql.end(); return c.json({ error: 'Account is inactive' }, 403); }
  // Task #1 — "TOTP configured?" is sourced from `auth_totp` row presence
  // (with a fallback to a legacy base32 secret pending migration). We no
  // longer gate on `users.password_hash`: that column is reserved for
  // future real-credential storage and must not double as a 2FA flag.
  if (!(await hasTotpConfigured(c.env, user.id))) {
    await sql.end();
    return c.json({ error: 'Account not set up for TOTP authentication' }, 401);
  }

  // Task #33 — load TOTP secret from `auth_totp` (preferred) with lazy
  // migration off the legacy `users.password_hash` storage. Returns null
  // if no usable TOTP secret exists for the user. Task #1 — when the
  // migration runs (source === 'legacy'), the user's `password_hash` was
  // misused for TOTP storage and is now NULLed + `password_reset_required`
  // is set to 1; we surface that flag to the SPA AND fire a forced
  // password-reset email so the user re-establishes a clean credential.
  const totpRow = await loadTotp(c.env, user.id, user.password_hash, user.totp_recovery_codes);
  if (!totpRow) { await sql.end(); return c.json({ error: 'Account not set up for TOTP authentication' }, 401); }
  const totp = new TOTP({ secret: Secret.fromBase32(totpRow.secret) });
  const delta = totp.validate({ token: totp_code, window: 1 });
  let usedRecoveryCode = false;
  if (delta === null) {
    // T5 — fall back to recovery code consumption. We try this only after the
    // 6-digit TOTP fails so the common path stays fast. Single-use enforcement
    // is in tryConsumeRecoveryCode (atomic UPDATE removes the hash).
    await sql.end();
    usedRecoveryCode = await tryConsumeRecoveryCode(c.env, user.id, totp_code);
    if (!usedRecoveryCode) return c.json({ error: 'Invalid TOTP code' }, 401);
  } else {
    // Best-effort audit field on auth_totp.last_used_at — non-fatal if it fails.
    await markTotpUsed(c.env, user.id);
  }
  const sql2 = usedRecoveryCode ? getSQL(c.env) : sql;

  // Epic 3 — mint a session-bound JWT. The jti claim ties the token to a
  // row in user_sessions so the user can list and revoke individual devices
  // from /settings. Falls back gracefully if the table doesn't exist yet
  // (auth.ts already handles missing-table on the verify side).
  const jti = crypto.randomUUID();
  const jwtToken = await createJWT(c.env, user.id, user.email, user.role, undefined, jti);
  const ua = (c.req.header('user-agent') || '').slice(0, 500);
  const ip = (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64);
  try {
    // Task #6 — record the factor that minted this session so requireFactor()
    // can step-up gate high-risk routes. Recovery-code logins are tracked
    // distinctly from real TOTP — they DO NOT count as "totp" for step-up
    // purposes, so an attacker holding a printed code can't escalate to
    // impersonation/billing/contract-void without re-arming TOTP.
    const sessionFactor = usedRecoveryCode ? 'recovery' : 'totp';
    await sql2`INSERT INTO user_sessions (user_id, jti, user_agent, ip, factor)
              VALUES (${user.id}, ${jti}, ${ua || null}, ${ip || null}, ${sessionFactor})`;
  } catch {
    // Table not migrated yet; the JWT still works (auth.ts skips the check).
  }
  // T22.1 — PII redaction on login: drop user.name from details, store
  // email_hash as actor instead of plaintext email. user_id remains the
  // canonical FK back to the user row.
  const loginEmailHash = await hashEmail(user.email);
  const loginAction = usedRecoveryCode ? 'user_login_recovery_code' : 'user_login';
  const loginDetails = usedRecoveryCode
    ? `login via recovery code (email_hash=${loginEmailHash})`
    : `login (email_hash=${loginEmailHash})`;
  await sql2`INSERT INTO activity_logs (action, details, actor, user_id) VALUES (${loginAction}, ${loginDetails}, ${loginEmailHash}, ${user.id})`;
  await sql2.end();

  // T6 — issue httpOnly auth cookie + readable CSRF cookie alongside the
  // JSON token. Frontend `api.js` will pick up the cookie automatically
  // (credentials: 'include'); legacy direct-fetch callers (websocket
  // subprotocol, signed-download URLs, impersonation flow) keep using the
  // JSON `token` field via localStorage until they migrate. Both auth
  // paths end at the same JWT, so the worker accepts whichever arrives.
  // Task #4 — revoke any incoming stale session that belongs to a different
  // user BEFORE we overwrite the cookie. Stops a lingering admin JWT in
  // localStorage (or a still-valid `studioos_auth` cookie from a prior
  // browser user) from being replayed from outside the browser even after
  // the SPA's identity-change purge wipes localStorage.
  await revokeStaleCrossIdentitySession(c, user.id);

  const csrfToken = generateCsrfToken();
  setAuthCookies(c, jwtToken, csrfToken);

  // Task #1 — surface password_reset_required so the SPA can route the user
  // straight to the recovery flow. Re-read the flag from the row we just
  // touched (the lazy TOTP migration may have just set it to 1 above).
  let passwordResetRequired = Number(user.password_reset_required ?? 0) === 1;
  if (totpRow.source === 'legacy') {
    passwordResetRequired = true;
    // Fire-and-forget: email failures must not block login. We use
    // executionCtx.waitUntil so the worker doesn't return before the
    // outbound HTTPS call lands, but the response is still sent immediately.
    try {
      const sendForcedResetEmail = async () => {
        try {
          const { sendNotificationEmail } = await import('../services/email');
          await sendNotificationEmail(
            c.env,
            user.email,
            'Action required: re-establish your Axal StudioOS sign-in',
            `Hi ${user.name || ''},\n\n` +
            `As part of a security upgrade, your account requires you to ` +
            `re-establish your sign-in credential. Please visit ` +
            `${(c.env as { APP_URL?: string }).APP_URL || 'https://axal.vc'}/settings ` +
            `and complete the password-reset flow.\n\n` +
            `If you did not just sign in, please contact support immediately.`,
          );
        } catch (e) {
          console.error('[auth] forced reset email failed', e);
        }
      };
      const ctx = (c as { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } }).executionCtx;
      if (ctx?.waitUntil) ctx.waitUntil(sendForcedResetEmail());
      else void sendForcedResetEmail();
    } catch (e) {
      console.error('[auth] forced reset dispatch failed', e);
    }
  }

  return c.json({
    token: jwtToken,
    csrf_token: csrfToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    expires_in: 24 * 3600,
    used_recovery_code: usedRecoveryCode || undefined,
    password_reset_required: passwordResetRequired || undefined,
  });
}));

// T6 — server-side logout. Clears the cookie pair AND revokes the current
// session row in user_sessions (so a stolen Bearer copy of the same JWT can
// no longer be used either). Tolerant of unauth'd calls — logout should
// always succeed from the user's POV, even if the cookie is already gone.
auth.post('/logout', safe('logout', 'Logout failed.', async (c) => {
  // Best-effort session revocation. We don't await requireAuth() because
  // that would 401 a session whose cookie expired client-side — and the
  // user still wants the cookie cleared in that case.
  try {
    const authHeader = c.req.header('Authorization');
    let token: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else {
      const cookieHeader = c.req.header('Cookie') || '';
      for (const part of cookieHeader.split(';')) {
        const t = part.trim();
        if (t.startsWith('studioos_auth=')) { token = t.slice('studioos_auth='.length); break; }
      }
    }
    if (token) {
      const { decodeJWT } = await import('../auth');
      try {
        const payload = await decodeJWT(c.env, token);
        if (payload?.jti) {
          try {
            await c.env.DB.prepare(
              "UPDATE user_sessions SET revoked_at = datetime('now') WHERE jti = ? AND user_id = ? AND revoked_at IS NULL"
            ).bind(payload.jti, payload.user_id).run();
          } catch {}
        }
      } catch {}
    }
  } catch (e) {
    console.error('[AUTH:logout] session revoke failed (non-fatal):', e);
  }
  clearAuthCookies(c);
  return c.json({ ok: true });
}));

auth.get('/me', async (c) => {
  const user = await requireAuth(c);
  // Self-healing FK backfill: if the user's role implies a founder
  // or partner profile but the corresponding ID is null, lazy-create
  // the row and link it. Idempotent + non-throwing — degrades to the
  // current IDs on any DB error.
  let founderId: number | null = user.founder_id ?? null;
  let partnerId: number | null = (user as unknown as { partner_id?: number | null }).partner_id ?? null;
  try {
    const { ensureRoleProfile } = await import('../services/ensureRoleProfile');
    const ids = await ensureRoleProfile(c.env, user);
    founderId = ids.founder_id;
    partnerId = ids.partner_id;
  } catch (e) {
    console.error('[auth:/me] ensureRoleProfile failed:', (e as Error).message);
  }
  return c.json({
    id: user.id, email: user.email, name: user.name, role: user.role,
    is_active: user.is_active, created_at: user.created_at,
    founder_id: founderId, partner_id: partnerId,
    kyc_status: (user as any).kyc_status || 'not_started',
    // 'limited' lets the user past the KYC gate to browse the app, but
    // they still cannot sign legal agreements (server-enforced in esign).
    // null means normal flow: full access requires kyc_status='approved'.
    access_level: (user as any).access_level || null,
    // LinkedIn identity (Refer & Earn). Columns are added lazily by
    // routes/linkedin.ts; null on rows that pre-date the migration.
    linkedin_sub: (user as any).linkedin_sub || null,
    linkedin_email: (user as any).linkedin_email || null,
    linkedin_name: (user as any).linkedin_name || null,
    // Task #5 — gate the dashboard personal-assistant launcher. Onboarding
    // /complete flips this to 1 once role detection is done. NULL on rows
    // that pre-date the migration; coerce to 0 so the UI hides the launcher
    // until the user has actually completed onboarding.
    // Mirror the /api/assistant/* mount gate in src/index.ts: if the
    // assistant route is closed (production, or ENABLE_ANTHROPIC_DEV !== '1'
    // on dev/preview), force the flag to 0 so the dashboard launcher hides
    // instead of rendering and then erroring with "not_found" when the user
    // sends a message.
    assistant_enabled: (() => {
      const e = c.env as any;
      const prod = e?.STAGE === 'production' || e?.ENVIRONMENT === 'production';
      if (prod || e?.ENABLE_ANTHROPIC_DEV !== '1') return 0;
      return ((user as any).assistant_enabled ?? 0) ? 1 : 0;
    })(),
    // Task #6 — founder subscription tier (FREE / GROWTH / STUDIO).
    // Bypass roles (admin/partner/investor/mentor) still receive these
    // fields so the frontend can display them, but tier gates are no-ops.
    subscription_tier: (user as any).subscription_tier || 'free',
    subscription_status: (user as any).subscription_status || 'active',
    subscription_renews_at: (user as any).subscription_renews_at || null,
    stripe_customer_id: (user as any).stripe_customer_id || null,
    stripe_subscription_id: (user as any).stripe_subscription_id || null,
    // Task #50 — recovery state. cool_off_until > now disables sensitive
    // surfaces (billing/contracts/capital/DD/KYC/impersonation). step_up_due_at
    // is set on lower-assurance ('email_only') sessions; the SPA nags the
    // user to re-enrol TOTP / passkey before the deadline.
    recovery_cool_off_until: (user as any).recovery_cooling_off_until || null,
    recovery_step_up_due_at: (user as any).recovery_step_up_due_at || null,
    // Explicit boolean — true if ANY recovery ticket on this account
    // is still in flight. The SPA shows a persistent "Recovery in
    // progress" banner while this is true.
    recovery_pending: await (async () => {
      try {
        const row: any = await c.env.DB.prepare(
          `SELECT 1 FROM auth_recovery_tickets
           WHERE user_id = ?
             AND status IN ('open','awaiting_contacts','awaiting_admin','awaiting_admin_cosign')
           LIMIT 1`,
        ).bind(user.id).first();
        return !!row;
      } catch { return false; }
    })(),
  });
});

auth.post('/verify-totp', safe('verify-totp', 'Could not verify your code. Please try again.', async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return parsed.res;
  const { email, totp_code } = parsed.body;
  if (!email || !totp_code) return c.json({ error: 'Email and TOTP code required' }, 400);
  const allowed = await checkRateLimit(c.env, `login:${email.toLowerCase()}`, 5, 300);
  if (!allowed) return c.json({ error: 'Too many attempts.' }, 429);

  const sql = getSQL(c.env);
  const users = await sql`SELECT * FROM users WHERE email = ${email}`;
  await sql.end();

  if (users.length === 0) return c.json({ error: 'Invalid credentials' }, 401);
  // Task #33 — read TOTP via authTotp (auth_totp table → fallback legacy column).
  const totpRow = await loadTotp(c.env, users[0].id, users[0].password_hash, users[0].totp_recovery_codes);
  if (!totpRow) return c.json({ error: 'Invalid credentials' }, 401);
  const totp = new TOTP({ secret: Secret.fromBase32(totpRow.secret) });
  const valid = totp.validate({ token: totp_code, window: 1 }) !== null;
  return c.json({ valid });
}));

// Task #6 — mount SMS 2FA endpoints (and the /factors discovery endpoint)
// onto the same /api/auth prefix. Kept in a separate file (auth_sms.ts)
// so this router stays small and the SMS surface can be lifted out for
// independent rate-limit / observability tuning later.
auth.route('/', smsRoutes);

export default auth;
