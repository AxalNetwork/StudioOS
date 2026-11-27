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
 * D4669 part 2 (the owner's option B, 2026-11-10): HQ MAY reach a branch, on
 * request, through a separate act (`signOutOnBranches` below) that asks each
 * named branch to sign accounts out and reports each branch's own outcome.
 * The ordinary acts are unchanged: they still write this deployment only and
 * still list every bound branch as `not_reached`, because reaching a branch is
 * something the operator asks for, not a side effect.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { branchBindings, branchByCode } from './branches';
import { withDeadline, DeadlineExceeded } from '../util/deadline';

export const BRANCH_NOT_REACHED =
  'A branch is its own deployment, with its own accounts and sessions. This action does not reach it; '
  + 'its sessions are unchanged.';

export const BRANCHES_UNREADABLE =
  'Which branches are bound could not be read, so this answer cannot list them. None was reached by this action.';

export type DeploymentOutcome = {
  deployment: string;
  /**
   * `done`: the deployment answered that it acted. `failed`: it answered with
   * a refusal, so nothing changed there. `unreachable` (part 2): it was asked
   * and did not answer, so whether it acted is NOT KNOWN — never counted as
   * done. `not_reached`: it was not asked. `unknown`: which deployments exist
   * could not be read.
   */
  outcome: 'done' | 'failed' | 'unreachable' | 'not_reached' | 'unknown';
  affected?: number;
  reason?: string;
  /** Part 2: the branch had this act on record already; its answer is that record. */
  replayed?: boolean;
  /** Part 2: the branch did not answer before HQ stopped waiting. */
  timed_out?: boolean;
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

// ─────────────────────────────────────────────────── D4669 part 2: branches

/**
 * How long HQ waits on each branch for a sign-out. Longer than a read's two
 * seconds (`BRANCH_DEADLINE_MS`): a write that is still running when HQ stops
 * waiting is reported as `unreachable` — not known — and a deadline tuned for
 * reads would turn healthy branches into that answer mid-incident. Calls run
 * concurrently, so this is the ceiling for the whole fan-out.
 */
export const BRANCH_WRITE_DEADLINE_MS = 10_000;

export type BranchSignOutTarget =
  | { kind: 'all' }
  | { kind: 'account'; email?: string; user_id?: number };

export type BranchSignOutResult = {
  /** `done`: every branch asked answered done. `failed`: none did. `partial`: some did. */
  outcome: 'done' | 'partial' | 'failed';
  outcomes: DeploymentOutcome[];
};

export const UNREACHABLE_TIMED_OUT = (seconds: number) =>
  `Did not answer within ${seconds}s. It may or may not have signed anyone out; trying the same request again is safe, `
  + 'because the branch recognises it.';
export const UNREACHABLE_CALL_FAILED =
  'Could not be reached. Whether it signed anyone out is not known; trying the same request again is safe, '
  + 'because the branch recognises it.';
export const NOT_BOUND = (code: string) =>
  `No branch Worker is bound for ${code} here, so it was not asked. Nothing changed there.`;

/**
 * A branch's thrown error, read the way the branch writes it: every refusal
 * `emergencySignOut` makes is thrown before its batch, prefixed `rpc:`, so an
 * `rpc:` error is a certain "nothing changed". Anything else — a binding that
 * failed, a network error, an exception the branch did not raise on purpose —
 * says nothing about whether the write landed.
 */
export function classifyBranchError(code: string, e: unknown): DeploymentOutcome {
  if (e instanceof DeadlineExceeded) {
    return { deployment: code, outcome: 'unreachable', timed_out: true, reason: UNREACHABLE_TIMED_OUT(Math.round(BRANCH_WRITE_DEADLINE_MS / 1000)) };
  }
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (msg.startsWith('rpc:')) {
    return { deployment: code, outcome: 'failed', reason: `${msg.slice(4).trim()} Nothing changed there.` };
  }
  return { deployment: code, outcome: 'unreachable', reason: UNREACHABLE_CALL_FAILED };
}

/** The whole act's outcome from its rows: `done` only when every branch asked said done. */
export function overallOutcome(rows: DeploymentOutcome[]): BranchSignOutResult['outcome'] {
  const done = rows.filter((r) => r.outcome === 'done').length;
  if (rows.length > 0 && done === rows.length) return 'done';
  return done === 0 ? 'failed' : 'partial';
}

/**
 * Ask each named branch to sign accounts out, concurrently, under one
 * deadline, and say per branch what happened. Never throws for a branch: each
 * branch's answer, refusal or silence is its own row.
 */
export async function signOutOnBranches(
  env: Env,
  codes: string[],
  req: { secret: string; hq_actor_name: string; reason: string; op_key: string; target: BranchSignOutTarget },
): Promise<BranchSignOutResult> {
  const rows = await Promise.all(codes.map(async (code): Promise<DeploymentOutcome> => {
    const binding = branchByCode(env, code);
    if (!binding) return { deployment: code, outcome: 'unreachable', reason: NOT_BOUND(code) };
    try {
      const res: any = await withDeadline(
        (binding.stub as any).emergencySignOut(req.secret, {
          hq_actor_name: req.hq_actor_name, reason: req.reason, op_key: req.op_key, target: req.target,
        }),
        BRANCH_WRITE_DEADLINE_MS,
        `branch ${binding.code} emergencySignOut`,
      );
      const affected = Number(res?.affected);
      return {
        deployment: binding.code,
        outcome: 'done',
        affected: Number.isFinite(affected) ? affected : 0,
        ...(res?.replayed ? { replayed: true } : {}),
        ...(res?.note === 'no_account' ? { reason: 'No account holds that email on this branch, so there was no one to sign out.' } : {}),
      };
    } catch (e) {
      return classifyBranchError(binding.code, e);
    }
  }));
  return { outcome: overallOutcome(rows), outcomes: rows };
}
