import { createHash } from 'node:crypto';

const SHA = /^[0-9a-f]{40}$/;
const isSha = (value) => typeof value === 'string' && SHA.test(value);
const AUDIT_INTERVAL = 20;
export const MAX_BASE_COMMITS = 10;
export const MAX_BASE_MINUTES = 120;

/**
 * A null parts list delegates to the existing full matrix. Keep the full
 * matrix defined by the planner so changes to sharding also apply to fallbacks.
 */
export function tierFor({ event, draft, fork, headSha, selection } = {}) {
  const full = (reason) => ({ mode: 'full', reason, parts: null });
  if (event !== 'pull_request') return full('event');
  if (draft === true) return { mode: 'draft', reason: 'draft', parts: ['rest'] };
  if (fork !== false) return full('fork-or-unknown');
  if (!isSha(headSha)) return full('unknown-head');
  if (selection?.mode !== 'selected' || !Array.isArray(selection.files) ||
      !Array.from(selection.files).every((file) => typeof file === 'string' && file.trim() !== '')) {
    return full('selection-fallback');
  }
  const sample = createHash('sha256').update(headSha).digest().readUInt32BE();
  if (sample % AUDIT_INTERVAL === 0) return full('audit');
  return { mode: 'thin', reason: 'selected', parts: ['rest', 'selected'] };
}

/**
 * Evaluate trusted GitHub run, gate, and base evidence from an adapter.
 * The adapter must pin the repository and CI workflow ID, bind the proven
 * base to the run and attempt, confirm the full suite independently of
 * the gate name, and compare the tested base to the current main tip.
 * Missing evidence fails the check. This function does not fetch or
 * authenticate the records it receives.
 */
export function fullRunValid({
  headSha, mainSha, repositoryId, workflowId, run, gate, base,
} = {}) {
  if (!isSha(headSha) ||
      !isSha(mainSha) ||
      !Number.isSafeInteger(repositoryId) || repositoryId < 1 ||
      !Number.isSafeInteger(workflowId) || workflowId < 1) return false;

  if (run?.event !== 'workflow_dispatch' || run.conclusion !== 'success' ||
      run.repositoryId !== repositoryId || run.workflowId !== workflowId ||
      run.headSha !== headSha ||
      !Number.isSafeInteger(run.id) || run.id < 1 ||
      !Number.isSafeInteger(run.attempt) || run.attempt < 1) return false;

  if (gate?.name !== 'landing gate' || gate.conclusion !== 'success' ||
      gate.fullSuiteVerified !== true || gate.headSha !== headSha || gate.runId !== run.id || gate.attempt !== run.attempt) return false;

  if (!base || base.runId !== run.id || base.attempt !== run.attempt ||
      base.mainSha !== mainSha || !isSha(base.sha) ||
      base.ancestorOfMain !== true ||
      !Number.isSafeInteger(base.commitsBehind) || base.commitsBehind < 0 ||
      (base.commitsBehind === 0) !== (base.sha === mainSha) ||
      !Number.isFinite(base.minutesBehind) || base.minutesBehind < 0 ||
      (base.sha === mainSha && base.minutesBehind !== 0)) return false;

  return base.commitsBehind < MAX_BASE_COMMITS && base.minutesBehind <= MAX_BASE_MINUTES;
}
