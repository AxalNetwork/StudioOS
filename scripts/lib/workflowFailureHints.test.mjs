/**
 * D6387: verify source constraints for known repair issues.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { workflowFailureHints } from './workflowFailureHints.mjs';

const repository = 'AxalNetwork/StudioOS', repo = { full_name: repository }, root = '/repos/' + repository;
const head = 'a'.repeat(40), baseSha = 'b'.repeat(40);
const workflows = {
  'cloudflare-worker-deploy': 348320146, 'magic-link-probe': 356728695, 'magic-link-insert-probe': 356755115,
  'claude-code': 280914787, 'meeting-bot-deploy': 395019406, ci: 271983865,
};
const issueTitles = {
  1008: 'Owner actions: one current list (backups, live checks, channels, connectors, AI packs, and your calls)',
  5530: 'Resolve the Claude Code mention workflow’s authentication failure',
  5675: 'Verify preview meeting-bot callbacks and isolate preview Slack alerts before production promotion',
};
const issue = (number, title) => ({ number, title, state: 'open', user: { login: 'guillaumelauzier' } });
function fixture(slug, name, step, event = 'push') {
  const run = { id: 23, run_attempt: 2, workflow_id: workflows[slug], path: '.github/workflows/' + slug + '.yml',
    head_sha: head, head_branch: 'main', repository: repo, head_repository: repo, event, status: 'completed', conclusion: 'failure' };
  const job = { id: 67, run_id: 23, run_attempt: 2, head_sha: head, head_branch: 'main', name, conclusion: 'failure',
    check_run_url: 'https://api.github.com' + root + '/check-runs/67', steps: [{ name: step, conclusion: 'failure' }] };
  return { run, jobs: [job], repository };
}
async function withoutReads(fixture) {
  let reads = 0;
  const hints = await workflowFailureHints({ ...fixture, api() { reads++; } });
  assert.equal(reads, 0, 'untrusted or unrelated failure performed provider lookup');
  return hints;
}
const notice = (title, message) => [{ annotation_level: 'notice', title, message }];
const annotations = root + '/check-runs/67/annotations?per_page=100';

test('supersession needs a trusted exact failed job, attempt, step and structured release notice', async () => {
  const f = fixture('cloudflare-worker-deploy', 'Verify the exact main candidate', 'Wait for all six required checks');
  assert.deepEqual(await workflowFailureHints({ ...f, api(path) {
    assert.equal(path, annotations);
    return notice('StudioOS release outcome v1', ['superseded', 'initial', 23, 2, head, baseSha].join(' '));
  } }), { superseded: true, supersededStage: 'initial' });
  for (const rows of [[], notice('StudioOS release admission', 'superseded'), notice('different', 'superseded'), [{ title: 'StudioOS release admission', message: 'superseded', annotation_level: 'failure' }]]) {
    assert.deepEqual(await workflowFailureHints({ ...f, api: () => rows }), {});
  }
  assert.deepEqual(await workflowFailureHints({ ...f, api() { throw Error('annotations unavailable'); } }), {});
  const variants = [
    { run: { ...f.run, event: 'pull_request' } }, { run: { ...f.run, path: '.github/workflows/fake.yml' } },
    { run: { ...f.run, head_repository: { full_name: 'elsewhere/StudioOS' } } }, { run: { ...f.run, head_branch: 'test' } },
    { jobs: [{ ...f.jobs[0], run_attempt: 1 }] }, { jobs: [{ ...f.jobs[0], head_sha: baseSha }] },
    { jobs: [{ ...f.jobs[0], check_run_url: 'https://example.invalid/67' }] }, { jobs: [...f.jobs, { ...f.jobs[0], id: 86 }] },
    { jobs: [{ ...f.jobs[0], steps: [...f.jobs[0].steps, { name: 'Publish Worker', conclusion: 'failure' }] }] },
  ];
  for (const variant of variants) assert.deepEqual(await withoutReads({ ...f, ...variant }), {});
});

test('a successful initial supersession requires a clean admission, skipped deploy and matching replacement notice', async () => {
  const f = fixture('cloudflare-worker-deploy', 'Verify the exact main candidate', 'Wait for all six required checks');
  f.run.conclusion = 'success';
  const [admission] = f.jobs;
  admission.conclusion = admission.steps[0].conclusion = 'success';
  const deploy = { ...admission, id: 68, name: 'build and deploy studioos Worker', conclusion: 'skipped', steps: [] };
  const smoke = { ...deploy, id: 69, name: 'live current and previous lazy chunks' };
  const message = ['superseded', 'initial', f.run.id, f.run.run_attempt, head, baseSha].join(' ');
  const inspect = rows => workflowFailureHints({ ...f, jobs: [admission, deploy, smoke], api(path) {
    assert.equal(path, annotations);
    return rows;
  } });
  const title = 'StudioOS release outcome v1';
  assert.deepEqual(await inspect(notice(title, message)), { superseded: true, supersededStage: 'initial' });
  for (const wrong of [message.replace('initial', 'production-lock'), message.replace(' 23 2 ', ' 23 1 '),
    message.replace(baseSha, head), message.replace(head, baseSha), message.replace(baseSha, 'unknown')]) {
    assert.deepEqual(await inspect(notice(title, wrong)), {});
  }
  assert.deepEqual(await inspect([]), {});
  assert.deepEqual(await inspect([...notice(title, message), ...notice(title, message.replace(baseSha, 'c'.repeat(40)))]), {});
  for (const jobs of [
    [admission], [deploy], [admission, { ...deploy, conclusion: 'success' }],
    [admission, deploy, { ...smoke, conclusion: 'failure' }], [admission, deploy, { ...smoke, conclusion: 'cancelled' }],
    [{ ...admission, steps: [] }, deploy], [{ ...admission, steps: [{ ...admission.steps[0], conclusion: 'skipped' }] }, deploy],
    [{ ...admission, steps: [...admission.steps, { name: 'Setup', conclusion: 'failure' }] }, deploy],
    [admission, { ...deploy, run_attempt: 1 }],
  ]) assert.deepEqual(await withoutReads({ ...f, jobs }), {});
});

test('bot supersession requires the exact candidate check and a skipped production promotion', async () => {
  const workflow = readFileSync(new URL('../../.github/workflows/meeting-bot-deploy.yml', import.meta.url), 'utf8');
  const producerSteps = workflow.split('      - name: ');
  const promotion = { name: 'Promote verified revision to production', conclusion: 'skipped' };
  for (const [stage, step] of [
    ['bot-initial', 'Verify the exact main candidate'],
    ['bot-before-preview', 'Recheck the candidate before publishing the bot'],
    ['bot-after-preview', 'Recheck the candidate after preview verification'],
  ]) {
    const producer = producerSteps.find(block => block.startsWith(step + '\n'));
    assert.ok(producer?.split('\n').includes('          STUDIOOS_RELEASE_CHECK: ' + stage), step);
    const f = fixture('meeting-bot-deploy', 'deploy', step, 'workflow_dispatch');
    const [job] = f.jobs;
    if (stage === 'bot-after-preview') job.steps.unshift(
      { name: 'Deploy preview bot host only', conclusion: 'success' },
      { name: 'Verify deployed preview callback before normal promotion', conclusion: 'success' },
    );
    job.steps.push(promotion);
    const message = ['superseded', stage, 23, 2, head, baseSha].join(' ');
    const api = () => notice('StudioOS release outcome v1', message);
    assert.deepEqual(await workflowFailureHints({ ...f, api }), { superseded: true, supersededStage: stage });
    for (const text of [message.replace(stage, 'initial'), message.replace(' 23 2 ', ' 23 1 '), message.replace(baseSha, head)]) {
      assert.deepEqual(await workflowFailureHints({ ...f, api: () => notice('StudioOS release outcome v1', text) }), {});
    }
    const extraFailure = { name: 'Retain sanitized deployed preview result', conclusion: 'failure' };
    for (const jobs of [
      [{ ...job, name: 'other' }],
      [{ ...job, steps: [...job.steps, extraFailure] }],
      [{ ...job, steps: job.steps.slice(0, -1) }],
      [{ ...job, steps: [...job.steps.slice(0, -1), { ...promotion, conclusion: 'success' }] }],
      [job, { ...job, id: 86 }],
    ]) assert.deepEqual(await withoutReads({ ...f, jobs }), {});
    const otherWorkflow = fixture('cloudflare-worker-deploy', 'deploy', step);
    assert.deepEqual(await withoutReads(otherWorkflow), {});
  }
});

test('old or missing main auth evidence stays available for triage; a verified edge refusal reuses the owner issue', async () => {
  for (const [slug, name] of [['magic-link-probe', 'magic-link round trip'], ['magic-link-insert-probe', 'magic-link insert']]) {
    const f = fixture(slug, name, 'Report the outcome', 'schedule');
    const hints = await workflowFailureHints({ ...f, api(path) {
      if (path === annotations) return notice('StudioOS auth probe', 'edge-refused');
      assert.equal(path, root + '/issues/1008');
      return issue(1008, issueTitles[1008]);
    } });
    assert.deepEqual(hints, { existingIssueNumber: 1008 });
    assert.deepEqual(await workflowFailureHints({ ...f, api: () => notice('Magic-link sign-in BROKEN', 'generic error') }), {});
  }
});

test('only a matching owner issue and curated preflight can receive the incident', async () => {
  for (const [slug, job, step, event, number] of [
    ['claude-code', 'claude', 'Verify ANTHROPIC_API_KEY is configured', 'issue_comment', 5530],
    ['meeting-bot-deploy', 'deploy', 'Validate owner-approved preview configuration before deployment', 'push', 5675],
    ['meeting-bot-deploy', 'deploy', 'Validate preview signing secret before image build', 'workflow_dispatch', 5675],
  ]) {
    const f = fixture(slug, job, step, event), ticket = issue(number, issueTitles[number]);
    assert.deepEqual(await workflowFailureHints({ ...f, api: path => {
      assert.equal(path, root + '/issues/' + number);
      return ticket;
    } }), { existingIssueNumber: number });
    for (const changes of [{ state: 'closed' }, { title: 'changed' }, { pull_request: {} }, { user: { login: 'other' } }]) {
      assert.deepEqual(await workflowFailureHints({ ...f, api: () => ({ ...ticket, ...changes }) }), {});
    }
    assert.deepEqual(await withoutReads({ ...f, jobs: [{ ...f.jobs[0], steps: [{ name: 'Other step', conclusion: 'failure' }] }] }), {});
  }
});

test('an inherited incident must match the tested base SHA, complete main attempt, all failed parts and trusted open alert', async () => {
  const f = fixture('ci', 'suite (rest)', 'Run tests', 'pull_request');
  f.run.pull_requests = [{ base: { sha: baseSha, ref: 'main', repo: { name: 'StudioOS', url: 'https://api.github.com' + root } } }];
  f.run.head_branch = f.jobs[0].head_branch = 'feature';
  const main = { ...f.run, id: 77, run_attempt: 1, event: 'push', head_branch: 'main', head_sha: baseSha };
  const mainJob = { ...f.jobs[0], run_id: main.id, run_attempt: main.run_attempt, head_branch: 'main', head_sha: baseSha };
  const red = { ...issue(900, '[alert] main is red: failed tests at ' + baseSha.slice(0, 10)), repository_url: 'https://api.github.com' + root };
  async function check({ mainRun = main, jobs = [mainJob], total = jobs.length, issue = red, parent = baseSha } = {}) {
    return workflowFailureHints({ ...f, api(path) {
      if (path === root + '/git/commits/' + head) return { sha: head, parents: [{ sha: parent }] };
      if (path === root + '/actions/workflows/' + f.run.workflow_id + '/runs?branch=main&event=push&head_sha=' + baseSha + '&per_page=1') return { workflow_runs: [mainRun] };
      if (path === root + '/actions/runs/77/attempts/1/jobs?per_page=100') return { total_count: total, jobs };
      assert.equal(path, root + '/issues?state=open&sort=updated&direction=desc&per_page=100');
      return [issue];
    } });
  }
  assert.deepEqual(await check(), { inheritedIssueNumber: 900 });
  assert.deepEqual(await check({ mainRun: { ...main, head_sha: head } }), {});
  assert.deepEqual(await check({ jobs: [{ ...mainJob, name: 'suite (worker)' }] }), {});
  assert.deepEqual(await check({ total: 105 }), {});
  assert.deepEqual(await check({ issue: { ...red, state: 'closed' } }), {});
  const recovered = { schema: 1, kind: 'main-red', adopted: true, recovered: true, intents: [] };
  assert.deepEqual(await check({ issue: { ...red, body: '<!-- studioos-health:v1 ' + JSON.stringify(recovered) + ' -->' } }), {});
  assert.deepEqual(await check({ issue: { ...red, title: '[alert] main is red', body: 'old evidence' } }), {});
  f.run.event = 'merge_group';
  f.run.head_branch = f.jobs[0].head_branch = 'gh-readonly-queue/main/pr-23-' + baseSha;
  f.run.pull_requests = [];
  assert.deepEqual(await check(), { inheritedIssueNumber: 900 });
  assert.deepEqual(await check({ parent: head }), {});
});

test('only the latest completed CI push and the exact red attempt can open the active main episode', async () => {
  const f = fixture('ci', 'suite (worker)', 'Run tests');
  const latest = { ...f.run };
  const lookup = run => workflowFailureHints({ ...f, api(path) {
    assert.equal(path, root + '/actions/workflows/' + latest.workflow_id + '/runs?branch=main&event=push&status=completed&per_page=1');
    return { workflow_runs: run ? [run] : [] };
  } });
  assert.deepEqual(await lookup(latest), { currentMainRed: true });
  for (const override of [
    { id: 99 }, { workflow_id: 99 }, { path: '.github/workflows/other.yml' }, { event: 'pull_request' },
    { head_branch: 'other' }, { head_sha: baseSha }, { run_attempt: 3 }, { status: 'queued' },
    { conclusion: 'success' }, { head_repository: { full_name: 'elsewhere/StudioOS' } },
  ]) assert.deepEqual(await lookup({ ...latest, ...override }), {});
  assert.deepEqual(await lookup(null), {});
  f.run.conclusion = 'startup_failure';
  assert.deepEqual(await withoutReads(f), {});
});

test('#6675 both production rechecks and branch rollout require a stage- and attempt-bound supersession', async () => {
  for (const [stage, job, step] of [
    ['production-lock', 'build and deploy studioos Worker', 'Recheck candidate under the production lock'],
    ['production-ownership', 'build and deploy studioos Worker', 'Confirm the candidate still owns the production release'],
    ['branch-rollout-lock', 'redeploy every provisioned branch', 'Recheck the candidate under the branch rollout lock'],
  ]) {
    const f = fixture('cloudflare-worker-deploy', job, step);
    const message = ['superseded', stage, 23, 2, head, baseSha].join(' ');
    const api = () => notice('StudioOS release outcome v1', message);
    assert.deepEqual(await workflowFailureHints({ ...f, api }), { superseded: true, supersededStage: stage });
    assert.deepEqual(await workflowFailureHints({ ...f, api: () => notice('StudioOS release outcome v1', message.replace(' 23 2 ', ' 23 1 ')) }), {});
    const sourceMapFailure = { ...f.jobs[0], steps: [{ name: 'Upload sourcemaps to Sentry', conclusion: 'failure' }] };
    assert.deepEqual(await withoutReads({ ...f, jobs: [sourceMapFailure] }), {});
  }
});

test('#6675 only verified queue-ref loss without a real producer failure suppresses repair', async () => {
  const f = fixture('ci', 'suite (worker-4-of-6)', 'Check merge queue ref still exists', 'merge_group');
  f.run.head_branch = 'gh-readonly-queue/main/pr-37-' + baseSha;
  f.jobs[0].head_branch = f.run.head_branch;
  const ref = 'refs/heads/' + f.run.head_branch;
  const message = ['ref-lost', 23, 2, head, ref].join(' ');
  const refs = root + '/git/matching-refs/' + ref.slice('refs/'.length);
  const aggregate = { ...f.jobs[0], id: 86, name: 'landing gate',
    steps: [{ name: 'Required fast checks and full suite passed', conclusion: 'failure' }] };
  const jobs = [...f.jobs, aggregate];
  function api(path) {
    if (path === annotations) return notice('StudioOS queue outcome v1', message);
    if (path === root + '/git/commits/' + head) return { sha: head, parents: [{ sha: baseSha }] };
    if (path.startsWith(root + '/contents/')) return { type: 'file', path: path.slice((root + '/contents/').length).split('?')[0], sha: 'c'.repeat(40) };
    if (path === refs) return [];
    return null;
  }
  assert.deepEqual(await workflowFailureHints({ ...f, jobs, api }), { queueInvalidated: true });
  for (const unavailable of [
    path => path === annotations ? [] : api(path),
    path => path === refs ? { message: 'Forbidden' } : api(path),
    path => path === refs ? [{ ref }] : api(path),
    path => path === refs ? Promise.reject(new Error('unavailable')) : api(path),
    path => path.startsWith(root + '/contents/') && path.endsWith(head) ? { ...api(path), sha: 'd'.repeat(40) } : api(path),
  ]) {
    assert.deepEqual(await workflowFailureHints({ ...f, jobs, api: unavailable }), {});
  }
  const testFailure = { ...f.jobs[0], id: 87,
    steps: [{ name: 'Run node scripts/test-drift-parts.mjs worker-4-of-6', conclusion: 'failure' }] };
  assert.deepEqual(await workflowFailureHints({ ...f, jobs: [testFailure, aggregate], api }), {});
  assert.deepEqual(await workflowFailureHints({ ...f, jobs: [...jobs, testFailure], api }), {});
});
