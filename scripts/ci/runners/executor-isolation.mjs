/** D7905: binds the Linux job container to the trusted executor. No flag, receipt field or workflow input is isolation evidence. */
import { accessSync, constants } from 'node:fs';
import { JobContainer, containerIsolationAdapter, readContainerPolicy } from './job-container.mjs';
/** Root-owned local policy; never a workflow path, input or environment value. */
export const LINUX_POLICY_PATH = '/etc/studioos/job-container-policy.json';
const REPOSITORY = 'AxalNetwork/StudioOS';
const need = (condition, reason) => { if (!condition) throw new Error(reason); };

/**
 * Admission runs before checkout, so no container exists yet and none can be inspected. This port therefore only
 * proves the boundary is available (reviewed local policy loaded, engine reachable, Linux x64 target). The live
 * container is verified by `executionIsolation` before any candidate byte runs, and again inside runCandidate.
 */
export function linuxExecutorDependencies({ policyPath = LINUX_POLICY_PATH, readPolicy = readContainerPolicy, engine, stage, platform = process.platform, aclTool = () => accessSync('/usr/bin/setfacl', constants.X_OK) } = {}) {
  need(platform === 'linux', 'linux_isolation_unavailable');
  const policy = readPolicy(policyPath);
  const job = new JobContainer(policy, { ...(engine ? { engine } : {}), ...(stage ? { stage } : {}) });
  const admissionIsolation = async ({ receipt, context, profile } = {}) => {
    if (context?.repository !== REPOSITORY || profile?.id !== 'linux-x64' || receipt?.profile !== 'linux-x64') return false;
    // The engine must answer, and input staging needs setfacl (package `acl`) to grant only the candidate UID read.
    try { job.engine(['version', '--format', '{{.Server.Version}}']); aclTool(); return true; } catch { return false; }
  };
  return { job, admissionIsolation, executionIsolation: containerIsolationAdapter(job) };
}

/**
 * Coordinator-owned hosted children (`hosted`, `github-8`) use S30's accepted hosted-verification port (#8007).
 * Trusted readers are composed here only, never from inputs or the environment. None exists yet: provenance needs
 * a target-job OIDC token that candidate processes cannot reach, the boundary needs a real credential-denying
 * execution boundary, and included eligibility comes from the authority's receipt (s39). Until then every
 * hosted admission refuses, and there is no hosted execution job, so run mode refuses too.
 */
export function hostedReaders() { return {}; }
export function hostedExecutorDependencies({ loadVerification = () => import('./hosted-verification.mjs'), readers = hostedReaders } = {}) {
  return {
    admissionIsolation: async args => {
      try { const { createHostedVerification } = await loadVerification(); return await createHostedVerification(readers()).verifyIsolation(args) === true; }
      catch { return false; }
    },
  };
}

/** linux-x64: the container. hosted/github-8: S30's verification port, still without readers. Mac stays off. */
export function isolationFor(profileId, options) {
  if (profileId === 'linux-x64') return linuxExecutorDependencies(options);
  if (profileId === 'hosted' || profileId === 'github-8') return hostedExecutorDependencies(options);
  return null;
}
