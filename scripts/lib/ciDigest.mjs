/** D5619: a stable, bounded digest of ciClassify's verdict; never classifies failures itself. */
import { createHash } from 'node:crypto';
import { safeJobName, safeGithubUrl, VERDICTS } from './ciClassify.mjs';
export const MARKER = '<!-- studioos-ci-digest:v1 -->';
const cut = value => String(value ?? '').slice(0, 300);
function jobUrl(value) {
  if (typeof value !== 'string') return null;
  const match = /^(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+)(\/job\/\d+)?$/.exec(value);
  return match && safeGithubUrl(match[1]) ? value : null;
}
export function digest({ classification, jobs = [], artifact = null, headSha, attempts = [] }) {
  if (!classification || !VERDICTS.includes(classification.verdict)) throw new Error('unsupported classification verdict');
  if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error('invalid head SHA');
  const details = artifact && (!artifact.headSha || artifact.headSha === headSha) && Array.isArray(artifact.failures) ? artifact.failures : [];
  const failures = jobs.filter(j => ['failure','timed_out'].includes(j.conclusion) && j.name !== 'test:drift (full suite)').map(job => {
    const name = safeJobName(job.name) || '(unreadable job)';
    const detail = details.find(f => f.job === job.name);
    const step = safeJobName(job.steps?.find(s => ['failure','timed_out'].includes(s.conclusion))?.name) || '(step unavailable)';
    return { name, step, url: jobUrl(job.html_url), id: typeof detail?.id === 'string' && /^[\w:./-]{1,200}$/.test(detail.id) ? detail.id : name,
      flaky: attempts.some(a => a.headSha === headSha && a.jobs?.some(j => j.name === job.name && j.conclusion === 'success')),
      detail: detail ? cut([...(Array.isArray(detail.testNames) ? detail.testNames : []), detail.excerpt ?? '', detail.repro ?? ''].join('\n')) : null };
  });
  const fingerprint = createHash('sha256').update(JSON.stringify([classification.verdict, [...new Set(failures.map(f => f.id))].sort()])).digest('hex');
  const inherited = ['inherited_main_failure','infra_failure'].includes(classification.verdict);
  const incident = safeGithubUrl(classification.incident);
  return { verdict: classification.verdict, failures, fingerprint, headSha, count: 1,
    repro: details.map(f => cut(f.repro)).filter(Boolean), incident,
    dont: inherited ? ['Do not merge main.', 'Do not port a fix.', 'Do not re-run CI.'] : [] };
}
export function fence(value) {
  const text = String(value);
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(m => m[0].length));
  const delimiter = '`'.repeat(longest + 1);
  return `${delimiter}text\n${text}\n${delimiter}`;
}
export function render(d) {
  const meta = { verdict: d.verdict, fingerprint: d.fingerprint, headSha: d.headSha, digestCount: d.count };
  return `${MARKER}\n\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\`\n\n### CI failure digest\n\n`
    + d.failures.map(f => `- ${f.url ? `[${f.name}](${f.url})` : f.name}: ${f.step}${f.flaky ? ' (flaky: passed in another attempt on this head)' : ''}${f.detail ? '\n\n' + fence(f.detail) : ''}`).join('\n')
    + (d.dont.length ? '\n\n' + d.dont.join(' ') + (d.incident ? ` Follow the [incident](${d.incident}).` : ' The incident link is unavailable.') : '')
    + '\n\nVerdict supplied by ciClassify; inherited job failures can still hide PR-specific failures.';
}
