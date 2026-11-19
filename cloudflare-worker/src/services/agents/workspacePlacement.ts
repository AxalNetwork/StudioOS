/**
 * D5570 (#5570 part 1): pure provider placement for a broker-built WorkspaceSpec. Eligibility in the issue's
 * mandatory order (consent, residency, security, image/runtime, workload, quota/health), Cloudflare first, then
 * cost, latency, cache locality and regional capacity; a per-category cost model where an unknown is
 * `unavailable`, never 0; a dry-run quote. No D1, route, binding or store: nothing here is mounted.
 */
import { executorEligibility, PROVIDERS, workspaceRefusal, type ExecutorCapabilities, type Provider, type WorkspaceRefusal, type WorkspaceSpec } from './workspaceSpec';

/** The provider cost categories #5570 names, in the order a quote lists them. */
export const COST_CATEGORIES = ['compute', 'boot', 'storage', 'image_pull', 'egress', 'idle'] as const;
export type CostCategory = typeof COST_CATEGORIES[number];
/** Integer micro-USD, or `unavailable` when nobody can say. A missing figure is never written as 0. */
export type CostLine = number | 'unavailable';
export type CostQuote = { provider: Provider; source: 'quoted' | 'observed' | 'none'; lines: Record<CostCategory, CostLine>; total: CostLine };

/**
 * One provider's published or observed prices, in micro-USD per unit. `null` is "this provider has not told us",
 * which makes that line `unavailable`. Rates come from a registry the broker owns, never from the executor.
 */
export type RateCard = {
  provider: Provider; source: 'quoted' | 'observed';
  vcpu_second: number | null; gib_second: number | null; boot: number | null;
  disk_gib_second: number | null; image_pull_cold: number | null; image_pull_cached: number | null;
  egress_gib: number | null; idle_second: number | null; idle_seconds: number | null;
};

const rate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
/** Round a fractional micro-USD figure up: a quote is an upper bound and never understates. */
const line = (...parts: unknown[]): CostLine => {
  if (!parts.every(rate)) return 'unavailable';
  const value = Math.ceil((parts as number[]).reduce((a, b) => a * b, 1));
  return Number.isSafeInteger(value) ? value : 'unavailable';
};

/** The sum of a quote's lines, or `unavailable` when any line is unknown or malformed. */
export function quoteTotal(lines: Partial<Record<CostCategory, CostLine>> | null | undefined): CostLine {
  if (!lines || typeof lines !== 'object') return 'unavailable';
  let total = 0;
  for (const category of COST_CATEGORIES) {
    const value = lines[category];
    if (!Number.isSafeInteger(value) || (value as number) < 0) return 'unavailable';
    total += value as number;
  }
  return Number.isSafeInteger(total) ? total : 'unavailable';
}

/**
 * The ceiling quote for one spec on one provider: the spec's own cpu, memory, disk and max_duration_s bound every
 * time-based line. A deny network policy has no egress, a known 0; an allowlist has no egress bound in the spec, so
 * its egress is `unavailable` until the provider caps it.
 */
export function quoteFor(spec: WorkspaceSpec, provider: Provider, card: RateCard | null | undefined, cacheLocal: boolean): CostQuote {
  if (!card || card.provider !== provider) {
    const none = Object.fromEntries(COST_CATEGORIES.map(c => [c, 'unavailable'])) as Record<CostCategory, CostLine>;
    return { provider, source: 'none', lines: none, total: 'unavailable' };
  }
  const seconds = spec.max_duration_s, gib = spec.memory_mb / 1024, disk = spec.disk_mb / 1024;
  const compute = [line(spec.cpu, seconds, card.vcpu_second), line(gib, seconds, card.gib_second)];
  const lines: Record<CostCategory, CostLine> = {
    compute: compute.every(v => v !== 'unavailable') ? (compute[0] as number) + (compute[1] as number) : 'unavailable',
    boot: line(card.boot),
    storage: line(disk, seconds, card.disk_gib_second),
    image_pull: line(cacheLocal === true ? card.image_pull_cached : card.image_pull_cold),
    egress: spec.network_policy.mode === 'deny' ? 0 : 'unavailable',
    idle: line(card.idle_seconds, card.idle_second),
  };
  return { provider, source: card.source === 'observed' ? 'observed' : 'quoted', lines, total: quoteTotal(lines) };
}

export type ProviderHealth = 'healthy' | 'degraded' | 'down' | 'unknown';
export type PlacementCandidate = {
  capabilities: ExecutorCapabilities;
  health: ProviderHealth;
  /** Free execution slots per region as the admission store last read them; null or absent when unread. */
  capacity: Record<string, number | null>;
  rates: RateCard | null;
  latency_ms: number | null;
  cache_local: boolean;
};
/** The tenant's standing policy, read from records the broker owns; never from the request. */
export type TenantPlacementPolicy = { consented_providers: readonly Provider[]; residency_regions: readonly string[]; halted: boolean };

/**
 * Why a candidate is out, in the order it is checked. The first five are policy or fit and never clear by waiting;
 * the three quota/health reasons can, so only they queue. `over_budget` is checked after eligibility.
 */
export const PLACEMENT_REASONS = ['consent', 'residency', 'security', 'image_runtime', 'workload', 'health', 'quota_unverified', 'quota_exhausted', 'over_budget'] as const;
export type PlacementReason = typeof PLACEMENT_REASONS[number];
const WAITABLE: readonly PlacementReason[] = ['health', 'quota_unverified', 'quota_exhausted'];

export type EligibleVerdict = { provider: Provider; eligible: true; region: string; quote: CostQuote; latency_ms: number | null; cache_local: boolean; free: number };
export type IneligibleVerdict = { provider: Provider; eligible: false; reason: PlacementReason; detail?: string; quote: CostQuote | null };
export type CandidateVerdict = EligibleVerdict | IneligibleVerdict;

/** One candidate, checked strictly in #5570's order. The first failing stage names the reason. */
export function judgeCandidate(spec: WorkspaceSpec, policy: TenantPlacementPolicy, candidate: PlacementCandidate): CandidateVerdict {
  const caps = candidate?.capabilities;
  const known = Boolean(caps && PROVIDERS.includes(caps.provider));
  const provider = (known ? caps.provider : 'cloudflare') as Provider;
  const quote = known ? quoteFor(spec, provider, candidate.rates, candidate.cache_local === true) : null;
  const out = (reason: PlacementReason, detail?: string): IneligibleVerdict => ({ provider, eligible: false, reason, ...(detail ? { detail } : {}), quote });
  if (!known || !Array.isArray(caps.workload_classes) || !Array.isArray(caps.enforced_regions) || !Array.isArray(caps.enforced_network_modes)) {
    return out('security', 'capabilities_unverified');
  }
  // 1. Mandatory consent: the spec's allowlist and the tenant's standing consent must both name the provider.
  if (!spec.allowed_providers.includes(provider) || !policy.consented_providers.includes(provider)) return out('consent');
  // 2. Residency: only regions the spec, the tenant and the provider all accept. Nothing outside them is a fallback.
  const resident = spec.allowed_regions.filter(r => policy.residency_regions.includes(r) && caps.enforced_regions.includes(r));
  if (!resident.length) return out('residency');
  // 3. Security capability: cancellation, the network policy actually enforced, shell and hostile-code isolation.
  if (caps.interrupt !== true) return out('security', 'cancel');
  if (!caps.enforced_network_modes.includes(spec.network_policy.mode)) return out('security', 'network_policy');
  if (spec.workload_class.startsWith('coding') && caps.shell !== true) return out('security', 'shell');
  if (spec.workload_class === 'coding_untrusted' && caps.untrusted_code !== true) return out('security', 'hostile_code_isolation');
  // 4. Image and runtime: digest-pinned pulls, the workload class, checkpoint restore when the spec resumes one.
  if (caps.digest_pulls !== true) return out('image_runtime', 'image_digest');
  if (!caps.workload_classes.includes(spec.workload_class)) return out('image_runtime', 'workload_class');
  if (spec.checkpoint_manifest_ref && caps.checkpoint_restore !== true) return out('image_runtime', 'checkpoint_restore');
  // 5. Workload needs. WorkspaceSpec carries no GPU request, so no candidate is judged on GPU (D5570).
  for (const [need, max, name] of [[spec.cpu, caps.cpu_max, 'cpu'], [spec.memory_mb, caps.memory_mb_max, 'memory'],
    [spec.disk_mb, caps.disk_mb_max, 'disk'], [spec.max_duration_s, caps.duration_s_max, 'duration']] as const) {
    if (!Number.isFinite(max) || max < need) return out('workload', name);
  }
  // 6. Health, then quota in a resident region. Unread capacity is not free capacity.
  if (candidate.health !== 'healthy') return out('health', String(candidate.health ?? 'unknown'));
  if (!Number.isSafeInteger(caps.concurrency_max) || (caps.concurrency_max ?? 0) < 1) return out('quota_unverified', 'concurrency_max');
  const read = resident.map(region => ({ region, free: candidate.capacity?.[region] })).filter(c => Number.isSafeInteger(c.free) && (c.free as number) >= 0);
  if (!read.length) return out('quota_unverified');
  const open = read.filter(c => (c.free as number) > 0).sort((a, b) => (b.free as number) - (a.free as number) || a.region.localeCompare(b.region));
  if (!open.length) return out('quota_exhausted');
  // The merged D5565 gate must agree over the resident regions; it is the contract, this filter only orders it.
  const gate = executorEligibility({ ...spec, allowed_regions: resident }, caps);
  if (!gate.ok) return out('security', gate.capability ?? gate.code);
  // Budget: a known total over the spec's ceiling is refused. An unknown total is not assumed to fit; it reserves the ceiling.
  if (!quote) return out('security', 'capabilities_unverified');
  if (quote.total !== 'unavailable' && quote.total > spec.max_cost_microusd) return out('over_budget');
  return { provider, eligible: true, region: open[0].region, quote, cache_local: candidate.cache_local === true, free: open[0].free as number,
    latency_ms: typeof candidate.latency_ms === 'number' && Number.isFinite(candidate.latency_ms) && candidate.latency_ms >= 0 ? candidate.latency_ms : null };
}

const isKnown = (n: number | null | 'unavailable'): n is number => n !== null && n !== 'unavailable';
const ascKnownFirst = (a: number | null | 'unavailable', b: number | null | 'unavailable') =>
  Number(isKnown(b)) - Number(isKnown(a)) || (isKnown(a) && isKnown(b) ? a - b : 0);

/** Cloudflare first; then known cost (lower), latency (lower), cache locality, free regional capacity (more). Unknowns sort after knowns. */
export function rankEligible(rows: readonly EligibleVerdict[]): EligibleVerdict[] {
  return [...rows].sort((a, b) =>
    Number(b.provider === 'cloudflare') - Number(a.provider === 'cloudflare')
    || ascKnownFirst(a.quote.total, b.quote.total)
    || ascKnownFirst(a.latency_ms, b.latency_ms)
    || Number(b.cache_local) - Number(a.cache_local)
    || b.free - a.free || a.provider.localeCompare(b.provider));
}

export type PlacementDecision =
  | { decision: 'place'; provider: Provider; region: string; quote: CostQuote; reserve_microusd: number; reserve_basis: 'quote' | 'spec_ceiling'; verdicts: CandidateVerdict[] }
  | { decision: 'queue'; verdicts: CandidateVerdict[] }
  | (WorkspaceRefusal & { decision: 'refuse'; verdicts: CandidateVerdict[] });

/**
 * Where a spec runs, whether it waits, or why it cannot run.
 *
 * Queue only when at least one candidate cleared consent, residency, security, image/runtime and workload and is
 * held back only by health or quota, which can clear. Every other outcome is a refusal carrying each candidate's
 * reason. There is no automatic fallback outside the spec's and the tenant's providers and regions. The reserve is
 * the known quote, or the spec's `max_cost_microusd` when any line is unavailable, so an unknown is never reserved as 0.
 */
export function placeWorkspace(spec: WorkspaceSpec, policy: TenantPlacementPolicy, candidates: readonly PlacementCandidate[]): PlacementDecision {
  if (!policy || policy.halted !== false || !Array.isArray(policy.consented_providers) || !Array.isArray(policy.residency_regions)) {
    return { ...workspaceRefusal('placement_halted', 503), decision: 'refuse', verdicts: [] };
  }
  const verdicts = (candidates || []).map(c => judgeCandidate(spec, policy, c));
  const eligible = rankEligible(verdicts.filter((v): v is EligibleVerdict => v.eligible));
  if (eligible.length) {
    const chosen = eligible[0];
    const unknown = chosen.quote.total === 'unavailable';
    return { decision: 'place', provider: chosen.provider, region: chosen.region, quote: chosen.quote,
      reserve_microusd: unknown ? spec.max_cost_microusd : chosen.quote.total as number, reserve_basis: unknown ? 'spec_ceiling' : 'quote', verdicts };
  }
  if (verdicts.some(v => !v.eligible && WAITABLE.includes(v.reason))) return { decision: 'queue', verdicts };
  return { ...workspaceRefusal('no_eligible_provider', 422), decision: 'refuse', verdicts };
}

/**
 * A dry-run quote: the same judgement and ranking with every candidate's per-category quote shown, and nothing
 * reserved. `upper_bound_microusd` is the spec's ceiling, the most a run may be charged.
 */
export function dryRunQuote(spec: WorkspaceSpec, policy: TenantPlacementPolicy, candidates: readonly PlacementCandidate[]) {
  const decision = placeWorkspace(spec, policy, candidates);
  return { dry_run: true as const, upper_bound_microusd: spec.max_cost_microusd, decision,
    quotes: decision.verdicts.map(v => ({ provider: v.provider, eligible: v.eligible, reason: v.eligible ? null : v.reason, quote: v.quote })) };
}
