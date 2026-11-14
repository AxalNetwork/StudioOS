/**
 * #5570 (D5570): provider placement and admission leases for workspace runs, pure and unmounted.
 * Synthetic tenants, providers and quotes; injected clock, no wall-clock waits.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/workspace_placement_5570.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeWorkspace, quoteTotal, type CostQuote, type PlacementCandidate, type TenantPlacementPolicy } from '../src/services/agents/workspacePlacement.ts';
import { createAdmissionControl, type AdmissionLimits, type AdmissionState, type AdmissionStore } from '../src/services/agents/workspaceAdmission.ts';
import type { ExecutorCapabilities, Provider, WorkspaceResult } from '../src/services/agents/workspaceSpec.ts';
import { fakeCapabilities, specFixture } from './_workspace_fake_5565.ts';

const value = <T>(r: WorkspaceResult<T>): T => { assert.ok(r.ok, JSON.stringify(r)); return r.value; };
const refused = (r: WorkspaceResult<unknown>, code: string) => { assert.equal(r.ok, false, JSON.stringify(r)); if (!r.ok) assert.equal(r.code, code); };

const quote = (each: number | 'unavailable'): CostQuote => ({ source: 'quoted',
  lines: { compute: each, boot: each, storage: each, image_pull: each, egress: each, idle: each } });
const caps = (provider: Provider, regions = ['weur']): ExecutorCapabilities => ({ ...fakeCapabilities(), provider, enforced_regions: regions });
const candidate = (provider: Provider, patch: Partial<PlacementCandidate> = {}, regions = ['weur']): PlacementCandidate => ({
  capabilities: caps(provider, regions), health: 'healthy', capacity: Object.fromEntries(regions.map(r => [r, 5])),
  quote: quote(100), latency_ms: 50, cache_local: false, ...patch });
const spec = (providers: Provider[] = ['cloudflare', 'azure'], regions = ['weur']) =>
  specFixture({ allowed_providers: providers, allowed_regions: regions });
const policy = (patch: Partial<TenantPlacementPolicy> = {}): TenantPlacementPolicy => ({ consented_providers: ['cloudflare', 'azure'], residency_regions: ['weur'], halted: false, ...patch });

test('Cloudflare is preferred for an eligible task even when another allowed provider is cheaper', () => {
  const placed = placeWorkspace(spec(), policy(), [candidate('azure', { quote: quote(1) }), candidate('cloudflare', { quote: quote(1000) })]);
  assert.equal(placed.decision, 'place');
  if (placed.decision === 'place') assert.deepEqual([placed.provider, placed.region, placed.cost, placed.reserve_microusd], ['cloudflare', 'weur', 6000, 6000]);
});

test('with Cloudflare out of quota the task falls back only to an explicitly allowed, consented provider in a resident region', () => {
  const full = candidate('cloudflare', { capacity: { weur: 0 } });
  const placed = placeWorkspace(spec(), policy(), [full, candidate('azure')]);
  assert.equal(placed.decision, 'place'); if (placed.decision === 'place') assert.equal(placed.provider, 'azure');
  // Not consented by the tenant: the task waits for Cloudflare quota rather than moving.
  const notConsented = placeWorkspace(spec(), policy({ consented_providers: ['cloudflare'] }), [full, candidate('azure')]);
  assert.equal(notConsented.decision, 'queue');
  if (notConsented.decision === 'queue') assert.deepEqual(notConsented.reasons.map(r => !r.eligible && r.reason), ['quota_exhausted', 'consent']);
  // Not in the spec's allowlist: same.
  assert.equal(placeWorkspace(spec(['cloudflare']), policy(), [full, candidate('azure')]).decision, 'queue');
  // Azure only offers a region outside the tenant's residency: it is never a fallback.
  const abroad = placeWorkspace(spec(['cloudflare', 'azure'], ['weur', 'enam']), policy(), [full, candidate('azure', {}, ['enam'])]);
  assert.equal(abroad.decision, 'queue');
  if (abroad.decision === 'queue') assert.equal((abroad.reasons[1] as any).reason, 'residency');
});

test('no candidate that can ever run the spec is a refusal with each reason, not a queue', () => {
  const placed = placeWorkspace(spec(), policy(), [candidate('cloudflare', { capabilities: { ...caps('cloudflare'), untrusted_code: false } }), candidate('azure', {}, ['enam'])]);
  assert.equal(placed.decision, 'refuse');
  if (placed.decision === 'refuse') {
    assert.equal(placed.code, 'no_eligible_provider');
    assert.deepEqual(placed.reasons.map(r => !r.eligible && [r.reason, r.capability ?? null]), [['capability', 'hostile_code_isolation'], ['residency', null]]);
  }
  const unread = placeWorkspace(spec(['cloudflare']), policy(), [candidate('cloudflare', { capacity: { weur: null } })]);
  assert.equal(unread.decision, 'refuse');
  const halted = placeWorkspace(spec(), policy({ halted: true }), [candidate('cloudflare')]);
  assert.equal(halted.decision, 'refuse'); if (halted.decision === 'refuse') assert.equal(halted.code, 'placement_halted');
  assert.equal(placeWorkspace(spec(), policy(), [candidate('cloudflare', { health: 'degraded' })]).decision, 'queue', 'a brownout waits');
});

test('an unknown cost is unavailable, never 0: it ranks after a known one and reserves the spec ceiling', () => {
  assert.equal(quoteTotal(quote(10)), 60);
  assert.equal(quoteTotal(quote('unavailable')), 'unavailable');
  assert.equal(quoteTotal({ source: 'quoted', lines: { ...quote(1).lines, egress: -1 } }), 'unavailable');
  assert.equal(quoteTotal(null), 'unavailable');
  const s = spec(['azure', 'gcp']), p = policy({ consented_providers: ['azure', 'gcp'] });
  const placed = placeWorkspace(s, p, [candidate('azure', { quote: quote('unavailable'), latency_ms: 1 }), candidate('gcp', { quote: quote(500) })]);
  assert.equal(placed.decision, 'place'); if (placed.decision === 'place') assert.equal(placed.provider, 'gcp');
  const onlyUnknown = placeWorkspace(s, p, [candidate('azure', { quote: null })]);
  assert.equal(onlyUnknown.decision, 'place');
  if (onlyUnknown.decision === 'place') assert.deepEqual([onlyUnknown.cost, onlyUnknown.reserve_microusd], ['unavailable', s.max_cost_microusd]);
  const over = placeWorkspace(s, p, [candidate('azure', { quote: quote(s.max_cost_microusd) })]);
  assert.equal(over.decision, 'refuse'); if (over.decision === 'refuse') assert.equal((over.reasons[0] as any).reason, 'over_budget');
});

function memoryAdmissionStore(): AdmissionStore & { inspect(): AdmissionState } {
  let state: AdmissionState = { slots: {}, next_sequence: 1, last_now: 0 };
  let pending: Promise<unknown> = Promise.resolve();
  return {
    async transaction<T>(change: (s: AdmissionState) => T): Promise<T> {
      const next = pending.then(() => { const copy = structuredClone(state); const result = change(copy); state = copy; return result; });
      pending = next.catch(() => {});
      return next;
    },
    inspect: () => structuredClone(state),
  };
}
const limits = (patch: Partial<AdmissionLimits> = {}): AdmissionLimits => ({ halted: false, lease_ms: 10000, per_tenant_running: 2,
  per_tenant_waiting: 10, per_region_running: { 'cloudflare:weur': 3 }, ...patch });
function admission(patch: Partial<AdmissionLimits> = {}, store = memoryAdmissionStore()) {
  let now = 1000;
  const control = createAdmissionControl({ store, clock: () => now, limits: limits(patch) });
  const enqueue = (run: string, tenant: number, reserve = 500) => control.enqueue({ run_id: run, tenant_id: tenant, provider: 'cloudflare', region: 'weur', reserve_microusd: reserve });
  return { store, control, enqueue, at: (t: number) => { now = t; } };
}

test('concurrent enqueues and admits never hold more slots than the region or the tenant allows', async () => {
  const a = admission();
  await Promise.all(Array.from({ length: 8 }, (_, i) => a.enqueue(`run-${i}`, 11 + (i % 3))));
  const rounds = await Promise.all([a.control.admit(), a.control.admit(), a.control.admit()]);
  assert.equal(rounds.flat().length, 3, 'three slots in cloudflare:weur');
  const held = Object.values(a.store.inspect().slots).filter(s => s.state === 'admitted');
  assert.equal(held.length, 3);
  assert.equal(new Set(held.map(s => s.tenant_id)).size, 3, 'one per tenant while three tenants wait');
  // A restart reads the same store and admits nothing new.
  const restarted = createAdmissionControl({ store: a.store, clock: () => 2000, limits: limits() });
  assert.equal((await restarted.admit()).length, 0);
  assert.deepEqual((await restarted.occupancy(1000)), { registered_agents: 1000, executions_holding_capacity: 3, waiting: 5,
    by_region: { 'cloudflare:weur': { holding: 3, limit: 3 } } });
});

test('fair scheduling: a tenant with one task is not starved behind a tenant with many; a full tenant queue refuses', async () => {
  const a = admission({ per_region_running: { 'cloudflare:weur': 2 }, per_tenant_waiting: 4 });
  for (let i = 0; i < 4; i++) value(await a.enqueue(`big-${i}`, 11));
  refused(await a.enqueue('big-4', 11), 'tenant_queue_full');
  value(await a.enqueue('small-0', 12));
  const grants = await a.control.admit();
  assert.deepEqual(grants.map(g => g.run_id), ['big-0', 'small-0']);
});

test('an expired lease keeps its slot until the provider is read; unknown keeps holding, gone frees it', async () => {
  const a = admission({ per_region_running: { 'cloudflare:weur': 1 } });
  value(await a.enqueue('run-a', 11)); value(await a.enqueue('run-b', 12));
  const [grant] = await a.control.admit();
  a.at(1000 + 10000);
  refused(await a.control.renew('run-a', grant.generation), 'lease_not_live');
  assert.deepEqual(await a.control.expire(), [{ run_id: 'run-a', generation: 1 }]);
  assert.equal((await a.control.admit()).length, 0, 'a lost callback does not free the slot');
  assert.deepEqual(value(await a.control.reconcile('run-a', 1, 'unknown')), { state: 'reconciling' });
  assert.equal((await a.control.admit()).length, 0, 'an ambiguous cancel does not free it either');
  assert.deepEqual(value(await a.control.reconcile('run-a', 1, 'running')), { state: 'admitted' });
  value(await a.control.renew('run-a', 1));
  a.at(30000); await a.control.expire();
  assert.deepEqual(value(await a.control.reconcile('run-a', 1, 'gone', 120)), { state: 'released' });
  assert.deepEqual((await a.control.admit()).map(g => g.run_id), ['run-b']);
});

test('a stale generation is refused, a repeated release bills once, and missing metrics charge the reserve, never 0', async () => {
  const a = admission();
  value(await a.enqueue('run-a', 11, 700)); value(await a.enqueue('run-b', 11, 900));
  const grants = await a.control.admit();
  refused(await a.control.release('run-a', grants[0].generation + 1, 10), 'stale_generation');
  refused(await a.control.renew('run-a', 0), 'stale_generation');
  const [first, again] = await Promise.all([a.control.release('run-a', 1, 300), a.control.release('run-a', 1, 999)]);
  assert.deepEqual(value(first), { charged_microusd: 300, measured: true, duplicate: false });
  assert.deepEqual(value(again), { charged_microusd: 300, measured: true, duplicate: true });
  assert.deepEqual(value(await a.control.release('run-b', 1, 'unavailable')), { charged_microusd: 900, measured: false, duplicate: false });
  refused(await a.control.reconcile('run-a', 1, 'gone'), 'not_reconciling');
});

test('a halted control admits nothing and refuses new work; bad limits and a regressed clock are refused', async () => {
  const a = admission({ halted: true });
  refused(await a.enqueue('run-a', 11), 'admission_halted');
  assert.deepEqual(await a.control.admit(), []);
  assert.throws(() => createAdmissionControl({ store: memoryAdmissionStore(), clock: () => 0, limits: limits({ lease_ms: 10 }) }), /Invalid admission limits/);
  const b = admission();
  value(await b.enqueue('run-a', 11));
  b.at(500);
  refused(await b.enqueue('run-b', 11), 'clock_regressed');
  refused(await b.control.enqueue({ run_id: 'run-a', tenant_id: 11, provider: 'azure', region: 'weur', reserve_microusd: 500 }), 'clock_regressed');
  b.at(1000);
  refused(await b.control.enqueue({ run_id: 'run-a', tenant_id: 11, provider: 'azure', region: 'weur', reserve_microusd: 500 }), 'run_contract_changed');
  assert.deepEqual(value(await b.enqueue('run-a', 11)), { state: 'waiting', duplicate: true });
});
