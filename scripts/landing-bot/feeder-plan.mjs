import { LABELS } from './rules.mjs';

const ownerLabels = new Set([LABELS.off, LABELS.resolved, LABELS.mainRepair]);
const commitOid = /^[a-f0-9]{40}$/;

function eligibleHead({ pull, landing, evidence } = {}) {
  const number = pull?.number;
  const head = pull?.head?.sha;
  if (!Number.isSafeInteger(number) || number < 1 || typeof head !== 'string' || !commitOid.test(head)) return null;
  if (pull.state !== 'open' || pull.draft !== false || pull.merged !== false || pull.mergeable !== true ||
      pull.base?.ref !== 'main' || !pull.base.repo?.full_name || pull.head.repo?.full_name !== pull.base.repo.full_name) return null;

  // These are the actual fields emitted by scripts/land-pr.mjs --json. Its verdict runs all seven gates.
  if (landing?.mayQueue !== true || landing.pr?.number !== number || landing.pr.head_sha !== head ||
      landing.report?.headSha !== head || !['T0', 'T1'].includes(landing.report.tier)) return null;
  if (!Array.isArray(pull.labels) || pull.labels.some(label => typeof label?.name !== 'string' ||
      !label.name.trim() || ownerLabels.has(label.name.toLowerCase()))) return null;
  if (evidence?.number !== number || evidence.headSha !== head || evidence.eligible !== true ||
      evidence.fullSuitePassed !== true || evidence.modelRepaired !== false ||
      evidence.alreadyQueued !== false || evidence.priorQueueEntry !== false) return null;
  return head;
}

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
