// D8754 (#8754): scheduled backups and read-only monitoring run in their own reviewer-free environments, and every
// restore, drill and sensitive production mutation stays behind production-ops's reviewer.
//
// Run alone: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ops_environments_8754.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const YAML = createRequire(join(ROOT, 'cloudflare-worker', 'package.json'))('yaml');
const DIR = join(ROOT, '.github', 'workflows');
const load = (file) => YAML.parse(readFileSync(join(DIR, file), 'utf8'));
const envOf = (job) => (typeof job.environment === 'string' ? job.environment : job.environment?.name) || null;
const triggersOf = (wf) => { const on = wf.on ?? wf.true; return typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on || {}); };

/** The jobs that moved, and where. */
export const MOVED = Object.freeze([
  ['backup-d1.yml', 'backup', 'production-backup'],
  ['magic-link-insert-probe.yml', 'probe', 'production-monitoring'],
  ['admin-drift.yml', 'check', 'production-monitoring'],
  ['github-alerts.yml', 'file-backup', 'production-monitoring'],
  ['pr-overlap.yml', 'report', 'production-monitoring'], // the owner's answer on #8754, 2026-11-26
]);
/** Restores, drills and sensitive mutations: every job of these that names an environment names production-ops. */
export const KEPT = Object.freeze(['dr-drill.yml', 'schema-rehearsal.yml', 'branch-provision.yml', 'agent-gateway-keys.yml',
  'agent-stage-a.yml', 'gateway-live-check.yml', 'file-recovery.yml']);
const AUTOMATIC = ['production-backup', 'production-monitoring'];

test('each moved job names its environment and runs from main only', () => {
  for (const [file, job, env] of MOVED) {
    const definition = load(file).jobs[job];
    assert.ok(definition, `${file} › ${job}`);
    assert.equal(envOf(definition), env, `${file} › ${job}`);
    assert.match(String(definition.if || ''), /github\.ref == 'refs\/heads\/main'/, `${file} › ${job} runs from main only`);
  }
});

test('restores, drills and sensitive mutations keep production-ops and its reviewer', () => {
  for (const file of KEPT) {
    const named = Object.entries(load(file).jobs).filter(([, j]) => envOf(j));
    assert.ok(named.length > 0, `${file} names an environment`);
    for (const [job, definition] of named) assert.equal(envOf(definition), 'production-ops', `${file} › ${job}`);
  }
});

test('only the moved jobs use the reviewer-free environments, and no pull-request workflow reaches any production one', () => {
  const moved = new Set(MOVED.map(([file, job]) => `${file}/${job}`));
  for (const file of readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const wf = load(file);
    const pr = triggersOf(wf).some((t) => ['pull_request', 'pull_request_target'].includes(t));
    for (const [job, definition] of Object.entries(wf.jobs || {})) {
      const env = envOf(definition);
      if (AUTOMATIC.includes(env)) assert.ok(moved.has(`${file}/${job}`), `${file} › ${job} may not use ${env}`);
      if (pr) assert.ok(!['production', 'production-ops', ...AUTOMATIC].includes(env), `${file} › ${job}: a pull-request workflow names ${env}`);
    }
  }
});

test('the backup tells the operator which environment holds its token, and the inventory agrees', () => {
  const backup = readFileSync(join(DIR, 'backup-d1.yml'), 'utf8');
  assert.match(backup, /Settings → Environments → production-backup\./);
  assert.doesNotMatch(backup, /Environments → production-ops/);
  const inventory = JSON.parse(readFileSync(join(ROOT, 'documentation/operations/production-credential-inventory.json'), 'utf8'));
  for (const [file, job, env] of MOVED) {
    const row = inventory.jobs.find((r) => r.workflow === file && r.job === job);
    if (row) assert.equal(row.environment, env, `${file} › ${job} inventory row`);
  }
  assert.match(inventory.credentialPolicies['production-monitoring/CLOUDFLARE_API_TOKEN'], /D1 Read/);
  assert.doesNotMatch(inventory.credentialPolicies['production-monitoring/CLOUDFLARE_API_TOKEN'], /Write/);
  assert.match(inventory.credentialPolicies['production-backup/CLOUDFLARE_API_TOKEN'], /studioos-backups/);
});
