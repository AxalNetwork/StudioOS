/**
 * D4669 — what an HQ · Security emergency action reaches, stated per deployment.
 *
 * Every session act on `/admin/security` (revoke, sign an account out, end a
 * support session, sign everyone out) writes to THIS deployment's database.
 * A branch is its own Worker with its own D1, its own accounts and its own
 * sessions (D.2), and no branch RPC signs anyone out. So "everywhere" means
 * every account on this deployment, and the answer says so deployment by
 * deployment: this one with its outcome, each bound branch as `not_reached`.
 *
 * Whether HQ should coordinate a branch-wide action is the owner's call
 * (#4669); until it is made, nothing here pretends one happened.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { branchBindings } from './branches';

export const BRANCH_NOT_REACHED =
  'A branch is its own deployment, with its own accounts and sessions. This action does not reach it; '
  + 'its sessions are unchanged.';

export const BRANCHES_UNREADABLE =
  'Which branches are bound could not be read, so this answer cannot list them. None was reached by this action.';

export type DeploymentOutcome = {
  deployment: string;
  outcome: 'done' | 'failed' | 'not_reached' | 'unknown';
  affected?: number;
  reason?: string;
};

export type EmergencyScope = {
  /** The deployment the action ran on: `hq`, or the branch code. */
  deployment: string;
  reaches: 'this_deployment_only';
  /** Bound branch deployments, or null when the bindings could not be read. */
  branches_bound: number | null;
  summary: string;
};

function bound(env: Env): Array<{ code: string }> | null {
  try { return branchBindings(env).map((b) => ({ code: b.code })); } catch { return null; }
}

export function emergencyScope(env: Env): EmergencyScope {
  const here = branchOf(env) ?? 'hq';
  const branches = bound(env);
  const n = branches?.length ?? null;
  const name = here === 'hq' ? 'HQ' : `the ${here} branch`;
  const tail = n === null
    ? ' Which branches are bound could not be read; none is reached.'
    : n === 0
      ? ' No branch is bound here.'
      : ` ${n} bound branch${n === 1 ? ' is' : 'es are'} not reached: each keeps its own sessions.`;
  return {
    deployment: here,
    reaches: 'this_deployment_only',
    branches_bound: n,
    summary: `Acts on ${name}'s accounts and sessions only.${tail}`,
  };
}

/**
 * One row per deployment: this one with `here`, then every bound branch as
 * `not_reached`, or one `unknown` row when the bindings cannot be read.
 */
export function deploymentOutcomes(env: Env, here: Omit<DeploymentOutcome, 'deployment'>): DeploymentOutcome[] {
  const code = branchOf(env) ?? 'hq';
  const out: DeploymentOutcome[] = [{ deployment: code, ...here }];
  const branches = bound(env);
  if (branches === null) {
    out.push({ deployment: 'branches', outcome: 'unknown', reason: BRANCHES_UNREADABLE });
    return out;
  }
  for (const b of branches) out.push({ deployment: b.code, outcome: 'not_reached', reason: BRANCH_NOT_REACHED });
  return out;
}
