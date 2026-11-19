/**
 * D5570 (#5570 part 1): provider placement, the cost model and compute admission leases, pure and unmounted.
 * Synthetic tenants, providers and rate cards; an injected clock and an injected provider-state reader, no waits.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/workspace_placement_5570.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dryRunQuote, judgeCandidate, placeWorkspace, quoteFor, type PlacementCandidate, type RateCard, type TenantPlacementPolicy } from '../src/services/agents/workspacePlacement.ts';
import { createAdmissionControl, emptyAdmissionState, type AdmissionLimits, type AdmissionState, type AdmissionStore,
  type LeaseRef, type ProviderObservation } from '../src/services/agents/workspaceAdmission.ts';
import type { ExecutorCapabilities, Provider, WorkspaceResult, WorkspaceSpec } from '../src/services/agents/workspaceSpec.ts';
import { fakeCapabilities, specFixture } from './_workspace_fake_5565.ts';

const value = <T>(r: WorkspaceResult<T>): T => { assert.ok(r.ok, JSON.stringify(r)); return r.value; };
const refused = (r: WorkspaceResult<unknown>, code: string) => { assert.equal(r.ok, false, JSON.stringify(r)); if (!r.ok) assert.equal(r.code, code); };

// ---- placement fixtures -------------------------------------------------------------------------------------------
const card = (provider: Provider, patch: Partial<RateCard> = {}): RateCard => ({ provider, source: 'quoted',
  vcpu_second: 10, gib_second: 2, boot: 500, disk_gib_second: 1, image_pull_cold: 300, image_pull_cached: 0,
  egress_gib: 50, idle_second: 1, idle_seconds: 30, ...patch });
const caps = (provider: Provider, regions = ['weur'], patch: Partial<ExecutorCapabilities> = {}): ExecutorCapabilities =>
  ({ ...fakeCapabilities(), provider, enforced_regions: regions, ...patch });
const candidate = (provider: Provider, patch: Partial<PlacementCandidate> = {}, regions = ['weur']): PlacementCandidate => ({
  capabilities: caps(provider, regions), health: 'healthy', capacity: Object.fromEntries(regions.map(r => [r, 5])),
  rates: card(provider), latency_ms: 50, cache_local: false, ...patch });
const spec = (providers: Provider[] = ['cloudflare', 'azure'], regions = ['weur'], patch: Partial<WorkspaceSpec> = {}) =>
  specFixture({ allowed_providers: providers, allowed_regions: regions, ...patch });
const policy = (patch: Partial<TenantPlacementPolicy> = {}): TenantPlacementPolicy =>
  ({ consented_providers: ['cloudflare', 'azure', 'aws'], residency_regions: ['weur'], halted: false, ...patch });
const reasonOf = (v: ReturnType<typeof judgeCandidate>) => v.eligible ? 'eligible' : `${v.reason}${v.detail ? ':' + v.detail : ''}`;

test('Cloudflare is preferred for an eligible task even when another allowed provider is cheaper and faster', () => {
  const placed = placeWorkspace(spec(), policy(), [candidate('azure', { rates: card('azure', { vcpu_second: 1 }), latency_ms: 5 }), candidate('cloudflare')]);
  assert.equal(placed.decision, 'place');
  if (placed.decision !== 'place') return;
  assert.deepEqual([placed.provider, placed.region, placed.reserve_basis], ['cloudflare', 'weur', 'quote']);
  // Fixture spec: 0.5 vCPU, 512 MiB, 512 MiB disk, 60 s, deny network. Every line is an upper bound, rounded up.
  assert.deepEqual(placed.quote.lines, { compute: 300 + 60, boot: 500, storage: 30, image_pull: 300, egress: 0, idle: 30 });
  assert.equal(placed.quote.total, 1220);
  assert.equal(placed.reserve_microusd, 1220);
});

test('among non-Cloudflare candidates the rank is known cost, then latency, then cache locality, then regional capacity', () => {
  const s = spec(['azure', 'aws', 'gcp']);
  const p = policy({ consented_providers: ['azure', 'aws', 'gcp'] });
  const pick = (cands: PlacementCandidate[]) => { const d = placeWorkspace(s, p, cands); return d.decision === 'place' ? d.provider : d.decision; };
  assert.equal(pick([candidate('azure', { rates: card('azure', { boot: 900 }) }), candidate('aws')]), 'aws');
  assert.equal(pick([candidate('azure', { latency_ms: 10 }), candidate('aws', { latency_ms: 90 })]), 'azure');
  // A known cost outranks an unknown one, however fast the unknown is.
  assert.equal(pick([candidate('azure', { rates: null, latency_ms: 1 }), candidate('aws', { latency_ms: 900 })]), 'aws');
  // Cache locality makes the pull known-free here, so it wins on cost; with equal cost it still breaks the tie.
  assert.equal(pick([candidate('azure', { cache_local: true }), candidate('aws')]), 'azure');
  assert.equal(pick([candidate('azure', { cache_local: true, rates: card('azure', { image_pull_cached: 300 }) }), candidate('aws')]), 'azure');
  assert.equal(pick([candidate('aws', { capacity: { weur: 1 } }), candidate('gcp', { capacity: { weur: 9 } })]), 'gcp');
});

test('eligibility runs in the mandatory order and each refusal names its stage', () => {
  const s = spec(['cloudflare', 'azure'], ['weur', 'enam']);
  const p = policy({ residency_regions: ['weur', 'enam'] });
  const judge = (c: PlacementCandidate, sp = s, po = p) => reasonOf(judgeCandidate(sp, po, c));
  // Each candidate fails two stages; the earlier one is reported.
  assert.equal(judge(candidate('aws', {}, ['apac'])), 'consent');
  assert.equal(judge(candidate('azure', {}, ['apac']), s, policy({ consented_providers: ['cloudflare'] })), 'consent');
  assert.equal(judge({ ...candidate('azure', {}, ['apac']), capabilities: caps('azure', ['apac'], { interrupt: false }) }), 'residency');
  assert.equal(judge({ ...candidate('azure'), capabilities: caps('azure', ['weur'], { interrupt: false, digest_pulls: false }) }), 'security:cancel');
  assert.equal(judge({ ...candidate('azure'), capabilities: caps('azure', ['weur'], { enforced_network_modes: ['allowlist'] }) }), 'security:network_policy');
  assert.equal(judge({ ...candidate('azure'), capabilities: caps('azure', ['weur'], { untrusted_code: false, digest_pulls: false }) }), 'security:hostile_code_isolation');
  assert.equal(judge({ ...candidate('azure'), capabilities: caps('azure', ['weur'], { digest_pulls: false, cpu_max: 0.1 }) }), 'image_runtime:image_digest');
  assert.equal(judge({ ...candidate('azure'), capabilities: caps('azure', ['weur'], { workload_classes: ['coding_trusted'], cpu_max: 0.1 }) }), 'image_runtime:workload_class');
  assert.equal(judge({ ...candidate('azure'), capabilities: caps('azure', ['weur'], { checkpoint_restore: false }) }, spec(['azure'], ['weur'], { checkpoint_manifest_ref: 'ckpt-1' })), 'image_runtime:checkpoint_restore');
  assert.equal(judge({ ...candidate('azure', { health: 'down' }), capabilities: caps('azure', ['weur'], { cpu_max: 0.1 }) }), 'workload:cpu');
  assert.equal(judge({ ...candidate('azure', { health: 'down' }), capabilities: caps('azure', ['weur'], { memory_mb_max: 256 }) }), 'workload:memory');
  assert.equal(judge({ ...candidate('azure', { health: 'down' }), capabilities: caps('azure', ['weur'], { disk_mb_max: 128 }) }), 'workload:disk');
  assert.equal(judge({ ...candidate('azure', { health: 'down' }), capabilities: caps('azure', ['weur'], { duration_s_max: 30 }) }), 'workload:duration');
  assert.equal(judge(candidate('azure', { health: 'degraded', capacity: { weur: 0 } })), 'health:degraded');
  assert.equal(judge({ ...candidate('azure'), capabilities: caps('azure', ['weur'], { concurrency_max: null }) }), 'quota_unverified:concurrency_max');
  assert.equal(judge(candidate('azure', { capacity: {} })), 'quota_unverified');
  assert.equal(judge(candidate('azure', { capacity: { weur: 0, enam: null } })), 'quota_exhausted');
  assert.equal(judge(candidate('azure', { rates: card('azure', { boot: 10_000_000 }) })), 'over_budget');
  // Free capacity in the resident region with the most room is the one chosen.
  const ok = judgeCandidate(s, p, candidate('azure', { capacity: { weur: 1, enam: 3 } }, ['weur', 'enam']));
  assert.ok(ok.eligible && ok.region === 'enam' && ok.free === 3);
});

test('with Cloudflare out of quota the task falls back only to an explicitly allowed, consented provider in a resident region', () => {
  const full = candidate('cloudflare', { capacity: { weur: 0 } });
  const placed = placeWorkspace(spec(), policy(), [full, candidate('azure')]);
  assert.equal(placed.decision === 'place' && placed.provider, 'azure');
  // Not consented by the tenant: the task waits for Cloudflare quota rather than moving.
  const notConsented = placeWorkspace(spec(), policy({ consented_providers: ['cloudflare'] }), [full, candidate('azure')]);
  assert.equal(notConsented.decision, 'queue');
  assert.deepEqual(notConsented.verdicts.map(reasonOf), ['quota_exhausted', 'consent']);
  // Not in the spec's allowlist: same.
  assert.equal(placeWorkspace(spec(['cloudflare']), policy(), [full, candidate('azure')]).decision, 'queue');
  // Azure only offers a region outside the tenant's residency: never a fallback, even when the spec lists that region.
  const abroad = placeWorkspace(spec(['cloudflare', 'azure'], ['weur', 'enam']), policy(), [full, candidate('azure', {}, ['enam'])]);
  assert.deepEqual([abroad.decision, abroad.verdicts.map(reasonOf)], ['queue', ['quota_exhausted', 'residency']]);
  // Nothing that can ever run the spec, and nothing waitable: a refusal with each candidate's reason.
  const none = placeWorkspace(spec(), policy({ consented_providers: ['azure'] }), [candidate('cloudflare'), candidate('azure', {}, ['enam'])]);
  assert.equal(none.decision, 'refuse');
  if (none.decision === 'refuse') assert.deepEqual([none.status, none.code, none.verdicts.map(reasonOf)], [422, 'no_eligible_provider', ['consent', 'residency']]);
  // A provider brownout queues; a halted tenant refuses before anything is judged.
  assert.equal(placeWorkspace(spec(['cloudflare']), policy(), [candidate('cloudflare', { health: 'degraded' })]).decision, 'queue');
  const halted = placeWorkspace(spec(), policy({ halted: true }), [candidate('cloudflare')]);
  assert.deepEqual(halted.decision === 'refuse' && [halted.status, halted.code], [503, 'placement_halted']);
});

test('an unknown cost is unavailable, never 0, and reserves the spec ceiling', () => {
  const allow = spec(['cloudflare'], ['weur'], { network_policy: { mode: 'allowlist', destinations: [{ hostname: 'registry.example.com', port: 443 }] } });
  const capsAllow = caps('cloudflare', ['weur'], { enforced_network_modes: ['deny', 'allowlist'] });
  // An allowlist has no egress bound in the spec, so egress (and the total) is unavailable even with a full rate card.
  const q = quoteFor(allow, 'cloudflare', card('cloudflare'), false);
  assert.equal(q.lines.egress, 'unavailable');
  assert.equal(q.total, 'unavailable');
  const placed = placeWorkspace(allow, policy(), [{ ...candidate('cloudflare'), capabilities: capsAllow }]);
  assert.equal(placed.decision, 'place');
  if (placed.decision === 'place') assert.deepEqual([placed.quote.total, placed.reserve_microusd, placed.reserve_basis], ['unavailable', 100000, 'spec_ceiling']);
  // One unknown rate makes only its line unavailable; the known lines stay known.
  const idle = quoteFor(spec(), 'cloudflare', card('cloudflare', { idle_second: null }), false);
  assert.deepEqual([idle.lines.idle, idle.lines.boot, idle.total], ['unavailable', 500, 'unavailable']);
  const memory = quoteFor(spec(), 'cloudflare', card('cloudflare', { gib_second: null }), false);
  assert.equal(memory.lines.compute, 'unavailable');
  // No rate card at all, or one for another provider: every line unavailable, source none.
  for (const rates of [null, card('azure')]) {
    const none = quoteFor(spec(), 'cloudflare', rates, false);
    assert.equal(none.source, 'none');
    assert.ok(Object.values(none.lines).every(v => v === 'unavailable'));
  }
  // The dry run shows every candidate's quote and the upper bound, and reserves nothing.
  const dry = dryRunQuote(spec(), policy(), [candidate('azure', { rates: null }), candidate('cloudflare')]);
  assert.equal(dry.dry_run, true);
  assert.equal(dry.upper_bound_microusd, 100000);
  assert.deepEqual(dry.quotes.map(q2 => [q2.provider, q2.quote?.total]), [['azure', 'unavailable'], ['cloudflare', 1220]]);
});

// ---- admission fixtures -------------------------------------------------------------------------------------------
/** One serialized transaction at a time over a cloned state, as a Durable Object's storage gives. */
function memoryStore(): AdmissionStore & { peek(): AdmissionState } {
  let state = emptyAdmissionState();
  let pending: Promise<unknown> = Promise.resolve();
  return {
    transaction<T>(change: (s: AdmissionState) => T): Promise<T> {
      const next = pending.then(() => { const copy = structuredClone(state); const out = change(copy); state = copy; return out; });
      pending = next.catch(() => {});
      return next;
    },
    peek: () => structuredClone(state),
  };
}
const limits = (patch: Partial<AdmissionLimits> = {}): AdmissionLimits => ({ halted: false, lease_ms: 60_000,
  per_tenant_running: 5, per_tenant_waiting: 10, max_waiting: 20,
  per_provider_running: { cloudflare: 4, azure: 2 }, per_region_running: { 'cloudflare:weur': 2, 'azure:weur': 2 }, ...patch });
function harness(patch: Partial<AdmissionLimits> = {}) {
  const clock = { now: 1_000_000 };
  const provider = new Map<string, ProviderObservation | 'throw'>();
  const reads: LeaseRef[] = [];
  const store = memoryStore();
  const make = () => createAdmissionControl({ store, clock: () => clock.now, limits: limits(patch), observe: async ref => {
    reads.push(ref);
    const o = provider.get(ref.run_uid) ?? { state: 'unknown', measured_microusd: 'unavailable' };
    if (o === 'throw') throw new Error('provider brownout');
    return o;
  } });
  return { clock, provider, reads, store, make, control: make() };
}
const run = (uid: string, patch: Partial<{ tenant_id: number; agent_id: number; provider: Provider; region: string; compute_reserve_microusd: number }> = {}) =>
  ({ run_uid: uid, tenant_id: 11, agent_id: 41, provider: 'cloudflare' as Provider, region: 'weur', compute_reserve_microusd: 1000, ...patch });
const holding = (s: AdmissionState) => Object.values(s.slots).filter(x => x.state === 'admitted' || x.state === 'reconciling');

test('concurrent claims and a Worker restart over the same store never admit past a cap', async () => {
  const h = harness();
  for (let i = 0; i < 6; i++) value(await h.control.enqueue(run(`run-${i}`)));
  // A retried enqueue is idempotent; changed terms for the same run uid are refused.
  assert.deepEqual(value(await h.control.enqueue(run('run-0'))), { state: 'waiting', duplicate: true });
  refused(await h.control.enqueue(run('run-0', { compute_reserve_microusd: 1 })), 'run_contract_changed');
  const restarted = h.make();
  const bursts = await Promise.all([h.control.admit(), restarted.admit(), h.control.admit(), restarted.admit()]);
  assert.equal(bursts.flat().length, 2, 'cloudflare:weur admits two');
  assert.equal(holding(h.store.peek()).length, 2);
  assert.deepEqual(bursts.flat().map(g => g.generation), [1, 1]);
  // The restarted instance settles a lease the first one granted; a repeat from either is the same single bill.
  const g = bursts.flat()[0];
  assert.deepEqual(value(await restarted.release(g.run_uid, g.generation, 700)), { charged_microusd: 700, measured: true, first: true });
  assert.deepEqual(value(await h.control.release(g.run_uid, g.generation, 900)), { charged_microusd: 700, measured: true, first: false });
  refused(await h.control.release(g.run_uid, g.generation - 1, 700), 'stale_generation');
  refused(await h.control.release('run-unknown', 1, 700), 'lease_not_found');
  // The freed slot goes to the next waiting run, and still only one.
  assert.equal((await Promise.all([h.control.admit(), restarted.admit()])).flat().length, 1);
  assert.equal(holding(h.store.peek()).length, 2);
});

test('provider and per-region caps both bind, and a pair with no entry admits nothing', async () => {
  const h = harness({ per_provider_running: { cloudflare: 1, azure: 2 }, per_region_running: { 'cloudflare:weur': 2, 'cloudflare:enam': 2, 'azure:weur': 2 } });
  value(await h.control.enqueue(run('cf-weur')));
  value(await h.control.enqueue(run('cf-enam', { region: 'enam' })));
  value(await h.control.enqueue(run('aws-weur', { provider: 'aws' })));
  const grants = await h.control.admit();
  assert.deepEqual(grants.map(g => g.run_uid), ['cf-weur'], 'cloudflare provider cap 1; aws has no entry');
  const plan = await h.control.planning(1000);
  assert.equal(plan.simultaneous_limit, 1 + 2, 'cloudflare min(1, 4) + azure min(2, 2)');
});

test('fair scheduling gives the tenant holding fewer slots the next one, and waiting is bounded', async () => {
  const h = harness({ per_region_running: { 'cloudflare:weur': 2, 'azure:weur': 2 }, per_tenant_waiting: 3, max_waiting: 4 });
  for (const uid of ['a1', 'a2', 'a3']) value(await h.control.enqueue(run(uid, { tenant_id: 1 })));
  value(await h.control.enqueue(run('b1', { tenant_id: 2 })));
  refused(await h.control.enqueue(run('a4', { tenant_id: 1 })), 'admission_queue_full');
  const grants = await h.control.admit();
  assert.deepEqual(grants.map(g => g.run_uid).sort(), ['a1', 'b1']);
  const h2 = harness({ per_tenant_waiting: 2 });
  for (const uid of ['a1', 'a2']) value(await h2.control.enqueue(run(uid, { tenant_id: 1 })));
  refused(await h2.control.enqueue(run('a3', { tenant_id: 1 })), 'tenant_queue_full');
  value(await h2.control.enqueue(run('b1', { tenant_id: 2 })));
  const h3 = harness({ per_tenant_running: 1 });
  for (const uid of ['a1', 'a2']) value(await h3.control.enqueue(run(uid, { tenant_id: 1 })));
  assert.equal((await h3.control.admit()).length, 1, 'per-tenant running cap');
});

test('a stale lease keeps its slot until the provider is read, then settles exactly once', async () => {
  const h = harness({ per_region_running: { 'cloudflare:weur': 1 } });
  value(await h.control.enqueue(run('r1')));
  value(await h.control.enqueue(run('r2')));
  const [g] = await h.control.admit();
  h.clock.now += 30_000;
  value(await h.control.renew('r1', g.generation));
  h.clock.now += 60_000;
  refused(await h.control.renew('r1', g.generation), 'lease_not_live');
  // Expired but unread: nothing is freed, so r2 cannot oversubscribe the region.
  assert.deepEqual(await h.control.admit(), []);
  assert.equal(h.store.peek().slots.r1.state, 'reconciling');
  // Brownout: the reader throws, then answers unknown. The slot is held both times and nothing is billed.
  h.provider.set('r1', 'throw');
  assert.deepEqual((await h.control.reconcile()).map(r => [r.observed, r.state, r.billed]), [['unknown', 'reconciling', null]]);
  h.provider.set('r1', { state: 'unknown', measured_microusd: 'unavailable' });
  await h.control.reconcile();
  assert.deepEqual(await h.control.admit(), []);
  assert.equal(h.store.peek().slots.r1.settlement, null);
  // Still running at the provider: a fresh lease on the same generation.
  h.provider.set('r1', { state: 'running', measured_microusd: 'unavailable' });
  assert.equal((await h.control.reconcile())[0].state, 'admitted');
  value(await h.control.renew('r1', g.generation));
  // Lost callback: the lease lapses, the provider says gone with a measured cost, the slot settles and frees.
  h.clock.now += 120_000;
  h.provider.set('r1', { state: 'gone', measured_microusd: 640 });
  const [settled] = await h.control.reconcile();
  assert.deepEqual([settled.state, settled.billed?.charged_microusd, settled.billed?.measured], ['released', 640, true]);
  // The late callback and a second reconcile pass bill nothing more.
  assert.deepEqual(value(await h.control.release('r1', g.generation, 999)), { charged_microusd: 640, measured: true, first: false });
  assert.deepEqual(await h.control.reconcile(), []);
  assert.deepEqual((await h.control.admit()).map(x => x.run_uid), ['r2']);
});

test('missing metrics charge the reserve and say so; a reconcile racing a callback is fenced', async () => {
  const h = harness();
  value(await h.control.enqueue(run('m1', { compute_reserve_microusd: 2500 })));
  const [g] = await h.control.admit();
  assert.deepEqual(value(await h.control.release('m1', g.generation, 'unavailable')), { charged_microusd: 2500, measured: false, first: true });
  // Race: the lease lapses and the reader is consulted, but the callback lands first. The reconcile applies nothing.
  value(await h.control.enqueue(run('m2')));
  assert.equal((await h.control.admit()).length, 1);
  h.clock.now += 61_000;
  const control = h.control;
  h.provider.set('m2', { state: 'gone', measured_microusd: 5 });
  const racing = createAdmissionControl({ store: h.store, clock: () => h.clock.now, limits: limits(), observe: async ref => {
    value(await control.release(ref.run_uid, ref.generation, 80));
    return { state: 'gone', measured_microusd: 5 };
  } });
  assert.deepEqual(await racing.reconcile(), []);
  assert.equal(h.store.peek().slots.m2.settlement?.charged_microusd, 80);
});

test('an ambiguous cancel holds the slot until the provider confirms the run is gone; a waiting cancel bills nothing', async () => {
  const h = harness({ per_region_running: { 'cloudflare:weur': 1 } });
  value(await h.control.enqueue(run('c1')));
  value(await h.control.enqueue(run('c2')));
  const [g] = await h.control.admit();
  assert.deepEqual(value(await h.control.cancel('c1', g.generation)), { state: 'reconciling' });
  h.provider.set('c1', { state: 'running', measured_microusd: 'unavailable' });
  assert.equal((await h.control.reconcile())[0].state, 'reconciling', 'a cancel the provider has not honoured keeps holding');
  assert.deepEqual(await h.control.admit(), []);
  h.provider.set('c1', { state: 'gone', measured_microusd: 120 });
  assert.equal((await h.control.reconcile())[0].billed?.charged_microusd, 120);
  assert.deepEqual((await h.control.admit()).map(x => x.run_uid), ['c2']);
});

test('a waiting cancel is withdrawn with no bill', async () => {
  const h = harness({ per_region_running: { 'cloudflare:weur': 0 } });
  value(await h.control.enqueue(run('w1')));
  assert.deepEqual(value(await h.control.cancel('w1', 0)), { state: 'withdrawn' });
  assert.equal(h.store.peek().slots.w1.settlement, null);
  assert.deepEqual(await h.control.admit(), []);
});

test('the compute reservation is per agent and counts only live leases, for the lane budget', async () => {
  const h = harness();
  value(await h.control.enqueue(run('l1', { agent_id: 7, compute_reserve_microusd: 3000 })));
  value(await h.control.enqueue(run('l2', { agent_id: 7, compute_reserve_microusd: 4000 })));
  value(await h.control.enqueue(run('l3', { agent_id: 7, compute_reserve_microusd: 5000, provider: 'azure' })));
  value(await h.control.enqueue(run('other', { agent_id: 8, compute_reserve_microusd: 9000, region: 'enam' })));
  assert.deepEqual(await h.control.computeReservation(7), { agent_id: 7, live_leases: 0, reserved_microusd: 0 });
  await h.control.admit();
  assert.deepEqual(await h.control.computeReservation(7), { agent_id: 7, live_leases: 3, reserved_microusd: 12000 });
  const l1 = h.store.peek().slots.l1;
  value(await h.control.release('l1', l1.generation, 10));
  assert.deepEqual(await h.control.computeReservation(7), { agent_id: 7, live_leases: 2, reserved_microusd: 9000 });
});

test('planning keeps registered agents apart from simultaneous containers; an unread count is unavailable', async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) value(await h.control.enqueue(run(`p${i}`)));
  await h.control.admit();
  const plan = await h.control.planning(1000);
  assert.deepEqual([plan.registered_agents, plan.simultaneous_executions, plan.simultaneous_limit, plan.waiting], [1000, 2, 4, 3]);
  assert.deepEqual(plan.by_region['cloudflare:weur'], { holding: 2, limit: 2 });
  assert.equal((await h.control.planning(null)).registered_agents, 'unavailable');
  assert.equal((await h.control.planning(-1)).registered_agents, 'unavailable');
});

test('halt, a backwards clock and invalid limits are refused', async () => {
  const halted = harness({ halted: true });
  refused(await halted.control.enqueue(run('h1')), 'admission_halted');
  const h = harness();
  value(await h.control.enqueue(run('t1')));
  h.clock.now -= 1;
  refused(await h.control.enqueue(run('t2')), 'clock_regressed');
  assert.deepEqual(await h.control.admit(), []);
  refused(await h.control.enqueue(run('bad uid!')), 'invalid_admission_request');
  assert.throws(() => createAdmissionControl({ store: h.store, clock: () => 0, limits: limits({ lease_ms: 10 }), observe: async () => ({ state: 'unknown', measured_microusd: 'unavailable' }) }), /Invalid admission limits/);
});
