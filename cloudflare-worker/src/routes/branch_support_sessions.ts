/**
 * S13's audit line (D446). What a branch can read about HQ support sessions
 * opened on its own database.
 *
 * THE TABLE IS NOT CREATED HERE. `impersonation_sessions` is bootstrapped by
 * the cohort schema and written when a support code is redeemed. Creating it
 * on this read would turn "the table could not be read" into an empty list,
 * and an empty list is what the page says when no session has been opened.
 * Those two answers are different, and this route keeps them different.
 *
 * WHAT A ROW IS. `redeemSupportCode` writes one row with `admin_user_id = 0`
 * and `context` of `hq_support:<name>|<reason>`. The sweep stamps `ended_at`
 * when the window has passed. A read made during the session is not a row in
 * this table, and HQ's Security copy is a different store. Neither is invented
 * here.
 *
 * GET /api/branch/support-sessions
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { requireBranchTier } from '../util/branch';
import { mapError } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

const PREFIX = 'hq_support:';
const LIST_CAP = 100;

export const SUPPORT_AUDIT_UNREADABLE =
  'The impersonation_sessions table could not be read on this database. That is not a claim that no support session has been opened.';

export const SUPPORT_READS_UNRECORDED =
  'A read made during a support session is not a row in this table. The line is the session opening and, once the sweep has stamped it, the end.';

export const SUPPORT_MIRROR_UNRECORDED =
  'HQ\'s Security reads its own copy of these sessions. This page reads this database only.';

/**
 * The actor and the reason, taken off the context `redeemSupportCode` writes.
 * A row that does not carry them returns nulls. The page says those are not
 * recorded. It does not invent a name.
 */
export function supportSessionFields(context: unknown): { actor_name: string | null; reason: string | null } {
  const raw = typeof context === 'string' ? context : '';
  if (!raw.startsWith(PREFIX)) return { actor_name: null, reason: null };
  const rest = raw.slice(PREFIX.length);
  const bar = rest.indexOf('|');
  const actor = (bar < 0 ? rest : rest.slice(0, bar)).trim();
  const reason = bar < 0 ? '' : rest.slice(bar + 1).trim();
  return {
    actor_name: actor || null,
    reason: reason || null,
  };
}

r.get('/support-sessions', async (c) => {
  try {
    await requireAdmin(c);
    requireBranchTier(c.env);
    let rows: Array<Record<string, unknown>> = [];
    try {
      const q = await c.env.DB.prepare(
        `SELECT i.id, i.started_at, i.ended_at, i.context,
                t.name AS target_name, t.email AS target_email, t.role AS target_role
           FROM impersonation_sessions i
           LEFT JOIN users t ON t.id = i.target_user_id
          WHERE i.admin_user_id = 0
            AND i.context LIKE 'hq_support:%'
          ORDER BY i.started_at DESC
          LIMIT 101`,
      ).all<Record<string, unknown>>();
      rows = q.results || [];
    } catch (e) {
      console.error('[branch-support-sessions] could not read impersonation_sessions', (e as Error).message);
      return c.json({
        available: false,
        reason: SUPPORT_AUDIT_UNREADABLE,
      });
    }
    const truncated = rows.length > LIST_CAP;
    const items = rows.slice(0, LIST_CAP).map((row) => {
      const fields = supportSessionFields(row.context);
      return {
        id: row.id,
        started_at: row.started_at ?? null,
        ended_at: row.ended_at ?? null,
        actor_name: fields.actor_name,
        reason: fields.reason,
        target_name: row.target_name ?? null,
        target_email: row.target_email ?? null,
        target_role: row.target_role ?? null,
      };
    });
    return c.json({
      available: true,
      items,
      truncated,
      reads_unrecorded_reason: SUPPORT_READS_UNRECORDED,
      mirror_unrecorded_reason: SUPPORT_MIRROR_UNRECORDED,
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
