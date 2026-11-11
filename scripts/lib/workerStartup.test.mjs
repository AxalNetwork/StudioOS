/** D5532: startup diagnostics and release gate with synthetic artifacts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bundleIdentity, classifyStartup, maxActiveMs, measureProfile } from '../check-worker-startup.mjs';

const candidate = 'a'.repeat(40);

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
