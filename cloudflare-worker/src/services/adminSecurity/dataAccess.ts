/**
 * D4708 (#4708) — canvas H7's "Data access" zone on `/governance`: who read data they do not own, as two halves
 * (support sessions and exports) so one unreadable store cannot make the other look complete. Moved from
 * `routes/admin_security.ts` unchanged.
 */
import type { Env } from '../../types';
import { IMPERSONATION_EXPIRY_MINUTES } from '../../auth';
import { supportSessionStatus, supportSessionLimitMinutes } from '../sessionStatus';
import { supportIdentity, userIdentity } from '../securityIdentity';
import { absent, type Absent } from './contract';
import {
  IMPERSONATION_UNREADABLE, parseSqlTs, who, clip, stamp, minutesBetween, type ImpersonationRow,
} from './feedFormat';

/** At most this many rows in each half of the zone. */
export const DATA_ACCESS_LIMIT = 12;

export type DataAccessHalf = { available: true; items: Array<Record<string, unknown>> } | Absent;

/**
 * The zone's two halves. `impersonations` is the feed's one unfiltered read of the newest sessions (null when
 * the table could not be read), so a filter on the ledger never makes this zone look as if nobody had acted
 * as anyone.
 */
export async function loadDataAccess(env: Env, impersonations: ImpersonationRow[] | null, now: number): Promise<{
  impersonations: DataAccessHalf;
  exports: DataAccessHalf;
}> {
  let accessImpersonations: { available: true; items: Array<Record<string, unknown>> } | Absent;
  if (impersonations === null) {
    accessImpersonations = absent(IMPERSONATION_UNREADABLE);
  } else {
    accessImpersonations = {
      available: true,
      items: impersonations.slice(0, DATA_ACCESS_LIMIT).map((i) => {
        const started = parseSqlTs(i.started_at as string);
        const ended = i.ended_at ? parseSqlTs(i.ended_at as string) : NaN;
        const status = supportSessionStatus(i, now);
        const live = status === 'live';
        const open = status !== 'ended';
        const elapsed = Number.isNaN(started) || (!open && Number.isNaN(ended))
          ? null
          : minutesBetween(started, open ? now : ended);
        // D4691 — the shared rule decides live and not-closed, as everywhere
        // else on the page. Past the first token's thirty minutes an HQ
        // session can still be live (it may have been extended, up to the
        // ceiling), so the time left is stated as an upper bound; only past
        // the session's limit is an open record "not closed" — the record was
        // never closed, NOT somebody still inside.
        let dur: string | null;
        if (status === 'not_closed') dur = 'not closed';
        else if (elapsed === null) dur = null;
        else if (!open) dur = `${elapsed}m`;
        else if (elapsed < IMPERSONATION_EXPIRY_MINUTES && Number(i.admin_user_id) !== 0) {
          dur = `${IMPERSONATION_EXPIRY_MINUTES - elapsed}m left`;
        } else dur = `at most ${Math.max(0, supportSessionLimitMinutes(i.admin_user_id) - elapsed)}m left`;
        return {
          kind: 'impersonation',
          status,
          actor: supportIdentity(
            { id: i.admin_user_id, name: i.admin_name, email: i.admin_email },
            { id: i.target_user_id, name: i.target_name, email: i.target_email },
          ),
          what: `Impersonation · ${who(i.target_name, i.target_email, i.target_user_id) || 'unknown account'}`,
          meta: [
            supportIdentity({ id: i.admin_user_id, name: i.admin_name, email: i.admin_email }, { id: i.target_user_id }).label,
            stamp(i.started_at),
            i.context ? clip(String(i.context), 120) : null,
          ].filter(Boolean).join(' · '),
          dur,
          live,
          overdue: status === 'not_closed',
        };
      }),
    };
  }

  let accessExports: { available: true; items: Array<Record<string, unknown>> } | Absent;
  try {
    const ex = await env.DB.prepare(
      `SELECT a.id, a.action, a.report_type, a.format, a.exported_at,
              u.name AS admin_name, u.email AS admin_email, a.admin_user_id
         FROM admin_audit_log a
         LEFT JOIN users u ON u.id = a.admin_user_id
        WHERE a.action LIKE '%export%'
        ORDER BY a.exported_at DESC, a.id DESC LIMIT ?`,
    ).bind(DATA_ACCESS_LIMIT).all<Record<string, unknown>>();
    accessExports = {
      available: true,
      items: (ex.results || []).map((e) => ({
        kind: 'export',
        actor: userIdentity(e.admin_user_id, e.admin_name, e.admin_email),
        what: `Export · ${e.report_type ? String(e.report_type) : String(e.action || 'report')}`,
        meta: [
          userIdentity(e.admin_user_id, e.admin_name, e.admin_email).label,
          e.format ? String(e.format) : null,
          stamp(e.exported_at),
        ].filter(Boolean).join(' · '),
        // An export is a moment, not a window. It has no duration, and
        // "complete" is the artboard's own word for that.
        dur: 'complete',
        live: false,
        overdue: false,
      })),
    };
  } catch {
    accessExports = absent('The export records could not be read.');
  }
  return {
    impersonations: accessImpersonations,
    exports: accessExports,
  };
}
