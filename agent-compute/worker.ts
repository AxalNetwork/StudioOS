/** D4557 part 2: private default-off general compute host. The VM receives no Worker bindings or credentials. */
import { DurableObject } from 'cloudflare:workers';
import { constantTimeEqual } from '../cloudflare-worker/src/rpc/secret';
import { doNamespace } from '../cloudflare-worker/src/util/doNamespace';
import { computeBody, COMPUTE_BODY_CAP, computeUid, hostAdmission, type HostAdmission, type HostManifest, type HostResult } from '../cloudflare-worker/src/services/agents/computeHost';
import { createWorkspaceSecurity, type GrantTarget, type WorkspaceSecurityDeps, type WorkspaceSecurityRun } from '../cloudflare-worker/src/services/agents/workspaceSecurity';
import { createComputeHost, type HostRecord } from './host';
import type { ComputeBindings } from './worker-configuration';
import { createContainerVm } from './vm';

// Generated locally by wrangler types, before this Worker's typecheck/build.
export interface ComputeHostEnv extends ComputeBindings { COMPUTE_CONTROL_SECRET?: string; BRANCH_DO_JURISDICTION?: string }
const json = (value: unknown, status = 200) => Response.json(value, { status });
const decode = async (response: Request | Response, cap: number) => JSON.parse(new TextDecoder().decode(await computeBody(response, cap)));

class Broker {
  private env: ComputeHostEnv; private jobUid: string;
  constructor(env: ComputeHostEnv, jobUid: string) { this.env = env; this.jobUid = jobUid; }
  async call<T>(action: string, body: unknown): Promise<T> {
    const response = await this.env.BROKER.fetch(new Request(`https://compute-broker/api/agent-compute/internal/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-compute-control': this.env.COMPUTE_CONTROL_SECRET! },
      body: JSON.stringify({ job_uid: this.jobUid, body }), signal: AbortSignal.timeout(10000),
    }));
    if (!response.ok) { await response.body?.cancel(); throw Error('compute_broker_refused'); }
    return decode(response, COMPUTE_BODY_CAP) as Promise<T>;
  }
}

abstract class ComputeContainer extends DurableObject<ComputeHostEnv> {
  protected readonly instanceType: 'basic' | 'standard-1' = 'basic';
  private host: ReturnType<typeof createComputeHost> | null = null;
  private security: ReturnType<typeof createWorkspaceSecurity> | null = null;
  /** Teardown must not depend on a reachable broker, an approved image or an enabled admission flag. */
  private async stop(timedOut = false) {
    await this.ctx.storage.transaction(async storage => {
      const row = await storage.get<HostRecord>('host');
      if (row) {
        if (!['succeeded', 'failed'].includes(row.state)) row.state = timedOut ? 'timed_out' : 'cancelled';
        row.cleanup_required = true; await storage.put('host', row);
      }
      const runs = await storage.get<Map<string, WorkspaceSecurityRun>>('security');
      if (runs) { for (const run of runs.values()) { run.revoked = true; run.nonces.clear(); } await storage.put('security', runs); }
    });
    try {
      const row = await this.ctx.storage.get<HostRecord>('host');
      if (!this.ctx.container && row?.boot_attempted) throw Error('compute_container_unavailable');
      await this.ctx.container?.destroy();
      if (this.ctx.container && await this.ctx.container.inspect() !== null) throw Error('compute_cleanup_unconfirmed');
      await this.ctx.storage.transaction(async storage => {
        const row = await storage.get<HostRecord>('host'); if (row) { row.cleanup_required = false; await storage.put('host', row); }
      });
    } catch { /* Persisted cleanup_required remains true; a retry must confirm termination. */ }
  }
  private async initialize(jobUid: string) {
    if (await this.ctx.storage.get('forgotten')) throw Error('compute_erased');
    if (this.host && this.security) return;
    const broker = new Broker(this.env, jobUid), secret = this.env.COMPUTE_CONTROL_SECRET;
    if (!secret || secret.length < 32 || !this.ctx.container) throw Error('compute_not_configured');
    const rootKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const policy = () => broker.call<{
      image: Awaited<ReturnType<WorkspaceSecurityDeps['image']>>; provider: Awaited<ReturnType<WorkspaceSecurityDeps['provider']>>;
    }>('policy', {});
    const security = createWorkspaceSecurity({
      enabled: () => String(this.env.COMPUTE_ENABLED) === 'on', halted: () => String(this.env.COMPUTE_ENABLED) !== 'on',
      clock: () => Date.now(), nonce: () => crypto.randomUUID().replaceAll('-', ''), rootKey,
      store: { transaction: change => this.ctx.storage.transaction(async storage => {
        if (await storage.get('forgotten')) throw Error('compute_erased');
        const rows = await storage.get<Map<string, WorkspaceSecurityRun>>('security') ?? new Map();
        const result = await change(rows); await storage.put('security', rows); return result;
      }) },
      authorize: (sponsor, spec, audience, objectRef) => broker.call('authorize', { sponsor, spec, audience, object_ref: objectRef }),
      image: async digest => { const current = await policy(); return current.image?.digest === digest ? current.image : null; },
      provider: async () => (await policy()).provider,
      object: ref => broker.call('object', { ref }),
      encryptionKey: async () => null, // This host never handles an R2 encryption key or accesses R2 directly.
      audit: event => broker.call('audit', event),
    });
    const container = this.ctx.container;
    const port = container.getTcpPort(8080);
    this.security = security;
    this.host = createComputeHost({ security,
      now: () => Date.now(), arm: deadline => this.ctx.storage.setAlarm(deadline),
      store: { transaction: change => this.ctx.storage.transaction(async storage => {
        if (await storage.get('forgotten')) throw Error('compute_erased');
        const selected = change(await storage.get<HostRecord>('host') ?? null);
        if (selected.row) await storage.put('host', selected.row);
        return selected.value;
      }) },
      broker: {
        manifest: (admission: HostAdmission) => broker.call<HostManifest>('manifest', admission),
        input: (admission, ref, token) => broker.call<{ data: string }>('input', { admission, ref, token }).then(value => value.data),
        complete: (admission, result: HostResult, token) => broker.call('complete', { admission, result, token }),
      },
      vm: createContainerVm({ start: options => container.start(options), namedImage: () => container.images.runtime,
        inspect: () => container.inspect(), monitor: () => container.monitor(), fetch: request => port.fetch(request), destroy: () => container.destroy() },
      { schedulingPolicy: String(this.env.COMPUTE_SCHEDULING_POLICY), instance: this.instanceType, now: () => Date.now() }),
    });
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const raw = await decode(request, 16384), path = new URL(request.url).pathname;
      if (!computeUid(raw.job_uid)) return json({ code: 'job_invalid' }, 422);
      const bound = await this.ctx.storage.get<string>('job_uid');
      if (bound && bound !== raw.job_uid) return json({ code: 'job_conflict' }, 409);
      if (!bound) await this.ctx.storage.put('job_uid', raw.job_uid);
      if (path === '/forget') {
        await this.stop();
        await this.ctx.storage.transaction(async storage => {
          if ((await storage.get<HostRecord>('host'))?.cleanup_required) throw Error('compute_cleanup_unconfirmed');
          await storage.put('forgotten', true); // Opaque job tombstone prevents replay after erasure.
          await storage.delete(['host', 'security']);
          await storage.deleteAlarm();
        });
        this.host = null; this.security = null; return json({ cleanup_required: false });
      }
      if (path === '/cancel') { await this.stop(); return json({ ok: true, cleanup_required: (await this.ctx.storage.get<HostRecord>('host'))?.cleanup_required ?? false }); }
      if (path === '/status') { const row = await this.ctx.storage.get<HostRecord>('host'); return json(row ? { state: row.state, cleanup_required: row.cleanup_required } : null); }
      await this.initialize(raw.job_uid);
      if (path === '/dispatch') {
        if (String(this.env.COMPUTE_ENABLED) !== 'on') return json({ code: 'compute_off' }, 404);
        return json(await this.host!.dispatch(raw.admission), 202);
      }
      if (path === '/redeem') return json(await this.security!.redeem(raw.token, raw.target as GrantTarget));
      return json({ code: 'not_found' }, 404);
    } catch { return json({ code: 'compute_host_refused' }, 503); }
  }
  async alarm() {
    const jobUid = await this.ctx.storage.get<string>('job_uid');
    if (!jobUid || await this.ctx.storage.get('forgotten')) return;
    const row = await this.ctx.storage.get<HostRecord>('host');
    if (row && Date.now() >= row.deadline && row.cleanup_required) { await this.stop(true); return; }
    await this.initialize(jobUid);
    await this.host!.alarm();
  }
}
export class PythonComputeContainer extends ComputeContainer {}
export class DocumentComputeContainer extends ComputeContainer { protected readonly instanceType = 'standard-1' as const; }

export default {
  async fetch(request: Request, env: ComputeHostEnv): Promise<Response> {
    const secret = env.COMPUTE_CONTROL_SECRET;
    if (!secret || secret.length < 32 || !constantTimeEqual(request.headers.get('x-compute-control') ?? '', secret)) return json({ code: 'not_found' }, 404);
    try {
      if (request.method !== 'POST') return json({ code: 'not_found' }, 404);
      const raw = await decode(request, 16384), admission = new URL(request.url).pathname === '/dispatch' ? hostAdmission(raw.admission) : null;
      const workload = admission?.spec.workload_class ?? raw.workload;
      if (!computeUid(raw.job_uid) || !['python', 'spreadsheet', 'document_convert'].includes(workload)) return json({ code: 'request_invalid' }, 422);
      if (admission && admission.job_uid !== raw.job_uid) return json({ code: 'job_conflict' }, 409);
      const namespace = doNamespace(env, workload === 'document_convert' ? env.COMPUTE_DOCUMENTS : env.COMPUTE_PYTHON);
      const stub = namespace.get(namespace.idFromName(`compute:${raw.job_uid}`));
      return stub.fetch(new Request(request.url, { method: 'POST', body: JSON.stringify(raw) }));
    } catch { return json({ code: 'compute_host_refused' }, 503); }
  },
};
