/**
 * The API-drift guard must see every route file, at any depth — and must not
 * crash when it finds a problem.
 *
 * CLAUDE.md points at `npm run test:drift` as the thing enforcing the rule
 * that no `/api/*` method reaches `frontend/src/lib/api.js` without a matching
 * worker route. A hole in that script is a hole in the rule.
 *
 * It had one. `findEnvelopeViolations` read the routes directory with a bare
 * `readdirSync`, which was correct while the tree was flat and would have
 * failed SILENTLY the moment it was not: a route moved into `routes/admin/`
 * would simply stop being checked while the guard kept printing a pass. That
 * is the worst failure mode a guard has, and it was going to be triggered by
 * the very reorganisation this repo has been doing.
 *
 * Fixing it introduced a second bug that no clean tree could reveal: the
 * violation reporter still referenced the old loop variable, so the guard
 * would have thrown a ReferenceError the first time it found a real
 * violation — turning a clear report into a stack trace. Nothing caught that
 * until an actual bad file was put in a nested directory and the script run.
 *
 * So this test does exactly that, because a structural assertion about the
 * walker would have passed against the crashing version.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(process.cwd());
const SCRIPT = 'scripts/check-api-drift.mjs';
// This writes into the source tree for the length of ONE child process, then
// removes it in a finally block. That is safe here because no other test
// enumerates `cloudflare-worker/src/routes/` as a directory — the frontend
// suite reads specific route files by name, and the guard suite is a separate,
// later npm step. Checked before relying on it.
const PROBE_DIR = resolve(root, 'cloudflare-worker/src/routes/_drift_probe');

function runGuard() {
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT], { cwd: root, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('the guard reads route files nested in a subdirectory', () => {
  let result;
  try {
    mkdirSync(PROBE_DIR, { recursive: true });
    writeFileSync(resolve(PROBE_DIR, 'nested.ts'), [
      "import { Hono } from 'hono';",
      'const r = new Hono();',
      // A 400 whose body carries none of error/detail/message/errors — the
      // exact thing findEnvelopeViolations exists to catch.
      "r.get('/probe', (c) => c.json({ oops: 'no envelope key' }, 400));",
      'export default r;',
      '',
    ].join('\n'));
    result = runGuard();
  } finally {
    rmSync(PROBE_DIR, { recursive: true, force: true });
  }

  assert.ok(
    !/ReferenceError|is not defined/.test(result.out),
    `the guard threw instead of reporting:\n${result.out}`,
  );
  assert.match(
    result.out, /_drift_probe\/nested\.ts:3/,
    'a nested route file must be read AND reported by path',
  );
});

test('nothing reads the routes directory non-recursively any more', () => {
  // Against the code alone: the walker's own doc comment names the call it
  // replaced, and that comment is the one worth keeping.
  const s = codeOnly(readFileSync(resolve(root, SCRIPT), 'utf8'));
  assert.ok(
    !/readdirSync\(ROUTES_DIR\)/.test(s),
    'a bare readdirSync(ROUTES_DIR) silently stops seeing nested files',
  );
  assert.match(s, /function routeFiles\(/, 'the recursive walker must exist');
});
