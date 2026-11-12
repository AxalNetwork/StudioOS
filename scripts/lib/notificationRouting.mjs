// D5666: observational v1 policy adapter; authorities are atomic claims, live required rules and the existing CI digest.
import { createHash } from 'node:crypto';
import { parseClaim, isExpired } from './claims.mjs';
const sha = value => /^[a-f0-9]{40}$/.test(value || '') ? value : null;
const id = value => /^[1-9]\d{0,18}$/.test(String(value ?? '')) ? String(value) : null;
const login = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,39}(?:\[bot\])?$/.test(value) ? value : null;
export function canonicalSlot(value) { const m = /^s(\d{1,3})$/i.exec(String(value || '')); return m && Number(m[1]) > 0 ? `S${String(Number(m[1])).padStart(2, '0')}` : null; }
export function requiredContexts(ruleset) {
  if (ruleset?.enforcement !== 'active') return null;
  const rule = ruleset.rules?.find(r => r.type === 'required_status_checks');
  if (!Array.isArray(rule?.parameters?.required_status_checks)) return null;
  return rule.parameters.required_status_checks.filter(c => typeof c.context === 'string').map(c => ({ context: c.context, app: id(c.integration_id) }));
}
export function ownership({ issues = [], claims = [], pr, now = Date.now() }) {
  const linked = issues.filter(i => id(i.number)); const candidates = [], problems = [];
  for (const issue of linked) {
    const labels = [...new Set((issue.labels || []).map(l => /^slot:(.+)$/i.exec(typeof l === 'string' ? l : l.name)?.[1]).map(canonicalSlot).filter(Boolean))];
    const claimRow = claims.find(c => String(c.issue) === String(issue.number));
    if (issue.unreadable || claimRow?.unreadable) { problems.push('ownership_scope_unreadable'); continue; }
    const claim = claimRow?.ref === `refs/heads/claim/${issue.number}` && !claimRow.released ? parseClaim(claimRow.message) : null;
    if (labels.length > 1) { problems.push('competing_slot_labels'); continue; }
    if (claim && claim.issue !== Number(issue.number)) { problems.push('claim_issue_mismatch'); continue; }
    if (claim && isExpired(claim, now)) { problems.push('expired_claim_still_held'); continue; }
    if (claim && labels.length === 1 && labels[0] === canonicalSlot(claim.slot)) candidates.push({ kind: 'slot', slot: labels[0], key: `${labels[0]}:${createHash('sha256').update(JSON.stringify([claim.agent, claim.session])).digest('hex')}`, issue: Number(issue.number) });
    else if (claim) problems.push('claim_label_mismatch_or_missing');
  }
  const holders = [...new Map(candidates.map(c => [c.key, c])).values()];
  if (holders.length === 1 && !problems.length) return { ...holders[0], evidence: 'atomic_claim_and_linked_issue', problems: [] };
  if (holders.length > 1 || problems.length) return { kind: 'triage', slot: 'S01', key: 'triage:S01', evidence: 'ambiguous_ownership', problems: [...problems, ...(holders.length > 1 ? ['competing_linked_claims'] : [])] };
  const author = login(pr?.user?.login || pr?.author);
  if (author) return { kind: 'github', login: author, key: `github:${author}`, evidence: 'pr_author_fallback', problems: [] };
  const reviewer = (pr?.requested_reviewers || []).map(r => login(r.login)).filter(Boolean);
  if (reviewer.length === 1) return { kind: 'github', login: reviewer[0], key: `github:${reviewer[0]}`, evidence: 'requested_reviewer_fallback', problems: [] };
  return { kind: 'triage', slot: 'S01', key: 'triage:S01', evidence: 'owner_not_recorded', problems: ['owner_not_recorded'] };
}
function digestAuthority(input, event, head) {
  const d = input?.digest;
  if (input?.verified !== true || input.source !== 'studioos-ci-digest:v1' || input.author !== 'github-actions[bot]' || String(input.runId) !== event.ids?.run || String(input.attempt) !== event.ids?.attempt || d?.headSha !== head || !/^[a-f0-9]{64}$/.test(d?.fingerprint || '') || !['pr_failure', 'inherited_main_failure', 'infra_failure', 'main_health_unknown'].includes(d?.verdict)) return null;
  return d;
}
export function routeObservation({ event, pr = null, issues = [], claims = [], ruleset = null, digestEnvelope = null, requiredCheck = null, checkSnapshot = null, incident = null, queue = null, previous = null, now = Date.now(), mentionMap = {}, allowMentions = false }) {
  if (event?.schema !== 1 || !/^[a-f0-9]{64}$/.test(event.key || '') || !/^[\w.-]+\/[\w.-]+$/.test(event.repository || '')) throw new Error('routing_event_invalid');
  const number = id(pr?.number), head = sha(pr?.head?.sha || pr?.headSha), subject = number ? `pr:${number}` : null;
  const owner = ownership({ issues, claims, pr, now });
  const policy = { schema: 1, role: event.visibility === 'restricted' || event.family === 'security' ? 'security' : 'activity', disposition: 'routine', material: false, subject, slot: owner.slot || null, revision: Date.parse(event.occurredAt || event.observedAt), mentionKey: null };
  const evidence = { schema: 1, event: event.key, owner: { kind: owner.kind, slot: owner.slot || null, login: owner.login || null, evidence: owner.evidence, problems: owner.problems }, nextStep: null, cause: null, requiredScope: 'unreadable', stale: false, incidentIssue: null, groupSha: null };
  if (policy.role === 'security') return { policy, evidence, state: previous };
  if (!number && event.kind === 'merge_group') {
    policy.disposition = 'unknown'; evidence.nextStep = 'confirm_queue_membership'; evidence.groupSha = sha(event.refs?.candidate); return { policy, evidence, state: previous };
  }
  if (!number || !head) return { policy, evidence, state: previous };
  const root = `subject:${event.repository}:${subject}:prs`;
  const previousCurrent = previous?.head === head ? previous : null;
  const observedHead = sha(event.refs?.reviewed || event.refs?.head);
  const priorCI = previous?.head === head && previous.lastCI;
  const olderAttempt = event.family === 'ci' && priorCI && id(event.ids?.run) && id(event.ids?.attempt) && (BigInt(event.ids.run) < BigInt(priorCI.run) || event.ids.run === priorCI.run && BigInt(event.ids.attempt) < BigInt(priorCI.attempt));
  const old = olderAttempt || observedHead && observedHead !== head || previous && Number.isFinite(policy.revision) && policy.revision < previous.revision;
  evidence.stale = Boolean(old);
  const state = { head, revision: Math.max(previous?.revision || 0, Number.isFinite(policy.revision) ? policy.revision : 0), root, threadExists: previous?.threadExists || false, fingerprint: previousCurrent?.fingerprint || null, disposition: previousCurrent?.disposition || 'routine', owner: owner.key, actionType: previousCurrent?.actionType || null, lastCI: priorCI || null, reviewRequest: previousCurrent?.reviewRequest || null, closed: pr.merged === true || pr.state === 'closed' };
  if (old) return { policy, evidence, state: previous || state };
  policy.subject = subject;
  const reflect = disposition => { policy.role = 'prs'; policy.disposition = disposition; policy.material = true; state.threadExists = true; state.disposition = disposition; };
  if (state.closed) { if (state.threadExists) reflect('routine'); evidence.nextStep = pr.merged ? 'observe_landed_sha_and_deploy_separately' : 'closed_without_merge'; return { policy, evidence, state }; }
  if (['review_requested', 'ready_for_review', 'changes_requested', 'owner_decision_required'].includes(event.action) || event.state === 'changes_requested' || event.kind === 'pull_request' && pr.draft !== true && event.reviewers?.length > 0) {
    const targets = (event.reviewers || pr.requested_reviewers?.map(r => r.login) || []).map(login).filter(Boolean).sort();
    const request = JSON.stringify([head, event.state === 'changes_requested' || event.action === 'changes_requested' ? 'changes' : 'review', targets]);
    const duplicateRequest = previousCurrent?.actionType === 'review' && previousCurrent.disposition === 'action' && previousCurrent.reviewRequest === request && previousCurrent.owner === owner.key;
    if (!duplicateRequest) reflect('action'); else { policy.role = 'prs'; policy.disposition = 'action'; }
    state.reviewRequest = request; state.actionType = 'review'; policy.githubReviewers = (event.reviewers || pr.requested_reviewers?.map(r => r.login) || []).map(login).filter(Boolean); evidence.nextStep = event.state === 'changes_requested' || event.action === 'changes_requested' ? 'read_requested_changes' : 'read_review_request';
  } else if (event.kind === 'merge_group' || queue) {
    const group = sha(queue?.groupSha), mapped = queue?.prs?.map(id).filter(Boolean) || [];
    evidence.groupSha = group;
    if (!group || group !== sha(event.refs?.candidate) || !mapped.includes(number)) { policy.disposition = 'unknown'; evidence.nextStep = 'confirm_queue_membership'; }
    else if (queue.verifiedConflict === true && ['merge-tree', 'github-mergeable'].includes(queue.proofSource) && queue.headSha === head && sha(queue.baseSha) === sha(pr.base?.sha) && sha(queue.baseSha)) { reflect(owner.kind === 'triage' ? 'unknown' : 'action'); evidence.nextStep = 'resolve_verified_conflict'; }
    else { policy.disposition = 'routine'; evidence.nextStep = queue.advisoryOverlap ? 'verify_overlap_before_claiming_conflict' : 'observe_queue_state'; if (state.threadExists) reflect('routine'); }
  } else if (['failure', 'timed_out', 'action_required', 'startup_failure'].includes(event.state)) {
    const contexts = requiredContexts(ruleset), required = contexts && requiredCheck && contexts.some(c => c.context === requiredCheck.name && (!c.app || c.app === id(requiredCheck.appId)));
    evidence.requiredScope = contexts === null ? 'unreadable' : required ? 'required' : 'advisory_or_unmapped';
    if (contexts === null) { reflect('unknown'); evidence.nextStep = 'read_live_required_rules'; }
    else if (required) {
      state.actionType = 'ci';
      const d = digestAuthority(digestEnvelope, event, head);
      const exact = requiredCheck.headSha === head && String(requiredCheck.runId) === event.ids?.run && String(requiredCheck.attempt) === event.ids?.attempt && ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(requiredCheck.conclusion);
      if (!d || !exact) { reflect('unknown'); evidence.nextStep = 'read_exact_digest_and_attempt'; evidence.cause = 'unknown'; }
      else if (['inherited_main_failure', 'infra_failure'].includes(d.verdict)) {
        const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/([1-9]\d*)$/.exec(d.incident || '');
        const verified = incident?.verified === true && match?.[1] === event.repository && String(incident.number) === match?.[2] && ['main-red', 'queue', 'queue-stalled', 'review-blocked', 'future-clock'].includes(incident.kind);
        policy.role = 'prs'; policy.disposition = 'shared'; policy.material = false;
        evidence.cause = d.verdict; evidence.incidentIssue = verified ? Number(incident.number) : null; evidence.nextStep = verified ? 'follow_shared_incident' : 'locate_existing_health_episode';
        policy.incidentIssue = evidence.incidentIssue;
      } else if (d.verdict === 'pr_failure') {
        state.lastCI = { run: event.ids.run, attempt: event.ids.attempt };
        const changed = d.fingerprint !== previousCurrent?.fingerprint || owner.key !== previous?.owner || previousCurrent?.disposition !== 'action';
        if (changed) reflect(owner.kind === 'triage' ? 'unknown' : 'action'); else { policy.role = 'prs'; policy.disposition = previousCurrent.disposition; }
        evidence.cause = digestEnvelope.mixed === true ? 'mixed_pr_and_shared' : 'pr_failure'; evidence.nextStep = d.failures?.some(f => f.flaky) ? 'inspect_flaky_attempt_evidence' : 'read_pr_owned_digest'; state.fingerprint = d.fingerprint;
      } else { reflect('unknown'); evidence.cause = 'main_health_unknown'; evidence.nextStep = 'read_exact_digest_and_attempt'; }
    }
  } else if (event.family === 'ci') {
    const contexts = requiredContexts(ruleset);
    const green = contexts?.length > 0 && checkSnapshot?.verified === true && checkSnapshot.headSha === head && String(checkSnapshot.runId) === event.ids?.run && String(checkSnapshot.attempt) === event.ids?.attempt && contexts.every(c => checkSnapshot.checks?.some(k => k.name === c.context && (!c.app || id(k.appId) === c.app) && k.conclusion === 'success'));
    if (green && id(event.ids?.run) && id(event.ids?.attempt)) {
      state.lastCI = { run: event.ids.run, attempt: event.ids.attempt };
      if (state.threadExists && previousCurrent?.actionType === 'ci') reflect('recovery');
      state.fingerprint = null;
    }
  } else if (state.threadExists && event.family === 'work') { reflect('routine'); }

  // The reviewer/claim/CI authorities are untouched; this is only a presentation hint.
  if (allowMentions && policy.disposition === 'action' && owner.kind !== 'triage') {
    const reviewTarget = evidence.nextStep === 'read_review_request' && policy.githubReviewers?.length === 1 ? policy.githubReviewers[0] : null;
    const key = reviewTarget ? `github:${reviewTarget}` : owner.kind === 'slot' ? `slot:${owner.slot}` : `github:${owner.login}`;
    if (/^(?:U|S)[A-Z0-9]{2,30}$/.test(mentionMap[key] || '')) policy.mentionKey = key;
  }
  return { policy, evidence, state };
}
export class RoutingHistory {
  constructor(store) { this.store = store; }
  async observe(input) {
    const key = `routing:v1:${input.event.repository}:pr:${input.pr?.number || 'unmapped'}`;
    if (typeof this.store.withLock !== 'function') throw new Error('serialized_routing_store_required');
    return this.store.withLock(key, async () => {
      const previous = await this.store.get(key), eventKey = `${key}:event:${input.event.key}`;
      const known = await this.store.get(eventKey);
      if (known) return { ...known, state: previous, replayed: true };
      const result = routeObservation({ ...input, previous });
      // These writes address only the metadata ledger, never GitHub or claims.
      if (typeof this.store.commit !== 'function') throw new Error('atomic_routing_store_required');
      await this.store.commit(eventKey, key, { schema: 1, policy: result.policy, evidence: result.evidence, state: result.state });
      return result;
    });
  }
}
