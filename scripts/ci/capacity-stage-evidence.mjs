#!/usr/bin/env node
/**
 * D8421 (#8421): stage evidence for the CI capacity pool, computed from provider job records, and a stage verdict.
 * Pure functions over the records: no network, no clock, no GitHub call, nothing written but the report.
 *
 * It keeps apart the things a capacity claim tends to merge:
 *   - jobs that were created, jobs that started, and jobs running at one moment;
 *   - the peak, and the level that held for a whole window (a launch burst is not stable capacity);
 *   - runner registrations, independent machines, and the most jobs one machine ran at once;
 *   - capacity that was configured, capacity that was approved, and capacity that was demonstrated.
 *
 * A record is one job attempt in the GitHub jobs API shape (`created_at`, `started_at`, `completed_at`,
 * `conclusion`, `runner_id`, `runner_name`, `run_id`, `run_attempt`, `name`). The same shape describes a hosted
 * job and a pool executor job, so one calculator serves both. Nothing here approves a machine, a limit or a stage.
 *
 *   node scripts/ci/capacity-stage-evidence.mjs --jobs jobs.json
 *   node scripts/ci/capacity-stage-evidence.mjs --jobs jobs.json --name '^suite \(' --window 30 --stage stage.json
 *   `--event merge_group` keeps rows whose `event` field (added by whoever collected them) matches.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const EVIDENCE_SCHEMA = 'studioos-capacity-stage-evidence/v1';
export const DEFAULT_WINDOW_MINUTES = 30;
/** Facts only the coordinator, the provider's bill or the teardown check can supply. A verdict never assumes one. */
export const RECORDED_FACTS = Object.freeze(['apiBudgetUsedFraction', 'retainedReservationsGrew', 'cleanupResidue', 'costRecorded']);
const MINUTE = 60_000, HOUR = 3_600_000;

const time = value => (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN);
const fail = code => { throw new Error(code); };

/**
 * Sort raw records into attempts that ran, attempts still open, attempts that never started, and unusable rows.
 * `machineOf` names the independent machine behind a record; without it each runner name is its own machine,
 * which is right for a hosted runner (one fresh machine a job) and wrong for a machine with several registrations.
 */
export function normalizeJobs(rows, { nameMatch = null, event = null, machineOf = row => row.runner_name ?? null } = {}) {
  if (!Array.isArray(rows)) fail('stage_evidence_rows');
  const ran = [], open = [];
  let notRun = 0, invalid = 0, outOfScope = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.name !== 'string') { invalid++; continue; }
    if ((nameMatch && !nameMatch.test(row.name)) || (event && row.event !== event)) { outOfScope++; continue; }
    const created = time(row.created_at), started = time(row.started_at), completed = time(row.completed_at);
    // A skipped or cancelled-before-start job carries start and end stamps but occupied no runner.
    if (!Number.isFinite(started) || (!row.runner_id && !row.runner_name)) {
      if (row.conclusion === 'skipped' || row.status === 'completed') notRun++;
      else if (Number.isFinite(created)) open.push({ name: row.name, created, started: null });
      else invalid++;
      continue;
    }
    if (!Number.isFinite(created) || started < created - MINUTE) { invalid++; continue; }
    if (row.status !== 'completed' || !Number.isFinite(completed)) { open.push({ name: row.name, created, started }); continue; }
    if (completed < started) { invalid++; continue; }
    const machine = machineOf(row);
    ran.push({
      id: row.id ?? null, name: row.name, runId: row.run_id ?? null, attempt: Number.isSafeInteger(row.run_attempt) ? row.run_attempt : 1,
      created: Math.min(created, started), started, completed, conclusion: row.conclusion ?? 'unknown',
      registration: row.runner_id ?? row.runner_name, machine: machine ?? `unnamed:${row.runner_id}`,
    });
  }
  return { ran, open, notRun, invalid, outOfScope };
}

/** Step series of how many intervals are open, as [time, count] after all the changes at that time. */
export function stepSeries(intervals) {
  const events = [];
  for (const [from, to] of intervals) { if (to > from) events.push([from, 1], [to, -1]); }
  events.sort((a, b) => a[0] - b[0]);
  const series = [];
  let count = 0;
  for (const [at, change] of events) {
    count += change;
    if (series.length && series.at(-1)[0] === at) series.at(-1)[1] = count; else series.push([at, count]);
  }
  return series;
}

/** Peak and time average of a step series over its own span. */
export function summarize(series) {
  if (series.length < 2) return { peak: series[0]?.[1] ?? 0, peakAt: series[0]?.[0] ?? null, average: 0, spanMs: 0 };
  let peak = 0, peakAt = null, area = 0;
  for (let i = 0; i < series.length; i++) {
    const [at, count] = series[i];
    if (count > peak) { peak = count; peakAt = at; }
    if (i + 1 < series.length) area += count * (series[i + 1][0] - at);
  }
  const spanMs = series.at(-1)[0] - series[0][0];
  return { peak, peakAt, average: spanMs ? area / spanMs : 0, spanMs };
}

/** Longest unbroken time the series stayed at or above `level`, and the total time there. */
export function timeAtOrAbove(series, level) {
  let longest = 0, total = 0, run = 0, longestFrom = null, from = null;
  for (let i = 0; i + 1 < series.length; i++) {
    const [at, count] = series[i], length = series[i + 1][0] - at;
    if (count >= level) {
      if (!run) from = at;
      run += length; total += length;
      if (run > longest) { longest = run; longestFrom = from; }
    } else run = 0;
  }
  return { level, longestMs: longest, longestFrom, totalMs: total };
}

/** The highest level the series held, without a break, for at least `windowMs`. Zero when nothing ran that long. */
export function sustainedLevel(series, windowMs) {
  if (!(windowMs > 0)) fail('stage_evidence_window');
  let low = 0, high = summarize(series).peak;
  // Holding a level for the window implies holding every lower level, so the answer is found by bisection.
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (timeAtOrAbove(series, middle).longestMs >= windowMs) low = middle; else high = middle - 1;
  }
  return low;
}

/** Nearest-rank percentile; null for no values. */
export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}

/** Completions in each whole clock hour inside the span; partial first and last hours are left out. */
export function completionsPerHour(ran) {
  if (!ran.length) return { hours: 0, median: null, busiest: null, total: 0 };
  const first = Math.min(...ran.map(job => job.started)), last = Math.max(...ran.map(job => job.completed));
  const from = Math.ceil(first / HOUR) * HOUR, to = Math.floor(last / HOUR) * HOUR;
  const counts = new Map();
  for (let hour = from; hour < to; hour += HOUR) counts.set(hour, 0);
  for (const job of ran) {
    const hour = Math.floor(job.completed / HOUR) * HOUR;
    if (counts.has(hour)) counts.set(hour, counts.get(hour) + 1);
  }
  const values = [...counts.values()];
  return { hours: values.length, median: percentile(values, 0.5), busiest: values.length ? Math.max(...values) : null, total: ran.length };
}

/** Registrations, machines, slots used on one machine, and how long at least two machines were busy together. */
export function machineUse(ran) {
  const byMachine = new Map();
  for (const job of ran) {
    if (!byMachine.has(job.machine)) byMachine.set(job.machine, []);
    byMachine.get(job.machine).push([job.started, job.completed]);
  }
  let mostJobsOnOneMachine = 0;
  const busy = [];
  for (const intervals of byMachine.values()) {
    const series = stepSeries(intervals);
    mostJobsOnOneMachine = Math.max(mostJobsOnOneMachine, summarize(series).peak);
    // One interval for each stretch in which the machine ran anything.
    let from = null;
    for (const [at, count] of series) {
      if (count > 0 && from === null) from = at;
      if (count === 0 && from !== null) { busy.push([from, at]); from = null; }
    }
  }
  const machinesBusy = stepSeries(busy);
  const together = timeAtOrAbove(machinesBusy, 2);
  return {
    registrations: new Set(ran.map(job => job.registration)).size, machines: byMachine.size, mostJobsOnOneMachine,
    peakMachinesBusy: summarize(machinesBusy).peak, machinesBusySeries: machinesBusy,
    overlapLongestMs: together.longestMs, overlapTotalMs: together.totalMs,
  };
}

/** Everything measurable from the records. Durations are minutes; `windowMinutes` sets what "sustained" means. */
export function stageEvidence(rows, { windowMinutes = DEFAULT_WINDOW_MINUTES, nameMatch = null, event = null, machineOf, levels = [] } = {}) {
  if (!(windowMinutes > 0)) fail('stage_evidence_window');
  const { ran, open, notRun, invalid, outOfScope } = normalizeJobs(rows, { nameMatch, event, machineOf });
  const running = stepSeries(ran.map(job => [job.started, job.completed]));
  const waiting = stepSeries(ran.map(job => [job.created, job.started]));
  // What would have been running had every job started when it was created: the load offered to the runners.
  // Jobs cancelled before they got a runner have no duration and are left out, so this is a floor.
  const offered = stepSeries(ran.map(job => [job.created, job.created + (job.completed - job.started)]));
  const shape = summarize(running), demand = summarize(offered), machines = machineUse(ran);
  const waits = ran.map(job => (job.started - job.created) / MINUTE), durations = ran.map(job => (job.completed - job.started) / MINUTE);
  const outcomes = {};
  for (const job of ran) outcomes[job.conclusion] = (outcomes[job.conclusion] ?? 0) + 1;
  const round = value => (value === null ? null : Math.round(value * 10) / 10);
  const { machinesBusySeries, ...machineFacts } = machines;
  return {
    schema: EVIDENCE_SCHEMA, windowMinutes,
    records: { given: rows.length, ran: ran.length, stillOpen: open.length, neverRan: notRun, unusable: invalid, outOfScope },
    span: { from: running[0] ? new Date(running[0][0]).toISOString() : null, to: running.length ? new Date(running.at(-1)[0]).toISOString() : null, hours: round(shape.spanMs / HOUR) },
    running: {
      peak: shape.peak, peakAt: shape.peakAt === null ? null : new Date(shape.peakAt).toISOString(), timeAverage: round(shape.average),
      sustained: sustainedLevel(running, windowMinutes * MINUTE),
      atOrAbove: levels.map(level => { const held = timeAtOrAbove(running, level); return { level, totalMinutes: round(held.totalMs / MINUTE), longestMinutes: round(held.longestMs / MINUTE) }; }),
    },
    offered: { peak: demand.peak, timeAverage: round(demand.average), sustained: sustainedLevel(offered, windowMinutes * MINUTE) },
    waiting: { peak: summarize(waiting).peak, p50Minutes: round(percentile(waits, 0.5)), p95Minutes: round(percentile(waits, 0.95)) },
    duration: { p50Minutes: round(percentile(durations, 0.5)), p90Minutes: round(percentile(durations, 0.9)), p95Minutes: round(percentile(durations, 0.95)) },
    completions: completionsPerHour(ran),
    machines: {
      ...machineFacts, sustainedMachinesBusy: sustainedLevel(machinesBusySeries, windowMinutes * MINUTE),
      overlapLongestMinutes: round(machines.overlapLongestMs / MINUTE), overlapTotalMinutes: round(machines.overlapTotalMs / MINUTE),
    },
    attempts: { afterTheFirst: ran.filter(job => job.attempt > 1).length, outcomes },
  };
}

const whole = (value, low = 0) => Number.isSafeInteger(value) && value >= low;

/** A stage's limits are explicit; a missing or malformed one is refused rather than defaulted. */
export function validateStage(stage) {
  if (!stage || typeof stage !== 'object') fail('stage_limits');
  const { target, approvedRunningJobs, configuredSlots, minMachines, maxP95WaitMinutes, maxFailedFraction, maxApiBudgetFraction } = stage;
  if (!whole(target, 1) || !whole(approvedRunningJobs, 1) || !whole(configuredSlots, 1) || !whole(minMachines, 1)) fail('stage_limits');
  if (target > approvedRunningJobs || approvedRunningJobs > configuredSlots) fail('stage_limits_order');
  for (const fraction of [maxFailedFraction, maxApiBudgetFraction]) if (!(typeof fraction === 'number' && fraction >= 0 && fraction <= 1)) fail('stage_limits');
  if (!(typeof maxP95WaitMinutes === 'number' && maxP95WaitMinutes >= 0)) fail('stage_limits');
  if (stage.slotsPerMachine !== undefined && !whole(stage.slotsPerMachine, 1)) fail('stage_limits');
  if (stage.windowMinutes !== undefined && !(typeof stage.windowMinutes === 'number' && stage.windowMinutes > 0)) fail('stage_limits');
  return stage;
}

/**
 * Judge one stage. `recorded` carries the facts in RECORDED_FACTS when someone measured them.
 *   stop          the stage ran past what was approved, or a stop threshold was crossed: scale down first
 *   below_target  the target was never reached
 *   burst_only    the target was reached but did not hold for the window
 *   incomplete    it held, but a required fact was not recorded, so nothing is demonstrated yet
 *   demonstrated  it held for the window inside every limit
 * `demonstratedRunningJobs` is the sustained level, capped at what was approved; it is zero for a stop.
 */
export function evaluateStage(evidence, stage, recorded = {}) {
  validateStage(stage);
  if (evidence?.schema !== EVIDENCE_SCHEMA) fail('stage_evidence_schema');
  // The window is part of the claim: evidence measured over another window cannot answer this stage.
  if (stage.windowMinutes !== undefined && stage.windowMinutes !== evidence.windowMinutes) fail('stage_window_mismatch');
  const stops = [], shortfalls = [], unrecorded = [];
  if (evidence.running.peak > stage.approvedRunningJobs) stops.push(`peak ${evidence.running.peak} running jobs passed the approved ${stage.approvedRunningJobs}`);
  if (evidence.machines.mostJobsOnOneMachine > 1 && stage.slotsPerMachine === undefined) stops.push(`a machine ran ${evidence.machines.mostJobsOnOneMachine} jobs at once and the stage records no slots per machine`);
  if (stage.slotsPerMachine !== undefined && evidence.machines.mostJobsOnOneMachine > stage.slotsPerMachine) stops.push(`a machine ran ${evidence.machines.mostJobsOnOneMachine} jobs at once, above its ${stage.slotsPerMachine} slots`);
  if (recorded.retainedReservationsGrew === true) stops.push('retained reservations grew');
  if (recorded.cleanupResidue === true) stops.push('cleanup left residue');
  if (typeof recorded.apiBudgetUsedFraction === 'number' && recorded.apiBudgetUsedFraction > stage.maxApiBudgetFraction) stops.push(`API budget use ${recorded.apiBudgetUsedFraction} passed ${stage.maxApiBudgetFraction}`);
  const finished = Object.values(evidence.attempts.outcomes).reduce((sum, count) => sum + count, 0);
  const failed = finished - (evidence.attempts.outcomes.success ?? 0);
  if (finished && failed / finished > stage.maxFailedFraction) shortfalls.push(`${failed} of ${finished} attempts did not succeed, above ${stage.maxFailedFraction}`);
  if (evidence.waiting.p95Minutes !== null && evidence.waiting.p95Minutes > stage.maxP95WaitMinutes) shortfalls.push(`p95 wait ${evidence.waiting.p95Minutes} minutes is above ${stage.maxP95WaitMinutes}`);
  if (evidence.machines.sustainedMachinesBusy < stage.minMachines) shortfalls.push(`${evidence.machines.sustainedMachinesBusy} machines stayed busy for the window; the stage needs ${stage.minMachines}`);
  for (const fact of RECORDED_FACTS) {
    const value = recorded[fact];
    const present = fact === 'apiBudgetUsedFraction' ? typeof value === 'number' && value >= 0 : fact === 'costRecorded' ? value === true : typeof value === 'boolean';
    if (!present) unrecorded.push(fact);
  }
  const reached = evidence.running.peak >= stage.target, held = evidence.running.sustained >= stage.target;
  const verdict = stops.length ? 'stop' : !reached ? 'below_target' : !held ? 'burst_only' : shortfalls.length || unrecorded.length ? 'incomplete' : 'demonstrated';
  return {
    verdict, target: stage.target, windowMinutes: evidence.windowMinutes,
    capacity: {
      configuredSlots: stage.configuredSlots, approvedRunningJobs: stage.approvedRunningJobs,
      peakRunningJobs: evidence.running.peak, sustainedRunningJobs: evidence.running.sustained,
      demonstratedRunningJobs: verdict === 'demonstrated' ? Math.min(evidence.running.sustained, stage.approvedRunningJobs) : 0,
    },
    stops, shortfalls, unrecorded,
  };
}

/** Accepts a flat array, `{ jobs: [...] }`, or a list of pages each holding `jobs`. */
export function readRows(document) {
  if (Array.isArray(document)) return document.flatMap(entry => (Array.isArray(entry?.jobs) ? entry.jobs : [entry]));
  if (Array.isArray(document?.jobs)) return document.jobs;
  return fail('stage_evidence_rows');
}

export function main(args, { read = path => readFileSync(path, 'utf8'), print = value => process.stdout.write(value) } = {}) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--jobs', '--stage', '--recorded', '--window', '--name', '--event', '--levels'].includes(args[i]) || args[i + 1] === undefined) fail('usage: capacity-stage-evidence.mjs --jobs <file> [--name <regex>] [--event <event>] [--window <minutes>] [--levels 60,120] [--stage <file> [--recorded <file>]]');
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!options.jobs) fail('usage: capacity-stage-evidence.mjs --jobs <file>');
  const stage = options.stage ? validateStage(JSON.parse(read(options.stage))) : null;
  const evidence = stageEvidence(readRows(JSON.parse(read(options.jobs))), {
    windowMinutes: options.window !== undefined ? Number(options.window) : stage?.windowMinutes ?? DEFAULT_WINDOW_MINUTES,
    nameMatch: options.name ? new RegExp(options.name) : null, event: options.event ?? null,
    levels: options.levels ? options.levels.split(',').map(Number) : [],
  });
  const report = stage
    ? { evidence, stage: evaluateStage(evidence, stage, options.recorded ? JSON.parse(read(options.recorded)) : {}) }
    : { evidence };
  print(`${JSON.stringify(report, null, 2)}\n`);
  return report.stage?.verdict === 'stop' ? 2 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
