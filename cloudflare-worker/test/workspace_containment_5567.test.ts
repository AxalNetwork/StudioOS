/** D5567 part 4: the fail-closed containment gate and job-environment credential scan; synthetic evidence, injected clock, no provider calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTAINMENT_EVIDENCE_MAX_AGE_MS, CONTAINMENT_REASONS, CONTAINMENT_STEP, containmentEligibility, containmentRefusal,
  filterContainment, isContainmentEligible, jobEnvironmentClean, jobEnvironmentFindings, requiredSandbox,
  type ContainmentEvidence } from '../src/services/agents/workspaceContainment.ts';
import { createContainerVm, PYTHON_COMPUTE_INSTANCE, type ComputeInstance, type VmControl } from '../../agent-compute/vm.ts';
import { specFixture } from './_workspace_fake_5565.ts';

const NOW = 1_800_000_000_000;
const at = { now: NOW };
function evidence(changes: Partial<ContainmentEvidence> = {}): ContainmentEvidence {
  return { provider: 'cloudflare', revision: 'synthetic-conformance-1', source: 'owner_registry', verified_at: NOW - 1000,
    egress: { deny_all: true, connect_time_allowlist: true, blocks_private_ranges: true, blocks_dns_rebinding: true, blocks_redirect_escape: true, covers_raw_sockets: true },
    metadata_blocked: true, localhost_blocked: true,
    guest: { d1_binding: false, durable_object_binding: false, secret_bindings: false, control_plane_credentials: false, other_tenant_mounts: false },
    privileged: false, host_socket: false, runs_as_root: false, no_new_privileges: true, immutable_image: true, sandbox: 'microvm', ...changes };
}
const deny = specFixture();
const allow = specFixture({ network_policy: { mode: 'allowlist', destinations: [{ hostname: 'registry.example.org', port: 443 }] } });
const reasons = (spec: typeof deny, e: unknown, options = at) => {
  const d = containmentEligibility(spec, 'cloudflare', e, options);
  return d.eligible ? [] : d.reasons;
};

test('owner-registry evidence that enforces everything is eligible, and reports the placement step', () => {
  for (const spec of [deny, allow]) {
    const d = containmentEligibility(spec, 'cloudflare', evidence(), at);
    assert.deepEqual(d, { eligible: true, provider: 'cloudflare', step: 'security_capability', reasons: [] });
  }
  assert.equal(CONTAINMENT_STEP, 'security_capability');
  assert.equal(isContainmentEligible(deny, 'cloudflare', evidence({ sandbox: 'gvisor' }), at), true);
});

test('missing, malformed, self-reported, mismatched or stale evidence never enables a provider', () => {
  assert.deepEqual(reasons(deny, null), ['evidence_missing']);
  assert.deepEqual(reasons(deny, undefined), ['evidence_missing']);
  assert.deepEqual(reasons(deny, { ...evidence(), extra: true }), ['evidence_malformed']);
  assert.deepEqual(reasons(deny, { ...evidence(), privileged: 'false' }), ['evidence_malformed']);
  assert.deepEqual(reasons(deny, { ...evidence(), guest: { ...evidence().guest, secret_bindings: undefined } }), ['evidence_malformed']);
  assert.deepEqual(reasons(deny, evidence({ source: 'provider_self_report' })), ['evidence_untrusted_source']);
  assert.deepEqual(reasons(deny, evidence({ source: 'runner_report' })), ['evidence_untrusted_source']);
  assert.deepEqual(reasons(deny, evidence({ provider: 'aws' })), ['evidence_provider_mismatch']);
  // Freshness, from the injected clock only.
  assert.deepEqual(reasons(deny, evidence({ verified_at: NOW - CONTAINMENT_EVIDENCE_MAX_AGE_MS })), []);
  assert.deepEqual(reasons(deny, evidence({ verified_at: NOW - CONTAINMENT_EVIDENCE_MAX_AGE_MS - 1 })), ['evidence_stale']);
  assert.deepEqual(reasons(deny, evidence({ verified_at: NOW + 1 })), ['evidence_stale']);
  assert.deepEqual(reasons(deny, evidence({ verified_at: NOW - 5000 }), { now: NOW, maxAgeMs: 4999 }), ['evidence_stale']);
  // A caller cannot widen the window past the cap.
  assert.deepEqual(reasons(deny, evidence({ verified_at: NOW - CONTAINMENT_EVIDENCE_MAX_AGE_MS - 1 }), { now: NOW, maxAgeMs: Number.MAX_SAFE_INTEGER }), ['evidence_stale']);
  assert.throws(() => containmentEligibility(deny, 'cloudflare', evidence(), { now: -1 }), /containment clock/);
  assert.throws(() => containmentEligibility(deny, 'cloudflare', evidence(), { now: 1.5 }), /containment clock/);
});

test('egress: a provider that cannot enforce the selected network policy is ineligible for it', () => {
  // Outbound off but no connect-time allowlist (the shape a plain Internet switch gives): fine for deny, not for allowlist.
  const offOnly = evidence({ egress: { deny_all: true, connect_time_allowlist: false, blocks_private_ranges: false, blocks_dns_rebinding: false, blocks_redirect_escape: false, covers_raw_sockets: false } });
  assert.deepEqual(reasons(deny, offOnly), []);
  assert.deepEqual(reasons(allow, offOnly), ['egress_allowlist_unenforced', 'egress_private_ranges_open', 'egress_dns_rebinding_open', 'egress_redirects_open', 'egress_raw_sockets_open']);
  assert.deepEqual(reasons(deny, evidence({ egress: { ...evidence().egress, deny_all: false } })), ['egress_deny_unenforced']);
  assert.deepEqual(reasons(allow, evidence({ egress: { ...evidence().egress, deny_all: false } })), []);
  for (const [field, code] of [['connect_time_allowlist', 'egress_allowlist_unenforced'], ['blocks_private_ranges', 'egress_private_ranges_open'],
    ['blocks_dns_rebinding', 'egress_dns_rebinding_open'], ['blocks_redirect_escape', 'egress_redirects_open'], ['covers_raw_sockets', 'egress_raw_sockets_open']] as const) {
    assert.deepEqual(reasons(allow, evidence({ egress: { ...evidence().egress, [field]: false } })), [code], field);
  }
  // A network mode the gate does not know is refused, not waved through.
  assert.deepEqual(reasons({ ...deny, network_policy: { mode: 'open' } } as never, evidence()), ['egress_allowlist_unenforced']);
});

test('metadata and localhost must be blocked for every policy', () => {
  for (const spec of [deny, allow]) {
    assert.deepEqual(reasons(spec, evidence({ metadata_blocked: false })), ['metadata_reachable']);
    assert.deepEqual(reasons(spec, evidence({ localhost_blocked: false })), ['localhost_reachable']);
  }
});

test('no D1, Durable Object, secret binding, control-plane credential or other tenant mount reaches the guest', () => {
  for (const [field, code] of [['d1_binding', 'guest_d1_binding'], ['durable_object_binding', 'guest_durable_object_binding'],
    ['secret_bindings', 'guest_secret_binding'], ['control_plane_credentials', 'guest_control_plane_credential'], ['other_tenant_mounts', 'guest_other_tenant_mount']] as const) {
    assert.deepEqual(reasons(deny, evidence({ guest: { ...evidence().guest, [field]: true } })), [code], field);
  }
});

test('privilege escalation paths each make the provider ineligible', () => {
  assert.deepEqual(reasons(deny, evidence({ privileged: true })), ['privileged_mode']);
  assert.deepEqual(reasons(deny, evidence({ host_socket: true })), ['host_socket']);
  assert.deepEqual(reasons(deny, evidence({ runs_as_root: true })), ['root_user']);
  assert.deepEqual(reasons(deny, evidence({ no_new_privileges: false })), ['new_privileges_allowed']);
  assert.deepEqual(reasons(deny, evidence({ immutable_image: false })), ['mutable_image']);
});

test('sandbox strength must meet the workload trust level; unknown is never enough', () => {
  assert.equal(requiredSandbox('coding_untrusted'), 'gvisor');
  assert.equal(requiredSandbox('coding_trusted'), 'container');
  assert.equal(requiredSandbox('python'), 'container');
  assert.deepEqual(reasons(deny, evidence({ sandbox: 'container' })), ['sandbox_too_weak']);
  assert.deepEqual(reasons(deny, evidence({ sandbox: 'gvisor' })), []);
  const trusted = specFixture({ workload_class: 'coding_trusted' });
  assert.deepEqual(reasons(trusted, evidence({ sandbox: 'container' })), []);
  for (const spec of [deny, trusted]) assert.deepEqual(reasons(spec, evidence({ sandbox: 'unknown' })), ['sandbox_unknown']);
});

test('every failing reason is reported in the stable order, and the broker refusal names the first', () => {
  const worst = evidence({ source: 'provider_self_report', verified_at: NOW + 10, metadata_blocked: false, privileged: true, sandbox: 'container',
    egress: { ...evidence().egress, deny_all: false }, guest: { ...evidence().guest, secret_bindings: true } });
  const d = containmentEligibility(deny, 'cloudflare', worst, at);
  assert.equal(d.eligible, false);
  assert.deepEqual(d.reasons, ['evidence_untrusted_source', 'evidence_stale', 'egress_deny_unenforced', 'metadata_reachable',
    'guest_secret_binding', 'privileged_mode', 'sandbox_too_weak']);
  assert.ok(d.reasons.every(reason => (CONTAINMENT_REASONS as readonly string[]).includes(reason)));
  const refusal = containmentRefusal(d);
  assert.ok(refusal);
  assert.equal(refusal.code, 'containment_unsupported');
  assert.equal(refusal.status, 422);
  assert.equal(refusal.capability, 'evidence_untrusted_source');
  assert.equal(containmentRefusal(containmentEligibility(deny, 'cloudflare', evidence(), at)), null);
});

test('the placement filter keeps only providers that can contain the workload, with reasons for the rest', () => {
  const out = filterContainment(deny, [
    { provider: 'cloudflare', evidence: evidence() },
    { provider: 'aws', evidence: evidence({ provider: 'aws', sandbox: 'container' }) },
    { provider: 'byoc', evidence: null },
    { provider: 'gcp', evidence: evidence() },
  ], at);
  assert.equal(out.step, 'security_capability');
  assert.deepEqual(out.eligible, ['cloudflare']);
  assert.deepEqual(out.ineligible, [
    { provider: 'aws', reasons: ['sandbox_too_weak'] },
    { provider: 'byoc', reasons: ['evidence_missing'] },
    { provider: 'gcp', reasons: ['evidence_provider_mismatch'] },
  ]);
});

// Synthetic credential-shaped values, assembled at runtime so no literal looks like a real key.
const fake = {
  aws: 'AKIA' + 'Q'.repeat(16), gh: 'ghp_' + 'x'.repeat(36), pat: 'github_pat_' + 'y'.repeat(40), ant: 'sk-' + 'ant-' + 'z'.repeat(24),
  slack: 'xox' + 'b-' + '1'.repeat(12), pem: '-----BEGIN ' + 'PRIVATE KEY-----', jwt: 'eyJ' + 'a'.repeat(10) + '.eyJ' + 'b'.repeat(10) + '.' + 'c'.repeat(10),
  url: 'https://' + 'user:pw' + '@registry.example.org/x',
};

test('the job environment scan flags cloud credentials and provider tokens by name and by value, never echoing a value', () => {
  assert.deepEqual(jobEnvironmentFindings({ PATH: '/usr/local/bin', HOME: '/app', PYTHONUNBUFFERED: '1', LD_LIBRARY_PATH: '/usr/local/lib' }), []);
  assert.equal(jobEnvironmentClean(undefined), true);
  for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AZURE_CLIENT_SECRET', 'ARM_CLIENT_ID',
    'GOOGLE_APPLICATION_CREDENTIALS', 'CLOUDSDK_AUTH_ACCESS_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CF_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN',
    'NPM_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'COMPUTE_CONTROL_SECRET', 'DB_PASSWORD', 'my_api_key', 'SERVICE_AUTH']) {
    assert.deepEqual(jobEnvironmentFindings({ [name]: 'synthetic' }), [{ name, kind: 'credential_name' }], name);
  }
  for (const [label, value] of Object.entries(fake)) {
    const findings = jobEnvironmentFindings({ PATH: value });
    assert.deepEqual(findings, [{ name: 'PATH', kind: 'credential_value' }], label);
    assert.equal(JSON.stringify(findings).includes(value), false, label);
  }
  assert.deepEqual(jobEnvironmentFindings({ BUILD_MODE: 'release' }), [{ name: 'BUILD_MODE', kind: 'unlisted_name' }]);
  assert.deepEqual(jobEnvironmentFindings({ BUILD_MODE: 'release' }, ['BUILD_MODE']), []);
  assert.deepEqual(jobEnvironmentFindings({ GITHUB_TOKEN: fake.gh }), [{ name: 'GITHUB_TOKEN', kind: 'credential_name' }, { name: 'GITHUB_TOKEN', kind: 'credential_value' }]);
  assert.deepEqual(jobEnvironmentFindings({ PATH: 7 }), [{ name: 'PATH', kind: 'malformed' }]);
  assert.deepEqual(jobEnvironmentFindings({ 'bad name': 'x' }), [{ name: '*', kind: 'malformed' }]);
  assert.deepEqual(jobEnvironmentFindings(['PATH=/bin']), [{ name: '*', kind: 'malformed' }]);
  assert.deepEqual(jobEnvironmentFindings([]), [{ name: '*', kind: 'malformed' }]);
  assert.deepEqual(jobEnvironmentFindings('PATH=/bin'), [{ name: '*', kind: 'malformed' }]);
  assert.equal(jobEnvironmentClean({ HOME: '/app', AWS_REGION: 'us-east-1' }), false);
});

test('the real compute VM is started with Internet off and no environment, so no credential can ride along', async () => {
  // D4557-p3 (#4557): default scheduling is retired, so it never starts a VM; durable_object starts it, on either profile.
  const vmFor = (policy: string, instance: ComputeInstance) => {
    const starts: Record<string, unknown>[] = [], digest = 'sha256:' + 'a'.repeat(64);
    const control: VmControl = { start: options => { starts.push(options as Record<string, unknown>); },
      namedImage: () => 'registry.example/synthetic@' + digest, inspect: async () => ({ image: 'registry.example/synthetic@' + digest }),
      monitor: () => new Promise(() => {}), fetch: async () => Response.json({ ready: true }), destroy: async () => {} };
    return { starts, digest, vm: createContainerVm(control, { schedulingPolicy: policy, instance, now: () => 0, pause: async () => {} }) };
  };
  const retired = vmFor('default', PYTHON_COMPUTE_INSTANCE);
  assert.throws(() => retired.vm.start(retired.digest), /scheduling_unconfirmed/);
  assert.equal(retired.starts.length, 0, 'default scheduling starts nothing');
  for (const instance of [PYTHON_COMPUTE_INSTANCE, 'standard-1'] as ComputeInstance[]) {
    const policy = 'durable_object ' + JSON.stringify(instance);
    const { starts, digest, vm } = vmFor('durable_object', instance);
    vm.start(digest);
    assert.equal(starts.length, 1, policy);
    assert.equal(starts[0].enableInternet, false, policy);
    assert.equal('envVars' in starts[0], false, policy);
    assert.equal('entrypoint' in starts[0], false, policy);
    assert.equal(jobEnvironmentClean(starts[0].envVars), true, policy);
  }
});

test('the compute image runs as a non-root numeric user and bakes in no credential-shaped variable', () => {
  const dockerfile = readFileSync(new URL('../../agent-compute/Dockerfile', import.meta.url), 'utf8');
  const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
  const user = runtime.match(/^USER\s+(\d+)(?::(\d+))?\s*$/m);
  assert.ok(user, 'the runtime stage sets a numeric USER');
  assert.notEqual(Number(user[1]), 0);
  assert.notEqual(Number(user[2] ?? user[1]), 0);
  const env: Record<string, string> = {};
  for (const line of runtime.split('\n').filter(l => l.startsWith('ENV '))) {
    for (const pair of line.slice(4).trim().split(/\s+/)) { const [k, ...v] = pair.split('='); env[k] = v.join('='); }
  }
  assert.ok(Object.keys(env).length > 0, 'the runtime stage sets its environment explicitly');
  assert.deepEqual(jobEnvironmentFindings(env), []);
  assert.equal(/--mount=type=secret/.test(runtime), false, 'no build secret is mounted in the runtime stage');
});
