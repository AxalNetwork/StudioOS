/** D5572 (#5572): fail-closed contract tests for the disabled outbound-only runner protocol; synthetic identities, keys generated at runtime, injected clock, no cluster or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as real from '../src/services/agents/byocRunner.ts';
import type { ByocActor, ByocAudit, ByocState, EnforcementManifest, ExecutionConsent, RequestKind } from '../src/services/agents/byocRunner.ts';
import { createWorkspaceSecurity, type WorkspaceSecurityRun } from '../src/services/agents/workspaceSecurity.ts';
import type { WorkspaceResult, WorkspaceSpec } from '../src/services/agents/workspaceSpec.ts';
import { memoryRunnerStore, specFixture } from './_workspace_fake_5565.ts';

type Mod = typeof real;
const value = <T>(r: WorkspaceResult<T>): T => { assert.ok(r.ok, JSON.stringify(r)); return r.value; };
const denied = (r: WorkspaceResult<unknown>, code: string) => { assert.equal(r.ok, false, 'expected ' + code); if (!r.ok) assert.equal(r.code, code); };
const ADMIN: ByocActor = { member_id: 71, kind: 'customer_admin' };
const OPERATOR: ByocActor = { member_id: 72, kind: 'axal_operator' };
const FULL: EnforcementManifest = { features: [...real.ENFORCEMENT_FEATURES], runtime_class: 'gvisor', runner_version: '0.1.0' };
const LIMITS = { workload_classes: ['coding_trusted', 'coding_untrusted'], max_concurrent: 2, cpu_max: 2, memory_mb_max: 2048,
  disk_mb_max: 4096, duration_s_max: 600, egress_hosts: ['api.example.com'], checkpoint_restore: true, shell: true };
const POLICY = { registration_ttl_ms: 60_000, credential_ttl_ms: 300_000, clock_skew_ms: 5000, offline_after_ms: 10_000,
  conformance_max_age_ms: 3_600_000, heartbeat_ms: 1000, missed_beat_limit: 2, max_generations: 3 };
const byocSpec = (changes: Partial<WorkspaceSpec> = {}) => specFixture({ allowed_providers: ['byoc'], ...changes });

function memoryByocStore() {
  let state: ByocState = { registrations: new Map(), runners: new Map(), assignments: new Map() };
  let pending: Promise<unknown> = Promise.resolve();
  return {
    async transaction<T>(change: (s: ByocState) => T): Promise<T> {
      const next = pending.then(() => { const copy = structuredClone(state); const result = change(copy); state = copy; return result; });
      pending = next.catch(() => {}); return next;
    },
    inspect: () => structuredClone(state),
  };
}

async function fixture(mod: Mod = real) {
  let now = 1_000_000, counter = 0;
  const flags = { enabled: true, authorized: true };
  const specs = new Map<string, WorkspaceSpec>(), consents = new Map<string, ExecutionConsent>();
  const audit: ByocAudit[] = [], revokedGrants: string[] = [];
  const store = memoryByocStore(), runStore = memoryRunnerStore();
  const control = mod.createByocRunnerControl({
    enabled: () => flags.enabled, clock: () => now, nonce: () => `n${String(++counter).padStart(10, '0')}`, policy: POLICY, store, runStore,
    authorize: async () => flags.authorized, specOf: async id => specs.get(id) ?? null, consentOf: async spec => consents.get(spec.run_id) ?? null,
    manifestAllowed: (_spec, ref) => ref.startsWith('manifest-'), revokeGrants: async id => { revokedGrants.push(id); }, audit: async e => { audit.push(e); },
  });
  let requests = 0;
  const keypair = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
  const publicJwk = async (key: CryptoKey) => { const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', key); return { kty, crv, x, y } as never; };
  type Runner = { id: string; keyId: string; privateKey: CryptoKey; cluster: { cluster_id: string; region: string; namespace_prefix: string } };
  const sign = (r: Runner, kind: RequestKind, body: unknown, opts: { iat?: number; nonce?: string; key?: CryptoKey; keyId?: string } = {}) =>
    mod.signRunnerRequest(opts.key ?? r.privateKey, { v: 1, runner_id: r.id, key_id: opts.keyId ?? r.keyId, iat: opts.iat ?? now,
      nonce: opts.nonce ?? `req-${String(++requests).padStart(12, '0')}`, kind, body });
  async function enrollRunner(o: { manifest?: EnforcementManifest; cluster_id?: string; region?: string; venture?: object; attest?: boolean; conformance?: boolean } = {}): Promise<Runner> {
    const cluster = { cluster_id: o.cluster_id ?? 'cluster-one', region: o.region ?? 'weur', namespace_prefix: 'axal' };
    const reg = value(await control.createRegistration(ADMIN, { venture: o.venture ?? { tenant_id: 11, company_id: 21, project_ids: [31] }, cluster, limits: LIMITS }));
    const pair = await keypair(), jwk = await publicJwk(pair.publicKey), keyId = await mod.jwkThumbprint(jwk);
    const runner: Runner = { id: reg.registration_id, keyId, privateKey: pair.privateKey, cluster };
    value(await control.enroll(await sign(runner, 'enroll', { code: reg.code, jwk, manifest: o.manifest ?? FULL })));
    if (o.attest !== false) value(await control.attest(ADMIN, runner.id, { key_id: keyId, manifest: o.manifest ?? FULL }));
    if (o.attest !== false && o.conformance !== false) value(await control.recordConformance(runner.id, true));
    return runner;
  }
  function consentFor(spec: WorkspaceSpec, r: { cluster: { cluster_id: string; region: string } } | null, mode: 'axal_managed' | 'customer_managed' = 'customer_managed') {
    const placement = { mode, tenant_id: spec.tenant_id, company_id: spec.company_id, cluster_id: mode === 'customer_managed' ? r!.cluster.cluster_id : null, region: r?.cluster.region ?? 'weur' };
    return { ...placement, version: 1, member_id: 71, statement: mod.consentStatement(placement) };
  }
  async function queue(spec = byocSpec(), r?: Runner) {
    specs.set(spec.run_id, spec); value(await control.runs.register(spec));
    if (r) consents.set(spec.run_id, consentFor(spec, r));
    return spec;
  }
  const lease = async (r: Runner, spec: WorkspaceSpec, generation = spec.execution_generation) =>
    control.lease(await sign(r, 'lease', { run_id: spec.run_id, execution_generation: generation, request_nonce: `lease-${String(++requests).padStart(8, "0")}` }));
  const report = async (r: Runner, spec: WorkspaceSpec, l: { lease_id: string; namespace: string }, sequence: number, generation = spec.execution_generation) =>
    control.report(await sign(r, 'report', { run_id: spec.run_id, execution_generation: generation, lease_id: l.lease_id, sequence, state: 'running', namespace: l.namespace }));
  return { mod, control, flags, specs, consents, audit, revokedGrants, store, runStore, sign, enrollRunner, consentFor, queue, lease, report, keypair, publicJwk,
    time: (at: number) => { now = at; }, now: () => now };
}

// Mutation checked: signature verification forced true → the forged request is accepted and `signature_invalid` fails;
// the unattested check removed from placement → the pending runner's lease reaches D5565 and `runner_unattested` fails.
test('a rogue runner (unknown, forged or unattested) is refused and changes nothing', async () => {
  const f = await fixture();
  const good = await f.enrollRunner(), spec = await f.queue(byocSpec(), good);
  const rogue = await f.keypair();
  denied(await f.lease({ ...good, id: 'reg-n9999999999' }, spec), 'runner_unknown');
  denied(await f.control.lease(await f.sign(good, 'lease', { run_id: spec.run_id, execution_generation: 1, request_nonce: 'forged-1' }, { key: rogue.privateKey })), 'signature_invalid');
  denied(await f.control.lease({ payload: 'not-json', signature: 'AA' }), 'request_invalid');
  denied(await f.control.lease(await f.sign(good, 'report', {})), 'request_invalid');   // kind confusion
  denied(await f.control.lease(await f.sign(good, 'lease', { run_id: spec.run_id, execution_generation: 1, request_nonce: 'old-1' }, { iat: f.now() - 6000 })), 'request_expired');
  const pending = await f.enrollRunner({ attest: false, cluster_id: 'cluster-two' });
  denied(await f.lease(pending, spec), 'runner_unattested');
  denied(real.placementDecision(spec, { ...f.store.inspect().runners.get(pending.id)!, status: 'pending_attestation' }, f.consentFor(spec, pending), f.now(), POLICY), 'runner_unattested');
  // Attestation must name the key and manifest the runner presented, by a customer admin.
  const other = await f.enrollRunner({ attest: false, cluster_id: 'cluster-three' });
  denied(await f.control.attest(ADMIN, other.id, { key_id: good.keyId, manifest: FULL }), 'attestation_mismatch');
  denied(await f.control.attest(ADMIN, other.id, { key_id: other.keyId, manifest: { ...FULL, runtime_class: 'kata' } }), 'attestation_mismatch');
  denied(await f.control.attest(OPERATOR, other.id, { key_id: other.keyId, manifest: FULL }), 'admin_not_authorized');
  // A registration code is one-time; a wrong code burns it.
  const reg = value(await f.control.createRegistration(ADMIN, { venture: { tenant_id: 11, company_id: 21, project_ids: null }, cluster: { cluster_id: 'cluster-four', region: 'weur', namespace_prefix: 'axal' }, limits: LIMITS }));
  const pair = await f.keypair(), jwk = await f.publicJwk(pair.publicKey), keyId = await real.jwkThumbprint(jwk);
  const r = { id: reg.registration_id, keyId, privateKey: pair.privateKey, cluster: { cluster_id: 'cluster-four', region: 'weur', namespace_prefix: 'axal' } };
  denied(await f.control.enroll(await f.sign(r, 'enroll', { code: 'A'.repeat(43), jwk, manifest: FULL })), 'registration_invalid');
  denied(await f.control.enroll(await f.sign(r, 'enroll', { code: reg.code, jwk, manifest: FULL })), 'registration_invalid');
  assert.equal(f.store.inspect().assignments.size, 0);
  assert.equal(f.runStore.inspect().get(spec.run_id)!.state, 'queued');
});

// Mutation checked: the expiry check made `if (false)` → the expired key's lease is accepted and `credential_expired` fails;
// revoke not fencing held runs → the revoked runner's run keeps generation 1 and the fence assertion fails.
test('a rotated, expired or revoked identity is refused, and revocation fences every run it held', async () => {
  const f = await fixture();
  const r = await f.enrollRunner(), spec = await f.queue(byocSpec(), r);
  const next = await f.keypair(), jwk = await f.publicJwk(next.publicKey), newKeyId = await real.jwkThumbprint(jwk);
  denied(await f.control.rotate(await f.sign(r, 'rotate', { jwk, proof: await real.signRotationProof(r.privateKey, r.id, r.keyId, newKeyId) })), 'rotation_invalid');
  value(await f.control.rotate(await f.sign(r, 'rotate', { jwk, proof: await real.signRotationProof(next.privateKey, r.id, r.keyId, newKeyId) })));
  denied(await f.lease(r, spec), 'credential_rotated');
  const rotated = { ...r, keyId: newKeyId, privateKey: next.privateKey };
  const l = value(await f.lease(rotated, spec));
  f.time(f.now() + POLICY.credential_ttl_ms);
  denied(await f.report(rotated, spec, l, 1), 'credential_expired');
  f.time(f.now() - POLICY.credential_ttl_ms + 500);
  value(await f.report(rotated, spec, l, 1));
  const revoked = value(await f.control.revoke(ADMIN, r.id));
  assert.equal(revoked.fenced, 1);
  assert.equal(f.runStore.inspect().get(spec.run_id)!.generation, 2);
  assert.deepEqual(f.revokedGrants, [spec.run_id]);
  denied(await f.report(rotated, spec, l, 2), 'runner_revoked');
  denied(await f.control.cleanup(await f.sign(rotated, 'cleanup', { run_id: spec.run_id, execution_generation: 1 })), 'runner_revoked');
  // The cluster's own admin confirms cleanup; only then may D5565 lease the run again.
  f.flags.authorized = false; denied(await f.control.confirmCleanup(ADMIN, spec.run_id), 'admin_not_authorized'); f.flags.authorized = true;
  denied(await f.control.confirmCleanup(OPERATOR, spec.run_id), 'admin_not_authorized');
  value(await f.control.confirmCleanup(ADMIN, spec.run_id));
  assert.equal(f.runStore.inspect().get(spec.run_id)!.cleanup_required, false);
  f.flags.authorized = false; denied(await f.control.revoke(OPERATOR, r.id), 'admin_not_authorized');
});

// Mutation checked: the reservation's `assignments.has` check removed → the second runner's attempt overwrites and then
// deletes the first runner's assignment, and the first runner's next report fails with `run_not_assigned`.
test('a duplicate lease is refused, whether from a second runner or the same runner twice, and leaves the holder intact', async () => {
  const f = await fixture();
  const a = await f.enrollRunner(), b = await f.enrollRunner({ cluster_id: 'cluster-two' });
  const spec = await f.queue(byocSpec(), a);
  const l = value(await f.lease(a, spec));
  denied(await f.lease(a, spec), 'lease_unavailable');
  denied(await f.lease(b, spec), 'consent_missing');     // consent names cluster-one only
  f.consents.set(spec.run_id, f.consentFor(spec, b));
  denied(await f.lease(b, spec), 'lease_unavailable');
  f.consents.set(spec.run_id, f.consentFor(spec, a));
  value(await f.report(a, spec, l, 1));
  assert.deepEqual(f.store.inspect().runners.get(b.id)!.active_runs, []);
  // Concurrent attempts: exactly one wins.
  const s2 = await f.queue(byocSpec({ run_id: 'run-two', idempotency_key: 'run-two:workspace:1' }), a);
  const both = await Promise.all([f.lease(a, s2), f.lease(a, s2)]);
  assert.equal(both.filter(x => x.ok).length, 1);
  // The delegated concurrency limit (2) is a scheduling limit, not a queue.
  const s3 = await f.queue(byocSpec({ run_id: 'run-three', idempotency_key: 'run-three:workspace:1' }), a);
  denied(await f.lease(a, s3), 'scheduling_limit');
});

// Mutation checked: the `cluster_offline` placement check removed → the quiet cluster is placed and that assertion fails;
// sweep not recording the reaped generation → the reconnecting runner's cleanup is refused `lease_still_live`.
test('an offline cluster is not placed; its lease is fenced, late callbacks refused, and reconnection is told to stop', async () => {
  const f = await fixture();
  const r = await f.enrollRunner(), spec = await f.queue(byocSpec(), r);
  const l = value(await f.lease(r, spec));
  f.time(f.now() + POLICY.offline_after_ms);
  assert.equal(await f.control.available(r.id), false);
  denied(real.placementDecision(spec, f.store.inspect().runners.get(r.id)!, f.consentFor(spec, r), f.now(), POLICY), 'cluster_offline');
  const swept = await f.control.sweep();
  assert.deepEqual(swept, { fenced: 1, offline: 1 });
  assert.deepEqual(f.revokedGrants, [spec.run_id]);
  const fencedRun = f.runStore.inspect().get(spec.run_id)!;
  assert.equal(fencedRun.generation, 2); assert.equal(fencedRun.cleanup_required, true);
  denied(await f.report(r, spec, l, 1), 'stale_generation');
  const back = value(await f.control.reconcile(await f.sign(r, 'reconcile', { runs: [{ run_id: spec.run_id, execution_generation: 1 }, { run_id: 'run-unknown', execution_generation: 1 }] })));
  assert.deepEqual(back.directives.map(d => d.action), ['stop', 'stop']);
  assert.equal(await f.control.available(r.id), true);
  // No relaunch until the cluster confirms the namespace is gone.
  denied(await f.lease(r, spec, 2), 'lease_unavailable');
  value(await f.control.cleanup(await f.sign(r, 'cleanup', { run_id: spec.run_id, execution_generation: 1 })));
  value(await f.lease(r, spec, 2));
});

// Mutation checked: the request-nonce check removed → the replayed envelope is accepted and `request_replay` fails.
test('a stale callback (old generation, replayed sequence or replayed request) is refused', async () => {
  const f = await fixture();
  const r = await f.enrollRunner(), spec = await f.queue(byocSpec(), r);
  const l = value(await f.lease(r, spec));
  const signed = await f.sign(r, 'report', { run_id: spec.run_id, execution_generation: 1, lease_id: l.lease_id, sequence: 1, state: 'running', namespace: l.namespace });
  value(await f.control.report(signed));
  denied(await f.control.report(signed), 'request_replay');
  denied(await f.report(r, spec, l, 1), 'heartbeat_replay');
  value(await f.report(r, spec, l, 2));
  value(await f.control.kill(OPERATOR, spec.run_id));
  assert.deepEqual(f.revokedGrants, [spec.run_id]);
  denied(await f.report(r, spec, l, 3), 'stale_generation');
  denied(await f.control.complete(await f.sign(r, 'complete', { run_id: spec.run_id, execution_generation: 1, lease_id: l.lease_id, manifest_ref: 'manifest-a' })), 'stale_generation');
  const directives = value(await f.control.reconcile(await f.sign(r, 'reconcile', { runs: [{ run_id: spec.run_id, execution_generation: 1 }] }))).directives;
  assert.deepEqual(directives, [{ run_id: spec.run_id, execution_generation: 1, action: 'stop' }]);
});

// Mutation checked: the namespace comparison made `if (false)` → the report naming another tenant's namespace is accepted;
// `inVenture` skipped in placement → the other venture's run is leased and `venture_scope_denied` fails.
test('namespace and tenant escalation are refused', async () => {
  const f = await fixture();
  const r = await f.enrollRunner(), spec = await f.queue(byocSpec(), r);
  const foreign = await f.queue(byocSpec({ run_id: 'run-foreign', idempotency_key: 'run-foreign:workspace:1', tenant_id: 12, company_id: 22, project_id: 32 }), r);
  f.consents.set(foreign.run_id, f.consentFor(foreign, r));
  denied(await f.lease(r, foreign), 'venture_scope_denied');
  const otherProject = await f.queue(byocSpec({ run_id: 'run-p33', idempotency_key: 'run-p33:workspace:1', project_id: 33 }), r);
  denied(await f.lease(r, otherProject), 'venture_scope_denied');
  const l = value(await f.lease(r, spec));
  assert.match(l.namespace, /^axal-11-[a-f0-9]{16}$/);
  assert.notEqual(l.namespace, await real.runNamespace(r.cluster, foreign));
  denied(await f.report(r, spec, { ...l, namespace: await real.runNamespace(r.cluster, foreign) }, 1), 'namespace_escalation');
  denied(await f.report(r, spec, { ...l, namespace: 'kube-system' }, 1), 'namespace_escalation');
  // Another runner of the same venture cannot report on a run it does not hold.
  const peer = await f.enrollRunner({ cluster_id: 'cluster-two' });
  denied(await f.report(peer, spec, l, 1), 'run_not_assigned');
  value(await f.report(r, spec, l, 1));
});

// Mutation checked: the customer-policy egress check made `if (false)` → the host the customer never allowed is placed.
test('forbidden egress in the policy is refused before placement', async () => {
  const f = await fixture();
  const r = await f.enrollRunner();
  const allow = (hostname: string) => byocSpec({ run_id: `run-${hostname.replaceAll('.', '-')}`, idempotency_key: `k-${hostname}`, network_policy: { mode: 'allowlist', destinations: [{ hostname, port: 443 }] } });
  const ok = await f.queue(allow('api.example.com'), r);
  value(await f.lease(r, ok));
  const notCustomer = await f.queue(allow('pastebin.example.org'), r);
  const refusal = await f.lease(r, notCustomer);
  denied(refusal, 'egress_forbidden'); assert.equal(!refusal.ok && refusal.capability, 'customer_policy');
  for (const hostname of ['metadata.google.internal', 'cache.local', 'printer.home']) {
    const result = real.egressDecision(allow(hostname), { ...LIMITS, egress_hosts: [hostname] } as never);
    denied(result, 'egress_forbidden'); assert.equal(!result.ok && result.capability, 'destination');
  }
  // A runner that cannot enforce an FQDN allowlist gets no allowlist work at all.
  const denyOnly = await f.enrollRunner({ cluster_id: 'cluster-two', manifest: { ...FULL, features: FULL.features.filter(x => x !== 'egress_allowlist_enforced') } });
  const s = await f.queue(byocSpec({ run_id: 'run-x', idempotency_key: 'k-x', network_policy: { mode: 'allowlist', destinations: [{ hostname: 'api.example.com', port: 443 }] } }), denyOnly);
  const gap = await f.lease(denyOnly, s); denied(gap, 'enforcement_missing'); assert.equal(!gap.ok && gap.capability, 'egress_allowlist_enforced');
});

// Mutation checked: `if (gaps.length)` made `if (false)` → a runner without `deny_host_path` is placed and the gap assertion fails.
test('a runner missing any enforcement feature is refused untrusted work; D5567 reads the same evidence', async () => {
  const f = await fixture();
  const spec = byocSpec(), at = 1_000_000;
  const base = (manifest: EnforcementManifest, conformance_at: number | null = at) => ({ manifest, conformance_at, cluster: { cluster_id: 'c-1', region: 'weur', namespace_prefix: 'axal' }, limits: LIMITS as never });
  assert.deepEqual(real.enforcementGaps(base(FULL), spec, at, POLICY.conformance_max_age_ms), []);
  for (const feature of [...real.BASE_ENFORCEMENT, ...real.UNTRUSTED_ENFORCEMENT]) {
    assert.deepEqual(real.enforcementGaps(base({ ...FULL, features: FULL.features.filter(x => x !== feature) }), spec, at, POLICY.conformance_max_age_ms), [feature], feature);
  }
  assert.deepEqual(real.enforcementGaps(base({ ...FULL, runtime_class: 'runc' }), spec, at, POLICY.conformance_max_age_ms), ['sandboxed_runtime_class']);
  assert.deepEqual(real.enforcementGaps(base(FULL, null), spec, at, POLICY.conformance_max_age_ms), ['conformance_unverified']);
  assert.deepEqual(real.enforcementGaps(base(FULL, at - POLICY.conformance_max_age_ms), spec, at, POLICY.conformance_max_age_ms), ['conformance_unverified']);
  // Trusted coding work needs the base set only.
  assert.deepEqual(real.enforcementGaps(base({ ...FULL, runtime_class: 'runc', features: [...real.BASE_ENFORCEMENT] }, null), byocSpec({ workload_class: 'coding_trusted' }), at, POLICY.conformance_max_age_ms), []);
  // Through the real lease path.
  const weak = await f.enrollRunner({ manifest: { ...FULL, features: FULL.features.filter(x => x !== 'deny_host_path') } });
  const queued = await f.queue(byocSpec(), weak);
  const refusal = await f.lease(weak, queued); denied(refusal, 'enforcement_missing'); assert.equal(!refusal.ok && refusal.capability, 'deny_host_path');
  const unprobed = await f.enrollRunner({ cluster_id: 'cluster-two', conformance: false });
  f.consents.set(queued.run_id, f.consentFor(queued, unprobed));
  denied(await f.lease(unprobed, queued), 'enforcement_missing');
  // The same runner as D5567 provider evidence: a missing socket denial fails that gate too.
  const security = (evidence: ReturnType<typeof real.byocProviderEvidence>) => crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']).then(rootKey => createWorkspaceSecurity({
    enabled: () => true, halted: () => false, clock: () => at, nonce: () => 'nonce-00000001', rootKey: rootKey as CryptoKey,
    store: { transaction: async <T>(fn: (runs: Map<string, WorkspaceSecurityRun>) => Promise<T> | T) => fn(new Map()) },
    authorize: async () => ({ allowed: true, revision: 1, approved: false }),
    image: async digest => ({ digest, signature_verified: true, provenance_verified: true, sbom_verified: true, scan_passed: true, revoked: false }),
    provider: async () => evidence, object: async () => null, encryptionKey: async () => null, audit: async () => {} }));
  value(await (await security(real.byocProviderEvidence(base(FULL), at, POLICY.conformance_max_age_ms))).eligibility(spec));
  denied(await (await security(real.byocProviderEvidence(base({ ...FULL, features: FULL.features.filter(x => x !== 'deny_container_runtime_socket') }), at, POLICY.conformance_max_age_ms))).eligibility(spec), 'provider_security_denied');
  denied(await (await security(real.byocProviderEvidence(base({ ...FULL, runtime_class: 'runc' }), at, POLICY.conformance_max_age_ms))).eligibility(spec), 'hostile_workload_denied');
});

// Mutation checked: the cross-border return made unconditional → the EU-to-US resume without policy is allowed.
test('resume from a checkpoint crosses a border only under policy, never in plaintext', () => {
  const spec = byocSpec({ allowed_providers: ['cloudflare', 'byoc'], allowed_regions: ['weur', 'eeur', 'enam'], checkpoint_manifest_ref: 'ckpt-1' });
  const checkpoint = { ref: 'ckpt-1', tenant_id: 11, run_id: spec.run_id, region: 'weur', approved_restore_regions: ['eeur', 'enam'], key_id: 'key-synthetic', sealed: true };
  const jurisdictionOf = (r: string) => ({ weur: 'eu', eeur: 'eu', enam: 'us' } as Record<string, string>)[r] ?? null;
  const closed = { cross_border_allowed: false, jurisdictionOf }, open = { cross_border_allowed: true, jurisdictionOf };
  const cf = (region: string) => ({ mode: 'axal_managed' as const, provider: 'cloudflare' as const, region, cluster_id: null });
  const byoc = (region: string) => ({ mode: 'customer_managed' as const, provider: 'byoc' as const, region, cluster_id: 'cluster-one' });
  assert.deepEqual(value(real.resumeDecision(spec, checkpoint, cf('weur'), closed)), { transfer: 'none' });
  assert.deepEqual(value(real.resumeDecision(spec, checkpoint, byoc('eeur'), closed)), { transfer: 'in_jurisdiction' });
  denied(real.resumeDecision(spec, checkpoint, cf('enam'), closed), 'cross_border_denied');
  assert.deepEqual(value(real.resumeDecision(spec, checkpoint, cf('enam'), open)), { transfer: 'cross_border' });
  denied(real.resumeDecision(spec, { ...checkpoint, sealed: false }, cf('enam'), open), 'plaintext_checkpoint');
  denied(real.resumeDecision(spec, { ...checkpoint, sealed: false }, cf('weur'), open), 'plaintext_checkpoint');
  denied(real.resumeDecision(spec, { ...checkpoint, approved_restore_regions: [] }, cf('eeur'), open), 'restore_region_not_approved');
  denied(real.resumeDecision(spec, checkpoint, cf('wnam'), open), 'region_not_allowed');
  denied(real.resumeDecision({ ...spec, allowed_regions: ['weur', 'eeur', 'enam', 'apac'] }, { ...checkpoint, approved_restore_regions: ['apac'] }, cf('apac'), open), 'jurisdiction_unknown');
  denied(real.resumeDecision(spec, { ...checkpoint, tenant_id: 12 }, cf('weur'), open), 'checkpoint_not_authorized');
  denied(real.resumeDecision(spec, checkpoint, { ...byoc('eeur'), cluster_id: null }, open), 'execution_mode_mismatch');
  denied(real.resumeDecision(spec, checkpoint, { ...cf('eeur'), provider: 'byoc' }, open), 'execution_mode_mismatch');
});

// Mutation checked: the lease's consent check removed → the Axal-managed consent places customer-managed work;
// the statement comparison made `return true` → consent recorded against the other mode's words is accepted.
test('consent tells Axal-managed from customer-managed execution and covers only its own mode, cluster and words', async () => {
  const axal = real.consentStatement({ mode: 'axal_managed', cluster_id: null, region: 'weur' });
  const customer = real.consentStatement({ mode: 'customer_managed', cluster_id: 'cluster-one', region: 'weur' });
  assert.match(axal, /^Axal-managed execution\. .*infrastructure Axal operates/);
  assert.match(customer, /^Customer-managed execution\. .*cluster cluster-one .*your organization operates/);
  assert.match(customer, /network, logs, data retention and compute cost/);
  assert.doesNotMatch(axal, /your organization operates/); assert.doesNotMatch(customer, /infrastructure Axal operates/);
  for (const words of [axal, customer]) assert.doesNotMatch(words, /advis|recommend|fiduciary/i);
  const placement = { mode: 'customer_managed' as const, tenant_id: 11, company_id: 21, cluster_id: 'cluster-one', region: 'weur' };
  const consent = { ...placement, version: 1, member_id: 71, statement: customer };
  assert.equal(real.consentCovers(consent, placement), true);
  assert.equal(real.consentCovers({ ...consent, statement: axal }, placement), false);
  assert.equal(real.consentCovers({ ...consent, mode: 'axal_managed', cluster_id: null, statement: axal }, placement), false);
  assert.equal(real.consentCovers(consent, { ...placement, cluster_id: 'cluster-two' }), false);
  assert.equal(real.consentCovers(consent, { ...placement, region: 'eeur' }), false);
  assert.equal(real.consentCovers({ ...consent, version: 0 }, placement), false);
  assert.equal(real.consentCovers(null, placement), false);
  const f = await fixture();
  const r = await f.enrollRunner(), spec = await f.queue(byocSpec());
  denied(await f.lease(r, spec), 'consent_missing');
  f.consents.set(spec.run_id, f.consentFor(spec, null, 'axal_managed'));
  denied(await f.lease(r, spec), 'consent_missing');
  f.consents.set(spec.run_id, f.consentFor(spec, r));
  value(await f.lease(r, spec));
});

// Mutation checked: `disabled()` made to return false → the off switch admits a registration and `byoc_runner_disabled` fails.
test('the protocol is off and unmounted: every admission refuses while revoke and kill still work; logs carry outcomes only', async () => {
  const f = await fixture();
  const r = await f.enrollRunner(), spec = await f.queue(byocSpec(), r);
  value(await f.lease(r, spec));
  f.flags.enabled = false;
  denied(await f.control.createRegistration(ADMIN, { venture: { tenant_id: 11, company_id: 21, project_ids: null }, cluster: r.cluster, limits: LIMITS }), 'byoc_runner_disabled');
  denied(await f.lease(r, spec), 'byoc_runner_disabled');
  denied(await f.control.reconcile(await f.sign(r, 'reconcile', { runs: [] })), 'byoc_runner_disabled');
  assert.equal(value(await f.control.revoke(OPERATOR, r.id)).fenced, 1);
  for (const event of f.audit) {
    assert.deepEqual(Object.keys(event).filter(k => !['action', 'outcome', 'code', 'count'].includes(k)), []);
    assert.doesNotMatch(JSON.stringify(event), /run-synthetic|reg-|cluster-one|axal-11/);
  }
  const src = new URL('../src/', import.meta.url);
  const routes = readdirSync(new URL('routes/', src)).filter(n => n.endsWith('.ts')).map(n => readFileSync(new URL('routes/' + n, src), 'utf8'));
  for (const text of [...routes, readFileSync(new URL('index.ts', src), 'utf8'), readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8')]) assert.doesNotMatch(text, /byocRunner/);
});

test('mutations: each acceptance case must catch its deliberate break', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'byoc-5572-'));
  let source = readFileSync(new URL('../src/services/agents/byocRunner.ts', import.meta.url), 'utf8');
  source = source.replace("'zod'", JSON.stringify(new URL('../node_modules/zod/index.js', import.meta.url).href));
  for (const name of ['compute', 'runnerProtocol', 'workspaceSecurity', 'workspaceSpec']) source = source.replace(`'./${name}'`, JSON.stringify(new URL(`../src/services/agents/${name}.ts`, import.meta.url).href));
  const journeys: [string, string, string, (m: Mod) => Promise<void>][] = [
    ['rogue signature', 'if (!await verifySignature(known.value.credential!.jwk, decoded.envelope.signature, SIGNING_CONTEXT + decoded.envelope.payload))', 'if (false)', async m => {
      const f = await fixture(m), r = await f.enrollRunner(), spec = await f.queue(byocSpec(), r), rogue = await f.keypair();
      denied(await f.control.lease(await f.sign(r, 'lease', { run_id: spec.run_id, execution_generation: 1, request_nonce: 'forged-1' }, { key: rogue.privateKey })), 'signature_invalid');
    }],
    ['unattested placement', "if (runner.status !== 'active') return workspaceRefusal('runner_unattested', 403);", '', async m => {
      const f = await fixture(m), r = await f.enrollRunner(), spec = byocSpec();
      denied(m.placementDecision(spec, { ...f.store.inspect().runners.get(r.id)!, status: 'pending_attestation' }, f.consentFor(spec, r), f.now(), POLICY), 'runner_unattested');
    }],
    ['credential expiry', 'if (at >= runner.credential.expires_at)', 'if (false)', async m => {
      const f = await fixture(m), r = await f.enrollRunner(), spec = await f.queue(byocSpec(), r);
      f.time(f.now() + POLICY.credential_ttl_ms); denied(await f.lease(r, spec), 'credential_expired');
    }],
    ['revoke fence', 'for (const a of held) if (await fence(a)) fenced++;', '', async m => {
      const f = await fixture(m), r = await f.enrollRunner(), spec = await f.queue(byocSpec(), r); value(await f.lease(r, spec));
      await f.control.revoke(ADMIN, r.id); assert.equal(f.runStore.inspect().get(spec.run_id)!.generation, 2);
    }],
    ['duplicate reservation', "if (state.assignments.has(spec.run_id) || row.active_runs.includes(spec.run_id)) return refuse('lease_unavailable');", '', async m => {
      const f = await fixture(m), a = await f.enrollRunner(), b = await f.enrollRunner({ cluster_id: 'cluster-two' }), spec = await f.queue(byocSpec(), a);
      const l = value(await f.lease(a, spec)); f.consents.set(spec.run_id, f.consentFor(spec, b)); await f.lease(b, spec); value(await f.report(a, spec, l, 1));
    }],
    ['offline placement', "if (now - runner.last_seen >= policy.offline_after_ms) return workspaceRefusal('cluster_offline', 503);", '', async m => {
      const f = await fixture(m), r = await f.enrollRunner(), spec = byocSpec(); f.time(f.now() + POLICY.offline_after_ms);
      denied(m.placementDecision(spec, f.store.inspect().runners.get(r.id)!, f.consentFor(spec, r), f.now(), POLICY), 'cluster_offline');
    }],
    ['sweep cleanup generation', 'if (a && a.cleanup_generation === null) { a.cleanup_generation = r.execution_generation; a.lease_id = null; }', '', async m => {
      const f = await fixture(m), r = await f.enrollRunner(), spec = await f.queue(byocSpec(), r); value(await f.lease(r, spec));
      f.time(f.now() + POLICY.offline_after_ms); await f.control.sweep();
      value(await f.control.cleanup(await f.sign(r, 'cleanup', { run_id: spec.run_id, execution_generation: 1 })));
    }],
    ['request replay', "if (request.nonce in runner.nonces) return refuse('request_replay', 403);", '', async m => {
      const f = await fixture(m), r = await f.enrollRunner(), spec = await f.queue(byocSpec(), r), l = value(await f.lease(r, spec));
      const signed = await f.sign(r, 'report', { run_id: spec.run_id, execution_generation: 1, lease_id: l.lease_id, sequence: 1, state: 'running', namespace: l.namespace });
      value(await f.control.report(signed)); denied(await f.control.report(signed), 'request_replay');
    }],
    ['namespace escalation', 'if (body.namespace !== await runNamespace(runner.cluster, spec))', 'if (false)', async m => {
      const f = await fixture(m), r = await f.enrollRunner(), spec = await f.queue(byocSpec(), r), l = value(await f.lease(r, spec));
      denied(await f.report(r, spec, { ...l, namespace: 'kube-system' }, 1), 'namespace_escalation');
    }],
    ['venture scope', "if (!inVenture(runner.venture, spec)) return workspaceRefusal('venture_scope_denied', 403);", '', async m => {
      const f = await fixture(m), r = await f.enrollRunner(), spec = await f.queue(byocSpec({ tenant_id: 12, company_id: 22, project_id: 32 }), r);
      denied(await f.lease(r, spec), 'venture_scope_denied');
    }],
    ['customer egress', 'if (!limits.egress_hosts.includes(destination.hostname))', 'if (false)', async m => {
      const spec = byocSpec({ network_policy: { mode: 'allowlist', destinations: [{ hostname: 'pastebin.example.org', port: 443 }] } });
      denied(m.egressDecision(spec, LIMITS as never), 'egress_forbidden');
    }],
    ['enforcement gaps', 'if (gaps.length) return', 'if (false) return', async m => {
      const f = await fixture(m), r = await f.enrollRunner({ manifest: { ...FULL, features: FULL.features.filter(x => x !== 'deny_host_path') } }), spec = await f.queue(byocSpec(), r);
      denied(await f.lease(r, spec), 'enforcement_missing');
    }],
    ['cross border', 'return transfer.cross_border_allowed === true ?', 'return true ?', async m => {
      const spec = byocSpec({ allowed_providers: ['cloudflare'], allowed_regions: ['weur', 'enam'], checkpoint_manifest_ref: 'ckpt-1' });
      denied(m.resumeDecision(spec, { ref: 'ckpt-1', tenant_id: 11, run_id: spec.run_id, region: 'weur', approved_restore_regions: ['enam'], key_id: 'key-synthetic', sealed: true },
        { mode: 'axal_managed', provider: 'cloudflare', region: 'enam', cluster_id: null }, { cross_border_allowed: false, jurisdictionOf: r => (r === 'weur' ? 'eu' : 'us') }), 'cross_border_denied');
    }],
    ['consent at lease', "region: runner.cluster.region })) return workspaceRefusal('consent_missing', 403);", "region: runner.cluster.region })) {}", async m => {
      const f = await fixture(m), r = await f.enrollRunner(), spec = await f.queue(byocSpec());
      f.consents.set(spec.run_id, f.consentFor(spec, null, 'axal_managed')); denied(await f.lease(r, spec), 'consent_missing');
    }],
    ['consent wording', 'return consent.statement === consentStatement(placement);', 'return true;', async m => {
      const placement = { mode: 'customer_managed' as const, tenant_id: 11, company_id: 21, cluster_id: 'cluster-one', region: 'weur' };
      assert.equal(m.consentCovers({ ...placement, version: 1, member_id: 71, statement: m.consentStatement({ mode: 'axal_managed', cluster_id: null, region: 'weur' }) }, placement), false);
    }],
    ['off switch', 'const disabled = () => deps.enabled() !== true;', 'const disabled = () => false;', async m => {
      const f = await fixture(m); f.flags.enabled = false;
      denied(await f.control.createRegistration(ADMIN, { venture: { tenant_id: 11, company_id: 21, project_ids: null }, cluster: { cluster_id: 'cluster-one', region: 'weur', namespace_prefix: 'axal' }, limits: LIMITS }), 'byoc_runner_disabled');
    }],
  ];
  try {
    for (const [label, before, after, journey] of journeys) {
      await journey(real);   // the journey passes on the real module
      assert.ok(source.includes(before), label + ' target exists');
      const file = join(dir, label.replaceAll(' ', '-') + '.ts');
      writeFileSync(file, source.replaceAll(before, after));
      await assert.rejects(journey(await import(pathToFileURL(file).href) as Mod), 'must kill ' + label);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
