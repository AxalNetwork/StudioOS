/**
 * D6733 (#6733) — HQ re-sends a licence's copy to its branch on demand: the
 * Retry sync button on Licences › Operations (L15), drawn disabled by D5924.
 *
 *   POST /api/admin/licences/:uid/sync/retry
 *     200 { ok: true, pushed, sync }   the attempt ran; `pushed` is the branch's answer
 *                                      (accepted, or a failure code), `sync` the record after it
 *     404 not_found                    no such licence
 *     409 nothing_pending              no copy is owed (no `licence_push_pending` row): nothing was sent
 *     409 retry_in_flight              an attempt started under SYNC_RETRY_LEASE_SECONDS ago
 *     503 sync_unreadable              the queue of owed copies could not be read
 *
 * THE SAME PUSH AS THE CRON. It sends through `pushLicenceToBranch`, which reads
 * the licence fresh under a new revision and records the outcome on
 * `licence_push_pending` with `recordPushOutcome` (D272, #4686), exactly as
 * `retryPendingLicencePushes` does on its ten-minute tick. A copy that lands
 * deletes the row; one that fails bumps `attempts` and sets `last_attempt_at`
 * to this attempt, so the cron's 60-minute window counts from it.
 *
 * ONE MANUAL RETRY AT A TIME, BY REFUSAL. Before sending, one UPDATE stamps the
 * row's `last_attempt_at` with this attempt's time, only when the last attempt
 * is older than the lease. A second press inside the lease changes no row and
 * is refused with `retry_in_flight`, so two clicks never send two copies. The
 * stamp is the time the attempt records anyway, and it also keeps the cron off
 * the row while the push runs (the cron only takes rows an hour old).
 *
 * A FAILED PUSH IS A 200 (D111): the attempt ran and is recorded; the branch's
 * failure is a fact about the branch, carried on `pushed.failure_code`.
 *
 * Super Admin, like every licence ledger route (`admin_licences.ts`), and the
 * transition routes that push (`suspend`, `activate`, `PUT /:uid/seats`): the
 * plain gate, not the write bar, because a retry changes no term. Who pressed
 * it and when go through `logAdminAction` (`licence_sync_retried`, D159) into
 * `activity_logs` and `admin_audit_log`, as the domain, brand and fee licence
 * routes do. Not `licence_events`: its CHECK admits a fixed list of events
 * (migrations 266, 331) and a retry changes nothing on the licence.
 */
import { Hono } from 'hono';
import { requireSuperAdmin } from '../auth';
import { mapError, nowIso } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';
import { pushLicenceToBranch, type LicencePushResult } from '../services/licencePush';
import { byUid } from '../services/licenceLedgerCore';
import { logAdminAction } from '../services/adminAudit';
import { syncSummary } from '../services/licenceSyncView';
import type { LicenceSyncSummary, LicenceTransitionResult } from '../services/licenceContracts';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import adminLicences from './admin_licences';

/** How long one attempt holds the row against a second manual retry. */
export const SYNC_RETRY_LEASE_SECONDS = 120;

export type LicenceSyncRetryResult = { ok: true; status: LicenceTransitionResult['status']; pushed: LicencePushResult; sync: LicenceSyncSummary };

const r = new Hono<{ Bindings: Env }>();

r.post('/:uid/sync/retry', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const licence = await byUid(c.env, c.req.param('uid'));
    if (!licence) return refuse(c, 404, { code: 'not_found', message: 'No such licence.' });
    // Keep the ledger action's refusal: an unissued draft has no branch copy.
    if (licence.status === 'draft') return refuse(c, 409, { code: 'not_issued', message: 'A draft licence has no branch copy to sync yet.' });
    const at = nowIso();
    const leaseCutoff = new Date(Date.parse(at) - SYNC_RETRY_LEASE_SECONDS * 1000).toISOString();
    let claimed: { licence_id: number } | null;
    let owed: { last_attempt_at: string } | null = null;
    try {
      claimed = await c.env.DB.prepare(
        `UPDATE licence_push_pending SET last_attempt_at = ?
          WHERE licence_id = ? AND datetime(last_attempt_at) <= datetime(?)
          RETURNING licence_id`,
      ).bind(at, licence.id, leaseCutoff).first<{ licence_id: number }>();
      if (!claimed) {
        owed = await c.env.DB.prepare('SELECT last_attempt_at FROM licence_push_pending WHERE licence_id = ?')
          .bind(licence.id).first<{ last_attempt_at: string }>();
      }
    } catch (e) {
      return refuse(c, 503, {
        code: 'sync_unreadable', raw: e,
        message: 'HQ could not read whether a copy is owed to the branch, so nothing was sent. Try again.',
      });
    }
    if (!claimed && !owed) {
      return refuse(c, 409, {
        code: 'nothing_pending',
        message: 'No copy is owed to the branch, so nothing was sent.',
      });
    }
    if (!claimed) {
      return refuse(c, 409, {
        code: 'retry_in_flight',
        message: 'A sync attempt for this licence started less than two minutes ago. Read again to see how it ended.',
      });
    }
    const pushed = await pushLicenceToBranch(c.env, licence.id, at);
    await logAdminAction(c.env, admin.id, admin.email || '', 'licence_sync_retried', {
      licence_uid: licence.uid, licence_ref: licence.licence_ref, attempted_at: at,
      revision: pushed.revision ?? null, accepted: pushed.ok,
      failure_code: pushed.ok ? null : (pushed.failure_code ?? null),
    });
    return c.json({ ok: true, status: licence.status as LicenceTransitionResult['status'], pushed, sync: await syncSummary(c.env, licence.id, licence.uid) } satisfies LicenceSyncRetryResult);
  } catch (e) { return mapError(c, e); }
});

export const mount: RouteMount[] = [
  // Ahead of the licence ledger, whose `/:uid` catch-all would otherwise see this path first.
  { path: '/api/admin/licences', router: r, before: [adminLicences] },
];

export default r;
