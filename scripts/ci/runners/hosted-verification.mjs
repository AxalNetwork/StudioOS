/** D8007 (#8007): inactive hosted isolation-verification port; trusted readers only, never execution or dispatch authority. */
const REPOSITORY = 'AxalNetwork/StudioOS';
const WORKFLOW = '.github/workflows/runner-executor.yml';
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const positive = n => Number.isSafeInteger(n) && n > 0;
const FIELDS = Object.freeze(['version', 'requestId', 'repository', 'logicalShard', 'event', 'parentWorkflowId',
  'parentRunId', 'parentAttempt', 'sourceSha', 'queueBaseSha', 'planDigest', 'planArtifactId', 'executorSha',
  'profile', 'generation', 'childRunId', 'childAttempt', 'startDeadline', 'executionDeadline']);
const sameBinding = (a, b) => !!a && FIELDS.every(key => Object.hasOwn(a, key) && a[key] === b[key]);
const need = (condition, reason) => { if (!condition) throw new Refused(reason); };
class Refused extends Error {}
export const HOSTED_EVIDENCE_MAX_AGE_MS = 30_000;

/**
 * Only trusted composition may supply these readers. readProvenance authenticates GitHub's JWT (issuer,
 * audience, signature and lifetime) and independently reads the exact job/run. This adapter does not decode
 * unauthenticated JWTs or obtain OIDC/App tokens. readBoundary inspects an actual credential-denying
 * boundary BEFORE dependency scripts and again before tests; VM disposal between jobs is insufficient.
 * readIncludedEligibility is authority-owned provider/budget evidence, never the request's profile name.
 * Each returned document has `binding` equal to the complete receipt, and integer `observedAt`.
 * There is deliberately no default positive reader. A trusted reader must reject unverifiable facts;
 * setting a flag or passing a fixture object from candidate code does not implement that reader.
 */
export function createHostedVerification({ readProvenance, readBoundary, readIncludedEligibility, now = Date.now } = {}) {
  const inspect = async ({ receipt, context, profile, phase, signal: callerSignal } = {}) => {
    const timeout = AbortSignal.timeout(10_000);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    const stopReason = () => callerSignal?.aborted ? 'hosted_verification_cancelled' : 'hosted_verification_timeout';
    try {
      ({ receipt, context, profile } = structuredClone({ receipt, context, profile }));
      const documents = [];
      let includedValidUntil = null;
      need(!signal.aborted, stopReason());
      need(['start', 'execute'].includes(phase), 'hosted_phase_invalid');
      need(['hosted', 'github-8'].includes(profile?.id) && receipt?.profile === profile.id, 'hosted_profile_refused');
      need(receipt.version === 1 && receipt.repository === REPOSITORY && context?.repository === REPOSITORY
        && SHA.test(receipt.sourceSha ?? '') && SHA.test(receipt.executorSha ?? '')
        && DIGEST.test(receipt.planDigest ?? '') && /^[A-Za-z0-9-]{8,100}$/.test(receipt.requestId ?? '')
        && /^worker-[1-6]-of-6$/.test(receipt.logicalShard ?? '')
        && ['parentRunId', 'parentAttempt', 'parentWorkflowId', 'generation', 'childRunId'].every(key => positive(receipt[key]))
        && receipt.childAttempt === 1 && String(context.childAttempt) === '1'
        && String(context.childRunId) === String(receipt.childRunId) && context.executorSha === receipt.executorSha
        && (receipt.event === 'push' ? receipt.queueBaseSha === null && positive(receipt.planArtifactId)
          : receipt.event === 'merge_group' && SHA.test(receipt.queueBaseSha ?? '') && receipt.planArtifactId === null),
      'hosted_binding_invalid');
      need(profile.platform === 'linux' && profile.arch === 'x64'
        && profile.eligibleShards?.includes(receipt.logicalShard), 'hosted_runtime_profile_refused');
      const validTime = () => {
        const time = now();
        need(Number.isSafeInteger(time) && Number.isSafeInteger(receipt.startDeadline)
          && Number.isSafeInteger(receipt.executionDeadline) && time < receipt.executionDeadline
          && receipt.startDeadline < receipt.executionDeadline
          && (phase !== 'start' || time <= receipt.startDeadline), 'hosted_lease_expired');
        return time;
      };
      validTime();
      const read = async (reader, reason) => {
        need(typeof reader === 'function', reason);
        let onAbort;
        let result;
        try {
          const stopped = new Promise((_, reject) => {
            onAbort = () => reject(new Refused(stopReason()));
            signal.addEventListener('abort', onAbort, { once: true });
          });
          result = await Promise.race([stopped, Promise.resolve().then(() => {
            need(!signal.aborted, stopReason());
            return reader({ receipt: structuredClone(receipt), context: structuredClone(context), profile: structuredClone(profile), phase, signal });
          })]);
        } finally { signal.removeEventListener('abort', onAbort); }
        need(!signal.aborted, stopReason());
        const time = validTime();
        result = structuredClone(result);
        need(result && sameBinding(result.binding, receipt), 'hosted_evidence_binding_mismatch');
        need(Number.isSafeInteger(result.observedAt) && result.observedAt <= time
          && time - result.observedAt <= HOSTED_EVIDENCE_MAX_AGE_MS, 'hosted_evidence_stale');
        documents.push(result);
        return result;
      };
      const proof = await read(readProvenance, 'hosted_provenance_unconfigured');
      const { claims, run, job } = proof;
      // claims is the authenticated target-job JWT, not the controller's token and not environment variables.
      need(claims?.runner_environment === 'github-hosted', 'hosted_provider_not_verified');
      need(claims.repository === REPOSITORY && positive(Number(claims.repository_id))
        && String(claims.run_id) === String(receipt.childRunId) && String(claims.run_attempt) === '1'
        && claims.workflow_sha === receipt.executorSha && claims.sha === receipt.executorSha
        && claims.workflow_ref === `${REPOSITORY}/${WORKFLOW}@refs/heads/main`
        && claims.event_name === 'workflow_dispatch' && claims.ref === 'refs/heads/main', 'hosted_oidc_identity_mismatch');
      need(run?.id === receipt.childRunId && run.run_attempt === 1 && run.path === WORKFLOW
        && run.head_sha === receipt.executorSha && run.head_branch === 'main' && run.event === 'workflow_dispatch'
        && run.status === 'in_progress' && run.conclusion === null
        && [run.repository, run.head_repository].every(repo => repo?.full_name === REPOSITORY
          && String(repo.id) === String(claims.repository_id)), 'hosted_run_identity_mismatch');
      need(positive(Number(claims.check_run_id)), 'hosted_job_claim_unavailable');
      const started = Date.parse(job?.started_at);
      need(positive(job?.id) && job.run_id === receipt.childRunId && job.run_attempt === 1
        && job.head_sha === receipt.executorSha && job.name === 'Admitted Worker shard'
        && job.status === 'in_progress' && job.conclusion === null
        && job.check_run_url === `https://api.github.com/repos/${REPOSITORY}/check-runs/${claims.check_run_id}`
        && Number.isFinite(started) && started <= now() && started <= receipt.startDeadline, 'hosted_job_identity_mismatch');
      need(Array.isArray(job.labels) && job.labels.every(label => typeof label === 'string')
        && !job.labels.some(label => label.toLowerCase() === 'self-hosted'), 'hosted_self_hosted_substitution');
      if (profile.id === 'hosted') {
        need(profile.target === 'ubuntu-latest' && job.labels.includes('ubuntu-latest'), 'hosted_target_mismatch');
      } else {
        need(profile.approvedGroupId === 6 && profile.target?.group === 'StudioOS Included Compute'
          && JSON.stringify(profile.target.labels) === JSON.stringify(['studioos-bench-linux-8'])
          && job.runner_group_id === 6 && job.runner_group_name === 'StudioOS Included Compute'
          && job.labels.includes('studioos-bench-linux-8'), 'included_target_mismatch');
        const lane = await read(readIncludedEligibility, 'included_eligibility_unconfigured');
        need(lane.jobId === job.id && lane.runnerGroupId === 6 && lane.provider === 'github-hosted'
          && lane.billingLane === 'included-compute' && lane.reservation === 'active'
          && lane.overageAllowed === false && lane.stopAtLimitVerified === true
          && Number.isSafeInteger(lane.validUntil) && lane.validUntil > now(), 'included_lane_unverified');
        includedValidUntil = lane.validUntil;
      }
      const boundary = await read(readBoundary, 'hosted_credential_boundary_unproven');
      need(boundary.kind === 'trusted-native-inspection' && DIGEST.test(boundary.policyDigest ?? '')
        && boundary.jobId === job.id && typeof boundary.instanceId === 'string' && boundary.instanceId.length > 0
        && boundary.instanceId.length <= 200 && boundary.scope === 'dependency-install-and-tests'
        && ['deniesRunnerAgent', 'deniesJobCredentials', 'deniesOidc', 'deniesAppCapabilities', 'deniesHostControl']
          .every(key => boundary[key] === true), 'hosted_credential_boundary_unproven');
      const completedAt = validTime();
      need(documents.every(document => document.observedAt <= completedAt
        && completedAt - document.observedAt <= HOSTED_EVIDENCE_MAX_AGE_MS), 'hosted_evidence_stale');
      need(includedValidUntil === null || includedValidUntil > completedAt, 'included_lane_unverified');
      return { allowed: true, reason: 'trusted_hosted_evidence_verified',
        boundary: { instanceId: boundary.instanceId, policyDigest: boundary.policyDigest, jobId: boundary.jobId, observedAt: boundary.observedAt } };
    } catch (error) {
      return { allowed: false, reason: error instanceof Refused ? error.message
        : signal.aborted ? stopReason() : 'hosted_evidence_unavailable' };
    }
  };
  return { inspect, verifyIsolation: async args => (await inspect(args)).allowed === true };
}
