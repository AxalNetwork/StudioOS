// D5665: typed metadata-only Slack presentation. Untrusted GitHub labels never choose severity, destination or mention.
const roles = ['activity', 'prs', 'health', 'releases', 'security'];
const classes = ['work', 'ci', 'delivery', 'security', 'unsupported', 'health'];
const states = ['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure', 'queued', 'waiting', 'requested', 'in_progress', 'pending', 'open', 'closed', 'merged', 'approved', 'changes_requested', 'dismissed', 'commented', 'ready_for_review', 'synchronize', 'pushed', 'unknown', 'recovery'];
const identifier = value => /^[1-9]\d{0,18}$/.test(String(value ?? '')) ? String(value) : null;
export const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const safeLabel = value => typeof value === 'string' && /^[A-Za-z0-9_ .:/()[\]-]{1,80}$/.test(value) ? escape(value) : null;
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
  for (const name of ['run', 'attempt', 'job', 'check', 'issue']) ids[name] = identifier(event.ids?.[name]);
  ids.prs = [...new Set((event.ids?.prs || []).map(identifier).filter(Boolean))].slice(0, 100);
  const role = policy.role, slot = /^S\d{2,3}$/.test(policy.slot || '') ? policy.slot : null;
  const subject = typeof policy.subject === 'string' && /^(?:pr:[1-9]\d*|incident:[1-9]\d*|release:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+)$/.test(policy.subject) ? policy.subject : null;
  if (policy.material && !subject) throw new Error('subject_invalid');
  const sha = /^[a-f0-9]{40}$/.test(event.refs?.head || '') ? event.refs.head : /^[a-f0-9]{40}$/.test(event.refs?.runHead || '') ? event.refs.runHead : null;
  const labels = (event.labels || []).slice(0, 20).map(safeLabel).filter(Boolean);
  const gaps = (event.gaps || []).filter(x => typeof x === 'string' && /^[a-z_]{1,80}$/.test(x)).slice(0, 10);
  // Mentions require an explicit trusted policy and owner mapping, never a label, branch or display name.
  const mentionKey = typeof policy.mentionKey === 'string' && /^[a-zA-Z0-9:_-]{1,80}$/.test(policy.mentionKey) ? policy.mentionKey : null;
  return { schema: 1, key: event.key, repository: event.repository, family: event.family, state: event.state, observedAt: new Date(event.observedAt).toISOString(), visibility: event.visibility, ids, sha, labels, gaps, role, slot, subject, disposition: policy.disposition, material: policy.material, revision: Number.isSafeInteger(policy.revision) ? policy.revision : Date.parse(event.observedAt), mentionKey };
}
export function row(item) {
  const root = `https://github.com/${item.repository}`;
  const link = item.ids.job && item.ids.run ? `${root}/actions/runs/${item.ids.run}/job/${item.ids.job}` : item.ids.run ? `${root}/actions/runs/${item.ids.run}` : item.ids.prs[0] ? `${root}/pull/${item.ids.prs[0]}` : item.ids.issue ? `${root}/issues/${item.ids.issue}` : root;
  const ids = [item.ids.prs.length ? `PR:${item.ids.prs.join(',')}` : '', item.ids.run ? `run:${item.ids.run}` : '', item.ids.attempt ? `attempt:${item.ids.attempt}` : '', item.ids.job ? `job:${item.ids.job}` : '', item.ids.check ? `check:${item.ids.check}` : '', item.sha ? `head:${item.sha.slice(0, 12)}` : ''].filter(Boolean).join(' ');
  const kind = item.family === 'work' ? 'pr' : item.family;
  return `[${kind}] [${item.disposition}] [${item.state}]${item.slot ? ` [slot:${item.slot}]` : ''} ${ids} <${link}|source> event:${item.key.slice(0, 16)}${item.labels.length ? ` labels:${item.labels.map(x => `“${x}”`).join(',')}` : ''}${item.gaps.length ? ` missing:${item.gaps.join(',')}` : ''}`;
}
export function pages(items, max = 2800) {
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
