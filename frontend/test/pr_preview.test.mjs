/**
 * The pull-request preview Worker must stay what DECISIONS.md D36 says it is:
 * the PR's `docs/` build on workers.dev with NO bindings, built without a
 * credential by `.github/workflows/pr-preview.yml`, deployed from
 * `wrangler.pr-preview.toml` by the trusted `.github/workflows/pr-preview-deploy.yml`
 * (D7146) and deleted when the PR closes. Four things a future edit could
 * quietly undo, each of which would matter:
 *
 *   1. a binding appears in the preview config — a D1 id, a KV namespace, a
 *      queue — and pull-request code starts running against production data
 *      from a public workers.dev URL;
 *   2. the workflow starts deploying `wrangler.toml` (the production Worker)
 *      instead of the preview config, loses the close-time cleanup, or runs
 *      for forks that cannot have the secrets;
 *   3. the preview loses the one behaviour its script exists for — a missing
 *      hashed `/assets/*` file must be a real 404, never the SPA shell — or
 *      loses the SPA fallback that makes deep links work;
 *   4. (D7146) the pull-request run, which executes the branch's code, gets a
 *      secret again, or the trusted deploy starts trusting the artifact: the
 *      PR number, a script, a config or a lockfile taken from it.
 *
 * The production apex guards (apex_route_coverage, apex_truth_doc) read only
 * `wrangler.toml`; this file is the preview's counterpart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileFunction } from 'node:vm';

const root = resolve(process.cwd());
const at = (p) => readFileSync(resolve(root, p), 'utf8');

const CONFIG = 'wrangler.pr-preview.toml';
const WORKFLOW = '.github/workflows/pr-preview.yml';
const DEPLOY = '.github/workflows/pr-preview-deploy.yml';

/** A job's text: from `  <id>:` to the next job (or the end of the file). */
function jobOf(src, id) {
  const lines = src.split('\n');
  const at0 = lines.indexOf(`  ${id}:`);
  assert.ok(at0 > 0, `job ${id} is gone`);
  let end = lines.length;
  for (let i = at0 + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]) || /^\S/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(at0, end).join('\n');
}
/** The workflow without comment lines (prose may name what the code must not do). */
const code = (src) => src.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');

/** Non-comment, non-blank lines of the preview config, trimmed. */
const configLines = () =>
  at(CONFIG)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

test('the preview config declares no bindings, no environments and no routes', () => {
  const lines = configLines();
  const headers = lines.filter((l) => l.startsWith('['));
  assert.deepEqual(
    headers,
    ['[assets]'],
    `only [assets] may appear in ${CONFIG}; found ${headers.join(', ') || 'nothing'} — a binding here would put pull-request code in front of production data`,
  );
  for (const forbidden of [/database_id/, /^id\s*=/, /bucket_name/, /^queue\s*=/, /class_name/, /custom_domain/, /^routes?\s*=/, /^pattern\s*=/]) {
    assert.equal(lines.some((l) => forbidden.test(l)), false, `${CONFIG} matches ${forbidden}`);
  }
});

test('the preview config serves docs/ with the SPA fallback and runs its script first for /assets/*', () => {
  const lines = configLines();
  assert.ok(lines.includes('directory = "./docs"'), 'the preview must serve the built docs/');
  assert.ok(lines.includes('not_found_handling = "single-page-application"'), 'deep links need the SPA fallback');
  const rwf = lines.find((l) => /^run_worker_first\s*=/.test(l)) || '';
  assert.match(rwf, /"\/assets\/\*"/, '/assets/* must run the script first so a missing hash is a 404, not the shell');
  assert.match(rwf, /"\/api\/\*"/, '/api/* must run the script first so a fetch gets a clean 404, not the shell');
  assert.ok(lines.includes('workers_dev = true'), 'the workers.dev URL is the preview');
  assert.ok(lines.includes('preview_urls = false'), 'the PR Worker is its own preview; no second URL');
});

test('the preview script serves real assets and turns a fallback shell for a missing asset into a 404', () => {
  const main = configLines().find((l) => l.startsWith('main = '));
  assert.ok(main, `${CONFIG} needs a main script — an assets-only Worker serves the shell for every unmatched path`);
  const script = /^main = "([^"]+)"/.exec(main)?.[1];
  assert.ok(script && existsSync(resolve(root, script)), `${script} does not exist`);
  const src = at(script);
  assert.match(src, /env\.ASSETS\.fetch\(/, 'the script must serve real assets from the binding');
  // The script tests the content type with a regex literal, so the source
  // reads `text\/html`; accept the escaped and the plain spelling.
  assert.match(src, /text\\?\/html/, 'the script must detect the fallback HTML');
  assert.match(src, /status:\s*404/, 'a missing hashed asset must be a 404');
  assert.match(src, /startsWith\('\/api\/'\)/, '/api/* must be answered with a 404, never the shell');
  for (const forbidden of [/env\.DB\b/, /env\.TOKENS\b/, /env\.RATE_LIMITS\b/, /fetch\(\s*['"`]https?:/]) {
    assert.doesNotMatch(src, forbidden, `the preview script must reach nothing but the assets binding (${forbidden})`);
  }
});

test('the pull-request run builds and uploads docs/, deploys nothing and reads no secret (D7146)', () => {
  // Mutation checked: `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}` put back in the build job.
  const wf = code(at(WORKFLOW));
  assert.match(wf, /types: \[opened, synchronize, reopened, ready_for_review, closed\]/);
  assert.doesNotMatch(wf, /secrets\./, 'a pull_request run executes the branch\'s code: it may read no secret at all');
  assert.doesNotMatch(wf, /wrangler(?:@[\d.]+)? (?:deploy|delete)\b/, 'the pull-request run never deploys or deletes a Worker');
  assert.doesNotMatch(wf, /CLOUDFLARE_/);
  assert.doesNotMatch(wf, /pull-requests: write/, 'the sticky comment moved to the trusted deploy');
  assert.match(wf, /^permissions:\n {2}contents: read\n/m);
  const build = jobOf(wf, 'build');
  assert.match(build, /run: npm run build/);
  assert.match(build, /uses: actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(build, /name: pr-preview-docs/);
  for (const left of ['_headers', '.assetsignore', '.asset-retention.json', '.build-source']) {
    assert.ok(build.includes(`!docs/${left}`), `the upload leaves out docs/${left}: the trusted deploy refuses it`);
  }
  assert.match(build, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/, 'same-repository PRs only');
  assert.match(build, /github\.actor != 'dependabot\[bot\]'/);
  assert.match(build, /permissions:\n\s+contents: read\n/);
  assert.match(build, /persist-credentials: false/);
});

test('the trusted deploy runs main\'s file after the PR preview run, deploys the preview config under the per-PR name, and cleans up', () => {
  const src = at(DEPLOY);
  const wf = code(src);
  assert.match(wf, /^on:\n {2}workflow_run:\n {4}workflows: \[PR preview\]\n {4}types: \[completed\]\n\n/m, 'triggered only by the PR preview run completing');
  assert.match(at(WORKFLOW), /^name: PR preview$/m, 'the name workflow_run listens for');
  assert.match(wf, /^permissions: \{\}$/m, 'no token by default; each job asks for what it needs');
  assert.match(wf, /wrangler@[\d.]+ deploy --config wrangler\.pr-preview\.toml --name "\$PREVIEW_NAME"/, 'the deploy must target the preview config under the per-PR name');
  assert.doesNotMatch(wf, /--config (?:\.\.\/)?wrangler\.toml/, 'the preview workflow must never deploy the production config');
  assert.doesNotMatch(wf, /--env production/);
  assert.match(wf, /PREVIEW_NAME: studioos-pr-\$\{\{ needs\.resolve\.outputs\.number \}\}/, 'the Worker is named after the resolved PR number');
  assert.match(wf, /wrangler@[\d.]+ delete "\$PREVIEW_NAME"/, 'a closed PR must delete its Worker');
  assert.match(wf, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/, 'forks get no preview');
  assert.match(wf, /github\.event\.workflow_run\.event == 'pull_request'/);
  assert.doesNotMatch(wf, /migrate-d1|d1 execute|d1_databases/, 'a preview never migrates or touches D1');
  // The sticky comment and its marker survive the move.
  const deploy = jobOf(wf, 'deploy');
  assert.match(deploy, /marker='<!-- pr-preview -->'/);
  assert.match(deploy, /pull-requests: write/, 'the sticky comment needs pull-requests: write');
});

test('only the deploy and delete jobs hold the preview token, and only through the preview environment (D7146, D8069)', () => {
  // Mutation checked: `environment: preview` removed from delete; the token added to resolve.
  // D8069: the environment is `preview` (#8063's contract); the old `pr-preview` was never created.
  const wf = code(at(DEPLOY));
  for (const id of ['deploy', 'delete']) {
    const job = jobOf(wf, id);
    assert.match(job, /\n {4}environment:(?: preview\n|\n {6}name: preview\n)/, `${id} must name the preview environment, restricted to main`);
    assert.match(job, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.PR_PREVIEW_CLOUDFLARE_API_TOKEN \}\}/, `${id} uses the dedicated preview token`);
    assert.match(job, /needs: resolve/);
  }
  assert.doesNotMatch(wf, /secrets\.CLOUDFLARE_API_TOKEN\b/, 'the repository-level token is not used for previews any more (#7145 deletes it)');
  const resolveJob = jobOf(wf, 'resolve');
  assert.doesNotMatch(resolveJob, /secrets\.|\n {4}environment:/, 'resolve reads the event and the API only');
  assert.doesNotMatch(resolveJob, /actions\/checkout/, 'resolve checks nothing out');
  assert.equal((wf.match(/secrets\.PR_PREVIEW_CLOUDFLARE_API_TOKEN/g) || []).length, 2);
});

test('the trusted deploy treats the artifact as data: no PR checkout, no install, no script or config from it', () => {
  // Mutation checked: the check-preview-artifact step removed; `ref: ${{ github.event.workflow_run.head_sha }}` added to checkout.
  const wf = code(at(DEPLOY));
  assert.doesNotMatch(wf, /\n\s+ref:/, 'the only checkout is main\'s own commit');
  assert.doesNotMatch(wf, /workflow_run\.head_sha\b[^\n]*\n?[^\n]*ref|head_branch\b[^\n]*ref:/);
  assert.doesNotMatch(wf, /\bnpm (?:ci|install|run)\b|\byarn\b|\bpnpm\b/, 'nothing is installed or run from a lockfile');
  assert.doesNotMatch(wf, /actions\/download-artifact/, 'the zip is fetched as data and unpacked by the checker, never by an action');
  assert.doesNotMatch(wf, /cache:/, 'no dependency cache: nothing here writes main\'s cache scope');
  const deploy = jobOf(wf, 'deploy');
  const fetch = deploy.indexOf('actions/artifacts/$ARTIFACT_ID/zip');
  const check = deploy.indexOf('node scripts/check-preview-artifact.mjs --zip "$RUNNER_TEMP/preview-artifact/docs.zip" --out docs');
  const headers = deploy.indexOf('cp frontend/public/_headers docs/_headers');
  const ship = deploy.indexOf('deploy --config wrangler.pr-preview.toml');
  assert.ok(fetch > 0 && check > fetch && headers > check && ship > headers, 'fetch into the temp dir, check and unpack, add main\'s _headers, then deploy');
  assert.match(deploy, /persist-credentials: false/);
  assert.match(deploy, /\[\[ "\$PR_NUMBER" =~ \^\[1-9\]\[0-9\]\{0,6\}\$ && "\$HEAD_SHA" =~ \^\[0-9a-f\]\{40\}\$/);
});

// ── the resolve script, run against a simulated GitHub API ─────────────────

const resolveSource = (() => {
  const job = jobOf(at(DEPLOY), 'resolve');
  return job.split('          script: |\n')[1].replace(/^ {12}/gm, '');
})();
const runResolve = compileFunction('return (async () => {\n' + resolveSource + '\n})()', ['github', 'context', 'core']);
const SHA = 'b'.repeat(40);
const BRANCH = 'agent/claude/example';

async function resolveWith({ run = {}, pr = {}, listed, artifacts, policy = true, rules = [{ name: 'main', type: 'branch' }] } = {}) {
  const outputs = {};
  const calls = [];
  const theRun = {
    id: 99, event: 'pull_request', path: '.github/workflows/pr-preview.yml', head_sha: SHA, head_branch: BRANCH,
    head_repository: { full_name: 'AxalNetwork/StudioOS' }, conclusion: 'success',
    actor: { login: 'someone' }, triggering_actor: { login: 'someone' },
    pull_requests: [{ number: 7, head: { sha: SHA, ref: BRANCH } }],
    ...run,
  };
  const thePr = { number: 7, state: 'open', draft: false, user: { login: 'someone' }, head: { sha: SHA, ref: BRANCH, repo: { full_name: 'AxalNetwork/StudioOS' } }, ...pr };
  const github = {
    rest: {
      pulls: {
        async get(args) { calls.push(['pulls.get', args.pull_number]); return { data: thePr }; },
        async list(args) { calls.push(['pulls.list', args.head]); return { data: listed ?? [thePr] }; },
      },
      actions: {
        async listWorkflowRunArtifacts(args) {
          calls.push(['artifacts', args.run_id]);
          return { data: { artifacts: artifacts ?? [{ id: 5, name: 'pr-preview-docs', expired: false, size_in_bytes: 4e7, workflow_run: { id: 99, head_sha: SHA } }] } };
        },
      },
    },
    async request(route) {
      calls.push(['request', route]);
      if (route.endsWith('/deployment-branch-policies')) return { data: { branch_policies: rules } };
      return { data: { deployment_branch_policy: policy ? { protected_branches: false, custom_branch_policies: true } : null } };
    },
  };
  const context = { repo: { owner: 'AxalNetwork', repo: 'StudioOS' }, payload: { workflow_run: theRun } };
  const core = { setOutput: (k, v) => { outputs[k] = v; }, info: () => {} };
  await runResolve(github, context, core);
  return { outputs, calls };
}

test('resolve: a same-repository, ready pull request at its head is deployed from the payload number', async () => {
  const { outputs, calls } = await resolveWith();
  assert.deepEqual(outputs, { action: 'deploy', number: '7', head_sha: SHA, artifact_id: '5' });
  assert.deepEqual(calls.filter(([k]) => k === 'pulls.get'), [['pulls.get', 7]], 'the payload number is checked against the API');
  assert.ok(calls.some(([k, r]) => k === 'request' && r.endsWith('/deployment-branch-policies')), 'the environment rule is checked before a deploy');
});

test('resolve: D4130 and the other refusals deploy nothing', async () => {
  // Mutation checked: the draft check removed; the head comparison removed.
  const none = async (o) => (await resolveWith(o)).outputs.action;
  assert.equal(await none({ pr: { draft: true } }), 'none', 'a draft gets no preview');
  assert.equal(await none({ pr: { head: { sha: 'c'.repeat(40), ref: BRANCH, repo: { full_name: 'AxalNetwork/StudioOS' } } } }), 'none', 'a run for an older commit deploys nothing');
  assert.equal(await none({ run: { conclusion: 'failure' } }), 'none');
  assert.equal(await none({ run: { head_repository: { full_name: 'someone/fork' } } }), 'none', 'a fork gets no preview');
  assert.equal(await none({ run: { event: 'push' } }), 'none');
  assert.equal(await none({ run: { path: '.github/workflows/other.yml' } }), 'none', 'only the PR preview workflow file');
  assert.equal(await none({ run: { actor: { login: 'dependabot[bot]' } } }), 'none');
  assert.equal(await none({ pr: { user: { login: 'dependabot[bot]' } } }), 'none');
  assert.equal(await none({ pr: { head: { sha: SHA, ref: 'other', repo: { full_name: 'AxalNetwork/StudioOS' } } } }), 'none', 'the PR must be this run\'s branch');
  assert.equal(await none({ artifacts: [] }), 'none', 'no artifact, nothing to deploy');
  await assert.rejects(resolveWith({ artifacts: [{ id: 5, name: 'pr-preview-docs', expired: false, size_in_bytes: 3e8, workflow_run: { id: 99 } }] }), /cap/);
  await assert.rejects(resolveWith({ artifacts: [{ id: 5, name: 'pr-preview-docs', expired: false, size_in_bytes: 10, workflow_run: { id: 99, head_sha: 'c'.repeat(40) } }] }), /another commit/);
});

test('resolve: a closed pull request is deleted, found by branch and commit when the payload has no number', async () => {
  const { outputs, calls } = await resolveWith({ run: { pull_requests: [] }, pr: { state: 'closed' } });
  assert.deepEqual(outputs, { action: 'delete', number: '7' });
  assert.ok(calls.some(([k, h]) => k === 'pulls.list' && h === 'AxalNetwork:' + BRANCH));
  const other = await resolveWith({ run: { pull_requests: [] }, listed: [{ number: 8, head: { sha: 'c'.repeat(40), ref: BRANCH, repo: { full_name: 'AxalNetwork/StudioOS' } } }] });
  assert.equal(other.outputs.action, 'none', 'a pull request at another commit is not this run\'s');
});

test('resolve: deploy and delete refuse an environment that is missing its main-only rule', async () => {
  // Mutation checked: requireEnvironment() made a no-op.
  await assert.rejects(resolveWith({ policy: false }), /selected branches only/);
  await assert.rejects(resolveWith({ rules: [{ name: '*', type: 'branch' }] }), /exactly the main branch/);
  await assert.rejects(resolveWith({ rules: [{ name: 'main', type: 'branch' }, { name: 'dev', type: 'branch' }] }), /exactly the main branch/);
  await assert.rejects(resolveWith({ pr: { state: 'closed' }, rules: [] }), /exactly the main branch/);
  assert.equal((await resolveWith({ pr: { draft: true }, policy: false })).outputs.action, 'none', 'a run that deploys nothing does not need the environment');
});

test('the login-e2e job runs the D722 and D753 specs against this build on a local preview, and holds no secret', () => {
  const wf = at(WORKFLOW);
  const job = jobOf(wf, 'login-e2e');
  assert.match(job, /needs: build/);
  assert.match(job, /PLAYWRIGHT_BASE_URL: http:\/\/127\.0\.0\.1:8787/);
  assert.match(job, /name: pr-preview-docs\n\s+path: docs/, 'the specs run against the artifact the trusted job deploys');
  assert.match(job, /wrangler@[\d.]+ dev --config wrangler\.pr-preview\.toml --ip 127\.0\.0\.1 --port 8787/, 'served by the deployed preview\'s own config and script');
  assert.match(job, /playwright test tests\/e2e\/google_popup_signin\.spec\.js --retries=0/);
  assert.match(job, /playwright test tests\/e2e\/integrations\.spec\.js --retries=0/);
  assert.match(job, /image: mcr\.microsoft\.com\/playwright@sha256:[0-9a-f]{64}/, 'use the pinned image with Chromium and its system libraries');
  assert.match(job, /PW_CHROMIUM_PATH: \/ms-playwright\//, 'point Playwright at the image’s Chromium');
  assert.match(at('frontend/playwright.config.js'), /executablePath: process\.env\.PW_CHROMIUM_PATH/);
  assert.match(job, /permissions:\n\s+contents: read\n/, 'the job reads the repository and nothing more');
  assert.doesNotMatch(job, /secrets\./, 'the e2e job must hold no secret: the spec stubs every Google route');
  assert.doesNotMatch(job, /wrangler@[\d.]+ (?:deploy|delete)/, 'the e2e job deploys nothing');
});

test('D4130: a draft gets no preview build; marking it ready builds one; closing always reaches the trusted cleanup', () => {
  const wf = code(at(WORKFLOW));
  const build = jobOf(wf, 'build');
  assert.match(build, /github\.event\.action != 'closed' &&\n\s+github\.event\.pull_request\.draft == false &&/, 'the build skips drafts');
  assert.match(wf, /\bready_for_review\b/, 'marking a draft ready is what builds its first preview');
  const del = jobOf(code(at(DEPLOY)), 'delete');
  assert.doesNotMatch(del, /draft/, 'a PR closed as a draft still has its preview deleted');
  assert.match(del, /if: needs\.resolve\.outputs\.action == 'delete'/);
});

test('the workflows README lists the preview workflow', () => {
  const readme = at('.github/workflows/README.md');
  assert.match(readme, /`pr-preview\.yml`/, 'add the pr-preview.yml row to .github/workflows/README.md');
  assert.match(readme, /`pr-preview-deploy\.yml`/, 'add the pr-preview-deploy.yml row to .github/workflows/README.md');
  assert.match(readme, /PR_PREVIEW_CLOUDFLARE_API_TOKEN/);
  assert.match(readme, /studioos-pr-/);
});
