/**
 * D5586 (#5586 part 1): fair swarm admission per venture, workload modality, active content revision, render budget,
 * allowed provider and model and storage quota, composed on #5570's admission control. Preview-only and unmounted:
 * no route, cron, binding or flag reads it.
 *
 * It keeps no second ledger. Its tickets live in the same `AdmissionStore` state as #5570's slots (an extra `swarm`
 * key, so one Durable Object transaction covers both), a container-backed ticket (code, video render) takes #5570's
 * compute lease under the ticket's uid, and its bill is that lease's one settlement. A registered agent holds nothing:
 * capacity is held by a ticket while it runs, never by an agent, so no container is pinned to an idle agent.
 */
import { PROVIDERS, workspaceReference, workspaceRefusal, type Provider, type WorkspaceRefusal, type WorkspaceResult } from './workspaceSpec';
import type { AdmissionState, AdmissionStore, createAdmissionControl } from './workspaceAdmission';

export const MODALITIES = ['code', 'document', 'brand_image', 'video_render', 'final_publication'] as const;
export type Modality = typeof MODALITIES[number];
/**
 * The kinds of work the issue tells apart. A registered agent is a record and holds no capacity; a queued task is a
 * waiting ticket; the other four are what an admitted ticket of each modality is.
 */
export const WORK_CLASSES = ['registered_agent', 'queued_task', 'concurrent_job', 'iterative_generation', 'expensive_render', 'final_publication'] as const;
export type WorkClass = typeof WORK_CLASSES[number];
export const MODALITY_CLASS: Readonly<Record<Modality, WorkClass>> = Object.freeze({
  code: 'concurrent_job', document: 'iterative_generation', brand_image: 'iterative_generation',
  video_render: 'expensive_render', final_publication: 'final_publication',
});
/**
 * `lease`: a container exists only while #5570's compute lease is held. `inline`: a model call under the existing AI
 * holds, no container. `serial`: at most one live ticket per asset (a publication).
 */
export type Lane = 'lease' | 'inline' | 'serial';
export const MODALITY_LANE: Readonly<Record<Modality, Lane>> = Object.freeze({
  code: 'lease', document: 'inline', brand_image: 'inline', video_render: 'lease', final_publication: 'serial',
});

export type ModalityPolicy = { max_concurrent: number; providers: readonly Provider[]; models: readonly string[] };
/** One venture's standing policy, read from records the broker owns, never from the request. */
export type VenturePolicy = {
  tenant_id: number; company_id: number; halted: boolean;
  max_concurrent: number; max_waiting: number;
  /** A modality with no entry admits nothing. */
  modalities: Readonly<Partial<Record<Modality, ModalityPolicy>>>;
  /** The venture's render budget in micro-USD; null when it was not read, which refuses rather than assumes room. */
  render_budget_microusd: number | null;
  /** Bytes the venture may hold; null when unread. */
  storage_quota_bytes: number | null;
};
/** What the caller read just before asking. `undefined` head is "not read"; null is "the asset has no head yet". */
export type SwarmFacts = { agent: 'active' | 'revoked' | 'unknown'; head_revision_uid: string | null | undefined; storage_used_bytes: number | null };
export type SwarmRequest = {
  ticket_uid: string; tenant_id: number; company_id: number; team_id: number | null; agent_id: number;
  modality: Modality; provider: Provider; model: string; region: string;
  asset_uid: string; base_revision_uid: string | null;
  /** The quote for this ticket, or `unavailable`, which reserves `ceiling_microusd` instead, never 0. */
  reserve_microusd: number | 'unavailable'; ceiling_microusd: number; storage_bytes: number;
};
export type TicketState = 'waiting' | 'admitted' | 'settled' | 'withdrawn';
export type SwarmTicket = SwarmRequest & {
  state: TicketState; sequence: number; enqueued_at: number; admitted_at: number | null; settled_at: number | null;
  reserve_held_microusd: number; reserve_basis: 'quote' | 'ceiling';
  charged_microusd: number | null; measured: boolean | null; wait_reason: string | null; end_code: string | null;
};
export type SwarmAuditAction = 'request' | 'promote' | 'settle' | 'withdraw' | 'revoke';
/** One audit entry, written in the same transaction as the change it records, refusals included. */
export type SwarmAudit = {
  seq: number; at: number; ticket_uid: string; tenant_id: number; company_id: number;
  action: SwarmAuditAction; outcome: 'applied' | 'queued' | 'refused'; code: string | null; charged_microusd?: number; measured?: boolean;
};
export type SwarmState = { tickets: Record<string, SwarmTicket>; next_sequence: number; last_now: number; audit: SwarmAudit[]; audit_seq: number; audit_dropped: number };
export type SwarmRefusal = WorkspaceRefusal & { reasons: string[] };
export type SwarmResult<T> = { ok: true; value: T } | SwarmRefusal;
/** Entries kept in state; older ones are counted in `audit_dropped`, never silently lost. Part 2 moves them to D1. */
export const SWARM_AUDIT_MAX = 2000;
const MODEL = /^[@A-Za-z0-9][A-Za-z0-9_.:/@-]{0,119}$/;
const REGION = /^[a-z][a-z0-9-]{1,31}$/;
const ASSET = /^[A-Za-z0-9_.:-]{1,80}$/;

export const emptySwarmState = (): SwarmState => ({ tickets: {}, next_sequence: 1, last_now: 0, audit: [], audit_seq: 0, audit_dropped: 0 });
/** The swarm's part of #5570's admission state; created on first use, persisted by the same transaction. */
export function swarmOf(state: AdmissionState): SwarmState {
  const s = state as AdmissionState & { swarm?: SwarmState };
  return (s.swarm ??= emptySwarmState());
}
export const ventureKey = (t: { tenant_id: number; company_id: number }) => `t${t.tenant_id}:c${t.company_id}`;
const whole = (n: unknown, min = 0) => Number.isSafeInteger(n) && (n as number) >= min;
const live = (t: SwarmTicket) => t.state === 'admitted';
const refuse = (code: string, status: WorkspaceRefusal['status'] = 409, reasons: string[] = [code]): SwarmRefusal => ({ ...workspaceRefusal(code, status), reasons });

/** What a venture has committed of its budget: live reserves plus settled charges. Waiting tickets commit nothing. */
export function budgetCommitted(sw: SwarmState, key: string): number {
  return Object.values(sw.tickets).filter(t => ventureKey(t) === key)
    .reduce((sum, t) => sum + (t.state === 'admitted' ? t.reserve_held_microusd : t.state === 'settled' ? t.charged_microusd ?? 0 : 0), 0);
}
/** Bytes a venture's live tickets will write. */
export function storageReserved(sw: SwarmState, key: string): number {
  return Object.values(sw.tickets).filter(t => ventureKey(t) === key && live(t)).reduce((sum, t) => sum + t.storage_bytes, 0);
}

function validRequest(r: SwarmRequest): boolean {
  return Boolean(r) && workspaceReference(r.ticket_uid) && whole(r.tenant_id, 1) && whole(r.company_id, 1) && whole(r.agent_id, 1)
    && (r.team_id === null || whole(r.team_id, 1)) && MODALITIES.includes(r.modality) && PROVIDERS.includes(r.provider)
    && typeof r.model === 'string' && MODEL.test(r.model) && typeof r.region === 'string' && REGION.test(r.region)
    && typeof r.asset_uid === 'string' && ASSET.test(r.asset_uid) && (r.base_revision_uid === null || (typeof r.base_revision_uid === 'string' && ASSET.test(r.base_revision_uid)))
    && (r.reserve_microusd === 'unavailable' || whole(r.reserve_microusd)) && whole(r.ceiling_microusd) && whole(r.storage_bytes)
    && (r.reserve_microusd === 'unavailable' || r.reserve_microusd <= r.ceiling_microusd);
}
const SAME_TERMS: (keyof SwarmRequest)[] = ['tenant_id', 'company_id', 'team_id', 'agent_id', 'modality', 'provider', 'model', 'region',
  'asset_uid', 'base_revision_uid', 'reserve_microusd', 'ceiling_microusd', 'storage_bytes'];

type Control = ReturnType<typeof createAdmissionControl>;

/**
 * Swarm admission over one transactional store shared with #5570's admission control `admission`. `halted` is the
 * platform kill switch: nothing is requested or promoted while it is on; settling and withdrawing still work.
 */
export function createSwarmAdmission({ store, clock, admission, halted = () => false }: {
  store: AdmissionStore; clock: () => number; admission: Control; halted?: () => boolean;
}) {
  if (!store || typeof clock !== 'function' || !admission || typeof halted !== 'function') throw new Error('Invalid swarm admission');
  const readNow = (sw: SwarmState) => {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid injected clock');
    if (now < sw.last_now) return null;
    sw.last_now = now;
    return now;
  };
  const audit = (sw: SwarmState, at: number, t: { ticket_uid: string; tenant_id: number; company_id: number }, action: SwarmAuditAction,
    outcome: SwarmAudit['outcome'], code: string | null, extra: Partial<SwarmAudit> = {}) => {
    sw.audit.push({ seq: ++sw.audit_seq, at, ticket_uid: t.ticket_uid, tenant_id: t.tenant_id, company_id: t.company_id, action, outcome, code, ...extra });
    if (sw.audit.length > SWARM_AUDIT_MAX) { sw.audit.splice(0, sw.audit.length - SWARM_AUDIT_MAX); sw.audit_dropped = sw.audit_seq - SWARM_AUDIT_MAX; }
  };
  /** Capacity reasons a ticket waits for. Empty means it fits now. */
  const capacityReasons = (sw: SwarmState, t: SwarmRequest, policy: VenturePolicy) => {
    const key = ventureKey(t), mine = Object.values(sw.tickets).filter(x => live(x) && ventureKey(x) === key);
    const reasons: string[] = [];
    if (mine.length >= policy.max_concurrent) reasons.push('venture_capacity');
    if (mine.filter(x => x.modality === t.modality).length >= (policy.modalities[t.modality]?.max_concurrent ?? 0)) reasons.push('modality_capacity');
    if (MODALITY_LANE[t.modality] === 'serial' && Object.values(sw.tickets).some(x => live(x) && x.asset_uid === t.asset_uid && x.modality === t.modality)) reasons.push('publication_in_flight');
    return reasons;
  };
  /** Budget and storage, which waiting does not clear by itself. */
  const quotaRefusal = (sw: SwarmState, t: SwarmRequest, reserve: number, policy: VenturePolicy, storageUsed: number | null): SwarmRefusal | null => {
    const key = ventureKey(t);
    if (!whole(policy.render_budget_microusd)) return refuse('budget_unverified', 503);
    if (budgetCommitted(sw, key) + reserve > (policy.render_budget_microusd as number)) return refuse('budget_exhausted');
    if (t.storage_bytes > 0 || MODALITY_LANE[t.modality] !== 'serial') {
      if (!whole(policy.storage_quota_bytes) || !whole(storageUsed)) return refuse('storage_unverified', 503);
      if ((storageUsed as number) + storageReserved(sw, key) + t.storage_bytes > (policy.storage_quota_bytes as number)) return refuse('storage_quota_exhausted');
    }
    return null;
  };
  const admit = (t: SwarmTicket, now: number) => { t.state = 'admitted'; t.admitted_at = now; t.wait_reason = null; };
  /** A lease-lane ticket takes #5570's compute lease under its own uid; enqueue is idempotent on the same terms. */
  const enqueueLease = (t: SwarmTicket) => admission.enqueue({ run_uid: t.ticket_uid, tenant_id: t.tenant_id, agent_id: t.agent_id,
    provider: t.provider, region: t.region, compute_reserve_microusd: t.reserve_held_microusd });

  return {
    /**
     * Ask for a ticket. In order: shape, replay, kill switch, venture scope, agent, modality, provider, model, active
     * revision, budget and storage, then capacity: a ticket that fits is admitted, one held back only by capacity
     * waits, and when the venture's queue is full the refusal names every reason (`no_capacity`). A replay with the
     * same terms answers the current state and re-takes the lease, so a crash between the two transactions is safe.
     */
    async request(req: SwarmRequest, policy: VenturePolicy, facts: SwarmFacts): Promise<SwarmResult<{ state: TicketState; lane: Lane; work_class: WorkClass;
      reserve_microusd: number; reserve_basis: 'quote' | 'ceiling'; reasons: string[]; duplicate: boolean; lease: WorkspaceResult<unknown> | null }>> {
      const decided = await store.transaction(state => {
        const sw = swarmOf(state);
        if (!validRequest(req)) return refuse('invalid_swarm_request', 422);
        const prior = sw.tickets[req.ticket_uid];
        if (prior) {
          if (SAME_TERMS.some(k => prior[k] !== req[k])) return refuse('ticket_contract_changed');
          return { ok: true as const, ticket: structuredClone(prior), duplicate: true };
        }
        const now = readNow(sw);
        if (now === null) return refuse('clock_regressed', 503);
        const no = (code: string, status: WorkspaceRefusal['status'] = 409, reasons?: string[]) => { audit(sw, now, req, 'request', 'refused', code); return refuse(code, status, reasons); };
        if (halted() || !policy || policy.halted !== false) return no('swarm_halted', 503);
        if (policy.tenant_id !== req.tenant_id || policy.company_id !== req.company_id) return no('wrong_tenant', 403);
        if (facts?.agent === 'revoked') return no('agent_revoked', 403);
        if (facts?.agent !== 'active') return no('agent_unverified', 503);
        const mp = policy.modalities[req.modality];
        if (!mp || !whole(mp.max_concurrent, 1)) return no('modality_not_allowed', 422);
        if (!mp.providers.includes(req.provider)) return no('provider_not_allowed', 422);
        if (!mp.models.includes(req.model)) return no('model_not_allowed', 422);
        if (facts.head_revision_uid === undefined) return no('revision_unverified', 503);
        if (facts.head_revision_uid !== req.base_revision_uid) return no('stale_revision');
        const unknown = req.reserve_microusd === 'unavailable';
        const reserve = unknown ? req.ceiling_microusd : req.reserve_microusd as number;
        const quota = quotaRefusal(sw, req, reserve, policy, facts.storage_used_bytes);
        if (quota) return no(quota.code, quota.status);
        const reasons = capacityReasons(sw, req, policy);
        const key = ventureKey(req);
        if (reasons.length && Object.values(sw.tickets).filter(t => t.state === 'waiting' && ventureKey(t) === key).length >= policy.max_waiting) {
          return no('no_capacity', 503, [...reasons, 'venture_queue_full']);
        }
        const t: SwarmTicket = { ...req, state: 'waiting', sequence: sw.next_sequence++, enqueued_at: now, admitted_at: null, settled_at: null,
          reserve_held_microusd: reserve, reserve_basis: unknown ? 'ceiling' : 'quote', charged_microusd: null, measured: null,
          wait_reason: reasons[0] ?? null, end_code: null };
        if (!reasons.length) admit(t, now);
        sw.tickets[t.ticket_uid] = t;
        audit(sw, now, t, 'request', reasons.length ? 'queued' : 'applied', reasons[0] ?? null);
        return { ok: true as const, ticket: structuredClone(t), duplicate: false };
      });
      if (!decided.ok) return decided;
      const t = decided.ticket;
      const lease = t.state === 'admitted' && MODALITY_LANE[t.modality] === 'lease' ? await enqueueLease(t) : null;
      return { ok: true, value: { state: t.state, lane: MODALITY_LANE[t.modality], work_class: t.state === 'waiting' ? 'queued_task' : MODALITY_CLASS[t.modality],
        reserve_microusd: t.reserve_held_microusd, reserve_basis: t.reserve_basis, reasons: t.wait_reason ? [t.wait_reason] : [], duplicate: decided.duplicate, lease } };
    },

    /**
     * Admit waiting tickets that now fit, fairly: each pick goes to the venture holding the fewest live tickets, then
     * the earliest-queued ticket. Budget and storage are re-checked from `ventures`; a venture absent there admits
     * nothing. Lease-lane tickets then take their #5570 lease.
     */
    async promote(ventures: Readonly<Record<string, { policy: VenturePolicy; storage_used_bytes: number | null }>>): Promise<string[]> {
      const admitted = await store.transaction(state => {
        const sw = swarmOf(state);
        if (halted()) return [] as SwarmTicket[];
        const now = readNow(sw);
        if (now === null) return [] as SwarmTicket[];
        const out: SwarmTicket[] = [];
        const tried = new Set<string>();
        for (;;) {
          const liveBy = new Map<string, number>();
          for (const t of Object.values(sw.tickets).filter(live)) liveBy.set(ventureKey(t), (liveBy.get(ventureKey(t)) ?? 0) + 1);
          const next = Object.values(sw.tickets).filter(t => t.state === 'waiting' && !tried.has(t.ticket_uid))
            .sort((a, b) => (liveBy.get(ventureKey(a)) ?? 0) - (liveBy.get(ventureKey(b)) ?? 0) || a.sequence - b.sequence)[0];
          if (!next) break;
          tried.add(next.ticket_uid);
          const v = ventures[ventureKey(next)];
          if (!v || v.policy.halted !== false || v.policy.tenant_id !== next.tenant_id || v.policy.company_id !== next.company_id) continue;
          const reasons = capacityReasons(sw, next, v.policy);
          if (reasons.length) { next.wait_reason = reasons[0]; continue; }
          const quota = quotaRefusal(sw, next, next.reserve_held_microusd, v.policy, v.storage_used_bytes);
          if (quota) { next.wait_reason = quota.code; continue; }
          admit(next, now);
          audit(sw, now, next, 'promote', 'applied', null);
          out.push(structuredClone(next));
        }
        return out;
      });
      for (const t of admitted) if (MODALITY_LANE[t.modality] === 'lease') await enqueueLease(t);
      return admitted.map(t => t.ticket_uid);
    },

    /**
     * Settle a ticket once. A lease-lane ticket settles through #5570's `release` under `generation`, so its bill is
     * that lease's one settlement (missing metrics charge the reserve, `measured: false`); inline and serial tickets
     * do the same here. A repeat answers the first bill with `first: false`, so the caller charges its hold once.
     */
    async settle(ticketUid: string, measured: number | 'unavailable', generation?: number): Promise<SwarmResult<{ charged_microusd: number; measured: boolean; first: boolean }>> {
      const peek = await store.transaction(state => structuredClone(swarmOf(state).tickets[ticketUid] ?? null));
      if (!peek) return refuse('ticket_not_found', 403);
      let bill: { charged_microusd: number; measured: boolean } | null = null;
      if (MODALITY_LANE[peek.modality] === 'lease' && !(peek.state === 'settled')) {
        if (!Number.isSafeInteger(generation)) return refuse('lease_generation_required', 422);
        const r = await admission.release(ticketUid, generation as number, measured);
        if (!r.ok) return { ...r, reasons: [r.code] };
        bill = { charged_microusd: r.value.charged_microusd, measured: r.value.measured };
      }
      return store.transaction(state => {
        const sw = swarmOf(state);
        const t = sw.tickets[ticketUid];
        if (!t) return refuse('ticket_not_found', 403);
        if (t.state === 'settled') return { ok: true as const, value: { charged_microusd: t.charged_microusd as number, measured: t.measured as boolean, first: false } };
        if (t.state !== 'admitted') return refuse('not_admitted');
        const now = readNow(sw);
        if (now === null) return refuse('clock_regressed', 503);
        const known = whole(measured);
        const b = bill ?? { charged_microusd: known ? measured as number : t.reserve_held_microusd, measured: known };
        t.state = 'settled'; t.settled_at = now; t.charged_microusd = b.charged_microusd; t.measured = b.measured;
        audit(sw, now, t, 'settle', 'applied', null, { charged_microusd: b.charged_microusd, measured: b.measured });
        return { ok: true as const, value: { ...b, first: true } };
      });
    },

    /**
     * Withdraw a ticket of the caller's venture that never ran, with no bill: a waiting ticket, or an admitted
     * lease-lane ticket whose #5570 lease is still waiting (it is withdrawn there first, generation 0). Anything that
     * may have run must be settled instead (`settle_required`).
     */
    async withdraw(ticketUid: string, venture: { tenant_id: number; company_id: number }): Promise<SwarmResult<{ state: TicketState }>> {
      const peek = await store.transaction(state => structuredClone(swarmOf(state).tickets[ticketUid] ?? null));
      if (!peek || ventureKey(peek) !== ventureKey(venture)) return refuse('ticket_not_found', 403);
      let leaseNeverRan = false;
      if (peek.state === 'admitted' && MODALITY_LANE[peek.modality] === 'lease') {
        const r = await admission.cancel(ticketUid, 0);
        leaseNeverRan = (r.ok && r.value.state === 'withdrawn') || (!r.ok && r.code === 'lease_not_found');
      }
      return store.transaction(state => {
        const sw = swarmOf(state);
        const t = sw.tickets[ticketUid];
        if (!t) return refuse('ticket_not_found', 403);
        if (t.state === 'admitted' && !leaseNeverRan) return refuse('settle_required');
        const now = readNow(sw);
        if (now === null) return refuse('clock_regressed', 503);
        if (t.state === 'waiting' || t.state === 'admitted') { t.state = 'withdrawn'; t.end_code = 'withdrawn'; audit(sw, now, t, 'withdraw', 'applied', null); }
        return { ok: true as const, value: { state: t.state } };
      });
    },

    /**
     * An agent was revoked: its waiting tickets end `agent_revoked` with no bill, since nothing ran. Its admitted
     * tickets keep their capacity until they settle, because a revoke does not stop what is already running.
     */
    async revokeAgent(venture: { tenant_id: number; company_id: number }, agentId: number): Promise<{ withdrawn: string[]; still_running: string[] }> {
      return store.transaction(state => {
        const sw = swarmOf(state);
        const now = readNow(sw) ?? sw.last_now;
        const mine = Object.values(sw.tickets).filter(t => ventureKey(t) === ventureKey(venture) && t.agent_id === agentId);
        const withdrawn: string[] = [];
        for (const t of mine.filter(x => x.state === 'waiting')) {
          t.state = 'withdrawn'; t.end_code = 'agent_revoked'; withdrawn.push(t.ticket_uid);
          audit(sw, now, t, 'revoke', 'applied', 'agent_revoked');
        }
        return { withdrawn, still_running: mine.filter(live).map(t => t.ticket_uid) };
      });
    },

    /** A copy of the swarm state, for the capacity read model. Scope filtering is the read model's. */
    async snapshot(): Promise<SwarmState> {
      return store.transaction(state => structuredClone(swarmOf(state)));
    },
  };
}
export type SwarmAdmission = ReturnType<typeof createSwarmAdmission>;
