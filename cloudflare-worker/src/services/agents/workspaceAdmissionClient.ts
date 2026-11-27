/**
 * D5586 part 3 (#5586): the typed client of the `WorkspaceAdmission` Durable Object (bound as `WORKSPACE_ADMISSION`),
 * which hosts #5570's admission control and the audited swarm admission over one storage. Preview-only: no route, cron
 * or flag calls it yet; only its tests do.
 *
 * ONE OBJECT FOR EVERY TENANT THAT SHARES A QUOTA. Every venture's call goes to the object named
 * `WORKSPACE_ADMISSION_OBJECT`. The caps are provider and `provider:region` caps that all tenants draw on (D5570 part
 * 2: per-tenant objects would each hand out the whole quota), and the swarm audit's `seq` is unique only within one
 * coordinator (D5586-p2 §2). Today there is one pool, so there is one name; `coordinatorName` is the one place a
 * second pool would be chosen, after the audit table gains a coordinator column.
 *
 * SCOPE. Every call carries the caller's tenant and company (`Scope`). A call whose arguments name another venture is
 * refused `wrong_tenant` here, before any stub call; the object applies the same check again (`scopeRefusal`) and,
 * for calls keyed only by a uid, refuses a lease or ticket that belongs to another venture as not found.
 *
 * NEVER THROWS. With no binding the answer is `admission_unbound`; a stub that throws or answers something unreadable
 * is `admission_unavailable`. Both are refusals: nothing is assumed admitted.
 */
import type { Env } from '../../types';
import { doNamespace } from '../../util/doNamespace';
import type { Scope } from '../workGraphContracts';
import { workspaceRefusal, type WorkspaceRefusal, type WorkspaceResult } from './workspaceSpec';
import type { LeaseState } from './workspaceAdmission';
import type { RetentionResult } from './swarmRetention';
import { ventureKey, type SwarmFacts, type SwarmRequest, type SwarmResult, type SwarmState, type TicketState, type VenturePolicy, type Lane, type WorkClass } from './swarmAdmission';

/** The one coordinator's name (`idFromName`). See the header for why every venture shares it. */
export const WORKSPACE_ADMISSION_OBJECT = 'workspace-admission:shared-quota:v1';
export const coordinatorName = (_venture: Venture): string => WORKSPACE_ADMISSION_OBJECT;

export const WORKSPACE_ADMISSION_OPS = ['admission.request', 'admission.settle', 'admission.withdraw',
  'swarm.request', 'swarm.promote', 'swarm.settle', 'swarm.withdraw', 'swarm.revoke', 'swarm.snapshotFor'] as const;
export type WorkspaceAdmissionOp = typeof WORKSPACE_ADMISSION_OPS[number];
export type Venture = { tenant_id: number; company_id: number };
/** The client's own refusals, in the swarm's refusal shape (`reasons` names the code). */
export type AdmissionClientCode = 'admission_unbound' | 'admission_unavailable' | 'wrong_tenant' | 'invalid_admission_call';
export type AdmissionClientRefusal = WorkspaceRefusal & { reasons: string[] };
export type ClientResult<T> = SwarmResult<T> | AdmissionClientRefusal;
/** D5586-p4: what one retention call retired (`swarmRetention.ts`). */
export type RetentionResultValue = Extract<RetentionResult, { ok: true }>['value'];

/** What `admission.request` answers for the caller's own run: its slot after an admission pass. */
export type AdmissionSlotView = { state: LeaseState; generation: number; lease_expires_at: number | null; compute_reserve_microusd: number; duplicate: boolean };
export type AdmissionRequest = { run_uid: string; tenant_id: number; agent_id: number; provider: SwarmRequest['provider']; region: string; compute_reserve_microusd: number };
export type SwarmTicketView = { state: TicketState; lane: Lane; work_class: WorkClass; reserve_microusd: number; reserve_basis: 'quote' | 'ceiling';
  reasons: string[]; duplicate: boolean; lease: WorkspaceResult<unknown> | null };
export type Bill = { charged_microusd: number; measured: boolean; first: boolean };
export type Measured = number | 'unavailable';

export const clientRefusal = (code: AdmissionClientCode | string, status: WorkspaceRefusal['status'] = 409): AdmissionClientRefusal =>
  ({ ...workspaceRefusal(code, status), reasons: [code] });
const whole = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 1;
export const validCaller = (c: unknown): c is Scope => Boolean(c) && whole((c as Scope).tenantId) && whole((c as Scope).companyId);
const isVenture = (v: unknown): v is Venture => Boolean(v) && typeof v === 'object' && Number.isSafeInteger((v as Venture).tenant_id) && Number.isSafeInteger((v as Venture).company_id);
const mine = (caller: Scope, v: unknown) => isVenture(v) && v.tenant_id === caller.tenantId && v.company_id === caller.companyId;
const isUid = (u: unknown) => typeof u === 'string' && u.length > 0 && u.length <= 200;

/**
 * Whether `args` for `op` stay inside the caller's venture. Shared by the client (before any stub call) and the
 * object (again, on what it received). Null means the call may go on; anything keyed only by a uid is checked by the
 * object against the stored owner.
 */
export function scopeRefusal(op: string, caller: unknown, args: unknown): AdmissionClientRefusal | null {
  if (!(WORKSPACE_ADMISSION_OPS as readonly string[]).includes(op) || !validCaller(caller) || !Array.isArray(args)) return clientRefusal('invalid_admission_call', 422);
  const [a, b] = args as unknown[];
  const wrong = () => clientRefusal('wrong_tenant', 403);
  switch (op as WorkspaceAdmissionOp) {
    case 'admission.request': {
      const r = a as AdmissionRequest | undefined;
      if (!r || typeof r !== 'object') return clientRefusal('invalid_admission_call', 422);
      return r.tenant_id === caller.tenantId ? null : wrong();
    }
    case 'admission.settle': case 'admission.withdraw': case 'swarm.settle':
      return isUid(a) ? null : clientRefusal('invalid_admission_call', 422);
    case 'swarm.request': {
      if (!a || typeof a !== 'object' || !b || typeof b !== 'object') return clientRefusal('invalid_admission_call', 422);
      return mine(caller, a) && mine(caller, b) ? null : wrong();
    }
    case 'swarm.promote': {
      if (!a || typeof a !== 'object' || Array.isArray(a)) return clientRefusal('invalid_admission_call', 422);
      const own = ventureKey({ tenant_id: caller.tenantId, company_id: caller.companyId });
      return Object.entries(a as Record<string, { policy?: unknown }>).every(([k, v]) => k === own && mine(caller, v?.policy)) ? null : wrong();
    }
    case 'swarm.withdraw':
      if (!isUid(a)) return clientRefusal('invalid_admission_call', 422);
      return mine(caller, b) ? null : wrong();
    case 'swarm.revoke':
      if (!whole(b)) return clientRefusal('invalid_admission_call', 422);
      return mine(caller, a) ? null : wrong();
    case 'swarm.snapshotFor':
      return mine(caller, a) ? null : wrong();
  }
}

/** The answer is a result only when it has the result shape; anything else from the stub reads as unavailable. */
const isResult = (v: unknown): v is { ok: boolean } => Boolean(v) && typeof v === 'object' && typeof (v as { ok?: unknown }).ok === 'boolean'
  && ((v as { ok: boolean }).ok === true ? 'value' in (v as object) : typeof (v as { code?: unknown }).code === 'string');

async function call<T>(env: Pick<Env, 'WORKSPACE_ADMISSION' | 'BRANCH_DO_JURISDICTION'>, caller: Scope, op: WorkspaceAdmissionOp, args: unknown[]): Promise<ClientResult<T>> {
  const refused = scopeRefusal(op, caller, args);
  if (refused) return refused;
  if (!env?.WORKSPACE_ADMISSION) return clientRefusal('admission_unbound', 503);
  try {
    const ns = doNamespace(env, env.WORKSPACE_ADMISSION);
    const stub = ns.get(ns.idFromName(coordinatorName({ tenant_id: caller.tenantId, company_id: caller.companyId })));
    const res = await stub.fetch('https://workspace-admission/op', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op, caller: { tenantId: caller.tenantId, companyId: caller.companyId }, args }) });
    if (res.status !== 200) return clientRefusal('admission_unavailable', 503);
    const body: unknown = await res.json();
    if (!isResult(body)) return clientRefusal('admission_unavailable', 503);
    if (!body.ok) { const r = body as WorkspaceRefusal & { reasons?: unknown }; return { ...r, reasons: Array.isArray(r.reasons) ? r.reasons as string[] : [r.code] }; }
    return body as ClientResult<T>;
  } catch {
    return clientRefusal('admission_unavailable', 503);
  }
}

/**
 * The client for one caller's venture. `caller` is the authenticated scope (a route's, never a request body's); every
 * method is refused `wrong_tenant` before any stub call when its arguments name another venture.
 */
export function workspaceAdmissionClient(env: Pick<Env, 'WORKSPACE_ADMISSION' | 'BRANCH_DO_JURISDICTION'>, caller: Scope) {
  return {
    /** #5570: enqueue a run the engine admitted (keyed by its run uid), run one admission pass, answer the caller's slot. */
    admission: {
      request: (req: AdmissionRequest) => call<AdmissionSlotView>(env, caller, 'admission.request', [req]),
      /** #5570 `release`: settle the lease once; a repeat answers the first bill with `first: false`. */
      settle: (runUid: string, generation: number, measured: Measured) => call<Bill>(env, caller, 'admission.settle', [runUid, generation, measured]),
      /** #5570 `cancel`: a waiting run is withdrawn with no bill; an admitted one reconciles and keeps its slot. */
      withdraw: (runUid: string, generation: number) => call<{ state: LeaseState }>(env, caller, 'admission.withdraw', [runUid, generation]),
    },
    swarm: {
      request: (req: SwarmRequest, policy: VenturePolicy, facts: SwarmFacts) => call<SwarmTicketView>(env, caller, 'swarm.request', [req, policy, facts]),
      /** Only the caller's own venture may be in `ventures`; the answer lists the caller's tickets that were admitted. */
      promote: (ventures: Readonly<Record<string, { policy: VenturePolicy; storage_used_bytes: number | null }>>) => call<string[]>(env, caller, 'swarm.promote', [ventures]),
      settle: (ticketUid: string, measured: Measured, generation?: number) => call<Bill>(env, caller, 'swarm.settle', generation === undefined ? [ticketUid, measured] : [ticketUid, measured, generation]),
      withdraw: (ticketUid: string, venture: Venture) => call<{ state: TicketState }>(env, caller, 'swarm.withdraw', [ticketUid, venture]),
      revoke: (venture: Venture, agentId: number) => call<{ withdrawn: string[]; still_running: string[] }>(env, caller, 'swarm.revoke', [venture, agentId]),
      /** One venture's tickets and audit entries (refusals included), in the `SwarmState` shape. */
      snapshotFor: (venture: Venture) => call<SwarmState>(env, caller, 'swarm.snapshotFor', [venture]),
    },
  };
}
export type WorkspaceAdmissionClient = ReturnType<typeof workspaceAdmissionClient>;

/**
 * #5585's render check: the scope's own venture's swarm state (`{ ok: true, value: SwarmState }`), or a refusal when it
 * could not be read (`admission_unbound`, `admission_unavailable`, `invalid_admission_call`). `renderAdmissions`
 * answers `r.ok ? r.value : null`, and null is `admission_unverified`, never admitted.
 */
export async function swarmSnapshotFor(env: Pick<Env, 'WORKSPACE_ADMISSION' | 'BRANCH_DO_JURISDICTION'>, scope: Scope): Promise<ClientResult<SwarmState>> {
  if (!validCaller(scope)) return clientRefusal('invalid_admission_call', 422);
  return workspaceAdmissionClient(env, scope).swarm.snapshotFor({ tenant_id: scope.tenantId, company_id: scope.companyId });
}

/**
 * D5586 part 4: one bounded retention call on the coordinator (`swarmRetention.ts`), for a scheduler. It is
 * coordinator-wide and names no venture, so it is not a method of the venture-scoped client, and no route calls it.
 * Never throws: no binding is `admission_unbound`, anything unreadable is `admission_unavailable`.
 */
export async function runSwarmRetention(env: Pick<Env, 'WORKSPACE_ADMISSION' | 'BRANCH_DO_JURISDICTION'>): Promise<ClientResult<RetentionResultValue>> {
  if (!env?.WORKSPACE_ADMISSION) return clientRefusal('admission_unbound', 503);
  try {
    const ns = doNamespace(env, env.WORKSPACE_ADMISSION);
    const res = await ns.get(ns.idFromName(WORKSPACE_ADMISSION_OBJECT)).fetch('https://workspace-admission/retire', { method: 'POST' });
    if (res.status !== 200) return clientRefusal('admission_unavailable', 503);
    const body: unknown = await res.json();
    if (!isResult(body)) return clientRefusal('admission_unavailable', 503);
    return body as ClientResult<RetentionResultValue>;
  } catch {
    return clientRefusal('admission_unavailable', 503);
  }
}
