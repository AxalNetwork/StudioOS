/** D8345: trusted hosted evidence acquisition; unwired until S09 supplies the live hosted job and phase composition. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { authenticateCapacity } from '../../../merge-control/src/ciCapacityAuth.ts';
import { capacityJson } from '../capacity-client.mjs';
import { receiptIdentity } from '../runner-admission.mjs';
import { verifiedContainer } from './job-container.mjs';
const REPOSITORY = 'AxalNetwork/StudioOS', WORKFLOW = '.github/workflows/runner-executor.yml';
const API = `https://api.github.com/repos/${REPOSITORY}/`;
const need = (ok, reason) => { if (!ok) throw Error(reason); };
const positive = n => Number.isSafeInteger(n) && n > 0;
const binding = r => ({ ...receiptIdentity(r), childWorkflowSha: r.childWorkflowSha ?? r.executorSha });
const equal = (a, b) => isDeepStrictEqual(binding(a), binding(b));
const fresh = (at, now) => Number.isSafeInteger(at) && at <= now && now - at <= 30_000;
export const HOSTED_READER_MS = 10_000;

/** Only two GET resource forms. No endpoint, method, credential or provider authority comes from candidate JSON. */
export function hostedGithubRead({ token, fetcher = globalThis.fetch } = {}) {
  return async (path, signal) => {
    need(typeof token === 'string' && token.length > 0 && token.length <= 16_384, 'hosted_github_unconfigured');
    need(/^actions\/runs\/[1-9][0-9]{0,14}\/attempts\/1(?:\/jobs\?per_page=100&page=[1-3])?$/.test(path), 'hosted_github_path_refused');
    const response = await fetcher(new URL(path, API), { method: 'GET', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    need(!response.redirected, 'hosted_redirect_refused');
    return capacityJson(response, 512 * 1024);
  };
}

/**
 * Trusted-code dependencies only. readReceipt is the authenticated authority client; oidcToken is GitHub's
 * reserved target-job closure. job is the supervisor-owned native object, never a request-supplied ID or flag.
 * No default job, eligibility producer or runtime registration is supplied. All three ports fail closed.
 */
export function createHostedReaders({ audience, readReceipt, oidcToken, githubRead, issuerFetch = globalThis.fetch,
  job, now = Date.now } = {}) {
  let scope = null, proof = null, instance = null;
  const currentTime = (receipt, phase) => {
    const time = now();
    need(Number.isSafeInteger(time) && Number.isSafeInteger(receipt.executionDeadline) && time < receipt.executionDeadline
      && Number.isSafeInteger(receipt.startDeadline) && receipt.startDeadline < receipt.executionDeadline
      && (phase !== 'start' || time <= receipt.startDeadline), 'hosted_reader_lease_expired');
    return time;
  };
  // Race even a misbehaving injected port; production network/engine clients also receive the shared abort.
  const bounded = fn => async input => {
    const args = { ...structuredClone({ receipt: input.receipt, context: input.context, profile: input.profile, phase: input.phase }), signal: input.signal };
    const started = currentTime(args.receipt, args.phase);
    const controller = new AbortController();
    const signal = args.signal ? AbortSignal.any([args.signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), Math.min(HOSTED_READER_MS, args.receipt.executionDeadline - started));
    let abort;
    try {
      need(!signal.aborted, 'hosted_reader_cancelled');
      const stop = new Promise((_, reject) => { abort = () => reject(Error('hosted_reader_cancelled')); signal.addEventListener('abort', abort, { once: true }); });
      const result = await Promise.race([stop, fn({ ...structuredClone({ receipt: args.receipt, context: args.context, profile: args.profile, phase: args.phase }), signal })]);
      need(!signal.aborted, 'hosted_reader_cancelled');
      const completed = currentTime(args.receipt, args.phase);
      need(fresh(result.observedAt, completed), 'hosted_reader_evidence_stale');
      return structuredClone(result);
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  };
  const authority = async args => {
    const { receipt, context, profile, phase, signal } = args;
    need(['start', 'execute'].includes(phase) && ['hosted', 'github-8'].includes(receipt.profile)
      && profile?.id === receipt.profile && context?.repository === REPOSITORY && receipt.repository === REPOSITORY
      && context.executorSha === receipt.executorSha && String(context.childRunId) === String(receipt.childRunId)
      && String(context.childAttempt) === '1' && receipt.childAttempt === 1
      && (context.childWorkflowSha ?? context.executorSha) === (receipt.childWorkflowSha ?? receipt.executorSha), 'hosted_reader_context');
    need(typeof readReceipt === 'function', 'hosted_receipt_unconfigured');
    const envelope = await readReceipt({ request: { requestId: receipt.requestId, shard: receipt.logicalShard,
      generation: receipt.generation, profile: receipt.profile }, context, phase, signal });
    need(!signal.aborted && envelope?.active === true && envelope.receipt && equal(envelope.receipt, receipt), 'hosted_receipt_changed');
    const identity = binding(receipt);
    need(scope === null || isDeepStrictEqual(scope, identity), 'hosted_reader_scope_changed');
    scope ??= structuredClone(identity);
    currentTime(receipt, phase);
    return envelope;
  };
  const readProvenance = bounded(async args => {
    proof = null; // A failed refresh cannot leave previous provenance usable by the next reader.
    const { receipt, signal, phase } = args, observedAt = currentTime(receipt, phase);
    await authority(args);
    need(typeof audience === 'string' && audience.length > 0 && audience.length <= 200
      && typeof oidcToken === 'function' && typeof githubRead === 'function', 'hosted_provenance_unconfigured');
    const token = await oidcToken(audience, signal);
    // Reuse the actual authority verifier, not payload decoding. Fetch only the issuer's fixed JWKS resource.
    const claims = await authenticateCapacity(new Request('https://hosted-verifier.invalid/', { headers: { Authorization: `Bearer ${token}` } }),
      audience, REPOSITORY, (url, init) => {
        need(String(url) === 'https://token.actions.githubusercontent.com/.well-known/jwks', 'hosted_issuer_path_refused');
        return issuerFetch(url, { ...init, redirect: 'error', signal });
      }, now);
    need(!signal.aborted, 'hosted_reader_cancelled');
    const childSha = receipt.childWorkflowSha ?? receipt.executorSha;
    need(claims.runner_environment === 'github-hosted' && claims.run_id === String(receipt.childRunId)
      && claims.run_attempt === '1' && claims.sha === childSha && claims.workflow_sha === childSha
      && claims.workflow_ref === `${REPOSITORY}/${WORKFLOW}@refs/heads/main`
      && claims.ref === 'refs/heads/main' && claims.event_name === 'workflow_dispatch'
      && /^[1-9][0-9]{0,14}$/.test(claims.check_run_id ?? ''), 'hosted_target_claims_refused');
    const prefix = `actions/runs/${receipt.childRunId}/attempts/1`;
    const run = await githubRead(prefix, signal);
    need(run?.id === receipt.childRunId && run.run_attempt === 1 && run.path === WORKFLOW && run.head_sha === childSha
      && run.head_branch === 'main' && run.event === 'workflow_dispatch' && run.status === 'in_progress' && run.conclusion === null
      && [run.repository, run.head_repository].every(r => r?.full_name === REPOSITORY && String(r.id) === claims.repository_id), 'hosted_target_run_refused');
    const jobs = []; let total = null;
    for (let page = 1; page <= 3; page++) {
      const data = await githubRead(`${prefix}/jobs?per_page=100&page=${page}`, signal);
      need(Array.isArray(data?.jobs) && data.jobs.length <= 100 && Number.isSafeInteger(data.total_count)
        && data.total_count >= 0 && data.total_count <= 300 && (total === null || total === data.total_count), 'hosted_jobs_incomplete');
      total = data.total_count; jobs.push(...data.jobs);
      need(jobs.length <= total, 'hosted_jobs_incomplete');
      if (jobs.length === total) break;
      need(data.jobs.length === 100 && page < 3, 'hosted_jobs_incomplete');
    }
    need(jobs.length === total && new Set(jobs.map(j => j.id)).size === jobs.length
      && jobs.every(j => positive(j.id) && j.run_id === receipt.childRunId && j.run_attempt === 1 && j.head_sha === childSha), 'hosted_jobs_incomplete');
    const matches = jobs.filter(j => j.name === 'Admitted Worker shard'
      && j.check_run_url === `https://api.github.com/repos/${REPOSITORY}/check-runs/${claims.check_run_id}`);
    need(matches.length === 1, 'hosted_target_job_refused');
    const selected = matches[0], started = Date.parse(selected.started_at);
    need(selected.status === 'in_progress' && selected.conclusion === null && Number.isFinite(started)
      && started <= now() && started <= receipt.startDeadline && Array.isArray(selected.labels)
      && selected.labels.every(x => typeof x === 'string') && !selected.labels.some(x => x.toLowerCase() === 'self-hosted')
      && (receipt.profile === 'hosted' ? selected.labels.includes('ubuntu-latest')
        : selected.runner_group_id === 6 && selected.runner_group_name === 'StudioOS Included Compute'
          && selected.labels.includes('studioos-bench-linux-8')), 'hosted_target_job_refused');
    need(!signal.aborted && fresh(observedAt, currentTime(receipt, phase)), 'hosted_reader_evidence_stale');
    proof = { binding: structuredClone(receipt), observedAt, claims, run, job: selected };
    return proof;
  });
  const recentProof = receipt => {
    need(proof && equal(proof.binding, receipt) && fresh(proof.observedAt, now()), 'hosted_provenance_required');
    return proof;
  };
  const readBoundary = bounded(async args => {
    const { receipt, signal, phase } = args, observedAt = currentTime(receipt, phase);
    await authority(args); const provenance = recentProof(receipt);
    need(job && typeof job.engine === 'function' && typeof job.namespace === 'function', 'hosted_native_job_unconfigured');
    const owned = structuredClone(job.owned), policy = structuredClone(job.policy);
    need(owned?.receipt && equal(owned.receipt, receipt) && /^[a-f0-9]{64}$/.test(owned.id ?? '')
      && owned.owner === `${receipt.childRunId}-1-${receipt.generation}`
      && owned.deadlineSeconds === Math.floor(receipt.executionDeadline / 1000)
      && policy?.version === 1 && /^sha256:[a-f0-9]{64}$/.test(policy.image ?? '') && owned.image === policy.image
      && policy.nodeVersion === '22.23.3' && policy.pythonVersion === '3.11.18', 'hosted_native_ownership_refused');
    const call = async command => {
      need(!signal.aborted, 'hosted_reader_cancelled');
      const left = Math.min(HOSTED_READER_MS, receipt.executionDeadline - now());
      need(left > 0, 'hosted_reader_lease_expired');
      return job.engine(command, { signal, timeout: left });
    };
    const rows = JSON.parse(await call(['inspect', owned.id]));
    need(Array.isArray(rows) && rows.length === 1 && rows[0].Id === owned.id, 'hosted_native_inspection_refused');
    const pid = rows[0].State?.Pid;
    need(positive(pid) && verifiedContainer(rows[0], { ...owned,
      pidNamespace: job.namespace(pid, 'pid') === true, mountNamespace: job.namespace(pid, 'mnt') === true }), 'hosted_native_inspection_refused');
    need(String(await call(['exec', '--user', '10000:10000', owned.id, '/usr/local/bin/node', '-p', 'process.versions.node'])).trim() === policy.nodeVersion
      && String(await call(['exec', '--user', '10000:10000', owned.id, '/usr/local/bin/python3', '-c', 'import platform; print(platform.python_version())'])).trim() === policy.pythonVersion, 'hosted_native_runtime_refused');
    need(isDeepStrictEqual(owned, job.owned) && isDeepStrictEqual(policy, job.policy), 'hosted_native_instance_changed');
    const identity = { instanceId: owned.id, policyDigest: `sha256:${createHash('sha256').update(JSON.stringify(policy)).digest('hex')}`, jobId: provenance.job.id };
    need(instance === null || isDeepStrictEqual(instance, identity), 'hosted_native_instance_changed');
    need(!signal.aborted, 'hosted_reader_cancelled');
    instance ??= identity;
    return { binding: receipt, observedAt, kind: 'trusted-native-inspection', ...identity, scope: 'dependency-install-and-tests',
      deniesRunnerAgent: true, deniesJobCredentials: true, deniesOidc: true, deniesAppCapabilities: true, deniesHostControl: true };
  });
  const readIncludedEligibility = bounded(async args => {
    const envelope = await authority(args), provenance = recentProof(args.receipt);
    const lane = envelope.hostedEvidence?.includedEligibility;
    need(args.receipt.profile === 'github-8' && lane?.binding && equal(lane.binding, args.receipt)
      && fresh(lane.observedAt, now()) && lane.jobId === provenance.job.id && lane.runnerGroupId === 6
      && lane.provider === 'github-hosted' && lane.billingLane === 'included-compute' && lane.reservation === 'active'
      && lane.overageAllowed === false && lane.stopAtLimitVerified === true
      && Number.isSafeInteger(lane.validUntil) && lane.validUntil > now() && lane.validUntil <= args.receipt.executionDeadline, 'hosted_included_authority_unavailable');
    // Preserve the authority observation time; reading a cached response cannot make evidence fresh again.
    return structuredClone(lane);
  });
  return { readProvenance, readBoundary, readIncludedEligibility, now };
}
