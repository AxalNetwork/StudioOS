// D6479 (#6479): the scorecard's landing section. Each row is computed from
// fixture REST data; a day with nothing to count prints "no data", never 0.
//
// Run with:
//   node --test frontend/test/ci_scorecard_landing.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as m from '../../scripts/lib/ciScorecard.mjs';

const at = (day, h, min = 0) => `2026-11-${day}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`;
const start = Date.parse(at(17, 6));
const now = Date.parse(at(18, 6));
const sha = c => c.repeat(40);
const user = login => ({ login, type: 'User' });
const bot = login => ({ login, type: 'Bot' });
const OWNER = user('person-a');
const QUEUE = bot('github-merge-queue[bot]');
const APP = bot('landing-app[bot]');

/** A REST timeline event. */
const ev = (event, time, actor, extra = {}) => ({ event, created_at: time, actor, ...extra });
const label = (event, time, name, actor = APP) => ev(event, time, actor, { label: { name } });
/** A REST `committed` event: no actor, the git author and the message. */
const commit = (time, author, message) => ({ event: 'committed', sha: sha('f'), message,
  author: { name: author, email: 'x@example.invalid', date: time }, committer: { name: author, email: 'x@example.invalid', date: time } });
/** A PR the way collectPrs stores it. */
const pr = (number, mergedAt, raw) => {
  const allEntries = m.queueEntries(raw);
  return { number, mergedAt, mergeCommit: m.mergeCommit(raw), allEntries, entries: allEntries, events: m.slimEvents(raw) };
};

// 101: one queue entry, merged by the queue; the keeper had merged main in after a conflict.
const pr101 = pr(101, at(17, 10), [
  label('labeled', at(17, 5), 'conflict'),
  // Another label coming off does not end the conflict.
  label('unlabeled', at(17, 5, 30), 'needs-session'),
  label('unlabeled', at(17, 6, 30), 'conflict'),
  commit(at(17, 7), 'landing-app[bot]', 'Merge main\n\nLanding-Bot-Kind: keeper'),
  ev('added_to_merge_queue', at(17, 8), OWNER),
  ev('merged', at(17, 10), OWNER, { commit_id: sha('a') }),
]);
// 102: ejected, labelled, re-added by the owner, removed by hand, queued again by the bot, merged by the queue.
const pr102 = pr(102, at(17, 15), [
  ev('added_to_merge_queue', at(17, 9), OWNER),
  ev('removed_from_merge_queue', at(17, 9, 30), QUEUE),
  label('labeled', at(17, 9, 40), 'ejected'),
  ev('added_to_merge_queue', at(17, 12), OWNER),
  ev('removed_from_merge_queue', at(17, 12, 10), OWNER),
  ev('added_to_merge_queue', at(17, 12, 40), APP),
  ev('merged', at(17, 15), user('merge-person'), { commit_id: sha('b') }),
  // After the merge: never a touch.
  ev('added_to_merge_queue', at(17, 16), OWNER),
]);
// 103: a draft made ready, merged outside the queue; a person's commit carrying a bot trailer is not a bot push.
const pr103 = pr(103, at(17, 18), [
  ev('ready_for_review', at(17, 2), OWNER),
  commit(at(17, 3), 'Some Person', 'Fix\n\nLanding-Bot-Kind: conflict'),
  label('labeled', at(17, 17), 'needs-session'),
  ev('merged', at(17, 18), user('owner-x'), { commit_id: sha('c') }),
]);
// 104: open; a conflict label still on, an ejection with no action yet.
const pr104 = pr(104, null, [
  label('labeled', at(17, 20), 'conflict'),
  ev('added_to_merge_queue', at(17, 20, 30), OWNER),
  ev('removed_from_merge_queue', at(17, 21), QUEUE),
]);
const prs = [pr101, pr102, pr103, pr104];

const CI = '.github/workflows/ci.yml';
const run = (event, headSha, extra = {}) => ({ id: Math.random(), event, path: CI, head_sha: headSha, head_branch: event === 'push' ? 'main' : 'x',
  status: 'completed', conclusion: 'success', created_at: at(17, 7), ...extra });
const pushRuns = ['a', 'b', 'c', 'd', 'e'].map(c => run('push', sha(c)));
const queueRuns = [run('merge_group', sha('a')), run('merge_group', sha('b'), { conclusion: 'failure' })];
const pullsBySha = new Map([[sha('d'), { number: null }]]);

const job = (name, wait = 1, extra = {}) => ({ name, created_at: at(17, 7), started_at: at(17, 7, wait), runner_id: 7, conclusion: 'success', ...extra });
const skipped = name => job(name, 0, { conclusion: 'skipped', runner_id: 0 });

test('slimEvents keeps the landing events, a bot commit\'s known kind and provider, and nothing a person wrote as a trailer', () => {
  const events = m.slimEvents([
    commit(at(17, 3), 'landing-app[bot]', 'Merge\n\nLanding-Bot-Kind: conflict\nLanding-Bot-Provider: codex'),
    commit(at(17, 4), 'landing-app[bot]', 'Landing-Bot-Kind: rm-rf\nLanding-Bot-Provider: other'),
    ev('commented', at(17, 1), OWNER),
    ev('added_to_merge_queue', at(17, 2), { login: 'bad | <b>', type: 'Organization' }),
  ]);
  assert.deepEqual(events.map(e => e.event), ['added_to_merge_queue', 'committed', 'committed']);
  assert.deepEqual(events[0].actor, { login: null, type: null });
  assert.equal(events[1].kind, 'conflict');
  assert.equal(events[1].provider, 'codex');
  assert.equal(events[2].kind, null);
  assert.equal(events[2].provider, null);
  assert.equal(pr103.events.find(e => e.event === 'committed').kind, null);
});

test('queue entries per merged PR: the median and the share merged on the first entry', () => {
  const entries = m.entriesPerMergedPr(prs);
  assert.deepEqual(entries.p50, { value: 1, n: 2 });
  assert.deepEqual(entries.firstEntry, { value: 0.5, n: 2 });
});

test('pushes to main: the green-queue share, and how and by whom the rest merged; bypass is never guessed', () => {
  assert.deepEqual(m.pushesMissingQueueRun(pushRuns, queueRuns), ['b', 'c', 'd', 'e'].map(sha));
  const result = m.pushLanding({ pushRuns, queueRuns, prs, pullsBySha });
  assert.equal(result.n, 5);
  assert.deepEqual(result.green, { value: 0.2, n: 5 });
  assert.deepEqual(result.how, { queue: 1, 'outside the queue': 1, 'direct push': 1, unread: 1 });
  assert.deepEqual(result.who, { 'merge-person': 1, 'owner-x': 1 });
  // A PR read through commits/{sha}/pulls counts like one the scorecard read.
  const late = m.pushLanding({ pushRuns, queueRuns, prs: [], pullsBySha: new Map([[sha('c'), { number: 103, events: pr103.events }]]) });
  assert.deepEqual(late.how, { queue: 0, 'outside the queue': 1, 'direct push': 0, unread: 3 });
});

test('open PRs by mergeable state, dirty read as conflicted; non-draft PRs older than 24 hours', () => {
  const open = [
    { number: 201, draft: true, created_at: at(16, 1) },
    { number: 202, draft: false, created_at: at(16, 1) },
    { number: 203, draft: false, created_at: at(18, 5) },
    { number: 204, draft: false, created_at: at(15, 1) },
  ];
  const details = new Map([[201, { mergeable: null, mergeable_state: 'draft' }], [202, { mergeable: false, mergeable_state: 'dirty' }],
    [203, { mergeable: true, mergeable_state: 'clean' }]]);
  assert.deepEqual(m.openPrStates(open, details, now), { n: 4, read: 3, states: { draft: 1, conflicted: 1, clean: 1 }, old: { n: 3, value: 2 } });
});

test('owner touches: User queue additions, re-additions after the first entry and manual removals, up to the merge', () => {
  const result = m.ownerTouches(prs);
  assert.equal(result.n, 3);
  assert.deepEqual(result.p50, { value: 1, n: 3 });
  assert.equal(result.mean.value, 4 / 3);
  assert.deepEqual(result.untouched, { value: 1 / 3, n: 3 });
  assert.deepEqual([result.additions, result.reAdditions, result.removals], [3, 1, 1]);
});

test('conflicted to mergeable runs on the conflict label; ejection to re-queue or label takes whichever comes first', () => {
  const conflict = m.conflictToMergeable(prs);
  assert.deepEqual(conflict.p50, { value: 90, n: 1 });
  assert.equal(conflict.open, 1);
  const ejection = m.ejectionToAction(prs);
  assert.deepEqual(ejection.p50, { value: 10, n: 2 });
  assert.deepEqual(ejection.p90, { value: 30, n: 2 });
  assert.deepEqual([ejection.requeued, ejection.labelled, ejection.waiting], [1, 1, 1]);
});

const KEEPER = '.github/workflows/landing-bot-keeper.yml';
const CONFLICT = '.github/workflows/landing-bot-conflict.yml';
const botRun = (path, extra = {}) => ({ id: Math.random(), path, status: 'completed', conclusion: 'success', created_at: at(17, 9), ...extra });
const PLAN = 'Check the rules and stage the merge';
const APPLY = 'Check the resolution and push it';
const EDIT = 'Resolve with a model / round1 / Edit (round 1)';
const botWorkflowRuns = [
  botRun(KEEPER), botRun(KEEPER), botRun(KEEPER, { conclusion: 'skipped' }),
  botRun(CONFLICT, { jobs: [job(PLAN), job(EDIT), job(APPLY)], provider: 'claude' }),
  botRun(CONFLICT, { jobs: [job(PLAN), skipped(EDIT), job(APPLY)] }),
  botRun(CONFLICT, { jobs: [job(PLAN), skipped(EDIT), skipped(APPLY)] }),
  botRun(CONFLICT, { conclusion: 'failure' }),
  botRun(CONFLICT, { jobs: [job(PLAN), job(EDIT), job(APPLY)], created_at: at(18, 2) }),
  botRun(CONFLICT),
  botRun('.github/workflows/landing-bot-ejection.yml', { status: 'in_progress', conclusion: null }),
  botRun('.github/workflows/not-a-bot.yml'),
];

test('landing bot runs by kind and outcome, from the run conclusion and, for a model kind, its jobs', () => {
  assert.equal(m.botKind(KEEPER), 'keeper');
  assert.equal(m.botKind('.github/workflows/landing-feeder.yml'), 'feeder');
  assert.equal(m.botKind('.github/workflows/ci.yml'), null);
  assert.deepEqual(m.botRuns(botWorkflowRuns), {
    keeper: { n: 3, outcomes: { completed: 2, off: 1 } },
    conflict: { n: 6, outcomes: { 'model run': 2, 'handed back before the model': 1, 'stopped before acting': 1, failed: 1, completed: 1 } },
    ejection: { n: 1, outcomes: { 'in progress': 1 } },
  });
});

test('bot actions on read timelines: pushes by trailer kind, give-ups and queue entries by a Bot account, inside the window', () => {
  assert.deepEqual(m.botActions(prs, start, now), { prsRead: 4, pushed: { keeper: 1 }, gaveUp: 1, queued: 1 });
  assert.deepEqual(m.botActions(prs, now, now + 1).pushed, {});
});

test('model runs per UTC day by provider against LANDING_BOT_DAILY_MODEL_RUNS; unread jobs are counted apart', () => {
  const log = 'x\nlanding-bot model: round 1 no_patch (the model made no change); provider claude, 4 turns\n'
    + 'landing-bot model: round 2 patched (edited); provider codex, 9 turns\n';
  assert.equal(m.providerFromLog(log), 'codex');
  assert.equal(m.providerFromLog('landing-bot model: round 1 no_patch (no provider was available); provider none, 0 turns'), 'none');
  assert.equal(m.providerFromLog('landing-bot model: round 1 patched (x); provider evil-bot, 1 turns'), null);
  assert.equal(m.providerFromLog(''), null);
  const result = m.modelRunsPerDay(botWorkflowRuns, '2');
  assert.deepEqual(result.days, { '2026-11-17': { n: 1, providers: { claude: 1 } }, '2026-11-18': { n: 1, providers: { unread: 1 } } });
  assert.equal(result.unclassified, 1);
  assert.deepEqual([result.cap, result.capSet], [2, true]);
  assert.deepEqual([m.modelRunsPerDay([], undefined).cap, m.modelRunsPerDay([], ' ').capSet], [0, false]);
});

const FULL = 'test:drift (full suite)';
const FAST = 'test:drift (draft fast tier)';
const prRun = (number, names, extra = {}) => run('pull_request', sha('9'), { pull_requests: [{ number }], created_at: at(17, 3),
  jobs: names.map(n => (typeof n === 'string' ? job(n) : n)), ...extra });
const ciPrRuns = [
  prRun(301, [FAST, 'frontend (build)', skipped('worker (typecheck)')]),
  prRun(302, [FAST, 'a', 'b', 'c']),
  prRun(103, [job(FULL, 1, { conclusion: 'failure' }), 'a', 'b', 'c', 'd']),
  prRun(101, [job(FULL, 1, { conclusion: 'failure' }), 'a', 'b', 'c', 'd', 'e']),
  prRun(999, [FULL, 'a', 'b', 'c', 'd', 'e', 'f']),
  prRun(555, [job(FULL, 1, { conclusion: 'failure' }), 'a', 'b', 'c', 'd', 'e']),
  prRun(556, ['a']),
  prRun(557, [FULL], { jobs: undefined }),
  prRun(558, [FULL], { priorAttempt: true }),
];

test('jobs started per PR push, draft and ready, from the tier the test:drift job names', () => {
  const result = m.jobsPerPrPush(ciPrRuns);
  assert.deepEqual(result.draft.p50, { value: 2, n: 2 });
  assert.deepEqual(result.draft.mean, { value: 3, n: 2 });
  assert.deepEqual(result.ready.p50, { value: 6, n: 4 });
  assert.deepEqual(result.ready.mean, { value: 6, n: 4 });
  assert.equal(result.unknown, 1);
});

test('full-suite failures first seen after ready: the PR had been a draft before the run', () => {
  assert.deepEqual(m.fullSuiteFailures(ciPrRuns, prs), { n: 3, afterReady: 1, neverDraft: 1, unread: 1 });
});

test('runner wait per job pools every sampled job and leaves skipped ones out', () => {
  const result = m.runnerWaitAll([{ jobs: [job('a', 1), job('b', 3), job('c', 10), skipped('d')] }, { jobs: [job('unsafe | <b>', 50)] }]);
  assert.deepEqual(result.p50, { value: 3, n: 3 });
  assert.deepEqual(result.p90, { value: 10, n: 3 });
});

test('the landing section renders every row from the fixtures, with the caps the reads hit', () => {
  const open = [{ number: 202, draft: false, created_at: at(16, 1) }];
  const md = m.landingReport({ runs: [{ jobs: [job('a', 2)] }], queueRuns, prs, pushRuns, pullsBySha, open,
    openDetails: new Map([[202, { mergeable: false, mergeable_state: 'dirty' }]]), botWorkflowRuns, ciPrRuns, start, now,
    modelCap: '2', requests: 41, notes: ['Mergeable state read for 100 of 112 open PRs (cap 100).'] });
  for (const row of [
    '| Queue entries per merged PR | median 1 (n=2); merged on the first entry (%) 50.0 (n=2) |',
    '| Pushes to main with a green merge-queue run on the same commit (%) | 20.0 (n=5) |',
    '| Pushes to main without one: how, and who merged | queue 1, outside the queue 1, direct push 1, unread 1; merged by merge-person 1, owner-x 1; bypass: not visible to the API |',
    '| Open PRs by mergeable state | conflicted 1 (1 of 1 read) |',
    '| Non-draft PRs open over 24 hours | 1 of 1 |',
    '| Owner touches per merged PR | median 1, mean 1.3 (n=3); untouched 33.3%; queue additions 3 (re-additions 1), manual removals 1 |',
    '| Conflicted to mergeable (min, `conflict` label) | p50 90.0, p90 90.0 (n=1); still labelled 1 |',
    '| Ejection to re-queue or label (min) | p50 10.0, p90 30.0 (n=2); re-queued 1, labelled 1, no action yet 1 |',
    '| Landing bot runs by kind and outcome | keeper 3 (completed 2, off 1)<br>conflict 6 (model run 2, handed back before the model 1, stopped before acting 1, failed 1, completed 1)<br>ejection 1 (in progress 1) |',
    '| Landing bot actions on read PR timelines | pushed keeper 1; gave up 1; queued by the bot 1 (4 timelines); refused by a breaker: not visible to the API |',
    '| Model runs per UTC day by provider (cap 2) | 2026-11-17: 1 of 2 (claude 1)<br>2026-11-18: 1 of 2 (unread 1); jobs unread for 1 model-kind runs |',
    '| ci.yml jobs started per PR push, draft | median 2, mean 3.0 (n=2) |',
    '| ci.yml jobs started per PR push, ready | median 6, mean 6.0 (n=4) |',
    '| Full-suite failures first seen after ready | 1 of 3 (never a draft 1, timeline unread 1) |',
    '| Runner wait per job, all jobs (min) | p50 2.0, p90 2.0 (n=1) |',
    'Landing reads: 41 GET requests of a 230 cap.',
    'Mergeable state read for 100 of 112 open PRs (cap 100).',
  ]) assert.ok(md.includes(row), row);
});

test('a day with no data prints "no data" on every row, never 0', () => {
  const md = m.landingReport({ start, now });
  const rows = md.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| Metric') && !line.startsWith('| ---'));
  assert.equal(rows.length, 15);
  for (const row of rows) assert.match(row, /\| no data \|$/, row);
  assert.match(md, /Model runs per UTC day by provider \(cap unset \(0\)\)/);
  // Pushes that all had a green queue run say so, rather than "no data".
  assert.match(m.landingReport({ start, now, pushRuns: pushRuns.slice(0, 1), queueRuns }), /\| Pushes to main without one: how, and who merged \| none \|/);
});

test('the landing reads have their own plan and cap, stated once, and the collector uses REST only', () => {
  const b = m.LANDING_BUDGET;
  // 2 + 40 + 2 + 100 + 1 + 7 bot workflows x 2 + 20 + 12 + 2 + 24 = 217.
  assert.equal(m.landingPlan().worst, 217);
  assert.ok(m.landingPlan().worst <= b.cap, 'every landing read fits under the cap');
  // BUDGET's own plan is unchanged: the comment still always fits.
  assert.ok(m.requestPlan().worst <= m.BUDGET.cap);
  const cli = readFileSync(new URL('../../scripts/ci-scorecard.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(cli, /graphql/i);
  assert.match(cli, /if \(landing \? \+\+landingRequests > LANDING_BUDGET\.cap : \+\+requests > cap\)/);
  for (const key of ['pushPages', 'pushReads', 'openPages', 'mergeableReads', 'botRunPages', 'botJobs', 'modelLogs', 'prCiPages', 'prCiJobs']) {
    assert.match(cli, new RegExp(`LANDING_BUDGET\\.${key}\\b`), key);
  }
  for (const path of ['actions/workflows/ci.yml/runs?event=push&branch=main', 'commits/${sha}/pulls', 'pulls?state=open', 'pulls/${p.number}',
    'actions/workflows?per_page=100', 'actions/jobs/${edit.id}/logs', 'actions/workflows/ci.yml/runs?event=pull_request']) {
    assert.ok(cli.includes(path), path);
  }
  // Every landing read is a GET; the tracker comment stays the only write.
  const landing = cli.slice(cli.indexOf('async function collectLanding'), cli.indexOf('/** The sole write path.'));
  assert.doesNotMatch(landing, /method:/);
  const yml = readFileSync(new URL('../../.github/workflows/ci-scorecard.yml', import.meta.url), 'utf8');
  assert.match(yml, /LANDING_BOT_DAILY_MODEL_RUNS: \$\{\{ vars\.LANDING_BOT_DAILY_MODEL_RUNS \}\}\n/);
  assert.match(yml, /sparse-checkout: \|\n\s+scripts\n\s+merge-control\/src\/lib\n/);
});
