/** D4557: synthetic SQLite/R2/VM world; actual broker, shared cryptography and Workflow functions. */
import { world, AGENT, SPONSOR } from './_agent_engine_fixture.ts';
import { fakeCapabilities, specFixture } from './_workspace_fake_5565.ts';
import { createWorkspaceSecurity, type WorkspaceSecurityRun } from '../src/services/agents/workspaceSecurity.ts';
import { authorizeCompute, computeInternal, computePolicy, type ComputePolicy } from '../src/services/agents/computeBridge.ts';
import { createComputeHost, type HostRecord, type HostStore } from '../../agent-compute/host.ts';
import type { HostAdmission, HostResult } from '../src/services/agents/computeHost.ts';
import type { User } from '../src/types.ts';

export async function computeWorld() {
  const w = world(); w.db.exec('PRAGMA foreign_keys = ON'); w.agent(AGENT); w.task(201, AGENT);
  const spec = specFixture(), policy: ComputePolicy = {
    template: { image_digest: spec.image_digest, repo_id: spec.repo_id, base_sha: spec.base_sha, cpu: 0.5, allowed_regions: ['global'], max_cost_microusd: 1000 },
    image: { digest: spec.image_digest, signature_verified: true, provenance_verified: true, sbom_verified: true, scan_passed: true, revoked: false },
    provider: { capabilities: { ...fakeCapabilities(), enforced_regions: ['global'], workload_classes: ['python', 'spreadsheet', 'document_convert'], shell: false, untrusted_code: false },
      non_root: true, no_new_privileges: true, immutable_image: true, ephemeral_scratch: true, resource_limits: true, host_socket: false, privileged: false,
      isolation: 'microvm', network_connect_fence: true, metadata_denied: true }, artifact_ttl_s: 86400,
    job_cost_ceiling_microusd: { python: 100, document_convert: 500, spreadsheet: 100 },
  };
  w.env.AGENT_COMPUTE = 'on'; w.env.AGENT_COMPUTE_SECRET = 'synthetic-compute-control-secret-4557'; w.env.AGENT_COMPUTE_POLICY_JSON = JSON.stringify(policy);
  const objects = new Map<string, Uint8Array>(), stats = { starts: 0, stops: 0, stopFails: false, forgotten: [] as string[], vmInputs: [] as unknown[], beforePut: null as null | (() => Promise<void>) };
  w.env.FILES = {
    async put(key: string, raw: Uint8Array) { if (stats.beforePut) await stats.beforePut(); objects.set(key, new Uint8Array(raw)); },
    async get(key: string) { const data = objects.get(key); return data ? { size: data.length, body: new Response(data).body } : null; },
    async delete(key: string) { objects.delete(key); },
  };
  const resultData = new TextEncoder().encode('{"sum":6}');
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', resultData))].map(value => value.toString(16).padStart(2, '0')).join('');
  const result: HostResult = { outcome: 'succeeded', failure_code: null, cpu_ms: 10, wall_ms: 20, peak_rss_bytes: 1024, exit_code: 0,
    artifacts: [{ name: 'result.json', bytes: resultData.length, sha256, data: btoa(new TextDecoder().decode(resultData)) }] };
  const hosts = new Map<string, { host: ReturnType<typeof createComputeHost>; security: ReturnType<typeof createWorkspaceSecurity> }>();
  const rootKey = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(19), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  async function hostFor(admission: HostAdmission) {
    const existing = hosts.get(admission.job_uid); if (existing) return existing;
    let rows = new Map<string, WorkspaceSecurityRun>(), queue: Promise<unknown> = Promise.resolve(), row: HostRecord | null = null, nonce = 0;
    // Grant expiry must be relative to SQLite CURRENT_TIMESTAMP in the migrated fixture.
    const security = createWorkspaceSecurity({ enabled: () => w.env.AGENT_COMPUTE === 'on', halted: () => false, clock: () => Date.now(), // clock-ok: relative
      nonce: () => `synthetic-${++nonce}`, rootKey,
      store: { async transaction(fn) { const next = queue.then(async () => { const copy = structuredClone(rows); const answer = await fn(copy); rows = copy; return answer; }); queue = next.catch(() => {}); return next; } },
      authorize: (sponsor, spec, audience, object_ref) => authorizeCompute(w.env, admission.job_uid, { sponsor, spec, audience, object_ref }),
      image: async () => computePolicy(w.env)!.image, provider: async () => computePolicy(w.env)!.provider,
      object: async ref => await computeInternal(w.env, 'object', admission.job_uid, { ref }) as any,
      encryptionKey: async () => null, audit: async event => { await computeInternal(w.env, 'audit', admission.job_uid, event); },
    });
    const store: HostStore = { async transaction(fn) { const chosen = fn(structuredClone(row)); row = chosen.row; return chosen.value; } };
    const host = createComputeHost({ store, security, now: () => Date.now(), arm: async () => {}, // clock-ok: relative
      vm: { start: () => { stats.starts++; }, ready: async () => {}, run: async input => { stats.vmInputs.push(input); return result; },
        destroy: async () => { stats.stops++; if (stats.stopFails) throw Error('synthetic_stop_failure'); } },
      broker: {
        manifest: async () => await computeInternal(w.env, 'manifest', admission.job_uid, admission) as any,
        input: async (_a, ref, token) => (await computeInternal(w.env, 'input', admission.job_uid, { ref, token }) as { data: string }).data,
        complete: async (_a, answer, token) => { await computeInternal(w.env, 'complete', admission.job_uid, { result: answer, token }); },
      },
    });
    const selected = { host, security }; hosts.set(admission.job_uid, selected); return selected;
  }
  w.env.AGENT_COMPUTE_HOST = { async fetch(request: Request) {
    const input = await request.json() as any, path = new URL(request.url).pathname;
    if (path === '/dispatch') return Response.json(await (await hostFor(input.admission)).host.dispatch(input.admission), { status: 202 });
    const selected = hosts.get(input.job_uid); if (!selected) return Response.json({ code: 'missing' }, { status: 404 });
    if (path === '/redeem') return Response.json(await selected.security.redeem(input.token, input.target));
    if (path === '/forget') { await selected.host.cancel(); const cleanup_required = (await selected.host.status())?.cleanup_required ?? false; if (!cleanup_required) stats.forgotten.push(input.job_uid); return Response.json({ cleanup_required }); }
    if (path === '/cancel') { await selected.host.cancel(); return Response.json({ cleanup_required: (await selected.host.status())?.cleanup_required ?? false }); }
    return Response.json(await selected.host.status());
  } };
  return { ...w, stats, objects, hosts, result, policy,
    user: (id = SPONSOR) => w.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User,
    runAlarms: async () => { for (const value of hosts.values()) await value.host.alarm(); },
  };
}
