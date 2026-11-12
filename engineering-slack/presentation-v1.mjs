// D5665: typed metadata-only Slack presentation. Untrusted GitHub labels never choose severity, destination or mention.
const roles = ['activity', 'prs', 'health', 'releases', 'security'];
const classes = ['work', 'ci', 'delivery', 'security', 'unsupported', 'health'];
const states = ['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure', 'queued', 'waiting', 'requested', 'in_progress', 'pending', 'open', 'closed', 'merged', 'approved', 'changes_requested', 'dismissed', 'commented', 'ready_for_review', 'synchronize', 'pushed', 'unknown', 'recovery'];
const identifier = value => /^[1-9]\d{0,18}$/.test(String(value ?? '')) ? String(value) : null;
// Slack code fragments admit a fixed alphabet; raw markup and URLs are rejected before storage.
const safeLabel = value => typeof value === 'string' && !/:\/\//.test(value) && !/(?:gh[pousr]_|github_pat_|xox[baprs]-|sk_(?:live|test)_|sk-proj-|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)/i.test(value) && /^[A-Za-z0-9_ .:/()[\]-]{1,80}$/.test(value) ? value : null;
const NEXT_STEPS = {
  read_review_request: 'Review requested on GitHub', read_requested_changes: 'Read requested changes',
  observe_landed_sha_and_deploy_separately: 'Verify landed SHA and deploy separately', closed_without_merge: 'Closed without merge',
  confirm_queue_membership: 'Confirm queue membership', resolve_verified_conflict: 'Resolve verified conflict',
  verify_overlap_before_claiming_conflict: 'Verify overlap evidence', observe_queue_state: 'Observe queue state',
  read_live_required_rules: 'Read current required rules', read_exact_digest_and_attempt: 'Read exact CI digest and attempt',
  follow_shared_incident: 'Follow shared incident', locate_existing_health_episode: 'Locate health episode',
  inspect_flaky_attempt_evidence: 'Inspect flaky attempt evidence', read_pr_owned_digest: 'Read PR-owned CI digest',
};
const CAUSES = { mixed_pr_and_shared: 'mixed PR and shared failure', main_health_unknown: 'main health unknown', pr_failure: 'PR failure', inherited_main_failure: 'inherited main failure', infra_failure: 'shared infrastructure failure' };
export function registryOf(input) {
  if (input?.schema !== 1 || input.reviewedBy !== 'guillaumelauzier' || !/^T[A-Z0-9]{2,30}$/.test(input.teamId || '') || !Number.isFinite(Date.parse(input.approvedAt)) || !Number.isSafeInteger(input.version) || input.version < 1) throw new Error('registry_unapproved');
  const channels = {};
  for (const [role, value] of Object.entries(input.channels || {})) {
    if (!roles.includes(role) || !/^[CG][A-Z0-9]{2,30}$/.test(value.id || '') || typeof value.private !== 'boolean' || typeof value.enabled !== 'boolean' || !Number.isInteger(value.retentionDays) || value.retentionDays < 1 || value.retentionDays > 3650 || value.publisher !== 'internal-bot') throw new Error('registry_channel_invalid');
    if (role === 'security' && !value.private) throw new Error('security_destination_public');
    channels[role] = { ...value };
  }
  if (new Set(Object.values(channels).map(c => c.id)).size !== Object.values(channels).length) throw new Error('duplicate_route_publisher');
  return { ...input, channels };
}
export function prepare(event, policy = { schema: 1, role: 'activity', disposition: 'routine', material: false }) {
  if (event?.schema !== 1 || !/^[a-f0-9]{64}$/.test(event.key || '') || !/^[\w.-]+\/[\w.-]+$/.test(event.repository || '') || !classes.includes(event.family) || !states.includes(event.state) || !['public', 'restricted'].includes(event.visibility) || event.family === 'security' && event.visibility !== 'restricted' || !Number.isFinite(Date.parse(event.observedAt))) throw new Error('event_invalid');
  if (policy.schema !== 1 || !roles.includes(policy.role) || !['routine', 'action', 'shared', 'unknown', 'recovery'].includes(policy.disposition) || typeof policy.material !== 'boolean') throw new Error('routing_policy_invalid');
  if ((event.visibility === 'restricted' || event.family === 'security') && policy.role !== 'security') throw new Error('restricted_route_refused');
  const ids = {};
  for (const name of ['run', 'attempt', 'job', 'check', 'workflow', 'issue', 'release', 'deployment', 'comment', 'review', 'thread']) ids[name] = identifier(event.ids?.[name]) || (name === 'thread' && /^[A-Za-z][A-Za-z0-9_-]{1,119}$/.test(event.ids?.[name] || '') ? event.ids[name] : null);
  ids.prs = [...new Set((event.ids?.prs || []).map(identifier).filter(Boolean))].slice(0, 100);
  if (/^pr:[1-9]\d*$/.test(policy.subject || '')) ids.prs = [...new Set([...ids.prs, policy.subject.slice(3)])];
  const role = policy.role, slot = /^S\d{2,3}$/.test(policy.slot || '') ? policy.slot : null;
  const subject = typeof policy.subject === 'string' && /^(?:pr:[1-9]\d*|incident:[1-9]\d*|release:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+)$/.test(policy.subject) ? policy.subject : null;
  if (policy.material && !subject) throw new Error('subject_invalid');
  const shas = [['head', event.refs?.head], ['run-head', event.refs?.runHead], ['tested', event.refs?.tested], ['candidate', event.refs?.candidate], ['landed', event.refs?.landed], ['deployment-target', event.refs?.deploymentTarget]].filter(([, value]) => /^[a-f0-9]{40}$/.test(value || ''));
  const [shaRole, sha] = shas[0] || [null, null];
  const testedSha = shas.find(([role]) => role === 'tested')?.[1] || sha;
  const sourceId = /^[A-Za-z0-9_.:/-]{1,150}$/.test(event.subject?.id || '') ? event.subject.id : null;
  const sourceKind = /^[a-z_-]{1,60}$/.test(event.kind || '') ? event.kind : event.family;
  const labels = (event.labels || []).slice(0, 20).map(safeLabel).filter(Boolean);
  const gaps = (event.gaps || []).filter(x => typeof x === 'string' && /^[a-z_]{1,80}$/.test(x)).slice(0, 10);
  // Mentions require an explicit trusted policy and owner mapping, never a label, branch or display name.
  const incidentIssue = identifier(policy.incidentIssue);
  const githubReviewers = (policy.githubReviewers || []).filter(x => typeof x === 'string' && /^[a-zA-Z0-9-]{1,39}(?:\[bot\])?$/.test(x)).slice(0, 20);
  const sourceGap = event.kind === 'source_gap' && /^[a-zA-Z0-9_:/.-]{1,180}$/.test(event.sourceGap?.scope || '') && Number.isFinite(event.sourceGap?.from) && Number.isFinite(event.sourceGap?.to) ? { scope: event.sourceGap.scope, from: new Date(event.sourceGap.from).toISOString(), to: new Date(event.sourceGap.to).toISOString() } : null;
  const githubOwner = typeof policy.githubOwner === 'string' && /^[a-zA-Z0-9-]{1,39}(?:\[bot\])?$/.test(policy.githubOwner) ? policy.githubOwner : null;
  const nextStep = Object.hasOwn(NEXT_STEPS, policy.nextStep) ? NEXT_STEPS[policy.nextStep] : null;
  const cause = Object.hasOwn(CAUSES, policy.cause) ? CAUSES[policy.cause] : null;
  const mentionKey = typeof policy.mentionKey === 'string' && /^[a-zA-Z0-9:_-]{1,80}$/.test(policy.mentionKey) ? policy.mentionKey : null;
  return { schema: 1, key: event.key, repository: event.repository, family: event.family, state: event.state, observedAt: new Date(event.observedAt).toISOString(), visibility: event.visibility, ids, sha, shaRole, shas, testedSha, sourceId, sourceKind, sourceGap, labels, gaps, role, slot, subject, disposition: policy.disposition, material: policy.material, incidentIssue, githubReviewers, githubOwner, nextStep, cause, revision: Number.isSafeInteger(policy.revision) ? policy.revision : Date.parse(event.observedAt), mentionKey };
}
export function row(item) {
  const root = `https://github.com/${item.repository}`;
  const testedSha = item.testedSha || item.sha;
  const link = item.ids.job && item.ids.run ? `${root}/actions/runs/${item.ids.run}/job/${item.ids.job}` : item.ids.run ? `${root}/actions/runs/${item.ids.run}` : item.ids.check && testedSha ? `${root}/commit/${testedSha}/checks?check_run_id=${item.ids.check}` : item.ids.prs[0] ? `${root}/pull/${item.ids.prs[0]}` : item.ids.deployment ? `https://api.github.com/repos/${item.repository}/deployments/${item.ids.deployment}` : item.ids.release ? `https://api.github.com/repos/${item.repository}/releases/${item.ids.release}` : item.ids.issue ? `${root}/issues/${item.ids.issue}` : root;
  const shaText = (item.shas || (item.sha ? [[item.shaRole, item.sha]] : [])).map(([role, value]) => `${role}:${value.slice(0, 12)}`).join(' ');
  const ids = [item.sourceId ? '`source:' + item.sourceKind + ':' + item.sourceId + '`' : '', ...['workflow','release','deployment','comment','review','thread'].filter(k => item.ids[k]).map(k => `${k}:${item.ids[k]}`), item.ids.prs.length ? `PR:${item.ids.prs.join(',')}` : '', item.ids.run ? `run:${item.ids.run}` : '', item.ids.attempt ? `attempt:${item.ids.attempt}` : '', item.ids.job ? `job:${item.ids.job}` : '', item.ids.check ? `check:${item.ids.check}` : '', shaText].filter(Boolean).join(' ');
  const kind = item.family === 'work' ? 'pr' : item.family;
  return `[${kind}] [${item.disposition}] [${item.state}]${item.slot ? ` [slot:${item.slot}]` : ''} ${ids} <${link}|source> event:${item.key.slice(0, 16)}${item.githubOwner ? ` owner:github:${item.githubOwner}` : ''}${item.nextStep ? ` next:${item.nextStep}` : ''}${item.cause ? ` cause:${item.cause}` : ''}${item.sourceGap ? ' `gap:' + item.sourceGap.scope + ':' + item.sourceGap.from + '..' + item.sourceGap.to + '`' : ''}${item.incidentIssue ? ` <${root}/issues/${item.incidentIssue}|shared incident>` : ''}${item.githubReviewers?.length ? ` requested:${item.githubReviewers.join(',')}` : ''}${item.labels.length ? ` labels:${item.labels.map(x => '`' + x + '`').join(',')}` : ''}${item.gaps.length ? ` missing:${item.gaps.join(',')}` : ''}`;
}
export function pages(items, max = 8000) {
  const out = []; let lines = [], size = 0;
  for (const item of items) { const line = row(item); if (line.length > max) throw new Error('item_too_large'); if (size + line.length + 1 > max && lines.length) { out.push(lines.join('\n')); lines = []; size = 0; } lines.push(line); size += line.length + 1; }
  if (lines.length) out.push(lines.join('\n')); return out;
}
export function mentionFor(item, registry) {
  if (item.disposition !== 'action' || !item.mentionKey) return '';
  const target = registry.mentions?.[item.mentionKey];
  if (/^U[A-Z0-9]{2,30}$/.test(target || '')) return `<@${target}>`;
  if (/^S[A-Z0-9]{2,30}$/.test(target || '')) return `<!subteam^${target}>`;
  return '';
}
