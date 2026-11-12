/** D5567: synthetic broker identities, actual WebCrypto grants/encryption and atomic refusal paths; no provider calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkspaceSecurity, workspaceDestination, type GrantTarget, type WorkspaceImageEvidence, type WorkspaceObject,
  type WorkspaceProviderEvidence, type WorkspaceSecurityDeps, type WorkspaceSecurityRun } from '../src/services/agents/workspaceSecurity.ts';
import { specFixture, fakeCapabilities } from './_workspace_fake_5565.ts';
import type { WorkspaceResult } from '../src/services/agents/workspaceSpec.ts';

const value = <T>(r: WorkspaceResult<T>): T => { assert.ok(r.ok, JSON.stringify(r)); return r.value; };
const denied = (r: WorkspaceResult<unknown>, code?: string) => { assert.equal(r.ok, false); if (!r.ok && code) assert.equal(r.code, code); };
async function fixture(factory = createWorkspaceSecurity) {
  let now = 1000, nonce = 0;
  const spec = specFixture();
  const sponsor = { member_id: 71, tenant_id: spec.tenant_id, company_id: spec.company_id, project_id: spec.project_id };
  const flags = { enabled: true, halted: false, allowed: true, revision: 1, approved: false, keyAvailable: true };
  const image: WorkspaceImageEvidence = { digest: spec.image_digest, signature_verified: true, provenance_verified: true, sbom_verified: true, scan_passed: true, revoked: false };
  const provider: WorkspaceProviderEvidence = { capabilities: fakeCapabilities(), non_root: true, immutable_root: true, ephemeral_scratch: true,
    resource_limits: true, host_socket: false, privileged: false, isolation: 'microvm', network_connect_fence: true, metadata_denied: true };
  const object: WorkspaceObject = { ref: 'object-synthetic', tenant_id: spec.tenant_id, company_id: spec.company_id, project_id: spec.project_id,
    run_id: spec.run_id, execution_generation: 1, sink_ref: spec.artifact_sink_ref, region: 'weur', approved_restore_regions: [], key_id: 'key-synthetic', expires_at: 120000 };
  const objects = new Map([[object.ref, object]]);
  const rootKey = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(19), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const encryptionKey = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(23), 'AES-GCM', false, ['encrypt', 'decrypt']);
  let rows = new Map<string, WorkspaceSecurityRun>(), queue: Promise<unknown> = Promise.resolve();
  const audit: unknown[] = [];
  const deps: WorkspaceSecurityDeps = {
    enabled: () => flags.enabled, halted: () => flags.halted, clock: () => now, nonce: () => `nonce-${String(++nonce).padStart(8, '0')}`, rootKey,
    store: { async transaction<T>(fn: (runs: Map<string, WorkspaceSecurityRun>) => Promise<T> | T): Promise<T> {
      const result = queue.then(async () => { const copy = structuredClone(rows); const answer = await fn(copy); rows = copy; return answer; });
      queue = result.catch(() => {}); return result;
    } },
    authorize: async () => ({ allowed: flags.allowed, revision: flags.revision, approved: flags.approved }),
    image: async () => image, provider: async () => provider, object: async ref => objects.get(ref) || null,
    encryptionKey: async (tenantId, keyId) => flags.keyAvailable && tenantId === spec.tenant_id && keyId === object.key_id ? encryptionKey : null,
    audit: async event => { audit.push(event); },
  };
  const security = factory(deps);
  const target = (audience: GrantTarget['audience'] = 'executor.bootstrap', extra: Partial<GrantTarget> = {}): GrantTarget => ({ run_id: spec.run_id, execution_generation: 1, audience, ...extra });
  const issue = async (t = target()) => value(await security.issue(t)).token;
  return { spec, sponsor, flags, image, provider, object, objects, deps, audit, security, target, issue,
    time: (at: number) => { now = at; }, inspect: () => structuredClone(rows), register: async () => value(await security.register(spec, sponsor)) };
}

test('broker admission refuses cross-scope sponsors, unverified images and unsupported isolation/network/host privileges', async () => {
  const f = await fixture();
  denied(await f.security.register(f.spec, { ...f.sponsor, tenant_id: 999 }), 'sponsor_scope_denied');
  denied(await f.security.register(f.spec, { ...f.sponsor, project_id: 999 }), 'sponsor_scope_denied');
  assert.equal(f.inspect().size, 0);
  for (const field of ['signature_verified', 'provenance_verified', 'sbom_verified', 'scan_passed'] as const) {
    f.image[field] = false; denied(await f.security.register(f.spec, f.sponsor), 'image_not_approved'); f.image[field] = true;
  }
  for (const field of ['non_root', 'immutable_root', 'ephemeral_scratch', 'resource_limits', 'network_connect_fence', 'metadata_denied'] as const) {
    f.provider[field] = false; denied(await f.security.register(f.spec, f.sponsor), 'provider_security_denied'); f.provider[field] = true;
  }
  for (const field of ['host_socket', 'privileged'] as const) {
    f.provider[field] = true; denied(await f.security.register(f.spec, f.sponsor), 'provider_security_denied'); f.provider[field] = false;
  }
  f.provider.isolation = 'container'; denied(await f.security.register(f.spec, f.sponsor), 'hostile_workload_denied'); f.provider.isolation = 'microvm';
  f.provider.capabilities.enforced_regions = ['wnam']; denied(await f.security.register(f.spec, f.sponsor), 'capability_denied'); f.provider.capabilities.enforced_regions = ['weur'];
  f.provider.privileged = undefined as any; denied(await f.security.register(f.spec, f.sponsor), 'provider_security_denied');
  assert.equal(f.inspect().size, 0); assert.equal(f.audit.length, 0);
});

test('scoped tokens are audience/target bound, short-lived, canonical and one-use even under concurrent redemption', async () => {
  const f = await fixture(); await f.register();
  const token = await f.issue(); const [payload, signature] = token.split('.');
  assert.doesNotMatch(Buffer.from(payload, 'base64url').toString(), /CLOUDFLARE|SECRET|provider_key|rootKey|ciphertext/);
  denied(await f.security.redeem(`${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`, f.target()), 'grant_invalid');
  denied(await f.security.redeem(token, f.target('executor.complete')), 'grant_target_denied');
  denied(await f.security.redeem(token, { ...f.target(), run_id: 'other-run' }), 'grant_target_denied');
  denied(await f.security.redeem(token, { ...f.target(), execution_generation: 2 }), 'grant_target_denied');
  const attempts = await Promise.all([f.security.redeem(token, f.target()), f.security.redeem(token, f.target())]);
  assert.equal(attempts.filter(r => r.ok).length, 1); denied(attempts.find(r => !r.ok)!, 'grant_replay');
  const expiring = value(await f.security.issue(f.target(), 1000)); f.time(expiring.expires_at);
  denied(await f.security.redeem(expiring.token, f.target()), 'grant_expired');
  denied(await f.security.issue(f.target(), 60001), 'grant_policy_denied');
  assert.doesNotMatch(JSON.stringify(f.audit), /nonce|token|signature|payload|key|plaintext/i);
});

test('revoked sponsor, changed authorization revision, halt and revoked image all deny callbacks before redemption effects', async () => {
  for (const change of ['allowed', 'revision', 'halted', 'image', 'revoke'] as const) {
    const f = await fixture(); await f.register(); const token = await f.issue();
    if (change === 'allowed') f.flags.allowed = false;
    if (change === 'revision') f.flags.revision++;
    if (change === 'halted') f.flags.halted = true;
    if (change === 'image') f.image.revoked = true;
    if (change === 'revoke') await f.security.revoke(f.spec.run_id);
    const auditBefore = f.audit.length;
    denied(await f.security.redeem(token, f.target())); assert.equal(f.audit.length, auditBefore);
    denied(await f.security.issue(f.target()));
  }
});

test('generation advancement retains the contract and invalidates old callbacks, without amending v1 compute grants', async () => {
  const f = await fixture(); await f.register(); const token = await f.issue();
  denied(await f.security.advance({ ...f.spec, execution_generation: 2, tenant_id: 999 }), 'generation_advance_denied');
  value(await f.security.advance({ ...f.spec, execution_generation: 2 }));
  denied(await f.security.redeem(token, f.target()), 'stale_generation');
  denied(await f.security.issue(f.target()), 'stale_generation');
  const nextTarget = f.target('executor.complete', { execution_generation: 2 });
  value(await f.security.redeem(await f.issue(nextTarget), nextTarget));
  assert.equal(f.inspect().get(f.spec.run_id)!.spec.agent_id, f.spec.agent_id);
});

test('object redemption is server-mediated and checks exact ownership, sink, expiry, audience and restoration region', async () => {
  const f = await fixture(); await f.register();
  const target = f.target('artifact.read', { object_ref: f.object.ref, region: 'weur' });
  for (const field of ['tenant_id', 'company_id', 'project_id', 'run_id', 'execution_generation', 'sink_ref'] as const) {
    const old = f.object[field]; (f.object as any)[field] = typeof old === 'number' ? 999 : 'other';
    denied(await f.security.issue(target), 'object_not_authorized'); (f.object as any)[field] = old;
  }
  f.object.expires_at = Number.NaN; denied(await f.security.issue(target), 'object_not_authorized'); f.object.expires_at = 120000;
  denied(await f.security.issue({ ...target, object_ref: '../other-tenant' }), 'object_not_authorized');
  denied(await f.security.issue({ ...target, region: 'wnam' }), 'object_not_authorized');
  const token = await f.issue(target); f.object.tenant_id = 999;
  denied(await f.security.redeem(token, target), 'object_not_authorized');
});

test('AES-GCM snapshots/logs authenticate immutable tenant/object metadata; key revocation and tampering fail closed', async () => {
  const f = await fixture(); await f.register();
  const upload = f.target('artifact.upload', { object_ref: f.object.ref, region: 'weur' });
  const read = { ...upload, audience: 'artifact.read' as const };
  const plaintext = new Uint8Array(300000).fill(97); // catches unsafe spread-based base64 encoders
  const envelope = value(await f.security.seal(await f.issue(upload), upload, plaintext));
  assert.equal(Buffer.from(envelope.ciphertext, 'base64url').length, plaintext.length + 16, 'AES-GCM ciphertext includes its authentication tag');
  assert.deepEqual(value(await f.security.open(await f.issue(read), read, envelope)), plaintext);
  denied(await f.security.open(await f.issue(read), read, { ...envelope, ciphertext: envelope.ciphertext.slice(0, -2) + 'AA' }), 'artifact_ciphertext_invalid');
  f.flags.keyAvailable = false; denied(await f.security.open(await f.issue(read), read, envelope), 'artifact_key_unavailable'); f.flags.keyAvailable = true;
  const other = { ...f.object, ref: 'object-other' }; f.objects.set(other.ref, other);
  const otherTarget = { ...read, object_ref: other.ref };
  denied(await f.security.open(await f.issue(otherTarget), otherTarget, envelope), 'artifact_ciphertext_invalid');
  f.time(f.object.expires_at); denied(await f.security.issue(read), 'object_not_authorized');
});

test('an approved cross-region restoration and publisher grant need explicit current server permission, never a runner override', async () => {
  const f = await fixture();
  const spec = specFixture({ allowed_regions: ['weur', 'wnam'] }); value(await f.security.register(spec, f.sponsor));
  const target = f.target('artifact.read', { object_ref: f.object.ref, region: 'wnam' });
  denied(await f.security.issue(target), 'object_not_authorized');
  f.object.approved_restore_regions = ['wnam'];
  denied(await f.security.issue(target), 'object_not_authorized'); // provider still cannot enforce the target region
  f.provider.capabilities.enforced_regions = ['weur', 'wnam']; value(await f.security.redeem(await f.issue(target), target));
  const publish = f.target('integration.publish', { object_ref: f.object.ref, region: 'weur' });
  denied(await f.security.issue(publish), 'sponsor_not_authorized');
  f.flags.approved = true; const token = await f.issue(publish); f.flags.approved = false;
  denied(await f.security.redeem(token, publish), 'sponsor_not_authorized');
});

test('metadata, private/literal addresses, localhost, URL credentials, alternate ports and non-allowlisted egress are refused', () => {
  const spec = specFixture({ network_policy: { mode: 'allowlist', destinations: [{ hostname: 'api.example.com', port: 443 }] } });
  assert.equal(workspaceDestination(spec, 'https://api.example.com/path'), true);
  for (const url of ['http://api.example.com', 'https://api.example.com:8443', 'https://user:password@api.example.com',
    'http://169.254.169.254/latest/meta-data', 'https://metadata.google.internal', 'https://localhost', 'https://127.1',
    'https://2130706433', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://10.0.0.1', 'https://api.example.com.evil.com']) assert.equal(workspaceDestination(spec, url), false, url);
  assert.equal(workspaceDestination(specFixture(), 'https://api.example.com'), false);
});

test('security mutations must fail one-use, sponsor, provenance, halt and object-ownership journeys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-security-5567-'));
  let source = readFileSync(new URL('../src/services/agents/workspaceSecurity.ts', import.meta.url), 'utf8');
  source = source.replace("'zod'", JSON.stringify(new URL('../node_modules/zod/index.js', import.meta.url).href))
    .replace("'./workspaceSpec'", JSON.stringify(new URL('../src/services/agents/workspaceSpec.ts', import.meta.url).href));
  const changes: [string, string, string, (factory: typeof createWorkspaceSecurity) => Promise<void>][] = [
    ['nonce replay', 'nonce.used || ', '', async factory => { const f = await fixture(factory); await f.register(); const token = await f.issue(); value(await f.security.redeem(token, f.target())); denied(await f.security.redeem(token, f.target())); }],
    ['sponsor revision', 'current.revision === run.permission_revision', 'true', async factory => { const f = await fixture(factory); await f.register(); const token = await f.issue(); f.flags.revision++; denied(await f.security.redeem(token, f.target())); }],
    ['image provenance', 'evidence.provenance_verified !== true', 'false', async factory => { const f = await fixture(factory); f.image.provenance_verified = false; denied(await f.security.register(f.spec, f.sponsor)); }],
    ['emergency halt', 'deps.enabled() !== true || deps.halted() !== false', 'deps.enabled() !== true', async factory => { const f = await fixture(factory); await f.register(); const token = await f.issue(); f.flags.halted = true; denied(await f.security.redeem(token, f.target())); }],
    ['object tenant fence', 'object.tenant_id !== spec.tenant_id', 'false', async factory => { const f = await fixture(factory); await f.register(); f.object.tenant_id = 999; denied(await f.security.issue(f.target('artifact.read', { object_ref: f.object.ref, region: 'weur' }))); }],
  ];
  try {
    for (const [label, before, after, journey] of changes) {
      assert.ok(source.includes(before), label); const file = join(dir, label.replaceAll(' ', '-') + '.ts');
      writeFileSync(file, source.replace(before, after));
      const broken = (await import(pathToFileURL(file).href)).createWorkspaceSecurity as typeof createWorkspaceSecurity;
      await assert.rejects(journey(broken), 'must kill ' + label);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
