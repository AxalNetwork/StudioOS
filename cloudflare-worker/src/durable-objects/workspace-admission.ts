/**
 * D5586 part 3 (#5586): `WorkspaceAdmission` — #5570's admission coordinator. One object, by name
 * (`WORKSPACE_ADMISSION_OBJECT`), for every tenant that shares a provider quota, hosting #5570's admission control
 * (`createAdmissionControl`) and the audited swarm admission (`createAuditedSwarmAdmission`) over ONE
 * `DurableWorkspaceAdmissionStore`, so a swarm ticket and its compute lease change in the same storage. Only
 * `services/agents/workspaceAdmissionClient.ts` reaches it. Preview-only: no route, cron or flag calls the client.
 *
 * DURABLE. Every policy change is one storage transaction (D5570 part 2); nothing is kept in memory between calls.
 * After each swarm change the audit is copied to D1's `swarm_admission_events` (D5586 part 2); a failed copy is
 * retried by the next call and never changes the answer.
 *
 * REFUSED: a request that is not `POST /op`, an object reached by any other name (`wrong_coordinator`), arguments
 * that name another venture than the caller's (`wrong_tenant`, the client's own check again), and a uid-keyed call on
 * a lease or ticket that belongs to another venture (`lease_not_found` / `ticket_not_found`, as if it did not exist).
 * A #5570 call on a swarm ticket's lease is refused `swarm_ticket`: that lease settles through the swarm.
 *
 * LIMITS. No broker record holds the coordinator's caps yet, so `COORDINATOR_LIMITS` gives no provider a cap: a
 * compute lease waits (bounded) and is never admitted. Inline swarm tickets are admitted by the venture policy the
 * caller read. Reading the caps from a record is a remaining part (D5586-p3.md §5).
 */
import type { Env } from '../types';
import { DurableWorkspaceAdmissionStore } from '../services/agents/workspaceAdmissionStore';
import { createAdmissionControl, type AdmissionLimits, type ProviderStateReader } from '../services/agents/workspaceAdmission';
import { swarmOf, ventureKey } from '../services/agents/swarmAdmission';
import { createAuditedSwarmAdmission } from '../services/agents/swarmAudit';
import { WORKSPACE_ADMISSION_OBJECT, clientRefusal, scopeRefusal, type WorkspaceAdmissionOp } from '../services/agents/workspaceAdmissionClient';

export const COORDINATOR_LIMITS: AdmissionLimits = Object.freeze({
  halted: false, lease_ms: 60_000, per_tenant_running: 1, per_tenant_waiting: 10, max_waiting: 100,
  per_provider_running: Object.freeze({}), per_region_running: Object.freeze({}),
});
/** No provider reader exists yet: every reconciling lease reads `unknown` and keeps its slot. */
const UNREAD: ProviderStateReader = async () => ({ state: 'unknown', measured_microusd: 'unavailable' });

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

export class WorkspaceAdmission implements DurableObject {
  protected readonly state: DurableObjectState;
  protected readonly env: Env;
  constructor(state: DurableObjectState, env: Env) { this.state = state; this.env = env; }

  /** The coordinator's caps (see the header). */
  protected limits(): AdmissionLimits { return COORDINATOR_LIMITS; }
  protected clock(): number { return Date.now(); }
  protected observe(): ProviderStateReader { return UNREAD; }

  async fetch(req: Request): Promise<Response> {
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/op') return json({ error: 'not_found' }, 404);
    let body: { op?: unknown; caller?: unknown; args?: unknown };
    try { body = await req.json(); } catch { return json(clientRefusal('invalid_admission_call', 422)); }
    const name = (this.state.id as { name?: unknown })?.name;
    if (typeof name === 'string' && name !== WORKSPACE_ADMISSION_OBJECT) return json(clientRefusal('wrong_coordinator', 403));
    const refused = scopeRefusal(String(body?.op), body?.caller, body?.args);
    if (refused) return json(refused);
    try {
      return json(await this.apply(body.op as WorkspaceAdmissionOp, body.caller as { tenantId: number; companyId: number }, body.args as unknown[]));
    } catch {
      return json(clientRefusal('admission_unavailable', 503), 500);
    }
  }

  private async apply(op: WorkspaceAdmissionOp, caller: { tenantId: number; companyId: number }, args: unknown[]): Promise<unknown> {
    const store = new DurableWorkspaceAdmissionStore(this.state.storage);
    const clock = () => this.clock();
    const admission = createAdmissionControl({ store, clock, limits: this.limits(), observe: this.observe() });
    const swarm = createAuditedSwarmAdmission({ store, clock, admission, db: this.env.DB });
    const venture = { tenant_id: caller.tenantId, company_id: caller.companyId };
    const own = ventureKey(venture);
    /** The stored owner of a uid: its #5570 slot's tenant, and whether a swarm ticket holds it (and whose). */
    const ownerOf = (uid: string) => store.transaction(s => {
      const t = swarmOf(s).tickets[uid];
      return { slotTenant: s.slots[uid]?.tenant_id ?? null, ticket: t ? ventureKey(t) : null };
    });
    const [a, b, c] = args as any[];
    switch (op) {
      case 'admission.request': {
        if ((await ownerOf(String(a?.run_uid))).ticket) return clientRefusal('swarm_ticket');
        const e = await admission.enqueue(a);
        if (!e.ok) return e;
        await admission.admit();
        const slot = await store.transaction(s => {
          const x = s.slots[a.run_uid];
          return x && { state: x.state, generation: x.generation, lease_expires_at: x.lease_expires_at, compute_reserve_microusd: x.compute_reserve_microusd };
        });
        return slot ? { ok: true, value: { ...slot, duplicate: e.value.duplicate } } : clientRefusal('lease_not_found', 403);
      }
      case 'admission.settle': case 'admission.withdraw': {
        const o = await ownerOf(a);
        if (o.slotTenant !== caller.tenantId) return clientRefusal('lease_not_found', 403);
        if (o.ticket) return clientRefusal('swarm_ticket');
        return op === 'admission.settle' ? admission.release(a, b, c) : admission.cancel(a, b);
      }
      case 'swarm.request': return swarm.request(a, b, c);
      case 'swarm.promote': return { ok: true, value: await swarm.promote(a) };
      case 'swarm.settle': {
        if ((await ownerOf(a)).ticket !== own) return clientRefusal('ticket_not_found', 403);
        return swarm.settle(a, b, c);
      }
      case 'swarm.withdraw': return swarm.withdraw(a, venture);
      case 'swarm.revoke': return { ok: true, value: await swarm.revokeAgent(venture, b) };
      case 'swarm.snapshotFor': return { ok: true, value: await swarm.snapshotFor(venture) };
    }
  }
}
