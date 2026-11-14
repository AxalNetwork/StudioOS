/** D5570: injected-clock admission leases for workspace runs; fenced, fair across tenants, capped per tenant and per provider region, billed once. Unmounted. */
import { PROVIDERS, workspaceReference, workspaceRefusal, type Provider, type WorkspaceResult } from './workspaceSpec';

/**
 * One run's place in admission. `admitted` and `reconciling` both hold a slot: an expired lease does not free
 * capacity until the provider's actual state is read, so a lost callback or an ambiguous cancel cannot oversubscribe.
 */
export type AdmissionSlot = {
  run_id: string; tenant_id: number; provider: Provider; region: string;
  state: 'waiting' | 'admitted' | 'reconciling' | 'released';
  generation: number; sequence: number; enqueued_at: number; admitted_at: number | null; lease_expires_at: number | null;
  reserve_microusd: number;
  settlement: { generation: number; charged_microusd: number; measured: boolean; at: number } | null;
};
export type AdmissionState = { slots: Record<string, AdmissionSlot>; next_sequence: number; last_now: number };
/** Implement with one Durable Object's storage transaction; the memory implementation belongs only to tests. */
export interface AdmissionStore { transaction<T>(change: (state: AdmissionState) => T): Promise<T> }
export type AdmissionLimits = {
  halted: boolean; lease_ms: number;
  per_tenant_running: number; per_tenant_waiting: number;
  /** Concurrent executions per `provider:region`. A pair with no entry admits nothing. */
  per_region_running: Readonly<Record<string, number>>;
};
export type AdmissionGrant = { run_id: string; tenant_id: number; provider: Provider; region: string; generation: number; lease_expires_at: number; reserve_microusd: number };
export type ProviderObservation = 'running' | 'gone' | 'unknown';

const HOLDS = ['admitted', 'reconciling'] as const;
const holds = (s: AdmissionSlot) => (HOLDS as readonly string[]).includes(s.state);
const pair = (s: { provider: string; region: string }) => `${s.provider}:${s.region}`;

export function createAdmissionControl({ store, clock, limits }: { store: AdmissionStore; clock: () => number; limits: AdmissionLimits }) {
  const whole = (n: unknown, min: number) => Number.isSafeInteger(n) && (n as number) >= min;
  if (!limits || typeof limits.halted !== 'boolean' || !whole(limits.lease_ms, 1000) || limits.lease_ms > 600000
    || !whole(limits.per_tenant_running, 1) || !whole(limits.per_tenant_waiting, 1) || !limits.per_region_running
    || Object.values(limits.per_region_running).some(n => !whole(n, 0))) throw new Error('Invalid admission limits');
  const refuse = workspaceRefusal;
  const readNow = (state: AdmissionState) => {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid injected clock');
    if (now < state.last_now) return null;
    state.last_now = now;
    return now;
  };
  const settle = (s: AdmissionSlot, measured: number | 'unavailable', now: number) => {
    // One logical bill per admitted generation. Missing metrics charge the reserve, never 0, and say so.
    if (s.settlement) return s.settlement;
    const known = Number.isSafeInteger(measured) && (measured as number) >= 0;
    s.settlement = { generation: s.generation, charged_microusd: known ? measured as number : s.reserve_microusd, measured: known, at: now };
    return s.settlement;
  };
  function fenced(state: AdmissionState, runId: string, generation: number): WorkspaceResult<AdmissionSlot> {
    const s = state.slots[runId];
    if (!s) return refuse('run_not_found', 403);
    if (generation !== s.generation) return refuse('stale_generation');
    return { ok: true, value: s };
  }

  return {
    /** Idempotent on run_id. The broker calls it after placement chose provider, region and reserve. */
    async enqueue(req: { run_id: string; tenant_id: number; provider: Provider; region: string; reserve_microusd: number }): Promise<WorkspaceResult<{ state: AdmissionSlot['state']; duplicate: boolean }>> {
      return store.transaction(state => {
        if (limits.halted) return refuse('admission_halted', 503);
        if (!req || !workspaceReference(req.run_id) || !whole(req.tenant_id, 1) || !PROVIDERS.includes(req.provider)
          || !/^[a-z][a-z0-9-]{1,31}$/.test(req.region) || !whole(req.reserve_microusd, 0)) return refuse('invalid_admission_request', 422);
        const now = readNow(state);
        if (now === null) return refuse('clock_regressed', 503);
        const prior = state.slots[req.run_id];
        if (prior) return prior.tenant_id === req.tenant_id && prior.provider === req.provider && prior.region === req.region && prior.reserve_microusd === req.reserve_microusd
          ? { ok: true, value: { state: prior.state, duplicate: true } } : refuse('run_contract_changed');
        const waiting = Object.values(state.slots).filter(s => s.tenant_id === req.tenant_id && s.state === 'waiting').length;
        if (waiting >= limits.per_tenant_waiting) return refuse('tenant_queue_full', 503);
        state.slots[req.run_id] = { run_id: req.run_id, tenant_id: req.tenant_id, provider: req.provider, region: req.region,
          state: 'waiting', generation: 0, sequence: state.next_sequence++, enqueued_at: now, admitted_at: null, lease_expires_at: null,
          reserve_microusd: req.reserve_microusd, settlement: null };
        return { ok: true, value: { state: 'waiting', duplicate: false } };
      });
    },

    /**
     * Admit every waiting run that fits, fairly: each pick goes to the tenant holding the fewest slots, then the
     * earliest-queued run. Each admission bumps the generation, which fences every later call.
     */
    async admit(): Promise<AdmissionGrant[]> {
      return store.transaction(state => {
        if (limits.halted) return [];
        const now = readNow(state);
        if (now === null) return [];
        const all = Object.values(state.slots);
        const tenantHeld = new Map<number, number>(), regionHeld = new Map<string, number>();
        for (const s of all.filter(holds)) {
          tenantHeld.set(s.tenant_id, (tenantHeld.get(s.tenant_id) ?? 0) + 1);
          regionHeld.set(pair(s), (regionHeld.get(pair(s)) ?? 0) + 1);
        }
        const grants: AdmissionGrant[] = [];
        const waiting = all.filter(s => s.state === 'waiting').sort((a, b) => a.sequence - b.sequence);
        for (;;) {
          const fits = waiting.filter(s => s.state === 'waiting'
            && (tenantHeld.get(s.tenant_id) ?? 0) < limits.per_tenant_running
            && (regionHeld.get(pair(s)) ?? 0) < (limits.per_region_running[pair(s)] ?? 0));
          if (!fits.length) break;
          const s = fits.sort((a, b) => (tenantHeld.get(a.tenant_id) ?? 0) - (tenantHeld.get(b.tenant_id) ?? 0) || a.sequence - b.sequence)[0];
          s.state = 'admitted'; s.generation += 1; s.admitted_at = now; s.lease_expires_at = now + limits.lease_ms;
          tenantHeld.set(s.tenant_id, (tenantHeld.get(s.tenant_id) ?? 0) + 1);
          regionHeld.set(pair(s), (regionHeld.get(pair(s)) ?? 0) + 1);
          grants.push({ run_id: s.run_id, tenant_id: s.tenant_id, provider: s.provider, region: s.region, generation: s.generation,
            lease_expires_at: s.lease_expires_at, reserve_microusd: s.reserve_microusd });
        }
        return grants;
      });
    },

    /** Extend a live lease. A stale generation or an expired lease is refused, never revived here. */
    async renew(runId: string, generation: number): Promise<WorkspaceResult<{ lease_expires_at: number }>> {
      return store.transaction(state => {
        const now = readNow(state);
        if (now === null) return refuse('clock_regressed', 503);
        const checked = fenced(state, runId, generation);
        if (!checked.ok) return checked;
        const s = checked.value;
        if (s.state !== 'admitted' || s.lease_expires_at === null || now >= s.lease_expires_at) return refuse('lease_not_live');
        s.lease_expires_at = now + limits.lease_ms;
        return { ok: true, value: { lease_expires_at: s.lease_expires_at } };
      });
    },

    /** The run ended and the provider confirmed it. Settles once; a repeat returns the same bill. */
    async release(runId: string, generation: number, measured: number | 'unavailable'): Promise<WorkspaceResult<{ charged_microusd: number; measured: boolean; duplicate: boolean }>> {
      return store.transaction(state => {
        const now = readNow(state);
        if (now === null) return refuse('clock_regressed', 503);
        const checked = fenced(state, runId, generation);
        if (!checked.ok) return checked;
        const s = checked.value;
        if (s.state === 'released' && s.settlement) return { ok: true, value: { charged_microusd: s.settlement.charged_microusd, measured: s.settlement.measured, duplicate: true } };
        if (!holds(s)) return refuse('not_admitted');
        const bill = settle(s, measured, now);
        s.state = 'released'; s.lease_expires_at = null;
        return { ok: true, value: { charged_microusd: bill.charged_microusd, measured: bill.measured, duplicate: false } };
      });
    },

    /** Leases past expiry move to `reconciling`. They keep their slot until `reconcile` reads the provider. */
    async expire(): Promise<{ run_id: string; generation: number }[]> {
      return store.transaction(state => {
        const now = readNow(state);
        if (now === null) return [];
        const moved: { run_id: string; generation: number }[] = [];
        for (const s of Object.values(state.slots)) {
          if (s.state === 'admitted' && s.lease_expires_at !== null && now >= s.lease_expires_at) {
            s.state = 'reconciling'; s.lease_expires_at = null;
            moved.push({ run_id: s.run_id, generation: s.generation });
          }
        }
        return moved;
      });
    },

    /**
     * The provider's actual state for a reconciling run: still running takes a fresh lease; gone settles and frees
     * the slot; unknown keeps holding it. Nothing here guesses.
     */
    async reconcile(runId: string, generation: number, observed: ProviderObservation, measured: number | 'unavailable' = 'unavailable'): Promise<WorkspaceResult<{ state: AdmissionSlot['state'] }>> {
      return store.transaction(state => {
        const now = readNow(state);
        if (now === null) return refuse('clock_regressed', 503);
        const checked = fenced(state, runId, generation);
        if (!checked.ok) return checked;
        const s = checked.value;
        if (s.state !== 'reconciling') return refuse('not_reconciling');
        if (observed === 'running') { s.state = 'admitted'; s.lease_expires_at = now + limits.lease_ms; }
        else if (observed === 'gone') { settle(s, measured, now); s.state = 'released'; }
        else if (observed !== 'unknown') return refuse('invalid_observation', 422);
        return { ok: true, value: { state: s.state } };
      });
    },

    /**
     * What planning and quota screens show: executions holding capacity, kept apart from registered agents, which
     * hold none. A thousand registered agents is not a thousand containers.
     */
    async occupancy(registeredAgents: number): Promise<{ registered_agents: number; executions_holding_capacity: number; waiting: number; by_region: Record<string, { holding: number; limit: number }> }> {
      return store.transaction(state => {
        const all = Object.values(state.slots);
        const byRegion: Record<string, { holding: number; limit: number }> = {};
        for (const [key, limit] of Object.entries(limits.per_region_running)) byRegion[key] = { holding: 0, limit };
        for (const s of all.filter(holds)) (byRegion[pair(s)] ??= { holding: 0, limit: 0 }).holding += 1;
        return { registered_agents: whole(registeredAgents, 0) ? registeredAgents : 0, executions_holding_capacity: all.filter(holds).length,
          waiting: all.filter(s => s.state === 'waiting').length, by_region: byRegion };
      });
    },
  };
}
