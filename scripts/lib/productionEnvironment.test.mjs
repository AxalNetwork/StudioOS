/** D7145 runtime-policy response and release-step ordering regression fixtures. */
/** D7145: exercise the release preflight against GitHub REST response fixtures. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { verifyProductionEnvironment } from '../verify-production-environment.mjs';

const context = { GITHUB_REPOSITORY: 'AxalNetwork/StudioOS', GITHUB_REF: 'refs/heads/main', GH_TOKEN: 'fixture' };
const selected = { custom_branch_policies: true, protected_branches: false };
const environment = { name: 'production', deployment_branch_policy: selected };
const main = { name: 'main', type: 'branch' };
const rules = { total_count: 1, branch_policies: [main] };
const endpoint = 'https://api.github.com/repos/AxalNetwork/StudioOS/environments/production';

function responses(...pages) {
  return async (url, options) => {
    assert.equal(url, pages.length === 2 ? endpoint : `${endpoint}/deployment-branch-policies?per_page=100`);
    assert.equal(options.headers.Authorization, 'Bearer fixture');
    assert.equal(options.redirect, 'error');
    const page = pages.shift();
    return page instanceof Response ? page : Response.json(page);
  };
}

test('the selected main branch is admitted by the real release check', async () => {
  await verifyProductionEnvironment(context, responses(environment, rules));
  // GitHub resolves /production to this stored name with a trailing thin space.
  await verifyProductionEnvironment(context, responses({ ...environment, name: 'production\u2009' }, rules));
});

test('a missing, unrestricted, protected-branches-only or unreadable environment stops the release', async () => {
  for (const policy of [null, {}, { ...selected, custom_branch_policies: false }, { ...selected, protected_branches: true }]) {
    await assert.rejects(verifyProductionEnvironment(context, responses({ ...environment, deployment_branch_policy: policy }, rules)), /select deployment branches/);
  }
  await assert.rejects(verifyProductionEnvironment(context, responses(new Response(null, { status: 404 }), rules)), /HTTP 404/);
});

test('tags, globs, other branches, malformed policies, and additional pages all stop the release', async () => {
  const invalid = [
    null, {}, { total_count: 0, branch_policies: [] },
    { ...rules, branch_policies: [{ ...main, type: 'tag' }] },
    { ...rules, branch_policies: [{ name: 'main' }] },
    { ...rules, branch_policies: [{ ...main, name: '*' }] },
    { ...rules, branch_policies: [{ ...main, name: 'staging' }] },
    { ...rules, branch_policies: [main, { type: 'tag', name: '*' }] },
    { ...rules, total_count: 101 },
  ];
  for (const page of invalid) {
    await assert.rejects(verifyProductionEnvironment(context, responses(environment, page)), /exactly the main branch/);
  }
  await assert.rejects(verifyProductionEnvironment(context, responses(environment, new Response(null, { status: 403 }))), /HTTP 403/);
  await assert.rejects(verifyProductionEnvironment(context, responses(environment, new Response('invalid JSON'))), SyntaxError);
});

test('wrong repository, non-main refs and missing read credentials fail before network access', async () => {
  for (const change of [{ GITHUB_REF: 'refs/heads/release' }, { GITHUB_REF: 'refs/tags/main' }, { GITHUB_REPOSITORY: 'fork/StudioOS' }, { GH_TOKEN: '' }]) {
    await assert.rejects(verifyProductionEnvironment({ ...context, ...change }, () => assert.fail('unexpected request')), /canonical main branch/);
  }
});

test('each credentialed release job checks its policy before secrets, including a job-only rerun', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/cloudflare-worker-deploy.yml', import.meta.url), 'utf8');
  const { jobs } = parse(workflow);
  assert.equal(jobs.admission.environment, undefined);
  assert.doesNotMatch(JSON.stringify(jobs.admission), /secrets\./);
  assert.match(JSON.stringify(jobs.deploy), /secrets\.CLOUDFLARE_API_TOKEN/);
  for (const [name, job] of Object.entries(jobs)) {
    const firstSecret = job.steps.findIndex(step => JSON.stringify(step).includes('secrets.'));
    if (firstSecret < 0) continue;
    assert.equal(job.environment, 'production', name);
    assert.equal(job.permissions.actions, 'read', name);
    const preflight = job.steps.slice(0, firstSecret).find(step => step.run === 'node scripts/verify-production-environment.mjs');
    assert.ok(preflight, name);
    assert.equal(preflight.env.GH_TOKEN, '${{ github.token }}', name);
    assert.equal(preflight.if, undefined, name);
    assert.equal(preflight['continue-on-error'], undefined, name);
  }
});
