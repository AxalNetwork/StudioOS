/**
 * D251 — the production deploy step retries Cloudflare error 10013, and
 * nothing else.
 *
 * The step's `run:` script is RUN here, not only read: it is lifted out of the
 * workflow and executed by bash with a fake `npx` (and a no-op `sleep`) first
 * on PATH. The fake prints what each attempt should print and exits as the
 * attempt should, so the loop, the code filter and `pipefail` are exercised
 * as the runner would exercise them. The text assertions pin what cannot be
 * executed: the step's position after the migrations, and that it is the one
 * deploy line that ships HQ.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, readFileSync as rf } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const WF = readFileSync(resolve(process.cwd(), '.github/workflows/cloudflare-worker-deploy.yml'), 'utf8');

/** The `run: |` body of the named step, de-indented. */
function stepScript(name) {
  const at = WF.indexOf(`- name: ${name}\n`);
  assert.ok(at >= 0, `no step named ${name}`);
  const rest = WF.slice(at);
  const next = rest.indexOf('\n      - name: ', 1);
  const step = next > 0 ? rest.slice(0, next) : rest;
  const m = /\n(\s+)run: \|\n([\s\S]*)$/.exec(step);
  assert.ok(m, `${name} is not a run: | block`);
  const indent = m[1].length + 2;
  return m[2].split('\n').map((l) => l.slice(indent)).join('\n');
}

/**
 * Run the deploy script with a fake npx. `outcomes` is one entry per attempt:
 * { code: exit status, out: what wrangler prints }. Returns the exit status
 * and how many times npx was called.
 */
function runDeploy(outcomes) {
  const dir = mkdtempSync(join(tmpdir(), 'd251-'));
  const plan = join(dir, 'plan.json');
  const calls = join(dir, 'calls');
  writeFileSync(plan, JSON.stringify(outcomes));
  writeFileSync(calls, '');
  writeFileSync(join(dir, 'npx'), `#!/usr/bin/env node
const fs = require('fs');
const plan = JSON.parse(fs.readFileSync(${JSON.stringify(plan)}, 'utf8'));
const n = fs.readFileSync(${JSON.stringify(calls)}, 'utf8').length;
fs.appendFileSync(${JSON.stringify(calls)}, 'x');
const o = plan[Math.min(n, plan.length - 1)];
process.stdout.write(o.out + '\\n');
process.exit(o.code);
`);
  writeFileSync(join(dir, 'sleep'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'npx'), 0o755);
  chmodSync(join(dir, 'sleep'), 0o755);
  const r = spawnSync('bash', ['-e', '-c', stepScript('Deploy to Cloudflare Worker')], {
    cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8',
  });
  return { status: r.status, calls: rf(calls, 'utf8').length, out: r.stdout };
}

const E10013 = { code: 1, out: '✘ [ERROR] Trigger configuration for "studioos" was only partially updated:\n  - An unknown error has occurred. [code: 10013]' };
const OK = { code: 0, out: 'Deployed studioos triggers' };
const CONFIG = { code: 1, out: '✘ [ERROR] Could not resolve "./missing" [code: 10021]' };

test('a transient 10013 is retried, and a later success makes the step green', () => {
  const r = runDeploy([E10013, E10013, OK]);
  assert.equal(r.status, 0, 'two 10013s then a success still failed the step');
  assert.equal(r.calls, 3);
});

test('any other error fails at once, with no retry', () => {
  const r = runDeploy([CONFIG, OK]);
  assert.notEqual(r.status, 0, 'a non-transient error was retried into a green step');
  assert.equal(r.calls, 1, 'a non-transient error was retried');
});

test('three 10013s fail the step after exactly three attempts', () => {
  const r = runDeploy([E10013, E10013, E10013, OK]);
  assert.notEqual(r.status, 0);
  assert.equal(r.calls, 3, 'the retry is not bounded at three');
});

test('a failed deploy is not turned green by tee (pipefail)', () => {
  // With no retryable code the first failure must fail the step. Without
  // pipefail, `npx … | tee` takes tee's status (0) and the step goes green.
  const r = runDeploy([{ code: 1, out: 'boom' }]);
  assert.notEqual(r.status, 0, 'a failed wrangler deploy exited 0 through tee');
});

test('the step runs after the migrations, and is the one line that deploys HQ', () => {
  const migrate = WF.search(/^\s+run: node scripts\/migrate-d1\.mjs --remote\s*$/m);
  const deploy = WF.search(/^\s+if npx --no-install wrangler deploy --config \.\.\/wrangler\.toml --env production\b/m);
  assert.ok(migrate > -1 && deploy > -1);
  assert.ok(migrate < deploy, 'the deploy runs before the migrations');
  // The lines that RUN it: npx and the command, as topology_d209 counts them.
  // An echo that names "wrangler deploy" in a message runs nothing.
  const code = WF.split('\n').filter((l) => !/^\s*#/.test(l) && /\bnpx\b.*\bwrangler(?:@[\d.]+)?\s+deploy\b/.test(l));
  assert.equal(code.length, 1, 'more than one line runs npx … wrangler deploy');
  const script = stepScript('Deploy to Cloudflare Worker');
  assert.match(script, /^set -o pipefail$/m);
  assert.match(script, /grep -qE '\\\[code: 10013\\\]' deploy\.log/, 'the retry is no longer limited to 10013');
});
