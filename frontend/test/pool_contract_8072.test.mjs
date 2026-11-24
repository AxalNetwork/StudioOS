/**
 * #8072 (D8072) — the untrusted pool contract over every workflow.
 *
 * A job a pull request can start (`pull_request`, `pull_request_target`, `merge_group`) runs on a
 * GitHub-hosted label or the `untrusted` group, holds a declared read-only token with no id-token,
 * reads no secret and names no environment. A job that names a deploy environment runs only from a
 * push to main or a dispatch, on a hosted label or the `trusted` group. The exceptions are listed by
 * name in `scripts/ci/pool-contract.mjs` with an expiry; one past its date, or one nothing needs, fails.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pool_contract_8072.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  EXCEPTIONS, KINDS, checkWorkflows, commitDate, formatReport, jobEvents, narrowByIf, readWorkflows, runnerOf, secretReads,
} from '../../scripts/ci/pool-contract.mjs';

const TODAY = '2026-11-21';
const run = (sources, opts = {}) => checkWorkflows(sources, { today: TODAY, exceptions: [], ...opts });
const kinds = (r) => r.violations.map((v) => `${v.workflow}:${v.job}:${v.kind}`).sort();

/** A pull-request workflow with one job; `job` is the job's YAML body, indented four spaces. */
const prWorkflow = (job, { on = 'pull_request:\n  merge_group:', top = 'permissions:\n  contents: read\n' } = {}) =>
  `on:\n  ${on}\n${top}jobs:\n  build:\n${job}`;

const GOOD = prWorkflow([
  '    runs-on: ubuntu-latest',
  '    permissions:',
  '      contents: read',
  '      actions: read',
  '    steps:',
  '      - run: npm test',
  '        env:',
  '          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
  '',
].join('\n'));

// ------------------------------------------------------------------ fixtures

test('a good pull-request workflow keeps the contract', () => {
  const r = run({ 'good.yml': GOOD });
  assert.deepEqual(r.violations, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => [x.job, x.events, x.runner]), [['build', ['pull_request', 'merge_group'], 'ubuntu-latest']]);
  // The untrusted group is a pool a pull request may use.
  const pool = run({ 'pool.yml': prWorkflow('    runs-on:\n      group: untrusted\n      labels: [linux]\n    steps: [{ run: x }]\n') });
  assert.deepEqual(pool.violations, []);
});

const VIOLATIONS = {
  'runs-on-self-hosted': prWorkflow('    runs-on: [self-hosted, linux]\n    steps: [{ run: x }]\n'),
  'runs-on-trusted': prWorkflow('    runs-on:\n      group: trusted\n    steps: [{ run: x }]\n'),
  'runs-on-unreadable': prWorkflow("    runs-on: ${{ fromJSON(inputs.pool) }}\n    steps: [{ run: x }]\n"),
  'permissions-undeclared': prWorkflow('    runs-on: ubuntu-latest\n    steps: [{ run: x }]\n', { top: '' }),
  'write-all': prWorkflow('    runs-on: ubuntu-latest\n    permissions: write-all\n    steps: [{ run: x }]\n'),
  'write:contents': prWorkflow('    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n    steps: [{ run: x }]\n'),
  'id-token': prWorkflow('    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n      id-token: write\n    steps: [{ run: x }]\n'),
  secret: prWorkflow('    runs-on: ubuntu-latest\n    steps:\n      - run: deploy\n        env:\n          KEY: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n'),
  environment: prWorkflow('    runs-on: ubuntu-latest\n    environment: production-ops\n    steps: [{ run: x }]\n'),
};

for (const [kind, yaml] of Object.entries(VIOLATIONS)) {
  test(`a pull-request job that ${KINDS[kind] || kind} fails with that reason`, () => {
    const r = run({ 'bad.yml': yaml });
    assert.deepEqual(kinds(r), [`bad.yml:build:${kind}`]);
    assert.equal(r.ok, false);
    assert.match(formatReport(r), /VIOLATION: /);
    assert.match(formatReport(r), new RegExp(`bad\\.yml \\| build .*VIOLATION: ${(r.violations[0].text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });
}

test('every way of reading a secret is one', () => {
  assert.deepEqual(secretReads({ env: { A: '${{ secrets.A_KEY }}' } }), ['secrets.A_KEY']);
  assert.deepEqual(secretReads({ run: "echo ${{ secrets['A'] }}" }), ['secrets[…]']);
  assert.deepEqual(secretReads({ run: '${{ toJSON(secrets) }}' }), ['toJSON(secrets)']);
  assert.deepEqual(secretReads({ env: { T: '${{ secrets.GITHUB_TOKEN }}' } }), [], 'the job token is governed by permissions');
  // A reusable call that passes secrets, or inherits them, reads them.
  const caller = (s) => `on:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  build:\n    uses: org/repo/.github/workflows/x.yml@abc\n${s}`;
  assert.deepEqual(kinds(run({ 'c.yml': caller('    secrets: inherit\n') })), ['c.yml:build:secret']);
  assert.deepEqual(kinds(run({ 'c.yml': caller('    secrets:\n      KEY: abc\n') })), ['c.yml:build:secret']);
  // A secret in the workflow's own env reaches every job.
  const topEnv = `on:\n  pull_request:\npermissions:\n  contents: read\nenv:\n  K: \${{ secrets.K }}\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: [{ run: x }]\n`;
  assert.deepEqual(kinds(run({ 'e.yml': topEnv })), ['e.yml:build:secret']);
});

test('a local reusable workflow called from a pull request inherits its events', () => {
  const caller = 'on:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  call:\n    uses: ./.github/workflows/inner.yml\n';
  const inner = 'on:\n  workflow_call:\npermissions:\n  contents: read\njobs:\n  work:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n    steps: [{ run: x }]\n';
  assert.deepEqual(kinds(run({ 'outer.yml': caller, 'inner.yml': inner })), ['inner.yml:work:write:contents']);
  // Called only from a dispatch, it is not a pull-request job.
  const dispatch = caller.replace('pull_request:', 'workflow_dispatch:');
  assert.deepEqual(kinds(run({ 'outer.yml': dispatch, 'inner.yml': inner })), []);
});

// ------------------------------------------------------------------ which jobs a pull request starts

test('a job whose if: rules out pull requests is not a pull-request job', () => {
  const ev = ['pull_request', 'merge_group'];
  assert.deepEqual([...narrowByIf(ev, "github.event_name == 'push'")], []);
  assert.deepEqual([...narrowByIf(ev, "${{ github.event_name == 'merge_group' }}")], ['merge_group']);
  assert.deepEqual([...narrowByIf(ev, "github.event_name != 'merge_group' && !github.event.pull_request.draft")], ['pull_request']);
  // A merged pull request's `closed` event runs with refs/heads/main (pr-preview.yml's branch delete),
  // so main rules out the queue only.
  assert.deepEqual([...narrowByIf(ev, "github.ref == 'refs/heads/main'")], ['pull_request']);
  // Each branch of a disjunction pins its event.
  assert.deepEqual([...narrowByIf(ev, "always() && (github.event_name == 'merge_group' || github.event_name == 'push' && github.ref == 'refs/heads/main')")], ['merge_group']);
  assert.deepEqual([...narrowByIf(ev, "(github.event_name == 'merge_group' && github.ref == 'refs/heads/main') || github.event_name == 'push'")], []);
  // What it cannot read keeps every event: a job is never let off by an unread expression.
  assert.deepEqual([...narrowByIf(ev, "contains(fromJSON('[\"push\"]'), github.event_name)")], ev);
  assert.deepEqual([...narrowByIf(ev, "github.event_name == 'push' || inputs.force")], ev);
  assert.deepEqual([...narrowByIf(ev, "github.event_name == 'merge_group' || github.actor == 'x'")], ev);
  assert.deepEqual([...narrowByIf(ev, '')], ev);
  // A quoted `&&` is text, not an operator.
  assert.deepEqual([...narrowByIf(ev, "github.head_ref == 'a && b' && github.event_name == 'merge_group'")], ['merge_group']);
  assert.deepEqual([...narrowByIf(ev, "github.head_ref == '(' && github.event_name == 'merge_group'")], ['merge_group'], 'a quoted parenthesis opens nothing');
});

test('a job that waits for a push-only job is not a pull-request job, unless it runs regardless', () => {
  const doc = {
    on: { pull_request: null, push: null },
    jobs: {
      gate: { if: "github.event_name == 'push'" },
      after: { needs: 'gate' },
      always: { needs: ['gate'], if: 'always()' },
      unaffected: {},
    },
  };
  const ev = jobEvents(doc);
  assert.deepEqual([...ev.gate], []);
  assert.deepEqual([...ev.after], []);
  assert.deepEqual([...ev.always], ['pull_request']);
  assert.deepEqual([...ev.unaffected], ['pull_request']);
  // So a push-only job may hold a secret in a pull-request workflow.
  const yaml = 'on:\n  pull_request:\n  push:\n    branches: [main]\npermissions:\n  contents: read\njobs:\n  publish:\n    if: github.event_name == \'push\'\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n    steps:\n      - run: x\n        env:\n          K: ${{ secrets.K }}\n';
  assert.deepEqual(run({ 'p.yml': yaml }).violations, []);
});

test('runners: hosted labels, the two groups, other self-hosted runners and expressions', () => {
  assert.equal(runnerOf({ 'runs-on': 'ubuntu-24.04' }).kind, 'hosted');
  assert.equal(runnerOf({ 'runs-on': ['ubuntu-latest'] }).kind, 'hosted');
  assert.equal(runnerOf({ 'runs-on': { labels: ['ubuntu-latest'] } }).kind, 'hosted');
  assert.equal(runnerOf({ 'runs-on': { group: 'untrusted' } }).kind, 'untrusted');
  assert.equal(runnerOf({ 'runs-on': { group: 'trusted', labels: ['linux'] } }).kind, 'trusted');
  assert.equal(runnerOf({ 'runs-on': { group: 'StudioOS Worker Pool', labels: ['self-hosted'] } }).kind, 'self-hosted');
  assert.equal(runnerOf({ 'runs-on': 'studioos-bench-linux-8' }).kind, 'self-hosted', 'a larger runner label is not proven hosted');
  assert.equal(runnerOf({ 'runs-on': 'self-hosted' }).kind, 'self-hosted');
  assert.equal(runnerOf({ 'runs-on': '${{ matrix.runner }}' }).kind, 'unreadable');
  assert.equal(runnerOf({ 'runs-on': ['self-hosted', '${{ matrix.os }}'] }).kind, 'unreadable');
  assert.equal(runnerOf({ 'runs-on': { group: 'StudioOS Included Compute', labels: ['ubuntu-latest'] } }).kind, 'self-hosted', 'a named group is not proven hosted');
  assert.equal(runnerOf({ steps: [] }).kind, 'unreadable', 'no runs-on and no reusable call');
  assert.equal(runnerOf({ 'runs-on': { group: '${{ inputs.g }}' } }).kind, 'unreadable');
  assert.equal(runnerOf({ uses: './.github/workflows/x.yml' }).kind, 'reusable');
});

// ------------------------------------------------------------------ deploy environments

const deploy = (on, runsOn = 'ubuntu-latest', ifLine = '') =>
  `on:\n${on}\npermissions:\n  contents: read\njobs:\n  deploy:\n${ifLine}    runs-on: ${runsOn}\n    environment: production\n    steps:\n      - run: wrangler deploy\n        env:\n          K: \${{ secrets.CLOUDFLARE_API_TOKEN }}\n`;

test('a deploy runs from a push to main or a dispatch, on a hosted or trusted runner', () => {
  assert.deepEqual(run({ 'd.yml': deploy('  push:\n    branches: [main]\n  workflow_dispatch:') }).violations, []);
  assert.deepEqual(run({ 'd.yml': deploy('  workflow_dispatch:', '{ group: trusted }') }).violations, []);
  assert.deepEqual(run({ 'd.yml': deploy('  push:', 'ubuntu-latest', "    if: github.ref == 'refs/heads/main'\n") }).violations, [], 'a job guarded to main');
  assert.deepEqual(kinds(run({ 'd.yml': deploy('  push:') })), ['d.yml:deploy:deploy-trigger'], 'a push on any branch');
  // Guarded to main through the job it waits for.
  const viaNeeds = deploy('  push:').replace('jobs:\n  deploy:\n', "jobs:\n  admit:\n    if: github.ref == 'refs/heads/main'\n    runs-on: ubuntu-latest\n    steps: [{ run: x }]\n  deploy:\n    needs: admit\n");
  assert.deepEqual(run({ 'd.yml': viaNeeds }).violations, []);
  assert.deepEqual(kinds(run({ 'd.yml': viaNeeds.replace('    needs: admit\n', "    needs: admit\n    if: always()\n") })), ['d.yml:deploy:deploy-trigger'], 'always() runs it whatever admit did');
  // A deploy job in a file with no trigger at all is not let off.
  assert.deepEqual(kinds(run({ 'd.yml': deploy('  push:\n    branches: [main]').replace(/^on:\n.*\n.*\n/, '') })), ['d.yml:deploy:deploy-trigger']);
  assert.deepEqual(kinds(run({ 'd.yml': deploy('  push:\n    branches: [main, release]') })), ['d.yml:deploy:deploy-trigger']);
  assert.deepEqual(kinds(run({ 'd.yml': deploy('  schedule:\n    - cron: "0 0 * * *"') })), ['d.yml:deploy:deploy-trigger']);
  assert.deepEqual(kinds(run({ 'd.yml': deploy('  workflow_run:\n    workflows: [CI]') })), ['d.yml:deploy:deploy-trigger']);
  assert.deepEqual(kinds(run({ 'd.yml': deploy('  workflow_dispatch:', '[self-hosted, linux]') })), ['d.yml:deploy:deploy-runner']);
  assert.deepEqual(kinds(run({ 'd.yml': deploy('  workflow_dispatch:', '{ group: untrusted }') })), ['d.yml:deploy:deploy-runner']);
  // From a pull request it breaks every rule at once.
  assert.deepEqual(kinds(run({ 'd.yml': deploy('  pull_request:') })),
    ['d.yml:deploy:deploy-trigger', 'd.yml:deploy:environment', 'd.yml:deploy:secret']);
  // An ops environment is not a deploy one (#8069 owns those workflows).
  assert.deepEqual(run({ 'o.yml': deploy('  schedule:\n    - cron: "0 0 * * *"').replace('environment: production', 'environment: production-ops') }).violations, []);
});

// ------------------------------------------------------------------ exceptions

test('an exception allows its job by name, until it expires; one nothing needs fails', () => {
  const yaml = { 'bad.yml': VIOLATIONS['write:contents'] };
  const ex = { workflow: 'bad.yml', job: 'build', allow: ['write:contents'], expires: '2026-12-31', owner: '#1', reason: 'why' };
  const allowed = run(yaml, { exceptions: [ex] });
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.rows[0].excepted, ['write:contents']);
  assert.match(formatReport(allowed), /exception: holds contents: write/);
  // By name: another job or another kind is not allowed by it.
  assert.equal(run(yaml, { exceptions: [{ ...ex, job: 'other' }] }).ok, false);
  assert.equal(run(yaml, { exceptions: [{ ...ex, allow: ['write:issues'] }] }).ok, false);
  // Its last day still holds; the next day it fails, by name.
  assert.equal(run(yaml, { exceptions: [ex], today: '2026-12-31' }).ok, true);
  const expired = run(yaml, { exceptions: [ex], today: '2027-01-01' });
  assert.equal(expired.ok, false);
  assert.deepEqual(expired.expired.map((e) => `${e.workflow}:${e.job}:${e.kind}`), ['bad.yml:build:write:contents']);
  assert.match(formatReport(expired), /EXPIRED exception: bad\.yml › build \(write:contents\) expired 2026-12-31/);
  // Stale: the job was fixed, so the exception goes.
  const stale = run({ 'bad.yml': GOOD }, { exceptions: [{ ...ex }] });
  assert.equal(stale.ok, false);
  assert.equal(stale.stale.length, 1);
  assert.match(formatReport(stale), /STALE exception: bad\.yml › build/);
  assert.throws(() => checkWorkflows({}, { today: 'tomorrow' }), /YYYY-MM-DD/);
});

test('an unreadable workflow is a violation, not a pass', () => {
  const r = run({ 'broken.yml': 'on: [pull_request\njobs: {' });
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].kind, 'unparseable');
  assert.match(formatReport(r), /broken\.yml \| — .*cannot be read/);
});

// ------------------------------------------------------------------ the tree

test('the tree keeps the contract, with only the recorded exceptions, as of the commit under test', () => {
  // The commit's own date, not the wall clock: an exception expires with the code that carries it.
  const r = checkWorkflows(readWorkflows(), { today: commitDate() });
  assert.deepEqual(r.violations, [], formatReport(r));
  assert.deepEqual(r.expired, [], formatReport(r));
  assert.deepEqual(r.stale, [], formatReport(r));
  assert.ok(r.rows.length >= 40, `only ${r.rows.length} pull-request or deploy jobs read — the parser is not parsing`);
  // The CI workflow this task owns runs every pull-request job on a hosted label with a read-only token.
  for (const row of r.rows.filter((x) => ['ci.yml', 'codeql.yml', 'semgrep.yml', 'dependency-review.yml', 'landing-policy.yml'].includes(x.workflow))) {
    assert.match(row.runner, /^ubuntu-/, `${row.workflow} › ${row.job}`);
  }
});

test('every exception names its owner, a reason and a date, and D8072 lists each one', () => {
  const d = readFileSync(new URL('../../documentation/architecture/decisions/D8072.md', import.meta.url), 'utf8');
  assert.match(d, /^## D8072 — .*\(#8072\)$/m);
  for (const ex of EXCEPTIONS) {
    assert.match(ex.expires, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(ex.owner, /^#\d+$/);
    assert.ok(ex.reason.length > 20, `${ex.workflow} › ${ex.job}: no reason`);
    for (const k of ex.allow) assert.ok(KINDS[k] || k.startsWith('write:'), k);
    assert.ok(d.includes(`\`${ex.workflow}\` › \`${ex.job}\``), `D8072 does not list ${ex.workflow} › ${ex.job}`);
  }
  assert.equal(EXCEPTIONS.length, 10);
});

test('the command prints the table and exits 1 on a violation, 2 on a bad option', () => {
  const script = new URL('../../scripts/ci/pool-contract.mjs', import.meta.url).pathname;
  const out = execFileSync(process.execPath, [script, '--today', TODAY], { encoding: 'utf8' });
  assert.match(out, /^\| Workflow \| Job \| Pull-request events \| Runner \| Result \|$/m);
  assert.match(out, /pool contract: ok\n$/);
  const fail = (args) => { try { execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: 'pipe' }); return 0; } catch (e) { return e.status; } };
  assert.equal(fail(['--today', '2099-01-01']), 1, 'every exception expired');
  assert.equal(fail(['--bogus']), 2);
  assert.equal(fail(['--today', 'soon']), 2);
});
