// D5681: all GitHub operations are faked. Tests cannot reach a real repository.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, openLedger, prepare, triage } from '../section-triage.mjs';

const input = { case: 'learning-discovery', episode: '10000000-0000-4000-8000-000000000001',
  count: 2, revision: 'a'.repeat(40), source: 'operator-reproduced', classification: 'ordinary-ui-regression' };
const actor = 'operator';
const owner = { login: 'fixture-maintainer', slot: 'S12' };
const fail = n => Object.assign(new Error('API rejection'), { status: n });

function fixture(t) {
  const db = openLedger(':memory:');
  t.after(() => db.close());
  const calls = [], comments = [];
  const state = { assignable: true, timeline: [], lostCreate: false, creator: actor, openIssues: [] };
  async function api(method, path, payload) {
    calls.push({ method, path, payload });
    if (path.startsWith('compare/')) return { status: 'identical', merge_base_commit: { sha: input.revision } };
    if (path.startsWith('labels/')) return { name: decodeURIComponent(path.slice(7)) };
    if (path.startsWith('assignees/')) { if (!state.assignable) throw fail(404); return null; }
    if (path.startsWith('issues?state=open&labels=')) return state.openIssues;
    if (method === 'POST' && path === 'issues') {
      if (state.rejectCreate) throw fail(state.rejectCreate);
      state.issue = { number: 17, state: 'open', user: { login: state.creator }, ...payload,
        assignees: (payload.assignees || []).map(login => ({ login })) };
      if (state.lostCreate) throw new Error('lost response');
      return state.issue;
    }
    if (path === 'issues/17' && state.issue) return state.issue;
    if (path.startsWith('git/ref/')) { if (state.claim) return {}; throw fail(404); }
    if (path.includes('/timeline?')) return state.timeline;
    if (method === 'POST' && path === 'issues/17/comments') {
      comments.push({ body: payload.body, user: { login: actor } });
      if (state.lostComment) throw new Error('lost response');
      return {};
    }
    if (path.includes('/comments?')) return comments;
    throw new Error('Unexpected fixture request');
  }
  return { state, calls, comments, api, db, run: (opts={}) => triage({ input, actor, db, api, ...opts }) };
}

test('offline public projection uses only trusted constants, SHA, count and opaque marker', async () => {
  const p = prepare(input);
  assert.equal(p.key, prepare({ ...input, count: 7 }).key);
  assert.match(p.key, /^[a-f0-9]{64}$/);
  const revisionUrl = `https://github.com/AxalNetwork/StudioOS/blob/${input.revision}`;
  assert.equal(p.issue.body, [
    'Learning discovery list rendering failed in a controlled reproduction.',
    'Section: all-learning. Cumulative observations at filing: 2.',
    `[Source at the observed revision](${revisionUrl}/frontend/src/pages/learning/LearningHome.jsx) · [Regression test](${revisionUrl}/frontend/test/learning_discovery_4648.test.mjs)`,
    'S01 triages the incident and authorizes any slot task. Recovery requires a verified release and healthy evidence.',
    `<!-- axal-section-incident:v1:${p.key} -->`,
  ].join('\n\n'));
  const fixtureFile = new URL('./section-triage-example.json',import.meta.url).pathname;
  assert.equal((await main([fixtureFile])).state, 'offline-preview');
  for (const bad of [{ ...input, url: 'customer' }, { ...input, source: 'github' },
    { ...input, classification: 'security' }, { ...input, case: 'billing' }, { ...input, count: 1.5 },
    { ...input, revision: 'refs/heads/untrusted' }, { ...input, case: '__proto__' }])
    assert.throws(() => prepare(bad));
});

test('first filing, cumulative duplicate and closed recurrence preserve the issue and human state', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.run(), { state: 'linked', issue: 17 });
  const recur = { ...input, count: 9 };
  await f.run({ input: recur });
  await f.run({ input: recur });
  await f.run({ input: { ...input,count: 4 } });
  assert.equal(f.calls.filter(x=>x.path==='issues').length,1);
  assert.equal(f.comments.length,1);
  assert.match(f.comments[0].body,/at least 8/);
  f.state.issue.state = 'closed';
  assert.equal((await f.run()).state,'closed-needs-recovery-verification');
  assert.ok(f.calls.every(x=>x.method!=='PATCH'));
});

test('confirmed rejection can retry; uncertain create reconciles only the original marker and actor', async t => {
  const f = fixture(t);
  f.state.rejectCreate = 429;
  await assert.rejects(f.run());
  f.state.rejectCreate = 0; f.state.lostCreate = true;
  await assert.rejects(f.run());
  assert.equal((await f.run()).state,'filing-uncertain');
  f.state.issue.user.login='someone-else';
  await assert.rejects(f.run({ linkIssue: 17 }),/marker/);
  f.state.issue.user.login=actor;
  assert.equal((await f.run({ linkIssue: 17 })).issue,17);
  assert.equal(f.calls.filter(c=>c.path==='issues').length,2);
});

test('ambiguous milestone delivery is reconciled from its original receipt, not posted again', async t => {
  const f=fixture(t);
  await f.run(); f.state.lostComment=true;
  const opts={ input:{...input,count:16} };
  await assert.rejects(f.run(opts));
  assert.equal((await f.run(opts)).issue,17);
  assert.equal(f.comments.length,1);
});

test('two connections on the same durable ledger cannot both create an issue', async t => {
  const dir=mkdtempSync(join(tmpdir(),'section-triage-')), path=join(dir,'ledger.db');
  const left=openLedger(path), right=openLedger(path);
  t.after(()=>{ left.close();right.close();rmSync(dir,{recursive:true,force:true}); });
  const f=fixture(t);
  const calls=await Promise.all([f.run({db:left}), f.run({db:right})]);
  assert.equal(f.calls.filter(c=>c.path==='issues').length,1);
  assert.ok(calls.some(x=>x.issue===17));
});

test('only a verified single assignee gets an S01 proposal; claims, linked work or state suppress it', async t => {
  const f=fixture(t);
  const opts={ owner, workOrder:true };
  const result=await f.run(opts);
  assert.equal(result.workOrder.slot,'S12');
  assert.equal(result.workOrder.disposition,'proposal-for-S01');
  f.state.claim=true;
  assert.equal((await f.run(opts)).workOrder,'existing-work-or-incomplete-history');
  f.state.claim=false; f.state.timeline=[{source:{issue:{state:'open',pull_request:{}}}}];
  assert.equal((await f.run(opts)).workOrder,'existing-work-or-incomplete-history');
  f.state.timeline=[]; f.state.issue.labels.push('state:review');
  assert.equal((await f.run(opts)).workOrder,'held-for-S01');
  assert.ok(f.calls.every(c=>!c.path.includes('dispatch')));
});

test('unassignable owner falls back to S01; no owner, example or unaccepted revision can trigger a repair', async t => {
  const f=fixture(t); f.state.assignable=false;
  assert.equal((await f.run({owner,workOrder:true})).workOrder,'held-for-S01');
  assert.equal(f.state.issue.assignees.length,0);
  await assert.rejects(f.run({input:{...input,source:'offline-fixture'}}),/cannot be applied/);
  const other=fixture(t);
  await assert.rejects(other.run({input:{...input,revision:'b'.repeat(40)}}),/not on/);
  assert.equal(other.calls.filter(c=>c.method==='POST').length,0);
});

test('only S01 explicitly enrolls an eligible fresh issue with both labels and one validated assignee', async t => {
  const f = fixture(t);
  const opts = { owner, queueForSlot: true, actor: 'guillaumelauzier' };
  await assert.rejects(f.run({ ...opts, actor }), /orchestration owner/);
  f.state.creator = opts.actor; f.state.assignable = false;
  await assert.rejects(f.run(opts), /verified assignee/);
  f.state.assignable = true; f.state.openIssues = [{ title: prepare(input).issue.title }];
  assert.equal((await f.run(opts)).state, 'similar-task-or-incomplete-history');
  f.state.openIssues = [];
  assert.equal((await f.run(opts)).state, 'queued-for-slot');
  assert.deepEqual(f.state.issue.labels.slice(-2), ['slot:S12','state:ready']);
  assert.match(f.state.issue.body, /^S1:/);
  assert.equal((await f.run(opts)).workOrder, 'existing-issue-needs-S01-review');
  assert.equal(f.calls.filter(x => x.method === 'POST' && x.path === 'issues').length, 1);
  assert.ok(f.calls.every(x => !x.path.includes('dispatch') && !x.path.includes('git/refs')));
});
