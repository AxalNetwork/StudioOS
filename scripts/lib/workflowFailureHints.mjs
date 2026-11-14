// D6387: positive evidence for benign release supersession and failures already owned by an open issue.
import catalog from '../../engineering-notifications/workflow-channels.json' with { type: 'json' };
import { recoveredOperatorMain } from '../health-alert-episodes.mjs';
import { classify } from './ciClassify.mjs';
import { ALERT_KINDS, mainState } from './githubAlerts.mjs';

const files = new Map(catalog.workflows.map(row => [row.id, row.path]));
const positive = value => Number.isSafeInteger(value) && value > 0;
const bad = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const owner = 'guillaumelauzier';
const rules = {
  'cloudflare-worker-deploy': { job: 'Verify the exact main candidate', step: 'Wait for all six required checks',
    events: ['push', 'workflow_dispatch'], annotation: ['StudioOS release admission', 'superseded'] },
  'magic-link-probe': { job: 'magic-link round trip', step: 'Report the outcome', events: ['schedule', 'workflow_dispatch'],
    annotation: ['StudioOS auth probe', 'edge-refused'], issue: 1008 },
  'magic-link-insert-probe': { job: 'magic-link insert', step: 'Report the outcome', events: ['schedule', 'workflow_dispatch'],
    annotation: ['StudioOS auth probe', 'edge-refused'], issue: 1008 },
  'claude-code': { job: 'claude', step: 'Verify ANTHROPIC_API_KEY is configured', issue: 5530,
    events: ['issue_comment', 'issues', 'workflow_dispatch'] },
  'meeting-bot-deploy': { job: 'deploy', step: 'Validate owner-approved preview configuration before deployment',
    issue: 5675, events: ['push', 'workflow_dispatch'] },
};
const titles = {
  1008: 'Owner actions: one current list (backups, live checks, channels, connectors, AI packs, and your calls)',
  5530: 'Resolve the Claude Code mention workflow’s authentication failure',
  5675: 'Verify preview meeting-bot callbacks and isolate preview Slack alerts before production promotion',
};
const boundJob = (job, run) => positive(job?.id) && job.run_id === run.id && job.run_attempt === run.run_attempt
  && job.head_sha === run.head_sha && job.head_branch === run.head_branch;
const validIssue = issue => issue?.state === 'open' && !issue.pull_request && positive(issue.number)
  && [owner, 'github-actions[bot]'].includes(issue.user?.login);

async function confirmedOccurrence(api, root, run, jobs, rule) {
  if (run.head_branch !== 'main' || !rule.events.includes(run.event) || run.conclusion !== 'failure') return {};
  const failed = jobs.filter(job => bad.has(job.conclusion));
  if (failed.length !== 1 || failed[0].name !== rule.job || failed[0].conclusion !== 'failure') return {};
  const job = failed[0];
  const steps = (job.steps || []).filter(step => bad.has(step.conclusion));
  if (steps.length !== 1 || steps[0].name !== rule.step || steps[0].conclusion !== 'failure') return {};
  if (rule.annotation) {
    if (job.check_run_url !== 'https://api.github.com' + root + '/check-runs/' + job.id) return {};
    // Read this single attempt-bound trusted main job. Unknown/absent annotations leave the failure actionable.
    const annotations = await api(root + '/check-runs/' + job.id + '/annotations?per_page=100');
    const [title, message] = rule.annotation;
    if (!Array.isArray(annotations) || !annotations.some(a => a.annotation_level === 'notice' &&
        a.title === title && a.message === message)) return {};
  }
  if (!rule.issue) return { superseded: true };
  const issue = await api(root + '/issues/' + rule.issue);
  return validIssue(issue) && issue.number === rule.issue && issue.user.login === owner && issue.title === titles[rule.issue]
    ? { existingIssueNumber: rule.issue } : {};
}

async function testedBase(api, root, run) {
  if (run.event === 'pull_request') {
    const base = run.pull_requests?.length === 1 && run.pull_requests[0].base;
    return base?.ref === 'main' && base.repo?.url === 'https://api.github.com' + root && sha(base.sha) ? base.sha : null;
  }
  if (run.event !== 'merge_group') return null;
  const match = /^gh-readonly-queue\/main\/pr-[1-9]\d*-([a-f0-9]{40})$/.exec(run.head_branch);
  if (!match) return null;
  // The queue names the base in its ref. Check GitHub's commit parent too rather than trusting the name alone.
  const commit = await api(root + '/git/commits/' + run.head_sha);
  return commit?.sha === run.head_sha && commit.parents?.[0]?.sha === match[1] ? match[1] : null;
}

// Compare the same latest-completed push as the existing main health monitor. A historical replay
// or older attempt is independently repairable, even if it also ran on the same main SHA.
async function latestMainFailure(api, root, run) {
  if (run.head_branch !== 'main' || mainState(run.conclusion) !== true) return {};
  const result = await api(root + '/actions/workflows/' + run.workflow_id + '/runs?branch=main&event=push&status=completed&per_page=1');
  const latest = result?.workflow_runs?.[0];
  if (latest?.id !== run.id || latest.run_attempt !== run.run_attempt || latest.head_sha !== run.head_sha ||
      latest.conclusion !== run.conclusion || latest.status !== 'completed' || latest.workflow_id !== run.workflow_id ||
      latest.event !== 'push' || latest.head_branch !== 'main' || latest.path !== run.path ||
      ![latest.repository, latest.head_repository].every(repo => repo?.full_name === catalog.repository)) return {};
  return { currentMainRed: true };
}

async function inheritedFailure(api, root, run, jobs) {
  if (!['failure', 'timed_out'].includes(run.conclusion) ||
      jobs.some(job => bad.has(job.conclusion) && !['failure', 'timed_out'].includes(job.conclusion))) return {};
  const base = await testedBase(api, root, run);
  if (!base) return {};
  const result = await api(root + '/actions/workflows/' + run.workflow_id + '/runs?branch=main&event=push&head_sha=' + base + '&per_page=1');
  const main = result?.workflow_runs?.[0];
  if (main?.status !== 'completed' || !['failure', 'timed_out'].includes(main.conclusion) || main.head_sha !== base ||
      main.event !== 'push' || main.head_branch !== 'main' || main.path !== run.path || main.workflow_id !== run.workflow_id ||
      !positive(main.id) || !positive(main.run_attempt) || ![main.repository, main.head_repository].every(repo => repo?.full_name === catalog.repository)) return {};
  const mainJobs = await api(root + '/actions/runs/' + main.id + '/attempts/' + main.run_attempt + '/jobs?per_page=100');
  if (!Array.isArray(mainJobs?.jobs) || mainJobs.total_count !== mainJobs.jobs.length ||
      !mainJobs.jobs.every(job => boundJob(job, main)) ||
      classify({ pr: jobs, main: { conclusion: main.conclusion, jobs: mainJobs.jobs } }).verdict !== 'inherited_main_failure') return {};
  // An alert must identify this red main run or SHA. A stale open incident with the same title is insufficient.
  // Use the repository-scoped issue reader. Older/unlisted alerts leave the failure in ordinary triage.
  const issues = await api(root + '/issues?state=open&sort=updated&direction=desc&per_page=100');
  if (!Array.isArray(issues)) return {};
  const title = ALERT_KINDS['main-red'].title;
  const runUrl = 'https://github.com/' + catalog.repository + '/actions/runs/' + main.id;
  const matches = issues.filter(issue => {
    if (!validIssue(issue) || recoveredOperatorMain(issue) || issue.repository_url !== 'https://api.github.com' + root) return false;
    const body = String(issue.body || '');
    if (issue.title === title) return body.includes(base) || body.includes(runUrl + '>') || body.includes(runUrl + '|');
    return issue.user.login === owner && issue.title.startsWith(title + ': ') &&
      (body.includes(base) || issue.title.endsWith(' at ' + base.slice(0, 10)));
  });
  return matches.length === 1 ? { inheritedIssueNumber: matches[0].number } : {};
}

export async function workflowFailureHints({ api, repository, run, jobs }) {
  if (repository !== catalog.repository || run?.status !== 'completed' || !positive(run.id) || !positive(run.run_attempt) ||
      !files.has(run.workflow_id) || files.get(run.workflow_id) !== run.path || !sha(run.head_sha) ||
      ![run.repository, run.head_repository].every(repo => repo?.full_name === repository) ||
      !Array.isArray(jobs) || !jobs.every(job => boundJob(job, run))) return {};
  const root = '/repos/' + repository;
  const filename = run.path.split('/').at(-1).replace(/\.yml$/, '');
  // Optional evidence must never stop an authoritative failed run from reaching triage.
  const read = async path => {
    try { return await api(path); }
    catch { return null; }
  };
  if (filename === 'ci') {
    return run.event === 'push' ? latestMainFailure(read, root, run) : inheritedFailure(read, root, run, jobs);
  }
  return Object.hasOwn(rules, filename) ? confirmedOccurrence(read, root, run, jobs, rules[filename]) : {};
}
