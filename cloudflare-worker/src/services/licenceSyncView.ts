/**
 * #4686 — the read behind `GET /api/admin/licences/:uid`'s `sync`, and the
 * termination ledger's row type, shared by the lifecycle routes that write the
 * ledger and the detail route that reads it.
 */
import type { Env } from '../types';
import type { LicenceSyncSummary } from './licenceContracts';
import { licenceBranchReport } from './licenceBranchReport';

type StepState = 'pending' | 'done' | 'failed';
/** `licence_termination_ops`, one row per terminated licence. */
export type TerminationOps = {
  licence_id: number; status: string; actor_user_id: number | null; note: string;
  released_json: string | null; revision: number | null;
  notices_state: StepState; notify_state: StepState; admins_state: StepState;
  push_state: StepState; unbind_state: StepState;
  failure_step: string | null; failure_code: string | null; attempts: number;
  lease_until: string | null; created_at: string; updated_at: string; completed_at: string | null;
};

/**
 * #4686 — WHAT HQ HOLDS, WHAT THE BRANCH HAS ACKNOWLEDGED, AND WHAT IS OWED.
 *
 * `hq_revision` is the last revision HQ numbered for this licence;
 * `branch_revision` the last one a branch answered for; `last_success_at` when.
 * `pending` is the retry row (its revision and a short failure CODE, never the
 * raw error text); `termination` is the durable intent of a termination, with
 * one state per consequence. Each store is read on its own, so one that cannot
 * be read says so rather than blanking the rest, and a figure nobody recorded
 * is null — never 0.
 *
 * D5925 (#5925): `branch_revision` stays the branch's answer to HQ's last
 * push. `branch_report` is a separate read of what the branch says it holds
 * now, from the branch itself; a branch that cannot be read reports
 * `unreadable` there, never the last pushed revision.
 */
export async function syncSummary(env: Env, licenceId: number, licenceUid: string): Promise<LicenceSyncSummary> {
  const out: LicenceSyncSummary = {
    available: true, hq_revision: null, branch_revision: null, last_success_at: null,
    pending: null, pending_available: true, termination: null, termination_available: true,
    branch_report: await licenceBranchReport(env, licenceUid),
  };
  try {
    const row = await env.DB.prepare(
      'SELECT hq_revision, branch_revision, last_success_at FROM licence_sync_state WHERE licence_id = ?',
    ).bind(licenceId).first<{ hq_revision: number; branch_revision: number | null; last_success_at: string | null }>();
    if (row) {
      out.hq_revision = Number(row.hq_revision) > 0 ? Number(row.hq_revision) : null;
      out.branch_revision = row.branch_revision === null || row.branch_revision === undefined ? null : Number(row.branch_revision);
      out.last_success_at = row.last_success_at ?? null;
    }
  } catch (e) { console.warn('[licences] licence_sync_state unreadable', (e as Error).message); out.available = false; }
  try {
    const p = await env.DB.prepare(
      'SELECT revision, failure_code, attempts, last_attempt_at FROM licence_push_pending WHERE licence_id = ?',
    ).bind(licenceId).first<{ revision: number; failure_code: string | null; attempts: number; last_attempt_at: string }>();
    if (p) {
      out.pending = {
        revision: Number(p.revision) > 0 ? Number(p.revision) : null,
        failure_code: p.failure_code ?? null, attempts: Number(p.attempts) || 0, last_attempt_at: p.last_attempt_at,
      };
    }
  } catch (e) { console.warn('[licences] licence_push_pending unreadable', (e as Error).message); out.pending_available = false; }
  try {
    const t = await env.DB.prepare('SELECT * FROM licence_termination_ops WHERE licence_id = ?')
      .bind(licenceId).first<TerminationOps>();
    if (t) {
      out.termination = {
        status: t.status,
        steps: { notices: t.notices_state, notify: t.notify_state, admins: t.admins_state, push: t.push_state, unbind: t.unbind_state },
        failure_step: t.failure_step ?? null, failure_code: t.failure_code ?? null,
        attempts: Number(t.attempts) || 0, created_at: t.created_at, completed_at: t.completed_at ?? null,
      };
    }
  } catch (e) { console.warn('[licences] licence_termination_ops unreadable', (e as Error).message); out.termination_available = false; }
  return out;
}

