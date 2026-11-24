/** D7905: binds the Linux job container to the trusted executor. No flag, receipt field or workflow input is isolation evidence. */
import { accessSync, constants } from 'node:fs';
import { ENGINE_CALL_MS, JobContainer, containerIsolationAdapter, readContainerPolicy } from './job-container.mjs';
/** Root-owned local policy; never a workflow path, input or environment value. */
export const LINUX_POLICY_PATH = '/etc/studioos/job-container-policy.json';
const REPOSITORY = 'AxalNetwork/StudioOS';
const need = (condition, reason) => { if (!condition) throw new Error(reason); };

/**
 * Admission runs before checkout, so no container exists yet and none can be inspected. This port therefore only
 * proves the boundary is available (reviewed local policy loaded, engine reachable, Linux x64 target). The live
 * container is verified by `executionIsolation` before any candidate byte runs, and again inside candidateExec.
 */
export function linuxExecutorDependencies({ policyPath = LINUX_POLICY_PATH, readPolicy = readContainerPolicy, engine, stage, platform = process.platform, aclTool = () => accessSync('/usr/bin/setfacl', constants.X_OK) } = {}) {
  need(platform === 'linux', 'linux_isolation_unavailable');
  const policy = readPolicy(policyPath);
  const job = new JobContainer(policy, { ...(engine ? { engine } : {}), ...(stage ? { stage } : {}) });
  const admissionIsolation = async ({ receipt, context, profile, signal } = {}) => {
    if (context?.repository !== REPOSITORY || profile?.id !== 'linux-x64' || receipt?.profile !== 'linux-x64') return false;
    // The engine must answer (one bounded, interruptible call), and input staging needs setfacl (package `acl`).
    try { await job.engine(['version', '--format', '{{.Server.Version}}'], { timeout: ENGINE_CALL_MS, signal }); aclTool(); return true; } catch { return false; }
  };
  return { job, admissionIsolation, executionIsolation: containerIsolationAdapter(job) };
}

/**
 * Coordinator-owned hosted children (`hosted`, `github-8`) use S30's accepted hosted-verification port (#8007).
 * Trusted readers are composed here only, never from inputs or the environment. S39 owns them (#8345); none exists
 * on main yet, so every hosted admission refuses. The factory receives the trusted boundary job, so a reader can
 * inspect that exact instance (job.inspectBoundary / job.inspectReadiness) instead of trusting a claimed one.
 */
export function hostedReaders() { return {}; }

/**
 * #8345: the hosted execution boundary job. None is composed, so run mode refuses. Three capabilities are missing,
 * and none is stubbed: (1) a hosted runner has no root-owned container policy and no pre-pulled digest-pinned image
 * (`--pull=never`), so a trusted policy and image acquisition from the control checkout is needed; (2) the bridge
 * network reaches the host's metadata and platform endpoints, so host control is not denied until a verified egress
 * rule exists (`inspectBoundary` reports deniesHostControl: false); (3) native proof on a hosted runner that
 * candidate code cannot read the OIDC token, job token, runner-agent credentials or host metadata.
 */
export function hostedBoundaryJob() { return null; }

/**
 * #8345: the ports are chosen by WHEN the executor calls them, like linux-x64. Admission (before checkout, no
 * instance) proves provenance, eligibility and boundary readiness. Execution (run step, before install and again
 * before test) proves the LIVE instance, pinned to the trusted job's own boundary identity; the supervisor also
 * requires that identity unchanged between the two calls.
 */
export function hostedExecutorDependencies({ profileId = 'hosted', loadVerification = () => import('./hosted-verification.mjs'), readers = hostedReaders, boundaryJob = hostedBoundaryJob } = {}) {
  let job = null;
  try { job = boundaryJob(); } catch { job = null; }
  const verification = async () => { const { createHostedVerification } = await loadVerification(); return createHostedVerification(readers({ job })); };
  const admissionIsolation = async args => {
    try { return await (await verification()).verifyAdmission(args) === true; } catch { return false; }
  };
  // The job must serve exactly the profile being composed; a github-8 job never stands in for hosted, or the reverse.
  if (!['hosted', 'github-8'].includes(profileId) || !(job instanceof JobContainer) || job.profileId !== profileId) return { admissionIsolation };
  const executionIsolation = async args => {
    try {
      const identity = job.boundaryIdentity();
      if (!identity || args?.profile?.id !== job.profileId || args?.receipt?.profile !== job.profileId) return false;
      return await (await verification()).verifyExecution({ ...args, boundary: { instanceId: identity.instanceId, policyDigest: identity.policyDigest } }) === true;
    } catch { return false; }
  };
  return { job, admissionIsolation, executionIsolation };
}

/** linux-x64: the container. hosted/github-8: S30's verification port, still without readers or a boundary job. Mac stays off. */
export function isolationFor(profileId, options) {
  if (profileId === 'linux-x64') return linuxExecutorDependencies(options);
  if (profileId === 'hosted' || profileId === 'github-8') return hostedExecutorDependencies({ ...options, profileId });
  return null;
}
