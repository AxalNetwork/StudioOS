import assert from 'node:assert/strict';
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
    return notice('StudioOS release admission', 'superseded');
  } }), { superseded: true });
  for (const rows of [[], notice('different', 'superseded'), [{ title: 'StudioOS release admission', message: 'superseded', annotation_level: 'failure' }]]) {
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
