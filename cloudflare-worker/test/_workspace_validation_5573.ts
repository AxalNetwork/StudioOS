/**
 * D5573 (#5573): LOCAL MOCKED workspace validation harness; tests and `scripts/workspace-validation.mjs` only, never
 * imported by production.
 *
 * It drives synthetic coding tasks for synthetic ventures through the contracts already on main — D5565's
 * `trustedWorkspaceSpec`, `ExecutorAdapter` (the `_workspace_fake_5565.ts` fake, wrapped here so faults can be
 * injected) and `createRunnerControl` lease/fencing protocol, and D5567's `createWorkspaceSecurity` grants and
 * publish gate — on a seeded virtual clock. It records one normalized observation set and hands it to the pure
 * `scripts/lib/workspaceInvariants.mjs` / `workspaceReport.mjs`, which can later judge a hosted run the same way.
 *
 * The driver below is a test sequence, not a task engine: AgentTaskWorkflow/Queue stay the only lifecycle, and the
 * existing AI router/hold/settlement path stays the only ledger. `charge` and `pr_opened` are observations of the
 * effects the broker would request once per accepted (non-duplicate) completion; nothing is billed or published.
 * The cache and log probes are enforced by this mock's sandbox (tenant prefixes); the file, ref and credential probes
 * are refused by the real contract code. Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import { createRunnerControl, workspaceArtifactPrefix, type RunnerCall, type RunnerIdentity } from '../src/services/agents/runnerProtocol.ts';
import { createWorkspaceSecurity, type GrantTarget, type WorkspaceObject, type WorkspaceProviderEvidence,
  type WorkspaceSecurityRun, type WorkspaceSponsor } from '../src/services/agents/workspaceSecurity.ts';
import { trustedWorkspaceSpec, workspaceRefusal, type ExecutionRef, type ExecutorAdapter, type WorkspaceResult,
  type WorkspaceSpec } from '../src/services/agents/workspaceSpec.ts';
import { fakeCapabilities, fakeExecutor, memoryRunnerStore } from './_workspace_fake_5565.ts';
import { buildReport, renderMarkdown, MOCK_PROVIDER_KIND } from '../../scripts/lib/workspaceReport.mjs';

export const FAULTS = ['provider_429_5xx', 'unknown_create_outcome', 'lost_callback', 'queue_redelivery', 'expired_grant',
  'image_unavailable', 'forced_termination', 'partial_upload', 'missed_heartbeat', 'cancel_races_completion', 'integration_conflict'] as const;
export type Fault = typeof FAULTS[number];
export type ValidationConfig = { tasks: number; tenants: number; concurrency: number; faults: Fault[]; seed: number };
export const DEFAULT_CONFIG: ValidationConfig = { tasks: 10, tenants: 2, concurrency: 10, faults: [...FAULTS], seed: 5573 };

const HEARTBEAT_MS = 1000, MISSED_BEATS = 3, MAX_GENERATIONS = 3, RECONCILIATION_WINDOW_MS = 60000, GRANT_TTL_MS = 5000;
const REGION = 'weur';
const RETRYABLE = new Set(['provider_rate_limited', 'provider_unavailable', 'create_outcome_unknown', 'capacity_exhausted']);
const sha = (alg: string, value: string) => createHash(alg).update(value).digest('hex');
const IMAGE = 'sha256:' + sha('sha256', 'synthetic-image-5573');

type Ev = { kind: string; at: number; [field: string]: unknown };
type Step = number | 'slot';
type Proc = AsyncGenerator<Step, void, void>;
type Task = {
  index: number; run_id: string; tenant: number; spec: WorkspaceSpec; sponsor: WorkspaceSponsor; identity: RunnerIdentity;
  faults: Set<Fault>; probe: boolean; arrival_ms: number; work_ms: number; boot_ms: number; restore_ms: number;
  refs: ExecutionRef[]; reaped: { execution_generation: number; state: string } | null;
  acked: { ref: string; progress: number } | null; checkpoints: number; last: { call: RunnerCall; manifest: string } | null;
  creates: number;
};

export function validateConfig(input: Partial<ValidationConfig>): ValidationConfig {
  const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<ValidationConfig>;
  const c = { ...DEFAULT_CONFIG, ...given, faults: [...(given.faults ?? DEFAULT_CONFIG.faults)] };
  const int = (v: number, lo: number, hi: number, name: string) => { if (!Number.isSafeInteger(v) || v < lo || v > hi) throw new Error(`${name} must be an integer from ${lo} to ${hi}`); };
  int(c.tasks, 1, 1000, 'tasks'); int(c.tenants, 2, 10, 'tenants'); int(c.concurrency, 1, 100, 'concurrency'); int(c.seed, 0, 2 ** 31 - 1, 'seed');
  for (const f of c.faults) if (!FAULTS.includes(f)) throw new Error(`Unknown fault: ${f}`);
  if (new Set(c.faults).size !== c.faults.length) throw new Error('A fault is listed twice');
  return c;
}

/** mulberry32: the one source of synthetic variation, so a seed reproduces a run exactly. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function faultsFor(index: number, config: ValidationConfig): Set<Fault> {
  const out = new Set<Fault>(), f = config.faults;
  if (!f.length) return out;
  out.add(f[index % f.length]);
  for (let j = 0; j < f.length; j++) if (j % config.tasks === index) out.add(f[j]);
  return out;
}

function value<T>(r: WorkspaceResult<T>, where: string): T {
  if (!r.ok) throw new Error(`Harness setup refused at ${where}: ${r.code}`);
  return r.value;
}

export async function runValidation(input: Partial<ValidationConfig> = {}, commit = 'unknown') {
  const config = validateConfig(input);
  const rng = prng(config.seed);
  const between = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const world = { now: 0 };
  const clock = () => world.now;
  const events: Ev[] = [];
  const emit = (kind: string, fields: Record<string, unknown> = {}) => { events.push({ kind, at: world.now, ...fields }); };

  // --- Authorization and policy state the broker would read (synthetic) ---
  const revoked = new Set<string>();
  const approvals = new Set<string>();
  const verifiedManifests = new Set<string>();
  const objects = new Map<string, WorkspaceObject>();

  // --- The D5565 fake provider, behind a fault injector ---
  const caps = { ...fakeCapabilities(), workload_classes: ['coding_trusted' as const], concurrency_max: config.concurrency };
  const base = fakeExecutor(clock, caps);
  const tasks = new Map<string, Task>();
  const seenExec = new Set<string>(), stoppedExec = new Set<string>(), cleanedExec = new Set<string>();
  const stopped = (ref: ExecutionRef) => { if (!stoppedExec.has(ref.execution_id)) { stoppedExec.add(ref.execution_id); emit('execution_stopped', { execution_id: ref.execution_id, run_id: ref.run_id }); } };
  const fault = (t: Task, f: Fault) => emit('fault', { fault: f, triggered: true, run_id: t.run_id });
  const provider: ExecutorAdapter = {
    ...base.adapter,
    async create(spec) {
      const t = tasks.get(spec.run_id);
      const n = t ? ++t.creates : 1;
      const call = (result: string) => emit('provider_call', { op: 'create', run_id: spec.run_id, generation: spec.execution_generation, result });
      if (t?.faults.has('image_unavailable')) { fault(t, 'image_unavailable'); call('image_unavailable'); return workspaceRefusal('image_unavailable', 503); }
      if (t?.faults.has('provider_429_5xx') && n <= 2) {
        fault(t, 'provider_429_5xx'); const code = n === 1 ? 'provider_rate_limited' : 'provider_unavailable';
        call(code); return workspaceRefusal(code, 503);
      }
      const r = await base.adapter.create(spec);
      if (r.ok && !seenExec.has(r.value.ref.execution_id)) {
        seenExec.add(r.value.ref.execution_id);
        emit('execution_created', { execution_id: r.value.ref.execution_id, run_id: spec.run_id, tenant_id: spec.tenant_id, region: r.value.ref.region, generation: spec.execution_generation });
      }
      if (r.ok && t?.faults.has('unknown_create_outcome') && n === 1) { fault(t, 'unknown_create_outcome'); call('create_outcome_unknown'); return workspaceRefusal('create_outcome_unknown', 503); }
      call(r.ok ? 'ok' : r.code);
      return r;
    },
    async terminate(ref) {
      const r = await base.adapter.terminate(ref);
      if (r.ok && ['cancelled', 'finished', 'failed'].includes(r.value.state)) stopped(ref);
      return r;
    },
    async cleanup(ref) {
      const r = await base.adapter.cleanup(ref);
      if (r.ok && !cleanedExec.has(ref.execution_id)) { cleanedExec.add(ref.execution_id); emit('execution_cleaned', { execution_id: ref.execution_id, run_id: ref.run_id }); }
      return r;
    },
  };

  // --- D5567 broker security with synthetic evidence ---
  const providerEvidence: WorkspaceProviderEvidence = { capabilities: caps, non_root: true, no_new_privileges: true, immutable_image: true,
    ephemeral_scratch: true, resource_limits: true, host_socket: false, privileged: false, isolation: 'microvm', network_connect_fence: true, metadata_denied: true };
  const rootKey = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(73), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  let secRows = new Map<string, WorkspaceSecurityRun>(), secQueue: Promise<unknown> = Promise.resolve(), nonce = 0;
  const security = createWorkspaceSecurity({
    enabled: () => true, halted: () => false, clock, rootKey, nonce: () => `nonce-${String(++nonce).padStart(8, '0')}`,
    store: { async transaction<T>(fn: (runs: Map<string, WorkspaceSecurityRun>) => Promise<T> | T): Promise<T> {
      const next = secQueue.then(async () => { const copy = structuredClone(secRows); const answer = await fn(copy); secRows = copy; return answer; });
      secQueue = next.catch(() => {}); return next;
    } },
    authorize: async (_sponsor, spec, audience, objectRef) => ({ allowed: !revoked.has(spec.run_id), revision: 1,
      approved: audience === 'integration.publish' && approvals.has(`${spec.run_id}|${objectRef}`) }),
    image: async digest => (digest === IMAGE ? { digest, signature_verified: true, provenance_verified: true, sbom_verified: true, scan_passed: true, revoked: false } : null),
    provider: async () => providerEvidence,
    object: async ref => objects.get(ref) ?? null,
    encryptionKey: async () => null,
    audit: async () => {},
  });

  // --- D5565 runner lease/fencing protocol ---
  let leaseNonce = 0;
  const control = createRunnerControl({ store: memoryRunnerStore(), clock, policy: {
    heartbeat_ms: HEARTBEAT_MS, missed_beat_limit: MISSED_BEATS, max_generations: MAX_GENERATIONS,
    nonce: () => `lease-${++leaseNonce}`,
    authorize: (_identity, spec) => !revoked.has(spec.run_id),
    manifestAllowed: (spec, ref) => verifiedManifests.has(`${spec.run_id}|${spec.execution_generation}|${ref}`),
  } });

  // --- Synthetic ventures and tasks ---
  const specAt = (t: Task, generation: number) => value(trustedWorkspaceSpec({ ...t.spec, execution_generation: generation }), 'spec');
  function makeTask(index: number, tenant: number, run_id: string, probe: boolean, extra: Partial<WorkspaceSpec> = {}): Task {
    const ids = { tenant_id: 9001 + tenant, company_id: 9101 + tenant, project_id: 9201 + tenant, agent_id: 9301 + tenant };
    const spec = value(trustedWorkspaceSpec({ version: 1, ...ids, task_id: 9600 + index, run_id, attempt: 1, execution_generation: 1,
      idempotency_key: `${run_id}:workspace:1`, image_digest: IMAGE, repo_id: 9401 + tenant, base_sha: sha('sha1', `synthetic-repo-${tenant}`),
      scope_paths: ['src', 'test'], cpu: 0.5, memory_mb: 512, disk_mb: 512, max_duration_s: 600, network_policy: { mode: 'deny' },
      allowed_regions: [REGION], allowed_providers: ['cloudflare'], workload_class: 'coding_trusted', checkpoint_manifest_ref: null,
      artifact_sink_ref: `sink-${run_id}`, max_cost_microusd: 100000, ...extra }), 'task spec');
    const sponsor = { member_id: 9501 + tenant, tenant_id: ids.tenant_id, company_id: ids.company_id, project_id: ids.project_id };
    const io = rng() < 0.5;
    const t: Task = { index, run_id, tenant, spec, sponsor, identity: { ...ids, task_id: spec.task_id, runner_id: `runner-${run_id}` },
      faults: probe ? new Set() : faultsFor(index, config), probe, arrival_ms: probe ? 0 : between(0, 2000),
      work_ms: io ? between(3000, 10000) : between(8000, 20000), boot_ms: between(800, 3000), restore_ms: between(200, 800),
      refs: [], reaped: null, acked: null, checkpoints: 0, last: null, creates: 0 };
    tasks.set(run_id, t);
    for (const f of t.faults) emit('fault', { fault: f, triggered: false, run_id });
    return t;
  }
  const runs: { run_id: string; tenant_id: number; allowed_regions: string[]; probe: boolean }[] = [];
  const track = (t: Task) => { runs.push({ run_id: t.run_id, tenant_id: t.spec.tenant_id, allowed_regions: [...t.spec.allowed_regions], probe: t.probe }); return t; };

  // --- Mock sandbox paths: cache and logs are partitioned by tenant prefix ---
  const cachePath = (s: WorkspaceSpec) => `tenants/${s.tenant_id}/git-cache/${s.repo_id}/`;
  const logPath = (s: WorkspaceSpec) => workspaceArtifactPrefix(s) + 'logs/';
  const sandboxRead = (s: WorkspaceSpec, path: string) => path.startsWith(cachePath(s)) || path.startsWith(logPath(s));

  const objectFor = (t: Task, ref: string, generation: number, run_id = t.run_id): WorkspaceObject => ({ ref, tenant_id: t.spec.tenant_id,
    company_id: t.spec.company_id, project_id: t.spec.project_id, run_id, execution_generation: generation, sink_ref: t.spec.artifact_sink_ref,
    region: REGION, approved_restore_regions: [], key_id: `key-${t.spec.tenant_id}`, expires_at: 10 ** 12 });

  // Seed run per venture: the target every cross-tenant probe aims at.
  const seeds: Task[] = [];
  for (let tenant = 0; tenant < config.tenants; tenant++) {
    const s = track(makeTask(-1 - tenant, tenant, `syn5573-v${tenant}-seed`, true));
    value(await security.register(s.spec, s.sponsor), 'seed security');
    value(await control.register(s.spec), 'seed control');
    objects.set(`ckpt-${s.run_id}`, objectFor(s, `ckpt-${s.run_id}`, 1));
    seeds.push(s);
  }

  // --- Policy probes: a revoked sponsor and a disallowed region must never execute ---
  for (let tenant = 0; tenant < config.tenants; tenant++) {
    const p = track(makeTask(-100 - tenant, tenant, `syn5573-v${tenant}-revoked`, true));
    value(await security.register(p.spec, p.sponsor), 'revoked probe');
    value(await control.register(p.spec), 'revoked probe control');
    const created = await provider.create(p.spec);
    const ref = created.ok ? created.value.ref : null;
    if (ref) { p.refs.push(ref); base.start(ref); }
    const target: GrantTarget = { run_id: p.run_id, execution_generation: 1, audience: 'executor.bootstrap' };
    const grant = await security.issue(target, GRANT_TTL_MS);
    revoked.add(p.run_id); await security.revoke(p.run_id); emit('revoked', { run_id: p.run_id });
    const redeemed = grant.ok ? await security.redeem(grant.value.token, target) : grant;
    const lease = await control.lease({ run_id: p.run_id, execution_generation: 1, request_nonce: `probe-${p.run_id}`, identity: p.identity });
    if (lease.ok) emit('exec_start', { run_id: p.run_id, generation: 1, region: ref?.region ?? REGION });
    emit('policy_probe', { probe: 'revoked', run_id: p.run_id, outcome: redeemed.ok || lease.ok ? 'executed' : 'refused',
      codes: [redeemed.ok ? 'ok' : redeemed.code, lease.ok ? 'ok' : lease.code] });
    const cancel = await control.requestCancel(p.run_id, 1);
    if (ref) { await provider.terminate(ref); await provider.cleanup(ref); }
    if (cancel.ok) await control.acknowledgeCleanup(p.run_id, cancel.value.execution_generation);

    const d = track(makeTask(-200 - tenant, tenant, `syn5573-v${tenant}-region`, true, { allowed_regions: ['apac'] }));
    const admitted = await security.register(d.spec, d.sponsor);
    const made = await provider.create(d.spec);
    if (made.ok) { d.refs.push(made.value.ref); await provider.terminate(made.value.ref); await provider.cleanup(made.value.ref); }
    emit('policy_probe', { probe: 'disallowed_region', run_id: d.run_id, outcome: admitted.ok || made.ok ? 'executed' : 'refused',
      codes: [admitted.ok ? 'ok' : admitted.code, made.ok ? 'ok' : made.code] });
  }

  // --- Scheduler: a deterministic discrete-event loop on the virtual clock ---
  const queue: { at: number; seq: number; proc: Proc }[] = [];
  const waiters: Proc[] = [];
  let seq = 0, freeSlots = config.concurrency, live = 0;
  const push = (proc: Proc, at: number) => queue.push({ at, seq: seq++, proc });
  const release = () => { const next = waiters.shift(); if (next) push(next, world.now); else freeSlots++; };

  async function* provision(t: Task, spec: WorkspaceSpec): AsyncGenerator<Step, ExecutionRef | null, void> {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const r = await provider.create(spec);
      if (r.ok) {
        if (!t.refs.some(x => x.execution_id === r.value.ref.execution_id)) { t.refs.push(r.value.ref); emit('git_op', { op: 'checkout', run_id: t.run_id }); }
        return r.value.ref;
      }
      if (!RETRYABLE.has(r.code)) return null;
      yield 500 * 2 ** (attempt - 1);
    }
    return null;
  }

  async function stopAndClean(ref: ExecutionRef) {
    await provider.terminate(ref);
    await provider.cleanup(ref);
  }

  /** Fail closed: fence the run, stop the execution and confirm cleanup before the run is terminal. */
  async function failClosed(t: Task, generation: number, ref: ExecutionRef | null) {
    const cancel = await control.requestCancel(t.run_id, generation);
    if (ref) await stopAndClean(ref);
    if (cancel.ok) await control.acknowledgeCleanup(t.run_id, cancel.value.execution_generation);
  }

  async function brokerComplete(t: Task, call: RunnerCall, manifest: string) {
    const r = await control.complete({ ...call, manifest_ref: manifest });
    if (r.ok && !r.value.duplicate) {
      emit('completed', { run_id: t.run_id });
      emit('charge', { run_id: t.run_id, idempotency_key: t.spec.idempotency_key });
      emit('git_op', { op: 'push', run_id: t.run_id });
      emit('pr_opened', { run_id: t.run_id, run_key: t.run_id, pr_ref: `pr-${t.run_id}` });
      emit('git_op', { op: 'pr_open', run_id: t.run_id });
    }
    return r;
  }

  async function isolationProbes(t: Task, call: RunnerCall, generation: number) {
    for (const victim of seeds.filter(s => s.tenant !== t.tenant)) {
      const access = (resource: string, r: { ok: boolean; code?: string }, enforcement: string) => emit('access', { run_id: t.run_id,
        actor_tenant: t.spec.tenant_id, target_tenant: victim.spec.tenant_id, resource, outcome: r.ok ? 'allowed' : 'denied', code: r.ok ? 'ok' : r.code, enforcement });
      access('file', await control.uploadFence({ ...call, run_id: victim.run_id, execution_generation: 1 }), 'contract');
      access('ref', await security.issue({ run_id: t.run_id, execution_generation: generation, audience: 'artifact.read', object_ref: `ckpt-${victim.run_id}`, region: REGION }), 'contract');
      const victimTarget: GrantTarget = { run_id: victim.run_id, execution_generation: 1, audience: 'executor.bootstrap' };
      const stolen = value(await security.issue(victimTarget, GRANT_TTL_MS), 'victim grant');
      access('credential', await security.redeem(stolen.token, { run_id: t.run_id, execution_generation: generation, audience: 'executor.bootstrap' }), 'contract');
      const mock = (ok: boolean) => (ok ? { ok: true } : { ok: false, code: 'sandbox_path_denied' });
      access('cache', mock(sandboxRead(t.spec, cachePath(victim.spec) + 'pack')), 'mock');
      access('log', mock(sandboxRead(t.spec, logPath(victim.spec) + 'stdout')), 'mock');
    }
    // Same-tenant controls: the mock sandbox is not deny-all.
    for (const [resource, path] of [['cache', cachePath(t.spec) + 'pack'], ['log', logPath(specAt(t, generation)) + 'stdout']] as const) {
      const ok = sandboxRead(t.spec, path);
      emit('access', { run_id: t.run_id, actor_tenant: t.spec.tenant_id, target_tenant: t.spec.tenant_id, resource, outcome: ok ? 'allowed' : 'denied', code: ok ? 'ok' : 'sandbox_path_denied', enforcement: 'mock' });
    }
  }

  async function* checkpoint(t: Task, call: RunnerCall, generation: number, progress: number): AsyncGenerator<Step, void, void> {
    const fence = await control.uploadFence(call);
    if (!fence.ok) return;
    const ref = `ckpt-${t.run_id}-g${generation}-${++t.checkpoints}`;
    const payload = `synthetic-checkpoint:${ref}:${progress}`, declared = sha('sha256', payload);
    let sent = payload;
    if (t.faults.has('partial_upload') && t.checkpoints === 1) { fault(t, 'partial_upload'); sent = payload.slice(0, payload.length >> 1); }
    for (let tries = 0; tries < 2; tries++) {
      yield 300;
      if (sha('sha256', sent) === declared) {
        objects.set(ref, objectFor(t, ref, generation));
        t.acked = { ref, progress };
        emit('checkpoint_ack', { run_id: t.run_id, generation, checkpoint_ref: ref, seq: t.checkpoints });
        return;
      }
      emit('checkpoint_rejected', { run_id: t.run_id, generation, reason: 'hash_mismatch' });
      sent = payload;
    }
  }

  type Attempt = 'completed' | 'lost' | 'failed_closed' | 'cancelled';
  async function* attempt(t: Task, generation: number, ref: ExecutionRef, recovering: boolean): AsyncGenerator<Step, Attempt, void> {
    yield t.boot_ms;
    base.start(ref);
    const target: GrantTarget = { run_id: t.run_id, execution_generation: generation, audience: 'executor.bootstrap' };
    const grant = await security.issue(target, GRANT_TTL_MS);
    if (!grant.ok) { emit('grant_refused', { run_id: t.run_id, code: grant.code }); await failClosed(t, generation, ref); return 'failed_closed'; }
    if (t.faults.has('expired_grant') && generation === 1) { fault(t, 'expired_grant'); yield GRANT_TTL_MS + 1000; }
    const permit = await security.redeem(grant.value.token, target);
    if (!permit.ok) { emit('grant_refused', { run_id: t.run_id, code: permit.code }); await failClosed(t, generation, ref); return 'failed_closed'; }
    const lease = await control.lease({ run_id: t.run_id, execution_generation: generation, request_nonce: `req-${t.run_id}-g${generation}`, identity: t.identity });
    if (!lease.ok) { await failClosed(t, generation, ref); return 'failed_closed'; }
    emit('exec_start', { run_id: t.run_id, generation, region: ref.region });
    let progress = 0;
    if (recovering) {
      yield t.restore_ms;
      progress = t.acked?.progress ?? 0;
      emit('recovery', { run_id: t.run_id, from_generation: generation - 1, to_generation: generation, restored_ref: t.acked?.ref ?? null, restore_ms: t.restore_ms });
    }
    const call: RunnerCall = { run_id: t.run_id, execution_generation: generation, lease_id: lease.value.lease_id, identity: t.identity };
    if (t === firstOfTenant.get(t.tenant) && generation === 1) await isolationProbes(t, call, generation);
    let alive = true, beat = 0, checkpointed = t.acked !== null && recovering;
    const failAt = Math.floor(t.work_ms * 0.75);
    for (;;) {
      if (alive && progress >= t.work_ms) break;
      const step = alive ? Math.min(HEARTBEAT_MS, t.work_ms - progress) : HEARTBEAT_MS;
      yield step;
      if (alive) progress += step;
      if (t.reaped && t.reaped.execution_generation > generation) {
        if (alive || t.faults.has('missed_heartbeat')) {
          const late = await control.complete({ ...call, manifest_ref: `manifest-${t.run_id}-g${generation}` });
          if (!late.ok) emit('stale_callback_refused', { run_id: t.run_id, code: late.code });
        }
        return 'lost';
      }
      if (!alive) continue;
      if (generation === 1 && progress >= failAt && t.faults.has('missed_heartbeat')) { fault(t, 'missed_heartbeat'); alive = false; continue; }
      if (generation === 1 && progress >= failAt && t.faults.has('forced_termination')) { fault(t, 'forced_termination'); base.kill(ref); alive = false; continue; }
      const hb = await control.heartbeat({ ...call, sequence: ++beat });
      if (!hb.ok) { await failClosed(t, generation, ref); return 'failed_closed'; }
      if (!checkpointed && progress >= t.work_ms / 2) { checkpointed = true; yield* checkpoint(t, call, generation, progress); }
    }
    // Final artifact: the broker verifies it before completion may name it.
    const manifest = `manifest-${t.run_id}-g${generation}`;
    if (!(await control.uploadFence(call)).ok) { await failClosed(t, generation, ref); return 'failed_closed'; }
    objects.set(manifest, objectFor(t, manifest, generation));
    verifiedManifests.add(`${t.run_id}|${generation}|${manifest}`);
    t.last = { call, manifest };
    if (t.faults.has('cancel_races_completion')) {
      fault(t, 'cancel_races_completion');
      const complete = () => brokerComplete(t, call, manifest), cancel = () => control.requestCancel(t.run_id, generation);
      // Whichever call is made first takes the run's transaction first; even and odd tasks race in opposite orders.
      let pc: ReturnType<typeof complete>, px: ReturnType<typeof cancel>;
      if (t.index % 2 === 0) { pc = complete(); px = cancel(); } else { px = cancel(); pc = complete(); }
      const [c, x] = await Promise.all([pc, px]);
      if (x.ok) {
        if (c.ok) throw new Error('Completion and cancellation both succeeded');
        await stopAndClean(ref);
        await control.acknowledgeCleanup(t.run_id, x.value.execution_generation);
        return 'cancelled';
      }
      if (!c.ok) { await failClosed(t, generation, ref); return 'failed_closed'; }
    } else {
      const first = await brokerComplete(t, call, manifest);
      if (t.faults.has('lost_callback')) { fault(t, 'lost_callback'); yield 2000; await brokerComplete(t, call, manifest); }
      if (!first.ok) { await failClosed(t, generation, ref); return 'failed_closed'; }
    }
    value(base.finish(ref, manifest), 'finish'); stopped(ref);
    await provider.collect(ref);
    await provider.cleanup(ref);
    await control.acknowledgeCleanup(t.run_id, generation);
    return 'completed';
  }

  async function* publish(t: Task, generation: number): AsyncGenerator<Step, string, void> {
    const manifest = `manifest-${t.run_id}-g${generation}`, pr_ref = `pr-${t.run_id}`;
    const target: GrantTarget = { run_id: t.run_id, execution_generation: generation, audience: 'integration.publish', object_ref: manifest, region: REGION };
    const gate = async () => { const g = await security.issue(target); if (!g.ok) return g; return security.redeem(g.value.token, target); };
    const early = await gate();
    if (early.ok) { emit('deploy', { run_id: t.run_id, pr_ref }); return 'deployed'; }
    emit('deploy_refused', { run_id: t.run_id, code: early.code, stage: 'before_review' });
    yield between(1000, 4000);
    approvals.add(`${t.run_id}|${manifest}`);
    emit('review', { run_id: t.run_id, pr_ref, decision: 'approved' });
    const permit = await gate();
    if (!permit.ok) { emit('deploy_refused', { run_id: t.run_id, code: permit.code, stage: 'after_review' }); return 'failed_closed'; }
    if (t.faults.has('integration_conflict')) { fault(t, 'integration_conflict'); emit('git_op', { op: 'merge_conflict', run_id: t.run_id }); return 'integration_conflict'; }
    emit('git_op', { op: 'merge', run_id: t.run_id });
    emit('deploy', { run_id: t.run_id, pr_ref });
    return 'deployed';
  }

  async function* deliver(t: Task): AsyncGenerator<Step, string, void> {
    if (!(await security.register(t.spec, t.sponsor)).ok) return 'refused';
    if (!(await control.register(t.spec)).ok) return 'refused';
    let generation = 1, recovering = false;
    for (;;) {
      const ref = yield* provision(t, specAt(t, generation));
      if (!ref) { await failClosed(t, generation, null); return 'failed_closed'; }
      const outcome = yield* attempt(t, generation, ref, recovering);
      if (outcome === 'completed') return yield* publish(t, generation);
      if (outcome !== 'lost') return outcome;
      await stopAndClean(ref);
      const next = t.reaped!;
      if (next.state !== 'queued') return 'failed_closed';
      if (!(await control.acknowledgeCleanup(t.run_id, next.execution_generation)).ok) return 'failed_closed';
      if (!(await security.advance(specAt(t, next.execution_generation))).ok) { await failClosed(t, next.execution_generation, null); return 'failed_closed'; }
      generation = next.execution_generation; recovering = true;
    }
  }

  async function* redeliver(t: Task): AsyncGenerator<Step, void, void> {
    fault(t, 'queue_redelivery');
    const reg = await control.register(t.spec);
    const made = await provider.create(t.spec);
    const current = reg.ok ? reg.value.execution_generation : 1;
    const lease = await control.lease({ run_id: t.run_id, execution_generation: current, request_nonce: `redelivery-${t.run_id}`, identity: t.identity });
    if (lease.ok) {
      emit('exec_start', { run_id: t.run_id, generation: current, region: made.ok ? made.value.ref.region : REGION });
      await brokerComplete(t, { run_id: t.run_id, execution_generation: current, lease_id: lease.value.lease_id, identity: t.identity }, `manifest-${t.run_id}-g${current}`);
    }
    if (t.last) await brokerComplete(t, t.last.call, t.last.manifest);
    emit('redelivery_absorbed', { run_id: t.run_id, lease: lease.ok ? 'ok' : lease.code });
    yield 0;
  }

  async function* taskProc(t: Task): Proc {
    yield t.arrival_ms;
    emit('enqueued', { run_id: t.run_id });
    yield 'slot';
    emit('admitted', { run_id: t.run_id });
    const outcome = yield* deliver(t);
    emit('run_final', { run_id: t.run_id, outcome });
    if (t.faults.has('queue_redelivery')) { yield 500; yield* redeliver(t); }
    release(); live--;
  }

  async function* reaper(): Proc {
    while (live > 0) {
      yield HEARTBEAT_MS;
      for (const r of await control.reap()) { const t = tasks.get(r.run_id); if (t) t.reaped = { execution_generation: r.execution_generation, state: r.state }; }
    }
  }

  const work: Task[] = [];
  for (let i = 0; i < config.tasks; i++) work.push(track(makeTask(i, i % config.tenants, `syn5573-v${i % config.tenants}-k${i}`, false)));
  const firstOfTenant = new Map<number, Task>();
  for (const t of work) if (!firstOfTenant.has(t.tenant)) firstOfTenant.set(t.tenant, t);
  for (const t of work) { push(taskProc(t), 0); live++; }
  push(reaper(), 0);
  while (queue.length) {
    queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const { at, proc } = queue.shift()!;
    world.now = Math.max(world.now, at);
    const step = await proc.next();
    if (step.done) continue;
    if (step.value === 'slot') { if (freeSlots > 0) { freeSlots--; push(proc, world.now); } else waiters.push(proc); }
    else push(proc, world.now + step.value);
  }

  // --- Reconciliation window: stop and clean every execution the control plane knows of ---
  const ended_at = world.now;
  world.now = ended_at + 1000;
  for (const t of tasks.values()) for (const ref of t.refs) {
    if (!stoppedExec.has(ref.execution_id)) await provider.terminate(ref);
    if (!cleanedExec.has(ref.execution_id)) await provider.cleanup(ref);
  }

  const observations = { source: { provider_kind: MOCK_PROVIDER_KIND }, runs, events, window: { ended_at, reconciliation_window_ms: RECONCILIATION_WINDOW_MS } };
  const report = buildReport({ observations, commit, config: { ...config, heartbeat_ms: HEARTBEAT_MS, missed_beat_limit: MISSED_BEATS,
    max_generations: MAX_GENERATIONS, reconciliation_window_ms: RECONCILIATION_WINDOW_MS, provider: MOCK_PROVIDER_KIND,
    region: `${REGION} (synthetic)`, image: 'synthetic digest', workload_class: 'coding_trusted', physical_creates: base.stats.physical_creates } });
  return { observations, report, markdown: renderMarkdown(report) };
}
