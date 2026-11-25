// D6387: match verified failures to existing repairs and release supersession.
//
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
  'magic-link-probe': { job: 'magic-link round trip', steps: ['Report the outcome'], events: ['schedule', 'workflow_dispatch'],
    annotation: ['StudioOS auth probe', 'edge-refused'], issue: 1008 },
  'magic-link-insert-probe': { job: 'magic-link insert', steps: ['Report the outcome'], events: ['schedule', 'workflow_dispatch'],
    annotation: ['StudioOS auth probe', 'edge-refused'], issue: 1008 },
  'claude-code': { job: 'claude', steps: ['Verify ANTHROPIC_API_KEY is configured'], issue: 5530,
    events: ['issue_comment', 'issues', 'workflow_dispatch'] },
  'meeting-bot-deploy': { job: 'deploy',
    steps: ['Validate owner-approved preview configuration before deployment', 'Validate preview signing secret before image build'],
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

const releaseChecks = {
  'cloudflare-worker-deploy': [
    ['initial', 'Verify the exact main candidate', 'Wait for all six required checks'],
    ['production-lock', 'build and deploy studioos Worker', 'Recheck candidate under the production lock'],
    ['production-ownership', 'build and deploy studioos Worker', 'Confirm the candidate still owns the production release'],
    ['branch-rollout-lock', 'redeploy every provisioned branch', 'Recheck the candidate under the branch rollout lock'],
  ],
  'meeting-bot-deploy': [
    ['bot-initial', 'deploy', 'Verify the exact main candidate'],
    ['bot-before-preview', 'deploy', 'Recheck the candidate before publishing the bot'],
    ['bot-after-preview', 'deploy', 'Recheck the candidate after preview verification'],
  ],
};

// The reconciler needs job metadata on green runs only for this trusted workflow.
export function isSuccessfulProductionRun(run) {
  return run.conclusion === 'success' && run.path === '.github/workflows/cloudflare-worker-deploy.yml' &&
    files.get(run.workflow_id) === run.path && run.head_branch === 'main' && ['push', 'workflow_dispatch'].includes(run.event) &&
    [run.repository, run.head_repository].every(repo => repo?.full_name === catalog.repository);
}

async function notices(api, root, job) {
  if (job.check_run_url !== 'https://api.github.com' + root + '/check-runs/' + job.id) return [];
  const annotations = await api(root + '/check-runs/' + job.id + '/annotations?per_page=100');
  return Array.isArray(annotations) ? annotations.filter(row => row?.annotation_level === 'notice') : [];
}

function onlyFailedStep(job, name) {
  if (job.conclusion !== 'failure' || !Array.isArray(job.steps)) return false;
  const failed = job.steps.filter(step => bad.has(step.conclusion));
  return failed.length === 1 && failed[0].name === name && failed[0].conclusion === 'failure';
}

async function releaseNotice(api, root, run, job, stage) {
  const prefix = ['superseded', stage, run.id, run.run_attempt, run.head_sha, ''].join(' ');
  const messages = new Set((await notices(api, root, job))
    .filter(row => row.title === 'StudioOS release outcome v1').map(row => row.message));
  if (messages.size !== 1) return {};
  const [message] = messages;
  if (typeof message !== 'string' || !message.startsWith(prefix)) return {};
  const replacement = message.slice(prefix.length);
  return sha(replacement) && replacement !== run.head_sha ? { superseded: true, supersededStage: stage } : {};
}

async function releaseSupersession(api, root, run, jobs, filename) {
  if (isSuccessfulProductionRun(run)) {
    const [, jobName, stepName] = releaseChecks[filename][0];
    const [, deployName] = releaseChecks[filename][1];
    const executed = jobs.filter(job => job.conclusion !== 'skipped');
    const [admission] = executed;
    if (executed.length !== 1 || admission.name !== jobName || admission.conclusion !== 'success' ||
        jobs.filter(job => job.name === deployName && job.conclusion === 'skipped').length !== 1 ||
        !Array.isArray(admission.steps) || !admission.steps.every(step => ['success', 'skipped'].includes(step.conclusion))) return {};
    const checks = admission.steps.filter(step => step.name === stepName);
    if (checks.length !== 1 || checks[0].conclusion !== 'success') return {};
    return releaseNotice(api, root, run, admission, 'initial');
  }
  if (run.head_branch !== 'main' || !['push', 'workflow_dispatch'].includes(run.event) || run.conclusion !== 'failure') return {};
  const failed = jobs.filter(job => bad.has(job.conclusion));
  if (failed.length !== 1) return {};
  const [job] = failed;
  const match = releaseChecks[filename].find(([, name, step]) => job.name === name && onlyFailedStep(job, step));
  if (!match) return {};
  // A post-preview supersession can follow a successful preview publish. Confirm promotion was skipped.
  if (filename === 'meeting-bot-deploy' && !job.steps.some(step =>
    step.name === 'Promote verified revision to production' && step.conclusion === 'skipped')) return {};
  return releaseNotice(api, root, run, job, match[0]);
}

const queueProducer = /^(?:frontend \(build\)|worker \(typecheck\)|api ↔ worker drift|suite \((?:frontend-[12]-of-2|worker-[1-6]-of-6|rest)\))$/;
const queueSummaries = new Map([
  ['test:drift (full suite)', 'Every part of test:drift passed'],
  ['landing gate', 'Required fast checks and full suite passed'],
]);

async function queueInvalidation(api, root, run, jobs) {
  if (run.event !== 'merge_group' || run.conclusion !== 'failure') return {};
  const match = /^gh-readonly-queue\/main\/pr-[1-9]\d*-([a-f0-9]{40})$/.exec(run.head_branch);
  if (!match) return {};
  const failed = jobs.filter(job => bad.has(job.conclusion));
  const producers = failed.filter(job => queueProducer.test(job.name) && onlyFailedStep(job, 'Check merge queue ref still exists'));
  const summaries = failed.filter(job => queueSummaries.has(job.name) && onlyFailedStep(job, queueSummaries.get(job.name)));
  if (!producers.length || producers.length + summaries.length !== failed.length) return {};
  const ref = 'refs/heads/' + run.head_branch;
  const message = ['ref-lost', run.id, run.run_attempt, run.head_sha, ref].join(' ');
  const observed = await Promise.all(producers.map(job => notices(api, root, job)));
  if (!observed.every(rows => {
    const outcomes = rows.filter(row => row.title === 'StudioOS queue outcome v1');
    return outcomes.length && outcomes.every(row => row.message === message);
  })) return {};
  // A queue job may run candidate code. Independently verify the base, the
  // actual workflow and probe, and GitHub's exact ref lookup before suppressing.
  const base = await testedBase(api, root, run);
  if (!base) return {};
  for (const path of [run.path, 'scripts/ci/queue-ref-alive.sh']) {
    const checked = await Promise.all([base, run.head_sha].map(commit => api(root + '/contents/' + path + '?ref=' + commit)));
    if (!checked.every(file => file?.type === 'file' && file.path === path && sha(file.sha)) || checked[0].sha !== checked[1].sha) return {};
  }
  const refs = await api(root + '/git/matching-refs/' + ref.slice('refs/'.length));
  return Array.isArray(refs) && refs.length === 0 ? { queueInvalidated: true } : {};
}

async function confirmedOccurrence(api, root, run, jobs, rule) {
  if (run.head_branch !== 'main' || !rule.events.includes(run.event) || run.conclusion !== 'failure') return {};
  const failed = jobs.filter(job => bad.has(job.conclusion));
  if (failed.length !== 1 || failed[0].name !== rule.job || failed[0].conclusion !== 'failure') return {};
  const job = failed[0];
  const steps = (job.steps || []).filter(step => bad.has(step.conclusion));
  if (steps.length !== 1 || !rule.steps.includes(steps[0].name) || steps[0].conclusion !== 'failure') return {};
  if (rule.annotation) {
    const annotations = await notices(api, root, job);
    const [title, message] = rule.annotation;
    if (!annotations.some(a => a.title === title && a.message === message)) return {};
  }
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
    if (run.event === 'push') return latestMainFailure(read, root, run);
    const invalidation = await queueInvalidation(read, root, run, jobs);
    return invalidation.queueInvalidated ? invalidation : inheritedFailure(read, root, run, jobs);
  }
  if (Object.hasOwn(releaseChecks, filename)) {
    const outcome = await releaseSupersession(read, root, run, jobs, filename);
    if (outcome.superseded) return outcome;
  }
  return Object.hasOwn(rules, filename) ? confirmedOccurrence(read, root, run, jobs, rules[filename]) : {};
}
