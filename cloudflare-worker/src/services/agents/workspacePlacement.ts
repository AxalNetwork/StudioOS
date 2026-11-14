/** D5570: pure provider placement for a broker-built WorkspaceSpec; consent and residency first, Cloudflare preferred, unknown cost never 0. Unmounted. */
import { executorEligibility, PROVIDERS, workspaceRefusal, type ExecutorCapabilities, type Provider, type WorkspaceRefusal, type WorkspaceSpec } from './workspaceSpec';

/** The provider cost categories #5570 names. Each line is integer micro-USD, or `unavailable` when nobody can say. */
export const COST_CATEGORIES = ['compute', 'boot', 'storage', 'image_pull', 'egress', 'idle'] as const;
export type CostCategory = typeof COST_CATEGORIES[number];
export type CostLine = number | 'unavailable';
export type CostQuote = { source: 'quoted' | 'observed'; lines: Record<CostCategory, CostLine> };

/** The sum of a quote, or `unavailable` when any line is unknown or malformed. A missing figure is never read as 0. */
export function quoteTotal(quote: CostQuote | null | undefined): CostLine {
  if (!quote || typeof quote !== 'object' || !quote.lines) return 'unavailable';
  let total = 0;
  for (const category of COST_CATEGORIES) {
    const line = quote.lines[category];
    if (!Number.isSafeInteger(line) || (line as number) < 0) return 'unavailable';
    total += line as number;
  }
  return Number.isSafeInteger(total) ? total : 'unavailable';
}

export type ProviderHealth = 'healthy' | 'degraded' | 'down' | 'unknown';
export type PlacementCandidate = {
  capabilities: ExecutorCapabilities;
  health: ProviderHealth;
  /** Free execution slots per region as the admission store last read them; null when unread. */
  capacity: Record<string, number | null>;
  quote: CostQuote | null;
  latency_ms: number | null;
  cache_local: boolean;
};
/** The tenant's standing policy, read from records the broker owns; never from the request. */
export type TenantPlacementPolicy = { consented_providers: readonly Provider[]; residency_regions: readonly string[]; halted: boolean };

/** Why a candidate is out, in the order it is checked. The first four are policy; the rest may clear on their own. */
export type PlacementReason = 'consent' | 'residency' | 'capability' | 'health' | 'quota_unverified' | 'quota_exhausted' | 'over_budget';
const TRANSIENT: readonly PlacementReason[] = ['health', 'quota_exhausted'];

export type CandidateVerdict =
  | { provider: Provider; eligible: true; region: string; cost: CostLine; latency_ms: number | null; cache_local: boolean; free: number }
  | { provider: Provider; eligible: false; reason: PlacementReason; capability?: string };

/** One candidate, checked in #5570's order: consent, residency, security/runtime/resources, health and quota, then budget. */
export function judgeCandidate(spec: WorkspaceSpec, policy: TenantPlacementPolicy, candidate: PlacementCandidate): CandidateVerdict {
  const caps = candidate?.capabilities;
  const provider = (caps && PROVIDERS.includes(caps.provider) ? caps.provider : 'cloudflare') as Provider;
  const out = (reason: PlacementReason, capability?: string): CandidateVerdict => ({ provider, eligible: false, reason, ...(capability ? { capability } : {}) });
  if (!caps || !PROVIDERS.includes(caps.provider)) return out('capability', 'capabilities_unverified');
  // 1. Mandatory consent: the spec's allowlist and the tenant's standing consent must both name the provider.
  if (!spec.allowed_providers.includes(provider) || !policy.consented_providers.includes(provider)) return out('consent');
  // 2. Residency: only regions the spec, the tenant and the provider all accept. Nothing outside them is a fallback.
  const resident = spec.allowed_regions.filter(r => policy.residency_regions.includes(r) && caps.enforced_regions?.includes(r));
  if (!resident.length) return out('residency');
  // 3-5. Security, image/runtime and workload needs: the merged D5565 gate, restricted to resident regions.
  const gate = executorEligibility({ ...spec, allowed_regions: resident }, caps);
  if (!gate.ok) return out('capability', gate.capability ?? gate.code);
  // 6. Health, then quota in a resident region. Unread capacity is not free capacity.
  if (candidate.health !== 'healthy') return out('health');
  const counts = resident.map(r => candidate.capacity?.[r]);
  if (counts.every(n => n === null || n === undefined || !Number.isSafeInteger(n))) return out('quota_unverified');
  const open = resident.map(r => ({ region: r, free: candidate.capacity[r] as number })).filter(c => Number.isSafeInteger(c.free) && c.free > 0);
  if (!open.length) return out('quota_exhausted');
  const best = open.sort((a, b) => b.free - a.free || a.region.localeCompare(b.region))[0];
  // 7. Budget: a known total over the spec's ceiling is refused. An unknown total is not assumed to fit; admission reserves the ceiling.
  const cost = quoteTotal(candidate.quote);
  if (cost !== 'unavailable' && cost > spec.max_cost_microusd) return out('over_budget');
  return { provider, eligible: true, region: best.region, cost, latency_ms: Number.isFinite(candidate.latency_ms) ? candidate.latency_ms : null,
    cache_local: candidate.cache_local === true, free: best.free };
}

type Eligible = Extract<CandidateVerdict, { eligible: true }>;
const known = (n: number | null | 'unavailable') => n !== null && n !== 'unavailable';
/** Cloudflare first; then known cost, then latency, then cache locality, then free capacity. Unknowns sort after knowns. */
export function rankEligible(rows: Eligible[]): Eligible[] {
  return [...rows].sort((a, b) =>
    Number(b.provider === 'cloudflare') - Number(a.provider === 'cloudflare')
    || Number(known(b.cost)) - Number(known(a.cost)) || (known(a.cost) ? (a.cost as number) - (b.cost as number) : 0)
    || Number(known(b.latency_ms)) - Number(known(a.latency_ms)) || (known(a.latency_ms) ? (a.latency_ms as number) - (b.latency_ms as number) : 0)
    || Number(b.cache_local) - Number(a.cache_local)
    || b.free - a.free || a.provider.localeCompare(b.provider));
}

export type PlacementDecision =
  | { decision: 'place'; provider: Provider; region: string; cost: CostLine; reserve_microusd: number; verdicts: CandidateVerdict[] }
  | { decision: 'queue'; reasons: CandidateVerdict[] }
  | (WorkspaceRefusal & { decision: 'refuse'; reasons: CandidateVerdict[] });

/**
 * Where a spec runs, whether it waits, or why it cannot run.
 *
 * Queue only when every candidate that passed consent, residency and capability is held back by health or quota,
 * which can clear. Any other outcome is a refusal with each candidate's reason. The reserve is the known quote, or
 * the spec's ceiling when the quote is unavailable, so an unknown cost is never reserved as 0.
 */
export function placeWorkspace(spec: WorkspaceSpec, policy: TenantPlacementPolicy, candidates: readonly PlacementCandidate[]): PlacementDecision {
  if (!policy || policy.halted !== false) return { ...workspaceRefusal('placement_halted', 503), decision: 'refuse', reasons: [] };
  const verdicts = (candidates || []).map(c => judgeCandidate(spec, policy, c));
  const eligible = rankEligible(verdicts.filter((v): v is Eligible => v.eligible));
  if (eligible.length) {
    const chosen = eligible[0];
    const reserve = chosen.cost === 'unavailable' ? spec.max_cost_microusd : chosen.cost;
    return { decision: 'place', provider: chosen.provider, region: chosen.region, cost: chosen.cost, reserve_microusd: reserve, verdicts };
  }
  const blocked = verdicts.filter((v): v is Extract<CandidateVerdict, { eligible: false }> => !v.eligible);
  if (blocked.some(v => TRANSIENT.includes(v.reason))) return { decision: 'queue', reasons: verdicts };
  return { ...workspaceRefusal('no_eligible_provider', 422), decision: 'refuse', reasons: verdicts };
}
