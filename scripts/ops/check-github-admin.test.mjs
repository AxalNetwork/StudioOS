// D8082 (#8082): the admin drift check against fixtures. No network, no clock: every date is passed in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BASELINE, CheckError, ISSUE_LABELS, BOT_LOGIN, checkCommand, diffBaseline, fromReport, issueBody, looksSecret,
  makeIssueClient, makeReader, normalize, parseBaseline, readLive, renderTable, safeValue, syncDriftIssues, toReport,
} from './check-github-admin.mjs';

const REPO = 'ExampleOrg/example-repo';
const PIN = 'a'.repeat(40);

/** A synthetic organisation: every value is invented, and nothing here is an id of anything real. */
function liveFixture() {
  return {
    [`/repos/${REPO}/actions/permissions`]: { enabled: true, allowed_actions: 'selected' },
    [`/repos/${REPO}/actions/permissions/selected-actions`]: { github_owned_allowed: true, verified_allowed: false, patterns_allowed: [`actions/checkout@${PIN}`, `actions/setup-node@${PIN}`] },
    [`/repos/${REPO}/actions/permissions/workflow`]: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false },
    [`/repos/${REPO}/actions/permissions/fork-pr-contributor-approval`]: { approval_policy: 'all_external_contributors' },
    [`/repos/${REPO}`]: { allow_auto_merge: true, allow_update_branch: true, delete_branch_on_merge: true, has_wiki: false, has_discussions: true, allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false,
      security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' }, dependabot_security_updates: { status: 'enabled' } } },
    [`/repos/${REPO}/private-vulnerability-reporting`]: { enabled: true },
    [`/repos/${REPO}/rulesets?includes_parents=true`]: [{ id: 1, name: 'main' }, { id: 2, name: 'platform paths' }],
    [`/repos/${REPO}/rulesets/1`]: { enforcement: 'active', target: 'branch', conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } }, bypass_actors: [],
      rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request', parameters: { required_approving_review_count: 0, require_code_owner_review: false, dismiss_stale_reviews_on_push: false, require_last_push_approval: false } },
        { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'scan' }, { context: 'frontend (build)' }] } },
        { type: 'merge_queue', parameters: { merge_method: 'SQUASH', max_entries_to_merge: 5, grouping_strategy: 'ALLGREEN' } }] },
    [`/repos/${REPO}/rulesets/2`]: { enforcement: 'active', target: 'branch', conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } }, bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
      rules: [{ type: 'pull_request', parameters: { required_approving_review_count: 1, require_code_owner_review: true, dismiss_stale_reviews_on_push: true, require_last_push_approval: false } }] },
    [`/repos/${REPO}/environments`]: { total_count: 2, environments: [
      { name: 'production ', protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: 'example-owner' } }] }, { type: 'branch_policy' }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } },
      { name: 'production-ops', protection_rules: [], deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }] },
    [`/repos/${REPO}/environments/production%E2%80%89/deployment-branch-policies`]: { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] },
    [`/repos/${REPO}/environments/production%E2%80%89/secrets`]: { total_count: 1, secrets: [{ name: 'CLOUDFLARE_API_TOKEN' }] },
    [`/repos/${REPO}/environments/production%E2%80%89/variables`]: { total_count: 0, variables: [] },
    [`/repos/${REPO}/environments/production-ops/secrets`]: { total_count: 2, secrets: [{ name: 'ADMIN_DRIFT_READ_TOKEN' }, { name: 'CLOUDFLARE_API_TOKEN' }] },
    [`/repos/${REPO}/environments/production-ops/variables`]: { total_count: 0, variables: [] },
    '/orgs/ExampleOrg': { two_factor_requirement_enabled: true, default_repository_permission: 'read', members_can_create_public_repositories: false, members_can_create_private_repositories: true },
    '/orgs/ExampleOrg/installations': { total_count: 1, installations: [{ app_slug: 'example-coordinator', repository_selection: 'selected', permissions: { issues: 'read', metadata: 'read' }, events: [] }] },
    '/orgs/ExampleOrg/actions/runner-groups': { total_count: 2, runner_groups: [
      { id: 1, name: 'Default', visibility: 'all', allows_public_repositories: false, restricted_to_workflows: false, selected_workflows: [] },
      { id: 2, name: 'trusted', visibility: 'selected', allows_public_repositories: true, restricted_to_workflows: true, selected_workflows: [`${REPO}/.github/workflows/deploy.yml@refs/heads/main`] }] },
    '/orgs/ExampleOrg/actions/runner-groups/2/repositories': { total_count: 1, repositories: [{ full_name: REPO }] },
  };
}

/** A GitHub REST double: GET only for the reader; records every call. `deny` maps a path prefix to a status. */
function fakeGitHub(routes = liveFixture(), { deny = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.replace('https://api.github.com', '');
    calls.push({ method: init.method, path });
    const bare = path.replace(/[?&]per_page=\d+&page=\d+$/, '');
    for (const [prefix, status] of Object.entries(deny)) if (bare === prefix || bare.startsWith(prefix + '/')) return { status, json: async () => ({ message: 'Resource not accessible by integration' }) };
    if (!Object.hasOwn(routes, bare)) return { status: 404, json: async () => ({ message: 'Not Found' }) };
    return { status: 200, json: async () => routes[bare] };
  };
  return { calls, reader: makeReader({ token: 'test-token-placeholder', fetchImpl }) };
}

const doc = rows => `# t\n\n| Setting | Expected | Planned | By |\n| --- | --- | --- | --- |\n${rows.map(([k, v]) => `| \`${k}\` | ${v} | x | #1 |`).join('\n')}\n`;
async function run(rows, options) {
  const github = fakeGitHub(options?.routes, options);
  const lines = [];
  const outcome = await checkCommand({ baselineText: doc(rows), reader: github.reader, repository: REPO, log: line => lines.push(line) });
  return { ...outcome, lines, calls: github.calls, byKey: Object.fromEntries(outcome.results.map(r => [r.key, r])) };
}

test('the committed baseline parses: every section has a table, every key is known, nothing expected yet', () => {
  const text = readFileSync(new URL(`../../${BASELINE}`, import.meta.url), 'utf8');
  const { rows, errors } = parseBaseline(text);
  assert.deepEqual(errors, []);
  const sections = new Set(rows.map(r => r.section));
  for (const s of ['Rulesets', 'Repository settings', 'Actions', 'Organisation', 'Environments', 'GitHub Apps', 'Runner groups', 'Cloud']) {
    assert.ok(sections.has(s), `${s} has rows`);
    assert.match(text, new RegExp(`^## ${s}`, 'm'), `${s} has a heading`);
  }
  // D8060, D8062, D8063 (#8840): the applied #8060, #8062 and #8063 values are mirrored; nothing else is.
  const recorded = rows.filter(r => r.expected !== null);
  const sectionsRecorded = [...new Set(recorded.map(r => r.section))].sort();
  assert.deepEqual(sectionsRecorded, ['Actions', 'Environments', 'Organisation', 'Repository settings', 'Rulesets']);
  const byKey = Object.fromEntries(rows.map(r => [r.key, r.expected]));
  // Keys use the live ruleset name; the required-checks row is #8641's and stays unrecorded here.
  assert.equal(byKey['rulesets.names'], 'Code Quality Copilot review for default branch, main: required checks');
  assert.equal(byKey['ruleset[main: required checks].bypass_actors'], 'none');
  assert.equal(byKey['ruleset[main].required_status_checks'], null);
  assert.ok(rows.filter(r => r.name === 'platform paths').every(r => r.expected === null), 'phase 2 is not applied');
  assert.equal(byKey['org.members_can_create_public_repositories'], null);
  // The corrected allowlist: 17 full references, sub-actions listed on their own, every one pinned at a full SHA.
  const allowed = byKey['actions.selected.patterns_allowed'].split(', ');
  assert.equal(allowed.length, 17);
  assert.ok(allowed.every(ref => /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[0-9a-f]{40}$/.test(ref)), 'every reference is SHA-pinned');
  for (const ref of ['actions/cache/restore', 'actions/cache/save', 'github/codeql-action/init', 'github/codeql-action/analyze', 'github/codeql-action/upload-sarif']) {
    assert.ok(allowed.some(a => a.startsWith(`${ref}@`)), `${ref} has its own entry`);
  }
  // Applied as one `main` branch rule, not protected branches; the thin-space names were kept.
  for (const env of ['preview', 'staging', 'production', 'production-ops']) {
    assert.equal(byKey[`environment[${env}].branch_policy`], 'custom', env);
    assert.equal(byKey[`environment[${env}].branch_policies`], 'main (branch)', env);
  }
  assert.equal(byKey['environment[production].name_exact'], 'false');
  // Apps, runner groups and cloud have no record yet.
  assert.ok(rows.filter(r => ['GitHub Apps', 'Runner groups', 'Cloud'].includes(r.section)).every(r => r.expected === null));
  assert.ok(!looksSecret(text.replace(/`[^`]*`/g, '')) && !/\b\d{7,}\b/.test(text), 'the baseline carries no id or secret');
});

test('parseBaseline: backticked values, "to be recorded", and refusals for unknown keys, duplicates and bare values', () => {
  const { rows, errors } = parseBaseline(doc([['repo.has_wiki', '`false`'], ['actions.enabled', '_to be recorded_'], ['bogus.key', '`1`'], ['repo.has_wiki', '`true`'], ['org.default_repository_permission', 'read']]));
  assert.deepEqual(rows.map(r => [r.key, r.expected, r.section]), [['repo.has_wiki', 'false', 'Repository settings'], ['actions.enabled', null, 'Actions']]);
  assert.equal(errors.length, 3);
  assert.match(errors.join('\n'), /unknown setting key `bogus.key`/);
  assert.match(errors.join('\n'), /listed twice/);
  assert.match(errors.join('\n'), /must be backticked/);
  assert.deepEqual(parseBaseline('no table').errors, ['the baseline has no setting rows']);
  assert.equal(normalize(' b, a ,c '), 'a, b, c');
});

/**
 * The consoles as the #8060, #8062 and #8063 STATUS records of 2026-11-21 describe them, in the REST
 * shapes the reader reads. Invented ids; the action pins are read from the committed baseline.
 */
function recordedConsole(patterns) {
  const R = `/repos/${REPO}`;
  const custom = { protected_branches: false, custom_branch_policies: true };
  const owner = [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: 'example-owner' } }] }];
  const environments = [
    { name: 'preview', protection_rules: [], deployment_branch_policy: custom },
    { name: 'staging ', protection_rules: [], deployment_branch_policy: custom },
    { name: 'production ', protection_rules: owner, deployment_branch_policy: custom },
    { name: 'production-ops', protection_rules: owner, deployment_branch_policy: custom },
    { name: 'landing-bot', protection_rules: [], deployment_branch_policy: custom },
  ];
  const routes = {
    [`${R}/actions/permissions`]: { enabled: true, allowed_actions: 'selected', sha_pinning_required: true },
    [`${R}/actions/permissions/selected-actions`]: { github_owned_allowed: false, verified_allowed: false, patterns_allowed: patterns },
    [`${R}/actions/permissions/workflow`]: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false },
    [`${R}/actions/permissions/fork-pr-contributor-approval`]: { approval_policy: 'all_external_contributors' },
    [R]: { allow_auto_merge: true, allow_update_branch: true, delete_branch_on_merge: true, has_wiki: false, has_discussions: false,
      security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' }, dependabot_security_updates: { status: 'enabled' } } },
    [`${R}/private-vulnerability-reporting`]: { enabled: true },
    [`${R}/rulesets?includes_parents=true`]: [{ id: 1, name: 'main: required checks' }, { id: 2, name: 'Code Quality Copilot review for default branch' }],
    [`${R}/rulesets/1`]: { enforcement: 'active', target: 'branch', conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } }, bypass_actors: [],
      rules: [{ type: 'deletion' }, { type: 'non_fast_forward' },
        { type: 'pull_request', parameters: { required_approving_review_count: 0, require_code_owner_review: false, dismiss_stale_reviews_on_push: false, require_last_push_approval: false } },
        { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'scan' }] } },
        { type: 'merge_queue', parameters: { merge_method: 'SQUASH', max_entries_to_build: 5, min_entries_to_merge: 1, max_entries_to_merge: 5, min_entries_to_merge_wait_minutes: 5, grouping_strategy: 'ALLGREEN', check_response_timeout_minutes: 90 } }] },
    [`${R}/rulesets/2`]: { enforcement: 'disabled', target: 'branch', conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } }, bypass_actors: [], rules: [] },
    [`${R}/environments`]: { total_count: environments.length, environments },
    '/orgs/ExampleOrg': { two_factor_requirement_enabled: true, default_repository_permission: 'read', members_can_create_public_repositories: true, members_can_create_private_repositories: true },
  };
  for (const env of environments) {
    const path = `${R}/environments/${encodeURIComponent(env.name)}`;
    routes[`${path}/deployment-branch-policies`] = { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] };
    routes[`${path}/secrets`] = { total_count: 0, secrets: env.name === 'landing-bot' ? [{ name: 'LANDING_BOT_APP_PRIVATE_KEY' }, { name: 'LANDING_BOT_APP_ID' }] : [] };
    routes[`${path}/variables`] = { total_count: 0, variables: [] };
  }
  return routes;
}

test('the committed baseline matches the consoles the #8060, #8062 and #8063 records describe, with no drift', async () => {
  const text = readFileSync(new URL(`../../${BASELINE}`, import.meta.url), 'utf8');
  const patterns = parseBaseline(text).rows.find(r => r.key === 'actions.selected.patterns_allowed').expected.split(', ');
  const github = fakeGitHub(recordedConsole([...patterns].reverse()));
  const outcome = await checkCommand({ baselineText: text, reader: github.reader, repository: REPO, log: () => {} });
  const having = status => outcome.results.filter(r => r.status === status);
  assert.deepEqual(having('drift').map(r => `${r.key}: ${r.expected} != ${r.live}`), []);
  assert.equal(outcome.drift, 0);
  assert.equal(having('match').length, 62);
  // A console that moves back to the old values is caught: the queue maximum and the bypass list.
  const moved = recordedConsole(patterns);
  moved[`/repos/${REPO}/rulesets/1`].rules[4].parameters.max_entries_to_merge = 30;
  moved[`/repos/${REPO}/rulesets/1`].bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }];
  moved[`/repos/${REPO}/actions/permissions/selected-actions`].patterns_allowed = patterns.filter(p => !p.startsWith('actions/cache/restore@'));
  const back = await checkCommand({ baselineText: text, reader: fakeGitHub(moved).reader, repository: REPO, log: () => {} });
  assert.deepEqual(back.results.filter(r => r.status === 'drift').map(r => r.key).sort(),
    ['actions.selected.patterns_allowed', 'ruleset[main: required checks].bypass_actors', 'ruleset[main: required checks].merge_queue.max_entries_to_merge']);
});

// One fixture per section: a matching row, a drifted row and a to-be-recorded row.
const SECTION_FIXTURES = {
  Rulesets: [
    ['ruleset[main].merge_queue.max_entries_to_merge', '`5`', 'match'],
    ['ruleset[main].required_status_checks', '`scan, frontend (build)`', 'match'],
    ['ruleset[platform paths].bypass_actors', '`none`', 'drift', 'RepositoryRole:always'],
    ['ruleset[gone].enforcement', '`active`', 'drift', 'absent'],
    ['rulesets.names', 'to be recorded', 'to-be-recorded', 'main, platform paths'],
  ],
  'Repository settings': [
    ['repo.allow_auto_merge', '`true`', 'match'],
    ['repo.has_discussions', '`false`', 'drift', 'true'],
    ['repo.secret_scanning_push_protection', 'to be recorded', 'to-be-recorded', 'enabled'],
  ],
  Actions: [
    ['actions.selected.patterns_allowed', `\`actions/setup-node@${PIN}, actions/checkout@${PIN}\``, 'match'],
    ['actions.workflow.default_permissions', '`write`', 'drift', 'read'],
    ['actions.fork_pr_approval', 'to be recorded', 'to-be-recorded', 'all_external_contributors'],
  ],
  Organisation: [
    ['org.two_factor_requirement_enabled', '`true`', 'match'],
    ['org.members_can_create_private_repositories', '`false`', 'drift', 'true'],
    ['org.default_repository_permission', 'to be recorded', 'to-be-recorded', 'read'],
  ],
  Environments: [
    ['environment[production].branch_policies', '`main (branch)`', 'match'],
    ['environment[production].name_exact', '`true`', 'drift', 'false'],
    ['environment[production-ops].required_reviewers', '`1`', 'drift', '0'],
    ['environment[production-ops].secret_names', 'to be recorded', 'to-be-recorded', 'ADMIN_DRIFT_READ_TOKEN, CLOUDFLARE_API_TOKEN'],
  ],
  'GitHub Apps': [
    ['app[example-coordinator].permissions', '`metadata:read, issues:read`', 'match'],
    ['app[example-landing-bot].installed', '`true`', 'drift', 'absent'],
    ['apps.installed', 'to be recorded', 'to-be-recorded', 'example-coordinator'],
  ],
  'Runner groups': [
    ['runner_group[trusted].includes_this_repository', '`true`', 'match'],
    ['runner_group[trusted].allows_public_repositories', '`false`', 'drift', 'true'],
    ['runner_group[Default].visibility', 'to be recorded', 'to-be-recorded', 'all'],
  ],
};

for (const [section, cases] of Object.entries(SECTION_FIXTURES)) {
  test(`${section}: match, drift and to-be-recorded against the fixture`, async () => {
    const { byKey, drift } = await run(cases.map(([k, v]) => [k, v]));
    for (const [key, , status, live] of cases) {
      assert.equal(byKey[key].section, section, key);
      assert.equal(byKey[key].status, status, key);
      if (live !== undefined) assert.equal(byKey[key].live, live, key);
    }
    assert.equal(drift, cases.filter(c => c[2] === 'drift').length);
  });
}

test('Cloud rows are "not checked", never drift, and need no cloud read', async () => {
  const { byKey, drift, calls } = await run([['cloud.aws.roles', '`studioos-gha-preview`'], ['cloud.azure.resource_group', 'to be recorded'], ['actions.enabled', '`true`']]);
  assert.equal(byKey['cloud.aws.roles'].status, 'not-checked');
  assert.equal(byKey['cloud.azure.resource_group'].status, 'not-checked');
  assert.equal(drift, 0);
  assert.ok(calls.every(c => c.path.startsWith('/repos/') || c.path.startsWith('/orgs/')));
});

test('the reader only ever sends GET', async () => {
  const { calls } = await run(Object.values(SECTION_FIXTURES).flat().map(([k, v]) => [k, v]));
  assert.ok(calls.length > 10);
  assert.deepEqual([...new Set(calls.map(c => c.method))], ['GET']);
  assert.equal(typeof makeReader({ token: 'x', fetchImpl: async () => ({}) }).post, 'undefined');
});

test('a missing token fails closed before any read', async () => {
  assert.throws(() => makeReader({ token: '' }), err => err instanceof CheckError && /ADMIN_DRIFT_READ_TOKEN is not set/.test(err.message) && /instead of "no drift"/.test(err.message));
});

test('a token without administration read fails closed, even when every row is to be recorded', async () => {
  await assert.rejects(run([['repo.has_wiki', 'to be recorded']], { deny: { [`/repos/${REPO}/actions/permissions`]: 403 } }),
    err => err instanceof CheckError && /Administration: read/.test(err.message) && /nothing was checked/.test(err.message));
  await assert.rejects(run([['repo.has_wiki', 'to be recorded']], { deny: { [`/repos/${REPO}`]: 401 } }), err => err instanceof CheckError && /401/.test(err.message));
});

// Missing permission per section: an expected row the token cannot read fails the run; a to-be-recorded one does not.
const DENIED = {
  Rulesets: [`/repos/${REPO}/rulesets?includes_parents=true`, 'ruleset[main].enforcement'],
  'Repository settings': [`/repos/${REPO}/private-vulnerability-reporting`, 'repo.private_vulnerability_reporting'],
  Environments: [`/repos/${REPO}/environments`, 'environment[production-ops].branch_policy'],
  Organisation: ['/orgs/ExampleOrg', 'org.two_factor_requirement_enabled'],
  'GitHub Apps': ['/orgs/ExampleOrg/installations', 'apps.installed'],
  'Runner groups': ['/orgs/ExampleOrg/actions/runner-groups', 'runner_group[trusted].visibility'],
  Actions: [`/repos/${REPO}/actions/permissions/workflow`, 'actions.workflow.default_permissions'],
};
for (const [section, [path, key]] of Object.entries(DENIED)) {
  test(`${section}: a missing permission fails closed when a value is expected, and is shown as unreadable otherwise`, async () => {
    await assert.rejects(run([[key, '`x`']], { deny: { [path]: 403 } }), err => err instanceof CheckError && err.message.includes(key) && /failing closed/.test(err.message));
    const { byKey, drift } = await run([[key, 'to be recorded']], { deny: { [path]: 403 } });
    assert.equal(byKey[key].status, 'to-be-recorded');
    assert.equal(byKey[key].live, 'unreadable');
    assert.equal(drift, 0);
  });
}

test('a field the token cannot see (bypass actors, security settings) is unreadable, not a match', async () => {
  const routes = liveFixture();
  delete routes[`/repos/${REPO}/rulesets/1`].bypass_actors;
  delete routes[`/repos/${REPO}`].security_and_analysis;
  await assert.rejects(run([['ruleset[main].bypass_actors', '`none`']], { routes }), /failing closed/);
  await assert.rejects(run([['repo.secret_scanning_push_protection', '`enabled`']], { routes }), /failing closed/);
});

// ── Issues ────────────────────────────────────────────────────────────────

/** An issues API double holding state across runs. */
function fakeIssues(initial = []) {
  const issues = initial.map(i => ({ state: 'open', user: { login: BOT_LOGIN }, comments: [], labels: [], ...i }));
  const writes = [];
  const client = {
    async request(method, path, body) {
      if (method === 'GET') {
        const page = Number(/[?&]page=(\d+)/.exec(path)[1]);
        assert.match(path, /labels=slot%3Achatgptpro/);
        return page === 1 ? issues.map(i => ({ ...i })) : [];
      }
      writes.push({ method, path, body });
      const number = Number(/issues\/(\d+)/.exec(path)?.[1]);
      if (method === 'POST' && path.endsWith('/issues')) {
        const issue = { number: 100 + issues.length, state: 'open', user: { login: BOT_LOGIN }, comments: [], ...body };
        issues.push(issue);
        return issue;
      }
      const issue = issues.find(i => i.number === number);
      if (method === 'PATCH') Object.assign(issue, body);
      if (method === 'POST' && path.endsWith('/comments')) issue.comments.push(body.body);
      return issue;
    },
  };
  return { client, issues, writes };
}
const drift = (key, expected, live) => ({ key, section: 'Actions', expected, live, status: 'drift' });

test('one issue per drift, labelled for the admin slot, and the same drift again updates it without a duplicate', async () => {
  const gh = fakeIssues();
  const results = [drift('actions.workflow.default_permissions', 'read', 'write'), drift('repo.has_wiki', 'false', 'true'), { key: 'org.default_repository_permission', section: 'Organisation', expected: null, live: 'read', status: 'to-be-recorded' }];
  const first = await syncDriftIssues({ client: gh.client, repository: REPO, results, date: '2026-11-23' });
  assert.deepEqual(first.map(a => a.action), ['opened', 'opened']);
  assert.equal(gh.issues.length, 2);
  for (const issue of gh.issues) assert.deepEqual(issue.labels, [...ISSUE_LABELS]);
  assert.deepEqual(gh.issues.map(i => i.title), ['[admin drift] actions.workflow.default_permissions', '[admin drift] repo.has_wiki']);

  const second = await syncDriftIssues({ client: gh.client, repository: REPO, results, date: '2026-11-30' });
  assert.deepEqual(second.map(a => a.action), ['updated', 'updated']);
  assert.equal(gh.issues.length, 2, 'no duplicate on repeat');
  assert.match(gh.issues[0].body, /Last checked 2026-11-30/);
  assert.deepEqual(gh.issues.map(i => i.comments.length), [0, 0], 'an unchanged drift adds no comment');

  const third = await syncDriftIssues({ client: gh.client, repository: REPO, results: [drift('actions.workflow.default_permissions', 'read', 'none')], date: '2026-12-07' });
  assert.deepEqual(third.map(a => a.action), ['updated-and-noted']);
  assert.match(gh.issues[0].comments[0], /live `none` \(was `write`\)/);
});

test('a resolved drift is noted once and left open; a returning drift reopens the same issue', async () => {
  const gh = fakeIssues();
  const key = 'repo.has_wiki';
  await syncDriftIssues({ client: gh.client, repository: REPO, results: [drift(key, 'false', 'true')], date: '2026-11-23' });
  const fixed = [{ key, section: 'Actions', expected: 'false', live: 'false', status: 'match' }];
  assert.deepEqual((await syncDriftIssues({ client: gh.client, repository: REPO, results: fixed, date: '2026-11-30' })).map(a => a.action), ['noted-resolved']);
  assert.equal(gh.issues[0].state, 'open', 'never closed by the check');
  assert.match(gh.issues[0].comments[0], /Resolved on 2026-11-30/);
  assert.deepEqual(await syncDriftIssues({ client: gh.client, repository: REPO, results: fixed, date: '2026-12-07' }), [], 'resolution is noted once');
  assert.ok(!gh.writes.some(w => w.body?.state === 'closed'));
  gh.issues[0].state = 'closed';
  const back = await syncDriftIssues({ client: gh.client, repository: REPO, results: [drift(key, 'false', 'true')], date: '2026-12-14' });
  assert.deepEqual(back.map(a => [a.action, a.number]), [['reopened', gh.issues[0].number]]);
  assert.equal(gh.issues.length, 1);
  assert.equal(gh.issues[0].state, 'open');
});

test('an issue with the marker written by someone other than the workflow is not adopted', async () => {
  const body = issueBody(drift('repo.has_wiki', 'false', 'true'), { date: '2026-11-01' });
  const gh = fakeIssues([{ number: 7, body, user: { login: 'someone-else' } }]);
  const actions = await syncDriftIssues({ client: gh.client, repository: REPO, results: [drift('repo.has_wiki', 'false', 'true')], date: '2026-11-23' });
  assert.deepEqual(actions.map(a => a.action), ['opened']);
});

test('no secret-looking value reaches an issue body, a title or the report', async () => {
  const hostile = [
    'ghp_' + 'A'.repeat(36), 'github_pat_' + 'B'.repeat(30), 'AKIA' + 'C'.repeat(16), 'eyJhbGciOiJIUzI1NiJ9.e30.x',
    'f'.repeat(32), '123456789012', '01234567-89ab-cdef-0123-456789abcdef', 'https://runner.example.internal', '10.0.0.12',
    'Q'.repeat(44), '-----BEGIN PRIVATE KEY-----',
  ];
  const gh = fakeIssues();
  const results = hostile.map((value, i) => drift(`repo.setting_${'abcdefghijklmnop'[i]}`, 'expected', value));
  await syncDriftIssues({ client: gh.client, repository: REPO, results, date: '2026-11-23' });
  for (const issue of gh.issues) {
    assert.ok(!looksSecret(issue.title));
    assert.ok(!looksSecret(issue.body), issue.body);
    assert.match(issue.body, /\[withheld: looks like a secret, an id or a host\]/);
  }
  const report = JSON.stringify(toReport(results));
  for (const value of hostile) assert.ok(!report.includes(value), value);
  // A pinned action SHA and an ordinary name are not secrets, and the table cannot be broken out of.
  assert.equal(safeValue(`actions/checkout@${PIN}`), `actions/checkout@${PIN}`);
  assert.equal(safeValue('a|b`c<d>'), 'a b c d ');
  assert.ok(!renderTable(results).includes(hostile[0]));
});

test('the report round-trips and refuses a malformed one', () => {
  const results = [drift('repo.has_wiki', 'false', 'true')];
  assert.deepEqual(fromReport(JSON.stringify(toReport(results))), results);
  assert.throws(() => fromReport('{"schema":1,"results":[{"key":"x","status":"weird"}]}'), CheckError);
  assert.throws(() => fromReport('{"schema":2,"results":[]}'), CheckError);
});

test('the issue client needs a token and surfaces a refused write', async () => {
  assert.throws(() => makeIssueClient({ token: '' }), /GH_TOKEN is not set/);
  const client = makeIssueClient({ token: 't', fetchImpl: async () => ({ status: 403, json: async () => ({}) }) });
  await assert.rejects(client.request('POST', `/repos/${REPO}/issues`, {}), /returned 403/);
});

test('diffBaseline flags an expected value read as unreadable in a readable section', () => {
  const rows = parseBaseline(doc([['actions.fork_pr_approval', '`all_external_contributors`']])).rows;
  const live = { values: new Map([['actions.fork_pr_approval', 'unreadable']]), entities: new Map(), unreadable: new Map() };
  const { failures } = diffBaseline(rows, live);
  assert.equal(failures.length, 1);
});

test('the live read leaves no fixture path unread (each section is really read)', async () => {
  const github = fakeGitHub();
  await readLive({ reader: github.reader, repository: REPO });
  const read = new Set(github.calls.map(c => c.path.replace(/[?&]per_page=\d+&page=\d+$/, '')));
  assert.deepEqual(Object.keys(liveFixture()).filter(p => !read.has(p)), []);
});
