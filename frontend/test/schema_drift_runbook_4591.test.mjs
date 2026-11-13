/**
 * #4591 — the schema-drift runbook (documentation/operations/SCHEMA_DRIFT.md)
 * stays true to the code it describes.
 *
 * The runbook makes three kinds of claims a later edit could quietly break:
 *   - which checks run BEFORE a deploy, and so can stop it;
 *   - that the drift check runs AFTER the deploy and reports without gating
 *     or being silenced;
 *   - that every file it points to exists.
 * Each claim is pinned here against the workflow, package.json and the
 * scripts themselves, so the runbook goes red when the code moves away
 * from it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const at = (p) => resolve(process.cwd(), p);
const raw = (p) => readFileSync(at(p), 'utf8');

const RUNBOOK = raw('documentation/operations/SCHEMA_DRIFT.md');
const DEPLOY = raw('.github/workflows/cloudflare-worker-deploy.yml');
const GUARDS = JSON.parse(raw('package.json')).scripts['test:guards'];

/** One job's block of the deploy workflow: from `  <name>:` to the next top-level job. */
function job(name) {
  const start = DEPLOY.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `the deploy workflow has no ${name} job`);
  const rest = DEPLOY.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  const block = next < 0 ? rest : rest.slice(0, next + 1);
  // YAML keys only: the job's comments explain, in prose, why it is NOT
  // `continue-on-error`, and prose must not count as the key.
  return block.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

test('the drift check runs after the deploy, reports, and is never softened', () => {
  const drift = job('schema-drift');
  assert.match(drift, /needs: deploy\b/, 'schema-drift must depend on the deploy job, so it runs after it');
  assert.match(drift, /run: node scripts\/check-baseline-drift\.mjs/, 'schema-drift must run check-baseline-drift');
  assert.doesNotMatch(drift, /continue-on-error/, 'a softened drift job is a green check that means only that it ran');
  assert.doesNotMatch(job('deploy'), /check-baseline-drift/, 'the drift check moved into the deploy job; the runbook says it is not a gate');
  // The two exit codes the runbook tells an operator to tell apart.
  const script = raw('scripts/check-baseline-drift.mjs');
  assert.match(script, /process\.exit\(2\)/, 'exit 2 (could not read production) is gone');
  assert.match(script, /On production, absent from/, 'the "on production, absent from the baseline" direction is gone');
  assert.match(script, /absent from production/, 'the "in the baseline, absent from production" direction is gone');
  assert.match(RUNBOOK, /It is not a gate/, 'the runbook no longer says the post-deploy check is evidence, not a gate');
});

test('migrations are applied before the Worker ships, so a failed one stops the deploy', () => {
  const deploy = job('deploy');
  const migrate = deploy.indexOf('run: node scripts/migrate-d1.mjs --remote');
  const ship = deploy.indexOf('wrangler deploy --config ../wrangler.toml --env production');
  assert.ok(migrate > 0, 'the deploy job no longer applies migrations through the runner');
  assert.ok(ship > 0, 'the deploy job no longer runs wrangler deploy');
  assert.ok(migrate < ship, 'migrations must run before the Worker ships');
  assert.doesNotMatch(deploy.slice(deploy.lastIndexOf('\n      - name:', migrate), ship), /continue-on-error: true/,
    'a migration step that may fail softly no longer stops the deploy');
});

test('every pre-deploy guard the runbook lists runs in test:guards', () => {
  for (const s of [
    'check-sql-migrations', 'check-migration-declarations', 'check-runtime-schema-declared',
    'check-runtime-ddl', 'check-schema-pair-drift', 'check-sqlite-tables', 'check-sqlite-columns',
    'check-write-router-columns',
  ]) {
    assert.ok(RUNBOOK.includes(`${s}`), `the runbook no longer lists ${s}`);
    assert.ok(GUARDS.includes(`scripts/${s}.mjs`), `${s} no longer runs in test:guards, so the runbook overstates the pre-deploy checks`);
  }
  assert.ok(existsSync(at('.github/workflows/migration-immutability.yml')), 'the immutability workflow is gone');
});

test('every file the runbook names exists', () => {
  const named = new Set([
    ...[...RUNBOOK.matchAll(/`((?:scripts|cloudflare-worker|\.github)\/[\w./-]+\.(?:mjs|ts|sql|yml))`/g)].map((m) => m[1]),
    ...[...RUNBOOK.matchAll(/`([A-Z_0-9]+\.md)`/g)].map((m) => `documentation/operations/${m[1]}`),
  ]);
  assert.ok(named.size >= 8, `expected the runbook to cite its sources, found ${named.size}`);
  for (const p of named) {
    const path = p === 'documentation/operations/AGENTS.md' || p === 'documentation/operations/SECURITY.md' ? p.split('/').pop() : p;
    assert.ok(existsSync(at(path)), `the runbook names ${p}, which does not exist`);
  }
});

test('the hosted rehearsal is dispatch-only, scopes its secrets to one step, and can name no production database', () => {
  const wf = raw('.github/workflows/schema-rehearsal.yml');
  const keys = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const on = keys.slice(keys.indexOf('\non:'), keys.indexOf('\nconcurrency:'));
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /schedule:|push:|pull_request/, 'each run creates two databases; it must stay a decision, never a trigger');
  // Secrets appear only in the step that runs the script.
  const steps = keys.split(/\n {6}- (?=name:|uses:)/);
  const withSecrets = steps.filter((s) => s.includes('secrets.'));
  assert.equal(withSecrets.length, 1, 'Cloudflare secrets must be scoped to the one step that uses them');
  assert.match(withSecrets[0], /node scripts\/schema-rehearsal\.mjs --run/);
  assert.doesNotMatch(keys, /studioos-db\b|--env production|wrangler\.toml/, 'the workflow names production');
  // The script cleans up from `finally`, and names only rehearsal databases.
  const script = raw('scripts/schema-rehearsal.mjs');
  assert.match(script, /\} finally \{\s*\n\s*try \{ cleanup\(\); \}/, 'cleanup must run whatever failed');
  assert.match(script, /'d1', 'delete', side\.dbName/, 'cleanup deletes what it created');
  assert.doesNotMatch(script.replace(/\/\*\*[\s\S]*?\*\//g, ''), /studioos-db\b|wrangler\.toml|--env/, 'the script names production outside its docblock');
  assert.match(RUNBOOK, /schema-rehearsal\.yml/, 'the runbook must say how the rehearsal is run');
});
