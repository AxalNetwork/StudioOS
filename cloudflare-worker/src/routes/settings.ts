/**
 * Epic 3 — Settings page backend.
 *
 * One Hono router covering every surface the /settings page needs:
 *   - GET/PATCH /api/settings                       universal + role prefs
 *   - POST     /api/settings/headshot               base64 -> R2
 *   - GET      /api/settings/headshot/:uid          public stream by user uid
 *   - POST     /api/settings/email-change/request   (24h confirm + revoke)
 *   - POST     /api/settings/email-change/confirm
 *   - POST     /api/settings/email-change/revoke
 *   - POST     /api/settings/totp/repair            verify current code, mint new secret
 *   - POST     /api/settings/sessions/revoke-all    bumps users.jwt_min_iat
 *   - POST     /api/settings/account/delete-request raises a request, no automation
 *   - POST     /api/settings/data-export            returns user's PII as JSON
 *
 * Schema additions live in ensureSchema(); the ALTER TABLE pattern matches
 * routes/kyc.ts so first-request migration is idempotent and side-effect free.
 */
import { Hono, type Context } from 'hono';
import { TOTP, Secret } from 'otpauth';
import * as QRCode from 'qrcode';
import type { Env, UserSessionRow } from '../types';
import { decodeJwt } from 'jose';
import { getSQL } from '../db';
import { requireAuth, hashToken, generateToken } from '../auth';
import { putHeadshotFromDataUri, getHeadshot } from '../services/r2';
import { sendVerificationEmail } from '../services/email';

const settings = new Hono<{ Bindings: Env }>();

// --- one-shot schema migration ---------------------------------------------

const SETTINGS_USER_COLUMNS: Array<[string, string]> = [
  ['bio', 'TEXT'],
  ['headshot_r2_key', 'TEXT'],
  ['jurisdictions', 'TEXT'],            // JSON array of country codes
  ['socials', 'TEXT'],                  // JSON object
  ['notification_prefs', 'TEXT'],       // JSON {event: {email,inapp,sms}}
  ['privacy_prefs', 'TEXT'],            // JSON {public_profile: {...}}
  ['role_prefs', 'TEXT'],               // JSON role-conditional
  ['jwt_min_iat', 'INTEGER DEFAULT 0'], // bump on Sign-out-everywhere
  ['deletion_requested_at', 'TIMESTAMP'],
  ['totp_recovery_codes', 'TEXT'],      // JSON array of SHA-256 hex hashes
];

let migrated = false;
async function ensureSchema(env: Env) {
  if (migrated) return;
  const db = env.DB;
  for (const [col, type] of SETTINGS_USER_COLUMNS) {
    try { await db.prepare(`ALTER TABLE users ADD COLUMN ${col} ${type}`).run(); } catch {}
  }
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS email_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      old_email TEXT NOT NULL,
      new_email TEXT NOT NULL,
      confirm_token_hash TEXT NOT NULL UNIQUE,
      revoke_token_hash TEXT NOT NULL UNIQUE,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      confirm_expires_at TIMESTAMP NOT NULL,
      revoke_expires_at TIMESTAMP NOT NULL,
      confirmed_at TIMESTAMP,
      revoked_at TIMESTAMP
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_ecr_user ON email_change_requests(user_id)`).run();
  } catch {}
  // user_sessions — one row per JWT mint, per-device revocation.
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      jti TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      ip TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      revoked_at TIMESTAMP
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_us_user ON user_sessions(user_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_us_jti ON user_sessions(jti)`).run();
  } catch {}
  // founder_invites — co-founder invites with 14d expiry, capped per project.
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS founder_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      inviter_user_id INTEGER NOT NULL,
      invitee_email TEXT NOT NULL,
      invitee_name TEXT,
      role TEXT NOT NULL DEFAULT 'co-founder',
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      accepted_at TIMESTAMP,
      revoked_at TIMESTAMP
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_fi_inviter ON founder_invites(inviter_user_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_fi_project ON founder_invites(project_id)`).run();
  } catch {}
  migrated = true;
}

const FOUNDER_INVITE_CAP_PER_PROJECT = 10;
const FOUNDER_INVITE_EXPIRY_DAYS = 14;

// --- helpers ----------------------------------------------------------------

function safeJson<T>(s: any, fallback: T): T {
  if (!s) return fallback;
  try { return typeof s === 'string' ? JSON.parse(s) as T : s as T; } catch { return fallback; }
}

function clampStr(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

const APP_URL = (env: Env) => env.APP_URL || 'https://app.axal.vc';

// --- GET /api/settings ------------------------------------------------------

function currentJtiFromRequest(c: Context<{ Bindings: Env }>): string | null {
  const auth = c.req.header('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const payload = decodeJwt(auth.slice(7)) as { jti?: unknown };
    return typeof payload.jti === 'string' ? payload.jti : null;
  } catch { return null; }
}

// Register both `''` and `'/'` so the worker matches `/api/settings` and
// `/api/settings/` identically — the FastAPI dev backend does the same via
// `@router.get("")` + `@router.get("/")`. Without the empty-path variant,
// `GET /api/settings` (no slash, what the frontend actually calls) falls
// through to the global `app.notFound` handler and returns
// `{"detail":"Not found"}`, which the UI surfaces as
// "Could not load your settings: Not found".
const getRootSettings = async (c: Context<{ Bindings: Env }>) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT id, uid, email, name, role, email_verified, kyc_status, access_level,
           bio, headshot_r2_key, jurisdictions, socials,
           notification_prefs, privacy_prefs, role_prefs,
           deletion_requested_at, last_active_at, created_at,
           totp_recovery_codes,
           CASE WHEN password_hash IS NOT NULL THEN 1 ELSE 0 END AS totp_configured
    FROM users WHERE id = ${user.id}
  `;
  const pendingChange = await sql`
    SELECT id, new_email, requested_at, confirm_expires_at, confirmed_at, revoked_at
    FROM email_change_requests
    WHERE user_id = ${user.id} AND confirmed_at IS NULL AND revoked_at IS NULL
      AND confirm_expires_at > datetime('now')
    ORDER BY requested_at DESC LIMIT 1
  `;
  await sql.end();
  if (rows.length === 0) return c.json({ error: 'User not found' }, 404);
  const u = rows[0];
  return c.json({
    id: u.id,
    uid: u.uid,
    email: u.email,
    name: u.name,
    role: u.role,
    email_verified: !!u.email_verified,
    totp_configured: !!u.totp_configured,
    kyc_status: u.kyc_status || 'not_started',
    access_level: u.access_level || null,
    last_active_at: u.last_active_at || null,
    created_at: u.created_at,
    profile: {
      bio: u.bio || '',
      headshot_url: u.headshot_r2_key ? `/api/settings/headshot/${u.uid}` : null,
      socials: safeJson(u.socials, {}),
    },
    jurisdictions: safeJson<string[]>(u.jurisdictions, []),
    notification_prefs: safeJson(u.notification_prefs, {}),
    privacy_prefs: safeJson(u.privacy_prefs, { public_profile: { name: true, bio: true, headshot: true, socials: false } }),
    role_prefs: safeJson(u.role_prefs, {}),
    deletion_requested_at: u.deletion_requested_at || null,
    pending_email_change: pendingChange[0] ? {
      new_email: pendingChange[0].new_email,
      requested_at: pendingChange[0].requested_at,
      expires_at: pendingChange[0].confirm_expires_at,
    } : null,
    totp_recovery_codes_remaining: (() => {
      const arr = safeJson<string[]>(u.totp_recovery_codes, []);
      return Array.isArray(arr) ? arr.length : 0;
    })(),
    current_jti: currentJtiFromRequest(c),
  });
};
settings.get('', getRootSettings);
settings.get('/', getRootSettings);

// --- PATCH /api/settings ----------------------------------------------------

const patchRootSettings = async (c: Context<{ Bindings: Env }>) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));

  // Whitelist what's writable. Email is NEVER updated here — see /email-change.
  const updates: Array<{ col: string; val: any }> = [];

  if (body.name !== undefined) {
    const n = clampStr(body.name, 120);
    if (!n) return c.json({ error: 'Name cannot be empty' }, 400);
    updates.push({ col: 'name', val: n });
  }
  if (body.bio !== undefined) updates.push({ col: 'bio', val: clampStr(body.bio, 2000) });
  if (body.socials !== undefined) {
    const s = body.socials || {};
    const safe: Record<string, string> = {};
    for (const k of ['linkedin', 'twitter', 'website', 'github']) {
      if (typeof s[k] === 'string') {
        const v = clampStr(s[k], 300);
        if (v) safe[k] = v;
      }
    }
    updates.push({ col: 'socials', val: JSON.stringify(safe) });
  }
  if (body.jurisdictions !== undefined) {
    const arr = Array.isArray(body.jurisdictions) ? body.jurisdictions : [];
    const safe = arr
      .map((x: unknown) => clampStr(x, 4))
      .filter((x: string | null): x is string => !!x && /^[A-Za-z]{2,3}$/.test(x))
      .map((x: string) => x.toUpperCase())
      .slice(0, 30);
    updates.push({ col: 'jurisdictions', val: JSON.stringify(safe) });
  }
  if (body.notification_prefs !== undefined) {
    // Free-form JSON, but bounded length to avoid abuse.
    const j = JSON.stringify(body.notification_prefs || {});
    if (j.length > 8000) return c.json({ error: 'notification_prefs too large' }, 400);
    updates.push({ col: 'notification_prefs', val: j });
  }
  if (body.privacy_prefs !== undefined) {
    const j = JSON.stringify(body.privacy_prefs || {});
    if (j.length > 4000) return c.json({ error: 'privacy_prefs too large' }, 400);
    updates.push({ col: 'privacy_prefs', val: j });
  }
  if (body.role_prefs !== undefined) {
    const j = JSON.stringify(body.role_prefs || {});
    if (j.length > 16000) return c.json({ error: 'role_prefs too large' }, 400);
    updates.push({ col: 'role_prefs', val: j });
  }

  if (updates.length === 0) return c.json({ ok: true, updated: 0 });

  // Tagged-template SQL doesn't support dynamic identifiers, so go through
  // the prepared-statement API for each column. Column names are from a
  // hard-coded whitelist above (no user input), so direct interpolation is safe.
  for (const u of updates) {
    await c.env.DB.prepare(`UPDATE users SET ${u.col} = ? WHERE id = ?`).bind(u.val, user.id).run();
  }
  return c.json({ ok: true, updated: updates.length });
};
settings.patch('', patchRootSettings);
settings.patch('/', patchRootSettings);

// --- POST /api/settings/headshot --------------------------------------------

settings.post('/headshot', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const dataUri = body?.data_uri;
  if (!dataUri || typeof dataUri !== 'string' || !dataUri.startsWith('data:image/')) {
    return c.json({ error: 'data_uri must be a data:image/* URI' }, 400);
  }
  // T22.5 — Single 14 MB encoded cap (≈10 MB raw after base64 decode);
  // the legacy ~3 MB pre-check was removed so this gate is the only one.
  if (dataUri.length > 14 * 1024 * 1024) {
    return c.json({ error: 'Image too large. Max 10 MB.' }, 413);
  }

  if (!c.env.FILES) {
    return c.json({ error: 'Headshot storage not configured in this environment' }, 503);
  }

  let meta;
  try {
    meta = await putHeadshotFromDataUri(c.env, user.id, dataUri);
  } catch (e: any) {
    return c.json({ error: e?.message || 'Upload failed' }, 400);
  }

  const sql = getSQL(c.env);
  // Best-effort delete previous headshot from R2 to avoid orphans.
  const prev = await sql`SELECT headshot_r2_key, uid FROM users WHERE id = ${user.id}`;
  const oldKey = prev[0]?.headshot_r2_key;
  await sql`UPDATE users SET headshot_r2_key = ${meta.file_key} WHERE id = ${user.id}`;
  await sql.end();
  if (oldKey && oldKey !== meta.file_key) {
    try { await c.env.FILES.delete(oldKey); } catch {}
  }
  return c.json({ ok: true, headshot_url: `/api/settings/headshot/${prev[0]?.uid || user.id}` });
});

// --- GET /api/settings/headshot/:uid (public) -------------------------------

settings.get('/headshot/:uid', async (c) => {
  await ensureSchema(c.env);
  const uid = c.req.param('uid');
  if (!uid) return c.json({ error: 'uid required' }, 400);
  const sql = getSQL(c.env);
  // Accept either the user uid or the numeric id. D1 is SQLite, so use CAST
  // (Postgres-style `::text` would parse-error here).
  const rows = await sql`SELECT headshot_r2_key, privacy_prefs FROM users WHERE uid = ${uid} OR CAST(id AS TEXT) = ${uid}`;
  await sql.end();
  if (!rows.length || !rows[0].headshot_r2_key) return c.json({ error: 'Not found' }, 404);
  const privacy = safeJson<any>(rows[0].privacy_prefs, { public_profile: { headshot: true } });
  if (privacy?.public_profile?.headshot === false) {
    // Owner can fetch their own via authenticated session — treat 404 for everyone else.
    return c.json({ error: 'Not found' }, 404);
  }
  const obj = await getHeadshot(c.env, rows[0].headshot_r2_key);
  if (!obj) return c.json({ error: 'Storage unavailable' }, 503);
  const headers = new Headers();
  headers.set('content-type', obj.httpMetadata?.contentType || 'image/jpeg');
  headers.set('cache-control', 'public, max-age=300');
  return new Response(obj.body, { headers });
});

// --- Email change flow ------------------------------------------------------

settings.post('/email-change/request', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const newEmail = clampStr(body?.new_email, 254);
  if (!newEmail || !isEmail(newEmail)) return c.json({ error: 'Valid new_email required' }, 400);
  if (newEmail.toLowerCase() === user.email.toLowerCase()) {
    return c.json({ error: 'New email matches current email' }, 400);
  }

  const sql = getSQL(c.env);
  const taken = await sql`SELECT 1 FROM users WHERE lower(email) = ${newEmail.toLowerCase()} AND id != ${user.id}`;
  if (taken.length) { await sql.end(); return c.json({ error: 'That email is already in use' }, 409); }

  // Invalidate any outstanding pending request for this user.
  await sql`UPDATE email_change_requests
            SET revoked_at = datetime('now')
            WHERE user_id = ${user.id} AND confirmed_at IS NULL AND revoked_at IS NULL`;

  const confirmRaw = generateToken();
  const revokeRaw = generateToken();
  const confirmHash = await hashToken(confirmRaw);
  const revokeHash = await hashToken(revokeRaw);
  const now = Date.now();
  const confirmExpires = new Date(now + 24 * 3600 * 1000).toISOString();
  // Per-epic spec: revocation window is 24h from request. Old-email owner
  // gets the same window as the new-email confirm; if confirmation lands
  // late the change is final.
  const revokeExpires = new Date(now + 24 * 3600 * 1000).toISOString();

  await sql`INSERT INTO email_change_requests
            (user_id, old_email, new_email, confirm_token_hash, revoke_token_hash, confirm_expires_at, revoke_expires_at)
            VALUES (${user.id}, ${user.email}, ${newEmail}, ${confirmHash}, ${revokeHash}, ${confirmExpires}, ${revokeExpires})`;
  await sql.end();

  const confirmUrl = `${APP_URL(c.env)}/settings/email/confirm?token=${confirmRaw}`;
  const revokeUrl = `${APP_URL(c.env)}/settings/email/revoke?token=${revokeRaw}`;

  // Reuse the existing verification email sender — it already handles
  // Gmail OAuth + branding. The subject is repurposed but the body still
  // reads as a "Verify this address" CTA, which is correct for the
  // confirm side. The revoke side gets a plain one-pager.
  const sentConfirm = await sendVerificationEmail(c.env, newEmail, user.name || newEmail, confirmUrl).catch(() => false);
  const sentRevoke = await sendVerificationEmail(c.env, user.email, user.name || user.email, revokeUrl).catch(() => false);

  return c.json({
    ok: true,
    new_email: newEmail,
    confirm_url: !sentConfirm ? confirmUrl : undefined,
    revoke_url: !sentRevoke ? revokeUrl : undefined,
    confirm_expires_at: confirmExpires,
    revoke_expires_at: revokeExpires,
    email_sent: sentConfirm,
  });
});

settings.post('/email-change/confirm', async (c) => {
  await ensureSchema(c.env);
  const body = await c.req.json().catch(() => ({} as any));
  const token = clampStr(body?.token, 200);
  if (!token) return c.json({ error: 'Token required' }, 400);
  const tokenHash = await hashToken(token);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM email_change_requests WHERE confirm_token_hash = ${tokenHash}`;
  if (!rows.length) { await sql.end(); return c.json({ error: 'Invalid or expired link' }, 400); }
  const rec = rows[0];
  if (rec.confirmed_at) { await sql.end(); return c.json({ error: 'Already confirmed' }, 400); }
  if (rec.revoked_at) { await sql.end(); return c.json({ error: 'This change was revoked' }, 400); }
  if (new Date(rec.confirm_expires_at) < new Date()) { await sql.end(); return c.json({ error: 'Confirmation link expired' }, 400); }

  // Race-check: ensure the new email isn't taken in the interim.
  const taken = await sql`SELECT 1 FROM users WHERE lower(email) = ${String(rec.new_email).toLowerCase()} AND id != ${rec.user_id}`;
  if (taken.length) { await sql.end(); return c.json({ error: 'That email was claimed by another account' }, 409); }

  await sql`UPDATE users SET email = ${rec.new_email} WHERE id = ${rec.user_id}`;
  await sql`UPDATE email_change_requests SET confirmed_at = datetime('now') WHERE id = ${rec.id}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id)
            VALUES ('email_changed',
                    ${`Email changed from ${rec.old_email} to ${rec.new_email} (revocable until ${rec.revoke_expires_at})`},
                    ${rec.new_email}, ${rec.user_id})`;
  await sql.end();
  return c.json({ ok: true, email: rec.new_email, revoke_expires_at: rec.revoke_expires_at });
});

settings.post('/email-change/revoke', async (c) => {
  await ensureSchema(c.env);
  const body = await c.req.json().catch(() => ({} as any));
  const token = clampStr(body?.token, 200);
  if (!token) return c.json({ error: 'Token required' }, 400);
  const tokenHash = await hashToken(token);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM email_change_requests WHERE revoke_token_hash = ${tokenHash}`;
  if (!rows.length) { await sql.end(); return c.json({ error: 'Invalid or expired link' }, 400); }
  const rec = rows[0];
  if (rec.revoked_at) { await sql.end(); return c.json({ error: 'Already revoked' }, 400); }
  if (new Date(rec.revoke_expires_at) < new Date()) { await sql.end(); return c.json({ error: 'Revocation window expired' }, 400); }

  // If the change had already landed, reverse it.
  if (rec.confirmed_at) {
    await sql`UPDATE users SET email = ${rec.old_email} WHERE id = ${rec.user_id}`;
  }
  await sql`UPDATE email_change_requests SET revoked_at = datetime('now') WHERE id = ${rec.id}`;
  // Bump min_iat so any tokens minted under the new email are forced out.
  const nowSec = Math.floor(Date.now() / 1000);
  await sql`UPDATE users SET jwt_min_iat = ${nowSec} WHERE id = ${rec.user_id}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id)
            VALUES ('email_change_revoked',
                    ${`Email change revoked: ${rec.new_email} -> ${rec.old_email}; all sessions invalidated`},
                    ${rec.old_email}, ${rec.user_id})`;
  await sql.end();
  return c.json({ ok: true, email: rec.old_email });
});

// --- TOTP repair ------------------------------------------------------------

settings.post('/totp/repair', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const code = clampStr(body?.totp_code, 12);
  if (!code) return c.json({ error: 'Current TOTP code required' }, 400);

  const sql = getSQL(c.env);
  const rows = await sql`SELECT password_hash FROM users WHERE id = ${user.id}`;
  if (!rows.length || !rows[0].password_hash) {
    await sql.end();
    return c.json({ error: 'TOTP is not configured for this account' }, 400);
  }
  const current = new TOTP({ secret: Secret.fromBase32(rows[0].password_hash) });
  if (current.validate({ token: code, window: 1 }) === null) {
    await sql.end();
    return c.json({ error: 'Invalid current TOTP code' }, 401);
  }

  const secret = new Secret();
  const newTotp = new TOTP({ issuer: 'Axal VC StudioOS', label: user.email, secret });
  const newSecret = secret.base32;
  await sql`UPDATE users SET password_hash = ${newSecret} WHERE id = ${user.id}`;
  // Invalidate existing sessions — the user is about to scan a new QR.
  const nowSec = Math.floor(Date.now() / 1000);
  await sql`UPDATE users SET jwt_min_iat = ${nowSec} WHERE id = ${user.id}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id)
            VALUES ('totp_repaired', 'User re-paired TOTP from /settings; all sessions invalidated',
                    ${user.email}, ${user.id})`;
  await sql.end();

  const uri = newTotp.toString();
  let qrBase64: string | null = null;
  try {
    const dataUrl = await QRCode.toDataURL(uri);
    qrBase64 = dataUrl.replace('data:image/png;base64,', '');
  } catch {}
  return c.json({
    ok: true,
    totp_secret: newSecret,
    provisioning_uri: uri,
    qr_code: qrBase64,
    message: 'Scan the new QR with your authenticator. Your existing sessions have been signed out.',
  });
});

// --- Sessions: sign out everywhere ------------------------------------------

settings.post('/sessions/revoke-all', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  // +1s so that even tokens issued in this same second (rounding) get bounced.
  const nowSec = Math.floor(Date.now() / 1000) + 1;
  await sql`UPDATE users SET jwt_min_iat = ${nowSec} WHERE id = ${user.id}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id)
            VALUES ('sessions_revoked_all', 'User revoked all active sessions from /settings',
                    ${user.email}, ${user.id})`;
  await sql.end();
  return c.json({ ok: true, revoked_at: nowSec });
});

// --- Account: delete request + data export ----------------------------------

settings.post('/account/delete-request', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  await sql`UPDATE users SET deletion_requested_at = COALESCE(deletion_requested_at, datetime('now')) WHERE id = ${user.id}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id)
            VALUES ('account_deletion_requested',
                    'User requested account deletion via /settings (manual review required)',
                    ${user.email}, ${user.id})`;
  await sql.end();
  return c.json({ ok: true, message: 'Deletion request received. Our team will reach out within 7 days.' });
});

settings.post('/account/delete-request/cancel', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  await sql`UPDATE users SET deletion_requested_at = NULL WHERE id = ${user.id}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id)
            VALUES ('account_deletion_cancelled', 'User cancelled their pending deletion request',
                    ${user.email}, ${user.id})`;
  await sql.end();
  return c.json({ ok: true });
});

settings.get('/data-export', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const userRow = await sql`SELECT id, uid, email, name, role, bio, jurisdictions, socials,
                                   notification_prefs, privacy_prefs, role_prefs,
                                   kyc_status, created_at, last_active_at
                            FROM users WHERE id = ${user.id}`;
  const activity = await sql`SELECT action, details, created_at FROM activity_logs WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 500`;
  await sql.end();
  const payload = {
    exported_at: new Date().toISOString(),
    user: userRow[0] || null,
    recent_activity: activity,
    note: 'This export contains your account profile and the most recent 500 activity log entries. For a full export across all sub-systems (deals, projects, KYC), contact support.',
  };
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="axal-data-export-${user.uid || user.id}.json"`,
    },
  });
});

// --- Sessions: list + per-session revoke ------------------------------------

settings.get('/sessions', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT id, jti, user_agent, ip, created_at, last_seen_at, revoked_at
    FROM user_sessions
    WHERE user_id = ${user.id}
    ORDER BY last_seen_at DESC
    LIMIT 100
  ` as unknown as UserSessionRow[];
  await sql.end();
  const currentJti = currentJtiFromRequest(c);
  return c.json({
    sessions: rows.map((r) => ({
      id: r.id,
      jti: r.jti,
      user_agent: r.user_agent,
      ip: r.ip,
      created_at: r.created_at,
      last_seen_at: r.last_seen_at,
      revoked_at: r.revoked_at,
      is_current: !!currentJti && r.jti === currentJti,
    })),
  });
});

settings.post('/sessions/:id/revoke', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id') || '0', 10);
  if (!id) return c.json({ error: 'session id required' }, 400);
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM user_sessions WHERE id = ${id} AND user_id = ${user.id}`;
  if (!owned.length) { await sql.end(); return c.json({ error: 'Not found' }, 404); }
  await sql`UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ${id} AND user_id = ${user.id}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id)
            VALUES ('session_revoked', ${`User revoked session ${id} from /settings`}, ${user.email}, ${user.id})`;
  await sql.end();
  return c.json({ ok: true });
});

// --- TOTP recovery codes ----------------------------------------------------
//
// 8 one-time codes formatted XXXX-XXXX-XXXX, each ~62 bits of entropy. We
// store SHA-256 hashes in users.totp_recovery_codes and return the plaintext
// to the user exactly once. Login consumption (verifying a code instead of a
// TOTP) is intentionally a follow-up — this surface only covers generation
// and rotation, which is the architect's explicit ask for "recovery codes
// management".

function generateRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip ambiguous I,O,0,1
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars: string[] = [];
  for (let i = 0; i < 12; i++) chars.push(alphabet[bytes[i] % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

settings.post('/totp/recovery-codes/regenerate', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const code = clampStr(body?.totp_code, 12);
  if (!code) return c.json({ error: 'Current TOTP code required' }, 400);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT password_hash FROM users WHERE id = ${user.id}`;
  if (!rows.length || !rows[0].password_hash) {
    await sql.end();
    return c.json({ error: 'TOTP is not configured for this account' }, 400);
  }
  const totp = new TOTP({ secret: Secret.fromBase32(rows[0].password_hash) });
  if (totp.validate({ token: code, window: 1 }) === null) {
    await sql.end();
    return c.json({ error: 'Invalid current TOTP code' }, 401);
  }
  // T5 — 10 codes (was 8) to match the audit-plan spec and the Settings UI
  // copy ("X of 10 remaining"). Single-use semantics are enforced on the
  // login path (auth.ts:tryConsumeRecoveryCode).
  const plain: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const c1 = generateRecoveryCode();
    plain.push(c1);
    hashes.push(await hashToken(c1));
  }
  await sql`UPDATE users SET totp_recovery_codes = ${JSON.stringify(hashes)} WHERE id = ${user.id}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id)
            VALUES ('totp_recovery_codes_regenerated', 'User regenerated TOTP recovery codes', ${user.email}, ${user.id})`;
  await sql.end();
  return c.json({
    ok: true,
    codes: plain,
    message: 'Save these codes somewhere safe — they will not be shown again. Each code can be used once if you lose access to your authenticator.',
  });
});

// --- Founder co-founder invites ---------------------------------------------

settings.get('/founder/invites', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  if (user.role !== 'founder') return c.json({ error: 'Founder role required' }, 403);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT id, project_id, invitee_email, invitee_name, role, created_at, expires_at, accepted_at, revoked_at
    FROM founder_invites
    WHERE inviter_user_id = ${user.id}
    ORDER BY created_at DESC
    LIMIT 100
  `;
  await sql.end();
  return c.json({ invites: rows, cap_per_project: FOUNDER_INVITE_CAP_PER_PROJECT });
});

settings.post('/founder/invites', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  if (user.role !== 'founder') return c.json({ error: 'Founder role required' }, 403);
  const body = await c.req.json().catch(() => ({} as any));
  const inviteeEmail = clampStr(body?.invitee_email, 254);
  if (!inviteeEmail || !isEmail(inviteeEmail)) return c.json({ error: 'Valid invitee_email required' }, 400);
  const inviteeName = clampStr(body?.invitee_name, 120);
  const role = clampStr(body?.role, 40) || 'co-founder';
  const projectId = body?.project_id != null ? parseInt(String(body.project_id), 10) || null : null;

  const sql = getSQL(c.env);
  // Authorization: if a project_id is supplied, the inviting founder must
  // own that project. Without this check, any founder could consume the
  // invite cap on any other founder's project (broken access control).
  if (projectId !== null) {
    if (!user.founder_id) {
      await sql.end();
      return c.json({ error: 'Founder profile required to invite to a project' }, 403);
    }
    const owns = await sql`SELECT id FROM projects WHERE id = ${projectId} AND founder_id = ${user.founder_id}`;
    if (!owns.length) {
      await sql.end();
      return c.json({ error: 'Project not found or not owned by you' }, 403);
    }
  }
  // Cap pending+accepted invites per project (or per inviter when project null).
  const countRows = projectId
    ? await sql`SELECT COUNT(*) AS n FROM founder_invites WHERE project_id = ${projectId} AND revoked_at IS NULL`
    : await sql`SELECT COUNT(*) AS n FROM founder_invites WHERE project_id IS NULL AND inviter_user_id = ${user.id} AND revoked_at IS NULL`;
  const n = Number(countRows[0]?.n || 0);
  if (n >= FOUNDER_INVITE_CAP_PER_PROJECT) {
    await sql.end();
    return c.json({ error: `Invite cap reached (${FOUNDER_INVITE_CAP_PER_PROJECT} per project)` }, 409);
  }

  const tokenRaw = generateToken();
  const tokenHash = await hashToken(tokenRaw);
  const expires = new Date(Date.now() + FOUNDER_INVITE_EXPIRY_DAYS * 86400 * 1000).toISOString();
  await sql`INSERT INTO founder_invites
            (project_id, inviter_user_id, invitee_email, invitee_name, role, token_hash, expires_at)
            VALUES (${projectId}, ${user.id}, ${inviteeEmail}, ${inviteeName}, ${role}, ${tokenHash}, ${expires})`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id)
            VALUES ('cofounder_invited', ${`Invited ${inviteeEmail} as ${role}`}, ${user.email}, ${user.id})`;
  await sql.end();

  const acceptUrl = `${APP_URL(c.env)}/invites/cofounder?token=${tokenRaw}`;
  const sent = await sendVerificationEmail(c.env, inviteeEmail, inviteeName || inviteeEmail, acceptUrl).catch(() => false);
  return c.json({
    ok: true,
    invitee_email: inviteeEmail,
    expires_at: expires,
    accept_url: !sent ? acceptUrl : undefined,
    email_sent: sent,
  });
});

settings.delete('/founder/invites/:id', async (c) => {
  await ensureSchema(c.env);
  const user = await requireAuth(c);
  if (user.role !== 'founder') return c.json({ error: 'Founder role required' }, 403);
  const id = parseInt(c.req.param('id') || '0', 10);
  if (!id) return c.json({ error: 'invite id required' }, 400);
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM founder_invites WHERE id = ${id} AND inviter_user_id = ${user.id} AND revoked_at IS NULL`;
  if (!owned.length) { await sql.end(); return c.json({ error: 'Not found' }, 404); }
  await sql`UPDATE founder_invites SET revoked_at = datetime('now') WHERE id = ${id}`;
  await sql.end();
  return c.json({ ok: true });
});

export default settings;
