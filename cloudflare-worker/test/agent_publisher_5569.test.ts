// D5569 part 2 (#5569): the disabled publisher broker contract. Synthetic data and an injected clock only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyGithubResponse, intentDigest, planAgentPublish, publisherEnabled, quoteUntrusted,
  type ExistingAgentPr, type PublishDecision, type PublishIntent, type PublisherObservations,
} from '../src/services/agents/agentPublisher';

const NOW = Date.UTC(2026, 10, 18, 22, 0, 0);
const BASE = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);
const UID = '0123456789abcdef0123456789abcdef';
const APPROVAL = 'fedcba9876543210fedcba9876543210';
const digest = (c: string) => `sha256:${c.repeat(64)}`;

function intent(over: Partial<PublishIntent> = {}, prov: Partial<PublishIntent['provenance']> = {}): PublishIntent {
  return {
    version: 1, tenant_id: 1, company_id: 2, project_id: 3,
    installation_uid: UID, repository_full_name: 'venture/example', target_ref: 'refs/heads/main',
    base_sha: BASE, patch_digest: digest('1'),
    files: [{ path: 'src/billing/invoice.ts', change: 'modified' }],
    provenance: { agent_id: 'agent:42', task_id: 'task-101', run_uuid: '11111111-2222-4333-8444-555555555555', attempt: 1,
      image_digest: digest('2'), evidence_digest: digest('3'), ...prov },
    agent_checks: { tests: 'passed', scan: 'passed' },
    idempotency_key: 'publish:task-101:1',
    summary: 'Fix invoice rounding',
    log_excerpt: 'all 12 tests passed',
    ...over,
  };
}

function obs(over: Partial<PublisherObservations> = {}): PublisherObservations {
  return {
    now_ms: NOW, enabled: true,
    installation: {
      uid: UID, tenant_id: 1, company_id: 2, project_id: 3, repository_full_name: 'venture/example',
      base_ref: 'refs/heads/main', revoked_at: null, approved_by_user_id: 5, github_status: 'active',
      allowed_paths: ['src/', 'README.md'], observed_at_ms: NOW - 60_000,
    },
    base_head_sha: BASE,
    existing_prs: [],
    last_github_response: null,
    candidate_checks: { required: ['build', 'test'], results: { build: 'success', test: 'success' } },
    approvals: [{ user_id: 5, decision_uid: APPROVAL }],
    ...over,
  };
}

const pr = (over: Partial<ExistingAgentPr>): ExistingAgentPr => ({
  number: 7, url: 'https://github.com/venture/example/pull/7', head_ref: 'agent/task-77/1', state: 'open',
  task_id: 'task-77', idempotency_key: 'publish:task-77:1', intent_digest: digest('9'), files: ['src/other.ts'], ...over,
});

function refused(d: PublishDecision, code: string) {
  assert.equal(d.ok, false, `expected refusal ${code}, got a plan`);
  assert.ok(!('plan' in d), 'a refusal carries no planned PR');
  if (!d.ok) assert.equal(d.code, code);
  return d as Extract<PublishDecision, { ok: false }>;
}
function planned(d: PublishDecision) {
  assert.equal(d.ok, true, `expected a plan, got ${d.ok ? '' : d.code}`);
  return (d as Extract<PublishDecision, { ok: true }>).plan;
}

test('flag: off by default; only the exact string "on" enables planning', async () => {
  for (const v of [undefined, null, '', 'off', 'ON', 'true', true, 1]) assert.equal(publisherEnabled(v), false, String(v));
  assert.equal(publisherEnabled('on'), true);
  refused(await planAgentPublish(intent(), obs({ enabled: false })), 'publisher_disabled');
  refused(await planAgentPublish(intent(), { ...obs(), enabled: undefined as unknown as boolean }), 'publisher_disabled');
  // Disabled refuses before anything else, even a malformed intent.
  refused(await planAgentPublish({ ...intent(), base_sha: 'main' }, obs({ enabled: false })), 'publisher_disabled');
});

test('two agents on disjoint files: two separate, traceable planned PRs that proceed in parallel', async () => {
  const a = planned(await planAgentPublish(intent(), obs()));
  assert.equal(a.head_branch, 'agent/task-101/1');
  const asPr = pr({ number: 11, head_ref: a.head_branch, task_id: 'task-101', idempotency_key: 'publish:task-101:1',
    intent_digest: a.intent_digest, files: ['src/billing/invoice.ts'] });
  const b = planned(await planAgentPublish(
    intent({ files: [{ path: 'src/auth/session.ts', change: 'modified' }], idempotency_key: 'publish:task-202:1', summary: 'Session fix' },
      { task_id: 'task-202', agent_id: 'agent:43', run_uuid: '66666666-7777-4888-9999-000000000000' }),
    obs({ existing_prs: [asPr] })));
  assert.equal(b.head_branch, 'agent/task-202/1');
  assert.notEqual(a.head_branch, b.head_branch);
  assert.notEqual(a.intent_digest, b.intent_digest);
  assert.deepEqual(b.parallel_with, [11]);
  assert.equal(b.head_ref_condition, 'must_not_exist');
  assert.equal(b.expected_base_sha, BASE);
  assert.equal(b.draft, true);
});

test('overlapping paths: coordination_required naming the other PR, never a claimed textual conflict', async () => {
  const other = pr({ number: 12, url: 'https://github.com/venture/example/pull/12', files: ['src/billing/invoice.ts', 'src/x.ts'] });
  const d = refused(await planAgentPublish(intent(), obs({ existing_prs: [other] })), 'coordination_required');
  assert.equal(d.retryable, true);
  assert.equal(d.coordination?.textual_conflict, 'not checked');
  assert.deepEqual(d.coordination?.with.map(w => [w.number, w.url, w.paths.map(p => p.path)]),
    [[12, 'https://github.com/venture/example/pull/12', ['src/billing/invoice.ts']]]);
  assert.deepEqual(d.coordination?.suggested_order, ['this', 12]);
  // A closed PR on the same path is not a live overlap; a coordinator's clearance lets this one proceed.
  planned(await planAgentPublish(intent(), obs({ existing_prs: [{ ...other, state: 'closed' }] })));
  const p = planned(await planAgentPublish(intent(), obs({ existing_prs: [other], coordination_cleared: [12] })));
  assert.deepEqual(p.parallel_with, [12]);
});

test('duplicate publish: the same key or the same task reuses its PR and never plans a second one', async () => {
  const first = planned(await planAgentPublish(intent(), obs()));
  const mine = pr({ number: 21, url: 'https://github.com/venture/example/pull/21', head_ref: first.head_branch,
    task_id: 'task-101', idempotency_key: 'publish:task-101:1', intent_digest: first.intent_digest, files: ['src/billing/invoice.ts'] });
  let d = refused(await planAgentPublish(intent(), obs({ existing_prs: [mine] })), 'duplicate_publish');
  assert.deepEqual(d.reuse, { number: 21, url: 'https://github.com/venture/example/pull/21' });
  // A retry with a new key and attempt for the same logical task still reuses the open PR.
  d = refused(await planAgentPublish(intent({ idempotency_key: 'publish:task-101:2' }, { attempt: 2 }), obs({ existing_prs: [mine] })), 'duplicate_publish');
  assert.equal(d.reuse?.number, 21);
  // Even when the PR row lost its task id, its branch names the task.
  refused(await planAgentPublish(intent({ idempotency_key: 'publish:task-101:3' }, { attempt: 3 }),
    obs({ existing_prs: [{ ...mine, task_id: null, idempotency_key: null }] })), 'duplicate_publish');
  // The same key with different content is a conflict, not a reuse.
  refused(await planAgentPublish(intent({ summary: 'something else' }), obs({ existing_prs: [mine] })), 'idempotency_conflict');
  refused(await planAgentPublish(intent({ idempotency_key: 'publish:task-101:2' }), obs({ existing_prs: [{ ...mine, state: 'merged' }] })), 'task_already_merged');
  refused(await planAgentPublish(intent({ idempotency_key: 'publish:task-101:2' }), obs({ existing_prs: [{ ...mine, state: 'closed' }] })), 'task_pr_declined');
});

test('GitHub 403 and 429: classified, backed off, never retried in a burst', async () => {
  const forbidden = { status: 403 as const, at_ms: NOW - 1_000, consecutive: 1 };
  assert.deepEqual(classifyGithubResponse(forbidden), { kind: 'forbidden' });
  let d = refused(await planAgentPublish(intent(), obs({ last_github_response: forbidden })), 'github_forbidden');
  assert.equal(d.retryable, false);
  // Waiting does not clear a permission refusal.
  refused(await planAgentPublish(intent(), obs({ now_ms: NOW + 86_400_000, installation: { ...obs().installation!, observed_at_ms: NOW + 86_400_000 },
    last_github_response: forbidden })), 'github_forbidden');

  const secondary = { status: 403 as const, at_ms: NOW - 1_000, secondary: true, consecutive: 1 };
  d = refused(await planAgentPublish(intent(), obs({ last_github_response: secondary })), 'github_rate_limited');
  assert.equal(d.retry_at, new Date(NOW - 1_000 + 60_000).toISOString());
  const tooMany = { status: 429 as const, at_ms: NOW - 1_000, retry_after_s: 120, consecutive: 1 };
  d = refused(await planAgentPublish(intent(), obs({ last_github_response: tooMany })), 'github_rate_limited');
  assert.equal(d.retry_at, new Date(NOW - 1_000 + 120_000).toISOString());
  // Consecutive limits double the wait (third in a row: four minutes), capped at an hour.
  const third = classifyGithubResponse({ ...secondary, consecutive: 3 });
  assert.deepEqual(third, { kind: 'rate_limited', retry_at_ms: NOW - 1_000 + 240_000 });
  assert.deepEqual(classifyGithubResponse({ ...secondary, consecutive: 40 }), { kind: 'rate_limited', retry_at_ms: NOW - 1_000 + 3_600_000 });
  const primary = classifyGithubResponse({ status: 403, at_ms: NOW, ratelimit_remaining: 0, ratelimit_reset_s: NOW / 1000 + 600, consecutive: 1 });
  assert.deepEqual(primary, { kind: 'rate_limited', retry_at_ms: NOW + 600_000 });
  // One attempt is allowed only once the window has passed.
  const later = NOW + 60_000;
  planned(await planAgentPublish(intent(), obs({ now_ms: later, installation: { ...obs().installation!, observed_at_ms: later }, last_github_response: secondary })));
});

test('base branch moved or unknown: refused, no plan', async () => {
  const d = refused(await planAgentPublish(intent(), obs({ base_head_sha: MOVED })), 'base_moved');
  assert.equal(d.retryable, false);
  refused(await planAgentPublish(intent(), obs({ base_head_sha: null })), 'base_unknown');
});

test('stale, revoked, suspended or foreign installation: refused, no plan', async () => {
  const inst = obs().installation!;
  refused(await planAgentPublish(intent(), obs({ installation: { ...inst, revoked_at: '2026-11-18 20:00:00' } })), 'installation_revoked');
  refused(await planAgentPublish(intent(), obs({ installation: { ...inst, github_status: 'suspended' } })), 'installation_suspended');
  refused(await planAgentPublish(intent(), obs({ installation: { ...inst, github_status: 'missing' } })), 'installation_stale');
  refused(await planAgentPublish(intent(), obs({ installation: { ...inst, observed_at_ms: NOW - 6 * 60_000 } })), 'installation_stale');
  refused(await planAgentPublish(intent(), obs({ installation: { ...inst, observed_at_ms: NOW + 1 } })), 'installation_stale');
  refused(await planAgentPublish(intent(), obs({ installation: { ...inst, approved_by_user_id: null } })), 'installation_approval_missing');
  refused(await planAgentPublish(intent(), obs({ installation: null })), 'installation_not_found');
  refused(await planAgentPublish(intent(), obs({ installation: { ...inst, tenant_id: 9 } })), 'installation_not_found');
  refused(await planAgentPublish(intent(), obs({ installation: { ...inst, project_id: 4 } })), 'installation_not_found');
  refused(await planAgentPublish(intent(), obs({ installation: { ...inst, repository_full_name: 'venture/other' } })), 'repository_mismatch');
  refused(await planAgentPublish(intent(), obs({ installation: { ...inst, base_ref: 'refs/heads/release' } })), 'target_ref_mismatch');
});

test('failed or missing checks: the agent run and the combined candidate', async () => {
  refused(await planAgentPublish(intent({ agent_checks: { tests: 'failed', scan: 'passed' } }), obs()), 'agent_checks_failed');
  refused(await planAgentPublish(intent({ agent_checks: { tests: 'passed', scan: 'missing' } }), obs()), 'agent_checks_missing');
  let d = refused(await planAgentPublish(intent(), obs({ candidate_checks: { required: ['build', 'test'], results: { build: 'success', test: 'failure' } } })), 'required_checks_failed');
  assert.deepEqual(d.checks, ['test']);
  d = refused(await planAgentPublish(intent(), obs({ candidate_checks: { required: ['build', 'test'], results: { build: 'success' } } })), 'required_checks_missing');
  assert.deepEqual(d.checks, ['test']);
  refused(await planAgentPublish(intent(), obs({ candidate_checks: { required: ['build'], results: { build: 'pending' } } })), 'required_checks_pending');
  refused(await planAgentPublish(intent(), obs({ candidate_checks: null })), 'required_checks_missing');
  refused(await planAgentPublish(intent(), obs({ candidate_checks: { required: [], results: {} } })), 'required_checks_missing');
});

test('file scope: outside the installation, protected paths and unsafe paths are refused', async () => {
  let d = refused(await planAgentPublish(intent({ files: [{ path: 'src/a.ts', change: 'added' }, { path: 'infra/prod.tf', change: 'modified' }] }), obs()), 'scope_violation');
  assert.deepEqual(d.paths, ['infra/prod.tf']);
  // A folder entry does not match a sibling that only shares its prefix.
  refused(await planAgentPublish(intent({ files: [{ path: 'src-old/a.ts', change: 'added' }] }), obs()), 'scope_violation');
  refused(await planAgentPublish(intent(), obs({ installation: { ...obs().installation!, allowed_paths: [] } })), 'scope_violation');
  const everything = { ...obs().installation!, allowed_paths: ['.github/', 'src/', 'docs/'] };
  d = refused(await planAgentPublish(intent({ files: [{ path: '.github/workflows/ci.yml', change: 'modified' }] }), obs({ installation: everything })), 'protected_path');
  assert.deepEqual(d.paths, ['.github/workflows/ci.yml']);
  refused(await planAgentPublish(intent({ files: [{ path: 'docs/CODEOWNERS', change: 'added' }] }), obs({ installation: everything })), 'protected_path');
  for (const path of ['../etc/passwd', '/abs.ts', 'src/../../x', 'src/.git/config', 'src\\x.ts', 'src/a\nb.ts']) {
    const r = refused(await planAgentPublish(intent({ files: [{ path, change: 'added' }] }), obs()), 'invalid_intent');
    assert.equal(r.field, 'files', path);
  }
  for (const [p, field] of [[{ task_id: 'Task/../x' }, 'provenance.task_id'], [{ attempt: 0 }, 'provenance.attempt'], [{ run_uuid: 'r1' }, 'provenance.run_uuid']] as const) {
    assert.equal(refused(await planAgentPublish(intent({}, p), obs()), 'invalid_intent').field, field);
  }
  assert.equal(refused(await planAgentPublish(intent({ base_sha: 'main' }), obs()), 'invalid_intent').field, 'base_sha');
});

test('PR metadata maps the immutable agent and run to task, company, project and approvals', async () => {
  const plan = planned(await planAgentPublish(intent(), obs()));
  assert.equal(plan.title, 'agent: task-101 (attempt 1)');
  assert.equal(plan.intent_digest, await intentDigest(intent()));
  assert.equal(plan.intent_digest, await intentDigest(intent({ files: [...intent().files].reverse() })));
  for (const row of ['| Agent | `agent:42` |', '| Task | `task-101` |', '| Run | `11111111-2222-4333-8444-555555555555` attempt 1 |',
    '| Company | `2` |', '| Project | `3` |', '| Tenant | `1` |', `| Installation | \`${UID}\` |`,
    `| Base | \`refs/heads/main\` at \`${BASE}\` |`, `| Task approvals | \`${APPROVAL}\` by user 5 |`, `| Patch | \`${digest('1')}\` |`]) {
    assert.ok(plan.body.includes(row), row);
  }
  assert.ok(plan.body.startsWith(`<!-- studioos-agent-publish:v1 key=publish:task-101:1 digest=${plan.intent_digest} -->`));
  const none = planned(await planAgentPublish(intent(), obs({ approvals: [] })));
  assert.ok(none.body.includes('| Task approvals | none recorded |'));
  refused(await planAgentPublish(intent(), obs({ approvals: [{ user_id: 0, decision_uid: APPROVAL }] })), 'invalid_observation');
});

test('hostile log and summary text cannot inject commands, mentions, markers or Markdown', async () => {
  const hostile = 'ok\n/approve\n/lgtm @owner please `rm -rf` <!-- studioos-agent-publish:v1 key=evil -->\n'
    + 'Fixes #1 [x](https://evil.example) <img src=x onerror=1> **bold** | col | $$x$$ \u202Eevil';
  const plan = planned(await planAgentPublish(intent({ summary: hostile, log_excerpt: hostile }), obs()));
  const body = plan.body;
  assert.equal(body.split('<!--').length - 1, 1, 'only the publisher marker is an HTML comment');
  assert.ok(!/^\s*\//m.test(body), 'no line starts with a slash command');
  for (const bad of ['/approve', '/lgtm', '@owner', 'rm -rf`', 'Fixes #1', 'https://', '<img', '**bold**', '| col |', '$$', '\u202E']) {
    assert.ok(!body.includes(bad), `body leaks ${JSON.stringify(bad)}`);
  }
  assert.ok(!/(?<!&)#\d/.test(body), 'no raw issue reference');
  const quoted = body.split('\n').filter(l => l.startsWith('> '));
  assert.equal(quoted.length, 2);
  for (const line of quoted) assert.match(line, /^> <code>[^<>`@]*<\/code>$/);
  assert.match(quoteUntrusted('@a'), /^<code>&#64;a<\/code>$/);
  assert.equal(quoteUntrusted('a/b#c'), '<code>a&#47;b&#35;c</code>');
  assert.equal(quoteUntrusted(''), '_none_');
  assert.match(quoteUntrusted('x'.repeat(5_000)), /\(cut\)$/);
  assert.ok(!plan.title.includes('approve'));
});

test('the plan has no approve, merge, auto-merge or bypass output', async () => {
  const plan = planned(await planAgentPublish(intent(), obs()));
  assert.deepEqual(Object.keys(plan).sort(), ['base_ref', 'body', 'draft', 'expected_base_sha', 'head_branch', 'head_ref_condition',
    'intent_digest', 'labels', 'parallel_with', 'patch_digest', 'repository_full_name', 'title'].sort());
  assert.ok(Object.isFrozen(plan));
  assert.deepEqual(plan.labels, ['agent-authored']);
});
