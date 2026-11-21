/** D6476-p5 (#6476 owner addition): the PR-list `conflict` indicator: add on a confirmed conflict, clear only on fresh positive mergeability, metadata only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { confirmsClear, listAction, sweep } from '../../scripts/landing-bot/conflict-indicator.mjs';
import { parseJobs } from '../../scripts/landing-bot/workflowGuard.mjs';

const ROOT = new URL('../../', import.meta.url);
const WORKFLOW = readFileSync(new URL('.github/workflows/landing-conflict-indicator.yml', ROOT), 'utf8');
const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

test('listAction: a confirmed conflict adds; unknown never adds or clears; only main is in scope', () => {
  assert.equal(listAction({ baseRef: 'main', mergeable: 'CONFLICTING', labels: [] }), 'add', 'green or pending checks do not matter');
  assert.equal(listAction({ baseRef: 'main', mergeable: 'CONFLICTING', labels: [{ name: 'conflict' }] }), 'none', 'already shown');
  assert.equal(listAction({ baseRef: 'main', mergeable: 'MERGEABLE', labels: ['conflict'] }), 'confirm-clear');
  assert.equal(listAction({ baseRef: 'main', mergeable: 'MERGEABLE', labels: [] }), 'none');
  for (const m of ['UNKNOWN', null, undefined]) {
    assert.equal(listAction({ baseRef: 'main', mergeable: m, labels: ['conflict'] }), 'none', `${m}: no false clear`);
    assert.equal(listAction({ baseRef: 'main', mergeable: m, labels: [] }), 'none', `${m}: no add on an uncomputed state`);
  }
  assert.equal(listAction({ baseRef: 'release', mergeable: 'CONFLICTING', labels: [] }), 'none');
});

test('confirmsClear: only a fresh true on the same head against the current main', () => {
  const fresh = (over = {}) => ({ mergeable: true, head: { sha: HEAD }, base: { ref: 'main', sha: MAIN }, ...over });
  assert.equal(confirmsClear({ headSha: HEAD }, fresh(), MAIN).ok, true);
  assert.match(confirmsClear({ headSha: HEAD }, fresh({ mergeable: null }), MAIN).reasons.join(), /not true/);
  assert.match(confirmsClear({ headSha: HEAD }, fresh({ mergeable: false }), MAIN).reasons.join(), /not true/);
  assert.match(confirmsClear({ headSha: HEAD }, fresh({ head: { sha: 'c'.repeat(40) } }), MAIN).reasons.join(), /head moved/);
  assert.match(confirmsClear({ headSha: HEAD }, fresh({ base: { ref: 'main', sha: 'd'.repeat(40) } }), MAIN).reasons.join(), /current main/);
  assert.match(confirmsClear({ headSha: HEAD }, fresh(), null).reasons.join(), /current main/, 'main unread is not current');
  assert.equal(confirmsClear({ headSha: HEAD }, null, MAIN).ok, false);
});

/** An in-memory GitHub for the sweep. */
function world(prs, { mainSha = MAIN, fresh = {} } = {}) {
  const writes = [];
  const state = Object.fromEntries(prs.map((p) => [p.number, { ...p, labels: [...p.labels] }]));
  const gh = {
    graph: async () => ({ pullRequests: { pageInfo: { hasNextPage: false }, nodes: Object.values(state).map((p) => ({
      number: p.number, mergeable: p.mergeable, baseRefName: 'main', headRefOid: p.head, labels: { nodes: p.labels.map((name) => ({ name })) } })) } }),
    get: async (path) => {
      if (path === 'branches/main') return { commit: { sha: mainSha } };
      const n = Number(/^pulls\/(\d+)$/.exec(path)?.[1]);
      if (fresh[n] instanceof Error) throw fresh[n];
      return fresh[n] ?? { mergeable: state[n].mergeable === 'MERGEABLE', head: { sha: state[n].head }, base: { ref: 'main', sha: mainSha } };
    },
    post: async (path, body) => { writes.push(['POST', path]); const n = Number(path.split('/')[1]); for (const l of body.labels) if (!state[n].labels.includes(l)) state[n].labels.push(l); },
    del: async (path) => { writes.push(['DELETE', path]); const n = Number(path.split('/')[1]); state[n].labels = state[n].labels.filter((l) => !path.endsWith(`/${l}`)); },
  };
  return { gh, writes, state };
}

test('sweep: green-but-conflicted is shown, a resolved one cleared, unknown left, and a repeat sweep writes nothing', async () => {
  const { gh, writes, state } = world([
    { number: 1, mergeable: 'CONFLICTING', head: HEAD, labels: ['state:review'] },
    { number: 2, mergeable: 'MERGEABLE', head: HEAD, labels: ['conflict', 'bot:off'] },
    { number: 3, mergeable: 'UNKNOWN', head: HEAD, labels: ['conflict'] },
    { number: 4, mergeable: 'MERGEABLE', head: HEAD, labels: [] },
  ]);
  await sweep({}, { gh });
  assert.deepEqual(state[1].labels, ['state:review', 'conflict'], 'added, every other label kept');
  assert.deepEqual(state[2].labels, ['bot:off'], 'cleared on a fresh true; bot:off untouched');
  assert.deepEqual(state[3].labels, ['conflict'], 'unknown: no false clear');
  assert.deepEqual(state[4].labels, []);
  const before = writes.length;
  await sweep({}, { gh });
  assert.equal(writes.length, before, 'idempotent');
});

test('sweep: a moved head, a base behind main, or an unreadable fresh read keeps the label', async () => {
  const moved = world([{ number: 5, mergeable: 'MERGEABLE', head: HEAD, labels: ['conflict'] }], { fresh: { 5: { mergeable: true, head: { sha: 'c'.repeat(40) }, base: { ref: 'main', sha: MAIN } } } });
  await sweep({}, { gh: moved.gh });
  assert.deepEqual(moved.state[5].labels, ['conflict']);
  const staleBase = world([{ number: 6, mergeable: 'MERGEABLE', head: HEAD, labels: ['conflict'] }], { fresh: { 6: { mergeable: true, head: { sha: HEAD }, base: { ref: 'main', sha: 'e'.repeat(40) } } } });
  await sweep({}, { gh: staleBase.gh });
  assert.deepEqual(staleBase.state[6].labels, ['conflict'], 'main moved: re-evaluated on the next push to main');
  const unread = world([{ number: 7, mergeable: 'MERGEABLE', head: HEAD, labels: ['conflict'] }], { fresh: { 7: new Error('HTTP 502') } });
  await sweep({}, { gh: unread.gh });
  assert.deepEqual(unread.state[7].labels, ['conflict']);
});

test('the workflow: its own switch, GITHUB_TOKEN only, label writes only, and re-run after main moves', () => {
  assert.match(WORKFLOW, /vars\.LANDING_CONFLICT_LABELS == 'true'/);
  const code = WORKFLOW.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /LANDING_BOT_ENABLED|secrets\.|create-github-app-token|APP_TOKEN/, 'independent of the repair bots and the App');
  assert.match(WORKFLOW, /^\s+push:\s*\n\s+branches: \[main\]/m, 'a push to main re-evaluates every PR');
  assert.doesNotMatch(WORKFLOW, /^\s*(?:pull_request|pull_request_target|workflow_run|issue_comment):/m);
  const { jobs } = parseJobs(WORKFLOW);
  assert.deepEqual(jobs.map((j) => j.id), ['indicate']);
  const body = jobs[0].lines.join('\n');
  assert.match(body, /contents: read/);
  assert.doesNotMatch(body, /contents: write|actions: write/, 'no push, no dispatch');
  const src = readFileSync(new URL('scripts/landing-bot/conflict-indicator.mjs', ROOT), 'utf8');
  // Code only (comments explain what it never does): no enqueue, merge, update-branch, merge API, dispatch or rerun.
  const srcCode = src.split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');
  assert.doesNotMatch(srcCode, /enqueuePullRequest|mergePullRequest|update-branch|\/merges\b|\/dispatches|\/rerun/, 'metadata only');
  assert.match(srcCode, /issues\/\$\{pr\.number\}\/labels/, 'its only writes are labels');
});
