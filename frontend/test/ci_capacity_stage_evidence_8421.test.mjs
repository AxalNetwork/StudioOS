/**
 * D8421 (#8421): stage evidence from provider job records, and the stage verdict.
 *
 * Every record here is synthetic and timed from a fixed instant; nothing reads a clock or the network. The cases
 * pin the distinctions the tool exists for: waiting is not running, a burst is not sustained capacity, a runner
 * registration is not a machine, and a stage with an unrecorded fact has demonstrated nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_SCHEMA, RECORDED_FACTS, normalizeJobs, stepSeries, summarize, timeAtOrAbove, sustainedLevel, percentile,
  completionsPerHour, machineUse, stageEvidence, validateStage, evaluateStage, readRows, main,
} from '../../scripts/ci/capacity-stage-evidence.mjs';

const T0 = Date.parse('2026-01-05T00:00:00Z'), MIN = 60_000;
const at = minutes => new Date(T0 + minutes * MIN).toISOString();
/** One completed job attempt that held `runner` from `started` to `completed` (minutes after T0). */
const job = (created, started, completed, runner, extra = {}) => ({
  id: `${runner}-${started}`, name: 'suite (worker-1-of-6)', status: 'completed', conclusion: 'success', run_id: 7, run_attempt: 1,
  created_at: at(created), started_at: at(started), completed_at: at(completed), runner_id: runner, runner_name: `runner-${runner}`, ...extra,
});
/** `count` jobs running together over one interval, each on its own runner. */
const block = (count, from, to, firstRunner = 1) => Array.from({ length: count }, (_, i) => job(from, from, to, firstRunner + i));
const stage = (over = {}) => ({ target: 4, approvedRunningJobs: 4, configuredSlots: 4, minMachines: 2, maxP95WaitMinutes: 5, maxFailedFraction: 0, maxApiBudgetFraction: 0.8, ...over });
const recorded = (over = {}) => ({ apiBudgetUsedFraction: 0.4, retainedReservationsGrew: false, cleanupResidue: false, costRecorded: true, ...over });

test('a job counts as running only while it held a runner', () => {
  const rows = [
    job(0, 2, 30, 1),
    // Cancelled while it waited: GitHub stamps a start and an end, but no runner ever took it.
    job(0, 0, 45, null, { runner_name: '', conclusion: 'cancelled' }),
    job(0, 0, 0, null, { runner_name: null, conclusion: 'skipped' }),
    { ...job(5, 6, 6, 2), status: 'in_progress', completed_at: null, conclusion: null },
    { ...job(5, 5, 5, null), runner_name: null, status: 'queued', started_at: null, completed_at: null, conclusion: null },
    job(10, 12, 11, 3),
    { status: 'completed' },
    job(0, 1, 9, 4, { name: 'frontend (build)' }),
    job(0, 1, 9, 5, { event: 'pull_request' }),
  ];
  const sorted = normalizeJobs(rows, { nameMatch: /^suite \(/, event: null });
  assert.deepEqual([sorted.ran.length, sorted.open.length, sorted.notRun, sorted.invalid, sorted.outOfScope], [2, 2, 2, 2, 1]);
  assert.equal(normalizeJobs(rows, { event: 'pull_request' }).ran.length, 1);
  const evidence = stageEvidence(rows, { nameMatch: /^suite \(/ });
  assert.equal(evidence.running.peak, 2, 'the 45-minute cancelled wait is not a running job');
  assert.deepEqual(evidence.records, { given: 9, ran: 2, stillOpen: 2, neverRan: 2, unusable: 2, outOfScope: 1 });
  assert.throws(() => normalizeJobs({}), /stage_evidence_rows/);
});

test('one job ending as the next starts is one job running, and the series closes at zero', () => {
  const series = stepSeries([[0, 10], [10, 20], [5, 15]]);
  assert.deepEqual(series, [[0, 1], [5, 2], [10, 2], [15, 1], [20, 0]]);
  assert.deepEqual(summarize(series), { peak: 2, peakAt: 5, average: 1.5, spanMs: 20 });
  assert.deepEqual(stepSeries([[3, 3], [4, 2]]), []);
  assert.deepEqual(summarize([]), { peak: 0, peakAt: null, average: 0, spanMs: 0 });
});

test('the sustained level is the highest one held without a break for the whole window', () => {
  // Ten jobs for 5 minutes, then four for 40: a burst of ten, a stable four.
  const rows = [...block(10, 0, 5), ...block(4, 5, 45, 20)];
  const series = stepSeries(normalizeJobs(rows).ran.map(j => [j.started, j.completed]));
  assert.equal(summarize(series).peak, 10);
  assert.equal(sustainedLevel(series, 30 * MIN), 4);
  assert.equal(sustainedLevel(series, 5 * MIN), 10);
  assert.equal(sustainedLevel(series, 46 * MIN), 0);
  assert.deepEqual(timeAtOrAbove(series, 4), { level: 4, longestMs: 45 * MIN, longestFrom: T0, totalMs: 45 * MIN });
  // A one-minute gap breaks the run: 25 + 25 minutes at four is not 30 minutes at four.
  const broken = stepSeries([...block(4, 0, 25), ...block(4, 26, 51)].map(j => [Date.parse(j.started_at), Date.parse(j.completed_at)]));
  assert.equal(sustainedLevel(broken, 30 * MIN), 0);
  assert.equal(timeAtOrAbove(broken, 4).totalMs, 50 * MIN);
  assert.throws(() => sustainedLevel(series, 0), /stage_evidence_window/);
});

test('the bisection agrees with checking every level, on generated series', () => {
  let seed = 8421;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 40; round++) {
    const intervals = Array.from({ length: 30 }, () => { const from = Math.floor(next() * 200); return [from, from + 1 + Math.floor(next() * 60)]; });
    const series = stepSeries(intervals), window = 1 + Math.floor(next() * 40);
    let expected = 0;
    for (let level = 1; level <= summarize(series).peak; level++) if (timeAtOrAbove(series, level).longestMs >= window) expected = level;
    assert.equal(sustainedLevel(series, window), expected, `round ${round}`);
  }
});

test('offered load is what would have run had every job started when it was created', () => {
  // Six jobs created together, run one after another on a single runner.
  const rows = Array.from({ length: 6 }, (_, i) => job(0, i * 10, i * 10 + 10, 1));
  const evidence = stageEvidence(rows, { windowMinutes: 10 });
  assert.equal(evidence.running.peak, 1);
  assert.deepEqual(evidence.offered, { peak: 6, timeAverage: 6, sustained: 6 });
  assert.deepEqual(evidence.waiting, { peak: 5, p50Minutes: 20, p95Minutes: 50 });
});

test('registrations, machines and jobs on one machine are counted apart', () => {
  // Machine A carries registrations 1 and 2; machine B carries 3.
  const rows = [job(0, 0, 40, 1), job(0, 0, 40, 2), job(0, 10, 35, 3)];
  const machineOf = row => (row.runner_id === 3 ? 'B' : 'A');
  const use = machineUse(normalizeJobs(rows, { machineOf }).ran);
  assert.deepEqual([use.registrations, use.machines, use.mostJobsOnOneMachine, use.peakMachinesBusy], [3, 2, 2, 2]);
  assert.equal(use.overlapLongestMs, 25 * MIN);
  const evidence = stageEvidence(rows, { machineOf, windowMinutes: 20 });
  assert.deepEqual(evidence.machines, { registrations: 3, machines: 2, mostJobsOnOneMachine: 2, peakMachinesBusy: 2,
    overlapLongestMs: 25 * MIN, overlapTotalMs: 25 * MIN, sustainedMachinesBusy: 2, overlapLongestMinutes: 25, overlapTotalMinutes: 25 });
  // Without a mapping each runner name is its own machine: right for hosted runners only.
  assert.equal(stageEvidence(rows).machines.machines, 3);
  // Two jobs one after the other on one machine never overlap another machine.
  assert.equal(machineUse(normalizeJobs([job(0, 0, 10, 1), job(0, 10, 20, 1)]).ran).overlapLongestMs, 0);
});

test('completions are counted in whole clock hours, and percentiles are nearest-rank', () => {
  const rows = [job(0, 30, 50, 1), job(0, 60, 70, 2), job(0, 60, 119, 3), job(0, 120, 130, 4), job(0, 180, 200, 5)];
  assert.deepEqual(completionsPerHour(normalizeJobs(rows).ran), { hours: 2, median: 1, busiest: 2, total: 5 });
  assert.deepEqual(completionsPerHour([]), { hours: 0, median: null, busiest: null, total: 0 });
  assert.deepEqual([percentile([4, 1, 3, 2], 0.5), percentile([4, 1, 3, 2], 0.95), percentile([7], 0), percentile([], 0.5)], [2, 4, 7, null]);
  const evidence = stageEvidence([...rows, job(0, 0, 10, 6, { run_attempt: 2, conclusion: 'failure' })]);
  assert.deepEqual(evidence.attempts, { afterTheFirst: 1, outcomes: { success: 5, failure: 1 } });
  assert.equal(evidence.schema, EVIDENCE_SCHEMA);
  assert.throws(() => stageEvidence(rows, { windowMinutes: 0 }), /stage_evidence_window/);
});

test('a stage is demonstrated only when the target held for the window inside every limit', () => {
  const evidence = stageEvidence(block(4, 0, 40), { windowMinutes: 30 });
  const verdict = evaluateStage(evidence, stage(), recorded());
  assert.deepEqual(verdict, { verdict: 'demonstrated', target: 4, windowMinutes: 30,
    capacity: { configuredSlots: 4, approvedRunningJobs: 4, peakRunningJobs: 4, sustainedRunningJobs: 4, demonstratedRunningJobs: 4 },
    stops: [], shortfalls: [], unrecorded: [] });
  // Six approved and eight configured, four demonstrated: the three capacities stay separate.
  assert.deepEqual(evaluateStage(evidence, stage({ approvedRunningJobs: 6, configuredSlots: 8 }), recorded()).capacity,
    { configuredSlots: 8, approvedRunningJobs: 6, peakRunningJobs: 4, sustainedRunningJobs: 4, demonstratedRunningJobs: 4 });
});

test('a burst, a miss and an unrecorded fact each fall short of demonstrated', () => {
  const burst = stageEvidence([...block(4, 0, 10), ...block(2, 10, 50, 20)], { windowMinutes: 30 });
  assert.equal(evaluateStage(burst, stage(), recorded()).verdict, 'burst_only');
  assert.equal(evaluateStage(burst, stage(), recorded()).capacity.demonstratedRunningJobs, 0);
  assert.equal(evaluateStage(stageEvidence(block(3, 0, 40)), stage(), recorded()).verdict, 'below_target');

  const held = stageEvidence(block(4, 0, 40), { windowMinutes: 30 });
  assert.deepEqual(evaluateStage(held, stage()).unrecorded, [...RECORDED_FACTS]);
  assert.equal(evaluateStage(held, stage()).verdict, 'incomplete');
  for (const fact of RECORDED_FACTS) {
    const missing = recorded(); delete missing[fact];
    assert.deepEqual(evaluateStage(held, stage(), missing).unrecorded, [fact]);
  }
  assert.deepEqual(evaluateStage(held, stage(), recorded({ costRecorded: false })).unrecorded, ['costRecorded']);
  assert.deepEqual(evaluateStage(held, stage(), recorded({ apiBudgetUsedFraction: '0.1' })).unrecorded, ['apiBudgetUsedFraction']);

  // Shortfalls: slow starts, a failed attempt, and all four jobs on one machine when two machines are required.
  const slow = stageEvidence(block(4, 0, 40).map(row => ({ ...row, created_at: at(-9) })), { windowMinutes: 30 });
  assert.match(evaluateStage(slow, stage(), recorded()).shortfalls.join(), /p95 wait 9 minutes is above 5/);
  const failed = stageEvidence([...block(3, 0, 40), job(0, 0, 40, 9, { conclusion: 'failure' })], { windowMinutes: 30 });
  assert.match(evaluateStage(failed, stage(), recorded()).shortfalls.join(), /1 of 4 attempts did not succeed/);
  assert.equal(evaluateStage(failed, stage({ maxFailedFraction: 0.25 }), recorded()).verdict, 'demonstrated');
  const oneMachine = stageEvidence(block(4, 0, 40), { windowMinutes: 30, machineOf: () => 'A' });
  const single = evaluateStage(oneMachine, stage({ slotsPerMachine: 4 }), recorded());
  assert.equal(single.verdict, 'incomplete');
  assert.match(single.shortfalls.join(), /1 machines stayed busy for the window; the stage needs 2/);
  // A second machine that joins for five minutes is a peak of two machines, not two machines for the window.
  const brief = stageEvidence([...block(4, 0, 40), job(0, 0, 5, 9)], { windowMinutes: 30, machineOf: row => (row.runner_id === 9 ? 'B' : 'A') });
  assert.deepEqual([brief.machines.peakMachinesBusy, brief.machines.sustainedMachinesBusy], [2, 1]);
  assert.match(evaluateStage(brief, stage({ approvedRunningJobs: 5, configuredSlots: 5, slotsPerMachine: 4 }), recorded()).shortfalls.join(), /1 machines stayed busy/);
});

test('a crossed limit is a stop, and a stop demonstrates nothing', () => {
  const five = stageEvidence(block(5, 0, 40), { windowMinutes: 30 });
  const over = evaluateStage(five, stage({ configuredSlots: 8 }), recorded());
  assert.equal(over.verdict, 'stop');
  assert.deepEqual(over.stops, ['peak 5 running jobs passed the approved 4']);
  assert.equal(over.capacity.demonstratedRunningJobs, 0);

  const held = stageEvidence(block(4, 0, 40), { windowMinutes: 30 });
  assert.deepEqual(evaluateStage(held, stage(), recorded({ retainedReservationsGrew: true })).stops, ['retained reservations grew']);
  assert.deepEqual(evaluateStage(held, stage(), recorded({ cleanupResidue: true })).stops, ['cleanup left residue']);
  assert.deepEqual(evaluateStage(held, stage(), recorded({ apiBudgetUsedFraction: 0.81 })).stops, ['API budget use 0.81 passed 0.8']);
  assert.equal(evaluateStage(held, stage(), recorded({ apiBudgetUsedFraction: 0.8 })).verdict, 'demonstrated');

  // Several jobs on one machine need a recorded number of slots, and may not pass it.
  const shared = stageEvidence(block(4, 0, 40), { windowMinutes: 30, machineOf: row => (row.runner_id <= 2 ? 'A' : 'B') });
  assert.match(evaluateStage(shared, stage(), recorded()).stops.join(), /a machine ran 2 jobs at once and the stage records no slots per machine/);
  assert.equal(evaluateStage(shared, stage({ slotsPerMachine: 2 }), recorded()).verdict, 'demonstrated');
  assert.match(evaluateStage(shared, stage({ slotsPerMachine: 1 }), recorded()).stops.join(), /above its 1 slots/);
});

test('stage limits are explicit: a missing, malformed or inconsistent one is refused', () => {
  const good = stage(); assert.equal(validateStage(good), good);
  for (const key of ['target', 'approvedRunningJobs', 'configuredSlots', 'minMachines', 'maxP95WaitMinutes', 'maxFailedFraction', 'maxApiBudgetFraction']) {
    const missing = stage(); delete missing[key];
    assert.throws(() => validateStage(missing), /stage_limits/, key);
  }
  for (const bad of [{ target: 0 }, { target: 1.5 }, { minMachines: 0 }, { maxFailedFraction: 1.1 }, { maxApiBudgetFraction: -0.1 }, { maxP95WaitMinutes: -1 }, { slotsPerMachine: 0 }, { windowMinutes: 0 }]) {
    assert.throws(() => validateStage(stage(bad)), /stage_limits/, JSON.stringify(bad));
  }
  assert.throws(() => validateStage(stage({ target: 5 })), /stage_limits_order/);
  assert.throws(() => validateStage(stage({ approvedRunningJobs: 9, configuredSlots: 8 })), /stage_limits_order/);
  assert.throws(() => validateStage(null), /stage_limits/);
  const evidence = stageEvidence(block(4, 0, 40), { windowMinutes: 30 });
  assert.throws(() => evaluateStage(evidence, stage({ windowMinutes: 10 }), recorded()), /stage_window_mismatch/);
  assert.equal(evaluateStage(evidence, stage({ windowMinutes: 30 }), recorded()).verdict, 'demonstrated');
  assert.throws(() => evaluateStage({ ...evidence, schema: 'other' }, stage(), recorded()), /stage_evidence_schema/);
});

test('the CLI reads job pages, takes the stage window, and exits 2 on a stop', () => {
  const files = {
    'jobs.json': JSON.stringify([{ jobs: block(2, 0, 40) }, { jobs: block(2, 0, 40, 3) }]),
    'five.json': JSON.stringify({ jobs: block(5, 0, 40) }),
    'stage.json': JSON.stringify(stage({ windowMinutes: 20 })),
    'recorded.json': JSON.stringify(recorded()),
  };
  const run = args => { let out = ''; const code = main(args, { read: path => files[path], print: text => { out += text; } }); return { code, report: JSON.parse(out) }; };
  const plain = run(['--jobs', 'jobs.json', '--levels', '2,4']);
  assert.equal(plain.code, 0);
  assert.equal(plain.report.stage, undefined);
  assert.deepEqual(plain.report.evidence.running.atOrAbove, [{ level: 2, totalMinutes: 40, longestMinutes: 40 }, { level: 4, totalMinutes: 40, longestMinutes: 40 }]);
  const judged = run(['--jobs', 'jobs.json', '--stage', 'stage.json', '--recorded', 'recorded.json']);
  assert.deepEqual([judged.code, judged.report.evidence.windowMinutes, judged.report.stage.verdict], [0, 20, 'demonstrated']);
  assert.equal(run(['--jobs', 'jobs.json', '--stage', 'stage.json']).report.stage.verdict, 'incomplete');
  assert.equal(run(['--jobs', 'five.json', '--stage', 'stage.json', '--recorded', 'recorded.json']).code, 2);
  assert.equal(run(['--jobs', 'jobs.json', '--name', '^frontend', '--event', 'push']).report.evidence.records.outOfScope, 4);
  assert.throws(() => main(['--stage', 'stage.json'], { read: path => files[path], print() {} }), /usage/);
  assert.throws(() => main(['--jobs'], { read: path => files[path], print() {} }), /usage/);
  assert.throws(() => main(['--other', 'x'], { read: path => files[path], print() {} }), /usage/);
  assert.deepEqual(readRows({ jobs: [1] }), [1]);
  assert.throws(() => readRows({ runs: [] }), /stage_evidence_rows/);
});
