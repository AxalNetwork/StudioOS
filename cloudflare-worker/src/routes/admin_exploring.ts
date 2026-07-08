/**
 * Task #9 — Admin review queue for 'exploring' users.
 *
 * Users who complete the onboarding chatbot land in the 'exploring' holding
 * role (routes/profiling.ts /save) with the inferred persona stored as a
 * SUGGESTION in `user_role_review`. This router is the only path that turns
 * that suggestion into a real role:
 *
 *   GET  /users                  — list exploring users (profile summary,
 *                                  suggested role, profiling progress,
 *                                  binding-agreement envelope status)
 *   POST /users/:id/binding      — create + send the binding-agreement
 *                                  e-sign envelope (native or DocuSign)
 *   POST /users/:id/assign-role  — assign the final role; allowed ONLY once
 *                                  the binding envelope is status='completed'
 *
 * Mounted at /api/admin/exploring BEFORE the catch-all /api/admin router.
 * requireAdmin per-route (no requireCfAccess — see Task #33 note in index.ts).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { getSQL } from '../db';
import { hashEmail } from '../util/hashEmail';
import { createAndSendEnvelope } from './esign';
import { ensureExploringSchema } from '../services/exploringSchema';
import { clampLimit } from '../util/pagination';

const adminExploring = new Hono<{ Bindings: Env }>();

const ASSIGNABLE_ROLES = new Set(['founder', 'investor', 'partner', 'advisor']);
const DEFAULT_BINDING_DOC_TYPE = 'binding_agreement';

function appUrl(env: Env): string {
  return env.APP_URL || 'https://axal.vc';
}

async function logAdminAction(
  env: Env, adminId: number, adminEmail: string, action: string, details: Record<string, unknown>,
): Promise<void> {
  try {
    const actorHash = await hashEmail(adminEmail);
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(action, JSON.stringify(details), actorHash, adminId).run();
  } catch (e) { console.warn('[admin_exploring] activity log failed', e); }
  try {
    await env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, filters_json) VALUES (?, ?, ?)`,
    ).bind(adminId, action, JSON.stringify(details)).run();
  } catch { /* admin_audit_log may not exist in some envs */ }
}

// ---------------------------------------------------------------------------
// GET /users — exploring users awaiting review.
// One grouped COUNT sub-select for profiling progress (no per-user N+1).
// ---------------------------------------------------------------------------
adminExploring.get('/users', async (c) => {
  await requireAdmin(c);
  await ensureExploringSchema(c.env);
  const limit = clampLimit(c.req.query('limit'), 100, 500);
  const offset = Math.max(0, Number(c.req.query('offset') || 0) || 0);
  try {
    const rows = await c.env.DB.prepare(
      `SELECT
         u.id, u.email, u.name, u.role, u.created_at,
         rr.suggested_role, rr.role_confirmed, rr.onboarded_at,
         rr.binding_envelope_id, rr.binding_document_type, rr.binding_sent_at,
         rr.assigned_role, rr.assigned_at,
         e.envelope_uuid AS binding_envelope_uuid,
         e.status AS binding_status,
         e.completed_at AS binding_completed_at,
         pp.persona AS profile_persona,
         pp.founder_track, pp.legal_entity_name, pp.entity_type,
         pp.current_stage, pp.partnership_goal, pp.existing_jurisdiction,
         pp.admin_status AS profile_admin_status,
         COALESCE(aa.answered, 0) AS profiling_answered
       FROM users u
       LEFT JOIN user_role_review rr ON rr.user_id = u.id
       LEFT JOIN esign_envelopes e ON e.id = rr.binding_envelope_id
       LEFT JOIN partner_profiles pp ON pp.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(DISTINCT question_id) AS answered
         FROM advisor_answers
         WHERE saved_status IN ('saved', 'noop')
         GROUP BY user_id
       ) aa ON aa.user_id = u.id
       WHERE u.role = 'exploring'
       ORDER BY COALESCE(rr.onboarded_at, u.created_at) DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all();
    return c.json({ users: rows.results || [], limit, offset });
  } catch (e) {
    console.error('[admin_exploring] list failed', e);
    return c.json({ error: 'Failed to list exploring users' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /users/:id/binding — send the binding-agreement envelope.
// Body: { document_type?, provider? ('native'|'docusign'), merge_fields? }
// ---------------------------------------------------------------------------
adminExploring.post('/users/:id/binding', async (c) => {
  const admin = await requireAdmin(c);
  await ensureExploringSchema(c.env);
  const userId = Number(c.req.param('id'));
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'Invalid user id' }, 400);
  const body = await c.req.json().catch(() => ({} as any));
  const documentType = String(body?.document_type || DEFAULT_BINDING_DOC_TYPE).trim();
  if (!documentType || documentType.length > 100) return c.json({ error: 'Invalid document_type' }, 400);
  const providerRaw = String(body?.provider ?? 'native').toLowerCase();
  const viaProvider: 'native' | 'docusign' = providerRaw === 'docusign' ? 'docusign' : 'native';

  const target = await c.env.DB.prepare(
    `SELECT id, email, name, role FROM users WHERE id = ?`
  ).bind(userId).first<{ id: number; email: string; name: string | null; role: string }>();
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (String(target.role).toLowerCase() !== 'exploring') {
    return c.json({ error: 'User is not in the exploring holding state' }, 409);
  }

  const sent = await createAndSendEnvelope(c.env, {
    adminUserId: admin.id,
    adminName: admin.name || admin.email,
    recipientUserId: target.id,
    recipientEmail: target.email,
    recipientName: target.name || target.email,
    documentType,
    appUrl: appUrl(c.env),
    viaProvider,
  });
  if (!sent) return c.json({ error: 'Failed to create/send the binding envelope' }, 502);

  try {
    await c.env.DB.prepare(
      `INSERT INTO user_role_review (user_id, binding_envelope_id, binding_document_type, binding_sent_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         binding_envelope_id = excluded.binding_envelope_id,
         binding_document_type = excluded.binding_document_type,
         binding_sent_at = excluded.binding_sent_at,
         updated_at = datetime('now')`
    ).bind(target.id, sent.envelope_id, documentType).run();
  } catch (e) {
    console.error('[admin_exploring] binding ref store failed', e);
    return c.json({ error: 'Envelope sent but failed to record it — refresh and verify' }, 500);
  }

  await logAdminAction(c.env, admin.id, admin.email, 'exploring_binding_sent', {
    target_user_id: target.id,
    envelope_id: sent.envelope_id,
    document_type: documentType,
    provider: sent.provider || viaProvider,
  });
  return c.json({
    sent: true,
    envelope_id: sent.envelope_id,
    envelope_uuid: sent.envelope_uuid,
    signing_url: sent.signing_url,
    email_sent: sent.email_sent,
  });
});

// ---------------------------------------------------------------------------
// POST /users/:id/assign-role — final role assignment, envelope-gated.
// Body: { role: 'founder'|'investor'|'partner'|'advisor' }
// ---------------------------------------------------------------------------
adminExploring.post('/users/:id/assign-role', async (c) => {
  const admin = await requireAdmin(c);
  await ensureExploringSchema(c.env);
  const userId = Number(c.req.param('id'));
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'Invalid user id' }, 400);
  const body = await c.req.json().catch(() => ({} as any));
  const role = String(body?.role || '').trim().toLowerCase();
  // Whitelist — 'admin' (or anything else) is NEVER assignable from here.
  if (!ASSIGNABLE_ROLES.has(role)) {
    return c.json({ error: `role must be one of: ${[...ASSIGNABLE_ROLES].join(', ')}` }, 400);
  }

  const target = await c.env.DB.prepare(
    `SELECT id, email, name, role FROM users WHERE id = ?`
  ).bind(userId).first<{ id: number; email: string; name: string | null; role: string }>();
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (String(target.role).toLowerCase() !== 'exploring') {
    return c.json({ error: 'User is not in the exploring holding state' }, 409);
  }

  // Envelope gate: the binding envelope must exist, belong to THIS user,
  // and be completed. Never trust status alone.
  const review = await c.env.DB.prepare(
    `SELECT binding_envelope_id FROM user_role_review WHERE user_id = ?`
  ).bind(target.id).first<{ binding_envelope_id: number | null }>();
  if (!review?.binding_envelope_id) {
    return c.json({ error: 'No binding agreement has been sent to this user yet' }, 409);
  }
  const envelope = await c.env.DB.prepare(
    `SELECT id, user_id, status, completed_at FROM esign_envelopes WHERE id = ?`
  ).bind(review.binding_envelope_id).first<{ id: number; user_id: number | null; status: string; completed_at: string | null }>();
  if (!envelope || Number(envelope.user_id) !== target.id) {
    return c.json({ error: 'Binding envelope not found for this user' }, 409);
  }
  if (String(envelope.status).toLowerCase() !== 'completed') {
    return c.json({ error: `Binding agreement is not signed yet (status: ${envelope.status})` }, 409);
  }

  try {
    await c.env.DB.prepare(`UPDATE users SET role = ? WHERE id = ?`).bind(role, target.id).run();
  } catch (e) {
    console.error('[admin_exploring] role assignment failed', e);
    return c.json({ error: 'Role update failed' }, 500);
  }
  try {
    await c.env.DB.prepare(
      `UPDATE user_role_review SET
         role_confirmed = 1,
         assigned_role = ?,
         assigned_by_user_id = ?,
         assigned_at = datetime('now'),
         updated_at = datetime('now')
       WHERE user_id = ?`
    ).bind(role, admin.id, target.id).run();
  } catch (e) { console.error('[admin_exploring] review row update failed', e); }

  // Founder/investor get their role-specific onboarding wizard on next load:
  // App.jsx resumes the wizard when onboarding_progress.flow === user.role
  // and completed_at IS NULL. The chat gate cannot re-engage (flow!='chat').
  if (role === 'founder' || role === 'investor') {
    try {
      await c.env.DB.prepare(
        `INSERT INTO onboarding_progress (user_id, flow, step, total_steps, completed_at, updated_at)
         VALUES (?, ?, 0, 0, NULL, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           flow = excluded.flow,
           step = 0,
           completed_at = NULL,
           updated_at = datetime('now')`
      ).bind(target.id, role).run();
    } catch (e) { console.error('[admin_exploring] onboarding_progress reset failed', e); }
  }

  // Spin-Out Lab auto-start (moved here from the old /api/profiling/save
  // auto-promotion): founder + 'Spin-Out (New)' track recorded by the chatbot.
  let labStarted = false;
  if (role === 'founder') {
    try {
      const pp = await c.env.DB.prepare(
        `SELECT founder_track FROM partner_profiles WHERE user_id = ?`
      ).bind(target.id).first<{ founder_track: string | null }>();
      if (pp?.founder_track === 'Spin-Out (New)') {
        const sql = getSQL(c.env);
        try {
          const { startLab } = await import('./spinout_lab');
          const res = await startLab(sql as any, target.id);
          labStarted = !!(res as any)?.ok;
        } finally {
          await sql.end();
        }
      }
    } catch (e) { console.error('[admin_exploring] spinout lab start failed', e); }
  }

  await logAdminAction(c.env, admin.id, admin.email, 'exploring_role_assigned', {
    target_user_id: target.id,
    assigned_role: role,
    envelope_id: envelope.id,
    lab_started: labStarted,
  });
  return c.json({ assigned: true, user_id: target.id, role, lab_started: labStarted });
});

export default adminExploring;
