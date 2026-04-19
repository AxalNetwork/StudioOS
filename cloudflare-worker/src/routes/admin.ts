import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAdmin, createJWT, hashToken } from '../auth';

const admin = new Hono<{ Bindings: Env }>();

// Lazy schema migration — adds the columns the admin profile UI relies on
// without breaking older databases. Idempotent and cheap (CF wraps the
// PRAGMA-style ALTER in IF NOT EXISTS semantics for column adds via try/catch).
let profileSchemaMigrated = false;
async function ensureProfileColumns(env: Env): Promise<void> {
  if (profileSchemaMigrated) return;
  const stmts = [
    `ALTER TABLE users ADD COLUMN admin_notes TEXT`,
    `ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch {} // duplicate-column errors are expected
  }
  profileSchemaMigrated = true;
}

admin.get('/users', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, uid, email, name, role, is_active, email_verified, created_at FROM users ORDER BY created_at DESC`;
  await sql.end();
  return c.json(rows);
});

// GET /api/admin/users/:user_id/profile — comprehensive admin view of a user.
// Returns: user record, registration timeline, KYC status, agreements
// (eSign envelopes), recent activity logs (with full detail), tickets,
// integrations, founder/partner profile snippets. Single endpoint to keep
// the modal load to one round-trip.
admin.get('/users/:user_id/profile', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureProfileColumns(c.env);
  const userId = parseInt(c.req.param('user_id'));
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ error: 'Invalid user_id' }, 400);

  const userRow: any = await c.env.DB.prepare(
    `SELECT id, uid, email, name, role, is_active, email_verified, founder_id, partner_id,
            kyc_status, kyc_provider, kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason,
            COALESCE(admin_notes, '') AS admin_notes, last_active_at, created_at
       FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!userRow) return c.json({ error: 'User not found' }, 404);

  // ----- Activity logs (D1, last 100) -----
  const activityRes: any = await c.env.DB.prepare(
    `SELECT id, action, details, actor, created_at
       FROM activity_logs
      WHERE user_id = ? OR LOWER(actor) = LOWER(?)
      ORDER BY datetime(created_at) DESC
      LIMIT 100`
  ).bind(userId, userRow.email).all();
  const activity = activityRes?.results || [];

  // ----- Registration / lifecycle timeline -----
  // Build from the user row + selected activity_log events. Includes account
  // creation, email verification, KYC milestones, role changes, eSign sent,
  // eSign signed.
  const REG_ACTIONS = new Set([
    'user_registered', 'email_verified', 'email_verified_admin',
    'profile_captured', 'profile_reviewed_by_admin', 'profile_verified',
    'kyc_submitted', 'kyc_approved', 'kyc_approved_by_admin',
    'kyc_rejected', 'kyc_rejected_by_admin',
    'role_changed', 'your_role_changed',
    'account_status_changed', 'user_toggled',
    'esign_envelope_created', 'esign_envelope_sent', 'esign_signed',
    'esign_document_downloaded_by_recipient', 'esign_envelope_completed',
  ]);
  const timeline = [
    {
      ts: userRow.created_at,
      kind: 'account_created',
      label: 'Account created',
      detail: `Registered as ${userRow.role}`,
    },
    ...activity
      .filter((a: any) => REG_ACTIONS.has(a.action))
      .map((a: any) => ({
        ts: a.created_at,
        kind: a.action,
        label: a.action.replace(/_/g, ' '),
        detail: a.details || null,
      })),
  ].sort((x, y) => String(y.ts).localeCompare(String(x.ts)));

  // ----- Agreements (eSign) — both as recipient and as creator -----
  // Lazy schema dependency: if esign tables don't exist yet, swallow.
  let agreements: any[] = [];
  try {
    // Schema reference (esign.ts): esign_envelopes has `completed_at` (not
    // `signed_at`); per-recipient signing timestamps live on
    // esign_recipients.signed_at.
    const recRes: any = await c.env.DB.prepare(
      `SELECT e.id            AS envelope_id,
              e.envelope_uuid,
              e.document_type,
              e.document_title,
              e.status        AS envelope_status,
              e.created_at,
              e.completed_at,
              r.id            AS recipient_id,
              r.recipient_email,
              r.recipient_name,
              r.status        AS recipient_status,
              r.signed_at     AS recipient_signed_at,
              r.token_expires_at,
              CASE WHEN e.created_by = ? THEN 'creator' ELSE 'recipient' END AS role_in_envelope
         FROM esign_envelopes e
         LEFT JOIN esign_recipients r ON r.envelope_id = e.id
        WHERE e.user_id = ?
           OR LOWER(r.recipient_email) = LOWER(?)
           OR e.created_by = ?
        ORDER BY datetime(e.created_at) DESC
        LIMIT 50`
    ).bind(userId, userId, userRow.email, userId).all();
    agreements = recRes?.results || [];
  } catch (e: any) {
    // Surface schema mismatches loudly — empty agreements is misleading if
    // the cause is a query bug rather than missing data.
    console.error('[admin/profile] esign agreements query failed:', e?.message, e?.stack);
  }

  // ----- Tickets (best-effort) -----
  let tickets: any[] = [];
  try {
    const tres: any = await c.env.DB.prepare(
      `SELECT id, title, status, priority, created_at
         FROM tickets WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT 20`
    ).bind(userId).all();
    tickets = tres?.results || [];
  } catch {}

  // ----- Integrations (best-effort) -----
  let integrations: any[] = [];
  try {
    const ires: any = await c.env.DB.prepare(
      `SELECT uid, provider_name, display_name, status, last_synced_at
         FROM integrations WHERE user_id = ? ORDER BY datetime(created_at) DESC`
    ).bind(userId).all();
    integrations = ires?.results || [];
  } catch {}

  // ----- Linked founder / partner row -----
  let founder: any = null;
  if (userRow.founder_id) {
    try {
      founder = await c.env.DB.prepare(`SELECT * FROM founders WHERE id = ?`).bind(userRow.founder_id).first();
    } catch {}
  }
  let partner: any = null;
  if (userRow.partner_id) {
    try {
      partner = await c.env.DB.prepare(`SELECT * FROM partners WHERE id = ?`).bind(userRow.partner_id).first();
    } catch {}
  }

  // Audit trail — admin viewed this profile.
  try {
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind('admin_viewed_profile',
      `Admin ${adminUser.name} viewed full profile for ${userRow.name} (${userRow.email})`,
      adminUser.email, adminUser.id).run();
  } catch {}

  return c.json({
    ok: true,
    user: userRow,
    kyc: {
      status: userRow.kyc_status || 'not_started',
      provider: userRow.kyc_provider || null,
      submitted_at: userRow.kyc_submitted_at || null,
      reviewed_at: userRow.kyc_reviewed_at || null,
      rejection_reason: userRow.kyc_rejection_reason || null,
      totp_enabled: false, // placeholder — wire to actual TOTP table when added
      id_uploaded: userRow.kyc_status && userRow.kyc_status !== 'not_started',
    },
    timeline,
    agreements,
    activity,
    tickets,
    integrations,
    founder,
    partner,
    stats: {
      activity_count: activity.length,
      ticket_count: tickets.length,
      integration_count: integrations.length,
      agreement_count: agreements.length,
      signed_agreement_count: agreements.filter((a: any) => a.recipient_status === 'signed').length,
    },
  });
});

// POST /api/admin/users/:user_id/notes — admin updates internal notes.
admin.post('/users/:user_id/notes', async (c) => {
  const adminUser = await requireAdmin(c);
  await ensureProfileColumns(c.env);
  const userId = parseInt(c.req.param('user_id'));
  if (!Number.isFinite(userId)) return c.json({ error: 'Invalid user_id' }, 400);
  const body: any = await c.req.json().catch(() => ({}));
  const notes = String(body?.admin_notes ?? '').slice(0, 8000);

  const r: any = await c.env.DB.prepare(
    `UPDATE users SET admin_notes = ? WHERE id = ?`
  ).bind(notes, userId).run();
  if ((r?.meta?.changes || 0) < 1) return c.json({ error: 'User not found' }, 404);

  try {
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind('admin_notes_updated',
      `Admin ${adminUser.name} updated internal notes (${notes.length} chars)`,
      adminUser.email, adminUser.id).run();
  } catch {}

  return c.json({ ok: true });
});

// POST /api/admin/users/:user_id/resend-verification — re-send the email
// verification link for users who haven't completed verification.
admin.post('/users/:user_id/resend-verification', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('user_id'));
  if (!Number.isFinite(userId)) return c.json({ error: 'Invalid user_id' }, 400);

  const target: any = await c.env.DB.prepare(
    `SELECT id, email, name, email_verified FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (target.email_verified) return c.json({ ok: true, already_verified: true });

  // Generate a fresh verification token + email it. The verify route in
  // routes/auth.ts consumes `verification_token`. We mint a 32-byte token
  // and a 24-hour TTL so the link doesn't immediately expire.
  // The /auth/verify-email handler hashes the incoming token and compares
  // against the hashed value in users.verification_token, so we must store
  // the HASH (not the raw token) and email the raw token in the link.
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const rawToken = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const tokenHash = await hashToken(rawToken);
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await c.env.DB.prepare(
    `UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?`
  ).bind(tokenHash, expires, userId).run();

  // Best-effort email send via Gmail OAuth helper (already used elsewhere).
  // If creds aren't configured we still succeed at the DB write so the user
  // can be verified manually.
  let emailed = false;
  try {
    const { sendVerificationEmail } = await import('../services/email');
    const verifyUrl = `${c.env.APP_URL || 'https://axal.vc'}/verify-email?token=${rawToken}`;
    emailed = await sendVerificationEmail(c.env, target.email, target.name || '', verifyUrl);
  } catch (e: any) {
    console.error('[admin/resend-verification] email send failed', e);
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind('admin_resent_verification',
      `Admin ${adminUser.name} re-sent verification email to ${target.email}${emailed ? '' : ' (email send failed — token still rotated)'}`,
      adminUser.email, adminUser.id).run();
  } catch {}

  return c.json({ ok: true, already_verified: false, emailed });
});

admin.post('/impersonate/:userId', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('userId'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  const target = rows[0];
  const token = await createJWT(c.env, target.id, target.email, target.role, adminUser.id);
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('admin_impersonate', ${`Admin ${adminUser.name} impersonated user ${target.name} (${target.email})`}, ${adminUser.email}, ${adminUser.id})`;
  await sql.end();
  return c.json({ token, user: { id: target.id, email: target.email, name: target.name, role: target.role } });
});

admin.patch('/users/:userId/role', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('userId'));
  const { role } = await c.req.json();
  if (!['admin', 'founder', 'partner'].includes(role)) return c.json({ error: `Invalid role: ${role}` }, 400);

  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  if (rows[0].id === adminUser.id) { await sql.end(); return c.json({ error: 'Cannot change your own role' }, 400); }

  const oldRole = rows[0].role;
  await sql`UPDATE users SET role = ${role} WHERE id = ${userId}`;
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: 'partner', id: userId }); } catch {}
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('role_changed', ${`Admin ${adminUser.name} changed ${rows[0].name}'s role from ${oldRole} to ${role}`}, ${adminUser.email}, ${adminUser.id})`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('your_role_changed', ${`Your role was changed from ${oldRole} to ${role} by ${adminUser.name}`}, ${rows[0].email}, ${rows[0].id})`;
  await sql.end();
  return c.json({ message: `Role updated to ${role}`, user_id: userId, role });
});

admin.patch('/users/:userId/toggle-active', async (c) => {
  const adminUser = await requireAdmin(c);
  const userId = parseInt(c.req.param('userId'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'User not found' }, 404); }
  if (rows[0].id === adminUser.id) { await sql.end(); return c.json({ error: 'Cannot deactivate yourself' }, 400); }

  const newActive = !rows[0].is_active;
  await sql`UPDATE users SET is_active = ${newActive} WHERE id = ${userId}`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('user_toggled', ${`Admin ${adminUser.name} ${newActive ? 'activated' : 'deactivated'} user ${rows[0].name}`}, ${adminUser.email}, ${adminUser.id})`;
  await sql`INSERT INTO activity_logs (action, details, actor, user_id) VALUES ('account_status_changed', ${`Your account was ${newActive ? 'activated' : 'deactivated'} by an Axal admin`}, ${rows[0].email}, ${rows[0].id})`;
  await sql.end();
  return c.json({ message: `User ${newActive ? 'activated' : 'deactivated'}`, is_active: newActive });
});

export default admin;
