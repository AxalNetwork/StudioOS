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
function fixture(rows, { tracked = [], pulls = [], claimed = [], fix = 'manual' } = {}) {
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
    linkPrepared: async (i, branch) => calls.push(['prepared', i.number, branch]),
    markReady: async i => calls.push(['ready', i.number]),
    linkPull: async (i, p) => calls.push(['linked', i.number, p]),
  };
  const deps = {
    loadTrackers: async () => trackers,
    prepareFix: async (_api, ctx) => { calls.push(['proposed', ctx.number]); return { status: fix, prNumber: 77, branch: 'alert-autofix-' + ctx.number }; },
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
test('manual fallback, pending, and confirmed PR outcomes have distinct issue transitions', async () => {
  const unsupported = alert(1); unsupported.tool.name = 'Semgrep';
  const f = fixture([unsupported, alert(2)]);
  await f.run();
  assert.deepEqual(f.calls, [['ensure', 1], ['ready', 501], ['ensure', 2], ['proposed', 2], ['ready', 502]]);
  for (const [fix, expected] of [['pending', []], ['pull_request', [['linked', 501, 77]]]]) {
    const g = fixture([alert(1)], { fix });
    await g.run(); assert.deepEqual(g.calls.slice(2), expected);
  }
});
test('a confirmed PR policy refusal links the prepared branch and continues to the next alert', async () => {
  const f = fixture([alert(1), alert(2)], {fix:'pr_permission'});
  await f.run();
  assert.deepEqual(f.calls.filter(([name]) => name === 'prepared'),
    [['prepared',501,'alert-autofix-1'], ['prepared',502,'alert-autofix-2']]);
});
test('links human same-repo custom PR, ignores a fork, and recovers bot PR missing its label', async () => {
  const pr = (number, repo, ref, n) => ({ number, base: {ref:'main'}, head: {ref, repo:{full_name:repo}},
    body: '(https://github.com/AxalNetwork/StudioOS/security/code-scanning/' + n + ')', user: { login: options.botLogin } });
  const pulls = [pr(77, 'AxalNetwork/StudioOS', 'custom', 1), pr(78, 'fork/StudioOS', 'custom', 2),
    pr(79, 'AxalNetwork/StudioOS', 'alert-autofix-3', 3)];
  const f = fixture([alert(1), alert(2), alert(3)], {pulls, fix: 'pending'});
  await f.run();
  assert.deepEqual(f.calls, [['ensure',1],['linked',501,77],['ensure',2],['proposed',2],['ensure',3],['proposed',3]]);
});
test('REST transport accepts triple-dot comparison; pagination is complete and errors redact responses', async () => {
  const seen = [];
  const api = githubApi('AxalNetwork','StudioOS','test', async (url, options) => {
    seen.push(url); assert.equal(options.redirect, 'error');
    if (url.endsWith('/autofix')) return new Response(null, {status:202});
    if (url.includes('/compare/')) return Response.json({ahead_by:1});
    if (url.includes('/forbidden')) return new Response('sensitive error detail', {status:403});
    if (url.includes('/search/issues')) return Response.json({total_count:1,items:[{number:1}],incomplete_results:false});
    const page = new URL(url).searchParams.get('page');
    return Response.json(page === '1' ? Array(100).fill(1) : [2]);
  });
  assert.deepEqual(await api.request('GET','/compare/'+'a'.repeat(40)+'...'+'b'.repeat(40)), {ahead_by:1});
  assert.equal(await api.request('POST','/code-scanning/alerts/1/autofix'), null);
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
