/**
 * The Super Admin — an elevation, not a role.
 *
 * The franchise console (`routes/admin_licences.ts`) issues, re-terms,
 * suspends, renews and terminates other people's territory licences. Every
 * route in it gated on `requireAdmin`, so any admin could license the platform
 * to a new subsidiary or terminate an existing one. In a franchise model that
 * is the one power the franchisor cannot share with its franchisees.
 *
 * WHY THE ELEVATION SHAPE IS THE WHOLE DESIGN. 468 call sites across the
 * worker check `role === 'admin'` by exact equality. A distinct `super_admin`
 * role value fails every one of them, locking a super admin out of the entire
 * admin product until all 468 are found and widened — with every miss a silent
 * loss of access. So the role stays `admin` and migration 199 adds the power
 * on top. These tests pin that shape, because "just make it a role" is the
 * change someone will reasonably propose later.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isSuperAdmin } from '../src/auth.ts';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

test('a super admin is an admin who also carries the flag', () => {
  assert.equal(isSuperAdmin({ role: 'admin', is_super_admin: 1 } as any), true);
  assert.equal(isSuperAdmin({ role: 'Admin', is_super_admin: 1 } as any), true, 'role compare is case-insensitive');
});

test('the flag alone grants nothing', () => {
  // The elevation is on top of admin, so a non-admin carrying the column —
  // by a bad backfill, a stale row, a hand-edited fixture — is still not one.
  for (const role of ['founder', 'investor', 'partner', 'advisor', 'exploring', '']) {
    assert.equal(isSuperAdmin({ role, is_super_admin: 1 } as any), false, `${role} must not be elevated`);
  }
});

test('an admin without the flag is not a super admin', () => {
  assert.equal(isSuperAdmin({ role: 'admin', is_super_admin: 0 } as any), false);
  assert.equal(isSuperAdmin({ role: 'admin' } as any), false, 'a DB without the column reads as not-elevated');
  assert.equal(isSuperAdmin({ role: 'admin', is_super_admin: null } as any), false);
  assert.equal(isSuperAdmin({ role: 'admin', is_super_admin: '1' } as any), true,
    'D1 may hand an integer column back as a string');
  assert.equal(isSuperAdmin(null as any), false, 'a malformed caller is never elevated');
});

test('the gate is layered on requireAdmin, so it can only ever narrow', () => {
  const src = read('cloudflare-worker/src/auth.ts');
  const fn = src.slice(src.indexOf('export async function requireSuperAdmin'));
  assert.match(fn.slice(0, 400), /await requireAdmin\(c\)/,
    'a super-admin check that did not first prove admin could grant on the flag alone');
  assert.match(fn.slice(0, 400), /Super admin required/);
});

test("the refusal is a 403, not a 500", () => {
  // AUTH_ERROR_STATUSES maps thrown messages to statuses; anything missing
  // falls through to the generic 500. A gate that works and reports a server
  // error is a gate nobody can act on.
  const src = read('cloudflare-worker/src/index.ts');
  assert.match(src, /'Super admin required': 403/);
});

test('every route on the franchise console is super-admin only', () => {
  // Reads included: its lists are every licensee's commercial terms side by
  // side. A subsidiary admin reads their own licence through routes/licence.ts.
  const src = read('cloudflare-worker/src/routes/admin_licences.ts');
  assert.doesNotMatch(src, /\brequireAdmin\b/,
    'a plain requireAdmin here is a franchisee who can franchise');
  assert.ok((src.match(/requireSuperAdmin\(c\)/g) || []).length >= 16,
    'every handler must gate, not just the mutating ones');
});

test("the licensee's own view stays reachable without the elevation", () => {
  // The counterpart to the test above: locking the console must not lock a
  // subsidiary admin out of reading the licence they administer.
  const src = read('cloudflare-worker/src/routes/licence.ts');
  assert.doesNotMatch(src, /requireSuperAdmin/);
});

test('/me echoes the flag, or the SPA cannot render the shell', () => {
  const src = read('cloudflare-worker/src/routes/auth.ts');
  assert.match(src, /is_super_admin:/);
});

test('migration 199 preserves what admins can do today', () => {
  // Backfilling 0 would silently revoke a power the platform's operators
  // currently hold. The boundary applies to admins created from now on.
  const sql = read('cloudflare-worker/sql/migrations/199_super_admin.sql');
  assert.match(sql, /ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /UPDATE users\s+SET is_super_admin = 1\s+WHERE LOWER\(role\) = 'admin'/,
    'existing admins must keep the access they have');
});

/* ────────────────────────────────────────────────────────────────────────────
 * One holder, by name (migration 207), and the console that changes it.
 * ──────────────────────────────────────────────────────────────────────────── */

const ROUTER = 'cloudflare-worker/src/routes/admin_super_admins.ts';

test('migration 207 narrows the elevation to the one named account, after 199', () => {
  const sql = read('cloudflare-worker/sql/migrations/207_super_admin_single_holder.sql');
  const code = sql.replace(/--.*$/gm, '');
  assert.match(code, /SET is_super_admin = 0\s+WHERE is_super_admin = 1\s+AND LOWER\(email\) <> 'guillaume\.lauzier@axal\.vc'/,
    'every other holder 199 backfilled is revoked');
  assert.match(code, /SET is_super_admin = 1\s+WHERE LOWER\(email\) = 'guillaume\.lauzier@axal\.vc'\s+AND LOWER\(role\) = 'admin'/,
    'the grant still requires the admin role — the elevation stays an elevation');
  assert.doesNotMatch(code, /ALTER TABLE/, '207 is a data migration; the column is 199\'s');
  assert.doesNotMatch(read('cloudflare-worker/sql/migrations/199_super_admin.sql'), /axal\.vc/,
    '199 is not edited to carry the decision — it may already be applied elsewhere');
});

test('the holder console gates every write behind TOTP, step-up and the elevation', () => {
  const src = read(ROUTER);
  assert.doesNotMatch(src, /\brequireAdmin\b/, 'a plain admin gate here is a franchisee minting franchisors');
  assert.match(src, /requireFactor\(c, 'totp'\)/);
  assert.match(src, /requireStepUp\(c\)/);
  assert.match(src, /requireSuperAdmin\(c\)/);
  // The bar is one function, so a new write cannot forget one of the three.
  const bar = src.slice(src.indexOf('async function requireWriteBar'), src.indexOf('function parseUserId'));
  assert.ok(bar.indexOf("requireFactor(c, 'totp')") < bar.indexOf('requireStepUp(c)'), 'factor before step-up');
  assert.ok(bar.indexOf('requireStepUp(c)') < bar.indexOf('requireSuperAdmin(c)'), 'step-up before the elevation');
  assert.equal((src.match(/await requireWriteBar\(c\)/g) || []).length, 2, 'both writes use the bar');
});

test('the holder console never empties the set, never elevates a non-admin, never self-revokes', () => {
  const src = read(ROUTER);
  assert.match(src, /code: 'last_super_admin'/, 'revoking the last active holder is refused');
  assert.match(src, /code: 'not_an_admin'/, 'only an admin can be elevated');
  assert.match(src, /code: 'cannot_revoke_self'/);
  assert.match(src, /LOWER\(role\) = 'admin'/, 'the grant UPDATE itself re-checks the role');
});

test('every holder change is written to admin_audit_log', () => {
  const src = read(ROUTER);
  assert.match(src, /INSERT INTO admin_audit_log \(admin_user_id, action, filters_json\)/);
  assert.match(src, /'super_admin_grant'/);
  assert.match(src, /'super_admin_revoke'/);
});

test('the holder console is mounted before the /api/admin catch-all', () => {
  const src = read('cloudflare-worker/src/index.ts');
  const mount = src.indexOf("app.route('/api/admin/super-admins', adminSuperAdmins)");
  const catchAll = src.indexOf("app.route('/api/admin', admin)");
  assert.ok(mount > -1, 'the router must be mounted');
  assert.ok(mount < catchAll, 'or the generic admin router answers first');
});

test('the User type carries the flag, so reads stop going through `as any`', () => {
  assert.match(read('cloudflare-worker/src/types.ts'), /is_super_admin\?: number \| null;/);
});

test('the SPA reaches the console through api.js', () => {
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /superAdmins: \(\) => request\('\/admin\/super-admins'\)/);
  assert.match(api, /superAdminGrant: \(userId\) => request\(`\/admin\/super-admins\/\$\{userId\}`, \{ method: 'POST' \}\)/);
  assert.match(api, /superAdminRevoke: \(userId\) => request\(`\/admin\/super-admins\/\$\{userId\}`, \{ method: 'DELETE' \}\)/);
});
