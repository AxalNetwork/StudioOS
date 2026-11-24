/** D6935: reconcile scanner facts; exercise transport and scanner scope at their entry points. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { githubApi } from './github.mjs';
import { reconcile } from './run.mjs';
import { selectScope } from '../scan-scope.mjs';

const options = { owner: 'AxalNetwork', repo: 'StudioOS', defaultBranch: 'main', runNumber: 1, botLogin: 'github-actions[bot]' };
const ref = 'refs/heads/main';
const alert = (number, state = 'open') => ({ number, state, tool: { name: 'CodeQL' }, most_recent_instance: { ref, state } });
function fixture(rows, { tracked = [], pulls = [], claimed = [] } = {}) {
  const calls = [];
  const api = {
    pages: async path => {
      if (path === '/code-scanning/alerts?state=open&ref=refs%2Fheads%2Fmain') return rows.filter(a => a.state === 'open' && a.most_recent_instance.ref === ref);
      assert.equal(path, '/pulls?state=open&base=main');
      return pulls;
    },
    request: async (method, path) => {
      assert.equal(method, 'GET');
      const row = rows.find(a => path === '/code-scanning/alerts/' + a.number);
      assert.ok(row); return row;
    },
  };
  const trackers = {
    trackedNumbers: () => tracked,
    ensure: async n => { calls.push(['ensure', n]); return { issue: { number: 500 + n }, actionable: !claimed.includes(n) }; },
    closeFixed: async a => calls.push(['fixed', a.number]),
    markReady: async i => calls.push(['ready', i.number]),
    linkPull: async (i, p) => calls.push(['linked', i.number, p]),
    linkPulls: async (i, numbers) => { for (const p of numbers) calls.push(['linked', i.number, p]); },
  };
  const deps = {
    loadTrackers: async () => trackers,
  };
  return { calls, run: (extra = {}) => reconcile(api, { ...options, ...extra }, deps) };
}

test('rotates bounded windows across open and fixed work, including a short last batch', async () => {
  const rows = Array.from({ length: 33 }, (_, i) => alert(i + 1, i < 11 ? 'open' : 'fixed'));
  const tracked = rows.map(x => x.number);
  const f = fixture(rows, { tracked });
  assert.equal(await f.run(), 25);
  assert.equal(await f.run({ runNumber: 2 }), 7);
  assert.equal(await f.run({ runNumber: 3 }), 21);
  assert.deepEqual(f.calls.filter(([k]) => k === 'ensure').map(([, n]) => n), tracked.slice(0, 11));
  assert.deepEqual(f.calls.filter(([k]) => k === 'fixed').slice(0, 22).map(([, n]) => n), tracked.slice(11));
});
test('explicit alert respects dismissed, wrong-ref, assigned and claimed work', async () => {
  const rows = [alert(1, 'dismissed'), alert(2), alert(3), alert(4), alert(5)];
  rows[1].most_recent_instance.ref = 'refs/pull/21/merge';
  rows[2].assignees = [{ login: 'maintainer' }];
  rows[4].most_recent_instance.state = 'fixed';
  const f = fixture(rows, { claimed: [4] });
  for (const a of rows) await f.run({ alertNumber: a.number });
  assert.deepEqual(f.calls, [['ensure', 3], ['ensure', 4]]);
  await assert.rejects(f.run({ alertNumber: 0 }), /Invalid/);
});
test('every scanner hands unassigned findings to S21 without requesting a generated fix', async () => {
  const semgrep = alert(1); semgrep.tool.name = 'Semgrep';
  const thirdParty = alert(3); thirdParty.tool.name = 'another scanner';
  const f = fixture([semgrep, alert(2), thirdParty]);
  await f.run();
  assert.deepEqual(f.calls, [['ensure', 1], ['ready', 501], ['ensure', 2], ['ready', 502], ['ensure', 3], ['ready', 503]]);
});
test('links human and legacy bot PRs without editing them and ignores fork PRs', async () => {
  const pr = (number, repo, ref, n) => ({ number, state: 'open', base: {ref:'main'}, head: {ref, repo:{full_name:repo}},
    body: '(https://github.com/AxalNetwork/StudioOS/security/code-scanning/' + n + ')', user: { login: options.botLogin } });
  const pulls = [pr(77, 'AxalNetwork/StudioOS', 'custom', 1), pr(78, 'fork/StudioOS', 'custom', 2),
    pr(79, 'AxalNetwork/StudioOS', 'alert-autofix-3', 3), pr(80, 'AxalNetwork/StudioOS', 'alert-fix-4', 4)];
  pulls[0].user.login = 'maintainer';
  const f = fixture([alert(1), alert(2), alert(3), alert(4)], {pulls});
  await f.run();
  assert.deepEqual(f.calls, [['ensure',1],['linked',501,77],['ensure',2],['ready',502],
    ['ensure',3],['linked',503,79],['ensure',4],['linked',504,80]]);
});
test('real tracker reconciliation writes only one issue and its ready label across repeat CodeQL sweeps', async () => {
  const requests = [];
  let issue;
  const api = githubApi(options.owner, options.repo, 'test', async (url, request) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace('/repos/AxalNetwork/StudioOS', '');
    const method = request.method;
    requests.push([method, path]);
    if (method === 'GET') {
      if (path === '/issues') return Response.json(issue ? [issue] : []);
      if (path === '/search/issues') return Response.json({ total_count: 0, incomplete_results: false, items: [] });
      if (path === '/code-scanning/alerts') return Response.json([alert(42)]);
      if (path === '/code-scanning/alerts/42') return Response.json(alert(42));
      if (path === '/pulls') return Response.json([]);
      if (path === '/issues/900') return Response.json(issue);
      if (path === '/issues/900/comments') return Response.json([]);
      if (path === '/git/ref/heads/claim/900') return new Response(null, { status: 404 });
    }
    if (method === 'POST' && path === '/issues') {
      const body = JSON.parse(request.body);
      issue = { ...body, number: 900, state: 'open', user: { login: options.botLogin },
        labels: body.labels.map(name => ({ name })), assignees: [] };
      return Response.json(issue);
    }
    if (method === 'POST' && path === '/issues/900/labels') {
      issue.labels.push(...JSON.parse(request.body).labels.map(name => ({ name })));
      return Response.json(issue.labels);
    }
    throw Error('Unexpected reconciliation request: ' + method + ' ' + path);
  });
  assert.equal(await reconcile(api, options), 1);
  assert.equal(await reconcile(api, options), 1);
  assert.deepEqual(issue.labels.map(label => label.name), ['bug', 'slot:S21', 'sla:7d', 'state:ready']);
  assert.deepEqual(requests.filter(([method]) => method !== 'GET'), [
    ['POST', '/issues'], ['POST', '/issues/900/labels'],
  ]);
  assert.ok(requests.every(([, path]) => !path.includes('/autofix') && !path.includes('/commits')));
});

const trackerPR = (number, body, extra = {}) => ({ number, state: 'open', body,
  base: { ref: 'main' }, head: { ref: 'session-work', repo: { full_name: 'AxalNetwork/StudioOS' } }, ...extra });

test('one PR can hand off several exact tracker references without protected alert links', async () => {
  const f = fixture([alert(1), alert(2), alert(3)], { pulls: [trackerPR(77,
    'Closes #501. Part of AxalNetwork/StudioOS#502; also https://github.com/axalnetwork/studioos/issues/503.')] });
  await f.run();
  assert.deepEqual(f.calls, [['ensure', 1], ['linked', 501, 77], ['ensure', 2], ['linked', 502, 77],
    ['ensure', 3], ['linked', 503, 77]]);
});

test('unrelated, closed, fork, wrong-base and example references never take a tracker out of ready', async () => {
  const rejected = [
    trackerPR(77, 'Closes #501', { state: 'closed' }),
    trackerPR(77, 'Closes #501', { head: { repo: { full_name: 'fork/StudioOS' } } }),
    trackerPR(77, 'Closes #501', { base: { ref: 'feature' } }),
    trackerPR(77, 'Closes other/repository#501'),
    trackerPR(77, 'Closes https://github.com/other/repository/issues/501'),
    trackerPR(77, 'Closes https://example.org/#501'),
    trackerPR(77, 'Closes #5010; alert #501 and finding number #501'),
    trackerPR(77, 'Alerts #501 and #502\nAlert: #501\nFindings:\n- #501\n- #502'),
    trackerPR(77, 'Example: `Closes #501`\n```text\nCloses #501\n```\n<!-- Closes #501 -->'),
    trackerPR(77, '~~~text\nCloses #501\n~~~\n    Closes #501\n> Closes #501\n``Closes #501``'),
    trackerPR(77, '~~~text\nhttps://github.com/AxalNetwork/StudioOS/security/code-scanning/1\n~~~'),
  ];
  for (const pull of rejected) {
    const f = fixture([alert(1)], { pulls: [pull] });
    await f.run();
    assert.deepEqual(f.calls, [['ensure', 1], ['ready', 501]], pull.body);
  }
});

test('explicit tracker context after alert numbers remains actionable for a shared PR', async () => {
  const f = fixture([alert(1), alert(2)], { pulls: [trackerPR(77, 'Alerts #9 and #10; fixes #501, #502.')] });
  await f.run();
  assert.deepEqual(f.calls, [['ensure', 1], ['linked', 501, 77], ['ensure', 2], ['linked', 502, 77]]);
});

test('duplicate references converge and all partial PRs are preserved without selecting one arbitrarily', async () => {
  const body = 'Closes #501, AxalNetwork/StudioOS#501. https://github.com/AxalNetwork/StudioOS/security/code-scanning/1';
  const one = fixture([alert(1)], { pulls: [trackerPR(77, body)] });
  await one.run();
  assert.deepEqual(one.calls, [['ensure', 1], ['linked', 501, 77]]);
  const several = fixture([alert(1)], { pulls: [trackerPR(77, body), trackerPR(78, 'Refs #501')] });
  await several.run();
  assert.deepEqual(several.calls, [['ensure', 1], ['linked', 501, 77], ['linked', 501, 78]]);
});
test('REST transport accepts triple-dot comparison; pagination is complete and errors redact responses', async () => {
  const seen = [];
  const api = githubApi('AxalNetwork','StudioOS','test', async (url, options) => {
    seen.push(url); assert.equal(options.redirect, 'error');
    if (url.endsWith('/labels/state%3Aready')) return new Response(null, {status:204});
    if (url.includes('/compare/')) return Response.json({ahead_by:1});
    if (url.includes('/forbidden')) return new Response('sensitive error detail', {status:403});
    if (url.includes('/search/issues')) return Response.json({total_count:1,items:[{number:1}],incomplete_results:false});
    const page = new URL(url).searchParams.get('page');
    return Response.json(page === '1' ? Array(100).fill(1) : [2]);
  });
  assert.deepEqual(await api.request('GET','/compare/'+'a'.repeat(40)+'...'+'b'.repeat(40)), {ahead_by:1});
  assert.equal(await api.request('DELETE','/issues/1/labels/state%3Aready'), null);
  assert.equal((await api.pages('/issues?state=all')).length,101);
  assert.equal((await api.searchIssues('is:issue')).length,1);
  assert.throws(() => api.request('GET','/../other'), /Invalid/);
  await assert.rejects(api.request('GET','/forbidden'), {message:'GitHub HTTP 403',status:403});
  assert.ok(seen.every(x => new URL(x).hostname === 'api.github.com'));
});
test('initial bot draft selects scanners before labeling; fork and human PRs retain normal scoping', async () => {
  const dir = mkdtempSync(join(tmpdir(),'scan-scope-'));
  try {
    const path = join(dir,'event.json');
    const env = {GITHUB_REPOSITORY:'AxalNetwork/StudioOS',GITHUB_RUN_ID:'1',GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:path};
    for (const [login, repo, branch, expected] of [
      [options.botLogin, env.GITHUB_REPOSITORY,'alert-autofix-231',true],
      [options.botLogin, env.GITHUB_REPOSITORY,'alert-fix-231',true],
      ['someone', env.GITHUB_REPOSITORY,'alert-fix-231',false],
      [options.botLogin, 'fork/StudioOS','alert-fix-231',false],
      [options.botLogin, env.GITHUB_REPOSITORY,'ordinary-work',false],
    ]) {
      writeFileSync(path, JSON.stringify({pull_request:{number:5,user:{login},head:{ref:branch,repo:{full_name:repo}}}}));
      assert.equal(await selectScope(env, async () => [{filename:'README.md'}]), expected);
    }
  } finally { rmSync(dir, {recursive:true,force:true}); }
});

test('only the exact pull-creation policy response allows a manual PR handoff', async () => {
  let message = 'GitHub Actions is not permitted to create or approve pull requests.';
  const api = githubApi('AxalNetwork','StudioOS','test', async () => Response.json({message}, {status:403}));
  await assert.rejects(api.request('POST','/pulls',{}), {status:403,prCreationDisabled:true});
  await assert.rejects(api.request('POST','/issues',{}), {status:403,prCreationDisabled:false});
  message = 'Resource not accessible by integration';
  await assert.rejects(api.request('POST','/pulls',{}), {status:403,prCreationDisabled:false});
});
