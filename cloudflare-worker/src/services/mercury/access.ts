/**
 * D710 (#1775) decisions 4 and 7 — who may touch Mercury, and the read audit.
 *
 *   act                                   Super Admin           Admin                     anyone else
 *   connect, replace, disconnect          write bar (TOTP,      403 super_admin_required  403
 *                                         fresh step-up)        (no step-up demand)
 *   read connections, accounts,           yes                   yes                       403
 *   transactions, matches; sync now;
 *   propose, confirm, reject a match
 *
 * Every route also refuses a support session (`impersonated_by`, as
 * `routes/mcp_consent.ts` reads it) and a branch Worker: these are HQ's
 * entities in HQ's database.
 *
 * WHY THE ELEVATION IS CHECKED BEFORE THE WRITE BAR. `requireSuperAdminWriteBar`
 * asks for TOTP and a fresh step-up before it checks the elevation, so a plain
 * Admin would be asked for a code it cannot use, and the SPA would open its
 * step-up modal for nothing. `super_admin_required` comes first and writes
 * nothing. Once #1779's `assertAdminAct` and its row for these acts are on
 * `main`, `requireMercuryCredentialWriter` calls it instead.
 */
import type { Context } from 'hono';
import type { Env, User } from '../../types';
import { isSuperAdmin, requireAdmin, requireAuth, requireSuperAdminWriteBar, selectJwt } from '../../auth';
import { branchOf, HQ_ONLY } from '../../util/branch';
import { ensureAdminAuditLogTable } from '../../routes/admin';

type C = Context<{ Bindings: Env }>;

export const READ_AUDIT_ACTIONS = ['mercury_connections_read', 'mercury_accounts_read', 'mercury_transactions_read', 'mercury_matches_read'] as const;
export type ReadAuditAction = typeof READ_AUDIT_ACTIONS[number];

async function supportSession(c: C): Promise<boolean> {
  return !!(await selectJwt(c))?.payload.impersonated_by;
}

const SUPPORT_REFUSED = { code: 'support_session_refused', detail: 'A support session cannot read or change Mercury connections.' };
const HQ_REFUSED = { code: 'hq_only', detail: HQ_ONLY };

/** Reads and reconciliation: an Admin on HQ, never a support session. */
export async function requireMercuryReader(c: C): Promise<User | Response> {
  await requireAuth(c);
  if (await supportSession(c)) return c.json(SUPPORT_REFUSED, 403);
  const user = await requireAdmin(c);
  if (branchOf(c.env)) return c.json(HQ_REFUSED, 403);
  return user;
}

/** Connect, replace and disconnect: the Super Admin, behind the write bar. */
export async function requireMercuryCredentialWriter(c: C): Promise<User | Response> {
  const user = await requireAuth(c);
  if (await supportSession(c)) return c.json(SUPPORT_REFUSED, 403);
  if (branchOf(c.env)) return c.json(HQ_REFUSED, 403);
  if (String(user.role || '').toLowerCase() !== 'admin') throw new Error('Admin required');
  if (!isSuperAdmin(user as any)) return c.json({ code: 'super_admin_required', detail: 'Super admin required' }, 403);
  return await requireSuperAdminWriteBar(c);
}

/**
 * Decision 7: the read's audit row, written before the read answers. The
 * table has no entity or count column, so `filters_json` carries the entity,
 * the filters and the row count. False when it could not be written, and the
 * route then answers 503 with no rows.
 */
export async function auditRead(env: Env, user: User, action: ReadAuditAction, filters: Record<string, unknown>): Promise<boolean> {
  try {
    await ensureAdminAuditLogTable(env);
    await env.DB.prepare(
      'INSERT INTO admin_audit_log (admin_user_id, action, filters_json) VALUES (?, ?, ?)',
    ).bind(user.id, action, JSON.stringify(filters)).run();
    return true;
  } catch (e) {
    console.warn('[mercury] read audit failed', action, (e as Error).message);
    return false;
  }
}

export const AUDIT_UNAVAILABLE = { code: 'audit_unavailable', detail: 'This read could not be recorded, so it was not made. Try again in a moment.' };
