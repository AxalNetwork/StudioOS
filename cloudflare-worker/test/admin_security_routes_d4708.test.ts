/**
 * D4708 (#4708) — the Security router's route table, pinned to what `main` served before the split.
 *
 * D4708 moved `/overview`'s and `/governance`'s reads into `services/adminSecurity/` and left the router with
 * its gates and its acts. This test is the proof the move kept every route: the same methods and paths, in the
 * same registration order, each opening with the same gate as its first statement, and the router mounted
 * where it was (before the catch-all `/api/admin`). Dropping, adding, reordering or re-gating a route fails it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import security from '../src/routes/admin_security.ts';

/** method, path, the gate its handler awaits first — as on main before D4708. */
const MAIN_TABLE: Array<[string, string, 'requireSuperAdmin' | 'requireSuperAdminWriteBar']> = [
  ['GET', '/overview', 'requireSuperAdmin'],
  ['GET', '/governance', 'requireSuperAdmin'],
  ['GET', '/sessions', 'requireSuperAdmin'],
  ['POST', '/sessions/:id/revoke', 'requireSuperAdminWriteBar'],
  ['POST', '/sessions/revoke', 'requireSuperAdminWriteBar'],
  ['POST', '/impersonations/:id/end', 'requireSuperAdminWriteBar'],
  ['POST', '/branch-sign-out', 'requireSuperAdminWriteBar'],
  ['POST', '/force-reauth/:userId', 'requireSuperAdminWriteBar'],
  ['POST', '/force-reauth', 'requireSuperAdminWriteBar'],
  ['POST', '/dsr/:userId/close', 'requireSuperAdminWriteBar'],
];

const ROUTER = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_security.ts'), 'utf8');

test('the router registers exactly the routes main did, in the same order', () => {
  const got = (security.routes as Array<{ method: string; path: string }>).map((r) => [r.method, r.path]);
  assert.deepEqual(got, MAIN_TABLE.map(([m, p]) => [m, p]));
});

test('every handler opens with the gate it had on main', () => {
  const opens = [...ROUTER.matchAll(/\nr\.(get|post|put|patch|delete)\('([^']+)', async \(c\) => \{\n([\s\S]*?)\n\}\);/g)];
  assert.equal(opens.length, MAIN_TABLE.length, 'a handler is not in the one shape this test reads');
  for (const [i, [method, path, gate]] of MAIN_TABLE.entries()) {
    const [, m, p, body] = opens[i];
    assert.equal(`${m.toUpperCase()} ${p}`, `${method} ${path}`);
    // The first statement that is not a comment is the gate, awaited, before anything reads the request.
    const first = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('//'));
    assert.match(first ?? '', new RegExp(`^(const actor = )?await ${gate}\\(c\\);$`), `${method} ${path} no longer opens with ${gate}`);
  }
});

test('the router is mounted where it was: /api/admin/security, before the catch-all /api/admin', () => {
  const idx = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/index.ts'), 'utf8');
  assert.ok(idx.includes("import adminSecurity from './routes/admin_security';"));
  const at = idx.indexOf("app.route('/api/admin/security', adminSecurity)");
  assert.ok(at > 0, 'the Security router is not mounted at /api/admin/security');
  assert.ok(at < idx.indexOf("app.route('/api/admin', admin)"), 'the Security router is mounted after the catch-all');
  assert.ok(!/export const mount\b/.test(ROUTER), 'the router now mounts itself as well as through index.ts');
});

