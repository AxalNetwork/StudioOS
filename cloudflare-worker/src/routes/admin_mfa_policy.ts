/**
 * D5249 (#5249): HQ's "Require MFA for admins" setting — read and change it.
 * Super Admin only; a change needs a reason and writes its audit row in the
 * same batch. Turning it on is refused to a Super Admin without MFA, so the
 * switch can never be thrown by someone it would lock out (option B,
 * enrol-first). The gate itself is `requireAdmin` (auth.ts).
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { adminAuditStatement } from '../services/adminAudit';
import { ensureAdminAuditLogTable } from './admin';
import { REQUIRE_ADMIN_MFA_KEY, hasMfaEnrolled, readAdminMfaPolicy } from '../services/adminMfaPolicy';
import { refuse } from '../util/refusal';
import adminSecurity from './admin_security';

const r = new Hono<{ Bindings: Env }>();

/** The shortest and longest reason accepted for a change. */
export const REASON_MIN = 3;
export const REASON_MAX = 500;

/**
 * How many active admins have no MFA — the ones enforcement sends to enrol.
 * Null when it cannot be read: the screen says Unreadable, never zero.
 */
async function adminsWithoutMfa(env: Env): Promise<number | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users
        WHERE LOWER(role) = 'admin' AND is_active = 1
          AND NOT (tfa_methods IS NOT NULL AND tfa_methods <> '[]')`,
    ).first<{ n: number }>();
    return row ? Number(row.n) || 0 : null;
  } catch (e) {
    console.warn('[admin_mfa_policy] admin MFA count unreadable', (e as Error).message);
    return null;
  }
}

async function policyBody(env: Env) {
  const policy = await readAdminMfaPolicy(env);
  return {
    enabled: policy.on,
    readable: policy.readable,
    updated_at: policy.updated_at,
    updated_by: policy.updated_by,
    admins_without_mfa: await adminsWithoutMfa(env),
    // Said on the read, so the control never implies more than it does.
    effect: 'While on, an administrator without MFA is sent to enrol and reaches no admin page until they do.',
  };
}

r.get('/', async (c: Context<{ Bindings: Env }>) => {
  try {
    await requireSuperAdmin(c);
    return c.json(await policyBody(c.env));
  } catch (e) {
    return mapError(c, e);
  }
});

r.put('/', async (c: Context<{ Bindings: Env }>) => {
  let admin;
  try {
    // A TOTP session and a recent step-up, as every switch write has (D4703).
    admin = await requireSuperAdminWriteBar(c);
  } catch (e) {
    return mapError(c, e);
  }
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  if (typeof body?.enabled !== 'boolean') {
    return refuse(c, 400, { code: 'invalid_enabled', message: 'Say whether MFA is required: enabled must be true or false.' });
  }
  const enabled = body.enabled as boolean;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return refuse(c, 400, { code: 'reason_required', message: `Give a reason for this change (${REASON_MIN} to ${REASON_MAX} characters).` });
  }

  // ENROL-FIRST. The write bar already needs a TOTP session; this says it in
  // the setting's own terms, so a later change to the bar cannot let a Super
  // Admin without MFA switch on the rule that would lock them out.
  if (enabled && !hasMfaEnrolled(admin as any)) {
    return refuse(c, 409, { code: 'actor_without_mfa', message: 'Enrol MFA on your own account before requiring it for administrators.' });
  }

  const before = await readAdminMfaPolicy(c.env);
  if (!before.readable) {
    return refuse(c, 503, { code: 'store_unavailable', message: 'The current setting could not be read, so nothing was changed.' });
  }
  if (before.on === enabled) {
    return c.json({ ...(await policyBody(c.env)), changed: false });
  }

  const actor = String((admin as any)?.email || (admin as any)?.id || 'super_admin');
  try {
    await ensureAdminAuditLogTable(c.env);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO platform_settings (key, value, updated_at, updated_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      ).bind(REQUIRE_ADMIN_MFA_KEY, enabled ? '1' : '0', new Date().toISOString(), actor),
      adminAuditStatement(c.env, Number((admin as any).id), 'require_admin_mfa_update',
        { from: before.on, to: enabled, reason }),
    ]);
  } catch (e) {
    console.warn('[admin_mfa_policy] write failed', (e as Error).message);
    return refuse(c, 503, { code: 'store_unavailable', message: 'The setting could not be saved with its audit record, so nothing was changed.' });
  }
  return c.json({ ...(await policyBody(c.env)), changed: true });
});

export default r;
// Ahead of the legacy `/api/admin/security` mount, whose routes would otherwise see this path first.
export const mount = { path: '/api/admin/security/mfa-policy', router: r, before: [adminSecurity] };
