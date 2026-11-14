import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflowFailureReporter, normalizeWorkflowFailure } from './workflowFailureIssues.mjs';

const repository = 'AxalNetwork/StudioOS', repo = { full_name: repository };
const catalog = { repository, workflows: [
  { id: 11, path: '.github/workflows/ci.yml' },
  { id: 12, path: '.github/workflows/cloudflare-worker-deploy.yml' },
  { id: 13, path: 'dynamic/github-code-quality/codeql' },
] };
const run = { id: 101, workflow_id: 11, run_attempt: 1, repository: repo, head_repository: repo,
  created_at: '2026-11-14T12:00:00Z', event: 'push', head_branch: 'main', head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'failure' };
function input(overrides = {}, job = {}) {
  const info = { ...run, ...overrides };
  return { run: info, jobs: [{ id: 2000 + info.id + info.run_attempt, run_id: info.id, run_attempt: info.run_attempt,
    conclusion: 'failure', name: 'build', steps: [{ name: 'test', number: 2, conclusion: 'failure' }], ...job }] };
}
function service() {
  const issues = [], comments = new Map(), root = '/repos/' + repository + '/issues';
  let ambiguous = false, nextComment = 3000, label = {name: 'workflow-failure'};
  const reads = [], operations = [];
  async function api(path, init = {}) {
    if (!init.method) reads.push(path);
    else operations.push([init.method, path]);
    if (path === '/repos/' + repository + '/labels/workflow-failure' && !init.method) return label;
    if (path.startsWith(root + '?')) {
      assert.match(path, /labels=workflow-failure/);
      const query = new URL('https://api.github.com' + path).searchParams;
      return issues.filter(i => i.labels.includes('workflow-failure') && i.state === query.get('state') &&
        (!query.has('since') || !i.updated_at || Date.parse(i.updated_at) >= Date.parse(query.get('since')))).slice().reverse();
    }
    if (path === root && init.method === 'POST') {
      const issue = { ...JSON.parse(init.body), number: issues.length + 1, state: 'open', user: { login: 'github-actions[bot]' } };
      issues.push(issue);
      if (ambiguous) { ambiguous = false; throw Error('outcome_unknown'); }
      return issue;
    }
    if (path.startsWith(root + '/comments/')) {
      assert.equal(init.method, 'PATCH');
      const id = Number(path.split('/').at(-1));
      const row = [...comments.values()].flat().find(row => row.id === id);
      Object.assign(row, JSON.parse(init.body));
      return row;
    }
    if (path.endsWith('/labels')) {
      assert.equal(init.method, 'POST');
      const number = Number(path.split('/').at(-2));
      const issue = issues.find(i => i.number === number);
      assert.deepEqual(JSON.parse(init.body).labels, ['workflow-failure']);
      issue.labels = [...new Set([...issue.labels, ...JSON.parse(init.body).labels])];
      return issue.labels.map(name => ({name}));
    }
    const match = path.slice(root.length).match(/^\/(\d+)(\/comments)?(?:\?.*)?$/);
    assert.ok(match);
    const number = Number(match[1]), entries = comments.get(number) || [];
    if (!match[2]) return issues.find(i => i.number === number);
    if (!init.method) return entries;
    assert.equal(init.method, 'POST');
    const row = { ...JSON.parse(init.body), id: ++nextComment, user: { login: 'github-actions[bot]' } };
    entries.push(row);
    comments.set(number, entries);
    return row;
  }
  return { issues, comments, reads, operations, setLabel: value => { label = value; }, reporter: (trustedCatalog = catalog, options = {}) => createWorkflowFailureReporter({ api, catalog: trustedCatalog, ...options }), failAfterCreate: () => { ambiguous = true; } };
}

test('only verified completed actionable conclusions make public metadata-only repair records', () => {
  for (const conclusion of ['success', 'neutral', 'cancelled', 'skipped', 'stale', null]) {
    assert.equal(normalizeWorkflowFailure(input({ conclusion }), catalog), null);
  }
  assert.equal(normalizeWorkflowFailure(input({ status: 'in_progress' }), catalog), null);
  for (const conclusion of ['failure', 'action_required', 'timed_out', 'startup_failure']) {
    const row = normalizeWorkflowFailure(input({ conclusion }), catalog);
    assert.match(row.evidence, /actions\/runs\/101\/attempts\/1/);
    assert.match(row.evidence, /actions\/runs\/101\/job\/2102/);
    assert.equal(row.labels.includes('priority:high'), true);
  }
  const unsafe = 'ATTACKER_PAYLOAD @everybody', fakeCatalog = { ...catalog, workflows: [{ id: 11, path: unsafe }] };
  const row = normalizeWorkflowFailure(input({ head_branch: unsafe, display_title: unsafe, html_url: unsafe },
    { name: unsafe, html_url: unsafe, steps: [{ name: unsafe, number: 2, conclusion: 'failure' }] }), fakeCatalog);
  assert.doesNotMatch(JSON.stringify(row), /ATTACKER_PAYLOAD/);
  assert.equal(row.labels.includes('priority:medium'), true);
  assert.throws(() => normalizeWorkflowFailure(input({ repository: {full_name: 'other/repo'} }), catalog), /identity/);
  assert.throws(() => normalizeWorkflowFailure(input({}, {run_id: 199}), catalog), /identity/);
  assert.throws(() => normalizeWorkflowFailure(input({}, {run_attempt: 2}), catalog), /identity/);
});

test('deduplicates attempts across repeated observations, restarts and simultaneous events; keeps human edits', async () => {
  const mock = service(), writer = mock.reporter();
  const [first, replay] = await Promise.all([writer.report(input()), writer.report(input())]);
  assert.deepEqual([first.action, replay.action], ['created', 'duplicate']);
  mock.issues[0].body += '\n\nHuman investigation';
  const second = input({run_attempt: 2});
  assert.deepEqual(await writer.report(second), { action: 'updated', issueNumber: 1 });
  assert.deepEqual(await mock.reporter().report(second), { action: 'duplicate', issueNumber: 1 });
  assert.match(mock.issues[0].body, /Human investigation/);
  assert.match(mock.comments.get(1)[0].body, /101\/attempts\/2/);
  assert.equal(mock.comments.get(1).length, 1);
  assert.deepEqual(await mock.reporter().report({ ...second, jobs: [] }), { action: 'duplicate', issueNumber: 1 });
  mock.issues[0].state = 'closed';
  assert.deepEqual(await mock.reporter().report(second), { action: 'duplicate', issueNumber: 1 });
  assert.deepEqual(await mock.reporter().report(input({ id: 103 })), { action: 'created', issueNumber: 2 });
});
test('independent PRs, failing stages and same-name provider workflows get distinct issues; unknown IDs still report', async () => {
  const mock = service(), writer = mock.reporter();
  const pr = n => ({ event: 'pull_request', pull_requests: [{number: n}] });
  await writer.report(input(pr(17)));
  await writer.report(input({ id: 104, ...pr(18) }));
  await writer.report(input({ id: 105, ...pr(17) }, {name: 'lint'}));
  await writer.report(input({ id: 106, workflow_id: 13, name: 'CodeQL' }));
  await writer.report(input({ id: 107, workflow_id: 177, name: 'CodeQL' }));
  assert.equal(mock.issues.length, 5);
  assert.match(mock.issues.at(-1).body, /pending catalog registration/);
  assert.match(mock.issues[0].title, /PR #17/);
});
test('only verified release supersession and trusted main CI incidents suppress a new repair', async () => {
  const mock = service(), writer = mock.reporter();
  mock.issues.push({number: 1, title: '[alert] main is red', state: 'open', body: 'health', user: {login:'github-actions[bot]'}, labels:['ci']});
  assert.deepEqual(await writer.report({ ...input({workflow_id: 12}), superseded: true }), { action: 'ignored', reason: 'non_actionable' });
  assert.deepEqual(await writer.report({ ...input(), inheritedIssueNumber: 1 }), { action: 'updated', issueNumber: 1 });
  assert.deepEqual(await writer.report({ ...input(), inheritedIssueNumber: 1 }), { action: 'duplicate', issueNumber: 1 });
  mock.issues[0].user.login = 'guillaumelauzier';
  mock.issues[0].title += ': diagnosed regression';
  assert.equal((await writer.report({ ...input({id: 104}), inheritedIssueNumber: 1 })).action, 'updated');
  mock.issues[0].user.login = 'outsider';
  assert.equal((await writer.report({ ...input({id: 105}), inheritedIssueNumber: 1 })).action, 'created');
  assert.equal((await writer.report({ ...input({id: 106, workflow_id: 12, conclusion: 'timed_out'}), superseded:true })).action, 'created');
});
test('an acknowledged create with a lost HTTP response is discovered before retrying', async () => {
  const mock = service(), writer = mock.reporter();
  mock.failAfterCreate();
  await assert.rejects(writer.report(input()), /outcome_unknown/);
  assert.deepEqual(await writer.report(input()), { action: 'duplicate', issueNumber: 1 });
  assert.equal(mock.issues.length, 1);
});
test('adopts an existing issue only for the specifically mapped workflow', async () => {
  const mock = service();
  mock.issues.push({number: 5530, state: 'open', body: 'Human repair notes', user: {login:'guillaumelauzier'}, labels:['bug']});
  const credentialCatalog = { ...catalog, workflows: [...catalog.workflows, { id: 14, path: '.github/workflows/claude-code.yml' }] };
  const writer = mock.reporter(credentialCatalog);
  assert.equal((await writer.report({ ...input({ workflow_id: 14 }), existingIssueNumber: 5530 })).action, 'updated');
  assert.deepEqual(await writer.report({ ...input({ workflow_id: 14 }), existingIssueNumber: 5530 }), { action: 'duplicate', issueNumber: 5530 });
  assert.equal((await mock.reporter().report({ ...input({ id: 119 }), existingIssueNumber: 5530 })).action, 'created');
  assert.equal(mock.issues[0].body, 'Human repair notes');
});
test('one thousand repeats preserve every attempt in bounded receipt chunks and do not multiply issue/comment reads', async () => {
  const mock = service(), writer = mock.reporter();
  for (let i = 0; i <= 1000; i++) {
    const outcome = await writer.report(input({ id: 1000 + i }));
    assert.equal(outcome.action, i === 0 ? 'created' : 'updated');
  }
  assert.equal(mock.issues.length, 1);
  const chunks = mock.comments.get(1);
  assert.ok(chunks.length < 10);
  assert.ok(chunks.every(row => row.body.length <= 48_000));
  assert.equal(chunks.map(row => row.body).join('\n').match(/<!-- studioos-workflow-attempt:v1/g).length, 1000);
  assert.ok(mock.reads.length <= 4);
  assert.equal(mock.reads.filter(path => path.endsWith('/labels/workflow-failure')).length, 1);
  assert.equal((await mock.reporter().report(input({ id: 1750 }))).action, 'duplicate');
  assert.ok(mock.reads.some(path => path.includes('state=closed') && path.includes('since=2026-11-14')));
});
test('successive queue candidates share a failing stage on the same base and retain their individual SHAs and PR links', async () => {
  const mock = service(), writer = mock.reporter();
  const queueRun = (id, base, pr) => input({ id, event: 'merge_group', head_branch: 'gh-readonly-queue/' + base + '/pr-' + pr + '-a01cafe', head_sha: 'c'.repeat(40), pull_requests:[{number:pr}] });
  await writer.report(queueRun(1200, 'main', 18));
  assert.equal((await writer.report(queueRun(1201, 'main', 19))).action, 'updated');
  assert.equal((await writer.report(queueRun(1202, 'release/1', 20))).action, 'created');
  assert.match(mock.comments.get(1)[0].body, /\/pull\/19/);
  assert.match(mock.comments.get(1)[0].body, /\/commit\/c{40}/);
  assert.ok(mock.issues[0].labels.includes('slot:S01'));
  assert.ok(!mock.issues[0].labels.includes('priority:P0'));
});

test('verified latest main CI uses the canonical health episode, preserving public repair evidence', async () => {
  const mock = service();
  const canonical = { number: 8109, title: '[alert] main is red', state: 'open', user: {login: 'github-actions[bot]'}, labels: ['ci'], body: 'health' };
  const reached = [];
  const writer = mock.reporter(catalog, { ensureMainRedIssue: async (main, labels) => {
    reached.push(main.id);
    assert.ok(labels.includes('slot:S01'));
    mock.issues.push(canonical);
    return canonical.number;
  } });
  assert.deepEqual(await writer.report({...input(), currentMainRed:true}), { action: 'updated', issueNumber: 8109 });
  assert.match(mock.comments.get(8109)[0].body, /\/actions\/runs\/101\/attempts\/1/);
  for (const [i, overrides] of [{event:'pull_request'}, {workflow_id:13}, {conclusion:'startup_failure'}, {head_branch:'test'}].entries()) {
    await writer.report({ ...input({ ...overrides, id:801 + i }), currentMainRed:true });
  }
  assert.deepEqual(reached, [101]);
});
test('a missing canonical episode falls back to triage while uncertain writes retry without a second public issue', async () => {
  const mock = service();
  const sample = { ...input(), currentMainRed:true };
  const uncertain = mock.reporter(catalog, { ensureMainRedIssue: async () => { throw Error('outcome_unknown'); } });
  await assert.rejects(uncertain.report(sample), /outcome_unknown/);
  assert.equal(mock.issues.length, 0);
  const unavailable = mock.reporter(catalog, { ensureMainRedIssue: async () => null });
  assert.equal((await unavailable.report(sample)).action, 'created');
});

test('a missing or misnamed inventory label blocks generic issue creation until label sync completes', async () => {
  const mock = service(), writer = mock.reporter();
  for (const unavailable of [null, {name: 'wrong-label'}]) {
    mock.setLabel(unavailable);
    await assert.rejects(writer.report(input()), /workflow_failure_label_unavailable/);
    assert.equal(mock.issues.length, 0);
  }
  mock.setLabel({name: 'workflow-failure'});
  assert.equal((await writer.report(input())).action, 'created');
  assert.equal((await writer.report(input({id: 987}, {name: 'other failure'}))).action, 'created');
  assert.equal(mock.reads.filter(path => path.endsWith('/labels/workflow-failure')).length, 3);
});

test('after a restart, closed canonical incidents keep exact receipts even when an attribution hint disappears', async () => {
  const mock = service();
  const canonical = {number: 9876, title: '[alert] main is red', labels:['ci', 'incident'], state:'open', user:{login:'github-actions[bot]'}, body:'Health episode'};
  mock.issues.push(canonical);
  const first = await mock.reporter().report({ ...input(), inheritedIssueNumber:9876 });
  assert.deepEqual(first, {action:'updated', issueNumber:9876});
  assert.deepEqual(canonical.labels, ['ci', 'incident', 'workflow-failure']);
  canonical.state = 'closed';
  canonical.title = 'Recovered after repair';
  const writer = mock.reporter();
  assert.deepEqual(await writer.report(input()), {action:'duplicate', issueNumber:9876});
  assert.equal((await writer.report(input({id: 1234}))).action, 'created');
  assert.equal(canonical.state, 'closed');
  assert.equal(mock.comments.get(9876).length, 1);
});
test('a previously adopted known target also deduplicates without its now-absent contextual hint', async () => {
  const mock = service();
  const canonical = {number: 5530, title:'Credential repair', labels:['human'], state:'open', user:{login:'guillaumelauzier'}, body:'Owner notes'};
  const knownCatalog = {...catalog, workflows:[...catalog.workflows,{id:14,path:'.github/workflows/claude-code.yml'}]};
  mock.issues.push(canonical);
  await mock.reporter(knownCatalog).report({ ...input({workflow_id:14}), existingIssueNumber:5530 });
  assert.deepEqual(await mock.reporter(knownCatalog).report(input({workflow_id:14})), { action:'duplicate',issueNumber:5530 });
  assert.equal((await mock.reporter(knownCatalog).report(input({workflow_id:14,id:401}))).action,'created');
  assert.equal(canonical.body, 'Owner notes');
});
