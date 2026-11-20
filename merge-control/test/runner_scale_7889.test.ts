/** D7889: simulated fleet proposals, restart fences, provider pagination and one-job supervision; no live nodes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyFleet, imageEligible, imageMatches, fairDemand, planFleet, commitFleet, recordFleetEvent, operationAllowed, retryScale,
  type ScaleConfig, type FleetState, type ImageProfile } from '../src/lib/runnerScalePolicy.ts';
import { collectProviderInventory, UnavailableRunnerProvider, type RunnerScaleProvider } from '../src/runnerScaleProvider.ts';

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
  const limited = config(50); limited.budget.remainingUnits = 3;
  assert.equal(planFleet(emptyFleet(), limited, inventory(), demands(), NOW).state.nodes.length, 1);
  limited.budget.expiresAt = NOW + 180_000;
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
  assert.deepEqual(expired.operations.map((o) => o.kind), ['remove-eligibility']);
  let state = ready(c); assert.equal(planFleet(state, c, inventory(state, NOW + 3), [], NOW + 3).publicStatus.healthy, 1);
  const lost = planFleet(state, c, inventory(emptyFleet(), NOW + 3), demands(), NOW + 3);
  assert.equal(lost.state.nodes[0].phase, 'uncertain'); assert.deepEqual(lost.operations.map((o) => o.kind), ['inspect']);
  assert.equal(imageMatches(IMAGE, { ...IMAGE, arch: 'arm64' }), false);
  assert.equal(imageMatches(IMAGE, { ...IMAGE, nodeVersion: '22.0.0' }), false);
  assert.equal(imageEligible(JSON.parse(readFileSync(new URL('../../infra/runners/linux-x64.image.template.json', import.meta.url), 'utf8'))), false);
  c.profiles['linux-x64'].image = { ...IMAGE, digest: `sha256:${'d'.repeat(64)}` };
  assert.equal(planFleet(state, c, inventory(state, NOW + 3), [], NOW + 3).publicStatus.healthy, 0);
});

test('drain removes eligibility first, preserves busy/unowned work and rejects an assignment-race stale deletion fence', () => {
  const c = config(); let state = ready(c); c.enabled = false;
  let p = planFleet(state, c, inventory(state, NOW + 3), [], NOW + 3);
  assert.deepEqual(p.operations.map((o) => o.kind), ['remove-eligibility']); state = p.state;
  state = recordFleetEvent(state, { id: 'removed', kind: 'drained', reservation: state.nodes[0].reservation, generation: 1, assignment: 'none', at: NOW + 4 }, c);
  p = planFleet(state, c, inventory(state, NOW + 5), [], NOW + 5); assert.equal(p.operations[0].kind, 'unregister');
  state = recordFleetEvent(p.state, { id: 'unregistered', kind: 'unregistered', registrationVerified: true, reservation: state.nodes[0].reservation, generation: 1, at: NOW + 5 }, c);
  p = planFleet(state, c, inventory(state, NOW + 5), [], NOW + 5); assert.equal(p.operations[0].kind, 'stop-delete');
  const raced = recordFleetEvent(p.state, { id: 'raced-assignment', kind: 'job-started', reservation: state.nodes[0].reservation, generation: 1, runnerId: 100, assignment: 'owned', at: NOW + 6 }, c);
  // The event must fence the old operation even if the provider effect has not started.
  assert.equal(operationAllowed(raced, p.operations[0], p.state.revision), false);
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
  state = recordFleetEvent(state, { id: 'drained', kind: 'drained', reservation: state.nodes[0].reservation, generation: 1, assignment: 'none', at: NOW + 4 }, c);
  state = recordFleetEvent(state, { id: 'unregistered', kind: 'unregistered', registrationVerified: true, reservation: state.nodes[0].reservation, generation: 1, at: NOW + 5 }, c);
  state = planFleet(state, c, inventory(state, NOW + 5), [], NOW + 5).state;
  state = recordFleetEvent(state, { id: 'deleted', kind: 'deleted', providerVerified: true, reservation: state.nodes[0].reservation, generation: 1, at: NOW + 6 }, c);
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
  await assert.rejects(() => collectProviderInventory(unavailable, { remaining: 100 }), /unverified/);
  let checkpoint: any = { cursor: null, instances: [], complete: false };
  const provider = { ...unavailable, apiVerified: true, async reconcile(cursor: string | null) {
    return cursor == null ? { instances: [{ providerId: 'private-a', reservation: 'scale-1', owned: true }], next: 'page-2' }
      : { instances: [{ providerId: 'private-b', reservation: 'scale-2', owned: true }], next: null };
  } } as RunnerScaleProvider;
  const budget = { remaining: 1 };
  await assert.rejects(() => collectProviderInventory(provider, budget, null, { staged: [], persist: async (c) => { checkpoint = c; } }), /request_cap/);
  assert.equal(budget.remaining, 0); assert.equal(checkpoint.complete, false); assert.equal(checkpoint.cursor, 'page-2');
  const result = await collectProviderInventory(provider, { remaining: 2 }, checkpoint.cursor, { staged: checkpoint.instances, persist: async () => {} });
  assert.equal(result.instances.length, 2);
  await assert.rejects(() => collectProviderInventory({ ...provider, reconcile: async () => { throw Error('private account detail'); } }, { remaining: 2 }), /inventory_unavailable/);
});
