/** D7899: dependency review checks the actual queue candidate with read-only authority; advisory SARIF comes only from a successful trusted scan.
 *
 * From frontend/test/README.md (moved by #6472): D7899 immutable PR/queue dependency comparisons,
 * read-only review authority, trusted public-main posture admission and successful-only SARIF
 * uploads, with mutation/restoration cases.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = name => readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
const ORIGINAL = Object.freeze({ dependency: read('dependency-review'), posture: read('ossf-scorecard') });
const code = source => source.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');

// Read active two-space workflow blocks, as the repository's existing workflow
// guards do. Comments must never satisfy a security assertion.
function block(source, key, indent = 0) {
  const lines = code(source).split('\n');
  const at = lines.findIndex(line => line.startsWith(`${' '.repeat(indent)}${key}:`));
  if (at < 0) return '';
  let end = at + 1;
  while (end < lines.length && (!lines[end].trim() || lines[end].search(/\S/) > indent)) end++;
  return lines.slice(at, end).join('\n');
}
function scalar(source, key, indent = 0) {
  const found = block(source, key, indent);
  if (!found) return undefined;
  const [first, ...rest] = found.split('\n');
  const value = first.slice(first.indexOf(':') + 1).trim().replace(/\s+#.*$/, '');
  return /^[>|][-+]?$/.test(value) ? rest.map(line => line.trim()).join(' ') : value;
}
const job = (source, name) => block(block(source, 'jobs'), name, 2);
const steps = source => block(source, 'steps', 4).split(/^ {6}- /m).slice(1).map(step => `        ${step}`);
const value = (source, key) => scalar(source, key, 8);
const input = (source, key) => scalar(block(source, 'with', 8), key, 10);
function action(list, prefix) {
  const matches = list.filter(step => value(step, 'uses')?.startsWith(`${prefix}@`));
  assert.equal(matches.length, 1, `one ${prefix} step`);
  return matches[0];
}
const events = source => [...block(source, 'on').matchAll(/^ {2}([\w_]+):/gm)].map(([, event]) => event);
function evaluate(expression, github, previousSuccess = true, wasCancelled = false) {
  if (expression === undefined) return previousSuccess && !wasCancelled;
  const hasStatus = /\b(?:success|always|failure|cancelled)\s*\(/.test(expression);
  if (!hasStatus && (!previousSuccess || wasCancelled)) return false;
  return runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), {
    github, success: () => previousSuccess && !wasCancelled,
    always: () => true, failure: () => !previousSuccess, cancelled: () => wasCancelled,
  }, { timeout: 100 });
}
const context = overrides => ({
  repository: 'AxalNetwork/StudioOS', ref: 'refs/heads/main',
  event_name: 'schedule', event: { repository: { visibility: 'public' } }, ...overrides,
});

function mutationCheck(check, changes) {
  check(ORIGINAL);
  for (const [file, from, to] of changes) {
    assert.ok(ORIGINAL[file].includes(from), `mutation target exists: ${from}`);
    const changed = { ...ORIGINAL, [file]: ORIGINAL[file].replace(from, to) };
    assert.throws(() => check(changed), { name: 'AssertionError' }, `refuse mutation: ${from} -> ${to}`);
  }
  check(ORIGINAL); // Mutants never touch the checkout; restoration passes too.
}

function assertQueueComparison({ dependency }) {
  const triggers = events(dependency);
  assert.deepEqual(triggers.sort(), ['merge_group', 'pull_request']);
  assert.doesNotMatch(block(dependency, 'on'), /\bpaths(?:-ignore)?:/);
  const reviewJob = job(dependency, 'dependency-review');
  assert.equal(scalar(reviewJob, 'if', 4), undefined, 'drafts and queue candidates still receive the check');
  const review = action(steps(reviewJob), 'actions/dependency-review-action');
  for (const [eventName, payload, base, head] of [
    ['pull_request', { merge_group: {}, pull_request: { base: { sha: 'pr-base' }, head: { sha: 'pr-head' } } }, 'pr-base', 'pr-head'],
    ['merge_group', { merge_group: { base_sha: 'queue-base', head_sha: 'queue-combined-head' }, pull_request: { base: {}, head: {} } }, 'queue-base', 'queue-combined-head'],
  ]) {
    const ctx = context({ event_name: eventName, event: payload, sha: 'wrong-moving-head' });
    assert.equal(evaluate(input(review, 'base-ref'), ctx), base);
    assert.equal(evaluate(input(review, 'head-ref'), ctx), head);
    assert.equal(evaluate(scalar(block(dependency, 'concurrency'), 'cancel-in-progress', 2), ctx), eventName === 'pull_request');
  }
}

test('D7899: PRs and combined queue commits are compared at their immutable event SHAs', () => {
  mutationCheck(assertQueueComparison, [
    ['dependency', '  merge_group:\n', '  disabled_merge_group:\n'],
    ['dependency', '    branches: [main]', '    branches: [main]\n    paths: [package.json]'],
    ['dependency', '    name: Dependency Review', '    name: Dependency Review\n    if: github.event_name == \'pull_request\''],
    ['dependency', 'github.event.merge_group.base_sha || github.event.pull_request.base.sha', 'github.sha'],
    ['dependency', 'github.event.merge_group.head_sha || github.event.pull_request.head.sha', 'github.sha'],
    ['dependency', "cancel-in-progress: ${{ github.event_name == 'pull_request' }}", 'cancel-in-progress: true'],
  ]);
});

function assertDependencyAuthority({ dependency }) {
  const reviewJob = job(dependency, 'dependency-review');
  const list = steps(reviewJob);
  const review = action(list, 'actions/dependency-review-action');
  assert.equal(list.length, 1, 'API comparison never executes candidate code or installs packages');
  assert.equal(scalar(reviewJob, 'runs-on', 4), 'ubuntu-latest');
  assert.equal(scalar(reviewJob, 'permissions', 4), undefined, 'no job override can widen the read-only token');
  const permissions = block(dependency, 'permissions');
  assert.deepEqual([...permissions.matchAll(/^ {2}([\w-]+):\s*(\w+)/gm)].map(([, key, access]) => [key, access]), [['contents', 'read']]);
  assert.doesNotMatch(code(dependency), /\bsecrets[.\[]|:\s*(?:write|write-all)\b|\bcontinue-on-error:\s*true\b/);
  assert.match(input(review, 'fail-on-severity') || '', /^(?:low|moderate|high)$/);
  const scopes = new Set((input(review, 'fail-on-scopes') || '').split(',').map(scope => scope.trim()));
  for (const scope of ['runtime', 'development', 'unknown']) assert.ok(scopes.has(scope), `cover ${scope}`);
  assert.equal(input(review, 'vulnerability-check'), 'true');
  assert.equal(input(review, 'warn-only'), 'false');
  assert.equal(input(review, 'license-check'), 'false', 'no invented license policy');
  assert.equal(input(review, 'comment-summary-in-pr'), 'never');
}

test('D7899: high/critical dependencies in all scopes block with no candidate execution or write token', () => {
  mutationCheck(assertDependencyAuthority, [
    ['dependency', '    steps:\n', '    steps:\n      - run: npm install\n'],
    ['dependency', 'runs-on: ubuntu-latest', 'runs-on: paid-large-runner'],
    ['dependency', '    timeout-minutes: 5', '    timeout-minutes: 5\n    permissions: write-all'],
    ['dependency', '  contents: read', '  contents: write'],
    ['dependency', '  contents: read', '  contents: read\n  packages: write'],
    ['dependency', '      - name: Review dependency changes', '      - name: Review dependency changes\n        env:\n          MODEL_KEY: ${{ secrets.MODEL_KEY }}'],
    ['dependency', 'fail-on-severity: high', 'fail-on-severity: critical'],
    ...['runtime', 'development', 'unknown'].map(scope => ['dependency', 'fail-on-scopes: runtime, development, unknown', `fail-on-scopes: ${['runtime', 'development', 'unknown'].filter(item => item !== scope).join(', ')}`]),
    ['dependency', 'vulnerability-check: true', 'vulnerability-check: false'],
    ['dependency', 'warn-only: false', 'warn-only: true'],
    ['dependency', 'license-check: false', 'license-check: true'],
    ['dependency', 'comment-summary-in-pr: never', 'comment-summary-in-pr: always'],
    ['dependency', '      - name: Review dependency changes', '      - name: Review dependency changes\n        continue-on-error: true'],
  ]);
});

function assertTrustedPosture({ posture }) {
  assert.deepEqual(events(posture).sort(), ['schedule', 'workflow_dispatch']);
  const analysis = job(posture, 'analysis');
  const guard = scalar(analysis, 'if', 4);
  assert.equal(evaluate(guard, context()), true);
  assert.equal(evaluate(guard, context({ event_name: 'workflow_dispatch' })), true);
  for (const ctx of [
    context({ repository: 'outsider/fork' }), context({ ref: 'refs/heads/feature' }),
    context({ event: { repository: { visibility: 'private' } } }),
    context({ event: { repository: {} } }),
  ]) assert.equal(evaluate(guard, ctx), false, 'only the trusted public main is admitted');
  assert.equal(scalar(analysis, 'runs-on', 4), 'ubuntu-latest');
  assert.equal(scalar(posture, 'permissions'), '{}');
  const permissionCode = block(analysis, 'permissions', 4);
  assert.deepEqual([...permissionCode.matchAll(/^ {6}([\w-]+):\s*(\w+)/gm)].map(([, key, access]) => [key, access]), [['contents', 'read'], ['security-events', 'write']]);
  assert.doesNotMatch(code(posture), /\bsecrets[.\[]|\bwrite-all\b|actions\/upload-artifact/);
  const list = steps(analysis);
  assert.equal(input(action(list, 'actions/checkout'), 'persist-credentials'), 'false');
  assert.equal(input(action(list, 'ossf/scorecard-action'), 'publish_results'), 'false');
}

test('D7899: posture runs only on trusted public main, without external publishing or extra credentials', () => {
  mutationCheck(assertTrustedPosture, [
    ['posture', 'on:\n', 'on:\n  pull_request:\n'],
    ['posture', "github.repository == 'AxalNetwork/StudioOS' &&", 'true &&'],
    ['posture', "github.ref == 'refs/heads/main' &&", 'true &&'],
    ['posture', "github.event.repository.visibility == 'public'", 'true'],
    ['posture', 'runs-on: ubuntu-latest', 'runs-on: paid-large-runner'],
    ['posture', 'permissions: {}', 'permissions: write-all'],
    ['posture', '      contents: read', '      contents: write'],
    ['posture', '      security-events: write', '      security-events: read'],
    ['posture', '      security-events: write', '      security-events: write\n      id-token: write'],
    ['posture', '      - name: Analyze repository posture', '      - name: Analyze repository posture\n        env:\n          MODEL_KEY: ${{ secrets.MODEL_KEY }}'],
    ['posture', '      - name: Analyze repository posture', '      - uses: actions/upload-artifact@some-ref\n      - name: Analyze repository posture'],
    ['posture', 'persist-credentials: false', 'persist-credentials: true'],
    ['posture', 'publish_results: false', 'publish_results: true'],
  ]);
});

function assertSuccessfulUpload({ posture }) {
  const analysis = job(posture, 'analysis');
  const list = steps(analysis);
  const scan = action(list, 'ossf/scorecard-action');
  const upload = action(list, 'github/codeql-action/upload-sarif');
  assert.ok(list.indexOf(scan) < list.indexOf(upload));
  assert.notEqual(value(scan, 'continue-on-error'), 'true');
  assert.notEqual(scalar(analysis, 'continue-on-error', 4), 'true');
  assert.equal(input(scan, 'results_file'), input(upload, 'sarif_file'));
  for (const [success, cancelled, expected] of [[true, false, true], [false, false, false], [false, true, false]]) {
    assert.equal(evaluate(value(upload, 'if'), context(), success, cancelled), expected);
  }
}

test('D7899: a failed or cancelled posture scan cannot overwrite alerts with incomplete SARIF', () => {
  const scanAt = ORIGINAL.posture.indexOf('      - name: Analyze repository posture');
  const uploadAt = ORIGINAL.posture.indexOf('      - name: Upload successful posture scan');
  const scanBlock = ORIGINAL.posture.slice(scanAt, uploadAt);
  const uploadBlock = ORIGINAL.posture.slice(uploadAt);
  mutationCheck(assertSuccessfulUpload, [
    ['posture', '      - name: Analyze repository posture', '      - name: Analyze repository posture\n        continue-on-error: true'],
    ['posture', '    timeout-minutes: 15', '    timeout-minutes: 15\n    continue-on-error: true'],
    ['posture', '      - name: Upload successful posture scan', '      - name: Upload successful posture scan\n        if: always()'],
    ['posture', 'sarif_file: scorecard.sarif', 'sarif_file: stale.sarif'],
    ['posture', 'results_file: scorecard.sarif', 'results_file: ignored.sarif'],
    ['posture', scanBlock + uploadBlock, uploadBlock + scanBlock],
  ]);
});
