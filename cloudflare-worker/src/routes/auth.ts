import { Hono } from 'hono';
import { TOTP, Secret } from 'otpauth';
import * as QRCode from 'qrcode';
import type { Env } from '../types';
import { getSQL } from '../db';
import { createJWT, hashToken, generateToken, requireAuth } from '../auth';
import { sendVerificationEmail } from '../services/email';
import { verifyTurnstile } from '../services/turnstile';

const auth = new Hono<{ Bindings: Env }>();

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

auth.post('/register', async (c) => {
  const { email, name, role, turnstileToken, ref_code } = await c.req.json();
  if (!email || !name) return c.json({ error: 'Email and name required' }, 400);
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRe.test(String(email).trim())) return c.json({ error: 'Please enter a valid email address' }, 400);
  if (role && !['founder', 'partner'].includes(role)) return c.json({ error: 'Invalid role' }, 400);

  const clientIp = c.req.header('cf-connecting-ip') || undefined;
  const turnstileOk = await verifyTurnstile(c.env, turnstileToken, clientIp);
  if (!turnstileOk) {
    // Audit-log the failed attempt so we can spot abuse patterns. We store
    // a SHA-256 hash of the email + a /24-truncated IP rather than raw PII —
    // the failed submitter never authenticated and we have no consent /
    // legitimate-interest basis to retain their plain email indefinitely.
    try {
      const enc = new TextEncoder();
      const emailHashBuf = await crypto.subtle.digest('SHA-256', enc.encode(String(email).toLowerCase().trim()));
      const emailHash = Array.from(new Uint8Array(emailHashBuf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
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
    if (user.email_verified && user.password_hash) {
      await sql.end();
      return c.json({ error: 'Email already registered' }, 409);
    }
    await sql`UPDATE users SET name = ${name}, role = ${role || 'partner'} WHERE id = ${user.id}`;
    await sql.end();
    try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: 'partner', id: user.id }); } catch {}
    const { sent: emailSent, verificationUrl, tokenStored } = await sendVerification(c.env, email, name, user.id);
    return c.json({
      message: emailSent ? 'Verification email sent' : 'Account created but email delivery failed',
      email, name, requires_verification: true, email_sent: emailSent, verification_url: !emailSent && tokenStored ? verificationUrl : undefined
    });
  }

  const [user] = await sql`INSERT INTO users (email, name, role, email_verified) VALUES (${email}, ${name}, ${role || 'partner'}, false) RETURNING *`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('user_registered', ${`User ${name} (${email}) registered as ${role || 'partner'} — pending email verification`}, ${email}, ${user.id})`;
  await sql.end();
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: 'partner', id: user.id }); } catch {}

  if (ref_code) {
    try {
      const { attachReferral } = await import('./network');
      const linked = await attachReferral(c.env, user.id, String(ref_code).toUpperCase());
      if (linked) {
        const sql2 = getSQL(c.env);
        await sql2`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('referral_attached', ${`Joined via referral code ${ref_code}`}, ${email}, ${user.id})`;
        await sql2.end();
      }
    } catch (e) { console.error('attachReferral failed:', e); }
  }

  const { sent: emailSent, verificationUrl, tokenStored } = await sendVerification(c.env, email, name, user.id);
  return c.json({
    message: emailSent ? 'Verification email sent' : 'Account created but email delivery failed',
    email: user.email, name: user.name, requires_verification: true, email_sent: emailSent, verification_url: !emailSent && tokenStored ? verificationUrl : undefined
  });
});

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

  if (user.email_verified && user.password_hash) {
    return c.json({ message: genericMsg, email_sent: false, already_verified: true });
  }

  if (!user.email_verified || !user.password_hash) {
    try {
      const sql = getSQL(c.env);
      await sql`UPDATE users SET email_verified = false, password_hash = NULL WHERE id = ${user.id}`;
      await sql.end();
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

auth.get('/verify-email', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'Token required' }, 400);

  const tokenHash = await hashToken(token);
  const sql = getSQL(c.env);
  const users = await sql`SELECT * FROM users WHERE verification_token = ${tokenHash}`;
  await sql.end();

  if (users.length === 0) return c.json({ error: 'Invalid or expired verification link.' }, 400);
  const user = users[0];
  if (user.verification_token_expires && new Date() > new Date(user.verification_token_expires)) {
    return c.json({ error: 'Verification link has expired. Please request a new one.' }, 400);
  }

  return c.json({ valid: true, email: user.email, name: user.name });
});

auth.post('/confirm-verify-email', async (c) => {
  const { token } = await c.req.json();
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
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('email_verified', ${`User ${user.name} (${user.email}) verified their email`}, ${user.email}, ${user.id})`;
  await sql.end();

  return c.json({ verified: true, email: user.email, name: user.name, setup_token: setupToken });
});

auth.post('/setup-totp', async (c) => {
  const { email, token } = await c.req.json();
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
  if (user.password_hash) { await sql.end(); return c.json({ error: 'TOTP is already configured.' }, 409); }

  const secret = new Secret();
  const totp = new TOTP({ issuer: 'Axal VC StudioOS', label: email, secret });
  const totpSecret = secret.base32;

  await sql`UPDATE users SET password_hash = ${totpSecret}, verification_token = NULL, verification_token_expires = NULL WHERE id = ${user.id}`;
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
    message: 'Scan the QR code with your authenticator app, then use the TOTP code to log in.',
  });
});

auth.post('/login', async (c) => {
  const { email, totp_code } = await c.req.json();
  if (!email || !totp_code) return c.json({ error: 'Email and TOTP code required' }, 400);

  const allowed = await checkRateLimit(c.env, `login:${email.toLowerCase()}`, 5, 300);
  if (!allowed) return c.json({ error: 'Too many attempts. Try again in 5 minutes.' }, 429);

  const sql = getSQL(c.env);
  const users = await sql`SELECT * FROM users WHERE email = ${email}`;
  if (users.length === 0) { await sql.end(); return c.json({ error: 'Invalid credentials' }, 401); }

  const user = users[0];
  if (!user.email_verified) { await sql.end(); return c.json({ error: 'Please verify your email before logging in.' }, 403); }
  if (!user.password_hash) { await sql.end(); return c.json({ error: 'Account not set up for TOTP authentication' }, 401); }
  if (!user.is_active) { await sql.end(); return c.json({ error: 'Account is inactive' }, 403); }

  const totp = new TOTP({ secret: Secret.fromBase32(user.password_hash) });
  const delta = totp.validate({ token: totp_code, window: 1 });
  if (delta === null) { await sql.end(); return c.json({ error: 'Invalid TOTP code' }, 401); }

  const jwtToken = await createJWT(c.env, user.id, user.email, user.role);
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('user_login', ${`User ${user.name} logged in`}, ${user.email}, ${user.id})`;
  await sql.end();

  return c.json({
    token: jwtToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    expires_in: 24 * 3600,
  });
});

auth.get('/me', async (c) => {
  const user = await requireAuth(c);
  return c.json({
    id: user.id, email: user.email, name: user.name, role: user.role,
    is_active: user.is_active, created_at: user.created_at,
    kyc_status: (user as any).kyc_status || 'not_started',
  });
});

auth.post('/verify-totp', async (c) => {
  const { email, totp_code } = await c.req.json();
  const allowed = await checkRateLimit(c.env, `login:${email.toLowerCase()}`, 5, 300);
  if (!allowed) return c.json({ error: 'Too many attempts.' }, 429);

  const sql = getSQL(c.env);
  const users = await sql`SELECT * FROM users WHERE email = ${email}`;
  await sql.end();

  if (users.length === 0 || !users[0].password_hash) return c.json({ error: 'Invalid credentials' }, 401);

  const totp = new TOTP({ secret: Secret.fromBase32(users[0].password_hash) });
  const valid = totp.validate({ token: totp_code, window: 1 }) !== null;
  return c.json({ valid });
});

export default auth;
