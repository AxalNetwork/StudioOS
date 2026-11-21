/**
 * #6476 S1 (2026-11-21): a retryable wait is not a hand-back. The real sweep() runs against an in-memory GitHub, so
 * the composed sequence (conflict, keeper merge, pending checks, green checks) is exercised end to end, not just
 * decide() in isolation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { decide, evidenceState, keeperMergedSince, RECOVERY_WINDOW_HOURS, RETRYABLE_ELIGIBILITY } from '../../scripts/landing-bot/ejection-rules.mjs';
import { candidates, normalise, stickyLine, sweep } from '../../scripts/landing-bot/ejection.mjs';
import { eligible, STICKY_MARKER } from '../../scripts/landing-bot/rules.mjs';

const BOT = 'axal-landing-bot[bot]';
const REPO = 'AxalNetwork/StudioOS';
const T = (min) => new Date(Date.parse('2026-11-21T10:00:00Z') + min * 60_000).toISOString();
const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);
const ENV = { GITHUB_REPOSITORY: REPO, LANDING_BOT_LOGIN: BOT, LANDING_BOT_ENABLED: 'true', GITHUB_EVENT_NAME: 'schedule',
  LANDING_BOT_DAILY_REQUEUES: '10', LANDING_BOT_QUEUE_FAIL_BREAKER: '0.5' };
const person = { login: 'guillaumelauzier', __typename: 'User' };
const github = { login: 'github', __typename: 'Bot' };
const work = (sha, at) => ({ sha, parents: [{}], author: { login: 'dev' }, committer: { login: 'dev' }, commit: { message: 'work', committer: { date: at } } });
const keeperMerge = (sha, at) => ({ sha, parents: [{}, {}], author: { login: BOT }, committer: { login: BOT }, commit: { message: 'Merge main\n\nLanding-Bot-Kind: keeper', committer: { date: at } } });
const green = (sha) => ({ ok: true, headSha: sha, fullSuitePassed: true, required: { missing: [], pending: [], failing: [] }, detail: 'all green' });
const pending = (sha) => ({ ok: false, headSha: sha, fullSuitePassed: false, required: { missing: [], pending: ['test:drift (full suite)'], failing: [] }, detail: 'pending: test:drift (full suite)' });
const failed = (sha) => ({ ok: false, headSha: sha, fullSuitePassed: false, required: { missing: [], pending: [], failing: ['test:drift (full suite) (failure)'] }, detail: 'not success' });

/** One PR in an in-memory GitHub; every write the App makes is recorded. */
function world({ removalReason = 'MERGE_CONFLICT' } = {}) {
  const s = {
    head: SHA1, mergeable: 'CONFLICTING', draft: false, labels: [], inQueue: false,
    timeline: [
      { __typename: 'AddedToMergeQueueEvent', createdAt: T(0), actor: person },
      { __typename: 'RemovedFromMergeQueueEvent', createdAt: T(5), actor: github, reason: removalReason, beforeCommit: { oid: SHA1 } },
    ],
    commits: [work(SHA1, T(-60))], comments: [], evidence: green(SHA1), evidenceThrows: false,
    writes: [], enqueues: [], mainGreen: true,
  };
  const node = () => ({
    id: 'PR_7', number: 7, state: 'OPEN', isDraft: s.draft, body: '', isInMergeQueue: s.inQueue, mergeable: s.mergeable,
    headRefName: 'agent/x', headRefOid: s.head, headRepository: { nameWithOwner: REPO }, baseRepository: { nameWithOwner: REPO },
    labels: { nodes: s.labels.map((name) => ({ name })) }, autoMergeRequest: null, timelineItems: { nodes: s.timeline },
  });
  const gh = {
    graph: async () => ({ pullRequests: { nodes: [node()] } }),
    get: async (p) => {
      if (p.startsWith('actions/workflows/ci.yml/runs?branch=main&event=push&per_page=20')) return { workflow_runs: [{ id: 1, event: 'push', head_branch: 'main', status: 'completed', conclusion: s.mainGreen ? 'success' : 'failure', created_at: T(-30) }] };
      if (p.startsWith('actions/workflows/ci.yml/runs?branch=main&event=push&status=completed')) return { workflow_runs: [{ id: 1, conclusion: s.mainGreen ? 'success' : 'failure' }] };
      if (p.startsWith('actions/workflows/ci.yml/runs?event=merge_group&status=completed')) return { workflow_runs: Array(20).fill({ conclusion: 'success' }) };
      if (p.startsWith('actions/workflows/ci.yml/runs')) return { workflow_runs: [] };
      if (p.startsWith('actions/runs/1/jobs')) return { jobs: [] };
      if (p.startsWith('issues?state=open')) return [];
      if (p === 'pulls/7/files?per_page=100') return [{ filename: 'frontend/src/a.js' }];
      if (p === 'pulls/7/commits?per_page=100') return s.commits;
      if (p === 'pulls/7') return { number: 7, mergeable: { CONFLICTING: false, MERGEABLE: true }[s.mergeable] ?? null, head: { sha: s.head } };
      if (p === 'issues/7/comments?per_page=100') return s.comments;
      throw new Error(`unexpected GET ${p}`);
    },
  };
  const app = {
    graph: async (_q, v) => { s.enqueues.push(v.oid); s.inQueue = true; s.timeline.push({ __typename: 'AddedToMergeQueueEvent', createdAt: s.now, actor: { login: BOT, __typename: 'Bot' } }); },
    post: async (p, b) => {
      s.writes.push(['POST', p]);
      if (p === 'issues/7/labels') { for (const l of b.labels) if (!s.labels.includes(l)) { s.labels.push(l); s.timeline.push({ __typename: 'LabeledEvent', createdAt: s.now, actor: { login: BOT, __typename: 'Bot' }, label: { name: l } }); } }
      if (p === 'issues/7/comments') s.comments.push({ id: 900, user: { login: BOT, type: 'Bot' }, body: b.body });
    },
    patch: async (p, b) => { s.writes.push(['PATCH', p]); s.comments[0].body = b.body; },
    del: async (p) => { s.writes.push(['DELETE', p]); s.labels = s.labels.filter((l) => !p.endsWith(`/${l}`)); },
  };
  const run = async (min) => {
    s.now = T(min);
    const evidence = async (_n, sha) => { if (s.evidenceThrows) throw new Error('HTTP 502'); return { ...s.evidence, headSha: s.evidence.headSha ?? sha }; };
    return sweep(ENV, { gh, app, now: Date.parse(T(min)), evidence });
  };
  return { s, run };
}

test('#6476 S1: conflict → keeper merge → pending checks → green → exactly one native re-queue', async () => {
  const { s, run } = world();
  // First sweep after the conflict ejection: the keeper is asked, nothing is labelled.
  assert.deepEqual((await run(10)).keeper, [7]);
  assert.deepEqual(s.labels, []);
  // The keeper's no-model merge clears the conflict; the repaired head's checks are still running.
  s.head = SHA2; s.mergeable = 'MERGEABLE'; s.commits.push(keeperMerge(SHA2, T(15))); s.evidence = pending(SHA2);
  await run(20);
  assert.deepEqual(s.labels, [], 'pending checks wait; they are not a hand-back');
  assert.deepEqual(s.enqueues, []);
  assert.match(s.comments[0].body, /Waiting, not labelled: required checks are still running/);
  // A duplicate sweep with the same facts writes nothing at all.
  const before = s.writes.length;
  await run(30);
  assert.equal(s.writes.length, before, 'an unchanged wait writes no label and no comment');
  // The same repaired head goes green: the removal is reconsidered and restored once, on that head.
  s.evidence = green(SHA2);
  await run(40);
  assert.deepEqual(s.enqueues, [SHA2], 'restored with expectedHeadOid set to the repaired head');
  // Later sweeps (and a duplicate one) see the new entry and do nothing more.
  await run(50); await run(50);
  assert.deepEqual(s.enqueues, [SHA2], 'exactly one re-queue');
  assert.deepEqual(s.labels, []);
});

test('#6476 S1: the keeper is asked once, not on every sweep, and an unresolved conflict is never re-queued', async () => {
  const { s, run } = world();
  assert.deepEqual((await run(10)).keeper, [7]);
  assert.deepEqual((await run(20)).keeper, [7], 'the second sweep inside KEEPER_DISPATCH_MINUTES may ask again');
  assert.deepEqual((await run(30)).keeper, [], 'past KEEPER_DISPATCH_MINUTES the keeper\'s own schedule runs');
  assert.deepEqual(s.labels, []);
  assert.match(s.comments[0].body, /waiting for the branch keeper/);
  // The keeper merged main and GitHub still reports a conflict: a person resolves it.
  s.head = SHA2; s.commits.push(keeperMerge(SHA2, T(35)));
  await run(40);
  assert.deepEqual(s.labels, ['ejected']);
  assert.deepEqual(s.enqueues, []);
  assert.match(s.comments[0].body, /a person resolves it/);
  // Handed back: later sweeps leave it alone.
  const before = s.writes.length;
  await run(50);
  assert.equal(s.writes.length, before);
});

test('#6476 S1: failed checks, a non-keeper commit, a manual removal and a draft hand back at once', async () => {
  {
    const { s, run } = world();
    s.head = SHA2; s.mergeable = 'MERGEABLE'; s.commits.push(keeperMerge(SHA2, T(15))); s.evidence = failed(SHA2);
    await run(20);
    assert.deepEqual([s.labels, s.enqueues], [['ejected'], []], 'failed evidence is never success and never waits');
    assert.match(s.comments[0].body, /a required check failed/);
  }
  {
    const { s, run } = world();
    s.head = SHA2; s.mergeable = 'MERGEABLE'; s.commits.push(work(SHA2, T(15))); s.evidence = green(SHA2);
    await run(20);
    assert.deepEqual([s.labels, s.enqueues], [['ejected'], []], 'a commit other than a no-model merge voids consent');
    assert.match(s.comments[0].body, /not a no-model merge of main/);
  }
  {
    const { s, run } = world({ removalReason: 'MANUAL' });
    s.timeline[1].actor = person; s.mergeable = 'MERGEABLE';
    await run(10);
    assert.deepEqual([s.labels, s.enqueues], [['ejected'], []], 'a person\'s removal is theirs');
  }
});

test('#6476 S1: unreadable evidence and a temporary breaker wait, then recover; the window bounds the wait', async () => {
  const { s, run } = world({ removalReason: 'QUEUE_CLEARED' });
  s.mergeable = 'MERGEABLE';
  s.evidenceThrows = true;
  await run(10);
  assert.deepEqual([s.labels, s.enqueues], [[], []], 'an unreadable read waits; it is not success');
  assert.match(s.comments[0].body, /could not be confirmed/);
  s.evidenceThrows = false; s.mainGreen = false;
  await run(20);
  assert.deepEqual([s.labels, s.enqueues], [[], []], 'a red main is a breaker that resets');
  assert.match(s.comments[0].body, /main is red/);
  s.mainGreen = true;
  await run(30);
  assert.deepEqual(s.enqueues, [SHA1], 'recovered once the breaker closed');

  const late = world({ removalReason: 'QUEUE_CLEARED' });
  late.s.mergeable = 'MERGEABLE'; late.s.evidence = pending(SHA1);
  await late.run(RECOVERY_WINDOW_HOURS * 60 + 10);
  assert.deepEqual([late.s.labels, late.s.enqueues], [['ejected'], []], 'past the window the wait is handed back');
  assert.match(late.s.comments[0].body, /24 hours after the ejection: the owner re-queues it/);
});

test('#6476 S1: a head that moves between reads waits for the new head; expectedHeadOid is the head read', async () => {
  const { s, run } = world({ removalReason: 'QUEUE_CLEARED' });
  s.mergeable = 'MERGEABLE';
  s.evidence = { ...green(SHA2), headSha: SHA2 };
  await run(10);
  assert.deepEqual(s.enqueues, [], 'evidence for another head is not evidence for this one');
  assert.match(s.comments[0].body, /head moved while its checks were read/);
});

test('#6476 S1: a stranded App label from before the cutover gets one bounded look; a person\'s label never does', async () => {
  const stranded = world({ removalReason: 'QUEUE_CLEARED' });
  stranded.s.mergeable = 'MERGEABLE';
  stranded.s.labels = ['ejected'];
  stranded.s.timeline.push({ __typename: 'LabeledEvent', createdAt: '2026-11-20T23:00:00Z', actor: { login: BOT, __typename: 'Bot' }, label: { name: 'ejected' } });
  stranded.s.timeline[0].createdAt = '2026-11-20T22:00:00Z'; stranded.s.timeline[1].createdAt = '2026-11-20T22:30:00Z';
  stranded.s.commits = [work(SHA1, '2026-11-20T21:00:00Z')];
  await stranded.run(10);
  assert.deepEqual(stranded.s.enqueues, [SHA1], 'every gate passes now, so it is restored');
  assert.deepEqual(stranded.s.labels, [], 'and only the App\'s own label is removed, after the entry is back');

  const byPerson = world({ removalReason: 'QUEUE_CLEARED' });
  byPerson.s.mergeable = 'MERGEABLE';
  byPerson.s.labels = ['ejected'];
  byPerson.s.timeline.push({ __typename: 'LabeledEvent', createdAt: T(6), actor: person, label: { name: 'ejected' } });
  await byPerson.run(10);
  assert.deepEqual([byPerson.s.enqueues, byPerson.s.labels, byPerson.s.writes], [[], ['ejected'], []], 'a person\'s ejected label is left alone');

  const pr = (items) => normalise([{ id: 'PR_8', number: 8, state: 'OPEN', isInMergeQueue: false, labels: { nodes: [{ name: 'ejected' }] },
    headRepository: {}, baseRepository: {}, timelineItems: { nodes: items } }]);
  const appLabel = (at) => ({ __typename: 'LabeledEvent', createdAt: at, actor: { login: BOT, __typename: 'Bot' }, label: { name: 'ejected' } });
  const queuedAt = (added, removedAt) => [{ __typename: 'AddedToMergeQueueEvent', createdAt: added, actor: person },
    { __typename: 'RemovedFromMergeQueueEvent', createdAt: removedAt, actor: github, reason: 'QUEUE_CLEARED' }];
  assert.deepEqual(candidates(pr([...queuedAt(T(0), T(5)), appLabel(T(6))]), { botLogin: BOT, now: Date.parse(T(10)) }), [],
    'an App hand-back written after the cutover is final');
  assert.deepEqual(candidates(pr([...queuedAt('2026-11-01T10:00:00Z', '2026-11-01T10:05:00Z'), appLabel('2026-11-01T10:15:00Z')]), { botLogin: BOT, now: Date.parse(T(10)) }), [],
    'a stranded label on a removal over a week old stays');
  assert.deepEqual(candidates(pr([...queuedAt('2026-11-20T22:00:00Z', '2026-11-20T22:30:00Z'), appLabel('2026-11-20T23:00:00Z')]), { botLogin: BOT, now: Date.parse(T(10)) })
    .map((p) => p.stranded), [true], 'a recent stranded App label is a candidate, marked stranded');
});

test('#8054 review (P2): a hand-back on a stranded App label is final; a later green head is not restored', async () => {
  const strandedWorld = () => {
    const w = world({ removalReason: 'QUEUE_CLEARED' });
    w.s.mergeable = 'MERGEABLE';
    w.s.labels = ['ejected'];
    w.s.timeline[0].createdAt = '2026-11-20T22:00:00Z'; w.s.timeline[1].createdAt = '2026-11-20T22:30:00Z';
    w.s.timeline.push({ __typename: 'LabeledEvent', createdAt: '2026-11-20T23:00:00Z', actor: { login: BOT, __typename: 'Bot' }, label: { name: 'ejected' } });
    w.s.commits = [work(SHA1, '2026-11-20T21:00:00Z')];
    return w;
  };
  // Expired window → green: the reviewer's reproduction. Nov 22 10:00 is past 24 hours after the 22:30 ejection.
  const expired = strandedWorld();
  expired.s.evidence = pending(SHA1);
  await expired.run(24 * 60);
  assert.match(expired.s.comments[0].body, /24 hours after the ejection: the owner re-queues it/);
  assert.deepEqual(expired.s.labels, ['ejected']);
  expired.s.evidence = green(SHA1);
  await expired.run(24 * 60 + 10);
  assert.deepEqual(expired.s.enqueues, [], 'no enqueue after the hand-back');
  assert.deepEqual(expired.s.labels, ['ejected'], 'the hand-back marker stays');
  // Failed checks → green, inside the window.
  const failedThenGreen = strandedWorld();
  failedThenGreen.s.evidence = failed(SHA1);
  await failedThenGreen.run(10);
  assert.match(failedThenGreen.s.comments[0].body, /a required check failed/);
  failedThenGreen.s.evidence = green(SHA1);
  await failedThenGreen.run(20);
  assert.deepEqual([failedThenGreen.s.enqueues, failedThenGreen.s.labels], [[], ['ejected']]);
  // A fresh hand-back (not stranded) is final the same way.
  const plain = world({ removalReason: 'QUEUE_CLEARED' });
  plain.s.mergeable = 'MERGEABLE'; plain.s.evidence = failed(SHA1);
  await plain.run(10);
  plain.s.evidence = green(SHA1);
  await plain.run(20);
  assert.deepEqual([plain.s.enqueues, plain.s.labels], [[], ['ejected']]);
});

test('#6476 owner addition: only a positive mergeable admits, for every class', async () => {
  // An infrastructure ejection that now conflicts goes to the keeper, never straight back into the queue.
  const nowConflicting = world({ removalReason: 'QUEUE_CLEARED' });
  nowConflicting.s.mergeable = 'CONFLICTING';
  assert.deepEqual((await nowConflicting.run(10)).keeper, [7]);
  assert.deepEqual(nowConflicting.s.enqueues, []);
  // GitHub has not computed mergeability yet: wait, no enqueue, no label.
  const unknown = world({ removalReason: 'QUEUE_CLEARED' });
  unknown.s.mergeable = 'UNKNOWN';
  await unknown.run(10);
  assert.deepEqual([unknown.s.enqueues, unknown.s.labels], [[], []]);
  assert.match(unknown.s.comments[0].body, /has not yet said whether the head merges cleanly/);
  unknown.s.mergeable = 'MERGEABLE';
  await unknown.run(20);
  assert.deepEqual(unknown.s.enqueues, [SHA1], 'restored once GitHub says it merges');
  // A conflict ejection whose mergeability is still unknown waits rather than asking the keeper or re-queueing.
  const conflictUnknown = world();
  conflictUnknown.s.mergeable = 'UNKNOWN';
  assert.deepEqual((await conflictUnknown.run(10)).keeper, []);
  assert.deepEqual(conflictUnknown.s.enqueues, []);
});

test('#6476 S1: the evidence states, and failed or unknown never counts as green', () => {
  assert.equal(evidenceState(green(SHA1), SHA1), 'green');
  assert.equal(evidenceState(pending(SHA1), SHA1), 'pending');
  assert.equal(evidenceState({ ...pending(SHA1), required: { missing: ['ci'], pending: [], failing: [] } }, SHA1), 'pending', 'a check not created yet on a fresh head');
  assert.equal(evidenceState(failed(SHA1), SHA1), 'failed');
  assert.equal(evidenceState({ ...failed(SHA1), required: { missing: [], pending: ['x'], failing: ['y (failure)'] } }, SHA1), 'failed', 'failure wins over pending');
  assert.equal(evidenceState({ ok: false, headSha: SHA1, required: { missing: [], pending: [], failing: [] } }, SHA1), 'unknown', 'required green but no trusted full suite');
  assert.equal(evidenceState({ ok: false, headSha: null, required: null }, SHA1), 'unknown');
  assert.equal(evidenceState(null, SHA1), 'unknown');
  assert.equal(evidenceState(green(SHA2), SHA1), 'changed');
  assert.equal(evidenceState({ ok: true, headSha: null }, SHA1), 'unknown', 'ok without a head is not green');
});

test('#6476 S1: eligible() reasons split into retryable and the owner\'s', () => {
  const base = { number: 7, state: 'open', labels: [], head: { ref: 'agent/x', repo: { full_name: REPO } }, base: { repo: { full_name: REPO } } };
  const ctx = { env: ENV, event: 'schedule', repo: REPO, kind: 'ejection', breakers: { open: false }, files: [] };
  const retry = (r) => RETRYABLE_ELIGIBILITY.some((re) => re.test(r));
  const reasonsFor = (pr, over) => eligible(pr, { ...ctx, ...over }).reasons;
  for (const r of [...reasonsFor(base, { files: null }), ...reasonsFor(base, { breakers: { open: true } }), ...reasonsFor(base, { env: { ...ENV, LANDING_BOT_ENABLED: 'dispatch' } })]) assert.ok(retry(r), r);
  for (const r of [...reasonsFor({ ...base, labels: ['bot:off'] }), ...reasonsFor({ ...base, head: { ...base.head, ref: 'repair/x' } }),
    ...reasonsFor(base, { files: [{ path: '.gitattributes' }] }), ...reasonsFor({ ...base, head: { ref: 'x', repo: { full_name: 'fork/StudioOS' } } })]) assert.ok(!retry(r), r);
});

test('#6476 S1: decide() keeps the owner\'s lanes out of automatic re-queue whatever else waits', () => {
  const NOW = Date.parse(T(30));
  const c = { klass: 'flake', mergeable: true, removedAt: T(5), consent: { valid: true }, checks: 'green', headUnchangedSinceChecks: true,
    eligible: { ok: true, reasons: [] }, breakers: { open: false, reasons: [] }, openAlertTitles: [], requeues: [], pr: 7, now: NOW,
    env: ENV, queueRuns: Array(20).fill({ conclusion: 'success' }) };
  assert.equal(decide(c).action, 'requeue');
  for (const [name, over, action] of [
    ['pending', { checks: 'pending' }, 'wait'],
    ['unknown', { checks: 'unknown' }, 'wait'],
    ['legacy boolean false is unknown, not failed', { checks: undefined, checksGreenOnHead: false }, 'wait'],
    ['breaker', { breakers: { open: true, reasons: ['main is red'] } }, 'wait'],
    ['budget', { requeues: [{ pr: 7, at: T(0) }, { pr: 7, at: T(1) }] }, 'wait'],
    ['stalled alert', { openAlertTitles: ['[alert] merge queue stalled'] }, 'wait'],
    ['failed', { checks: 'failed' }, 'label'],
    ['no consent beats a wait', { consent: { valid: false, reason: 'a person removed it' }, checks: 'pending' }, 'label'],
    ['bot:off beats a breaker', { eligible: { ok: false, reasons: ['labelled bot:off'] }, breakers: { open: true, reasons: ['main is red'] } }, 'label'],
    ['manual', { klass: 'manual' }, 'label'],
    ['timeout', { klass: 'timeout' }, 'label'],
    ['incompatible', { klass: 'incompatible' }, 'label'],
    ['no removal time', { removedAt: null, checks: 'pending' }, 'label'],
  ]) assert.equal(decide({ ...c, ...over }).action, action, name);
  assert.equal(decide({ ...c, checks: 'pending' }).retryUntil, new Date(Date.parse(T(5)) + RECOVERY_WINDOW_HOURS * 3_600_000).toISOString());
  assert.match(stickyLine(decide({ ...c, checks: 'pending' })), /^Waiting, not labelled: .*until 2026-11-22T10:05:00\.000Z; then handed back\.$/);
  assert.ok(keeperMergedSince([keeperMerge(SHA2, T(10))], T(5), BOT));
  assert.ok(!keeperMergedSince([keeperMerge(SHA2, T(1))], T(5), BOT), 'a keeper merge before this removal does not count');
  assert.ok(!keeperMergedSince([{ ...keeperMerge(SHA2, T(10)), author: { login: 'x' }, committer: { login: 'x' } }], T(5), BOT), 'only the App\'s keeper merge');
  assert.ok(String(STICKY_MARKER).length > 0);
});
