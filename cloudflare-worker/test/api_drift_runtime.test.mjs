/**
 * Task #10 (AP) — Runtime drift test (wrangler unstable_dev).
 *
 * Spins up the Worker in-process via wrangler's `unstable_dev` and
 * fetches every `/api/...` path the SPA derives in
 * `frontend/src/lib/api.js`, asserting each returns a non-404 status.
 * This is the runtime companion to `api_drift.test.mjs` (which is
 * static analysis only).
 *
 * Gating:
 * - Skips entirely when `RUN_RUNTIME_DRIFT` is not set (default for
 *   local + standard CI). The static checker already catches the same
 *   drift class deterministically and `wrangler dev` cold-starts add
 *   10–30s + occasional D1-binding flake.
 * - Set `RUN_RUNTIME_DRIFT=1` to opt in (CI does this on the
 *   `playwright-smoke` job, where the runtime probe is invoked
 *   against the deployed preview env via
 *   `cloudflare-worker/scripts/drift-runtime-probe.mjs` instead — the
 *   preview-HTTP variant is faster and doesn't need wrangler bindings
 *   to be wired up locally).
 *
 * Run directly:  RUN_RUNTIME_DRIFT=1 node --test cloudflare-worker/test/api_drift_runtime.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const API_FILE = resolve(REPO_ROOT, 'frontend', 'src', 'lib', 'api.js');

function derivedPaths() {
  const src = readFileSync(API_FILE, 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/['"`](\/api\/[^'"`?\s${]+)/g)) {
    const p = m[1].replace(/\/+$/, '');
    if (p.length > 4) out.add(p);
  }
  return [...out];
}

test('runtime drift — every derived /api path is mounted (no 404)', { skip: !process.env.RUN_RUNTIME_DRIFT }, async (t) => {
  let unstable_dev;
  try {
    ({ unstable_dev } = await import('wrangler'));
  } catch {
    t.skip('wrangler unstable_dev unavailable in this environment');
    return;
  }
  if (typeof unstable_dev !== 'function') {
    t.skip('wrangler does not expose unstable_dev (newer API)');
    return;
  }

  const worker = await unstable_dev(
    resolve(REPO_ROOT, 'cloudflare-worker', 'src', 'index.ts'),
    { experimental: { disableExperimentalWarning: true }, local: true, persist: false },
  );
  try {
    const drifted = [];
    for (const p of derivedPaths()) {
      const r = await worker.fetch(p, { method: 'GET' });
      if (r.status === 404) drifted.push(p);
    }
    assert.equal(drifted.length, 0, `drifted: ${drifted.join(', ')}`);
  } finally {
    await worker.stop();
  }
});
