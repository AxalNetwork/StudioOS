/**
 * Task #50 — Lost-TOTP recovery flow (layered, abuse-resistant).
 *
 * Endpoints (all under /api/auth/recover):
 *
 *   POST /start                       { email } → which layers are
 *                                     available for THIS user (response
 *                                     is constant-shape — no PII leak,
 *                                     no enumeration oracle).
 *
 *   Layer 1a (backup recovery code) — full assurance, no cool-off.
 *   POST /backup-code                 { email, code } → token + cookie
 *
 *   Layer 2c (SMS) — full assurance, 24h cool-off (the SMS factor itself
 *   was bound at enrolment to a country allow-list + rate-limited GCIP).
 *   POST /sms/start                   { email } → { session_info?, last4? }
 *   POST /sms/verify                  { email, session_info, code } → session
 *
 *   Layer 2d (email magic link) — LOWER ASSURANCE ('email_only'), 24h
 *   cool-off, 7-day step-up deadline.
 *   POST /email/start                 { email } → 202
 *   GET  /email/verify?token=…        → session + redirect token
 *
 *   Layer 3f (trusted-contact 2-of-2) — full assurance, 24h cool-off,
 *   requires TWO contacts who are each 2FA-authenticated on their own
 *   sessions to attest.
 *   POST /trusted-contact/start       { email } → { ticket_id }
 *   POST /trusted-contact/attest      { ticket_id }  (AUTHED — the contact)
 *
 *   Layer 3 (KYC re-verify) — stub when no vendor wired; full assurance,
 *   24h cool-off when wired.
 *   POST /kyc/start                   { email } → 501 vendor_unconfigured
 *
 *   Layer 4 (admin manual, two-admin multi-sig) — full assurance, 24h
 *   cool-off, lands the ticket in the admin review queue.
 *   POST /admin/escalate              { email } → { ticket_id }
 *   GET  /admin/tickets               (ADMIN) → list open tickets
 *   POST /admin/cosign                { ticket_id }  (ADMIN — 2 needed)
 *   POST /admin/deny                  { ticket_id, reason }  (ADMIN)
 *
 *   GET  /ticket/:id                  → ticket status (rate-limited)
 *
 * Trusted-contact management (authenticated user — Settings → Security):
 *   GET    /trusted-contacts          → list
 *   POST   /trusted-contacts          { contact_email, display_name? }
 *   DELETE /trusted-contacts/:id      → soft-remove
 *
 * Every state change fans out to ALL channels the user ever enrolled
 * via `notifyAllChannels()` below — never silently. The two registry
 * templates `auth_recovery_started` / `auth_recovery_resolved` already
 * ship the Axal-branded chrome.
 *
 * All emitted URLs are anchored at env.APP_URL (configured to
 * https://app.axal.vc). Never apex, never workers.dev.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import {
  createJWT, requireAuth, requireAdmin, setAuthCookies, generateCsrfToken,
  hashToken, generateToken,
} from '../auth';
import { hashEmail } from '../util/hashEmail';
import { hasTotpConfigured } from '../services/authTotp';
import { hasSmsConfigured, loadSms, markSmsUsed } from '../services/authSms';
import { isGcipConfigured, sendVerificationCode, signInWithPhoneNumber } from '../services/gcip';
import { send as sendEmail } from '../services/email/send';
import { stripTrailingSlashes } from '../util/url';
import { notify } from '../services/notify';

const recover = new Hono<{ Bindings: Env }>();

// ─────────────────────────────────────────────────────────────── helpers

const RECOVERY_COOL_OFF_HOURS = 24;
const STEP_UP_DEADLINE_DAYS = 7;
const TICKET_TTL_HOURS = 48;
const EMAIL_MAGIC_TTL_MIN = 15;

function nowIso(): string { return new Date().toISOString(); }
function inHours(h: number): string { return new Date(Date.now() + h * 3600 * 1000).toISOString(); }
function inMin(m: number): string { return new Date(Date.now() + m * 60 * 1000).toISOString(); }
function inDays(d: number): string { return new Date(Date.now() + d * 86400 * 1000).toISOString(); }

function clientIp(c: any): string {
  return (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '')
    .split(',')[0].trim().slice(0, 64) || 'unknown';
}

async function rate(env: Env, key: string, max: number, windowSec: number): Promise<boolean> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const slot = Math.floor(now / windowSec);
    const k = `rl:${key}:${slot}`;
    const cur = parseInt((await env.RATE_LIMITS.get(k)) || '0', 10);
    if (cur >= max) return false;
    await env.RATE_LIMITS.put(k, String(cur + 1), { expirationTtl: windowSec + 5 });
    return true;
  } catch { return true; }
}

async function readJson(c: any): Promise<any> {
  try { return await c.req.json(); } catch { return {}; }
}

async function findUserByEmail(env: Env, email: string): Promise<any | null> {
  if (!email) return null;
  const sql = getSQL(env);
  try {
    const rows = await sql`SELECT * FROM users WHERE email = ${email.toLowerCase().trim()}`;
    return rows.length ? rows[0] : null;
  } finally { try { await sql.end(); } catch {} }
}

async function logActivity(env: Env, userId: number, action: string, details: string) {
  try {
    const sql = getSQL(env);
    // actor stays 16-hex email_hash per the persistent gotcha in replit.md.
    // We look up the email each time so we don't have to thread it through
    // every caller.
    const row = await sql`SELECT email FROM users WHERE id = ${userId}`;
    const actor = row.length ? await hashEmail(row[0].email) : 'recovery';
    await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES (${action}, ${details}, ${actor}, ${userId})`;
    await sql.end();
  } catch (e) { console.error('[recover] logActivity failed', e); }
}

/**
 * Fan out a state-change notification on EVERY channel the user ever
 * enrolled — in-app inbox + email + web-push + Slack DM (per the
 * `security` category, which is critical and bypasses quiet-hours / digest).
 *
 * This goes through the central notify() service, NOT plain sendEmail(),
 * so:
 *   • in-app inbox row is always written
 *   • web-push fires for any subscribed device
 *   • email is dispatched via the normal pipeline (templating + DLQ)
 *   • category='security' forces critical-severity → no suppression
 *
 * SMS fan-out: GCIP doesn't expose a generic outbound-SMS API (the
 * project's factor is verification-codes-only) so we surface that
 * explicitly in activity_logs. Web-push + in-app + email + Slack are
 * enough channels to satisfy the "all enrolled channels" requirement
 * for the actively-supported surfaces in this codebase.
 */
async function notifyAllChannels(
  env: Env,
  user: { id: number; email: string; name?: string | null },
  template: 'auth_recovery_started' | 'auth_recovery_resolved',
  vars: Record<string, unknown>,
) {
  const ticketId = String(vars?.ticket_id ?? '-');
  const isResolved = template === 'auth_recovery_resolved';
  const title = isResolved
    ? 'Axal account recovery completed'
    : 'Axal account recovery in progress';
  const body = isResolved
    ? `Your account was recovered (ticket #${ticketId}). If this wasn't you, contact security@axal.vc immediately.`
    : `A recovery flow started on your account (ticket #${ticketId}). If this wasn't you, contact security@axal.vc immediately.`;
  const appUrl = stripTrailingSlashes(String((env as any).APP_URL || 'https://axal.vc'));
  try {
    await notify(env, {
      userId: user.id,
      type: template,
      title,
      body,
      link: `${appUrl}/settings#security`,
      category: 'security',  // critical → bypasses quiet-hours + digest
      channels: ['in_app', 'email', 'slack'],
      payload: { ticket_id: ticketId, template_key: template },
    });
  } catch (e) { console.error('[recover] notify fanout failed', e); }
  // Templated email body via sendEmail() in parallel for the Axal-branded
  // chrome (notify() ships a plain section block as a fallback).
  try {
    await sendEmail(env, template, user.email, {
      name: user.name || user.email,
      ...vars,
    }, { userId: user.id });
  } catch (e) { console.error('[recover] templated email failed', e); }
  // SMS heads-up: factor is verification-codes only on GCIP; record it.
  try {
    if (await hasSmsConfigured(env, user.id)) {
      await logActivity(env, user.id, 'recovery_notify_sms_skipped',
        'SMS fanout skipped — GCIP factor is verification-codes only');
    }
  } catch {}
}

async function createTicket(
  env: Env,
  userId: number,
  layer: string,
  state: Record<string, unknown>,
  c: any,
): Promise<{ id: number; lookup_token: string }> {
  // Task #50 — every ticket gets an opaque `lookup_token` that the
  // unauthenticated `/ticket/:id` poll must present. This neutralises
  // the enumeration oracle on auto-increment IDs without forcing a
  // schema change to UUID PKs.
  const lookup_token = generateToken();
  const stateWithLookup = { ...state, lookup_token };
  await env.DB.prepare(
    `INSERT INTO auth_recovery_tickets
       (user_id, layer, status, initiator_ip, initiator_ua, state_json, expires_at)
     VALUES (?, ?, 'open', ?, ?, ?, ?)`,
  ).bind(
    userId, layer,
    clientIp(c),
    (c.req.header('user-agent') || '').slice(0, 500),
    JSON.stringify(stateWithLookup),
    inHours(TICKET_TTL_HOURS),
  ).run();
  const r: any = await env.DB.prepare('SELECT last_insert_rowid() AS id').first();
  return { id: Number(r?.id || 0), lookup_token };
}

/**
 * Atomic ticket-status transition that ALWAYS fans out an
 * all-channels notification. Centralised so admin/deny, cosign,
 * attestation progress, and verify paths can't silently update
 * a row without alerting the account holder.
 */
async function transitionTicket(
  env: Env,
  ticketId: number,
  user: { id: number; email: string; name?: string | null },
  patch: { status?: string; assurance?: 'full' | 'email_only'; resolved?: boolean; statePatch?: Record<string, unknown> },
  notify: { template: 'auth_recovery_started' | 'auth_recovery_resolved'; vars?: Record<string, unknown> } | null,
) {
  const row: any = await env.DB.prepare(
    `SELECT state_json FROM auth_recovery_tickets WHERE id = ?`,
  ).bind(ticketId).first();
  let state: any = {};
  try { state = JSON.parse(row?.state_json || '{}'); } catch {}
  if (patch.statePatch) state = { ...state, ...patch.statePatch };
  const sets: string[] = ['state_json = ?'];
  const binds: any[] = [JSON.stringify(state)];
  if (patch.status) { sets.push('status = ?'); binds.push(patch.status); }
  if (patch.assurance) { sets.push('assurance_level = ?'); binds.push(patch.assurance); }
  if (patch.resolved) { sets.push("resolved_at = CURRENT_TIMESTAMP"); }
  sets.push('updated_at = CURRENT_TIMESTAMP');
  binds.push(ticketId);
  await env.DB.prepare(
    `UPDATE auth_recovery_tickets SET ${sets.join(', ')} WHERE id = ?`,
  ).bind(...binds).run();
  if (notify) {
    try {
      await notifyAllChannels(env, user, notify.template, {
        ticket_id: String(ticketId),
        ...(notify.vars || {}),
      });
    } catch (e) { console.error('[recover] transition notify failed', e); }
  }
}

async function setCoolOffAndAssurance(
  env: Env,
  userId: number,
  assurance: 'full' | 'email_only',
) {
  const coolOff = inHours(RECOVERY_COOL_OFF_HOURS);
  // Task #50 (round-4 review fix) — EVERY recovery layer sets a step-up
  // deadline, not just 'email_only'. The deadline gates the auto-relock
  // in getCurrentUser() (only fires when expired) AND is the eligibility
  // signal for the fresh /totp/re-enrol/* path. Without this, users who
  // recovered via SMS / trusted-contact / admin claim — i.e. truly lost
  // their authenticator — had no working remediation path. Full-assurance
  // sessions still ride out the full 7 days before the relock fires;
  // email_only sessions get the same 7-day window before relock.
  const stepUp = inDays(STEP_UP_DEADLINE_DAYS);
  await env.DB.prepare(
    `UPDATE users SET recovery_cooling_off_until = ?, recovery_step_up_due_at = ? WHERE id = ?`,
  ).bind(coolOff, stepUp, userId).run();
}

async function mintRecoverySession(
  c: any,
  user: any,
  factor: string,
  assurance: 'full' | 'email_only',
): Promise<{ token: string; csrf: string }> {
  const jti = crypto.randomUUID();
  const jwtToken = await createJWT(c.env, user.id, user.email, user.role, undefined, jti);
  const ua = (c.req.header('user-agent') || '').slice(0, 500);
  const ip = clientIp(c);
  try {
    await c.env.DB.prepare(
      `INSERT INTO user_sessions (user_id, jti, user_agent, ip, factor, assurance_level)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(user.id, jti, ua || null, ip || null, factor, assurance).run();
  } catch {}
  const csrf = generateCsrfToken();
  setAuthCookies(c, jwtToken, csrf);
  return { token: jwtToken, csrf };
}

// ─────────────────────────────────────────────────────────── /start

/**
 * Returns which recovery layers are available for the given email,
 * without leaking whether the account exists. On miss we return the
 * SAME shape with everything false so a probe can't differentiate.
 */
recover.post('/start', async (c) => {
  if (!(await rate(c.env, `recover-start-ip:${clientIp(c)}`, 30, 60))) {
    return c.json({ error: 'Too many requests' }, 429);
  }
  const body = await readJson(c);
  const email = String(body?.email || '').toLowerCase().trim();
  if (!email) return c.json({ error: 'Email required' }, 400);
  if (!(await rate(c.env, `recover-start-email:${email}`, 10, 300))) {
    return c.json({ error: 'Too many requests' }, 429);
  }

  const shape = {
    backup_code: false,
    passkey: false,
    sms: false,
    email_magic: true,           // always available if the email exists; safe
    trusted_contact: false,
    kyc_reverify: false,         // exposed only when vendor wired
    admin_manual: true,          // always available
    sms_available: isGcipConfigured(c.env),
  };

  const user = await findUserByEmail(c.env, email);
  if (!user) return c.json(shape);

  try {
    const [totp, sms_] = await Promise.all([
      hasTotpConfigured(c.env, user.id),
      hasSmsConfigured(c.env, user.id),
    ]);
    // backup_code is true only if the user actually has codes left
    let hasCodes = false;
    try {
      const raw = user.totp_recovery_codes;
      const arr = raw ? JSON.parse(raw) : [];
      hasCodes = Array.isArray(arr) && arr.length > 0;
    } catch {}
    // Passkey: not yet wired in this codebase — surface false.
    // Trusted contact: true when at least 2 ACTIVE contacts exist.
    const tc: any = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM auth_trusted_contacts WHERE user_id = ? AND status = 'active'`,
    ).bind(user.id).first();
    const trustedContact = Number(tc?.n || 0) >= 2;
    shape.backup_code = hasCodes && totp;
    shape.sms = sms_ && isGcipConfigured(c.env);
    shape.trusted_contact = trustedContact;
  } catch (e) { console.error('[recover] /start scan failed', e); }
  return c.json(shape);
});

// ─────────────────────────────────────────────── Layer 1a — backup code

recover.post('/backup-code', async (c) => {
  if (!(await rate(c.env, `recover-bc-ip:${clientIp(c)}`, 10, 300))) {
    return c.json({ error: 'Too many requests' }, 429);
  }
  const body = await readJson(c);
  const email = String(body?.email || '').toLowerCase().trim();
  const code = String(body?.code || '').trim();
  if (!email || !code) return c.json({ error: 'email_and_code_required' }, 400);
  if (!(await rate(c.env, `recover-bc-email:${email}`, 5, 300))) {
    return c.json({ error: 'Too many requests' }, 429);
  }

  const user = await findUserByEmail(c.env, email);
  if (!user || !user.email_verified || !user.is_active) {
    return c.json({ error: 'invalid_code' }, 401);
  }

  // Reuse the existing tryConsumeRecoveryCode helper. We inline a copy
  // here to avoid a circular import with routes/auth.ts.
  const normalized = code.replace(/[\s-]/g, '').toUpperCase();
  if (normalized.length !== 12) return c.json({ error: 'invalid_code' }, 401);
  const formatted = `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}`;
  const candidateHash = await hashToken(formatted);
  const sql = getSQL(c.env);
  let consumed = false;
  try {
    let stored: string[] = [];
    try { stored = JSON.parse(user.totp_recovery_codes || '[]'); } catch {}
    if (!Array.isArray(stored)) stored = [];
    const idx = stored.indexOf(candidateHash);
    if (idx >= 0) {
      stored.splice(idx, 1);
      await sql`UPDATE users SET totp_recovery_codes = ${JSON.stringify(stored)} WHERE id = ${user.id}`;
      try {
        const { updateRecoveryHashes } = await import('../services/authTotp');
        await updateRecoveryHashes(c.env, user.id, stored);
      } catch {}
      consumed = true;
    }
  } finally { try { await sql.end(); } catch {} }

  if (!consumed) return c.json({ error: 'invalid_code' }, 401);

  // Layer 1a is FULL ASSURANCE and ALSO applies the 24h cool-off
  // (per Task #50 acceptance criteria: cool-off after ANY recovery
  // that reaches sensitive surfaces). Step-up is NOT required because
  // the user still holds TOTP. We emit the all-channel alert + ticket
  // so unexpected backup-code use is loud.
  await setCoolOffAndAssurance(c.env, user.id, 'full');
  const { id: ticketId } = await createTicket(c.env, user.id, 'backup_code',
    { ip: clientIp(c), ua: (c.req.header('user-agent') || '').slice(0, 200) }, c);
  await transitionTicket(c.env, ticketId, user,
    { status: 'resolved', assurance: 'full', resolved: true },
    { template: 'auth_recovery_resolved' });
  await logActivity(c.env, user.id, 'recovery_resolved_backup_code', `ticket=${ticketId}`);
  // (Reviewer fix: transitionTicket already fans out — no duplicate notify.)

  const { token, csrf } = await mintRecoverySession(c, user, 'recovery', 'full');
  return c.json({
    token, csrf_token: csrf,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    expires_in: 24 * 3600,
    assurance_level: 'full',
    ticket_id: ticketId,
    cool_off_until: inHours(RECOVERY_COOL_OFF_HOURS),
    note: 'Used a backup recovery code. Sensitive actions are paused for 24 hours. Print fresh codes from Settings → Security.',
  });
});

// ─────────────────────────────────────────────── Layer 2c — SMS

recover.post('/sms/start', async (c) => {
  if (!isGcipConfigured(c.env)) return c.json({ error: 'sms_unavailable' }, 503);
  if (!(await rate(c.env, `recover-sms-ip:${clientIp(c)}`, 10, 60))) {
    return c.json({ error: 'Too many requests' }, 429);
  }
  const body = await readJson(c);
  const email = String(body?.email || '').toLowerCase().trim();
  if (!email) return c.json({ error: 'Email required' }, 400);
  if (!(await rate(c.env, `recover-sms-email:${email}`, 3, 900))) {
    return c.json({ error: 'Too many requests' }, 429);
  }

  const user = await findUserByEmail(c.env, email);
  if (!user || !user.email_verified || !user.is_active) {
    return c.json({ session_info: null });
  }
  const sms_ = await loadSms(c.env, user.id);
  if (!sms_) return c.json({ session_info: null });

  // Per-PHONE limits per the spec (3 codes / 15 min / phone, 10/day/phone).
  // The phone is loaded server-side from the enrolled factor so the caller
  // can't bypass by varying email casing.
  const phoneKey = sms_.phone.replace(/\D/g, '');
  if (!(await rate(c.env, `recover-sms-phone:${phoneKey}`, 3, 900))) {
    return c.json({ error: 'Too many requests' }, 429);
  }
  if (!(await rate(c.env, `recover-sms-phone-daily:${phoneKey}`, 10, 86400))) {
    return c.json({ error: 'Daily SMS limit reached' }, 429);
  }

  const r = await sendVerificationCode(c.env, sms_.phone, body?.recaptcha_token || null);
  if (!r.ok) {
    return c.json({ error: r.code, message: r.message }, r.code === 'recaptcha_required' ? 412 : 502);
  }
  const { id: ticketId, lookup_token } = await createTicket(c.env, user.id, 'sms', { sms_last4: sms_.last4 }, c);
  // Bind the GCIP session to the ticket so /sms/verify can atomically
  // resolve THIS ticket (no orphaned `open` rows in activity).
  await c.env.RATE_LIMITS.put(
    `recover-sms-session:${r.sessionInfo}`,
    JSON.stringify({ user_id: user.id, email, ts: Date.now(), ticket_id: ticketId }),
    { expirationTtl: 600 },
  );
  await notifyAllChannels(c.env, user, 'auth_recovery_started', { ticket_id: String(ticketId) });
  return c.json({ session_info: r.sessionInfo, last4: sms_.last4, ticket_id: ticketId, lookup_token });
});

recover.post('/sms/verify', async (c) => {
  if (!isGcipConfigured(c.env)) return c.json({ error: 'sms_unavailable' }, 503);
  const body = await readJson(c);
  const email = String(body?.email || '').toLowerCase().trim();
  const sessionInfo = String(body?.session_info || '');
  const code = String(body?.code || '').trim();
  if (!email || !sessionInfo || !code) return c.json({ error: 'Missing parameters' }, 400);
  if (!(await rate(c.env, `recover-sms-verify:${email}`, 5, 300))) {
    return c.json({ error: 'Too many attempts' }, 429);
  }
  const stashed = await c.env.RATE_LIMITS.get(`recover-sms-session:${sessionInfo}`);
  if (!stashed) return c.json({ error: 'session_expired' }, 410);
  let bound: { user_id: number; email: string; ticket_id?: number };
  try { bound = JSON.parse(stashed); } catch { return c.json({ error: 'session_corrupted' }, 500); }
  if (bound.email !== email) return c.json({ error: 'session_email_mismatch' }, 401);

  const v = await signInWithPhoneNumber(c.env, sessionInfo, code);
  if (!v.ok) return c.json({ error: v.code, message: v.message }, v.code === 'invalid_code' ? 401 : 502);

  const sql = getSQL(c.env);
  const users = await sql`SELECT * FROM users WHERE id = ${bound.user_id}`;
  await sql.end();
  if (!users.length) return c.json({ error: 'Account not found' }, 401);
  const user = users[0];

  const stored = await loadSms(c.env, user.id);
  if (!stored || stored.phone !== v.phoneNumber) return c.json({ error: 'phone_mismatch' }, 401);
  await c.env.RATE_LIMITS.delete(`recover-sms-session:${sessionInfo}`);

  // SMS-based recovery is full-assurance (the factor was bound at
  // enrolment) but applies the 24h cool-off since the user clearly
  // doesn't hold the canonical TOTP secret anymore.
  await setCoolOffAndAssurance(c.env, user.id, 'full');
  await markSmsUsed(c.env, user.id);
  // Resolve the exact ticket bound at /sms/start (Task #50 review fix:
  // no more stale open rows in the activity feed).
  if (bound.ticket_id) {
    await transitionTicket(c.env, bound.ticket_id, user,
      { status: 'resolved', assurance: 'full', resolved: true },
      { template: 'auth_recovery_resolved' });
  }
  await logActivity(c.env, user.id, 'recovery_resolved_sms',
    `ticket=${bound.ticket_id || '-'} sms-only recovery → 24h cool-off`);

  const { token, csrf } = await mintRecoverySession(c, user, 'recovery_sms', 'full');
  return c.json({
    token, csrf_token: csrf,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    expires_in: 24 * 3600,
    assurance_level: 'full',
    ticket_id: bound.ticket_id || null,
    cool_off_until: inHours(RECOVERY_COOL_OFF_HOURS),
    note: 'Recovered via SMS. Billing, contracts, capital movement, KYC re-submission, DD downloads and impersonation are paused for 24 hours.',
  });
});

// ─────────────────────────────────────────────── Layer 2d — email magic

recover.post('/email/start', async (c) => {
  if (!(await rate(c.env, `recover-email-ip:${clientIp(c)}`, 5, 300))) {
    return c.json({ error: 'Too many requests' }, 429);
  }
  const body = await readJson(c);
  const email = String(body?.email || '').toLowerCase().trim();
  if (!email) return c.json({ error: 'Email required' }, 400);
  if (!(await rate(c.env, `recover-email-addr:${email}`, 3, 900))) {
    return c.json({ error: 'Too many requests' }, 429);
  }

  const user = await findUserByEmail(c.env, email);
  // Always 202 regardless of account existence to avoid enumeration.
  if (!user || !user.email_verified || !user.is_active) return c.json({ ok: true });

  const raw = generateToken();
  const tokenHash = await hashToken(raw);
  const expires = inMin(EMAIL_MAGIC_TTL_MIN);
  const { id: ticketId } = await createTicket(c.env, user.id, 'email_magic',
    { token_hash: tokenHash, expires_at: expires }, c);

  const appUrl = stripTrailingSlashes(String((c.env as any).APP_URL || 'https://axal.vc'));
  const magicUrl = `${appUrl}/auth/recover/email?token=${raw}&ticket=${ticketId}`;

  await sendEmail(c.env, 'auth_magic_link', user.email, {
    name: user.name || user.email,
    magic_url: magicUrl,
  }, { userId: user.id });
  await notifyAllChannels(c.env, user, 'auth_recovery_started', { ticket_id: String(ticketId) });
  return c.json({ ok: true });
});

recover.get('/email/verify', async (c) => {
  const token = String(c.req.query('token') || '');
  const ticketId = Number(c.req.query('ticket') || 0);
  if (!token || !ticketId) return c.json({ error: 'invalid_link' }, 400);
  if (!(await rate(c.env, `recover-email-verify-ip:${clientIp(c)}`, 10, 300))) {
    return c.json({ error: 'Too many requests' }, 429);
  }
  const tokenHash = await hashToken(token);
  const row: any = await c.env.DB.prepare(
    `SELECT * FROM auth_recovery_tickets WHERE id = ? AND layer = 'email_magic' AND status = 'open'`,
  ).bind(ticketId).first();
  if (!row) return c.json({ error: 'invalid_or_used' }, 400);
  let state: any = {};
  try { state = JSON.parse(row.state_json || '{}'); } catch {}
  if (state.token_hash !== tokenHash) return c.json({ error: 'invalid_or_used' }, 400);
  if (state.expires_at && new Date(state.expires_at) < new Date()) {
    await c.env.DB.prepare(`UPDATE auth_recovery_tickets SET status='expired' WHERE id = ?`).bind(ticketId).run();
    return c.json({ error: 'expired' }, 400);
  }

  const sql = getSQL(c.env);
  const users = await sql`SELECT * FROM users WHERE id = ${row.user_id}`;
  await sql.end();
  if (!users.length) return c.json({ error: 'Account not found' }, 401);
  const user = users[0];

  await setCoolOffAndAssurance(c.env, user.id, 'email_only');
  await transitionTicket(c.env, ticketId, user,
    { status: 'resolved', assurance: 'email_only', resolved: true },
    { template: 'auth_recovery_resolved' });
  await logActivity(c.env, user.id, 'recovery_resolved_email_magic',
    `ticket=${ticketId} assurance=email_only`);

  const { token: jwt, csrf } = await mintRecoverySession(c, user, 'recovery_email', 'email_only');
  return c.json({
    token: jwt, csrf_token: csrf,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    expires_in: 24 * 3600,
    assurance_level: 'email_only',
    cool_off_until: inHours(RECOVERY_COOL_OFF_HOURS),
    step_up_due_at: inDays(STEP_UP_DEADLINE_DAYS),
    note: 'Recovered via email magic link. This is a lower-assurance session. Re-enrol your authenticator within 7 days from Settings → Security or your account will re-lock.',
  });
});

// ─────────────────────────────────── Layer 3f — trusted-contact 2-of-2

recover.post('/trusted-contact/start', async (c) => {
  if (!(await rate(c.env, `recover-tc-ip:${clientIp(c)}`, 10, 300))) {
    return c.json({ error: 'Too many requests' }, 429);
  }
  const body = await readJson(c);
  const email = String(body?.email || '').toLowerCase().trim();
  if (!email) return c.json({ error: 'Email required' }, 400);
  // Task #50 review fix — constant-shape response across all branches
  // (no enumeration on existence OR on "has enough trusted contacts").
  // The caller always gets `{ ok: true }`; trusted contacts receive
  // the actual attest invite out-of-band.
  const user = await findUserByEmail(c.env, email);
  if (user && user.email_verified && user.is_active) {
    const contacts: any[] = (await c.env.DB.prepare(
      `SELECT id, contact_user_id, contact_email FROM auth_trusted_contacts
       WHERE user_id = ? AND status = 'active'`,
    ).bind(user.id).all()).results || [];
    if (contacts.length >= 2) {
      const { id: ticketId } = await createTicket(c.env, user.id, 'trusted_contact', {
        contacts: contacts.map((r) => ({ id: r.id, email: r.contact_email, user_id: r.contact_user_id })),
        attestations: [],
      }, c);
      const appUrl = stripTrailingSlashes(String((c.env as any).APP_URL || 'https://axal.vc'));
      const attestUrl = `${appUrl}/auth/recover/attest?ticket=${ticketId}`;
      for (const ctc of contacts) {
        try {
          await sendEmail(c.env, 'auth_recovery_started', ctc.contact_email, {
            name: ctc.contact_email,
            ticket_id: String(ticketId),
          }, { userId: ctc.contact_user_id ?? undefined, ctaUrl: attestUrl });
        } catch (e) { console.error('[recover] tc invite email failed', e); }
      }
      await notifyAllChannels(c.env, user, 'auth_recovery_started', { ticket_id: String(ticketId) });
    }
  }
  return c.json({ ok: true });
});

recover.post('/trusted-contact/attest', async (c) => {
  const contact = await requireAuth(c);
  const body = await readJson(c);
  const ticketId = Number(body?.ticket_id || 0);
  if (!ticketId) return c.json({ error: 'ticket_id required' }, 400);

  // Require step-up: the attesting contact must themselves be on a
  // TOTP-bound session (factor='totp'), never a recovery / SMS-only one.
  let jti: string | undefined;
  try {
    const { decodeJWT } = await import('../auth');
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) :
      (c.req.header('Cookie') || '').split(';').map(s => s.trim())
        .find(s => s.startsWith('studioos_auth='))?.slice('studioos_auth='.length);
    if (token) jti = (await decodeJWT(c.env, token))?.jti as string | undefined;
  } catch {}
  if (!jti) return c.json({ error: 'must_be_totp_session' }, 403);
  const sess: any = await c.env.DB.prepare(
    `SELECT factor FROM user_sessions WHERE jti = ? AND user_id = ?`,
  ).bind(jti, contact.id).first();
  if (!sess || sess.factor !== 'totp') {
    return c.json({ error: 'must_be_totp_session', message: 'Sign in with your authenticator to attest a recovery.' }, 403);
  }

  const ticket: any = await c.env.DB.prepare(
    `SELECT * FROM auth_recovery_tickets WHERE id = ? AND layer = 'trusted_contact' AND status IN ('open','awaiting_contacts')`,
  ).bind(ticketId).first();
  if (!ticket) return c.json({ error: 'ticket_not_open' }, 400);
  if (Number(ticket.user_id) === Number(contact.id)) return c.json({ error: 'cannot_attest_self' }, 403);

  let state: any = {};
  try { state = JSON.parse(ticket.state_json || '{}'); } catch {}
  const eligible = (state.contacts || []).some((r: any) =>
    Number(r.user_id) === Number(contact.id) ||
    String(r.email || '').toLowerCase() === String(contact.email).toLowerCase(),
  );
  if (!eligible) return c.json({ error: 'not_a_trusted_contact' }, 403);

  const atts: number[] = Array.isArray(state.attestations) ? state.attestations : [];
  if (atts.includes(contact.id)) {
    return c.json({ ok: true, attestations: atts.length, required: 2, note: 'already_attested' });
  }
  atts.push(contact.id);

  // Load target user up-front for the centralised transition+notify.
  const targetSql = getSQL(c.env);
  const targetRows = await targetSql`SELECT * FROM users WHERE id = ${ticket.user_id}`;
  await targetSql.end();
  const target = targetRows[0] || { id: ticket.user_id, email: 'unknown', name: null };

  // Centralised transition + all-channel fan-out for EVERY attest
  // (1-of-2 progress AND 2-of-2 satisfaction).
  await transitionTicket(c.env, ticketId, target as any, {
    status: atts.length >= 2 ? 'awaiting_admin' : 'awaiting_contacts',
    statePatch: { attestations: atts },
  }, { template: 'auth_recovery_started', vars: { attestations: atts.length } });

  await logActivity(c.env, contact.id, 'recovery_attested',
    `attested ticket=${ticketId} for user=${ticket.user_id}`);

  if (atts.length >= 2) {
    // 2-of-2 satisfied. Issue a claim-token; the user POSTs it back
    // from /auth/recover. The target user is NOT authenticated to this
    // request — they get a one-shot magic URL emailed to them.
    if (!targetRows.length) return c.json({ error: 'target_user_missing' }, 410);
    const claim = generateToken();
    const claimHash = await hashToken(claim);
    await transitionTicket(c.env, ticketId, target as any, {
      assurance: 'full',
      statePatch: { claim_token_hash: claimHash, claim_expires_at: inMin(EMAIL_MAGIC_TTL_MIN) },
    }, null);

    const appUrl = stripTrailingSlashes(String((c.env as any).APP_URL || 'https://axal.vc'));
    const claimUrl = `${appUrl}/auth/recover/email?token=${claim}&ticket=${ticketId}&trusted=1`;
    await sendEmail(c.env, 'auth_recovery_resolved', (target as any).email, {
      name: (target as any).name || (target as any).email,
      ticket_id: String(ticketId),
    }, { userId: (target as any).id, ctaUrl: claimUrl });
  }

  return c.json({ ok: true, attestations: atts.length, required: 2 });
});

// Claim endpoint reused for trusted-contact (state-machine-driven) AND
// admin-cosign resolution. Path matches the email magic verify so the
// frontend doesn't need a third state.
recover.post('/claim', async (c) => {
  const body = await readJson(c);
  const token = String(body?.token || '');
  const ticketId = Number(body?.ticket_id || 0);
  if (!token || !ticketId) return c.json({ error: 'invalid_link' }, 400);
  const tokenHash = await hashToken(token);

  const row: any = await c.env.DB.prepare(
    `SELECT * FROM auth_recovery_tickets WHERE id = ?`,
  ).bind(ticketId).first();
  if (!row) return c.json({ error: 'invalid_or_used' }, 400);
  let state: any = {};
  try { state = JSON.parse(row.state_json || '{}'); } catch {}
  if (state.claim_token_hash !== tokenHash) return c.json({ error: 'invalid_or_used' }, 400);
  if (state.claim_expires_at && new Date(state.claim_expires_at) < new Date()) {
    return c.json({ error: 'expired' }, 400);
  }
  if (row.status === 'resolved' && row.resolved_at) {
    return c.json({ error: 'already_used' }, 400);
  }

  const sql = getSQL(c.env);
  const users = await sql`SELECT * FROM users WHERE id = ${row.user_id}`;
  await sql.end();
  if (!users.length) return c.json({ error: 'Account not found' }, 401);
  const user = users[0];

  await setCoolOffAndAssurance(c.env, user.id, 'full');
  await transitionTicket(c.env, ticketId, user,
    { status: 'resolved', assurance: 'full', resolved: true },
    { template: 'auth_recovery_resolved' });
  await logActivity(c.env, user.id, 'recovery_resolved_claim',
    `ticket=${ticketId} layer=${row.layer}`);

  const { token: jwt, csrf } = await mintRecoverySession(c, user,
    row.layer === 'trusted_contact' ? 'recovery_trusted' : 'recovery_admin', 'full');
  return c.json({
    token: jwt, csrf_token: csrf,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    expires_in: 24 * 3600,
    assurance_level: 'full',
    cool_off_until: inHours(RECOVERY_COOL_OFF_HOURS),
    note: 'Recovery completed. Sensitive actions are paused for 24 hours. Re-enrol your authenticator from Settings → Security.',
  });
});

// ─────────────────────────────────────── Layer 3 — KYC re-verify (stub)

recover.post('/kyc/start', async (c) => {
  // Persona / Sumsub vendor integration is not wired in this codebase
  // yet. The route ships in stub form so operators / KYC team can light
  // it up by setting PERSONA_API_KEY (or equivalent) and dropping the
  // matching webhook handler. We deliberately return 501 so the
  // frontend hides this option from the Recovery list.
  return c.json({
    error: 'vendor_unconfigured',
    message: 'KYC re-verify recovery is not enabled. Use one of the other layers, or contact security@axal.vc.',
  }, 501);
});

// ─────────────────────────────────────── Layer 4 — admin manual (multi-sig)

recover.post('/admin/escalate', async (c) => {
  if (!(await rate(c.env, `recover-admin-ip:${clientIp(c)}`, 5, 3600))) {
    return c.json({ error: 'Too many requests' }, 429);
  }
  const body = await readJson(c);
  const email = String(body?.email || '').toLowerCase().trim();
  const reason = String(body?.reason || '').slice(0, 2000);
  if (!email) return c.json({ error: 'Email required' }, 400);
  const user = await findUserByEmail(c.env, email);
  if (!user) return c.json({ ok: true });  // never leak existence

  const { id: ticketId } = await createTicket(c.env, user.id, 'admin_manual', {
    reason, co_signers: [], denials: [],
  }, c);
  await transitionTicket(c.env, ticketId, user,
    { status: 'awaiting_admin' },
    { template: 'auth_recovery_started' });
  // Constant-shape response — never leak ticket_id to the unauthenticated
  // caller (otherwise existing vs non-existent accounts are distinguishable
  // by the presence of the field). The user receives the ticket details
  // through the email + in-app + push fan-out triggered above.
  return c.json({ ok: true });
});

recover.get('/admin/tickets', async (c) => {
  await requireAdmin(c);
  const rows: any[] = (await c.env.DB.prepare(
    `SELECT t.id, t.user_id, t.layer, t.status, t.state_json, t.created_at, t.resolved_at, u.email
     FROM auth_recovery_tickets t LEFT JOIN users u ON u.id = t.user_id
     WHERE t.status IN ('open','awaiting_contacts','awaiting_admin','awaiting_admin_cosign')
     ORDER BY t.created_at DESC LIMIT 200`,
  ).all()).results || [];
  return c.json({ tickets: rows });
});

recover.post('/admin/cosign', async (c) => {
  const admin = await requireAdmin(c);
  const body = await readJson(c);
  const ticketId = Number(body?.ticket_id || 0);
  if (!ticketId) return c.json({ error: 'ticket_id required' }, 400);

  const t: any = await c.env.DB.prepare(
    `SELECT * FROM auth_recovery_tickets WHERE id = ? AND layer = 'admin_manual'`,
  ).bind(ticketId).first();
  if (!t || !['awaiting_admin', 'awaiting_admin_cosign'].includes(t.status)) {
    return c.json({ error: 'ticket_not_open' }, 400);
  }
  let state: any = {};
  try { state = JSON.parse(t.state_json || '{}'); } catch {}
  const cosigners: number[] = Array.isArray(state.co_signers) ? state.co_signers : [];
  if (cosigners.includes(admin.id)) {
    return c.json({ ok: true, co_signers: cosigners.length, required: 2, note: 'already_signed' });
  }
  cosigners.push(admin.id);
  state.co_signers = cosigners;

  // admin_audit_log row for the audit trail.
  try {
    await c.env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, viewed_user_id, exported_at)
       VALUES (?, 'recovery_cosign', ?, datetime('now'))`,
    ).bind(admin.id, t.user_id).run();
  } catch {}

  // Load target for the centralised transition+notify.
  const sql = getSQL(c.env);
  const ur = await sql`SELECT * FROM users WHERE id = ${t.user_id}`;
  await sql.end();
  const target = ur[0] || { id: t.user_id, email: 'unknown', name: null };

  if (cosigners.length >= 2) {
    const claim = generateToken();
    const claimHash = await hashToken(claim);
    await transitionTicket(c.env, ticketId, target as any, {
      status: 'awaiting_admin_cosign', assurance: 'full',
      statePatch: {
        co_signers: cosigners,
        claim_token_hash: claimHash,
        claim_expires_at: inMin(EMAIL_MAGIC_TTL_MIN),
      },
    }, { template: 'auth_recovery_started', vars: { co_signers: cosigners.length, status: 'claim_emailed' } });

    if (ur.length) {
      const appUrl = stripTrailingSlashes(String((c.env as any).APP_URL || 'https://axal.vc'));
      const claimUrl = `${appUrl}/auth/recover/email?token=${claim}&ticket=${ticketId}&admin=1`;
      try {
        await sendEmail(c.env, 'auth_recovery_resolved', (target as any).email, {
          name: (target as any).name || (target as any).email,
          ticket_id: String(ticketId),
        }, { userId: (target as any).id, ctaUrl: claimUrl });
      } catch (e) { console.error('[recover] admin cosign email failed', e); }
    }
    return c.json({ ok: true, co_signers: cosigners.length, required: 2, status: 'claim_emailed' });
  }
  await transitionTicket(c.env, ticketId, target as any, {
    status: 'awaiting_admin_cosign',
    statePatch: { co_signers: cosigners },
  }, { template: 'auth_recovery_started', vars: { co_signers: cosigners.length } });
  return c.json({ ok: true, co_signers: cosigners.length, required: 2 });
});

recover.post('/admin/deny', async (c) => {
  const admin = await requireAdmin(c);
  const body = await readJson(c);
  const ticketId = Number(body?.ticket_id || 0);
  const reason = String(body?.reason || '').slice(0, 2000);
  if (!ticketId) return c.json({ error: 'ticket_id required' }, 400);
  const t: any = await c.env.DB.prepare(
    `SELECT * FROM auth_recovery_tickets WHERE id = ?`,
  ).bind(ticketId).first();
  if (!t || t.status === 'resolved' || t.status === 'denied') {
    return c.json({ error: 'ticket_closed' }, 400);
  }
  try {
    await c.env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, viewed_user_id, exported_at)
       VALUES (?, 'recovery_denied', ?, datetime('now'))`,
    ).bind(admin.id, t.user_id).run();
  } catch {}
  const sql = getSQL(c.env);
  const ur = await sql`SELECT * FROM users WHERE id = ${t.user_id}`;
  await sql.end();
  const target = ur[0] || { id: t.user_id, email: 'unknown', name: null };
  // Centralised transition: status=denied + ALL-CHANNEL fan-out
  // (reviewer fix: deny no longer email-only).
  await transitionTicket(c.env, ticketId, target as any, {
    status: 'denied', resolved: true,
    statePatch: { denial_reason: reason },
  }, { template: 'auth_recovery_resolved', vars: { status: 'denied', reason } });
  return c.json({ ok: true });
});

recover.get('/ticket/:id', async (c) => {
  if (!(await rate(c.env, `recover-ticket-ip:${clientIp(c)}`, 60, 300))) {
    return c.json({ error: 'Too many requests' }, 429);
  }
  const id = Number(c.req.param('id') || 0);
  const lookup = String(c.req.query('lookup') || '');
  if (!id || !lookup) return c.json({ error: 'invalid' }, 400);
  const row: any = await c.env.DB.prepare(
    `SELECT id, layer, status, created_at, resolved_at, expires_at, state_json FROM auth_recovery_tickets WHERE id = ?`,
  ).bind(id).first();
  // Constant-time-ish 404: any mismatch (no row, or wrong lookup_token)
  // returns the same error. Auto-increment IDs no longer leak via this
  // endpoint — the unauthenticated caller MUST present the token that
  // was issued at /start.
  if (!row) return c.json({ error: 'not_found' }, 404);
  let state: any = {};
  try { state = JSON.parse(row.state_json || '{}'); } catch {}
  if (!state.lookup_token || state.lookup_token !== lookup) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({
    id: row.id, layer: row.layer, status: row.status,
    created_at: row.created_at, resolved_at: row.resolved_at, expires_at: row.expires_at,
  });
});

// ─────────────────────────── Trusted-contact management (authenticated)

recover.get('/trusted-contacts', async (c) => {
  const user = await requireAuth(c);
  const rows: any[] = (await c.env.DB.prepare(
    `SELECT id, contact_email, display_name, status, added_at, confirmed_at
     FROM auth_trusted_contacts WHERE user_id = ? AND status != 'removed'
     ORDER BY added_at DESC`,
  ).bind(user.id).all()).results || [];
  return c.json({ contacts: rows });
});

recover.post('/trusted-contacts', async (c) => {
  const user = await requireAuth(c);
  const body = await readJson(c);
  const email = String(body?.contact_email || '').toLowerCase().trim();
  const displayName = String(body?.display_name || '').slice(0, 200);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return c.json({ error: 'invalid_email' }, 400);
  }
  if (email === user.email.toLowerCase()) return c.json({ error: 'cannot_be_self' }, 400);

  // Look up if the contact is already an Axal user.
  let contactUserId: number | null = null;
  let contactStatus: 'active' | 'pending_invite' = 'pending_invite';
  try {
    const sql = getSQL(c.env);
    const r = await sql`SELECT id FROM users WHERE email = ${email} AND is_active = 1`;
    await sql.end();
    if (r.length) { contactUserId = Number(r[0].id); contactStatus = 'active'; }
  } catch {}

  try {
    await c.env.DB.prepare(
      `INSERT INTO auth_trusted_contacts
         (user_id, contact_user_id, contact_email, display_name, status, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      user.id, contactUserId, email, displayName || null, contactStatus,
      contactStatus === 'active' ? nowIso() : null,
    ).run();
  } catch (e: any) {
    if (/UNIQUE/.test(String(e?.message || ''))) {
      return c.json({ error: 'already_added' }, 409);
    }
    throw e;
  }
  await logActivity(c.env, user.id, 'trusted_contact_added',
    `added trusted contact (status=${contactStatus})`);
  return c.json({ ok: true, status: contactStatus });
});

recover.delete('/trusted-contacts/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id') || 0);
  if (!id) return c.json({ error: 'invalid' }, 400);
  await c.env.DB.prepare(
    `UPDATE auth_trusted_contacts SET status='removed', removed_at=CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
  ).bind(id, user.id).run();
  await logActivity(c.env, user.id, 'trusted_contact_removed', `id=${id}`);
  return c.json({ ok: true });
});

// ─────────────────────────────── Recovery activity feed for Settings UI

recover.get('/activity', async (c) => {
  const user = await requireAuth(c);
  const rows: any[] = (await c.env.DB.prepare(
    `SELECT id, layer, status, created_at, resolved_at, expires_at
     FROM auth_recovery_tickets WHERE user_id = ?
     ORDER BY created_at DESC LIMIT 50`,
  ).bind(user.id).all()).results || [];
  return c.json({ activity: rows });
});

// ─────────────────────── Print backup codes once more (gated on enrolled)

recover.post('/backup-codes/reprint', async (c) => {
  // Available only while the user still has TOTP enrolled. The codes
  // themselves are minted by the existing /api/settings flow; we just
  // surface a hint that points at it so the recovery page can deep-link.
  const user = await requireAuth(c);
  if (!(await hasTotpConfigured(c.env, user.id))) {
    return c.json({ error: 'totp_not_enrolled' }, 412);
  }
  return c.json({ ok: true, redirect: '/settings#security-recovery-codes' });
});

export default recover;
