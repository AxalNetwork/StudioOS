import { LABELS } from './rules.mjs';

const ownerLabels = new Set([LABELS.off, LABELS.resolved, LABELS.mainRepair]);
const commitOid = /^[a-f0-9]{40}$/;

/**
 * #6481 (D6481-p2): why a listed PR is not admitted now, as one line for the run summary, or null when every
 * condition holds. Each line starts with its kind: checks, policy, conflict, hold, owner review or queue. Only a
 * positive fact admits: null mergeability, an unread gate or a missing field is a reason, never a pass.
 */
export function waitingReason({ pull, landing, evidence } = {}) {
  const number = pull?.number;
  const head = pull?.head?.sha;
  if (!Number.isSafeInteger(number) || number < 1 || typeof head !== 'string' || !commitOid.test(head)) {
    return 'checks: the pull request or its head commit could not be read';
  }
  if (pull.state !== 'open' || pull.merged !== false) return 'hold: the pull request is not open';
  if (pull.draft !== false) return 'checks: a draft; Ready for review starts the full suite and a fresh landing policy report';
  if (pull.mergeable === false) return 'conflict: the branch conflicts with main';
  if (pull.mergeable !== true) return 'conflict: GitHub has not computed mergeability for this head yet';
  if (pull.base?.ref !== 'main' || !pull.base.repo?.full_name || pull.head.repo?.full_name !== pull.base.repo.full_name) {
    return 'hold: not a same-repository pull request into main';
  }

  // These are the actual fields emitted by scripts/land-pr.mjs --json. Its verdict runs all seven gates.
  if (landing?.mayQueue !== true) {
    const gate = Array.isArray(landing?.gates) ? landing.gates.find(g => g?.ok !== true) : null;
    return `policy: ${gate ? `${gate.name} (${gate.detail})` : 'the landing decision could not be read'}`;
  }
  if (landing.pr?.number !== number || landing.pr.head_sha !== head || landing.report?.headSha !== head) {
    return 'policy: the landing policy report is not for this head';
  }
  if (!['T0', 'T1'].includes(landing.report.tier)) return `owner review: tier ${landing.report.tier}; the owner lands it`;
  if (!Array.isArray(pull.labels)) return 'hold: the labels could not be read';
  const label = pull.labels.find(l => typeof l?.name !== 'string' || !l.name.trim() || ownerLabels.has(l.name.toLowerCase()));
  if (label) return typeof label?.name === 'string' && label.name.trim() ? `hold: labelled ${label.name}` : 'hold: a label could not be read';
  if (evidence?.number !== number || evidence.headSha !== head) return 'checks: the evidence is not for this head (the head moved)';
  if (evidence.eligible !== true) {
    const why = Array.isArray(evidence.eligibleReasons) && evidence.eligibleReasons.length ? evidence.eligibleReasons.join('; ') : 'a shared landing-bot rule refuses it';
    return `hold: ${why}`;
  }
  if (evidence.fullSuitePassed !== true) {
    return 'checks: no successful full-suite run of an unchanged ci.yml on this exact head (a draft fast tier, a skipped job or a name alone does not count)';
  }
  if (evidence.modelRepaired !== false) return 'owner review: a model-repaired or unattributed bot commit; the owner lands it';
  if (evidence.alreadyQueued !== false) return 'queue: already in the merge queue, or auto-merge is on';
  if (evidence.priorQueueEntry !== false) return 'queue: it was in the merge queue before; a return is the ejection handler\'s (#6476)';
  return null;
}

const eligibleHead = candidate => (waitingReason(candidate) === null ? candidate.pull.head.sha : null);

/**
 * Plan one sweep in the order supplied by #6469. The caller gathers facts under the trusted base workflow.
 * Each row contains a REST pull, the land-pr JSON result, and evidence for this PR and head:
 * eligible (shared bot rules and breakers), fullSuitePassed (trusted full-suite job), modelRepaired
 * (authenticated repair history), alreadyQueued (current queue membership), and priorQueueEntry (GitHub's
 * history since the PR opened; only #6476 may requeue). An unknown fact excludes the PR.
 * Limits are reconciled, non-negative integer counts, never estimates. The caller serializes sweeps, refreshes
 * mutable facts before a write, and uses expectedHeadOid in enqueuePullRequest.
 */
export function selectQueueEntries(orderedCandidates, capacity) {
  const { perSweep, remainingDaily, freeQueueSlots } = capacity ?? {};
  const limits = [perSweep, remainingDaily, freeQueueSlots];
  if (!Array.isArray(orderedCandidates) || !limits.every(value => Number.isSafeInteger(value) && value > 0)) return [];
  const heads = new Map();
  for (const candidate of orderedCandidates) {
    const number = candidate?.pull?.number;
    if (!Number.isSafeInteger(number) || number < 1) continue;
    const head = eligibleHead(candidate);
    // If two reads of the same PR disagree, skip it until a later sweep.
    if (!heads.has(number)) heads.set(number, head);
    else if (heads.get(number) !== head) heads.set(number, null);
  }
  const selected = [];
  const cap = Math.min(...limits);
  for (const [number, expectedHeadOid] of heads) {
    if (expectedHeadOid) selected.push({ number, expectedHeadOid });
    if (selected.length === cap) break;
  }
  return selected;
}
