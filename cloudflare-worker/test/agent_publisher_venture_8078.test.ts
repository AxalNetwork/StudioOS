// D8078 (#8078): the publisher refuses a write across venture namespaces. Synthetic data and an injected clock only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  planAgentPublish, ventureScopeViolations,
  type PublishDecision, type PublishIntent, type PublisherObservations,
} from '../src/services/agents/agentPublisher';

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const BASE = 'a'.repeat(40);
const UID = '0123456789abcdef0123456789abcdef';
const digest = (c: string) => `sha256:${c.repeat(64)}`;
const VENTURES = [{ slug: 'acme', company_id: 2 }, { slug: 'globex', company_id: 9 }];
const file = (path: string) => ({ path, change: 'modified' as const });

function intent(paths: string[], company_id = 2): PublishIntent {
  return {
    version: 1, tenant_id: 1, company_id, project_id: 3,
    installation_uid: UID, repository_full_name: 'AxalNetwork/StudioOS', target_ref: 'refs/heads/main',
    base_sha: BASE, patch_digest: digest('1'), files: paths.map(file),
    provenance: { agent_id: 'agent:42', task_id: 'task-101', run_uuid: '11111111-2222-4333-8444-555555555555', attempt: 1,
      image_digest: digest('2'), evidence_digest: digest('3') },
    agent_checks: { tests: 'passed', scan: 'passed' },
    idempotency_key: 'publish:task-101:1', summary: 'Venture change', log_excerpt: null,
  };
}
function obs(over: Partial<PublisherObservations> = {}, company_id = 2): PublisherObservations {
  return {
    now_ms: NOW, enabled: true,
    installation: {
      uid: UID, tenant_id: 1, company_id, project_id: 3, repository_full_name: 'AxalNetwork/StudioOS',
      base_ref: 'refs/heads/main', revoked_at: null, approved_by_user_id: 5, github_status: 'active',
      // Deliberately wide: the venture check, not allowed_paths, is what these tests exercise.
      allowed_paths: ['ventures/', 'src/'], observed_at_ms: NOW - 60_000,
    },
    base_head_sha: BASE, existing_prs: [], last_github_response: null,
    candidate_checks: { required: ['build'], results: { build: 'success' } },
    approvals: [{ user_id: 5, decision_uid: 'fedcba9876543210fedcba9876543210' }],
    ventures: VENTURES,
    ...over,
  };
}
const code = (d: PublishDecision) => (d.ok ? 'planned' : d.code);

test('#8078: a venture agent writes inside its own namespace', async () => {
  const d = await planAgentPublish(intent(['ventures/acme/app/index.ts', 'ventures/acme/README.md']), obs());
  assert.equal(code(d), 'planned');
});

test('#8078: a venture agent writing another venture\'s folder is refused, naming the paths', async () => {
  const d = await planAgentPublish(intent(['ventures/acme/a.ts', 'ventures/globex/b.ts']), obs());
  assert.equal(code(d), 'venture_scope_violation');
  assert.ok(!d.ok && !d.retryable);
  assert.deepEqual(!d.ok && d.paths, ['ventures/globex/b.ts']);
  // A prefix of its own slug is another venture, not its own.
  assert.deepEqual(ventureScopeViolations(intent(['ventures/acmeco/x.ts']), VENTURES), ['ventures/acmeco/x.ts']);
});

test('#8078: a venture agent writing outside its folder is refused', async () => {
  const d = await planAgentPublish(intent(['ventures/acme/a.ts', 'src/platform.ts']), obs());
  assert.equal(code(d), 'venture_scope_violation');
  assert.deepEqual(!d.ok && d.paths, ['src/platform.ts']);
});

test('#8078: a non-venture company writes no venture folder; its other paths are unchanged', async () => {
  assert.equal(code(await planAgentPublish(intent(['ventures/acme/a.ts'], 4), obs({}, 4))), 'venture_scope_violation');
  assert.equal(code(await planAgentPublish(intent(['src/a.ts'], 4), obs({}, 4))), 'planned');
  // With no namespaces supplied and no venture path, the plan is as before.
  assert.equal(code(await planAgentPublish(intent(['src/a.ts'], 4), obs({ ventures: undefined }, 4))), 'planned');
});

test('#8078: a venture path with the namespaces unread, or malformed namespaces, refuses (retryable)', async () => {
  const unread = await planAgentPublish(intent(['ventures/acme/a.ts']), obs({ ventures: null }));
  assert.equal(code(unread), 'invalid_observation');
  assert.ok(!unread.ok && unread.retryable && unread.field === 'ventures');
  for (const bad of [[{ slug: 'Acme', company_id: 2 }], [{ slug: 'acme', company_id: 0 }], 'acme']) {
    const d = await planAgentPublish(intent(['src/a.ts']), obs({ ventures: bad as unknown as PublisherObservations['ventures'] }));
    assert.equal(code(d), 'invalid_observation', JSON.stringify(bad));
  }
});

test('#8078: protected paths still refuse first; the venture check runs before allowed_paths', async () => {
  assert.equal(code(await planAgentPublish(intent(['.github/workflows/x.yml', 'ventures/globex/b.ts']), obs())), 'protected_path');
  // allowed_paths would refuse `lib/x.ts` too; the venture refusal comes first and names it.
  const d = await planAgentPublish(intent(['lib/x.ts']), obs());
  assert.equal(code(d), 'venture_scope_violation');
});
