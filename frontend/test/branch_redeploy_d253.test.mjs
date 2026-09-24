/**
 * D253 — the push-to-main deploy redeploys every provisioned branch after HQ.
 *
 * Read as text, on the pattern of branch_provision_workflow.test.mjs, because
 * the properties whose absence would be an incident are all visible in it:
 * no branch wrangler call can fall through to HQ's config, no secret is put,
 * the filter keeps exactly provisioning and live, and step 9's job and the
 * branch job each wait on HQ's deploy and not on each other. The loop itself
 * is also RUN, in bash with a fake `node` and `npx`, because "one branch
 * failing does not stop the others" is behaviour, not text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { deployableBranches } from '../../scripts/list-deployable-branches.mjs';

const WF = readFileSync(resolve(process.cwd(), '.github/workflows/cloudflare-worker-deploy.yml'), 'utf8');

/** One job's block: from `  <id>:` to the next top-level job key. */
function job(id) {
  const at = WF.search(new RegExp(`^  ${id}:\\s*$`, 'm'));
  assert.ok(at >= 0, `no job ${id}`);
  const rest = WF.slice(at + 1);
  const next = rest.search(/\n  [a-z][\w-]*:\s*\n/);
  return next > 0 ? WF.slice(at, at + 1 + next) : WF.slice(at);
}
const codeLines = (src) => src.split('\n').filter((l) => l.trim() && !/^\s*#/.test(l));
const needsOf = (src) => (/^    needs: (.+)$/m.exec(src) || [])[1]?.trim() ?? null;

/** The `run: |` body of a named step inside a job, de-indented. */
function stepScript(src, name) {
  const at = src.indexOf(`- name: ${name}\n`);
  assert.ok(at >= 0, `no step named ${name}`);
  const rest = src.slice(at);
  const next = rest.indexOf('\n      - ', 1);
  const step = next > 0 ? rest.slice(0, next) : rest;
  const m = /\n(\s+)run: \|\n([\s\S]*)$/.exec(step);
  assert.ok(m, `${name} is not a run: | block`);
  const indent = m[1].length + 2;
  return m[2].split('\n').map((l) => l.slice(indent)).join('\n');
}

const BRANCHES = job('branches');

test('D253: every wrangler call in the branches job names a branch config, never HQ\'s', () => {
  const code = codeLines(BRANCHES);
  const calls = code.filter((l) => /\bnpx\b.*\bwrangler\b/.test(l));
  assert.equal(calls.length, 1, 'the branch deploy is one npx line inside the loop');
  for (const l of calls) assert.match(l, /--config "wrangler\.branch\.\$\{code\}\.toml"/, l.trim());
  for (const l of code) {
    assert.doesNotMatch(l, /--env production\b/, `the branches job must never deploy HQ's environment: ${l.trim()}`);
    assert.doesNotMatch(l, /(?:^|[\s"'/])wrangler\.toml\b/, `the branches job must never read HQ's config: ${l.trim()}`);
  }
});

test('D253: the branches job puts no secret', () => {
  for (const l of codeLines(BRANCHES)) assert.doesNotMatch(l, /\bsecret\s+(?:put|bulk)\b/, l.trim());
});

test('D253: the filter keeps provisioning and live, and drops `_` fixtures, example and suspended', () => {
  const e = (file, status) => ({ file, entry: { status } });
  assert.deepEqual(deployableBranches([
    e('fr.json', 'live'),
    e('de.json', 'provisioning'),
    e('_example.json', 'live'),
    e('_draft.json', 'provisioning'),
    e('ex.json', 'example'),
    e('it.json', 'suspended'),
    e('README.md', 'live'),
  ]), ['de', 'fr']);
  assert.match(BRANCHES, /codes=\$\(node scripts\/list-deployable-branches\.mjs/, 'the job lists branches through the filter');
});

test('D253: step 9\'s job and the branches job each depend on deploy, not on each other', () => {
  const drift = job('schema-drift');
  assert.equal(needsOf(drift), 'deploy');
  assert.equal(needsOf(BRANCHES), 'deploy');
  assert.match(drift, /run: node scripts\/check-baseline-drift\.mjs/);
  assert.doesNotMatch(job('deploy'), /check-baseline-drift/, 'step 9 left the deploy job');
});

test('D253: each branch is rendered, then migrated, then deployed, in that order', () => {
  const script = stepScript(BRANCHES, 'Render, migrate and deploy each branch');
  const gen = script.indexOf('node scripts/gen-branch-wrangler.mjs "$code"');
  const mig = script.indexOf('node scripts/migrate-d1.mjs --branch "$code"');
  const dep = script.indexOf('deploy_branch "$code"', script.indexOf('for code in'));
  assert.ok(gen > 0 && mig > gen && dep > mig, 'gen, then migrate --branch, then deploy');
  assert.match(script, /grep -qE '\\\[code: 10013\\\]' "deploy\.\$\{code\}\.log"/, 'D251\'s retry, on 10013 only');
});

/** Run a step's script with fake `node`/`npx` on PATH; returns exit, calls, summary. */
function runStep(name, { env = {}, failGen = [], failNpx = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'd253-'));
  const calls = join(dir, 'calls'); writeFileSync(calls, '');
  const summary = join(dir, 'summary'); writeFileSync(summary, '');
  const output = join(dir, 'output'); writeFileSync(output, '');
  const fake = (fails) => `#!/usr/bin/env bash\necho "$(basename "$0") $*" >> ${JSON.stringify(calls)}\nfor f in ${fails.map((c) => JSON.stringify(c)).join(' ')}; do case "$*" in *"$f"*) exit 1;; esac; done\nexit 0\n`;
  writeFileSync(join(dir, 'node'), fake(failGen)); chmodSync(join(dir, 'node'), 0o755);
  writeFileSync(join(dir, 'npx'), fake(failNpx)); chmodSync(join(dir, 'npx'), 0o755);
  writeFileSync(join(dir, 'sleep'), '#!/usr/bin/env bash\nexit 0\n'); chmodSync(join(dir, 'sleep'), 0o755);
  const r = spawnSync('bash', ['-e', '-c', stepScript(BRANCHES, name)], {
    cwd: dir,
    env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, ...env },
    encoding: 'utf8',
  });
  return {
    status: r.status,
    calls: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean),
    summary: readFileSync(summary, 'utf8'),
    output: readFileSync(output, 'utf8'),
  };
}

test('D253: one branch failing does not stop the others, and the summary names each outcome', () => {
  const r = runStep('Render, migrate and deploy each branch', { env: { CODES: 'de fr it ' }, failGen: ['gen-branch-wrangler.mjs fr'] });
  assert.equal(r.status, 1, 'a failed branch turns the job red');
  assert.match(r.summary, /\| de \| deployed \|/);
  assert.match(r.summary, /\| fr \| failed: config did not render \|/);
  assert.match(r.summary, /\| it \| deployed \|/);
  assert.deepEqual(r.calls.filter((c) => c.startsWith('npx')).map((c) => /branch\.(\w+)\.toml/.exec(c)[1]), ['de', 'it'],
    'fr is not deployed without its config; it still is');
  assert.ok(r.calls.includes('node scripts/migrate-d1.mjs --branch it'), 'the branch after the failure is still migrated');
});

test('D253: with zero branches the job says so', () => {
  const r = runStep('List the branches to redeploy');
  assert.equal(r.status, 0);
  assert.match(r.output, /^codes=\s*$/m);
  assert.match(r.summary, /^No branch to redeploy: infra\/branches holds no provisioning or live entry\.$/m);
  for (const s of ['Install frontend dependencies', 'Install Worker dependencies', 'Build the SPA', 'Render, migrate and deploy each branch']) {
    const at = BRANCHES.indexOf(`- name: ${s}\n`);
    assert.match(BRANCHES.slice(at, at + 200), /\n\s+if: steps\.list\.outputs\.codes != ''\n/, `${s} is skipped when nothing is listed`);
  }
});
