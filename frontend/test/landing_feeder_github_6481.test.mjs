import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGitHubReader, repairStatus} from '../../scripts/landing-bot/feeder-github.mjs';

const number = 42;
const repo = 'AxalNetwork/StudioOS';
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const user = {type: 'User', id: 100};
const commit = {sha: head, author: user, committer: user, commit: {message: 'Fix route'}};
const full = 'test:drift (full suite)';
const policy = 'landing policy';
const asResponse = data => new Response(JSON.stringify(data), {status: 200});

function fixture() {
  const pull = {number, state: 'open', merged: false, draft: false, commits: 1, changed_files: 1,
    node_id: 'PR42', head: {sha: head}, base: {ref: 'main'}};
  const checks = [full, policy].map((name, i) => ({name, id: 25 + i, app: {id: 15368},
    head_sha: head, status: 'completed', conclusion: 'success'}));
  const run = {id: 102, event: 'pull_request', path: '.github/workflows/ci.yml', head_sha: head,
    repository: {full_name: repo}, pull_requests: [{number, head: {sha: head}, base: {ref: 'main', sha: base}}]};
  const facts = {
    pull, checks, commit: structuredClone(commit), files: [{filename: 'docs/how.md'}],
    fullRun: run, policyRun: {...run, id: 103, path: '.github/workflows/landing-policy.yml'},
    history: {id: 'PR42', headRefOid: head, isInMergeQueue: false, timelineItems: {totalCount: 0}},
    log: `  BASE_SHA: ${base}\n  HEAD_SHA: ${head}\n  PR_NUMBER: 42\n  LANDING_AUTO: true\n  CHECKOUT_OUTCOME: success\n * refs/pull/42/head -> FETCH_HEAD`,
    classificationCalls: [],
    rulesIssue: {number: 6480, state: 'open', state_reason: null},
  };
  const reader = createGitHubReader({
    repo, token: 'fixture', classify: async (...args) => { facts.classificationCalls.push(args); return {tier: 'T0'}; },
    fetchImpl: async (url, opts) => {
      const path = new URL(url).pathname.replace(`/repos/${repo}`, '');
      if (path === '/graphql') {
        assert.equal(opts.method, 'POST');
        const {query} = JSON.parse(opts.body);
        assert.match(query, /^query\(/);
        assert.match(query, /REMOVED_FROM_MERGE_QUEUE_EVENT/);
        return asResponse({data: {repository: {pullRequest: facts.history}}});
      }
      if (path === '/actions/jobs/26/logs') return new Response(facts.log);
      assert.equal(opts.method, 'GET');
      if (path === '') return asResponse({allow_auto_merge: true, allow_update_branch: true});
      if (path === '/rules/branches/main') return asResponse([{type: 'merge_queue'},
        {type: 'required_status_checks', parameters: {required_status_checks: [{context: full, integration_id: 15368}]}}]);
      if (path === '/issues/5500') return asResponse({state: 'closed', state_reason: 'completed'});
      if (path === '/issues/6480') return asResponse(facts.rulesIssue);
      if (path === '/search/issues') return asResponse({incomplete_results: false, items: [], total_count: 0});
      if (path === '/pulls/42') return asResponse(pull);
      if (path === '/pulls/42/files') return asResponse(facts.files);
      if (path === '/pulls/42/commits') return asResponse([facts.commit]);
      if (path === `/commits/${head}/check-runs`) return asResponse({check_runs: checks, total_count: 2});
      if (path === '/actions/jobs/25') return asResponse({...checks[0], run_id: 102});
      if (path === '/actions/jobs/26') return asResponse({...checks[1], run_id: 103});
      if (path === '/actions/runs/102') return asResponse(facts.fullRun);
      if (path === '/actions/runs/103') return asResponse(facts.policyRun);
      throw new Error('Unknown fixture path ' + path);
    },
  });
  return {facts, reader};
}

test('reads a full suite from the correct PR workflow and a complete queue history', async () => {
  const {facts, reader} = fixture();
  const candidate = await reader.readCandidate(number);
  assert.equal(candidate.fullSuitePassed, true);
  assert.equal(candidate.priorQueueEntry, false);
  assert.equal(candidate.modelRepaired, false);
  facts.history.timelineItems.totalCount = 2;
  facts.fullRun.event = 'push';
  const gone = await reader.readCandidate(number);
  assert.equal(gone.priorQueueEntry, true);
  assert.equal(gone.fullSuitePassed, false);
  facts.history.headRefOid = base;
  await assert.rejects(reader.readCandidate(number), /changed or GitHub returned incomplete/);
});
test('does not accept a draft fast-tier job, wrong app, workflow or PR', async () => {
  for (const change of [
    f => { f.checks[0].name = 'test:drift (draft fast tier)'; },
    f => { f.checks[0].app.id++; }, f => { f.fullRun.path = '.github/workflows/other.yml'; },
    f => { f.fullRun.pull_requests = []; }, f => { f.fullRun.head_sha = base; },
  ]) {
    const {facts, reader} = fixture();
    change(facts);
    assert.equal((await reader.readCandidate(number)).fullSuitePassed, false);
  }
});
test('#6481 D6481-p2: a PR that edits ci.yml has no full-suite proof, whatever its own run reported', async () => {
  for (const edit of [{filename: '.github/workflows/ci.yml'}, {filename: 'docs/ci.yml', previous_filename: '.github/workflows/ci.yml'}]) {
    const {facts, reader} = fixture();
    facts.files = [edit];
    assert.equal((await reader.readCandidate(number)).fullSuitePassed, false);
  }
  const {facts, reader} = fixture();
  facts.files = [{filename: 'docs/ci.yml'}];
  assert.equal((await reader.readCandidate(number)).fullSuitePassed, true);
});
test('#6481 D6481-p2: reads the landing rules issue state as GitHub reports it', async () => {
  const {facts, reader} = fixture();
  assert.deepEqual(await reader.readRulesIssue(), {number: 6480, state: 'open', state_reason: null});
  facts.rulesIssue = {number: 6480, state: 'closed', state_reason: 'completed'};
  assert.deepEqual(await reader.readRulesIssue(), {number: 6480, state: 'closed', state_reason: 'completed'});
});
test('authenticates the exact policy workflow and invokes the trusted classifier only for verified log facts', async () => {
  const {facts, reader} = fixture();
  const decision = await reader.readLandingDecision(number);
  assert.equal(decision.mayQueue, true);
  assert.deepEqual(facts.classificationCalls, [[repo, base, head]]);
  for (const change of [
    f => { f.policyRun.path = '.github/workflows/copy.yml'; },
    f => { f.log = f.log.replace(base, 'c'.repeat(40)); },
    f => { f.log = f.log.replace('LANDING_AUTO: true', 'LANDING_AUTO: false'); },
    f => { f.files[0].previous_filename = '.github/workflows/landing-policy.yml'; },
  ]) {
    const {facts: f, reader: next} = fixture();
    change(f);
    assert.equal((await next.readLandingDecision(number)).mayQueue, false);
    assert.deepEqual(f.classificationCalls, []);
  }
});
test('missing commit attribution and unclassified bot commits require owner review', () => {
  assert.equal(repairStatus([]), null);
  assert.equal(repairStatus([{...commit, author: null}]), null);
  assert.equal(repairStatus([{...commit, committer: {...user, type: 'Bot'}}]), null);
  assert.equal(repairStatus([{...commit, commit: {message: 'fix\n\nLanding-Bot-Kind: red-pr'}}]), true);
});
test('an incomplete landing list cannot supply an unattended sweep', async () => {
  const reader = createGitHubReader({repo, token: 'fixture',
    loadOrderedList: async () => async () => ({partial: true, entries: []})});
  await assert.rejects(reader.readOrderedList(), /Incomplete/);
});
