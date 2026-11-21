/** D7889: disabled-by-default fleet proposals; activation and durable integration remain separate reviews. */
export type Phase = 'reserved' | 'booting' | 'ready' | 'busy' | 'draining' | 'stopping' | 'uncertain' | 'deleted';
export interface ImageProfile {
  approved: boolean; version: string | null; digest: string | null; os: string; arch: string;
  runnerVersion: string | null; runnerDigest: string | null; nodeVersion: string | null; pythonVersion: string | null;
}
export interface FleetNode {
  reservation: string; profile: string; generation: number; phase: Phase; createdAt: number; bootStartedAt: number;
  lastHeartbeat: number | null; idleSince: number | null; registered: boolean; bootVerified: boolean;
  eligibilityRemoved: boolean; assignment: 'none' | 'owned' | 'unowned' | 'unknown';
  providerId: string | null; runnerId: number | null; deleteConfirmed: boolean;
  jobStartedAt: number | null; holdUnits: number;
  observedImage: ImageProfile | null;
}
export interface FleetState {
  revision: number; sequence: number; nodes: FleetNode[]; starts: number[]; lastScaleAt: number | null;
  reservedUnits: number; recentEvents: string[]; retryCount: number;
  pending: ScaleOperation[];
}
export interface ScaleConfig {
  enabled: boolean; approvedCap: number; stage: 1 | 5 | 10 | 50;
  minHostedShards: number; maxExternalPerRun: number; perRunPerProfile: number;
  maxNewPerInterval: number; intervalMs: number; cooldownMs: number; warmupMs: number; heartbeatMs: number;
  idleMs: number; lifetimeMs: number; maxRetries: number;
  profiles: Record<string, { min: number; max: number; image: ImageProfile }>;
  budget: { approved: boolean; meterVerified: boolean; remainingUnits: number | null; unitsPerNodeMinute: number | null;
    expiresAt: number | null; maxJobMs: number; terminationMs: number; billingLagMs: number };
}
export interface Inventory {
  complete: boolean; observedAt: number;
  instances: Array<{ providerId: string; reservation: string | null; owned: boolean }>;
}
export interface Demand { run: string; profile: string; queued: number; oldestAt: number }
export interface ScaleOperation { key: string; kind: 'create' | 'inspect' | 'remove-eligibility' | 'unregister' | 'stop-delete'; reservation: string; profile: string; generation: number }
export interface ScaleProposal { expectedRevision: number; state: FleetState; operations: ScaleOperation[]; reasons: string[]; publicStatus: Record<string, unknown> }
const integer = (n: number, min = 0) => Number.isSafeInteger(n) && n >= min;
const profileName = (v: string) => /^[a-z][a-z0-9-]{0,63}$/.test(v);
const semver = (v: string | null) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
export function validInventoryInstance(value: unknown): value is Inventory['instances'][number] {
  if (!value || typeof value !== 'object') return false;
  const i = value as Inventory['instances'][number];
  return typeof i.providerId === 'string' && i.providerId.length > 0 && i.providerId.length <= 256
    && typeof i.owned === 'boolean' && (i.reservation === null || (typeof i.reservation === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(i.reservation)));
}
export const emptyFleet = (): FleetState => ({ revision: 0, sequence: 0, nodes: [], starts: [], lastScaleAt: null, reservedUnits: 0, recentEvents: [], retryCount: 0, pending: [] });

export function imageEligible(image: ImageProfile): boolean {
  return image.approved && image.os === 'linux' && image.arch === 'x64' && typeof image.version === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(image.version)
    && /^sha256:[a-f0-9]{64}$/.test(image.digest ?? '') && /^[a-f0-9]{64}$/.test(image.runnerDigest ?? '')
    && semver(image.runnerVersion) && semver(image.nodeVersion) && image.nodeVersion!.startsWith('22.') && semver(image.pythonVersion);
}
export function imageMatches(expected: ImageProfile, observed: ImageProfile | undefined): boolean {
  return imageEligible(expected) && !!observed && (['version', 'digest', 'os', 'arch', 'runnerVersion', 'runnerDigest', 'nodeVersion', 'pythonVersion'] as const)
    .every((key) => expected[key] === observed[key]);
}
export function validateScaleConfig(c: ScaleConfig): void {
  if (!c || ![1, 5, 10, 50].includes(c.stage) || !integer(c.approvedCap) || c.approvedCap > c.stage
      || !integer(c.minHostedShards, 1) || c.minHostedShards > 6 || !integer(c.maxExternalPerRun)
      || c.maxExternalPerRun > 6 - c.minHostedShards || (c.stage === 1 && c.maxExternalPerRun > 2)
      || !integer(c.perRunPerProfile, 1) || c.perRunPerProfile > 6 || !integer(c.maxNewPerInterval, 1) || c.maxNewPerInterval > 50
      || !integer(c.intervalMs, 1) || !integer(c.cooldownMs) || !integer(c.warmupMs, 1) || !integer(c.heartbeatMs, 1)
      || !integer(c.idleMs, 1) || !integer(c.lifetimeMs, 1) || !integer(c.maxRetries) || c.maxRetries > 5) throw Error('invalid_scale_config');
  if (!c.profiles || !Object.keys(c.profiles).length || Object.keys(c.profiles).length > 8) throw Error('invalid_profiles');
  for (const [key, p] of Object.entries(c.profiles)) {
    if (!profileName(key) || !integer(p.min) || !integer(p.max) || p.min > p.max || p.max > c.stage) throw Error('invalid_profiles');
  }
  const b = c.budget;
  if (!b || !integer(b.maxJobMs, 1) || !integer(b.terminationMs, 1) || !integer(b.billingLagMs)
      || ((b.approved && b.meterVerified) && (b.remainingUnits == null || b.unitsPerNodeMinute == null || b.expiresAt == null
        || !integer(b.remainingUnits) || !integer(b.unitsPerNodeMinute, 1) || !integer(b.expiresAt)))) throw Error('invalid_budget');
}

/** Round-robin by run/profile, with a permanent hosted share. No shard fan-out is changed. */
export function fairDemand(demands: Demand[], config: ScaleConfig): Record<string, number> {
  const rows = new Map<string, Demand>();
  if (demands.length > 1000) throw Error('demand_bound');
  for (const d of demands) {
    if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(d.run) || !config.profiles[d.profile] || !integer(d.queued) || !integer(d.oldestAt)) throw Error('invalid_demand');
    const key = `${d.run}|${d.profile}`;
    if (rows.has(key)) throw Error('duplicate_demand');
    rows.set(key, d);
  }
  const result: Record<string, number> = {}; const perRun = new Map<string, number>();
  const used = new Map<string, number>(); const sorted = [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'));
  for (let round = 0; round < config.perRunPerProfile; round++) for (const [key, d] of sorted) {
    if ((perRun.get(d.run) ?? 0) >= config.maxExternalPerRun || (used.get(key) ?? 0) >= Math.min(d.queued, config.perRunPerProfile)) continue;
    perRun.set(d.run, (perRun.get(d.run) ?? 0) + 1); used.set(key, (used.get(key) ?? 0) + 1);
    result[d.profile] = (result[d.profile] ?? 0) + 1;
  }
  return result;
}

/** A CAS proposal only. The caller must persist its reservations before any provider side effect. */
export function planFleet(previous: FleetState, config: ScaleConfig, inventory: Inventory, demand: Demand[], now: number): ScaleProposal {
  validateScaleConfig(config);
  if (!integer(now) || !integer(previous.revision) || !integer(previous.sequence) || !integer(previous.reservedUnits)) throw Error('invalid_state');
  if (previous.nodes.length > 50 || new Set(previous.nodes.map((n) => n.reservation)).size !== previous.nodes.length
      || new Set(previous.nodes.filter((n) => n.providerId !== null).map((n) => n.providerId)).size !== previous.nodes.filter((n) => n.providerId !== null).length
      || new Set(previous.nodes.filter((n) => n.runnerId !== null).map((n) => n.runnerId)).size !== previous.nodes.filter((n) => n.runnerId !== null).length
      || previous.nodes.some((n) => !integer(n.generation, 1) || !integer(n.createdAt) || n.createdAt > now
        || !integer(n.bootStartedAt) || n.bootStartedAt < n.createdAt || n.bootStartedAt > now
        || (n.lastHeartbeat != null && (!integer(n.lastHeartbeat) || n.lastHeartbeat > now)))) throw Error('invalid_state');
  if (!Array.isArray(inventory.instances) || inventory.instances.length > 1000 || !inventory.instances.every(validInventoryInstance)
      || new Set(inventory.instances.map((i) => i.providerId)).size !== inventory.instances.length) throw Error('invalid_inventory');
  const state = structuredClone(previous); state.revision++;
  state.nodes = state.nodes.filter((n) => !(n.phase === 'deleted' && n.deleteConfirmed && n.holdUnits === 0));
  const operations: ScaleOperation[] = []; const reasons: string[] = [];
  const pending = fairDemand(demand, config);
  if (demand.some((d) => d.oldestAt > now)) throw Error('invalid_demand_time');
  const fresh = inventory.complete && integer(inventory.observedAt) && inventory.observedAt <= now && now - inventory.observedAt <= config.heartbeatMs;
  const live = state.nodes.filter((n) => !(n.phase === 'deleted' && n.deleteConfirmed && n.holdUnits === 0));
  const keep = new Set<string>(); const profileKept = new Map<string, number>();
  const candidates = live.filter((n) => ['reserved', 'booting', 'ready', 'busy'].includes(n.phase))
    .sort((a, b) => Number(b.assignment === 'owned') - Number(a.assignment === 'owned') || a.createdAt - b.createdAt || a.reservation.localeCompare(b.reservation));
  for (const node of candidates) {
    if (keep.size < config.approvedCap && (profileKept.get(node.profile) ?? 0) < (config.profiles[node.profile]?.max ?? 0)) {
      keep.add(node.reservation); profileKept.set(node.profile, (profileKept.get(node.profile) ?? 0) + 1);
    }
  }
  const duplicateReservations = new Set(inventory.instances.filter((i, index, all) => i.reservation !== null
    && all.findIndex((other) => other.reservation === i.reservation) !== index).map((i) => i.reservation));
  const orphans = inventory.instances.filter((i) => duplicateReservations.has(i.reservation)
    || !state.nodes.some((n) => n.providerId === i.providerId || (n.providerId === null && n.reservation === i.reservation)));
  const budget = config.budget;
  const finishReserveMs = config.lifetimeMs + budget.maxJobMs + budget.terminationMs + budget.billingLagMs;
  const perNodeUnits = budget.unitsPerNodeMinute == null ? null : Math.ceil(finishReserveMs / 60000) * budget.unitsPerNodeMinute;
  const canAdmit = config.enabled && config.approvedCap > 0 && budget.approved && budget.meterVerified
    && perNodeUnits != null && Number.isSafeInteger(perNodeUnits) && budget.expiresAt != null && budget.remainingUnits != null
    && budget.expiresAt - now > finishReserveMs && budget.remainingUnits >= state.reservedUnits;
  const missedDeadlines = live.filter((n) => (['reserved', 'booting'].includes(n.phase) && now - n.bootStartedAt >= config.warmupMs)
    || (n.jobStartedAt != null && now - n.jobStartedAt >= budget.maxJobMs)).length;
  const add = (node: FleetNode, kind: ScaleOperation['kind']) => {
    const key = `${node.reservation}:${node.generation}:${kind}`;
    if (!operations.some((op) => op.key === key)) operations.push({ key, kind, reservation: node.reservation, profile: node.profile, generation: node.generation });
  };
  if (!fresh) reasons.push('inventory_unavailable');
  if (orphans.length) reasons.push('orphan_inventory_requires_reconciliation');
  if (!canAdmit) reasons.push('admission_disabled_or_budget_unverified');
  const recentStarts = state.starts.filter((t) => now - t < config.intervalMs && t <= now);
  state.starts = recentStarts;
  for (const node of live) {
    if (node.phase === 'deleted') { reasons.push('termination_meter_pending'); continue; }
    const healthy = node.lastHeartbeat != null && now >= node.lastHeartbeat && now - node.lastHeartbeat <= config.heartbeatMs
      && !!config.profiles[node.profile] && imageMatches(config.profiles[node.profile].image, node.observedImage ?? undefined);
    const missing = fresh && node.providerId != null && !inventory.instances.some((i) => i.providerId === node.providerId && i.owned);
    const bootExpired = (node.phase === 'reserved' || node.phase === 'booting') && now - node.bootStartedAt >= config.warmupMs;
    const idleExpired = node.idleSince != null && now - node.idleSince >= config.idleMs;
    const profileLive = live.filter((n) => n.profile === node.profile && n.phase !== 'draining' && n.phase !== 'stopping').length;
    const desired = Math.min(config.profiles[node.profile]?.max ?? 0, Math.max(config.profiles[node.profile]?.min ?? 0, pending[node.profile] ?? 0));
    const shouldDrain = !canAdmit || (candidates.includes(node) && !keep.has(node.reservation)) || now - node.createdAt >= config.lifetimeMs || bootExpired
      || (idleExpired && profileLive > desired) || (node.phase === 'ready' && !healthy)
      || (node.jobStartedAt != null && now - node.jobStartedAt >= budget.maxJobMs);
    if (missing || node.phase === 'uncertain' || (node.providerId === null && shouldDrain)) { node.phase = 'uncertain'; add(node, 'inspect'); continue; }
    if (shouldDrain && node.phase !== 'stopping') node.phase = 'draining';
    if (node.phase === 'draining') {
      if (!node.eligibilityRemoved) add(node, 'remove-eligibility');
      else if (fresh && node.assignment === 'none' && node.jobStartedAt === null) {
        if (node.registered) add(node, 'unregister');
        else { node.phase = 'stopping'; add(node, 'stop-delete'); }
      }
      else reasons.push(node.assignment === 'owned' ? 'owned_job_must_finish_or_be_fenced' : 'assignment_not_safe_to_terminate');
    }
  }
  let headroom = Math.max(0, config.approvedCap - live.length - orphans.length);
  let launchBudget = Math.max(0, config.maxNewPerInterval - recentStarts.length);
  if (state.lastScaleAt != null && now - state.lastScaleAt < config.cooldownMs) launchBudget = 0;
  if (!fresh || orphans.length || !canAdmit) launchBudget = 0;
  // One new node per profile each round; pending boots and durable reservations occupy headroom.
  const profiles = Object.keys(config.profiles).sort(); let progress = true;
  while (headroom > 0 && launchBudget > 0 && progress) {
    progress = false;
    for (const profile of profiles) {
      if (!headroom || !launchBudget) break;
      const p = config.profiles[profile]; const count = state.nodes.filter((n) => n.profile === profile && !(n.phase === 'deleted' && n.deleteConfirmed && n.holdUnits === 0)).length;
      const busy = state.nodes.filter((n) => n.profile === profile && n.assignment === 'owned').length;
      const desired = Math.min(p.max, Math.max(p.min, (pending[profile] ?? 0) + busy));
      if (!imageEligible(p.image) || count >= desired || perNodeUnits == null || budget.remainingUnits == null || state.reservedUnits + perNodeUnits > budget.remainingUnits) continue;
      const node: FleetNode = { reservation: `scale-${++state.sequence}`, profile, generation: 1, phase: 'reserved', createdAt: now, bootStartedAt: now,
        lastHeartbeat: null, idleSince: null, registered: false, bootVerified: false, eligibilityRemoved: false,
        assignment: 'none', providerId: null, runnerId: null, deleteConfirmed: false, jobStartedAt: null, holdUnits: perNodeUnits, observedImage: null };
      state.nodes.push(node); state.reservedUnits += perNodeUnits; state.starts.push(now); state.lastScaleAt = now;
      add(node, 'create'); headroom--; launchBudget--; progress = true;
    }
  }
  const capacity = (phase: Phase) => fresh ? state.nodes.filter((n) => n.phase === phase).length : null;
  state.pending = [...new Map([...state.pending, ...operations].map((op) => [op.key, op])).values()].filter((op) => operationAllowed(state, op, state.revision));
  return { expectedRevision: previous.revision, state, operations: state.pending, reasons: [...new Set(reasons)], publicStatus: {
    inventory: fresh ? 'recorded' : 'unavailable', healthy: fresh ? state.nodes.filter((n) => n.phase === 'ready' && n.bootVerified && n.registered && n.lastHeartbeat != null && now - n.lastHeartbeat <= config.heartbeatMs
      && !!config.profiles[n.profile] && imageMatches(config.profiles[n.profile].image, n.observedImage ?? undefined)).length : null,
    busy: fresh ? state.nodes.filter((n) => n.jobStartedAt != null).length : null, draining: capacity('draining'), offline: capacity('uncertain'),
    booting: fresh ? state.nodes.filter((n) => n.phase === 'booting' || n.phase === 'reserved').length : null,
    retained_termination_reservations: state.nodes.filter((n) => n.phase === 'deleted' && n.holdUnits > 0).length,
    unregistered: fresh ? state.nodes.filter((n) => n.phase !== 'deleted' && !n.registered).length : null, pending_requests: demand.reduce((sum, d) => sum + d.queued, 0),
    oldest_wait_ms: demand.length ? Math.max(...demand.filter((d) => d.queued > 0).map((d) => Math.max(0, now - d.oldestAt)), 0) : null,
    missed_deadlines: missedDeadlines,
    retry_count: state.retryCount, scale_events: state.sequence, approved_budget_state: !budget.approved || !budget.meterVerified || budget.expiresAt == null || budget.remainingUnits == null ? 'not_verified' : now >= budget.expiresAt ? 'expired' : state.reservedUnits >= budget.remainingUnits ? 'exhausted' : 'approved',
  } };
}

export function commitFleet(current: FleetState, proposal: ScaleProposal): FleetState | null {
  if (current.revision !== proposal.expectedRevision || proposal.state.revision !== current.revision + 1) return null;
  return structuredClone(proposal.state);
}

/** Bounded event receipt handling; terminal nodes never resurrect after duplicate/late boot events. */
export function recordFleetEvent(previous: FleetState, event: { id: string; reservation: string; generation: number; kind: 'created' | 'ready' | 'heartbeat' | 'drained' | 'unregistered' | 'deleted' | 'uncertain' | 'reconciled' | 'job-started' | 'job-finished' | 'meter-settled'; at: number; providerId?: string; runnerId?: number; bootVerified?: boolean; observedImage?: ImageProfile; registrationVerified?: boolean; online?: boolean; providerVerified?: boolean; eligibilityRemoved?: boolean; absent?: boolean; assignment?: FleetNode['assignment'] }, config: ScaleConfig): FleetState {
  if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(event.id) || !integer(event.at) || !integer(event.generation, 1)) throw Error('invalid_event');
  if (previous.recentEvents.includes(event.id)) return previous;
  const state = structuredClone(previous); const node = state.nodes.find((n) => n.reservation === event.reservation);
  if (!node || node.generation !== event.generation || event.at < (node.lastHeartbeat ?? node.createdAt)) return previous;
  if (node.phase === 'deleted') {
    if (event.kind !== 'meter-settled' || !config.budget.meterVerified || !node.deleteConfirmed || event.at - (node.lastHeartbeat ?? event.at) < config.budget.billingLagMs) return previous;
    state.reservedUnits = Math.max(0, state.reservedUnits - node.holdUnits); node.holdUnits = 0;
    state.retryCount = 0; state.revision++; state.recentEvents = [...state.recentEvents.slice(-255), event.id]; return state;
  }
  if (event.providerId && state.nodes.some((other) => other !== node && other.providerId === event.providerId)) return previous;
  if (event.runnerId != null && state.nodes.some((other) => other !== node && other.runnerId === event.runnerId)) return previous;
  if (event.kind === 'created' && node.phase === 'reserved' && event.providerId) { node.providerId = event.providerId; node.phase = 'booting'; }
  else if (event.kind === 'reconciled' && node.phase === 'uncertain' && event.absent === true && event.providerVerified === true
      && event.registrationVerified === true && event.assignment === 'none' && (node.runnerId === null ? event.runnerId == null : event.runnerId === node.runnerId)
      && (node.providerId === null ? event.providerId == null : event.providerId === node.providerId)) {
    node.phase = 'deleted'; node.deleteConfirmed = true; node.registered = false; node.runnerId = null;
    node.eligibilityRemoved = true; node.assignment = 'none'; node.jobStartedAt = null;
  }
  else if (event.kind === 'reconciled' && event.absent !== true && node.phase === 'uncertain' && event.providerVerified === true && event.registrationVerified === true && event.providerId && event.assignment === 'none') {
    node.generation++; node.providerId = event.providerId; node.phase = 'booting'; node.registered = false; node.runnerId = null; node.assignment = 'none'; node.jobStartedAt = null;
    node.bootStartedAt = event.at; node.bootVerified = false; node.observedImage = null; node.eligibilityRemoved = false;
  }
  else if (event.kind === 'ready' && (node.phase === 'booting' || (node.phase === 'ready' && !node.registered)) && event.bootVerified === true && integer(event.runnerId ?? 0, 1)
      && event.registrationVerified === true && event.online === true && !!config.profiles[node.profile] && imageMatches(config.profiles[node.profile].image, event.observedImage)) {
    node.bootVerified = true; node.registered = true; node.runnerId = event.runnerId!; node.phase = 'ready'; node.idleSince = event.at; node.lastHeartbeat = event.at; node.observedImage = structuredClone(event.observedImage!);
  } else if (event.kind === 'job-started' && ['ready', 'draining', 'stopping'].includes(node.phase) && node.runnerId != null && event.runnerId === node.runnerId) {
    node.phase = node.phase === 'ready' ? 'busy' : 'draining';
    node.assignment = event.assignment === 'none' ? 'unknown' : event.assignment ?? 'unknown'; node.jobStartedAt = event.at; node.idleSince = null;
  } else if (event.kind === 'job-finished' && ['busy', 'draining'].includes(node.phase) && event.runnerId === node.runnerId) {
    // One-job machines drain; completion is not proof that GitHub removed the registration.
    node.assignment = 'none'; node.jobStartedAt = null; node.idleSince = event.at; node.phase = 'draining';
  } else if (event.kind === 'heartbeat' && ['ready', 'busy', 'draining'].includes(node.phase) && node.registered
      && event.runnerId === node.runnerId && event.registrationVerified === true && event.online === true) { node.lastHeartbeat = event.at; }
  else if (event.kind === 'drained' && node.phase === 'draining' && event.eligibilityRemoved === true) { node.eligibilityRemoved = true; node.assignment = event.assignment ?? 'unknown'; if (node.assignment === 'none') node.jobStartedAt = null; }
  else if (event.kind === 'unregistered' && node.phase === 'draining' && node.eligibilityRemoved && node.assignment === 'none' && event.registrationVerified === true && event.runnerId === node.runnerId) { node.registered = false; }
  else if (event.kind === 'deleted' && event.providerVerified === true && node.providerId !== null && event.providerId === node.providerId && node.phase === 'stopping' && node.eligibilityRemoved && !node.registered && node.assignment === 'none') { node.phase = 'deleted'; node.deleteConfirmed = true; node.registered = false; node.runnerId = null; node.lastHeartbeat = event.at; }
  else if (event.kind === 'uncertain') node.phase = 'uncertain';
  else return previous;
  node.lastHeartbeat = event.at;
  if (event.kind !== 'uncertain' && event.kind !== 'heartbeat') state.retryCount = 0;
  state.revision++; state.recentEvents = [...state.recentEvents.slice(-255), event.id];
  state.pending = state.pending.filter((op) => operationAllowed(state, op, state.revision)); return state;
}

export function retryScale(state: FleetState, config: ScaleConfig, now: number, entropy: number): { retryAt: number | null; state: FleetState } {
  if (!integer(now) || !Number.isFinite(entropy) || entropy < 0 || entropy > 1) throw Error('invalid_retry');
  if (state.retryCount >= config.maxRetries) return { retryAt: null, state };
  const next = structuredClone(state); next.retryCount++; next.revision++;
  return { retryAt: now + Math.min(60_000, 1000 * 2 ** state.retryCount) + Math.floor(entropy * 1000), state: next };
}

/** Recheck the persisted revision and node fence immediately before an effect. */
export function operationAllowed(state: FleetState, operation: ScaleOperation, committedRevision: number): boolean {
  if (state.revision !== committedRevision) return false;
  const node = state.nodes.find((n) => n.reservation === operation.reservation);
  if (!node || node.generation !== operation.generation || node.profile !== operation.profile
      || operation.key !== `${node.reservation}:${node.generation}:${operation.kind}`) return false;
  if (operation.kind === 'create') return node.phase === 'reserved' && node.providerId === null;
  if (operation.kind === 'inspect') return node.phase === 'uncertain';
  if (operation.kind === 'remove-eligibility') return node.phase === 'draining' && !node.eligibilityRemoved;
  if (operation.kind === 'unregister') return node.providerId !== null && node.phase === 'draining' && node.eligibilityRemoved && node.assignment === 'none' && node.jobStartedAt === null && node.registered;
  return operation.kind === 'stop-delete' && node.providerId !== null && node.phase === 'stopping' && node.eligibilityRemoved && !node.registered && node.assignment === 'none' && node.jobStartedAt === null;
}
