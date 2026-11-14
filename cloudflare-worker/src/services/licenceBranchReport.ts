/**
 * D5925 (#5925): what a licence's branch says it holds, read from the branch
 * itself, beside (never instead of) the answer it gave HQ's last push.
 *
 * `licence_sync_state.branch_revision` is the branch's ANSWER to a push: a
 * branch on an older build that answered `{ applied: true }` was recorded as
 * holding the revision HQ sent (D4686). This is a pull read of the branch's
 * own copy, through the branch's existing `health()` RPC (D5925 adds
 * `licence_revision` and `licence_copy_state` to it), over the same
 * `branchRead` the Platform scope reads use, so its states are theirs:
 *
 *   reported      the branch answered with the revision it holds (or none)
 *   older_build   the branch answered, but its build does not report a revision
 *   unreadable    the call failed or timed out
 *   not_deployed  HQ has no binding, or no deployment row, for this licence
 *
 * Anything but `reported` carries `revision: null` and a reason. The last
 * pushed revision is never put in its place.
 */
import type { Env } from '../types';
import type { BranchHealth } from '../rpc/branchOps';
import { branchRead } from './branches';

export type LicenceBranchReport = {
  state: 'reported' | 'older_build' | 'unreadable' | 'not_deployed';
  /** The HQ revision the branch's copy holds; null unless `reported` with a numbered copy. */
  revision: number | null;
  copy_state: 'complete' | 'partial' | null;
  /** When the branch wrote its copy (`branch_licence.pushed_at`), as the branch says. */
  applied_at: string | null;
  /** When the branch answered this read (its own `as_of`); null when it did not answer. */
  reported_at: string | null;
  reason: string | null;
};

const empty = (state: LicenceBranchReport['state'], reason: string): LicenceBranchReport =>
  ({ state, revision: null, copy_state: null, applied_at: null, reported_at: null, reason });

export const REPORT_REASONS = {
  no_deployment: 'No branch deployment is recorded for this licence, so there is no branch to read.',
  deployment_unreadable: 'The deployment registry could not be read, so the branch could not be found.',
  older_build: 'The branch answered, but its build does not report the revision it holds. Redeploy the branch to read it.',
  no_copy: 'The branch holds no numbered licence copy.',
} as const;

/** One read of one branch. Never throws: every failure is a state with a reason. */
export async function licenceBranchReport(env: Env, licenceUid: string): Promise<LicenceBranchReport> {
  let code: string | null = null;
  try {
    const row = await env.DB.prepare('SELECT code FROM licence_deployments WHERE licence_uid = ?')
      .bind(licenceUid).first<{ code: string | null }>();
    code = row?.code ?? null;
  } catch {
    return empty('unreadable', REPORT_REASONS.deployment_unreadable);
  }
  if (!code) return empty('not_deployed', REPORT_REASONS.no_deployment);
  const read = await branchRead<BranchHealth & { as_of?: string }>(env, code, 'health');
  if (read.status === 'not_deployed') return empty('not_deployed', read.reason || REPORT_REASONS.no_deployment);
  if (read.status !== 'ok' || !read.data || typeof read.data !== 'object') {
    return empty('unreadable', read.reason || 'The branch did not answer.');
  }
  const data = read.data;
  const reportedAt = typeof data.as_of === 'string' ? data.as_of : null;
  if (!('licence_revision' in data)) return { ...empty('older_build', REPORT_REASONS.older_build), reported_at: reportedAt };
  const revision = Number.isSafeInteger(data.licence_revision) && Number(data.licence_revision) > 0 ? Number(data.licence_revision) : null;
  const copyState = data.licence_copy_state === 'complete' || data.licence_copy_state === 'partial' ? data.licence_copy_state : null;
  return {
    state: 'reported', revision, copy_state: copyState,
    applied_at: typeof data.licence_pushed_at === 'string' ? data.licence_pushed_at : null,
    reported_at: reportedAt,
    reason: revision === null ? REPORT_REASONS.no_copy : null,
  };
}
