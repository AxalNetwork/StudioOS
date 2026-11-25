/** D7145 tests the credential inventory, deployment environments and the temporary PR preview exception. */
/** D7145: fixture workflows must keep production credentials inside their recorded job environments. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkProductionCredentials } from '../check-production-credentials.mjs';

const token = 'CLOUDFLARE_API_TOKEN';
const ops = 'HQ_RPC_SECRET';
const ref = '${{ secrets.CLOUDFLARE_API_TOKEN }}';
const row = {
  workflow: 'release.yml', job: 'publish', secrets: [token],
  environment: 'production', triggers: ['push'],
};

function workflow({ event = 'push', job = 'publish', env = 'production', read = ref, extra = '' } = {}) {
  return `on: ${event}
${extra}
jobs:
  ${job}:
    runs-on: ubuntu-latest
${env === null ? '' : `    environment: ${env}`}
    steps:
      - run: test
        env:
          TOKEN: "${read}"
`;
}
function audit(source = workflow(), rows = [row], file = 'release.yml') {
  return checkProductionCredentials([[file, source]], { secrets: [token, ops], jobs: rows });
}

test('both literal environment forms pass; missing, dynamic, misclassified and unapproved ones fail', () => {
  assert.deepEqual(audit(), []);
  assert.deepEqual(audit(workflow({ env: '{ name: production, url: https://example.test }' })), []);
  for (const env of [null, 'production-ops', '${{ inputs.environment }}']) {
    assert.match(audit(workflow({ env })).join(), /expected a literal production environment/);
  }
  assert.match(audit(workflow({ env: 'test' }), [{ ...row, environment: 'test' }]).join(), /expected a literal/);
  assert.deepEqual(audit(workflow({ env: 'production-ops' }), [{ ...row, environment: 'production-ops' }]), []);
});

test('tracks jobs, exact secrets and triggers both ways, including YAML aliases and bracket reads', () => {
  const source = workflow({ read: "${{ SeCrets[ 'cloudflare_api_token' ] }}", env: '*env', extra: 'run-name: &env production' });
  assert.deepEqual(audit(source), []);
  assert.match(audit(source, [row], 'unlisted.yaml').join(), /missing credential inventory row/);
  assert.match(audit(source.replace('publish:', 'other:' )).join(), /release.yml\/other: missing credential inventory row/);
  assert.match(audit(source.replace("SeCrets[ 'cloudflare_api_token' ]", 'secrets.HQ_RPC_SECRET')).join(), /update inventory secrets/);
  assert.match(audit(source.replace('on: push', 'on: workflow_dispatch')).join(), /update inventory triggers/);
  assert.match(audit(workflow({ read: '${{ secrets.UNRELATED }}' })).join(), /no longer reads/);
  assert.match(audit(source, [row, row]).join(), /duplicate inventory row/);
});

test('checks both PR trigger forms even with other trusted triggers', () => {
  for (const [event, triggers] of [
    ['pull_request', ['pull_request']],
    ['[push, pull_request_target]', ['push', 'pull_request_target']],
    ['{ pull_request: { types: [closed] }, push: null }', ['pull_request', 'push']],
  ]) assert.match(audit(workflow({ event }), [{ ...row, triggers }]).join(), /pull request workflow reads/);
});

test('only the two legacy preview readers with their existing trigger and credential pass until #7146', () => {
  const file = 'pr-preview.yml';
  for (const job of ['deploy', 'delete']) {
    const base = { job, env: null, event: 'pull_request' };
    const entry = { ...row, workflow: file, job, environment: null, triggers: ['pull_request'] };
    assert.deepEqual(audit(workflow(base), [entry], file), []);
    assert.match(audit(workflow({ ...base, job: 'extra' }), [{ ...entry, job: 'extra' }], file).join(), /pull request workflow reads/);
    assert.match(audit(workflow({ ...base, read: '${{ secrets.HQ_RPC_SECRET }}' }), [{ ...entry, secrets: [ops] }], file).join(), /pull request workflow reads/);
    assert.match(audit(workflow({ ...base, event: 'pull_request_target' }), [{ ...entry, triggers: ['pull_request_target'] }], file).join(), /pull request workflow reads/);
    assert.match(audit(workflow({ ...base, env: 'production' }), [{ ...entry, environment: 'production' }], file).join(), /expected a literal/);
  }
});

test('preserves the disabled compute host’s independently protected environment', () => {
  const file = 'agent-compute-preview.yml';
  const base = { event: 'workflow_dispatch', job: 'deploy_disabled_host', env: 'agent-compute-preview' };
  const entry = { ...row, workflow: file, job: base.job, environment: base.env, triggers: [base.event] };
  assert.deepEqual(audit(workflow(base), [entry], file), []);
  assert.match(audit(workflow({ ...base, env: null }), [entry], file).join(), /expected a literal agent-compute-preview/);
  assert.match(audit(workflow(base), [{ ...entry, workflow: 'other.yml' }], 'other.yml').join(), /expected a literal production/);
});

test('workflow-level access, dynamic lookup, bulk access and implicit secret inheritance fail closed', () => {
  assert.match(audit(workflow({ extra: 'env: { TOKEN: "${{ secrets.HQ_RPC_SECRET }}" }' })).join(), /workflow-level secret access/);
  for (const read of ['${{ secrets[inputs.key] }}', '${{ toJSON(secrets) }}', '${{ secrets.* }}']) {
    assert.match(audit(workflow({ read })).join(), /bulk or dynamic/);
  }
  assert.match(audit(workflow({ read: '${{ secrets.DR_COPY_FUTURE_TOKEN }}' })).join(), /add DR_COPY_FUTURE_TOKEN/);
  assert.match(audit(workflow({ read: '${{ secrets.FILE_DR_COPY_FUTURE_TOKEN }}' })).join(), /add FILE_DR_COPY_FUTURE_TOKEN/);
  const reusable = '  call:\n    uses: ./.github/workflows/called.yml\n    secrets: inherit\n';
  assert.match(audit(workflow() + reusable).join(), /name reusable workflow secrets explicitly/);
});

test('handles implicit if, multiline scripts and quoted examples without counting comments or prose', () => {
  const base = workflow({ read: '${{ github.event.issue.secrets }}' });
  const marker = '    steps:';
  assert.deepEqual(audit(base.replace(marker, '    if: always() && secrets.cloudflare_api_token\n' + marker)), []);
  const script = '      - run: |\n          echo ${{ format(\'done }}\', secrets.CLOUDFLARE_API_TOKEN) }}';
  assert.deepEqual(audit(base.replace('      - run: test', script)), []);
  const example = 'format(\'secrets.HQ_RPC_SECRET\', github.actor)';
  assert.deepEqual(audit(workflow({ extra: 'run-name: "${{ ' + example + ' }}" # ${{ secrets.HQ_RPC_SECRET }}' })), []);
  for (const read of [
    "${{ format('it''s }} safe', secrets.CLOUDFLARE_API_TOKEN) }}",
    "${{ secrets.UNRELATED }} / ${{ secrets['CLOUDFLARE_API_TOKEN'] }}",
  ]) assert.deepEqual(audit(workflow({ read })), []);
});

test('unterminated interpolations fail closed without blocking the guard', () => {
  for (const read of ['${{ secrets.CLOUDFLARE_API_TOKEN }', "${{ 'unterminated }}"]) {
    assert.match(audit(workflow({ read })).join(), /unterminated Actions expression/);
  }
  const moduleUrl = new URL('../check-production-credentials.mjs', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { checkProductionCredentials } from ${JSON.stringify(moduleUrl)};
    const source = ${JSON.stringify(workflow())};
    const hostile = '$' + '{{{{' + "'".repeat(20_001);
    const candidate = source.replace(${JSON.stringify(ref)}, hostile);
    const issues = checkProductionCredentials([['release.yml', candidate]], ${JSON.stringify({ secrets: [token, ops], jobs: [row] })});
    assert.match(issues.join('\\n'), /unterminated Actions expression/);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module'], {
    input: script, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

// D8416 (#8416): on 2026-11-24 two merge-queue rounds failed on a workflow the guard could not
// parse, and the stack trace named no file.
test('a workflow that does not parse is named by path, line and column, and the others are still checked', () => {
  const doubled = workflow().replace('    runs-on: ubuntu-latest\n',
    '    permissions:\n      contents: read\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n');
  const line = doubled.split('\n').findIndex((text, index, lines) =>
    text === '    permissions:' && lines.slice(0, index).includes('    permissions:')) + 1;
  assert.ok(line > 0, 'the fixture has the key twice');
  const issues = checkProductionCredentials([
    ['release.yml', doubled],
    ['later.yml', workflow({ env: null })],
  ], { secrets: [token, ops], jobs: [row, { ...row, workflow: 'later.yml' }] });
  assert.deepEqual(issues, [
    `.github/workflows/release.yml:${line}:5: DUPLICATE_KEY: Map keys must be unique (a merge can add the same key twice without a conflict; keep one)`,
    'later.yml/publish: expected a literal production environment',
  ]);
});

test('every parse error in one workflow is reported, without the inventory rows it could not confirm', () => {
  const broken = 'on: push\njobs:\n  a:\n    runs-on: x\n    runs-on: y\n  b: [unclosed\n';
  const issues = audit(broken, [row]);
  assert.equal(issues.length, 2, issues.join('\n'));
  assert.match(issues[0], /^\.github\/workflows\/release\.yml:5:5: DUPLICATE_KEY: /);
  assert.match(issues[1], /^\.github\/workflows\/release\.yml:\d+:\d+: [A-Z_]+: /);
  assert.doesNotMatch(issues.join('\n'), /inventory job no longer reads|\n\s+at /);
});

test('a file that parses but is not a workflow is named instead of throwing', () => {
  for (const source of ['', 'jobs: {}\n', 'on: push\n', 'on: push\njobs: [a]\n', '- on\n- jobs\n']) {
    assert.deepEqual(audit(source, [row]),
      ['.github/workflows/release.yml:1:1: not a workflow: it needs an "on" trigger and a "jobs" mapping'], JSON.stringify(source));
  }
  assert.deepEqual(audit(workflow(), [row]), []);
});
