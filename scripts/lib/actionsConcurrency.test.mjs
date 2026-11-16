// #6462: fixture jobs for the concurrency rebuild — overlap peaks, never-started jobs as queued, shares summing to 100%.
import test from 'node:test';
import assert from 'node:assert/strict';
import { draftAt, effectiveCeiling, eventClass, heldSlot, perMinute, phantomVerdict, planCapMatch, report, saturationLevel, shareAtOrAbove, slotShares, spans, analyse } from './actionsConcurrency.mjs';

const T0 = Date.parse('2026-11-14T00:00:00Z');
const at = min => new Date(T0 + min * 60_000).toISOString();
const ran = (from, to, extra = {}) => ({ status: 'completed', conclusion: 'success', created_at: at(from), started_at: at(from), completed_at: at(to), runner_id: 7, runner_name: 'GitHub Actions 7', labels: ['ubuntu-latest'], ...extra });
const queuedOnly = (from, extra = {}) => ({ status: 'queued', conclusion: null, created_at: at(from), started_at: at(from), completed_at: null, runner_id: null, runner_name: null, ...extra });
const run = (name, jobs, extra = {}) => ({ name, event: 'push', created_at: at(0), jobs, ...extra });
const window = (runs, minutes, extra = {}) => analyse({ runs, from: T0, to: T0 + minutes * 60_000, now: T0 + minutes * 60_000, ...extra });

test('overlapping intervals give the right peak', () => {
  // [0,30) [10,40) [20,50) overlap three deep in [20,30); [50,60) touches nothing.
  const result = window([run('A', [ran(0, 30), ran(10, 40), ran(20, 50), ran(50, 60)])], 60);
  assert.equal(result.peak, 3);
  assert.equal(result.jobs, 4);
  // Back-to-back intervals do not overlap: one ends as the next starts.
  assert.equal(window([run('A', [ran(0, 10), ran(10, 20)])], 20).peak, 1);
  // A 20-second overlap inside one minute still sets the peak, though no minute starts at 2.
  const sec = s => new Date(T0 + s * 1000).toISOString();
  const brief = window([run('A', [ran(0, 1, { completed_at: sec(40) }), ran(0, 1, { started_at: sec(20) })])], 1);
  assert.equal(brief.peak, 2);
  assert.equal(brief.meanExecuting, 1);
});

test('the held level is the level kept for ten whole minutes, not the momentary peak', () => {
  const jobs = [ran(0, 30), ran(0, 30), ran(5, 16), ran(12, 13)]; // 3 held for 11 min, 4 for 1 min
  const result = window([run('A', jobs)], 30);
  assert.equal(result.peak, 4);
  assert.equal(result.held, 3);
  // Nothing queued: no cap was reached.
  assert.equal(result.ceiling, null);
  assert.equal(result.shareAtCeiling, null);
  assert.equal(effectiveCeiling(perMinute(spans([run('A', [ran(0, 9)])], 0).executing, T0, T0 + 600_000)), 0);
  assert.equal(effectiveCeiling(perMinute(spans([run('A', [ran(0, 10)])], 0).executing, T0, T0 + 600_000)), 1);
  assert.ok(Math.abs(shareAtOrAbove(spans([run('A', jobs)], 0).executing, 3, T0, T0 + 30 * 60_000) - 11 / 30) < 1e-12);
  assert.equal(shareAtOrAbove([], 1, T0, T0 + 60_000), 0);
  assert.equal(shareAtOrAbove([{ start: T0, end: T0 + 120_000 }], 1, T0, T0 + 60_000), 1);
  assert.equal(shareAtOrAbove([], 0, T0, T0 + 60_000), 1);
});

test('jobs never started count as queued, not executing', () => {
  const cancelledInQueue = ran(0, 20, { conclusion: 'cancelled', runner_id: 0, runner_name: '' });
  const stillQueued = queuedOnly(5);
  const skipped = ran(0, 30, { conclusion: 'skipped', runner_id: null, runner_name: null });
  const waitedThenRan = ran(10, 30, { created_at: at(2) });
  const assignedNotStarted = queuedOnly(0, { runner_id: 9, runner_name: 'GitHub Actions 9' });
  const skippedWithRunner = ran(0, 1, { conclusion: 'skipped' });
  for (const job of [cancelledInQueue, stillQueued, skipped, assignedNotStarted, skippedWithRunner]) assert.equal(heldSlot(job), false);
  assert.equal(heldSlot(waitedThenRan), true);
  const result = window([run('A', [cancelledInQueue, stillQueued, skipped, waitedThenRan])], 30);
  assert.equal(result.peak, 1);
  assert.equal(result.jobs, 1);
  assert.equal(result.queued.neverStarted, 2);
  // Minute 5..9: cancelledInQueue + stillQueued + waitedThenRan (created 2, started 10) = 3.
  assert.equal(result.queued.max, 3);
  const queue = perMinute(spans([run('A', [cancelledInQueue, stillQueued, waitedThenRan])], T0 + 30 * 60_000).queued, T0, T0 + 30 * 60_000);
  assert.deepEqual([queue[0].start, queue[3].start, queue[6].start, queue[12].start, queue[25].start], [1, 2, 3, 2, 1]);
});

test('per-workflow and per-event shares sum to 100%', () => {
  const runs = [
    run('CI', [ran(0, 30), ran(0, 10)]),
    run('CodeQL', [ran(5, 25)], { event: 'pull_request', pull_requests: [{ number: 1 }] }),
    run('Semgrep', [ran(50, 70), queuedOnly(0)], { event: 'merge_group' }),
  ];
  const result = window(runs, 60);
  const sum = list => list.reduce((a, x) => a + x.share, 0);
  assert.ok(Math.abs(sum(result.workflows) - 1) < 1e-12);
  assert.ok(Math.abs(sum(result.events) - 1) < 1e-12);
  // Clipped to the window: Semgrep counts 10 of its 20 minutes.
  assert.deepEqual(result.workflows.map(x => [x.name, x.minutes]), [['CI', 40], ['CodeQL', 20], ['Semgrep', 10]]);
  assert.deepEqual(slotShares([], () => 'x', T0, T0 + 1), []);
});

test('draft state is the PR state when the run was created', () => {
  const pr = { draft: false, events: [{ event: 'ready_for_review', created_at: at(30) }] };
  assert.equal(draftAt(pr, T0), true);
  assert.equal(draftAt(pr, T0 + 40 * 60_000), false);
  assert.equal(draftAt({ draft: true, events: [] }, T0), true);
  assert.equal(draftAt({ draft: false, events: [{ event: 'convert_to_draft', created_at: at(10) }, { event: 'ready_for_review', created_at: at(20) }] }, T0 + 15 * 60_000), true);
  assert.equal(draftAt(undefined, T0), null);
  const prs = new Map([[1, pr], ['head:b', 1]]);
  assert.equal(eventClass({ event: 'pull_request', pull_requests: [{ number: 1 }], created_at: at(0) }, prs), 'pull_request draft');
  assert.equal(eventClass({ event: 'pull_request', pull_requests: [], head_branch: 'b', created_at: at(45) }, prs), 'pull_request ready');
  assert.equal(eventClass({ event: 'pull_request', pull_requests: [], head_branch: 'zz', created_at: at(0) }, prs), 'pull_request (draft state unknown)');
  assert.equal(eventClass({ event: 'schedule' }), 'schedule');
});

test('the effective ceiling is the level executing sits at while jobs queue; a burst above it does not move it', () => {
  // Two slots busy for 40 minutes with a job waiting throughout; then three run at once for 13 minutes with nothing queued.
  const jobs = [ran(0, 40), ran(0, 40), ran(40, 55, { created_at: at(0) }), ran(42, 57), ran(42, 57)];
  const result = window([run('A', jobs)], 60);
  assert.equal(result.peak, 3);
  assert.equal(result.held, 3);
  assert.equal(result.ceiling, 2);
  assert.deepEqual(result.saturation, { level: 2, minutes: 40, waiting: 40 });
  assert.equal(result.queued.minutesQueuedBelowCeiling, 0);
  assert.equal(result.minutesAboveCeiling, 13);
  assert.deepEqual(result.longestAbove, { first: T0 + 42 * 60_000, last: T0 + 54 * 60_000, minutes: 13 });
  assert.ok(Math.abs(result.shareAtCeiling - 55 / 60) < 1e-12);
  assert.equal(saturationLevel([{ max: 5 }, { max: 7 }], [{ start: 1 }, { start: 1 }]).level, 7);
});

test('plan cap match names the cap the ceiling sits at, or none', () => {
  assert.deepEqual(planCapMatch(20), { cap: 20, tolerance: 1 });
  assert.deepEqual(planCapMatch(59), { cap: 60, tolerance: 3 });
  assert.deepEqual(planCapMatch(63), { cap: 60, tolerance: 3 });
  assert.deepEqual(planCapMatch(64), { cap: null, smallestConsistent: 500 });
  assert.deepEqual(planCapMatch(23), { cap: null, smallestConsistent: 40 });
  assert.deepEqual(planCapMatch(600), { cap: null, smallestConsistent: null });
  assert.deepEqual(planCapMatch(null), { cap: null, smallestConsistent: null });
});

test('phantom runs held a slot only if a job got a runner; the report says so', () => {
  assert.deepEqual(phantomVerdict([{ jobs: [] }, { jobs: [queuedOnly(0)] }, {}]), { runs: 3, checked: 2, jobs: 1, held: 0, heldSlot: false });
  assert.equal(phantomVerdict([{ jobs: [ran(0, 1)] }]).heldSlot, true);
  assert.equal(phantomVerdict([{}]).heldSlot, null);
  const result = window([run('CI', [ran(0, 30), ran(0, 30), ran(30, 31, { created_at: at(0) })])], 30);
  const coverage = { from: T0, to: T0 + 30 * 60_000, requestedHours: 0.5, fraction: 1, listedFrom: T0, leadMinutes: 0, runs: 1, runsWithJobs: 1, requests: 3, cap: 10, pages: { runs: 1, jobs: 1, prs: 0, phantom: 1 } };
  const text = report({ result, coverage, phantom: phantomVerdict([{ jobs: [] }]) });
  assert.match(text, /Effective ceiling .* \| \*\*2\*\* \(30 of 30 queued minutes\) \|/);
  assert.match(text, /matches \*\*none\*\* of the plan caps/);
  assert.match(text, /They never held a slot\*\* \(they have no jobs at all\)/);
  assert.match(text, /\| CI \| 60 \| 100\.0% \|/);
});

// #6676: merge candidates' wait for a runner and for the landing gate, by UTC hour of creation.
test('merge-candidate start wait: first runner and first gate result per merge_group run of ci.yml, by hour', async () => {
  const { mergeStartWait } = await import('./actionsConcurrency.mjs');
  const ci = (created, jobs, extra = {}) => run('CI', jobs, { event: 'merge_group', path: '.github/workflows/ci.yml', created_at: at(created), ...extra });
  const gate = (from, to, extra = {}) => ran(from, to, { name: 'landing gate', ...extra });
  const runs = [
    // 00:xx — waits 4 min for a runner, gate at 30 min.
    ci(0, [ran(4, 10, { created_at: at(0) }), gate(25, 30, { created_at: at(0) })]),
    // 00:xx — waits 10 min; an earlier queue-cancelled job had no runner and must not count as the start.
    ci(10, [ran(10, 12, { runner_id: 0, runner_name: '', conclusion: 'cancelled' }), ran(20, 30), gate(40, 50)]),
    // 01:xx — never got a runner, and no gate result.
    ci(70, [queuedOnly(70)]),
    // 01:xx — the gate was skipped: a runner start but no gate result.
    ci(80, [ran(81, 90), gate(80, 80, { conclusion: 'skipped', runner_id: null, runner_name: null })]),
    // Not counted: a push run of ci.yml, a merge_group run of another workflow, and one created outside the window.
    run('CI', [ran(1, 2)], { event: 'push', path: '.github/workflows/ci.yml' }),
    run('Other', [ran(1, 2)], { event: 'merge_group', path: '.github/workflows/other.yml' }),
    ci(200, [ran(201, 202)]),
  ];
  const wait = mergeStartWait(runs, T0, T0 + 120 * 60_000);
  assert.equal(wait.all.runs, 4);
  assert.deepEqual(wait.hours.map(h => h.hour), [0, 1]);
  const [h0, h1] = wait.hours;
  assert.equal(h0.runs, 2);
  assert.equal(h0.startP50, 4);
  assert.equal(h0.startP90, 10);
  assert.equal(h0.gateP50, 30);
  assert.equal(h0.gateP90, 40);
  assert.deepEqual([h1.runs, h1.noRunner, h1.noGate, h1.startP50], [2, 1, 2, 1]);
  assert.equal(h1.gateP50, null);
  assert.deepEqual([wait.all.noRunner, wait.all.noGate], [1, 2]);
  // It reaches the report as its own table, beside the 2026-11-14 tables.
  const result = window(runs, 120);
  assert.deepEqual(result.mergeWait, wait);
  const md = report({ result, coverage: { from: T0, to: T0 + 120 * 60_000, requestedHours: 2, fraction: 1, listedFrom: T0, leadMinutes: 0, runs: 7, runsWithJobs: 7, requests: 1, cap: 10, pages: { runs: 1, jobs: 0, prs: 0, phantom: 0 } }, phantom: phantomVerdict([]) });
  assert.match(md, /### Merge candidates: wait for a runner and for the landing gate \(#6676\)/);
  assert.match(md, /\| 00:00 \| 2 \| 4\.0 \| 10\.0 \| 30\.0 \| 40\.0 \| 0 \| 0 \|/);
  assert.match(md, /\| \*\*All hours\*\* \| 4 \| /);
});
