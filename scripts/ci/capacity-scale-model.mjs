#!/usr/bin/env node
/**
 * D8333 (#8333): sizing and feasibility model for the CI capacity pool. Pure arithmetic over recorded inputs:
 * no network, no clock, no GitHub call. It answers what a target number of concurrently running jobs needs in
 * slots, machines, coordinator API calls and queue wait, and which enforced limit stops it first.
 *
 * The recorded ceilings and per-pass costs are not opinions: `frontend/test/ci_capacity_scale_8333.test.mjs`
 * probes the real validators and measures the real coordinator loop, so a change to either fails that test
 * until this record is updated. Planning figures are not approval to provision anything.
 *
 *   node scripts/ci/capacity-scale-model.mjs            # the 120 / 240 / 480 table from MEASURED
 *   node scripts/ci/capacity-scale-model.mjs 360        # one target
 */
import { pathToFileURL } from 'node:url';

/** The limits the source enforces today. Each is probed by the test against the validator that owns it. */
export const ENFORCED_CEILINGS = Object.freeze({
  /** `validateCapacityPolicy`: maxActiveRequests above 8 is refused; the coordinator defaults to 8. */
  maxActiveRequests: 8,
  /** `submissionMatches`: at most six shards, each named worker-N-of-6. */
  maxShardsPerRequest: 6,
  /** `validateCapacityPolicy`: maxExternalWorkerShards above 2 is refused. Per request. */
  maxExternalPerRequest: 2,
  /** `validateCapacityPolicy`: maxIncludedWorkerShards above 1 is refused. Across all requests. */
  maxIncludedInFlight: 1,
  /** `validateScaleConfig`: stages are 1, 5, 10 and 50; approvedCap and each profile's max stay within the stage. */
  fleetStageMax: 50,
  /** `FleetNode.runnerId` is one runner: the fleet policy models one job slot per node. */
  slotsPerFleetNode: 1,
});

/**
 * GitHub REST calls each coordinator port makes, measured on the real adapter at #8234 head 8c11fb864c34 with the
 * repository's synthetic GitHub fixture (D8333 §2): 11 to submit, 29 on the dispatch pass, 15 on a steady pass.
 */
export const PORT_API_CALLS = Object.freeze({
  parent: Object.freeze({ push: 2, merge_group: 3 }),
  prerequisites: 1,
  observe: 2,
  submit: 11,
  dispatchPass: 29,
});

/** Budgets and windows the model reads; the test checks them against `CI_CAPACITY_BUDGETS`. */
export const WINDOWS = Object.freeze({ reconcileMs: 15_000, externalStartMs: 90_000, externalExecutionMs: 25 * 60_000 });

/** One job container, from `scripts/ci/runners/job-container.mjs`: --cpus 2, --memory 4 GiB, --pids-limit 256. */
export const SLOT_RESOURCES = Object.freeze({ cpus: 2, memoryGiB: 4, pids: 256, workTmpfsGiB: 4 });

/**
 * Hosted CI on 2026-11-22T00:00Z to 2026-11-23T10:42Z: 668 ci.yml runs, 9,350 jobs that held a runner. Every
 * figure is the output of `scripts/ci/capacity-stage-evidence.mjs` on those records (D8421), which counts a job
 * as running only while it held a runner. The first record (D8333) also counted 281 suite jobs that were
 * cancelled while still waiting, and reported a peak of 147 running; the true peak of all ci.yml jobs is 60.
 */
export const MEASURED = Object.freeze({
  workerShardMinutes: Object.freeze({ p50: 26.0, p90: 39.1, p95: 43.1 }),
  frontendShardMinutes: Object.freeze({ p50: 11.8, p95: 15.0 }),
  /** All ci.yml jobs: never more than 60 at once, 56 held for 30 minutes. */
  hostedJobsRunning: Object.freeze({ peak: 60, sustained30: 56 }),
  suiteShardsRunning: Object.freeze({ timeAverage: 36.1, peak: 60, sustained30: 56 }),
  /** What would have run had each suite shard started when it was created; a floor, cancelled waits excluded. */
  suiteShardsOffered: Object.freeze({ peak: 192, sustained30: 88 }),
  /** Merge-queue Worker shards, the only work the prepared route may move off hosted runners. */
  queueWorkerShardsOffered: Object.freeze({ peak: 54, sustained30: 20 }),
  workerShardsCompletedPerHour: Object.freeze({ median: 76, busiest: 118 }),
  workerShardsRanByEvent: Object.freeze({ merge_group: 1193, pull_request: 1182, push: 0 }),
  /** Suite shards, creation to start. */
  queueWaitMinutes: Object.freeze({ p50: 8.5, p95: 62.6 }),
});

const positive = (n) => Number.isFinite(n) && n > 0;
const need = (ok, reason) => { if (!ok) throw new Error(reason); };

/**
 * The most the enforced limits allow at once, and which limit binds. `logicalAssignments` counts shards the
 * coordinator may hold open; `externalRunning` counts jobs that can physically run off standard hosted runners.
 */
export function policyCeiling(ceilings = ENFORCED_CEILINGS) {
  const logicalAssignments = ceilings.maxActiveRequests * ceilings.maxShardsPerRequest;
  const byRequests = ceilings.maxActiveRequests * ceilings.maxExternalPerRequest;
  const byFleet = ceilings.fleetStageMax * ceilings.slotsPerFleetNode;
  const selfHosted = Math.min(byRequests, byFleet);
  return {
    logicalAssignments,
    externalRunning: selfHosted + ceilings.maxIncludedInFlight,
    selfHostedRunning: selfHosted,
    binding: byRequests <= byFleet ? 'maxActiveRequests x maxExternalPerRequest' : 'fleetStageMax x slotsPerFleetNode',
  };
}

/** REST calls one steady coordinator pass makes for one active request with every shard dispatched. */
export function steadyCallsPerPass({ shards = 6, event = 'merge_group' } = {}) {
  need(Number.isSafeInteger(shards) && shards > 0 && PORT_API_CALLS.parent[event] !== undefined, 'invalid_pass_shape');
  return PORT_API_CALLS.parent[event] + PORT_API_CALLS.prerequisites + shards * PORT_API_CALLS.observe;
}

/**
 * Coordinator load for a number of simultaneously active requests. The loop awaits one call at a time, so a pass
 * lasts the sum of its calls, and receipt admission waits behind it (measured in the test).
 */
export function coordinatorLoad({ activeRequests, shards = 6, event = 'merge_group', passMs = WINDOWS.reconcileMs, apiLatencyMs = 150, apiBudgetPerHour }) {
  need(Number.isSafeInteger(activeRequests) && activeRequests >= 0 && positive(passMs) && positive(apiLatencyMs) && positive(apiBudgetPerHour), 'invalid_load_input');
  const perRequest = steadyCallsPerPass({ shards, event });
  const callsPerPass = activeRequests * perRequest;
  const passDurationMs = callsPerPass * apiLatencyMs;
  // A pass cannot start before the previous one ends, so the real cadence is the longer of the two.
  const cadenceMs = Math.max(passMs, passDurationMs);
  const callsPerHour = Math.round(callsPerPass * (3_600_000 / cadenceMs));
  return {
    callsPerPass, callsPerHour, passDurationMs,
    budgetUse: callsPerHour / apiBudgetPerHour,
    maxRequestsWithinBudget: Math.floor(apiBudgetPerHour / (perRequest * (3_600_000 / passMs))),
    // The shortest lease window is the external start deadline: an executor must be admitted inside it.
    maxRequestsWithinStartWindow: Math.floor(WINDOWS.externalStartMs / (perRequest * apiLatencyMs)),
  };
}

/** The slowest steady polling interval that keeps `activeRequests` inside an API budget, in milliseconds. */
export function passIntervalForBudget({ activeRequests, shards = 6, event = 'merge_group', apiBudgetPerHour, callsPerRequestPerPass }) {
  const perRequest = callsPerRequestPerPass ?? steadyCallsPerPass({ shards, event });
  need(positive(activeRequests) && positive(apiBudgetPerHour) && positive(perRequest), 'invalid_interval_input');
  return Math.ceil((activeRequests * perRequest * 3_600_000) / apiBudgetPerHour);
}

/** Erlang C: the probability that an arriving job waits, for `servers` slots and `offered` erlangs of load. */
export function erlangC(servers, offered) {
  need(Number.isSafeInteger(servers) && servers > 0 && Number.isFinite(offered) && offered >= 0, 'invalid_erlang_input');
  if (offered >= servers) return 1;
  // Erlang B by its stable recurrence, then converted; avoids factorials at hundreds of servers.
  let b = 1;
  for (let k = 1; k <= servers; k++) b = (offered * b) / (k + offered * b);
  const rho = offered / servers;
  return b / (1 - rho + rho * b);
}

/** Steady-state queueing for a pool of `slots`, jobs arriving at `arrivalsPerHour`, each taking `serviceMinutes`. */
export function queueWait({ arrivalsPerHour, serviceMinutes, slots }) {
  need(positive(arrivalsPerHour) && positive(serviceMinutes) && Number.isSafeInteger(slots) && slots > 0, 'invalid_queue_input');
  const offered = (arrivalsPerHour / 60) * serviceMinutes;
  const utilisation = offered / slots;
  if (utilisation >= 1) return { offered, utilisation, stable: false, waitProbability: 1, meanWaitMinutes: Infinity, completionsPerHour: (slots * 60) / serviceMinutes };
  const waitProbability = erlangC(slots, offered);
  return {
    offered, utilisation, stable: true, waitProbability,
    meanWaitMinutes: (waitProbability * serviceMinutes) / (slots - offered),
    completionsPerHour: arrivalsPerHour,
  };
}

/** Slots, machines and resources for a target of concurrently running jobs. Machines never equal jobs by assumption. */
export function sizeFor({ targetRunning, utilisationTarget = 0.8, slotsPerMachine, spareMachines = 1, slot = SLOT_RESOURCES, hostOverhead = { cpus: 2, memoryGiB: 4 } }) {
  need(Number.isSafeInteger(targetRunning) && targetRunning > 0 && utilisationTarget > 0 && utilisationTarget <= 1
    && Number.isSafeInteger(slotsPerMachine) && slotsPerMachine > 0 && Number.isSafeInteger(spareMachines) && spareMachines >= 0, 'invalid_size_input');
  const slots = Math.ceil(targetRunning / utilisationTarget);
  const machines = Math.ceil(slots / slotsPerMachine) + spareMachines;
  return {
    slots, machines,
    perMachine: {
      cpus: slotsPerMachine * slot.cpus + hostOverhead.cpus,
      // The /work tmpfs is charged to the container's memory limit, so it adds nothing beyond the limit itself.
      memoryGiB: slotsPerMachine * slot.memoryGiB + hostOverhead.memoryGiB,
      pids: slotsPerMachine * slot.pids,
    },
    total: { cpus: slots * slot.cpus, memoryGiB: slots * slot.memoryGiB },
  };
}

/** One planning row: what the target needs, what the coordinator would cost, and what stops it today. */
export function scenario({ targetRunning, shards = 6, serviceMinutes = MEASURED.workerShardMinutes.p50, slotsPerMachine = 4, apiBudgetPerHour = 15_000, apiLatencyMs = 150, event = 'merge_group', ceilings = ENFORCED_CEILINGS }) {
  const size = sizeFor({ targetRunning, slotsPerMachine });
  const activeRequests = Math.ceil(targetRunning / shards);
  const load = coordinatorLoad({ activeRequests, shards, event, apiBudgetPerHour, apiLatencyMs });
  const ceiling = policyCeiling(ceilings);
  // Arrivals that keep `targetRunning` jobs in service on average.
  const arrivalsPerHour = (targetRunning * 60) / serviceMinutes;
  const queue = queueWait({ arrivalsPerHour, serviceMinutes, slots: size.slots });
  const blockers = [];
  if (targetRunning > ceiling.externalRunning) blockers.push(`policy allows ${ceiling.externalRunning} external running jobs (${ceiling.binding})`);
  if (activeRequests > ceilings.maxActiveRequests) blockers.push(`needs ${activeRequests} active requests, policy admits ${ceilings.maxActiveRequests}`);
  if (size.slots > ceilings.fleetStageMax * ceilings.slotsPerFleetNode) blockers.push(`needs ${size.slots} slots, fleet policy ends at ${ceilings.fleetStageMax}`);
  if (load.budgetUse > 1) blockers.push(`polling needs ${load.callsPerHour} API calls an hour against ${apiBudgetPerHour}`);
  if (activeRequests > load.maxRequestsWithinStartWindow) blockers.push(`a pass lasts ${Math.round(load.passDurationMs / 1000)} s, longer than the ${WINDOWS.externalStartMs / 1000} s start window`);
  return {
    targetRunning, activeRequests, slots: size.slots, machines: size.machines, perMachine: size.perMachine, total: size.total,
    completionsPerHour: Math.round(arrivalsPerHour), meanWaitMinutes: queue.meanWaitMinutes, waitProbability: queue.waitProbability,
    coordinator: load,
    pollingIntervalForBudgetMs: passIntervalForBudget({ activeRequests, shards, event, apiBudgetPerHour }),
    blockers,
  };
}

export function main(argv = process.argv.slice(2), write = (line) => process.stdout.write(line + '\n')) {
  const targets = argv.length ? argv.map(Number) : [120, 240, 480];
  need(targets.every((n) => Number.isSafeInteger(n) && n > 0), 'usage: capacity-scale-model.mjs [target running jobs ...]');
  const ceiling = policyCeiling();
  write(`Enforced today: ${ceiling.logicalAssignments} logical assignments, ${ceiling.externalRunning} external running jobs (${ceiling.binding}).`);
  for (const target of targets) {
    const row = scenario({ targetRunning: target });
    write(`${target} running: ${row.slots} slots on ${row.machines} machines (${row.perMachine.cpus} CPU, ${row.perMachine.memoryGiB} GiB each), `
      + `${row.activeRequests} active requests, ${row.completionsPerHour} completions/h, mean wait ${row.meanWaitMinutes.toFixed(2)} min, `
      + `${row.coordinator.callsPerHour} API calls/h at ${Math.round(row.coordinator.passDurationMs / 1000)} s a pass.`);
    for (const blocker of row.blockers) write(`  blocked: ${blocker}`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
