// D5664: allowlisted metadata-only event contract shared by capture, delivery and observational routing.
export const CONTRACT_VERSION = 1;
const id = value => /^[1-9]\d{0,18}$/.test(String(value ?? '')) ? String(value) : null;
const opaque = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{1,119}$/.test(value) ? value : null;
const secretLike = value => /(?:gh[pousr]_|github_pat_|xox[baprs]-|sk_(?:live|test)_|sk-proj-|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)/i.test(value);
const token = value => typeof value === 'string' && !secretLike(value) && /^[A-Za-z0-9_ ↔.:/()[\]-]{1,120}$/.test(value) ? value : null;
const sha = value => /^[a-f0-9]{40}$/.test(value || '') ? value : null;
const login = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,39}(?:\[bot\])?$/.test(value) ? value : null;
const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const SECURITY_EVENTS = ['code_scanning_alert', 'secret_scanning_alert', 'secret_scanning_alert_location', 'dependabot_alert', 'repository_vulnerability_alert'];
export const EVENT_FAMILIES = {
  work: ['pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_review_thread', 'issues', 'issue_comment', 'claim'],
  ci: ['workflow_run', 'workflow_job', 'check_run', 'check_suite', 'status'],
  delivery: ['merge_group', 'push', 'create', 'delete', 'release', 'deployment', 'deployment_status', 'deployment_review', 'deployment_protection_rule'],
  security: SECURITY_EVENTS,
};
export const DEFAULT_EVENTS = Object.values(EVENT_FAMILIES).flat();
const terminals = new Set(['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure']);
export const terminalAttempt = event => event.family === 'ci' && ['workflow_run', 'workflow_job'].includes(event.kind)
  && Boolean(id(event.ids?.run) && id(event.ids?.attempt) && (event.kind === 'workflow_run' || id(event.ids?.job))) && terminals.has(event.state);
export async function eventKey(event) {
  const { deliveryId, observedAt, source, sourceVersion, redactions, key, action, ...semantic } = event;
  if (event.family !== 'ci') semantic.action = action;
  // Run-list and attempt endpoints can disagree on updated_at for the same terminal result.
  // Keep the first source timestamp in the immutable record, without treating that jitter as a new transition.
  if (terminalAttempt(event)) {
    delete semantic.occurredAt;
    delete semantic.timeConfidence;
  }
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(semantic)));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function normalizeEvent({ kind, deliveryId, payload: p, observedAt = new Date().toISOString(), source = 'github-webhook', securityApproved = false }) {
  if (!/^[a-z_]{1,60}$/.test(kind) || !/^[A-Za-z0-9:._-]{1,180}$/.test(deliveryId || '') || !p?.repository || !id(p.repository.id)) throw new Error('event_identity_invalid');
  if (SECURITY_EVENTS.includes(kind) && !securityApproved) throw new Error('security_boundary_unapproved');
  const repo = p.repository.full_name;
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('repository_invalid');
  const family = Object.entries(EVENT_FAMILIES).find(([, kinds]) => kinds.includes(kind))?.[0] || 'unsupported';
  const pr = p.pull_request, run = p.workflow_run, job = p.workflow_job, check = p.check_run || p.check_suite;
  const object = p.claim || job || run || check || p.comment || p.review || p.thread || p.issue_event || p.deployment_status || p.deployment || p.release || p.merge_group || pr || p.issue || p.alert || p;
  const labels = (pr?.labels || p.issue?.labels || p.labels || []).slice(0, 200).map(l => token(typeof l === 'string' ? l : l.name)).filter(Boolean).sort();
  const occurrence = time(object.updated_at) || time(object.submitted_at) || time(object.published_at) || time(object.completed_at) || time(object.created_at) || time(p.head_commit?.timestamp);
  const rawState = token(object.conclusion || object.status || object.state || p.action || (kind === 'push' ? 'pushed' : null));
  const state = terminals.has(rawState) ? rawState : ['queued', 'waiting', 'requested', 'in_progress', 'pending', 'open', 'closed', 'merged', 'approved', 'changes_requested', 'dismissed', 'commented', 'ready_for_review', 'synchronize', 'pushed'].includes(rawState) ? rawState : 'unknown';
  const prs = [...new Set([pr?.number, p.issue?.pull_request ? p.issue.number : null, ...(run?.pull_requests || job?.pull_requests || check?.pull_requests || []).map(x => x.number)].map(id).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  const issueId = id(p.issue?.number || p.claim?.issue), prId = id(pr?.number);
  const subjectType = p.claim ? 'claim' : p.comment ? 'comment' : p.review ? 'review' : p.thread ? 'review-thread' : job ? 'job' : run ? 'run' : check ? 'check' : prId ? 'pr' : issueId ? 'issue' : kind;
  const subjectId = id(object.id) || (p.thread ? opaque(p.thread.id || p.thread.node_id) : null) || prId || issueId || sha(p.after) || token(p.ref) || id(p.repository.id);
  const event = {
    schema: 1, repositoryId: id(p.repository.id), repository: repo,
    deliveryId, source, sourceVersion: 1, kind, family,
    action: token(p.action), rawState, state,
    occurredAt: occurrence || time(observedAt), observedAt: time(observedAt), timeConfidence: occurrence ? 'source' : 'observed',
    subject: { type: subjectType, id: subjectId },
    ids: { run: id(run?.id || job?.run_id), attempt: id(run?.run_attempt || job?.run_attempt), job: id(job?.id), check: id(check?.id), workflow: id(run?.workflow_id), comment: id(p.comment?.id), review: id(p.review?.id), thread: id(p.thread?.id) || opaque(p.thread?.id || p.thread?.node_id), release: id(p.release?.id), deployment: id(p.deployment?.id), issue: issueId, prs },
    refs: { ref: token(p.ref || run?.head_branch || job?.head_branch), base: token(pr?.base?.ref || p.merge_group?.base_ref), head: sha(pr?.head?.sha), reviewed: sha(p.review?.commit_id), runHead: sha(run?.head_sha || job?.head_sha), tested: sha(check?.head_sha || (kind === 'status' && p.sha)), candidate: sha(p.merge_group?.head_sha || (!(pr?.merged || pr?.merged_at) && pr?.merge_commit_sha)), landed: sha(((pr?.merged || pr?.merged_at) && pr.merge_commit_sha) || (kind === 'push' && p.ref === 'refs/heads/main' && p.after)), baseSha: sha(pr?.base?.sha || p.merge_group?.base_sha), deploymentTarget: sha(p.deployment?.sha) },
    draft: typeof pr?.draft === 'boolean' ? pr.draft : null, merged: pr ? pr.merged === true || Boolean(pr.merged_at) : null,
    conversation: { id: id(p.thread?.id) || opaque(p.thread?.id || p.thread?.node_id), resolved: typeof p.thread?.is_resolved === 'boolean' ? p.thread.is_resolved : null },
    checkContext: token(check?.name || p.context),
    environment: token(p.deployment?.environment || p.deployment_status?.environment),
    visibility: family === 'security' || p.repository.private !== false ? 'restricted' : 'public',
    provider: { id: id(check?.app?.id), slug: token(check?.app?.slug) },
    ownership: p.claim ? { issue: id(p.claim.issue), slot: token(p.claim.slot), session: token(p.claim.session), state: token(p.claim.state), expiresAt: time(p.claim.expiresAt) } : null,
    labels, actor: login(p.sender?.login), author: login(pr?.user?.login),
    reviewers: (pr?.requested_reviewers || []).map(r => login(r.login)).filter(Boolean).sort(),
    steps: (job?.steps || []).slice(0, 200).map(s => ({ number: id(s.number), name: token(s.name), status: token(s.status), conclusion: token(s.conclusion) })),
    redactions: ['bodies', 'titles', 'logs', 'diffs', 'finding_contents', 'arbitrary_urls'],
    gaps: [...(family === 'unsupported' ? ['unsupported_event_kind'] : []), ...(!occurrence ? ['occurrence_time_unknown'] : []), ...(job && !id(job.run_attempt) ? ['job_attempt_unknown'] : [])],
  };
  if (!event.observedAt) throw new Error('event_time_invalid');
  event.key = await eventKey(event); return event;
}
export function validateEvent(event) {
  const keys = (object, allowed) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).every(k => allowed.includes(k));
  const top = ['schema', 'repositoryId', 'repository', 'deliveryId', 'source', 'sourceVersion', 'kind', 'family', 'action', 'rawState', 'state', 'occurredAt', 'observedAt', 'timeConfidence', 'subject', 'ids', 'refs', 'draft', 'merged', 'conversation', 'checkContext', 'environment', 'visibility', 'labels', 'provider', 'ownership', 'actor', 'author', 'reviewers', 'steps', 'redactions', 'gaps', 'sourceGap', 'key'];
  if (!keys(event, top) || event.schema !== 1 || event.sourceVersion !== 1 || !['github-webhook', 'github-rest', 'merge-control-readonly'].includes(event.source)
      || !/^[a-f0-9]{64}$/.test(event.key || '') || !id(event.repositoryId) || !/^[A-Za-z0-9:._-]{1,180}$/.test(event.deliveryId || '') || !/^[\w.-]+\/[\w.-]+$/.test(event.repository || '')
      || (!EVENT_FAMILIES[event.family] && event.family !== 'unsupported') || !['public', 'restricted'].includes(event.visibility) || event.family === 'security' && event.visibility !== 'restricted'
      || !time(event.observedAt) || !time(event.occurredAt) || !keys(event.subject, ['type', 'id']) || !token(event.subject.type) || !token(event.subject.id)
      || !keys(event.ids, ['run', 'attempt', 'job', 'check', 'workflow', 'comment', 'review', 'thread', 'release', 'deployment', 'issue', 'prs']) || !Object.entries(event.ids).every(([k, v]) => k === 'prs' ? Array.isArray(v) && v.every(id) : v === null || id(v) || k === 'thread' && opaque(v))
      || !keys(event.refs, ['ref', 'base', 'head', 'reviewed', 'runHead', 'tested', 'candidate', 'landed', 'baseSha', 'deploymentTarget']) || !Object.values(event.refs).every(v => v === null || token(v))
      || !keys(event.conversation, ['id', 'resolved']) || ![null, true, false].includes(event.draft) || ![null, true, false].includes(event.merged)
      || !(event.conversation.id === null || id(event.conversation.id) || opaque(event.conversation.id)) || ![null, true, false].includes(event.conversation.resolved)
      || event.sourceGap !== undefined && (!keys(event.sourceGap, ['scope', 'from', 'to']) || !/^[a-zA-Z0-9_:/.-]{1,180}$/.test(event.sourceGap.scope || '') || !Number.isFinite(event.sourceGap.from) || !Number.isFinite(event.sourceGap.to))
      || !keys(event.provider, ['id', 'slug']) || !(event.provider.id === null || id(event.provider.id)) || !(event.provider.slug === null || token(event.provider.slug)) || !Array.isArray(event.labels) || event.labels.length > 200 || !event.labels.every(token)
      || !Array.isArray(event.reviewers) || !event.reviewers.every(login) || !Array.isArray(event.steps) || !event.steps.every(s => keys(s, ['number', 'name', 'status', 'conclusion']) && Object.values(s).every(v => v === null || token(String(v))))
      || event.ownership !== null && (!keys(event.ownership, ['issue', 'slot', 'session', 'state', 'expiresAt']) || !(event.ownership.issue === null || id(event.ownership.issue)) || !['slot', 'session', 'state'].every(k => event.ownership[k] === null || token(event.ownership[k])) || !(event.ownership.expiresAt === null || time(event.ownership.expiresAt)))
      || !Array.isArray(event.gaps) || !event.gaps.every(token) || !Array.isArray(event.redactions) || !event.redactions.every(token)
      || !['action', 'rawState', 'state', 'kind', 'checkContext', 'environment'].every(k => event[k] === null || token(event[k])) || !['actor', 'author'].every(k => event[k] === null || login(event[k]))) throw new Error('canonical_event_invalid');
  return event;
}
