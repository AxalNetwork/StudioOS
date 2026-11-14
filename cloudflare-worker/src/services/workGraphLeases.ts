/**
 * D5581 part 2 (#5581, WorkGraph under the #5577 epic) — short, renewable WorkGraph leases with a fencing token, the
 * service every caller uses: it checks the `WORK_GRAPH_LEASES` flag and the caller's tenant, resolves the one
 * `WorkGraphLease` Durable Object of the asset, writes the audit trail (`work_graph_lease_events`) and counts what
 * each call cost. Decision: `documentation/architecture/decisions/D5581-p2.md`.
 *
 * A LEASE IS COORDINATION, NEVER AUTHORIZATION. Holding a lease says only "nobody else is working on this unit
 * right now"; it lets nobody edit anything. Acquiring one takes no edit capability, and `assertFence` (the check a
 * write path makes before it lands) refuses unless the caller ALSO presents a capability its own authorization
 * check produced for the same scope. Optimistic concurrency (part 1's compare-and-swap head) stays the default and
 * the only thing that keeps a write correct; a lease only saves wasted work.
 *
 * Pure parts (the canonical key, unit overlap and the state transition `changeLeases`) live here so the Durable
 * Object and the tests share one definition. The Durable Object is `durable-objects/work-graph-lease.ts`.
 */
import type { Env } from '../types';
import type { Scope } from './workGraphContracts';

// ── the shapes ───────────────────────────────────────────────────────────────

export const UNIT_KINDS = ['whole', 'section', 'segment'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];
/** What a lease covers in one asset. A segment may name the section it sits in, so the two conflict. */
export interface LeaseUnit { kind: UnitKind; id: string; sectionId?: string | null }
export interface LeaseResource { scope: Scope; assetId: string; unit: LeaseUnit }
/** Who holds a lease: ids only, never a name or an email. */
export type LeaseHolder = { actorKind: 'person'; userId: number } | { actorKind: 'agent'; agentRunId: string };

export interface Lease { unit: LeaseUnit; holder: LeaseHolder; fence: number; expiresAt: number }
/** What the Durable Object keeps in storage, under one key, written whole. */
export interface LeaseState {
  v: 1;
  /** The canonical key this object answers for; bound on its first call and never changed. */
  key: string | null;
  /** The last fence issued for this asset. Only ever grows; it is never reset by expiry, release or restart. */
  fence: number;
  leases: Lease[];
  /** Leases the alarm expired since the last call; the next call hands them to the service to audit. */
  expired: Lease[];
}

export const LEASE_TTL_MIN_MS = 5_000;
export const LEASE_TTL_MAX_MS = 5 * 60_000;
export const LEASE_STATE_KEY = 'lease-state';
export const LEASE_FLAG_ON = 'on';

export type RefusalCode =
  | 'flag_off' | 'no_binding' | 'wrong_tenant' | 'invalid_request' | 'invalid_ttl'
  | 'not_holder' | 'expired' | 'unknown_fence' | 'stale_fence' | 'no_capability';

export const emptyLeaseState = (): LeaseState => ({ v: 1, key: null, fence: 0, leases: [], expired: [] });

// ── validation and the key ───────────────────────────────────────────────────

const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const posInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

export function validScope(s: unknown): s is Scope {
  const v = s as Scope;
  return !!v && posInt(v.tenantId) && posInt(v.companyId) && (v.projectId === null || posInt(v.projectId));
}
export function validUnit(u: unknown): u is LeaseUnit {
  const v = u as LeaseUnit;
  if (!v || !UNIT_KINDS.includes(v.kind) || typeof v.id !== 'string' || !ID.test(v.id)) return false;
  if (v.sectionId !== undefined && v.sectionId !== null && (v.kind !== 'segment' || typeof v.sectionId !== 'string' || !ID.test(v.sectionId))) return false;
  return true;
}
export function validHolder(h: unknown): h is LeaseHolder {
  const v = h as any;
  if (v?.actorKind === 'person') return posInt(v.userId) && v.agentRunId === undefined;
  if (v?.actorKind === 'agent') return typeof v.agentRunId === 'string' && ID.test(v.agentRunId) && v.userId === undefined;
  return false;
}
export const validAssetId = (a: unknown): a is string => typeof a === 'string' && ID.test(a);

/**
 * The canonical name of an asset's lease object: tenant, company and asset, nothing else. `idFromName` of this
 * string is the object's id, so one asset has exactly one object, and the object refuses a request whose own key
 * differs from the key it was bound to (a request routed with another tenant's key).
 */
export function leaseKey(scope: Pick<Scope, 'tenantId' | 'companyId'>, assetId: string): string {
  return `wgl:v1:t${scope.tenantId}:c${scope.companyId}:a${assetId}`;
}

/** Whether two units of the same asset conflict. `whole` covers everything; a section covers its own segments. */
export function unitsOverlap(a: LeaseUnit, b: LeaseUnit): boolean {
  if (a.kind === 'whole' || b.kind === 'whole') return true;
  if (a.kind === b.kind) return a.id === b.id;
  const [section, segment] = a.kind === 'section' ? [a, b] : [b, a];
  return !!segment.sectionId && segment.sectionId === section.id;
}

const sameUnit = (a: LeaseUnit, b: LeaseUnit) => a.kind === b.kind && a.id === b.id && (a.sectionId ?? null) === (b.sectionId ?? null);
export function sameHolder(a: LeaseHolder, b: LeaseHolder): boolean {
  if (a.actorKind === 'person' && b.actorKind === 'person') return a.userId === b.userId;
  if (a.actorKind === 'agent' && b.actorKind === 'agent') return a.agentRunId === b.agentRunId;
  return false;
}

// ── the transition (pure) ────────────────────────────────────────────────────

export type LeaseOp =
  | { op: 'acquire'; unit: LeaseUnit; holder: LeaseHolder; ttlMs: number }
  | { op: 'renew'; fence: number; holder: LeaseHolder; ttlMs: number }
  | { op: 'release'; fence: number; holder: LeaseHolder }
  | { op: 'check'; unit: LeaseUnit; fence: number; holder: LeaseHolder };

export type LeaseOutcome =
  | { status: 'granted'; fence: number; expiresAt: number }
  | { status: 'renewed'; fence: number; expiresAt: number }
  | { status: 'released'; fence: number }
  | { status: 'valid'; fence: number; expiresAt: number }
  | { status: 'busy'; heldBy: LeaseHolder; unit: LeaseUnit; expiresAt: number }
  | { status: 'refused'; code: RefusalCode; currentFence?: number };

/** Move expired leases out of `leases`. Expiry is checked lazily here on every call and by the object's alarm. */
export function expireLeases(state: LeaseState, now: number): { state: LeaseState; expired: Lease[] } {
  const expired = state.leases.filter((l) => l.expiresAt <= now);
  if (!expired.length) return { state, expired };
  return { state: { ...state, leases: state.leases.filter((l) => l.expiresAt > now) }, expired };
}

/**
 * Apply one lease operation at `now`. Returns the next state (written whole by the caller BEFORE it answers) and the
 * outcome. Pure: the same inputs give the same answer.
 */
export function changeLeases(prev: LeaseState, input: LeaseOp, now: number): { state: LeaseState; outcome: LeaseOutcome; expired: Lease[]; changed: boolean } {
  const { state, expired } = expireLeases(prev, now);
  const changed = expired.length > 0;
  const refuse = (code: RefusalCode, currentFence?: number) => ({ state, outcome: { status: 'refused', code, ...(currentFence === undefined ? {} : { currentFence }) } as LeaseOutcome, expired, changed });
  if ('ttlMs' in input && (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < LEASE_TTL_MIN_MS || input.ttlMs > LEASE_TTL_MAX_MS)) return refuse('invalid_ttl');
  if (!validHolder(input.holder)) return refuse('invalid_request');

  if (input.op === 'acquire') {
    if (!validUnit(input.unit)) return refuse('invalid_request');
    const clash = state.leases.find((l) => unitsOverlap(l.unit, input.unit));
    if (clash) return { state, outcome: { status: 'busy', heldBy: clash.holder, unit: clash.unit, expiresAt: clash.expiresAt }, expired, changed };
    if (!Number.isSafeInteger(state.fence + 1)) throw new Error('fencing counter exhausted');
    const lease: Lease = { unit: input.unit, holder: input.holder, fence: state.fence + 1, expiresAt: now + input.ttlMs };
    return { state: { ...state, fence: lease.fence, leases: [...state.leases, lease] }, outcome: { status: 'granted', fence: lease.fence, expiresAt: lease.expiresAt }, expired, changed: true };
  }

  if (!posInt(input.fence)) return refuse('invalid_request');
  const lease = state.leases.find((l) => l.fence === input.fence);
  if (!lease) {
    // Issued once and gone (expired or released), or never issued.
    return refuse(input.fence <= state.fence ? (input.op === 'check' ? 'stale_fence' : 'expired') : 'unknown_fence');
  }
  if (!sameHolder(lease.holder, input.holder)) return refuse('not_holder');

  if (input.op === 'renew') {
    const next: Lease = { ...lease, expiresAt: now + input.ttlMs };
    return { state: { ...state, leases: state.leases.map((l) => (l === lease ? next : l)) }, outcome: { status: 'renewed', fence: lease.fence, expiresAt: next.expiresAt }, expired, changed: true };
  }
  if (input.op === 'release') {
    return { state: { ...state, leases: state.leases.filter((l) => l !== lease) }, outcome: { status: 'released', fence: lease.fence }, expired, changed: true };
  }
  // check: the fence must be the live lease on exactly this unit.
  if (!validUnit(input.unit) || !sameUnit(lease.unit, input.unit)) return refuse('stale_fence', lease.fence);
  return { state, outcome: { status: 'valid', fence: lease.fence, expiresAt: lease.expiresAt }, expired, changed };
}

/** Read whatever storage held, defensively: an unreadable shape is a fresh state, but its fence is kept if sane. */
export function readLeaseState(raw: unknown): LeaseState {
  const v = raw as LeaseState | undefined;
  if (!v || v.v !== 1 || !Array.isArray(v.leases)) {
    const fence = Number.isSafeInteger((v as any)?.fence) && (v as any).fence > 0 ? (v as any).fence : 0;
    return { ...emptyLeaseState(), fence };
  }
  return { v: 1, key: typeof v.key === 'string' ? v.key : null, fence: Number.isSafeInteger(v.fence) && v.fence > 0 ? v.fence : 0, leases: v.leases, expired: Array.isArray(v.expired) ? v.expired : [] };
}

// ── the wire between the service and the object ─────────────────────────────

/** What the object answers to every call. `cost` counts its own storage work. */
export interface LeaseReply {
  outcome: LeaseOutcome;
  /** Leases found expired during this call or by the alarm since the last one, for the audit. */
  expired: Lease[];
  cost: { storageReads: number; storageWrites: number; alarmWrites: number };
}

export interface LeaseCost { doCalls: number; storageReads: number; storageWrites: number; alarmWrites: number; d1Statements: number }
export type LeaseResult = LeaseOutcome & {
  /** Always false: a lease never grants edit authorization (D5581 part 2). */
  authorizes: false;
  /** Whether the audit rows for this call were written. A lease is not undone when its audit fails. */
  audited: boolean;
  cost: LeaseCost;
};

/**
 * The proof a write path must bring besides its fence: the result of its OWN authorization check (role, project
 * access, an agent's grant) for this scope. The lease service never produces one.
 */
export interface WriteCapability { checked: true; scope: Scope; holder: LeaseHolder }

// ── the service ──────────────────────────────────────────────────────────────

export const leasesOn = (env: Pick<Env, 'WORK_GRAPH_LEASES'>): boolean => env.WORK_GRAPH_LEASES === LEASE_FLAG_ON;

const sameTenant = (a: Scope, b: Scope) => a.tenantId === b.tenantId && a.companyId === b.companyId
  && (a.projectId === null || a.projectId === b.projectId);

type Caller = { scope: Scope };

const zeroCost = (): LeaseCost => ({ doCalls: 0, storageReads: 0, storageWrites: 0, alarmWrites: 0, d1Statements: 0 });

type AuditRow = { action: 'acquire' | 'renew' | 'release' | 'expire' | 'refuse' | 'busy' | 'check'; unit: LeaseUnit | null; holder: LeaseHolder | null; fence: number | null; expiresAt: number | null; code: string | null };

async function audit(env: Env, resource: Pick<LeaseResource, 'scope' | 'assetId'>, rows: AuditRow[], cost: LeaseCost): Promise<boolean> {
  if (!rows.length) return true;
  const db = (env as any).DB as D1Database | undefined;
  if (!db) return false;
  const sql = `INSERT INTO work_graph_lease_events
    (tenant_id, company_id, project_id, asset_id, unit_kind, unit_id, unit_section_id, action, fence, actor_kind, actor_user_id, agent_run_id, expires_at_ms, refusal_code, do_calls, storage_reads, storage_writes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  // A malformed holder or unit is recorded as absent, never as a half-filled id.
  const clean = rows.map((r) => ({ ...r, holder: validHolder(r.holder) ? r.holder : null, unit: validUnit(r.unit) ? r.unit : null }));
  const stmts = clean.map((r) => db.prepare(sql).bind(
    resource.scope.tenantId, resource.scope.companyId, resource.scope.projectId, resource.assetId,
    r.unit?.kind ?? null, r.unit?.id ?? null, r.unit?.sectionId ?? null, r.action, r.fence,
    r.holder?.actorKind ?? null, r.holder?.actorKind === 'person' ? r.holder.userId : null, r.holder?.actorKind === 'agent' ? r.holder.agentRunId : null,
    r.expiresAt, r.code, cost.doCalls, cost.storageReads, cost.storageWrites,
  ));
  try {
    await db.batch(stmts);
    cost.d1Statements += stmts.length;
    return true;
  } catch {
    return false;
  }
}

function outcomeRow(op: LeaseOp, outcome: LeaseOutcome, unit: LeaseUnit | null): AuditRow {
  const holder = op.holder;
  switch (outcome.status) {
    case 'granted': return { action: 'acquire', unit, holder, fence: outcome.fence, expiresAt: outcome.expiresAt, code: null };
    case 'renewed': return { action: 'renew', unit, holder, fence: outcome.fence, expiresAt: outcome.expiresAt, code: null };
    case 'released': return { action: 'release', unit, holder, fence: outcome.fence, expiresAt: null, code: null };
    case 'valid': return { action: 'check', unit, holder, fence: outcome.fence, expiresAt: outcome.expiresAt, code: null };
    case 'busy': return { action: 'busy', unit, holder, fence: null, expiresAt: outcome.expiresAt, code: 'busy' };
    case 'refused': return { action: 'refuse', unit, holder, fence: 'fence' in op ? op.fence : null, expiresAt: null, code: outcome.code };
  }
}

/**
 * One lease call: flag, tenant, binding, the object, the audit. Every refusal is decided before the object is
 * reached where it can be, and every outcome (refusals included) is audited.
 */
async function call(env: Env, caller: Caller, resource: Pick<LeaseResource, 'scope' | 'assetId'> & { unit?: LeaseUnit }, op: LeaseOp, refusedBefore: RefusalCode | null = null): Promise<LeaseResult> {
  const cost = zeroCost();
  const unit = resource.unit ?? ('unit' in op ? op.unit : null);
  const finish = async (outcome: LeaseOutcome, expired: Lease[] = [], auditable = true): Promise<LeaseResult> => {
    const rows = [...expired.map((l): AuditRow => ({ action: 'expire', unit: l.unit, holder: l.holder, fence: l.fence, expiresAt: l.expiresAt, code: null })), outcomeRow(op, outcome, unit)];
    const audited = auditable ? await audit(env, resource, rows, cost) : false;
    return { ...outcome, authorizes: false, audited, cost };
  };
  const refuse = (code: RefusalCode, auditable = true) => finish({ status: 'refused', code }, [], auditable);

  // A malformed scope or asset cannot be audited against a tenant; it is refused without a row.
  if (!validScope(resource.scope) || !validAssetId(resource.assetId) || !validScope(caller?.scope)) return refuse('invalid_request', false);
  if (!leasesOn(env)) return refuse('flag_off');
  if (!sameTenant(caller.scope, resource.scope)) return refuse('wrong_tenant');
  // A refusal the caller decided (a write path with no capability) is audited without reaching the object.
  if (refusedBefore) return refuse(refusedBefore);
  const ns = env.WORK_GRAPH_LEASE;
  if (!ns) return refuse('no_binding');

  const key = leaseKey(resource.scope, resource.assetId);
  const stub = ns.get(ns.idFromName(key));
  cost.doCalls += 1;
  const res = await stub.fetch('https://work-graph-lease/op', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, scope: resource.scope, assetId: resource.assetId, op }),
  });
  const reply = await res.json() as LeaseReply;
  cost.storageReads += reply.cost?.storageReads ?? 0;
  cost.storageWrites += reply.cost?.storageWrites ?? 0;
  cost.alarmWrites += reply.cost?.alarmWrites ?? 0;
  return finish(reply.outcome, reply.expired ?? []);
}

/** Take a lease on one unit of an asset. Busy names the holder (ids only) and when its lease ends. Takes no capability. */
export function acquireLease(env: Env, caller: Caller, resource: LeaseResource, holder: LeaseHolder, ttlMs: number): Promise<LeaseResult> {
  return call(env, caller, resource, { op: 'acquire', unit: resource.unit, holder, ttlMs });
}

/** Extend a lease. Only its holder, only before it expires. */
export function renewLease(env: Env, caller: Caller, resource: LeaseResource, fence: number, holder: LeaseHolder, ttlMs: number): Promise<LeaseResult> {
  return call(env, caller, resource, { op: 'renew', fence, holder, ttlMs });
}

/** Give a lease up. Only its holder. The fence counter is kept: the next lease gets a higher fence. */
export function releaseLease(env: Env, caller: Caller, resource: LeaseResource, fence: number, holder: LeaseHolder): Promise<LeaseResult> {
  return call(env, caller, resource, { op: 'release', fence, holder });
}

/**
 * The check a write path makes just before it lands (part 1's head swap may call it later, D5581-p2 §5): the fence
 * must be the live lease on exactly this unit, held by this holder, AND the caller must bring a capability from its
 * own authorization check for the same scope and holder. Neither alone is enough. `ok` true never means "allowed to
 * edit" by itself: the capability did that; the fence only says the caller still holds the unit.
 */
export async function assertFence(env: Env, args: { caller: Caller; resource: LeaseResource; fence: number; holder: LeaseHolder; capability: WriteCapability | null | undefined }): Promise<LeaseResult & { ok: boolean }> {
  const cap = args.capability;
  const capable = !!cap && cap.checked === true && validScope(cap.scope) && validHolder(cap.holder)
    && sameTenant(cap.scope, args.resource.scope) && sameHolder(cap.holder, args.holder);
  const r = await call(env, args.caller, args.resource, { op: 'check', unit: args.resource.unit, fence: args.fence, holder: args.holder }, capable ? null : 'no_capability');
  return { ...r, ok: r.status === 'valid' };
}
