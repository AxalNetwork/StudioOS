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

/** Only linux-x64 has an isolation implementation. Mac stays off and hosted/github-8 keep refusing until separately reviewed. */
export function isolationFor(profileId, options) {
  return profileId === 'linux-x64' ? linuxExecutorDependencies(options) : null;
}
