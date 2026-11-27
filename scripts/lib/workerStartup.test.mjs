/**
 * D5532: startup budget, profile accounting and Wrangler bundle identity
 * fixtures.
 *
 * D5532: startup diagnostics and release gate with synthetic artifacts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleIdentity, classifyStartup, collectStartupProfiles, maxActiveMs, measureProfile } from '../check-worker-startup.mjs';

const candidate = 'a'.repeat(40);

test('release evidence keeps a Wrangler rejection profile from the config root when present', t => {
  const source = readFileSync(new URL('../../.github/workflows/cloudflare-worker-deploy.yml', import.meta.url), 'utf8');
  const step = source.split('      - name: Record release phase outcomes\n')[1].split('\n      - name:')[0];
  const shell = step.split('        run: |\n')[1];
  const dir = mkdtempSync(join(tmpdir(), 'release-startup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: join(dir, 'summary'), GITHUB_SHA: candidate };
  const collect = () => execFileSync('bash', ['-e', '-c', shell], { cwd: dir, env });
  const retained = join(dir, 'release-evidence/publish-startup.cpuprofile');

  collect();
  assert.equal(existsSync(retained), false);
  const profileDir = join(dir, '.wrangler/tmp/startup-profile-QYG17v');
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, 'worker.cpuprofile'), 'fixture profile');
  collect();
  assert.equal(readFileSync(retained, 'utf8'), 'fixture profile');
});

test('the Wrangler artifact is identified by its embedded candidate and exact digest', async () => {
  const form = new FormData();
  form.set('metadata', JSON.stringify({ main_module: 'index.js', compatibility_date: '2026-11-01',
    compatibility_flags: ['nodejs_compat'], bindings: [{ name: 'WORKER_DEPLOY_VERSION', type: 'plain_text', text: candidate }] }));
  form.set('index.js', new Blob(['export default {}']), 'index.js');
  const bytes = Buffer.from(await new Response(form).arrayBuffer());
  assert.deepEqual(await bundleIdentity(bytes, candidate), {
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    entry: 'index.js', compatibilityDate: '2026-11-01', compatibilityFlags: ['nodejs_compat'],
  });
  await assert.rejects(() => bundleIdentity(bytes, 'b'.repeat(40)), /must name this candidate/);
});

test('active sample time excludes idle, includes collection and records startup costs', () => {
  const nodes = ['(idle)', 'buildRegistry', '(garbage collector)'].map((functionName, i) => ({ id: i + 1, callFrame: { functionName } }));
  const profile = { nodes, samples: [1, 2, 3, 2], timeDeltas: [25_000, 30_000, 10_000, 15_000] };
  assert.deepEqual(measureProfile(profile), { activeMs: 55, topFrames: [{ frame: 'buildRegistry', ms: 45 }, { frame: '(garbage collector)', ms: 10 }] });
  assert.throws(() => measureProfile({ ...profile, samples: [] }), /no valid samples/);
});

test('all three cold samples are required and any sample over the budget blocks admission', () => {
  const classify = (...times) => classifyStartup(times.map(activeMs => ({ activeMs })));
  assert.equal(classify(200, maxActiveMs, 300), 'verified');
  assert.equal(classify(200, 300, maxActiveMs + 1), 'over_budget');
  assert.equal(classify(200, 300), 'inconclusive');
  assert.equal(classify(200, 0, 300), 'inconclusive');
});


test('invalid captures have bounded replacements and a valid over-budget capture still blocks', () => {
  const nodes = [{ id: 1, callFrame: { functionName: 'startup' } }];
  const run = (elapsed, measurements, invalid) => collectStartupProfiles(attempt => ({
    profile: { nodes, samples: [1], timeDeltas: [elapsed[attempt - 1]] },
  }), measurements, invalid);
  const measured = [], invalid = [];
  run([-1, 200_000, 801_000, 250_000], measured, invalid);
  assert.deepEqual([invalid.map(entry => entry.attempt), measured.map(entry => entry.activeMs), classifyStartup(measured)],
    [[1], [200, 801, 250], 'over_budget']);
  const missing = [], rejected = [];
  run([-1, -1, 200_000, -1, 250_000, 220_000], missing, rejected);
  assert.deepEqual([rejected.map(entry => entry.attempt), classifyStartup(missing)], [[1, 2, 4], 'inconclusive']);
});
