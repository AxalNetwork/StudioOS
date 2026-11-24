/** D7887: bounded CI pool routing, immutable execution receipts, and full-set result authority. */
export const CI_CAPACITY_VERSION = 1 as const;
/** D7907: github-8 is GitHub-hosted included compute (group 6), a third pool beside hosted and the self-hosted machines. */
export type CiProfile = 'hosted' | 'github-8' | 'linux-x64' | 'macos-arm64';
export type SelfHostedProfile = 'linux-x64' | 'macos-arm64';
export type CiEvent = 'push' | 'merge_group';
export const CI_CAPACITY_BUDGETS = Object.freeze({
  externalStartMs: 90_000,
  externalExecutionMs: 25 * 60_000,
  cancellationMs: 2 * 60_000,
  hostedStartMs: 10 * 60_000,
  hostedExecutionMs: 40 * 60_000,
  // D7907: provisional until the bounded canary measures a full shard there; equal to EXECUTION_BUDGETS['github-8'].
  includedStartMs: 3 * 60_000,
  includedExecutionMs: 28 * 60_000,
  controlMarginMs: 5 * 60_000,
  queueMs: 90 * 60_000,
  inventoryMaxAgeMs: 30_000,
  reconcileMs: 15_000,
});
/** D8009: existing #7972 hosted job limit; never issue a longer lease even for immediate pickup. */
export const HOSTED_JOB_CEILING_MS = 45 * 60_000;
/** D7909: leave the existing 26-minute Linux Run step a bounded 20-second delivery allowance. */
export const EXTERNAL_RUN_CEILING_MS = 26 * 60_000;
export const RESULT_DELIVERY_RESERVE_MS = 20_000;
export type CapacityBudgets = { [K in keyof typeof CI_CAPACITY_BUDGETS]: number };
export type CapacityPolicy = {
  version: typeof CI_CAPACITY_VERSION;
  maxExternalWorkerShards: number;
  /** D7907: at most this many Worker shards in flight on github-8 at once, across all requests. 0 disables the pool. */
  maxIncludedWorkerShards: number;
  minimumHostedWorkerShards: number;
  approvedGroupId: number;
  /** Pilot narrows the existing eight-request authority bound without increasing it. */
  maxActiveRequests?: number;
  budgets: CapacityBudgets;
};
export type CiSubmission = {
  version: typeof CI_CAPACITY_VERSION;
  requestId: string;
  repository: string;
  parentRunId: number;
  parentAttempt: number;
  parentWorkflowId: number;
  sourceSha: string;
  queueBaseSha: string | null;
  event: CiEvent;
  executorSha: string;
  /** Approved main workflow revision, separate from pinned control code. Legacy receipts bind to executorSha. */
  childWorkflowSha?: string;
  planDigest: string;
  planArtifactId: number | null;
  shards: string[];
  prerequisites: string[];
};
export type CiProvenance = {
  repository: string;
  parentRunId: number;
  parentAttempt: number;
  parentWorkflowId: number;
  sourceSha: string;
  queueBaseSha: string | null;
  event: CiEvent;
  executorSha: string;
  /** Approved main workflow revision, separate from pinned control code. Legacy receipts bind to executorSha. */
  childWorkflowSha?: string;
  planDigest: string;
  planArtifactId: number | null;
  shards: string[];
  prerequisites: string[];
  parentLive: boolean;
  trustedSource: boolean;
  executorOnMain: boolean;
};
export type InventoryRunner = {
  id: number;
  profile: SelfHostedProfile;
  groupId: number;
  online: boolean;
  busy: boolean;
  draining: boolean;
};
export type CapacityInventory = { observedAt: number; complete: boolean; runners: InventoryRunner[] };
export type ExecutionReceipt = {
  version: typeof CI_CAPACITY_VERSION;
  requestId: string;
  repository: string;
  logicalShard: string;
  event: CiEvent;
  parentWorkflowId: number;
  parentRunId: number;
  parentAttempt: number;
  sourceSha: string;
  queueBaseSha: string | null;
  planDigest: string;
  planArtifactId: number | null;
  executorSha: string;
  /** Approved main workflow revision, separate from pinned control code. Legacy receipts bind to executorSha. */
  childWorkflowSha?: string;
  profile: CiProfile;
  generation: number;
  childRunId: number;
  childAttempt: 1;
  startDeadline: number;
  executionDeadline: number;
};
export type AttemptPhase = 'reserved' | 'dispatching' | 'queued' | 'running' | 'cancelling'
  | 'dispatch_unknown' | 'cancellation_unknown' | 'passed' | 'failed' | 'cancelled';
export type CiAttempt = Omit<ExecutionReceipt, 'childRunId'> & {
  childRunId: number | null;
  phase: AttemptPhase;
  cancelDeadline: number | null;
  reason: string | null;
  /** Negative test truth survives cancellation/cleanup; cleanup-unknown attempts retain their reservation. */
  verifiedTestFailure?: boolean;
  /** Owned dispatch at an unreviewed moving-main revision: cancellation only, never admission. */
  rejectedWorkflowSha?: string;
};
/** A trusted adapter proved that no dispatch request was sent. Other errors remain ambiguous. */
export class CapacityDispatchRefused extends Error {}
export type LogicalShard = { name: string; generation: number; attempts: CiAttempt[] };
export type PrerequisiteResult = { name: string; conclusion: 'success' | 'failure' | 'pending' };
export type CapacityRequest = {
  submission: CiSubmission;
  acceptedAt: number;
  completedAt: number | null;
  deadline: number;
  parentLive: boolean;
  trustedSource: boolean;
  superseded: boolean;
  evidenceConflict: boolean;
  shards: LogicalShard[];
  prerequisites: PrerequisiteResult[];
};
export type ChildObservation = {
  receipt: ExecutionReceipt;
  workflowPath: string;
  workflowAttempt: number;
  jobId: number;
  runnerProfile: CiProfile;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'timed_out' | null;
  testStep: 'success' | 'failure' | 'not_run' | 'unknown';
  jobConclusion: 'success' | 'failure' | 'cancelled' | 'timed_out' | null;
  startedAt: number | null;
  /** Trusted provider/authority observations, never caller-supplied result JSON. */
  completedAt?: number | null;
  cleanupConfirmed?: boolean;
  exportComplete?: boolean;
  executionOutcome?: 'completed' | 'setup_failure' | 'timed_out' | 'cleanup_failure' | 'export_failure' | 'unknown';
};
export type Aggregate = { status: 'pending' | 'success' | 'failure' | 'cancelled'; reason: string };

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHARD = /^worker-[1-6]-of-6$/;
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

export function validateCapacityPolicy(policy: CapacityPolicy): void {
  const b = policy.budgets;
  if (policy.version !== CI_CAPACITY_VERSION || !positive(policy.approvedGroupId)
      || !Number.isSafeInteger(policy.maxExternalWorkerShards) || policy.maxExternalWorkerShards < 0
      || policy.maxExternalWorkerShards > 2 || !positive(policy.minimumHostedWorkerShards)
      || !Number.isSafeInteger(policy.maxIncludedWorkerShards) || policy.maxIncludedWorkerShards < 0
      || policy.maxIncludedWorkerShards > 1
      || (policy.maxActiveRequests !== undefined && (!positive(policy.maxActiveRequests) || policy.maxActiveRequests > 8))) {
    throw new Error('capacity_policy_refused');
  }
  if (Object.keys(b).length !== Object.keys(CI_CAPACITY_BUDGETS).length
      || Object.keys(CI_CAPACITY_BUDGETS).some(key => !positive(b[key as keyof CapacityBudgets])) || b.queueMs > CI_CAPACITY_BUDGETS.queueMs
      || b.hostedStartMs >= HOSTED_JOB_CEILING_MS
      || b.externalStartMs + b.externalExecutionMs + b.cancellationMs + b.hostedStartMs
        + b.hostedExecutionMs + b.controlMarginMs > b.queueMs
      // A fenced included attempt must still leave a full hosted fallback inside the request deadline.
      || b.includedStartMs + b.includedExecutionMs + b.cancellationMs + b.hostedStartMs
        + b.hostedExecutionMs + b.controlMarginMs > b.queueMs) throw new Error('capacity_budget_refused');
}

export function submissionMatches(input: CiSubmission, proof: CiProvenance, repository: string): boolean {
  if (!input || input.version !== 1 || !UUID.test(input.requestId) || input.repository !== repository
      || !positive(input.parentRunId) || !positive(input.parentAttempt) || !positive(input.parentWorkflowId)
      || (input.event === 'merge_group' ? !SHA.test(input.queueBaseSha ?? '') : input.queueBaseSha !== null)
      || !SHA.test(input.sourceSha) || !SHA.test(input.executorSha) || (input.childWorkflowSha !== undefined && !SHA.test(input.childWorkflowSha)) || !DIGEST.test(input.planDigest)
      || !['push', 'merge_group'].includes(input.event)
      || (input.event === 'merge_group' ? input.planArtifactId !== null : !positive(input.planArtifactId ?? 0))
      || !Array.isArray(input.shards) || !input.shards.length || input.shards.length > 6
      || input.shards.some(s => !SHARD.test(s)) || new Set(input.shards).size !== input.shards.length
      || !Array.isArray(input.prerequisites) || !input.prerequisites.length || input.prerequisites.length > 16
      || input.prerequisites.some(s => typeof s !== 'string' || !s || s.length > 120)
      || new Set(input.prerequisites).size !== input.prerequisites.length) return false;
  return proof.repository === input.repository && proof.parentRunId === input.parentRunId
    && proof.parentAttempt === input.parentAttempt && proof.parentWorkflowId === input.parentWorkflowId
    && proof.queueBaseSha === input.queueBaseSha && proof.sourceSha === input.sourceSha && proof.event === input.event && proof.executorSha === input.executorSha && (proof.childWorkflowSha ?? proof.executorSha) === (input.childWorkflowSha ?? input.executorSha)
    && proof.executorOnMain && proof.planDigest === input.planDigest && proof.planArtifactId === input.planArtifactId
    && sameSet(proof.shards, input.shards) && sameSet(proof.prerequisites, input.prerequisites) && proof.parentLive;
}

/** Every profile still dispatches into a shared pool. Runner IDs are inventory identity, never dispatch targets.
 * `reservations` counts each profile's unfinished attempts; for github-8 that includes running ones, because
 * included compute has no readable inventory (D7907) and its cap is the only bound on concurrent use.
 */
export function selectPools(
  input: CiSubmission, trusted: boolean, inventory: CapacityInventory | null,
  reservations: Readonly<Record<string, number>>, policy: CapacityPolicy, now: number,
): { shard: string; profile: CiProfile }[] {
  validateCapacityPolicy(policy);
  const assignments = input.shards.map(shard => ({ shard, profile: 'hosted' as CiProfile }));
  if (!trusted || !['push', 'merge_group'].includes(input.event)) return assignments;
  // A missing, stale or malformed inventory closes only the self-hosted pools.
  const selfHosted = !!inventory?.complete
    && Number.isSafeInteger(inventory.observedAt) && now >= inventory.observedAt
    && now - inventory.observedAt <= policy.budgets.inventoryMaxAgeMs
    && Array.isArray(inventory.runners) && inventory.runners.length <= 1000
    && new Set(inventory.runners.map(r => r.id)).size === inventory.runners.length
    && !inventory.runners.some(r => !positive(r.id) || r.groupId !== policy.approvedGroupId
      || !['linux-x64', 'macos-arm64'].includes(r.profile)
      || typeof r.online !== 'boolean' || typeof r.busy !== 'boolean' || typeof r.draining !== 'boolean');
  const available = (profile: SelfHostedProfile) => !selfHosted ? 0 : Math.max(0, inventory!.runners.filter(r =>
    r.profile === profile && r.online && !r.busy && !r.draining).length - (reservations[profile] ?? 0));
  const free: Record<Exclude<CiProfile, 'hosted'>, number> = {
    'macos-arm64': available('macos-arm64'), 'linux-x64': available('linux-x64'),
    'github-8': Math.max(0, policy.maxIncludedWorkerShards - (reservations['github-8'] ?? 0)),
  };
  const workers = assignments.filter(a => a.shard.startsWith('worker-')).sort((a, b) => a.shard.localeCompare(b.shard));
  // Standard hosted stays the floor: every delegated pool together leaves minimumHostedWorkerShards on hosted.
  const total = Math.max(0, workers.length - policy.minimumHostedWorkerShards);
  let external = 0;
  let delegated = 0;
  for (const assignment of workers) {
    if (delegated >= total) break;
    const externalOk = external < policy.maxExternalWorkerShards;
    // The Mac's approved compatibility starts with the one benchmarked shard. Ephemeral included
    // compute comes before the persistent Linux host, which needs #7905's isolation proof.
    const profile = externalOk && assignment.shard === 'worker-1-of-6' && free['macos-arm64'] > 0 ? 'macos-arm64'
      : free['github-8'] > 0 ? 'github-8'
      : externalOk && free['linux-x64'] > 0 ? 'linux-x64' : null;
    if (!profile) continue;
    assignment.profile = profile; free[profile]--; delegated++;
    if (profile !== 'github-8') external++;
  }
  return assignments;
}

export function receiptMatches(a: ExecutionReceipt, b: ExecutionReceipt): boolean {
  return a.version === 1 && b.version === 1 && a.requestId === b.requestId && a.repository === b.repository
    && a.event === b.event && a.parentWorkflowId === b.parentWorkflowId && a.logicalShard === b.logicalShard && a.parentRunId === b.parentRunId && a.parentAttempt === b.parentAttempt
    && a.queueBaseSha === b.queueBaseSha && a.sourceSha === b.sourceSha && a.planDigest === b.planDigest && a.planArtifactId === b.planArtifactId && a.executorSha === b.executorSha && (a.childWorkflowSha ?? a.executorSha) === (b.childWorkflowSha ?? b.executorSha)
    && a.childAttempt === b.childAttempt && a.profile === b.profile && a.generation === b.generation && a.childRunId === b.childRunId
    && a.startDeadline === b.startDeadline && a.executionDeadline === b.executionDeadline;
}

export function activeAttempt(shard: LogicalShard): CiAttempt {
  const attempt = shard.attempts.find(a => a.generation === shard.generation);
  if (!attempt) throw new Error('missing_current_attempt');
  return attempt;
}

export function admitReceipt(request: CapacityRequest, offered: ExecutionReceipt, now: number): boolean {
  const shard = request.shards.find(s => s.name === offered.logicalShard);
  if (!shard || request.superseded || !request.parentLive || request.evidenceConflict || request.shards.some(s => s.attempts.some(a => a.phase === 'failed' || a.verifiedTestFailure === true))
      || request.prerequisites.some(p => p.conclusion === 'failure') || now >= request.deadline) return false;
  const attempt = activeAttempt(shard);
  if (attempt.childRunId === null || !['queued', 'running'].includes(attempt.phase)) return false;
  if (!receiptMatches(attempt as ExecutionReceipt, offered)) return false;
  return now < (attempt.phase === 'queued' ? attempt.startDeadline : attempt.executionDeadline);
}

export function validChildObservation(attempt: CiAttempt, observation: ChildObservation): boolean {
  return attempt.childRunId !== null && receiptMatches(attempt as ExecutionReceipt, observation.receipt)
    && observation.workflowPath === '.github/workflows/runner-executor.yml' && observation.workflowAttempt === 1
    && positive(observation.jobId) && observation.runnerProfile === attempt.profile;
}

/** All verified test failures are sticky, including a contradictory late report from an older owned attempt. */
export function applyObservation(request: CapacityRequest, observation: ChildObservation, now: number): boolean {
  const shard = request.shards.find(s => s.name === observation.receipt.logicalShard);
  const attempt = shard?.attempts.find(a => a.generation === observation.receipt.generation);
  if (!shard || !attempt || !validChildObservation(attempt, observation)) return false;
  if(attempt.rejectedWorkflowSha&&(observation.status!=='completed'||observation.conclusion!=='cancelled'
    ||observation.testStep!=='not_run'||observation.cleanupConfirmed!==true))return false;
  const alreadyEnded = ['passed', 'failed', 'cancelled'].includes(attempt.phase);
  const ended = alreadyEnded || (observation.status === 'completed' && observation.cleanupConfirmed === true);
  if (observation.testStep === 'failure') {
    if (attempt.generation !== shard.generation || attempt.phase === 'passed') request.evidenceConflict = true;
    attempt.verifiedTestFailure = true;
    attempt.phase = ended ? 'failed' : 'cancellation_unknown';
    attempt.reason = ended ? 'test_failed' : 'test_failed_cleanup_unverified'; return true;
  }
  if (attempt.verifiedTestFailure) {
    attempt.phase = ended ? 'failed' : 'cancellation_unknown';
    attempt.reason = ended ? 'test_failed' : 'test_failed_cleanup_unverified'; return true;
  }
  if (attempt.generation !== shard.generation || ['passed', 'failed', 'cancelled'].includes(attempt.phase)) return false;
  if (observation.status === 'completed') {
    const finish = observation.completedAt;
    const finishedInLease = Number.isSafeInteger(finish) && finish! >= request.acceptedAt
      && observation.startedAt !== null && finish! >= observation.startedAt
      && finish! < attempt.executionDeadline && finish! <= now;
    if (observation.conclusion === 'success' && (!finishedInLease
        || observation.startedAt === null || !Number.isSafeInteger(observation.startedAt)
        || observation.startedAt < request.acceptedAt || observation.startedAt > attempt.startDeadline)) {
      attempt.phase = 'cancellation_unknown'; attempt.reason = 'late_completion_unverified'; return true;
    }
    if (observation.cleanupConfirmed !== true) {
      attempt.phase = 'cancellation_unknown'; attempt.reason = 'cleanup_or_termination_unverified'; return true;
    }
    if (observation.conclusion === 'success' && observation.jobConclusion === 'success' && observation.testStep === 'success'
        && observation.exportComplete !== false && (observation.executionOutcome === undefined || observation.executionOutcome === 'completed')) {
      if (attempt.phase === 'cancelling' || attempt.phase === 'cancellation_unknown') {
        attempt.phase = 'cancelled'; attempt.reason = 'completed_after_fence';
      } else { attempt.phase = 'passed'; attempt.reason = null; }
    } else if (observation.conclusion === 'cancelled' || observation.conclusion === 'timed_out') {
      // Unknown test truth is insufficient to replace this execution with a fresh attempt.
      if (observation.testStep === 'unknown') { attempt.phase = 'cancellation_unknown'; attempt.reason = 'test_outcome_unknown'; }
      else { attempt.phase = 'cancelled'; attempt.reason = 'infrastructure_ended'; }
    } else if (observation.testStep === 'unknown') {
      attempt.phase = 'cancellation_unknown'; attempt.reason = 'test_outcome_unknown';
    } else if (observation.conclusion === 'failure' && observation.testStep === 'not_run') {
      attempt.phase = attempt.profile === 'hosted' ? 'failed' : 'cancelled'; attempt.reason = 'infrastructure_failed';
    } else { attempt.phase = 'cancellation_unknown'; attempt.reason = 'execution_outcome_unverified'; }
    return true;
  }
  if (observation.status === 'in_progress' && attempt.phase === 'queued') {
    if (observation.startedAt === null || !Number.isSafeInteger(observation.startedAt)
        || observation.startedAt > attempt.startDeadline) return false;
    attempt.phase = 'running';
    // The submitted deadline is an upper bound. Startup cannot extend a lease indefinitely.
    return true;
  }
  return false;
}

export function aggregateCapacity(request: CapacityRequest, now: number): Aggregate {
  if (request.evidenceConflict || request.shards.some(s => s.attempts.some(a => a.phase === 'failed' || a.verifiedTestFailure === true))
      || request.prerequisites.some(p => p.conclusion === 'failure')) return { status: 'failure', reason: 'verified_failure' };
  if (request.superseded || !request.parentLive) return { status: 'cancelled', reason: 'parent_inactive' };
  if (now >= request.deadline && (request.completedAt === null || request.completedAt >= request.deadline)) {
    return { status: 'failure', reason: 'deadline_exceeded' };
  }
  if (request.shards.length !== request.submission.shards.length
      || request.submission.shards.some(name => request.shards.filter(s => s.name === name).length !== 1)) {
    return { status: 'failure', reason: 'expected_set_mismatch' };
  }
  const ready = request.shards.every(s => activeAttempt(s).phase === 'passed')
    && request.submission.prerequisites.every(name => request.prerequisites.some(p => p.name === name && p.conclusion === 'success'));
  return ready ? { status: 'success', reason: 'entire_expected_set_verified' } : { status: 'pending', reason: 'awaiting_verified_results' };
}
