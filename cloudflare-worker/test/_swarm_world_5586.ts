/**
 * D5586 (#5586 part 1): the shared fixtures of the swarm admission tests: a serialized memory store that rolls a
 * throwing transaction back (as a Durable Object's storage transaction does), #5570's real admission control over
 * that same store, an injected clock and provider-state reader, and synthetic tenant-isolated ventures.
 */
import assert from 'node:assert/strict';
import { createAdmissionControl, emptyAdmissionState, type AdmissionLimits, type AdmissionState, type AdmissionStore,
  type LeaseRef, type ProviderObservation } from '../src/services/agents/workspaceAdmission.ts';
import { createSwarmAdmission, ventureKey, type Modality, type SwarmFacts, type SwarmRequest, type VenturePolicy } from '../src/services/agents/swarmAdmission.ts';

/** One serialized transaction at a time over a cloned state; a throw keeps the previous state. */
export function memoryStore(): AdmissionStore & { peek(): AdmissionState; transactions: number } {
  let state = emptyAdmissionState();
  let pending: Promise<unknown> = Promise.resolve();
  const self = {
    transactions: 0,
    transaction<T>(change: (s: AdmissionState) => T): Promise<T> {
      const next = pending.then(() => { self.transactions++; const copy = structuredClone(state); const out = change(copy); state = copy; return out; });
      pending = next.catch(() => {});
      return next;
    },
    peek: () => structuredClone(state),
  };
  return self;
}

export const MODELS: Record<Modality, string> = {
  code: '@cf/qwen/qwen2.5-coder-32b-instruct', document: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  brand_image: '@cf/black-forest-labs/flux-1-schnell', video_render: 'render/ffmpeg-h264', final_publication: 'publish/release',
};
export const V7 = { tenant_id: 7, company_id: 70 };
export const V8 = { tenant_id: 8, company_id: 80 };

export function policy(v: { tenant_id: number; company_id: number }, patch: Partial<VenturePolicy> = {}): VenturePolicy {
  const all = (max: number) => ({ max_concurrent: max, providers: ['cloudflare' as const], models: Object.values(MODELS) });
  return { ...v, halted: false, max_concurrent: 8, max_waiting: 200,
    modalities: { code: all(3), document: all(4), brand_image: all(4), video_render: all(2), final_publication: all(1) },
    render_budget_microusd: 10_000_000, storage_quota_bytes: 1_000_000_000, ...patch };
}
export const facts = (patch: Partial<SwarmFacts> = {}): SwarmFacts => ({ agent: 'active', head_revision_uid: null, storage_used_bytes: 0, ...patch });

let n = 0;
export function request(v: { tenant_id: number; company_id: number }, modality: Modality, patch: Partial<SwarmRequest> = {}): SwarmRequest {
  n += 1;
  return { ticket_uid: `run_${v.tenant_id}_${modality}_${n}`, ...v, team_id: 1, agent_id: 100 + v.tenant_id, modality, provider: 'cloudflare',
    model: MODELS[modality], region: 'weur', asset_uid: `asset_${v.tenant_id}_${n}`, base_revision_uid: null,
    reserve_microusd: 1000, ceiling_microusd: 5000, storage_bytes: 1000, ...patch };
}

export const limits = (patch: Partial<AdmissionLimits> = {}): AdmissionLimits => ({ halted: false, lease_ms: 60_000,
  per_tenant_running: 50, per_tenant_waiting: 200, max_waiting: 400,
  per_provider_running: { cloudflare: 40 }, per_region_running: { 'cloudflare:weur': 40 }, ...patch });

/** #5570's admission control and the swarm over one store, one clock and one provider reader. */
export function swarmWorld(patch: Partial<AdmissionLimits> = {}, now?: () => number) {
  const clock = { now: 1_000_000 };
  const read = now ?? (() => clock.now);
  const kill = { on: false };
  const provider = new Map<string, ProviderObservation | 'throw'>();
  const store = memoryStore();
  const admission = createAdmissionControl({ store, clock: read, limits: limits(patch), observe: async (ref: LeaseRef) => {
    const o = provider.get(ref.run_uid) ?? { state: 'unknown', measured_microusd: 'unavailable' };
    if (o === 'throw') throw new Error('provider brownout');
    return o;
  } });
  const swarm = createSwarmAdmission({ store, clock: read, admission, halted: () => kill.on });
  const ventures = (...ps: VenturePolicy[]) => Object.fromEntries(ps.map(p => [ventureKey(p), { policy: p, storage_used_bytes: 0 }]));
  return { clock, kill, provider, store, admission, swarm, ventures };
}

export const ok = <T>(r: { ok: true; value: T } | { ok: false; code: string }): T => { assert.ok(r.ok, JSON.stringify(r)); return (r as { value: T }).value; };
export const refused = (r: { ok: boolean; code?: string }, code: string) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); };
