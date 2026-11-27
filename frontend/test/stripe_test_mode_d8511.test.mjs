// D8511 (#8511): the dev commerce client (backend/app/services/stripe_commerce.py) runs on a test-mode Stripe key or
// not at all. The cases live in backend/tests/test_stripe_test_mode_d8511.py; this runs them in the ordinary suite,
// since the dev-backend CI job is pinned unchanged by D7909's job digests. No network, no key, no FastAPI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('D8511 the dev commerce client refuses any key but a test-mode one, before any request', () => {
  const r = spawnSync('python3', ['-m', 'unittest', '-v', 'backend/tests/test_stripe_test_mode_d8511.py'], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const ran = Number((r.stderr.match(/^Ran (\d+) tests?/m) || [])[1]);
  assert.ok(ran >= 10, `expected the ten D8511 cases to run, saw ${ran}\n${r.stderr}`);
  for (const name of ['test_missing_key_is_refused_without_a_request', 'test_live_key_is_refused_without_a_request', 'test_stripe_secret_key_alone_is_not_a_fallback', 'test_stripe_publishable_key_alone_is_not_a_fallback']) assert.match(r.stderr, new RegExp(`${name} .* ok$`, 'm'), name);
});
