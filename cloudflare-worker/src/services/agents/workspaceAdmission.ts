/**
 * D5570 (#5570 part 1): compute admission leases for workspace runs over an injected transactional store and an
 * injected clock. Fenced by generation, capped per tenant, per provider and per provider region, fair across
 * tenants, bounded waiting, reconciled against the provider's actual state, settled once. Unmounted: part 2 backs
 * the store with one Durable Object and settles through the existing holds.
 *
 * Where it sits beside the agent engine (#7074 note on #5570): `admitInScope` (agents/engine.ts) stays the one gate
 * that decides a run exists. A lease is taken only for a run it admitted and is keyed by that run's uid, so a
 * provider never holds capacity for a run the engine refused. `computeReservation` sums the compute reserve of an
 * agent's live leases; part 2 adds it to the per-run ceilings `laneBudget` (agents/capacity.ts) already counts, so a
 * sub-agent lane cannot fit under the cap on tokens and overshoot it on compute. Neither file is changed here.
 */
import { PROVIDERS, workspaceReference, workspaceRefusal, type Provider, type WorkspaceResult } from './workspaceSpec';

export type LeaseState = 'waiting' | 'admitted' | 'reconciling' | 'released' | 'withdrawn';
export type Settlement = { generation: number; charged_microusd: number; measured: boolean; at: number };
/**
 * One run's place in admission. `admitted` and `reconciling` both hold a slot: an expired lease, a lost callback or
 * an ambiguous cancel frees nothing until the provider's actual state is read.
 */
export type AdmissionSlot = {
  run_uid: string; tenant_id: number; agent_id: number; provider: Provider; region: string;
  state: LeaseState; generation: number; sequence: number;
  enqueued_at: number; admitted_at: number | null; lease_expires_at: number | null;
  compute_reserve_microusd: number; cancel_requested: boolean;
  settlement: Settlement | null;
};
export type AdmissionState = { slots: Record<string, AdmissionSlot>; next_sequence: number; last_now: number };
export const emptyAdmissionState = (): AdmissionState => ({ slots: {}, next_sequence: 1, last_now: 0 });
/** Implement with one Durable Object's storage transaction (part 2). A process-local memory store belongs only to tests. */
export interface AdmissionStore { transaction<T>(change: (state: AdmissionState) => T): Promise<T> }

export type AdmissionLimits = {
  halted: boolean; lease_ms: number;
  per_tenant_running: number; per_tenant_waiting: number; max_waiting: number;
  /** Concurrent executions per provider. A provider with no entry admits nothing. */
  per_provider_running: Readonly<Partial<Record<Provider, number>>>;
  /** Concurrent executions per `provider:region`. A pair with no entry admits nothing. */
  per_region_running: Readonly<Record<string, number>>;
};
export type AdmissionGrant = { run_uid: string; tenant_id: number; agent_id: number; provider: Provider; region: string; generation: number; lease_expires_at: number; compute_reserve_microusd: number };
export type LeaseRef = { run_uid: string; generation: number; tenant_id: number; provider: Provider; region: string };
export type ProviderObservation = { state: 'running' | 'gone' | 'unknown'; measured_microusd: number | 'unavailable' };
/** Reads what the provider actually runs. It is called outside any store transaction; a throw reads as `unknown`. */
export type ProviderStateReader = (lease: LeaseRef) => Promise<ProviderObservation>;

const holds = (s: AdmissionSlot) => s.state === 'admitted' || s.state === 'reconciling';
const pairOf = (s: { provider: string; region: string }) => `${s.provider}:${s.region}`;
const whole = (n: unknown, min: number) => Number.isSafeInteger(n) && (n as number) >= min;
const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

export function createAdmissionControl({ store, clock, limits, observe }: { store: AdmissionStore; clock: () => number; limits: AdmissionLimits; observe: ProviderStateReader }) {
  if (!store || typeof clock !== 'function' || typeof observe !== 'function' || !limits || typeof limits.halted !== 'boolean'
    || !whole(limits.lease_ms, 1000) || limits.lease_ms > 600000 || !whole(limits.per_tenant_running, 1) || !whole(limits.per_tenant_waiting, 1)
    || !whole(limits.max_waiting, 1) || !limits.per_provider_running || !limits.per_region_running
    || Object.values(limits.per_provider_running).some(n => !whole(n, 0))
    || Object.values(limits.per_region_running).some(n => !whole(n, 0))) throw new Error('Invalid admission limits');
  const refuse = workspaceRefusal;
  /** The injected clock, once per transaction. A clock that runs backwards is refused, never trusted. */
  const readNow = (state: AdmissionState) => {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid injected clock');
    if (now < state.last_now) return null;
    state.last_now = now;
    return now;
  };
  /** One logical bill per lease. Missing metrics charge the reserve, never 0, and say so. A repeat returns the first bill. */
  const settle = (s: AdmissionSlot, measured: number | 'unavailable', now: number): { bill: Settlement; first: boolean } => {
    if (s.settlement) return { bill: s.settlement, first: false };
    const known = whole(measured, 0);
    s.settlement = { generation: s.generation, charged_microusd: known ? measured as number : s.compute_reserve_microusd, measured: known, at: now };
    s.state = 'released'; s.lease_expires_at = null;
    return { bill: s.settlement, first: true };
  };
  const fenced = (state: AdmissionState, runUid: string, generation: number): WorkspaceResult<AdmissionSlot> => {
    const s = state.slots[runUid];
    if (!s) return refuse('lease_not_found', 403);
    if (generation !== s.generation) return refuse('stale_generation');
    return { ok: true, value: s };
  };
  const expireDue = (state: AdmissionState, now: number) => {
    for (const s of Object.values(state.slots)) {
      if (s.state === 'admitted' && s.lease_expires_at !== null && now >= s.lease_expires_at) { s.state = 'reconciling'; s.lease_expires_at = null; }
    }
  };

  return {
    /**
     * Queue a run the engine already admitted, keyed by its run uid. Idempotent: a retry with the same terms returns
     * the current state; different terms for the same uid are refused.
     */
    async enqueue(req: { run_uid: string; tenant_id: number; agent_id: number; provider: Provider; region: string; compute_reserve_microusd: number }): Promise<WorkspaceResult<{ state: LeaseState; duplicate: boolean }>> {
      return store.transaction(state => {
        if (!req || !workspaceReference(req.run_uid) || !whole(req.tenant_id, 1) || !whole(req.agent_id, 1) || !PROVIDERS.includes(req.provider)
          || typeof req.region !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(req.region) || !whole(req.compute_reserve_microusd, 0)) return refuse('invalid_admission_request', 422);
        const prior = state.slots[req.run_uid];
        if (prior) {
          const same = prior.tenant_id === req.tenant_id && prior.agent_id === req.agent_id && prior.provider === req.provider
            && prior.region === req.region && prior.compute_reserve_microusd === req.compute_reserve_microusd;
          return same ? { ok: true, value: { state: prior.state, duplicate: true } } : refuse('run_contract_changed');
        }
        if (limits.halted) return refuse('admission_halted', 503);
        const now = readNow(state);
        if (now === null) return refuse('clock_regressed', 503);
        const waiting = Object.values(state.slots).filter(s => s.state === 'waiting');
        if (waiting.length >= limits.max_waiting) return refuse('admission_queue_full', 503);
        if (waiting.filter(s => s.tenant_id === req.tenant_id).length >= limits.per_tenant_waiting) return refuse('tenant_queue_full', 503);
        state.slots[req.run_uid] = { run_uid: req.run_uid, tenant_id: req.tenant_id, agent_id: req.agent_id, provider: req.provider, region: req.region,
          state: 'waiting', generation: 0, sequence: state.next_sequence++, enqueued_at: now, admitted_at: null, lease_expires_at: null,
          compute_reserve_microusd: req.compute_reserve_microusd, cancel_requested: false, settlement: null };
        return { ok: true, value: { state: 'waiting', duplicate: false } };
      });
    },

    /**
     * Admit every waiting run that fits, fairly: each pick goes to the tenant holding the fewest slots, then the
     * earliest-queued run. Each admission bumps the run's generation, which fences every later call.
     */
    async admit(): Promise<AdmissionGrant[]> {
      return store.transaction(state => {
        if (limits.halted) return [];
        const now = readNow(state);
        if (now === null) return [];
        expireDue(state, now);
        const all = Object.values(state.slots);
        const tenantHeld = new Map<number, number>(), providerHeld = new Map<string, number>(), regionHeld = new Map<string, number>();
        for (const s of all.filter(holds)) { bump(tenantHeld, s.tenant_id); bump(providerHeld, s.provider); bump(regionHeld, pairOf(s)); }
        const grants: AdmissionGrant[] = [];
        const waiting = all.filter(s => s.state === 'waiting');
        for (;;) {
          const fits = waiting.filter(s => s.state === 'waiting'
            && (tenantHeld.get(s.tenant_id) ?? 0) < limits.per_tenant_running
            && (providerHeld.get(s.provider) ?? 0) < (limits.per_provider_running[s.provider] ?? 0)
            && (regionHeld.get(pairOf(s)) ?? 0) < (limits.per_region_running[pairOf(s)] ?? 0));
          if (!fits.length) break;
          const s = fits.sort((a, b) => (tenantHeld.get(a.tenant_id) ?? 0) - (tenantHeld.get(b.tenant_id) ?? 0) || a.sequence - b.sequence)[0];
          s.state = 'admitted'; s.generation += 1; s.admitted_at = now; s.lease_expires_at = now + limits.lease_ms;
          bump(tenantHeld, s.tenant_id); bump(providerHeld, s.provider); bump(regionHeld, pairOf(s));
          grants.push({ run_uid: s.run_uid, tenant_id: s.tenant_id, agent_id: s.agent_id, provider: s.provider, region: s.region,
            generation: s.generation, lease_expires_at: s.lease_expires_at, compute_reserve_microusd: s.compute_reserve_microusd });
        }
        return grants;
      });
    },

    /** Extend a live lease. A stale generation or an expired lease is refused, never revived here. */
    async renew(runUid: string, generation: number): Promise<WorkspaceResult<{ lease_expires_at: number }>> {
      return store.transaction(state => {
        const now = readNow(state);
        if (now === null) return refuse('clock_regressed', 503);
        const checked = fenced(state, runUid, generation);
        if (!checked.ok) return checked;
        const s = checked.value;
        if (s.state !== 'admitted' || s.lease_expires_at === null || now >= s.lease_expires_at) return refuse('lease_not_live');
        s.lease_expires_at = now + limits.lease_ms;
        return { ok: true, value: { lease_expires_at: s.lease_expires_at } };
      });
    },

    /**
     * The run's completion callback. Settles once and frees the slot; a repeat returns the same bill with
     * `first: false`, so the caller settles its hold exactly once.
     */
    async release(runUid: string, generation: number, measured: number | 'unavailable'): Promise<WorkspaceResult<{ charged_microusd: number; measured: boolean; first: boolean }>> {
      return store.transaction(state => {
        const now = readNow(state);
        if (now === null) return refuse('clock_regressed', 503);
        const checked = fenced(state, runUid, generation);
        if (!checked.ok) return checked;
        const s = checked.value;
        if (!holds(s) && !s.settlement) return refuse('not_admitted');
        const { bill, first } = settle(s, measured, now);
        return { ok: true, value: { charged_microusd: bill.charged_microusd, measured: bill.measured, first } };
      });
    },

    /**
     * Cancel. A waiting run is withdrawn with no bill: nothing ran. An admitted run moves to `reconciling` and keeps
     * its slot, because a cancel the provider has not confirmed is ambiguous.
     */
    async cancel(runUid: string, generation: number): Promise<WorkspaceResult<{ state: LeaseState }>> {
      return store.transaction(state => {
        const now = readNow(state);
        if (now === null) return refuse('clock_regressed', 503);
        const checked = fenced(state, runUid, generation);
        if (!checked.ok) return checked;
        const s = checked.value;
        if (s.state === 'waiting') s.state = 'withdrawn';
        else if (holds(s)) { s.state = 'reconciling'; s.lease_expires_at = null; s.cancel_requested = true; }
        return { ok: true, value: { state: s.state } };
      });
    },

    /**
     * Expire due leases, then read the provider's actual state for every reconciling run and apply it under the
     * generation fence: `gone` settles once and frees the slot; `running` takes a fresh lease unless a cancel is
     * pending; `unknown` (or a reader that throws) keeps holding. Nothing here guesses.
     */
    async reconcile(): Promise<{ run_uid: string; generation: number; observed: ProviderObservation['state']; state: LeaseState; billed: Settlement | null }[]> {
      const due = await store.transaction(state => {
        const now = readNow(state);
        if (now === null) return [] as LeaseRef[];
        expireDue(state, now);
        return Object.values(state.slots).filter(s => s.state === 'reconciling')
          .map(s => ({ run_uid: s.run_uid, generation: s.generation, tenant_id: s.tenant_id, provider: s.provider, region: s.region }));
      });
      const seen: { ref: LeaseRef; obs: ProviderObservation }[] = [];
      for (const ref of due) {
        let obs: ProviderObservation;
        try { obs = await observe({ ...ref }); } catch { obs = { state: 'unknown', measured_microusd: 'unavailable' }; }
        if (!obs || !['running', 'gone', 'unknown'].includes(obs.state)) obs = { state: 'unknown', measured_microusd: 'unavailable' };
        seen.push({ ref, obs });
      }
      return store.transaction(state => {
        const now = readNow(state);
        if (now === null) return [];
        const out: { run_uid: string; generation: number; observed: ProviderObservation['state']; state: LeaseState; billed: Settlement | null }[] = [];
        for (const { ref, obs } of seen) {
          const s = state.slots[ref.run_uid];
          // Fenced: the slot moved on (settled by a late callback, or a newer generation) while the provider was read.
          if (!s || s.generation !== ref.generation || s.state !== 'reconciling') continue;
          let billed: Settlement | null = null;
          if (obs.state === 'gone') { const r = settle(s, obs.measured_microusd, now); billed = r.first ? r.bill : null; }
          else if (obs.state === 'running' && !s.cancel_requested) { s.state = 'admitted'; s.lease_expires_at = now + limits.lease_ms; }
          out.push({ run_uid: s.run_uid, generation: s.generation, observed: obs.state, state: s.state, billed });
        }
        return out;
      });
    },

    /**
     * The compute an agent's live leases hold, for the lane budget. Waiting runs hold none. Part 2 adds
     * `reserved_microusd` beside `live * per_run_microusd` in `laneBudget`.
     */
    async computeReservation(agentId: number): Promise<{ agent_id: number; live_leases: number; reserved_microusd: number }> {
      return store.transaction(state => {
        const live = Object.values(state.slots).filter(s => s.agent_id === agentId && holds(s));
        return { agent_id: agentId, live_leases: live.length, reserved_microusd: live.reduce((sum, s) => sum + s.compute_reserve_microusd, 0) };
      });
    },

    /**
     * What planning and quota screens show. Registered agents hold no capacity; simultaneous executions do. A
     * thousand registered agents is not a thousand containers. An unread agent count is `unavailable`, not 0.
     */
    async planning(registeredAgents: number | null | undefined) {
      return store.transaction(state => {
        const all = Object.values(state.slots);
        const byRegion: Record<string, { holding: number; limit: number }> = {};
        for (const [key, limit] of Object.entries(limits.per_region_running)) byRegion[key] = { holding: 0, limit };
        for (const s of all.filter(holds)) (byRegion[pairOf(s)] ??= { holding: 0, limit: 0 }).holding += 1;
        return {
          registered_agents: whole(registeredAgents, 0) ? registeredAgents as number : 'unavailable' as const,
          simultaneous_executions: all.filter(holds).length,
          // Each provider runs at most its own cap, and at most the sum of its regions' caps.
          simultaneous_limit: PROVIDERS.reduce((sum, p) => sum + Math.min(limits.per_provider_running[p] ?? 0,
            Object.entries(limits.per_region_running).filter(([key]) => key.startsWith(`${p}:`)).reduce((a, [, n]) => a + n, 0)), 0),
          waiting: all.filter(s => s.state === 'waiting').length,
          by_region: byRegion,
        };
      });
    },
  };
}
