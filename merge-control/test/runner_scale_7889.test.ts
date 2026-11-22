/** D7889: simulated fleet proposals, restart fences, provider pagination and one-job supervision; no live nodes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyFleet, imageEligible, imageMatches, fairDemand, planFleet, commitFleet, recordFleetEvent, operationAllowed, retryScale,
  type ScaleConfig, type FleetState, type ImageProfile } from '../src/lib/runnerScalePolicy.ts';
import { collectProviderInventory, UnavailableRunnerProvider, type RunnerScaleProvider, type ProviderInventoryCheckpoint } from '../src/runnerScaleProvider.ts';

const NOW = 1_000_000;
const IMAGE: ImageProfile = { approved: true, version: 'fixture-v1', digest: `sha256:${'a'.repeat(64)}`, os: 'linux', arch: 'x64', runnerVersion: '2.0.1', runnerDigest: 'b'.repeat(64), nodeVersion: '22.23.3', pythonVersion: '3.12.9' };
function config(cap: 1 | 5 | 10 | 50 = 1): ScaleConfig {
  return { enabled: true, approvedCap: cap, stage: cap, minHostedShards: 4, maxExternalPerRun: 2, perRunPerProfile: 2,
    maxNewPerInterval: cap, intervalMs: 60_000, cooldownMs: 10_000, warmupMs: 60_000, heartbeatMs: 30_000,
    idleMs: 120_000, lifetimeMs: 600_000, maxRetries: 3,
    profiles: { 'linux-x64': { min: 0, max: cap, image: structuredClone(IMAGE) } },
    budget: { approved: true, meterVerified: true, remainingUnits: 100_000, unitsPerNodeMinute: 1, expiresAt: NOW + 3_600_000, maxJobMs: 120_000, terminationMs: 30_000, billingLagMs: 30_000 } };
}
const demands = (count = 50) => Array.from({ length: count }, (_, i) => ({ run: `run-${i}`, profile: 'linux-x64', queued: 6, oldestAt: NOW - 1000 }));
const inventory = (state = emptyFleet(), now = NOW) => ({ complete: true, observedAt: now, instances: state.nodes.filter((n) => n.providerId && n.phase !== 'deleted').map((n) => ({ providerId: n.providerId!, reservation: n.reservation, owned: true })) });
function ready(configured = config()): FleetState {
  let state = planFleet(emptyFleet(), configured, inventory(), demands(), NOW).state;
  for (const [i, n] of [...state.nodes].entries()) {
    state = recordFleetEvent(state, { id: `created-${i}`, reservation: n.reservation, generation: 1, kind: 'created', at: NOW + 1, providerId: `private-provider-${i}` }, configured);
    state = recordFleetEvent(state, { id: `ready-${i}`, reservation: n.reservation, generation: 1, kind: 'ready', at: NOW + 2,
      runnerId: 100 + i, bootVerified: true, observedImage: IMAGE, registrationVerified: true, online: true }, configured);
  }
  return state;
}

test('1, 5, 10 and 50 are simulated approved stage ceilings, not registrations or measured schedulable capacity', () => {
  for (const cap of [1, 5, 10, 50] as const) {
    const p = planFleet(emptyFleet(), config(cap), inventory(), demands(), NOW);
    assert.equal(p.operations.filter((o) => o.kind === 'create').length, cap);
    assert.equal(p.publicStatus.healthy, 0); assert.equal(p.publicStatus.unregistered, cap);
    assert.ok(p.state.reservedUnits > 0);
    assert.equal(new Set(p.operations.map((o) => o.key)).size, cap);
  }
});

test('no approval, unverified budget/image, stale inventory or orphan evidence allows scale-out; hosted share cannot be zero', () => {
  for (const change of [
    (c: ScaleConfig) => { c.enabled = false; }, (c: ScaleConfig) => { c.approvedCap = 0; },
    (c: ScaleConfig) => { c.budget.approved = false; },
    (c: ScaleConfig) => { c.budget.approved = false; c.budget.remainingUnits = null; c.budget.unitsPerNodeMinute = null; c.budget.expiresAt = null; },
    (c: ScaleConfig) => { c.budget.meterVerified = false; }, (c: ScaleConfig) => { c.profiles['linux-x64'].image.approved = false; },
  ]) {
    const c = config(); change(c); assert.equal(planFleet(emptyFleet(), c, inventory(), demands(), NOW).operations.length, 0);
  }
  const partial = planFleet(emptyFleet(), config(), { ...inventory(), complete: false }, demands(), NOW);
  assert.equal(partial.operations.length, 0); assert.equal(partial.publicStatus.healthy, null);
  assert.equal(planFleet(emptyFleet(), config(), { ...inventory(), observedAt: NOW - 31_000 }, demands(), NOW).operations.length, 0);
  assert.equal(planFleet(emptyFleet(), config(5), { ...inventory(), instances: [{ providerId: 'private-orphan', reservation: null, owned: false }] }, demands(), NOW).operations.length, 0);
  const limited = config(50); limited.approvedCap = 5;
  assert.equal(planFleet(emptyFleet(), limited, inventory(), demands(), NOW).state.nodes.length, 5, 'stage availability never replaces the smaller approval');
  assert.throws(() => planFleet(emptyFleet(), { ...config(), minHostedShards: 0 }, inventory(), demands(), NOW), /invalid_scale_config/);
  assert.throws(() => planFleet(emptyFleet(), { ...config(50), maxExternalPerRun: 6 }, inventory(), demands(), NOW), /invalid_scale_config/);
  assert.throws(() => planFleet(emptyFleet(), { ...config(50), perRunPerProfile: 7 }, inventory(), demands(), NOW), /invalid_scale_config/);
});

test('CAS and persisted reservations fence concurrent proposals, retain a pending effect on restart and prevent duplicate budget reservation', () => {
  const state = emptyFleet(); const c = config(5); const a = planFleet(state, c, inventory(), demands(), NOW); const b = planFleet(state, c, inventory(), demands(), NOW);
  assert.equal(operationAllowed(state, a.operations[0], a.state.revision), false);
  const committed = commitFleet(state, a)!;
  assert.equal(commitFleet(committed, b), null);
  assert.equal(operationAllowed(committed, a.operations[0], committed.revision), true);
  assert.equal(operationAllowed(committed, a.operations[0], committed.revision + 1), false);
  assert.equal(committed.reservedUnits, committed.nodes.reduce((sum, n) => sum + n.holdUnits, 0));
  const restored = JSON.parse(JSON.stringify(committed)); const restart = planFleet(restored, c, inventory(restored, NOW + 1), demands(), NOW + 1);
  assert.deepEqual(restart.operations.map((o) => o.key), a.operations.map((o) => o.key));
  assert.equal(restart.state.nodes.length, 5); assert.equal(restart.state.reservedUnits, committed.reservedUnits);
  const lowDemand = planFleet(emptyFleet(), c, inventory(), demands(1), NOW);
  assert.equal(lowDemand.state.nodes.length, 2, 'spare approved slots are not demand');
});

test('burst, cooldown and cost/expiry headroom constrain starts without changing six-shard fan-out or per-run fairness', () => {
  const c = config(10); c.maxNewPerInterval = 2;
  const first = planFleet(emptyFleet(), c, inventory(), demands(), NOW); assert.equal(first.state.nodes.length, 2);
  const second = planFleet(first.state, c, inventory(first.state, NOW + 20_000), demands(), NOW + 20_000);
  assert.equal(second.state.nodes.length, 2);
  c.maxNewPerInterval = 10;
  const cooldown = planFleet(first.state, c, inventory(first.state, NOW + 1), demands(), NOW + 1); assert.equal(cooldown.state.nodes.length, 2);
  const limited = config(50); limited.budget.remainingUnits = 13;
  assert.equal(planFleet(emptyFleet(), limited, inventory(), demands(), NOW).state.nodes.length, 1);
  limited.budget.expiresAt = NOW + 780_000;
  assert.equal(planFleet(emptyFleet(), limited, inventory(), demands(), NOW).state.nodes.length, 0);
  const fair = fairDemand([{ run: 'a', profile: 'linux-x64', queued: 6, oldestAt: NOW }, { run: 'b', profile: 'linux-x64', queued: 6, oldestAt: NOW }], config(10));
  assert.deepEqual(fair, { 'linux-x64': 4 });
  const multiple = config(10); multiple.profiles['linux-alt'] = { ...multiple.profiles['linux-x64'] };
  assert.deepEqual(fairDemand(['linux-x64', 'linux-alt'].map((profile) => ({ run: 'a', profile, queued: 6, oldestAt: NOW })), multiple), { 'linux-alt': 1, 'linux-x64': 1 });
});

test('failed boot and node loss quarantine real capacity; image/native/runtime and online group proof precede eligibility', () => {
  const c = config(); const reserved = planFleet(emptyFleet(), c, inventory(), demands(), NOW).state;
  const expired = planFleet(reserved, c, inventory(reserved, NOW + 60_000), demands(), NOW + 60_000);
  assert.equal(expired.publicStatus.missed_deadlines, 1);
  assert.deepEqual(expired.operations.map((o) => o.kind), ['inspect']);
  let state = ready(c); assert.equal(planFleet(state, c, inventory(state, NOW + 3), [], NOW + 3).publicStatus.healthy, 1);
  const lost = planFleet(state, c, inventory(emptyFleet(), NOW + 3), demands(), NOW + 3);
  assert.equal(lost.state.nodes[0].phase, 'uncertain'); assert.deepEqual(lost.operations.map((o) => o.kind), ['inspect']);
  const reconcile = { id: 'reconciled', kind: 'reconciled' as const, reservation: lost.state.nodes[0].reservation, generation: 1, at: NOW + 4, providerVerified: true, providerId: 'private-provider-0', runnerId: 100, assignment: 'none' as const };
  assert.equal(recordFleetEvent(lost.state, reconcile, c), lost.state, 'provider presence alone cannot prove old registration cleanup');
  const recovered = recordFleetEvent(lost.state, { ...reconcile, registrationRemoved: true }, c);
  assert.deepEqual([recovered.nodes[0].generation, recovered.nodes[0].registered, recovered.nodes[0].bootVerified], [2, false, false]);
  assert.equal(recordFleetEvent(recovered, { ...reconcile, id: 'late-old', kind: 'uncertain', at: NOW + 5 }, c), recovered);
  assert.equal(imageMatches(IMAGE, { ...IMAGE, arch: 'arm64' }), false);
  assert.equal(imageMatches(IMAGE, { ...IMAGE, nodeVersion: '22.0.0' }), false);
  assert.equal(imageEligible(JSON.parse(readFileSync(new URL('../../infra/runners/linux-x64.image.template.json', import.meta.url), 'utf8'))), false);
  c.profiles['linux-x64'].image = { ...IMAGE, digest: `sha256:${'d'.repeat(64)}` };
  assert.equal(planFleet(state, c, inventory(state, NOW + 3), [], NOW + 3).publicStatus.healthy, 0);
});

test('drain removes eligibility first, preserves busy/unowned work and rejects an assignment-race stale deletion fence', () => {
  const fleetConfig = config(5); const fleet = ready(fleetConfig); fleetConfig.approvedCap = 1;
  const reduced = planFleet(fleet, fleetConfig, inventory(fleet, NOW + 3), [], NOW + 3);
  assert.deepEqual([reduced.publicStatus.healthy, reduced.publicStatus.draining, reduced.operations.map((o) => o.kind)], [1, 4, Array(4).fill('remove-eligibility')]);
  fleetConfig.approvedCap = 5; fleetConfig.profiles['linux-x64'].max = 1;
  const profileReduced = planFleet(fleet, fleetConfig, inventory(fleet, NOW + 3), [], NOW + 3);
  assert.deepEqual([profileReduced.publicStatus.healthy, profileReduced.publicStatus.draining], [1, 4]);
  const jobConfig = config(); let finished = ready(jobConfig); const reservation = finished.nodes[0].reservation;
  finished = recordFleetEvent(finished, { id: 'started', kind: 'job-started', reservation, generation: 1, runnerId: 100, assignment: 'owned', at: NOW + 3 }, jobConfig);
  finished = recordFleetEvent(finished, { id: 'finished', kind: 'job-finished', reservation, generation: 1, runnerId: 100, at: NOW + 4 }, jobConfig);
  assert.deepEqual([finished.nodes[0].phase, finished.nodes[0].registered, finished.nodes[0].runnerId], ['draining', true, 100]);
  const c = config(); let state = ready(c); c.enabled = false;
  let p = planFleet(state, c, inventory(state, NOW + 3), [], NOW + 3);
  assert.deepEqual(p.operations.map((o) => o.kind), ['remove-eligibility']); state = p.state;
  state = recordFleetEvent(state, { id: 'removed', kind: 'drained', eligibilityRemoved: true, reservation: state.nodes[0].reservation, generation: 1, assignment: 'none', at: NOW + 4 }, c);
  p = planFleet(state, c, inventory(state, NOW + 5), [], NOW + 5); assert.equal(p.operations[0].kind, 'unregister');
  assert.equal(recordFleetEvent(p.state, { id: 'wrong-registration', kind: 'unregistered', registrationRemoved: true, runnerId: 9999, registrationVerified: true, reservation: state.nodes[0].reservation, generation: 1, at: NOW + 5 }, c), p.state);
  state = recordFleetEvent(p.state, { id: 'unregistered', kind: 'unregistered', registrationRemoved: true, runnerId: 100, registrationVerified: true, reservation: state.nodes[0].reservation, generation: 1, at: NOW + 5 }, c);
  p = planFleet(state, c, inventory(state, NOW + 5), [], NOW + 5); assert.equal(p.operations[0].kind, 'stop-delete');
  const raced = recordFleetEvent(p.state, { id: 'raced-assignment', kind: 'job-started', reservation: state.nodes[0].reservation, generation: 1, runnerId: 100, assignment: 'owned', at: NOW + 6 }, c);
  // The event must fence the old operation even if the provider effect has not started.
  assert.equal(operationAllowed(raced, p.operations[0], p.state.revision), false);
  assert.equal(operationAllowed(raced, p.operations[0], raced.revision), false);
  for (const assignment of ['owned', 'unowned', 'unknown'] as const) {
    const held = structuredClone(state); held.nodes[0].assignment = assignment; held.nodes[0].jobStartedAt = NOW;
    const kept = planFleet(held, c, inventory(held, NOW + 5), [], NOW + 5);
    assert.ok(kept.operations.every((o) => o.kind !== 'stop-delete'));
    assert.equal(kept.state.nodes[0].phase, 'draining');
  }
});

test('confirmed teardown retains billing headroom until verified meter lag settles, and old events never resurrect a deleted reservation', () => {
  const c = config(); let state = ready(c); c.enabled = false;
  state = planFleet(state, c, inventory(state, NOW + 3), [], NOW + 3).state;
  state = recordFleetEvent(state, { id: 'drained', kind: 'drained', eligibilityRemoved: true, reservation: state.nodes[0].reservation, generation: 1, assignment: 'none', at: NOW + 4 }, c);
  state = recordFleetEvent(state, { id: 'unregistered', kind: 'unregistered', registrationRemoved: true, runnerId: 100, registrationVerified: true, reservation: state.nodes[0].reservation, generation: 1, at: NOW + 5 }, c);
  state = planFleet(state, c, inventory(state, NOW + 5), [], NOW + 5).state;
  state = recordFleetEvent(state, { id: 'deleted', kind: 'deleted', providerVerified: true, providerId: 'private-provider-0', reservation: state.nodes[0].reservation, generation: 1, at: NOW + 6 }, c);
  assert.equal(state.nodes[0].phase, 'deleted'); assert.ok(state.reservedUnits > 0);
  assert.equal(recordFleetEvent(state, { id: 'late-boot', kind: 'created', reservation: state.nodes[0].reservation, generation: 1, at: NOW + 7, providerId: 'private-late' }, c), state);
  assert.equal(recordFleetEvent(state, { id: 'too-soon', kind: 'meter-settled', reservation: state.nodes[0].reservation, generation: 1, at: NOW + 7 }, c), state);
  state = recordFleetEvent(state, { id: 'settled', kind: 'meter-settled', reservation: state.nodes[0].reservation, generation: 1, at: NOW + 30_006 }, c);
  assert.equal(state.reservedUnits, 0);
  assert.equal(planFleet(state, c, inventory(state, NOW + 30_007), [], NOW + 30_007).state.nodes.length, 0);
});

test('duplicate/stale events and bounded exponential jitter preserve restart state without retrying forever', () => {
  const c = config(); const state = ready(c); const old = state.nodes[0];
  assert.equal(recordFleetEvent(state, { id: 'ready-0', kind: 'ready', reservation: old.reservation, generation: 1, at: NOW + 2 }, c), state);
  assert.equal(recordFleetEvent(state, { id: 'wrong-generation', kind: 'uncertain', reservation: old.reservation, generation: 2, at: NOW + 3 }, c), state);
  const event = { id: 'duplicate-uncertain', kind: 'uncertain' as const, reservation: old.reservation, generation: 1, at: NOW + 3 };
  const once = recordFleetEvent(state, event, c);
  assert.equal(recordFleetEvent(once, event, c), once);
  let current = state; const times = [];
  for (let i = 0; i < 4; i++) { const r = retryScale(current, c, NOW, 0.5); times.push(r.retryAt); current = r.state; }
  assert.deepEqual(times, [NOW + 1500, NOW + 2500, NOW + 4500, null]);
});

test('the shipped provider cannot create resources; inventory pagination shares a hard budget, persists cursors and refuses uncertain pages', async () => {
  const unavailable = new UnavailableRunnerProvider();
  await assert.rejects(() => unavailable.create({ key: 'none', kind: 'create', reservation: 'none', profile: 'linux-x64', generation: 1 }), /unverified/);
  await assert.rejects(() => unavailable.inspect({ providerId: null, reservation: 'scale-unknown' }), /unverified/);
  await assert.rejects(() => collectProviderInventory(unavailable, { remaining: 100 }), /unverified/);
  let checkpoint: ProviderInventoryCheckpoint = { cursor: null, instances: [], complete: false, pages: 0, requestsUsed: 0, seen: [] };
  const provider = { ...unavailable, apiVerified: true, async reconcile(cursor: string | null) {
    return cursor == null ? { instances: [{ providerId: 'private-a', reservation: 'scale-1', owned: true }], next: 'page-2' }
      : { instances: [{ providerId: 'private-b', reservation: 'scale-2', owned: true }], next: null };
  } } as RunnerScaleProvider;
  const budget = { remaining: 1 };
  await assert.rejects(() => collectProviderInventory(provider, budget, null, { snapshot: checkpoint, persist: async (c) => { checkpoint = c; } }), /request_cap/);
  assert.equal(budget.remaining, 0); assert.equal(checkpoint.complete, false); assert.equal(checkpoint.cursor, 'page-2');
  const result = await collectProviderInventory(provider, { remaining: 2 }, checkpoint.cursor, { snapshot: checkpoint, persist: async () => {} });
  assert.equal(result.instances.length, 2);
  await assert.rejects(() => collectProviderInventory({ ...provider, reconcile: async () => { throw Error('private account detail'); } }, { remaining: 2 }), /inventory_unavailable/);
});

test('inventory resume without its durable staged prefix refuses before reading a tail page', async () => {
  let calls = 0;
  const provider = { apiVerified: true, async reconcile() {
    calls++;
    return { instances: [{ providerId: 'synthetic-tail', reservation: 'scale-2', owned: true }], next: null };
  } } as unknown as RunnerScaleProvider;
  await assert.rejects(() => collectProviderInventory(provider, { remaining: 2 }, 'page-2'), /provider_checkpoint_invalid/);
  assert.equal(calls, 0);
});

test('drain and deletion receipts require explicit proof for the exact provider instance', () => {
  const c = config(); let state = ready(c); c.enabled = false;
  state = planFleet(state, c, inventory(state, NOW + 3), [], NOW + 3).state;
  const receipt = { id: 'drain-proof', kind: 'drained' as const, reservation: state.nodes[0].reservation, generation: 1, assignment: 'none' as const, at: NOW + 4 };
  assert.equal(recordFleetEvent(state, receipt, c), state);
  assert.equal(recordFleetEvent(state, { ...receipt, eligibilityRemoved: false }, c), state);
  state = recordFleetEvent(state, { ...receipt, eligibilityRemoved: true }, c);
  state = recordFleetEvent(state, { ...receipt, id: 'unregister-proof', kind: 'unregistered', registrationRemoved: true, runnerId: 100, registrationVerified: true }, c);
  state = planFleet(state, c, inventory(state, NOW + 5), [], NOW + 5).state;
  const deleted = { ...receipt, id: 'delete-proof', kind: 'deleted' as const, at: NOW + 6, providerVerified: true };
  assert.equal(recordFleetEvent(state, deleted, c), state);
  assert.equal(recordFleetEvent(state, { ...deleted, providerId: 'another-instance' }, c), state);
  assert.equal(recordFleetEvent(state, { ...deleted, providerId: state.nodes[0].providerId! }, c).nodes[0].deleteConfirmed, true);
});

test('unknown creates are inspected by reservation and verified absence retains billing holds until settlement', () => {
  const c = config(); const reserved = planFleet(emptyFleet(), c, inventory(), demands(), NOW).state;
  const p = planFleet(reserved, c, inventory(reserved, NOW + 60_000), [], NOW + 60_000);
  assert.deepEqual(p.operations.map((o) => o.kind), ['inspect']);
  assert.equal(p.state.nodes[0].phase, 'uncertain');
  const absent = { id: 'absent', kind: 'reconciled' as const, reservation: p.state.nodes[0].reservation, generation: 1, at: NOW + 60_001,
    absent: true, providerVerified: true, registrationRemoved: true, assignment: 'none' as const };
  assert.equal(recordFleetEvent(p.state, { ...absent, registrationRemoved: false }, c), p.state);
  const terminal = recordFleetEvent(p.state, absent, c);
  assert.equal(terminal.nodes[0].phase, 'deleted');
  assert.equal(terminal.reservedUnits, reserved.reservedUnits);
  const settled = recordFleetEvent(terminal, { ...absent, id: 'absence-meter', kind: 'meter-settled', at: absent.at + c.budget.billingLagMs }, c);
  assert.equal(planFleet(settled, c, inventory(settled, NOW + 90_002), demands(), NOW + 90_002).state.nodes.length, 1);
  const known = ready(c); const lost = planFleet(known, c, inventory(emptyFleet(), NOW + 3), [], NOW + 3).state;
  assert.equal(recordFleetEvent(lost, { ...absent, at: NOW + 4, runnerId: 100, providerId: 'wrong-instance' }, c), lost);
  assert.equal(recordFleetEvent(lost, { ...absent, at: NOW + 4, runnerId: 999, providerId: known.nodes[0].providerId! }, c), lost);
  assert.equal(recordFleetEvent(lost, { ...absent, at: NOW + 4, runnerId: 100, providerId: known.nodes[0].providerId! }, c).nodes[0].deleteConfirmed, true);
});

test('recovery gets a fresh boot window without extending the machine lifetime', () => {
  const c = config(); const initial = ready(c);
  const lost = planFleet(initial, c, inventory(emptyFleet(), NOW + 70_000), [], NOW + 70_000).state;
  const recovered = recordFleetEvent(lost, { id: 'late-reconcile', kind: 'reconciled', reservation: initial.nodes[0].reservation, generation: 1,
    at: NOW + 70_001, providerId: initial.nodes[0].providerId!, providerVerified: true, registrationRemoved: true, runnerId: 100, assignment: 'none' }, c);
  const p = planFleet(recovered, c, inventory(recovered, NOW + 70_002), [], NOW + 70_002);
  assert.equal(p.state.nodes[0].phase, 'booting');
  assert.equal(p.publicStatus.missed_deadlines, 0);
  assert.equal(p.state.nodes[0].createdAt, NOW);
  assert.equal(planFleet(recovered, c, inventory(recovered, NOW + c.lifetimeMs), [], NOW + c.lifetimeMs).state.nodes[0].phase, 'draining');
});

test('running-job evidence blocks teardown even when assignment says none', () => {
  const c = config(); let state = ready(c); c.enabled = false;
  state = recordFleetEvent(state, { id: 'contradictory-start', kind: 'job-started', reservation: state.nodes[0].reservation, generation: 1,
    runnerId: 100, assignment: 'none', at: NOW + 3 }, c);
  assert.equal(state.nodes[0].assignment, 'unknown');
  state.nodes[0].assignment = 'none'; state.nodes[0].phase = 'draining'; state.nodes[0].eligibilityRemoved = true; state.nodes[0].registered = false;
  const held = planFleet(state, c, inventory(state, NOW + 4), [], NOW + 4);
  assert.deepEqual(held.operations, []);
  assert.equal(held.state.nodes[0].phase, 'draining');
  state.nodes[0].registered = true;
  const operation = { key: `${state.nodes[0].reservation}:1:unregister`, kind: 'unregister' as const, reservation: state.nodes[0].reservation, profile: 'linux-x64', generation: 1 };
  assert.equal(operationAllowed(state, operation, state.revision), false);
  state.nodes[0].phase = 'stopping'; state.nodes[0].registered = false;
  assert.equal(operationAllowed(state, { ...operation, kind: 'stop-delete', key: `${operation.reservation}:1:stop-delete` }, state.revision), false);
  state.nodes[0].jobStartedAt = null; state.nodes[0].providerId = null;
  assert.equal(operationAllowed(state, { ...operation, kind: 'stop-delete', key: `${operation.reservation}:1:stop-delete` }, state.revision), false);
  state.nodes[0].phase = 'draining'; state.nodes[0].registered = true;
  assert.equal(operationAllowed(state, operation, state.revision), false);
});

test('verified heartbeats preserve idle capacity and successful progress starts a new retry episode', () => {
  const c = config(); let state = ready(c);
  const heartbeat = { id: 'heartbeat', kind: 'heartbeat' as const, reservation: state.nodes[0].reservation, generation: 1,
    runnerId: 100, registrationVerified: true, online: true, at: NOW + 25_000 };
  assert.equal(recordFleetEvent(state, { ...heartbeat, runnerId: 999 }, c), state);
  assert.equal(recordFleetEvent(state, { ...heartbeat, online: false }, c), state);
  state = recordFleetEvent(state, heartbeat, c);
  assert.equal(planFleet(state, c, inventory(state, NOW + 50_000), [], NOW + 50_000).publicStatus.healthy, 1);
  state = recordFleetEvent(state, { ...heartbeat, id: 'idle-heartbeat', at: NOW + 120_002 }, c);
  assert.equal(planFleet(state, c, inventory(state, NOW + 120_003), [], NOW + 120_003).state.nodes[0].phase, 'draining');
  state.retryCount = c.maxRetries;
  assert.equal(retryScale(state, c, NOW + 120_004, 0).retryAt, null);
  assert.equal(recordFleetEvent(state, { ...heartbeat, id: 'retry-heartbeat', at: NOW + 120_003 }, c).retryCount, c.maxRetries);
  assert.equal(recordFleetEvent(state, { ...heartbeat, id: 'retry-uncertain', kind: 'uncertain', at: NOW + 120_003 }, c).retryCount, c.maxRetries);
  state = recordFleetEvent(state, { ...heartbeat, id: 'progress-start', kind: 'job-started', assignment: 'owned', at: NOW + 120_004 }, c);
  assert.equal(retryScale(state, c, NOW + 120_005, 0).retryAt, null);
  state = planFleet(state, c, inventory(state, NOW + 120_005), [], NOW + 120_005).state;
  assert.equal(retryScale(state, c, NOW + 120_005, 0).retryAt, NOW + 121_005);
});

test('inventory shape, duplicate reservations and resource identities cannot manufacture capacity', () => {
  const c = config(5); const state = ready(c);
  const invalid = planFleet(state, c, { ...inventory(state), instances: [{ providerId: 'synthetic', reservation: null, owned: undefined as any }] }, [], NOW + 3);
  assert.ok(invalid.reasons.includes('inventory_invalid'));
  assert.equal(invalid.publicStatus.healthy, null);
  const instances = [...inventory(state, NOW + 3).instances, { ...inventory(state).instances[0], providerId: 'duplicate-create' }];
  assert.ok(planFleet(state, c, { complete: true, observedAt: NOW + 3, instances }, demands(), NOW + 3).reasons.includes('orphan_inventory_requires_reconciliation'));
  const reserved = planFleet(emptyFleet(), c, inventory(), demands(), NOW).state;
  const duplicatePending = [0, 1].map((i) => ({ providerId: `pending-${i}`, reservation: reserved.nodes[0].reservation, owned: true }));
  assert.ok(planFleet(reserved, c, { complete: true, observedAt: NOW + 1, instances: duplicatePending }, demands(), NOW + 1).reasons.includes('orphan_inventory_requires_reconciliation'));
  const wrongOnly = inventory(state, NOW + 3); wrongOnly.instances[0].providerId = 'unexpected-instance';
  assert.ok(planFleet(state, c, wrongOnly, demands(), NOW + 3).reasons.includes('orphan_inventory_requires_reconciliation'));
  const created = recordFleetEvent(reserved, { id: 'unique-created', kind: 'created', reservation: reserved.nodes[0].reservation, generation: 1, providerId: 'unique-instance', at: NOW + 1 }, c);
  assert.equal(recordFleetEvent(created, { id: 'duplicate-created', kind: 'created', reservation: reserved.nodes[1].reservation, generation: 1, providerId: 'unique-instance', at: NOW + 2 }, c), created);
  const second = recordFleetEvent(created, { id: 'second-created', kind: 'created', reservation: reserved.nodes[1].reservation, generation: 1, providerId: 'second-instance', at: NOW + 2 }, c);
  const firstReady = recordFleetEvent(second, { id: 'first-ready', kind: 'ready', reservation: reserved.nodes[0].reservation, generation: 1, runnerId: 100, bootVerified: true, registrationVerified: true, online: true, observedImage: IMAGE, at: NOW + 3 }, c);
  assert.equal(recordFleetEvent(firstReady, { id: 'duplicate-ready', kind: 'ready', reservation: reserved.nodes[1].reservation, generation: 1, runnerId: 100, bootVerified: true, registrationVerified: true, online: true, observedImage: IMAGE, at: NOW + 4 }, c), firstReady);
  const duplicateState = structuredClone(state); duplicateState.nodes[1].providerId = duplicateState.nodes[0].providerId;
  assert.throws(() => planFleet(duplicateState, c, inventory(state, NOW + 3), [], NOW + 3), /invalid_state/);
  const duplicateRunner = structuredClone(state); duplicateRunner.nodes[1].runnerId = duplicateRunner.nodes[0].runnerId;
  assert.throws(() => planFleet(duplicateRunner, c, inventory(state, NOW + 3), [], NOW + 3), /invalid_state/);
});

test('inventory resumes retain cumulative page, request and cursor limits, including failed attempts', async () => {
  let snapshot: ProviderInventoryCheckpoint = { cursor: null, instances: [], complete: false, requestsUsed: 0, pages: 0, seen: [] };
  let calls = 0;
  const provider = { apiVerified: true, async reconcile() { calls++; return { instances: [], next: `cursor-${calls}` }; } } as unknown as RunnerScaleProvider;
  const checkpoint = () => ({ snapshot, persist: async (next: ProviderInventoryCheckpoint) => { snapshot = next; } });
  for (let i = 0; i < 20; i++) await assert.rejects(() => collectProviderInventory(provider, { remaining: 1 }, snapshot.cursor, checkpoint()), /provider_(request|page)_cap/);
  assert.equal(calls, 20);
  await assert.rejects(() => collectProviderInventory(provider, { remaining: 100 }, snapshot.cursor, checkpoint()), /provider_page_cap/);
  assert.equal(calls, 20);
  snapshot = { cursor: null, instances: [], complete: false, requestsUsed: 99, pages: 0, seen: [] };
  const failed = { ...provider, async reconcile() { calls++; throw Error('synthetic outage'); } };
  await assert.rejects(() => collectProviderInventory(failed, { remaining: 100 }, null, checkpoint()), /provider_inventory_unavailable/);
  assert.equal(snapshot.requestsUsed, 100);
  await assert.rejects(() => collectProviderInventory(failed, { remaining: 100 }, null, checkpoint()), /provider_request_cap/);
  snapshot = { cursor: 'cursor-2', instances: [], complete: false, requestsUsed: 2, pages: 2, seen: ['cursor-1', 'cursor-2'] };
  await assert.rejects(() => collectProviderInventory({ ...provider, reconcile: async () => ({ instances: [], next: 'cursor-1' }) }, { remaining: 1 }, snapshot.cursor, checkpoint()), /provider_cursor_invalid/);
});

test('malformed provider pages never advertise complete inventory', async () => {
  for (const result of [null, { instances: [{ providerId: 'synthetic', reservation: null }], next: null }, { instances: [{ providerId: 'synthetic', reservation: 12, owned: true }], next: null }]) {
    const provider = { apiVerified: true, reconcile: async () => result } as unknown as RunnerScaleProvider;
    await assert.rejects(() => collectProviderInventory(provider, { remaining: 1 }), /provider_inventory_(invalid|unavailable)/);
  }
});

test('a drain receipt cannot erase an unfinished job', () => {
  const c = config(); let state = ready(c); const reservation = state.nodes[0].reservation;
  state = recordFleetEvent(state, { id: 'active-before-drain', kind: 'job-started', reservation, generation: 1, runnerId: 100, assignment: 'owned', at: NOW + 3 }, c);
  c.enabled = false; state = planFleet(state, c, inventory(state, NOW + 4), [], NOW + 4).state;
  state = recordFleetEvent(state, { id: 'contradictory-drain', kind: 'drained', reservation, generation: 1, eligibilityRemoved: true, assignment: 'none', at: NOW + 5 }, c);
  assert.equal(state.nodes[0].jobStartedAt, NOW + 3);
  assert.equal(state.nodes[0].assignment, 'unknown');
  assert.deepEqual(planFleet(state, c, inventory(state, NOW + 6), [], NOW + 6).operations, []);
  state = recordFleetEvent(state, { id: 'actual-finish', kind: 'job-finished', reservation, generation: 1, runnerId: 100, at: NOW + 7 }, c);
  assert.equal(planFleet(state, c, inventory(state, NOW + 8), [], NOW + 8).operations[0].kind, 'unregister');
});

test('heartbeats do not discard reordered lifecycle receipts or move liveness backward', () => {
  const c = config(); let state = ready(c); const reservation = state.nodes[0].reservation;
  state = recordFleetEvent(state, { id: 'later-heartbeat', kind: 'heartbeat', reservation, generation: 1, runnerId: 100, registrationVerified: true, online: true, at: NOW + 20_000 }, c);
  state = recordFleetEvent(state, { id: 'earlier-start', kind: 'job-started', reservation, generation: 1, runnerId: 100, assignment: 'owned', at: NOW + 10_000 }, c);
  assert.equal(state.nodes[0].jobStartedAt, NOW + 10_000);
  assert.equal(state.nodes[0].lastHeartbeat, NOW + 20_000);
  state = recordFleetEvent(state, { id: 'earlier-finish', kind: 'job-finished', reservation, generation: 1, runnerId: 100, at: NOW + 15_000 }, c);
  assert.equal(state.nodes[0].phase, 'draining');
  assert.equal(state.nodes[0].lastEventAt, NOW + 15_000);
});

test('invalid inventory blocks admission but permits safe eligibility removal and retains deferred creates', () => {
  const c = config(); const healthy = ready(c); c.enabled = false;
  const bad = { complete: true, observedAt: NOW + 3, instances: [null] as any };
  const drain = planFleet(healthy, c, bad, [], NOW + 3);
  assert.deepEqual(drain.operations.map((op) => op.kind), ['remove-eligibility']);
  assert.equal(drain.publicStatus.healthy, null);
  const drained = recordFleetEvent(drain.state, { id: 'safe-removal', kind: 'drained', reservation: healthy.nodes[0].reservation,
    generation: 1, eligibilityRemoved: true, assignment: 'none', at: NOW + 4 }, c);
  const pendingUnregister = planFleet(drained, c, inventory(drained, NOW + 5), [], NOW + 5).state;
  const cleanupDeferred = planFleet(pendingUnregister, c, { ...bad, observedAt: NOW + 6 }, [], NOW + 6);
  assert.deepEqual(cleanupDeferred.operations, []);
  assert.equal(cleanupDeferred.state.pending[0].kind, 'unregister');
  assert.equal(planFleet(cleanupDeferred.state, c, inventory(cleanupDeferred.state, NOW + 7), [], NOW + 7).operations[0].kind, 'unregister');
  c.enabled = true;
  const reserved = planFleet(emptyFleet(), c, inventory(), demands(), NOW).state;
  const deferred = planFleet(reserved, c, bad, demands(), NOW + 3);
  assert.deepEqual(deferred.operations, []);
  assert.equal(deferred.state.pending[0].kind, 'create');
  const resumed = planFleet(deferred.state, c, inventory(deferred.state, NOW + 4), demands(), NOW + 4);
  assert.equal(resumed.operations[0].key, reserved.pending[0].key);
  assert.equal(resumed.state.nodes.length, 1);
});

test('proof that a registration exists cannot stand in for verified removal', () => {
  const c = config(); const initial = ready(c); const reservation = initial.nodes[0].reservation;
  const lost = planFleet(initial, c, inventory(emptyFleet(), NOW + 3), [], NOW + 3).state;
  const proof = { id: 'removal-not-presence', kind: 'reconciled' as const, reservation, generation: 1, runnerId: 100, providerId: initial.nodes[0].providerId!,
    providerVerified: true, registrationVerified: true, assignment: 'none' as const, at: NOW + 4 };
  assert.equal(recordFleetEvent(lost, { ...proof, absent: true }, c), lost);
  assert.equal(recordFleetEvent(lost, proof, c), lost);
  assert.equal(recordFleetEvent(lost, { ...proof, registrationRemoved: true }, c).nodes[0].phase, 'booting');
  c.enabled = false; const draining = planFleet(initial, c, inventory(initial, NOW + 3), [], NOW + 3).state;
  const removed = recordFleetEvent(draining, { ...proof, kind: 'drained', eligibilityRemoved: true }, c);
  assert.equal(recordFleetEvent(removed, { ...proof, id: 'presence-not-unregistered', kind: 'unregistered', at: NOW + 5 }, c), removed);
});

test('authorizing flags require actual booleans rather than truthy configuration strings', async () => {
  for (const value of ['false', 1, undefined]) {
    for (const field of ['enabled', 'approved', 'meterVerified', 'imageApproved']) {
      const c = config();
      if (field === 'enabled') c.enabled = value as any;
      else if (field === 'imageApproved') c.profiles['linux-x64'].image.approved = value as any;
      else c.budget[field as 'approved' | 'meterVerified'] = value as any;
      assert.equal(planFleet(emptyFleet(), c, inventory(), demands(), NOW).operations.length, 0);
    }
    assert.equal(planFleet(emptyFleet(), config(), { ...inventory(), complete: value as any }, demands(), NOW).operations.length, 0);
    const provider = { apiVerified: value, reconcile: async () => ({ instances: [], next: null }) } as unknown as RunnerScaleProvider;
    await assert.rejects(() => collectProviderInventory(provider, { remaining: 1 }), /provider_api_unverified/);
  }
});

test('retry exhaustion belongs to an operation, not another node or the next inventory scan', () => {
  const c = config(5); c.approvedCap = 2; let state = ready(c); c.enabled = false;
  const p = planFleet(state, c, inventory(state, NOW + 3), [], NOW + 3); state = p.state;
  const failed = p.operations[0]; const other = p.operations[1];
  for (let i = 0; i < c.maxRetries; i++) state = retryScale(state, c, NOW + 3, 0, failed).state;
  state = recordFleetEvent(state, { id: 'other-progress', kind: 'drained', reservation: other.reservation, generation: other.generation,
    eligibilityRemoved: true, assignment: 'none', at: NOW + 4 }, c);
  state = planFleet(state, c, inventory(state, NOW + 5), [], NOW + 5).state;
  assert.equal(retryScale(state, c, NOW + 5, 0, failed).retryAt, null);
  assert.equal(state.operationRetries[failed.key], c.maxRetries);
  state = recordFleetEvent(state, { id: 'same-operation-success', kind: 'drained', reservation: failed.reservation, generation: failed.generation,
    eligibilityRemoved: true, assignment: 'none', at: NOW + 6 }, c);
  assert.equal(state.operationRetries[failed.key], undefined);
  assert.equal(retryScale(state, c, NOW + 7, 0, failed).retryAt, null);
});
