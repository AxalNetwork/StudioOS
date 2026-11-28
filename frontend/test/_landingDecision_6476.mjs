/**
 * D6476-p7: a synthetic landing decision, shaped exactly like the feeder reader's readLandingDecision() result
 * ({ pr, report, ...landPr.decide(facts) }), built by the real landPr.decide() from facts that pass every gate.
 * Each option breaks one fact, so a test names the gate it refuses on.
 */
import { decide, POLICY_WORKFLOW, QUEUE_STALLED } from '../../scripts/lib/landPr.mjs';

export function landingDecision(number, sha, {
  landingAuto = true, tier = 'T1', reportSha = sha, mergeQueue = true, admission = 'closed', stalled = false,
  editsPolicy = false, draft = false, state = 'open', checks = 'success',
} = {}) {
  const rules = [
    ...(mergeQueue ? [{ type: 'merge_queue' }] : []),
    { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci' }] } },
  ];
  const pr = { number, state, merged: false, draft, base_ref: 'main', head_sha: sha, auto_merge: null };
  const report = { baseSha: 'b'.repeat(40), headSha: reportSha, landingAuto, tier, reasons: [], source: 'trusted checkout' };
  const facts = {
    repo: { allow_auto_merge: true, allow_update_branch: true },
    rules,
    admissionIssue: admission === 'closed' ? { state: 'closed', state_reason: 'completed' } : { state: 'open', state_reason: null },
    pr,
    files: [{ filename: 'frontend/src/a.js' }, ...(editsPolicy ? [{ filename: POLICY_WORKFLOW }] : [])],
    checkRuns: [{ name: 'ci', head_sha: sha, status: checks === 'pending' ? 'in_progress' : 'completed', conclusion: checks === 'pending' ? null : checks }],
    landing: { checkRun: { head_sha: sha, status: 'completed', conclusion: 'success' }, report },
    alerts: stalled ? [{ number: 1, title: QUEUE_STALLED, state: 'open' }] : [],
  };
  return { pr, report, ...decide(facts) };
}
