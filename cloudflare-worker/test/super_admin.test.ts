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

import { isSuperAdmin, hydrateSuperAdmin, loadSuperAdminFlag } from '../src/auth.ts';

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

test("the refusal is a 403 — not a 500, and not a 400", () => {
  // AUTH_ERROR_STATUSES maps thrown messages to statuses; anything missing
  // falls through to the generic 500. A gate that works and reports a server
  // error is a gate nobody can act on.
  const src = read('cloudflare-worker/src/util/authErrors.ts');
  assert.match(src, /'Super admin required': 403/);

  // D110 — AND THE OTHER READER, which is the one this console actually goes
  // through. Every route in `admin_licences.ts` catches its own throws with
  // `mapError`, so `app.onError` never sees them; `mapError` had its own list
  // of sentences, that list did not include this one, and the whole franchise
  // console answered a permission refusal with **400 Bad Request**. There is
  // one table now and both readers index it.
  const helpers = read('cloudflare-worker/src/routes/_t13t14t15_helpers.ts');
  assert.match(helpers, /AUTH_ERROR_STATUSES\[msg\] \?\? 400/);
  assert.ok(
    !/msg === 'Forbidden' \|\| msg === 'Admin required'/.test(helpers),
    'mapError must not carry a second list of which sentence is which status',
  );
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

test('migration 199 keeps the elevation OFF the users table', () => {
  // The first version of 199 was `ALTER TABLE users ADD COLUMN`, and the first
  // deploy that ran migrations before shipping (#413, 2026-09-03) failed on
  // it: D1 caps a table at 100 columns and `users` is there — GOTCHAS had said
  // so. The elevation is a side table keyed by user_id, the shape
  // user_google_links (065) and mi_pro_subscriptions already use.
  const code = read('cloudflare-worker/sql/migrations/199_super_admin.sql').replace(/--.*$/gm, '');
  assert.match(code, /CREATE TABLE IF NOT EXISTS super_admins \(\s*user_id\s+INTEGER PRIMARY KEY REFERENCES users\(id\)/);
  assert.doesNotMatch(code, /ALTER TABLE users/, 'users cannot take another column on D1');
  assert.doesNotMatch(code, /INSERT/, "who holds it is 207's decision, not a backfill");
});

/**
 * The body of one top-level `export … function NAME` in a source file. Plain
 * string search, not a regex built from the name (Semgrep's non-literal
 * RegExp rule, and there is nothing a regex adds here).
 */
function exportedFn(src: string, name: string): string {
  const heads = ['async function', 'function'].flatMap((kw) => ['(', '<'].map((open) => `\nexport ${kw} ${name}${open}`));
  const start = heads.map((h) => src.indexOf(h)).find((i) => i > -1);
  assert.ok(start !== undefined, `${name} is exported`);
  const from = start as number;
  const next = src.indexOf('\nexport ', from + 1);
  return src.slice(from, next === -1 ? src.length : next);
}

test('the elevation is read from super_admins, never from a users column', () => {
  // A database that applied the first 199 still carries `users.is_super_admin`,
  // and that column says every admin is elevated. Nothing may read it.
  const router = read('cloudflare-worker/src/routes/admin_super_admins.ts');
  // Inside the router's SQL, `is_super_admin` may appear ONLY as the alias of
  // a value derived from the side table — never as a column read, a filter
  // or a write on `users`.
  const sqlStrings = router.match(/prepare\(\s*(`[^`]*`|'[^']*')/g) || [];
  assert.ok(sqlStrings.length >= 4, 'the router prepares its SQL');
  for (const stmt of sqlStrings) {
    const stray = stmt.replace(/\bAS is_super_admin\b/g, '');
    assert.doesNotMatch(stray, /is_super_admin/, `is_super_admin is read off users in: ${stmt.slice(0, 80)}…`);
  }
  assert.doesNotMatch(router, /users SET is_super_admin|is_super_admin FROM users|WHERE is_super_admin/);
  assert.match(router, /FROM super_admins s\s+JOIN users u ON u\.id = s\.user_id/, 'holders are the side table');
  assert.match(router, /LEFT JOIN super_admins s ON s\.user_id = u\.id/, 'a target\'s elevation is derived from the join');
  assert.match(router, /DELETE FROM super_admins WHERE user_id = \?/, 'revoke deletes the row');

  const auth = read('cloudflare-worker/src/auth.ts');
  assert.match(exportedFn(auth, 'loadSuperAdminFlag'), /SELECT user_id FROM super_admins WHERE user_id = \?/);
  assert.match(exportedFn(auth, 'getCurrentUser'), /await hydrateSuperAdmin\(c\.env, u\)/,
    'getCurrentUser hydrates the flag from the side table before anything downstream reads the row');
  const hydrate = exportedFn(auth, 'hydrateSuperAdmin');
  assert.match(hydrate, /\.is_super_admin = flag;/, "the row's own value, if a column still exists, is overwritten");
  // The lookup is behind `isAdminRole` and stays behind it. D106 added a
  // second conjunct (`&& !onBranch`), so this matches the CONDITION rather
  // than the exact expression it was: a further narrowing is fine — every one
  // makes more accounts read 0 without a lookup — while moving the call out
  // from behind `isAdminRole`, or dropping the guard entirely, still fails.
  assert.match(
    hydrate,
    /const flag: 0 \| 1 = isAdminRole[^?]*\? await loadSuperAdminFlag\(/,
    'non-admins are 0 without a lookup, and the lookup stays behind isAdminRole',
  );
  assert.match(hydrate, /: 0;/, 'the other arm is the literal 0, not a second lookup');
  // D106 — on a branch the answer is 0 and the table is not consulted at all.
  // Pinned here as well as in branch_mode_gates.test.ts because this file is
  // the one that reads as "everything about how the elevation is resolved".
  assert.match(hydrate, /const onBranch = branchOf\(env\) !== null;/,
    'branch mode decides the elevation, not a row count (D106)');
});

function fakeEnv(first: () => Promise<unknown>) {
  const calls: string[] = [];
  return {
    calls,
    env: { DB: { prepare: (sql: string) => { calls.push(sql); return { bind: () => ({ first }) }; } } } as any,
  };
}

test('hydrateSuperAdmin answers from the table, and only asks for admins', async () => {
  const present = fakeEnv(async () => ({ user_id: 8 }));
  const admin = await hydrateSuperAdmin(present.env, { id: 8, role: 'admin', is_super_admin: 0 });
  assert.equal(admin.is_super_admin, 1, 'a row in super_admins elevates, whatever the users column said');
  assert.equal(present.calls.length, 1);

  const absent = fakeEnv(async () => null);
  const plain = await hydrateSuperAdmin(absent.env, { id: 1, role: 'admin', is_super_admin: 1 });
  assert.equal(plain.is_super_admin, 0, 'no row: not elevated, even if a stale column says 1');

  const founder = fakeEnv(async () => ({ user_id: 3 }));
  const f = await hydrateSuperAdmin(founder.env, { id: 3, role: 'founder' });
  assert.equal(f.is_super_admin, 0);
  assert.equal(founder.calls.length, 0, 'a non-admin is never elevated, so the table is not consulted');
});

test('a side table that cannot be read elevates nobody', async () => {
  const warn = console.warn; const warned: string[] = [];
  console.warn = (...a: unknown[]) => { warned.push(String(a[0])); };
  try {
    const broken = fakeEnv(async () => { throw new Error('no such table: super_admins'); });
    assert.equal(await loadSuperAdminFlag(broken.env, 8), 0, 'fail closed');
    const u = await hydrateSuperAdmin(broken.env, { id: 8, role: 'admin', is_super_admin: 1 });
    assert.equal(u.is_super_admin, 0, 'the gate never says yes because it could not ask');
    assert.ok(warned.some((w) => /super_admins hydrate failed/.test(w)), 'and it is logged, not silent');
  } finally { console.warn = warn; }
});

/* ────────────────────────────────────────────────────────────────────────────
 * One holder, by name (migration 207), and the console that changes it.
 * ──────────────────────────────────────────────────────────────────────────── */

const ROUTER = 'cloudflare-worker/src/routes/admin_super_admins.ts';

test('migration 207 narrows the elevation to the one named account, after 199', () => {
  const sql = read('cloudflare-worker/sql/migrations/207_super_admin_single_holder.sql');
  const code = sql.replace(/--.*$/gm, '');
  assert.match(code, /DELETE FROM super_admins\s+WHERE user_id NOT IN \(\s*SELECT id FROM users WHERE LOWER\(email\) = 'guillaume\.lauzier@axal\.vc'\s*\)/,
    'every other holder is revoked, including any an old-shape database elevated');
  assert.match(code, /INSERT OR IGNORE INTO super_admins[\s\S]*FROM users\s+WHERE LOWER\(email\) = 'guillaume\.lauzier@axal\.vc'\s+AND LOWER\(role\) = 'admin'/,
    'the grant still requires the admin role — the elevation stays an elevation');
  assert.doesNotMatch(code, /ALTER TABLE/, '207 is a data migration; the table is 199\'s');
  assert.doesNotMatch(code, /UPDATE users|users SET/, '207 never touches users — it cannot take a column, and the side table is the source');
  assert.doesNotMatch(read('cloudflare-worker/sql/migrations/199_super_admin.sql'), /axal\.vc/,
    '199 is not edited to carry the decision; 207 is the decision');
});

test('the holder console gates every write behind the shared write bar', () => {
  // RE-POINTED IN D134, AND THE REASON IS WORTH KEEPING. This used to read the
  // bar's three checks out of THIS file, because the bar was declared here. It
  // now lives in `auth.ts` — promoting an admin through a licence and demoting
  // one want the same three checks in the same order, and a third hand-written
  // copy is how one of them comes to check only two. A guard that pins WHERE a
  // helper is declared fails a correct move; this pins what this router does,
  // which is the claim it actually owns.
  //
  // The bar's CONTENTS and their order are pinned once, in
  // `licence_admin_lifecycle_d134.test.ts`, beside the definition. Asserting
  // them here as well would be two tests of one fact that can be changed apart.
  const src = read(ROUTER);
  assert.doesNotMatch(src, /\brequireAdmin\b/, 'a plain admin gate here is a franchisee minting franchisors');
  assert.match(src, /import \{[^}]*requireSuperAdminWriteBar[^}]*\} from '\.\.\/auth'/,
    'the bar is not the shared one — a local copy can drift from it silently');
  assert.doesNotMatch(src, /^async function requireWriteBar/m,
    'this router declared its own bar again');
  assert.equal((src.match(/await requireSuperAdminWriteBar\(c\)/g) || []).length, 2,
    'both writes use the bar');
  // Reads take the elevation alone, deliberately: a step-up on every list
  // trains the holder to type a TOTP code without reading why.
  assert.match(src, /r\.get\('\/', async \(c\) => \{\s*await requireSuperAdmin\(c\);/,
    'the holder list stopped taking the elevation, or started taking the write bar');
});

test('the holder console never empties the set, never elevates a non-admin, never self-revokes', () => {
  const src = read(ROUTER);
  assert.match(src, /code: 'last_super_admin'/, 'revoking the last active holder is refused');
  assert.match(src, /code: 'not_an_admin'/, 'only an admin can be elevated');
  assert.match(src, /code: 'cannot_revoke_self'/);
  assert.match(src, /INSERT OR IGNORE INTO super_admins[\s\S]*WHERE id = \? AND LOWER\(role\) = 'admin'/, 'the grant INSERT itself re-checks the role');
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

test('only a holder may impersonate a holder', () => {
  // The impersonation token carries the TARGET's identity, so every gate
  // downstream — requireSuperAdmin included — passes for whoever holds it. A
  // plain admin borrowing the one account that can franchise the platform is
  // an escalation, and the refusal has to sit in the impersonate handler
  // itself, before the token is minted.
  const src = read('cloudflare-worker/src/routes/admin.ts');
  const handler = src.slice(src.indexOf("admin.post('/impersonate/:userId'"), src.indexOf("admin.post('/impersonate-sessions/:id/end'"));
  assert.match(handler, /await hydrateSuperAdmin\(c\.env, target as any\)/,
    'the target is a SELECT * row: its elevation must come from the side table, not a stale column');
  assert.match(handler, /isSuperAdmin\(target as any\) && !isSuperAdmin\(adminUser as any\)/);
  assert.ok(handler.indexOf('await hydrateSuperAdmin(c.env, target as any)') < handler.indexOf('isSuperAdmin(target as any)'),
    'hydrate before the check');
  assert.match(handler, /code: 'cannot_impersonate_super_admin'/);
  assert.ok(handler.indexOf('cannot_impersonate_super_admin') < handler.indexOf('createJWT('),
    'the refusal must come before the token is minted');
});

test('the HQ overview is super-admin only, mounted before the catch-all, and says what it cannot count', () => {
  const src = read('cloudflare-worker/src/routes/admin_hq.ts');
  assert.doesNotMatch(src, /\brequireAdmin\b/);
  assert.match(src, /await requireSuperAdmin\(c\)/);
  assert.match(src, /\.\.\.DERIVED_UNAVAILABLE/);
  const idx = read('cloudflare-worker/src/index.ts');
  assert.ok(idx.indexOf("app.route('/api/admin/hq', adminHq)") < idx.indexOf("app.route('/api/admin', admin)"));
});

test('force re-auth is behind the impersonation bar, needs a reason, and is audited', () => {
  const src = read('cloudflare-worker/src/routes/admin_security.ts');
  assert.doesNotMatch(src, /\brequireAdmin\b/);
  const write = src.slice(src.indexOf("r.post('/force-reauth'"));
  assert.match(write, /await requireFactor\(c, 'totp'\);\s+await requireStepUp\(c\);\s+const actor = await requireSuperAdmin\(c\);/);
  assert.match(write, /code: 'reason_required'/);
  assert.match(write, /INSERT INTO admin_audit_log \(admin_user_id, action, filters_json\)/);
  const idx = read('cloudflare-worker/src/index.ts');
  assert.ok(idx.indexOf("app.route('/api/admin/security', adminSecurity)") < idx.indexOf("app.route('/api/admin', admin)"));
});

test('the SPA reaches the console through api.js', () => {
  // THIS PINNED A SPELLING AND A LEGITIMATE CHANGE FAILED IT — the fourth time
  // in this programme (`branch_rail_mount`, `branch_approvals_board_d130`, the
  // `flushSurface` quartet). D133 gave `superAdminGrant` an options argument so
  // a holder can hand the platform on, and the old regex matched the exact
  // single-parameter source line, so it refused a signature change that broke
  // nothing it was written to protect.
  //
  // What it was written to protect is that each method exists and reaches its
  // OWN path and verb, so that is what it now asserts — bounded to each
  // method's own body so a neighbour's `request(...)` cannot satisfy it.
  const api = read('frontend/src/lib/api.js');
  for (const [name, verb] of [
    ['superAdmins', null], ['superAdminGrant', 'POST'], ['superAdminRevoke', 'DELETE'],
  ] as [string, string | null][]) {
    const at = api.indexOf(`${name}:`);
    assert.ok(at > 0, `${name} no longer reaches the console`);
    // BOUNDED AT THE NEXT METHOD, NOT AT A CHARACTER COUNT. A first draft took
    // 300 characters and a mutation walked straight through it: the window ran
    // past `superAdminGrant` into `superAdminRevoke`, whose own URL satisfied
    // the path assertion. That is the one failure mode a substring scan has,
    // and it is the second time in two days it has had to be closed.
    const rest = api.slice(at);
    const nextKey = rest.slice(1).search(/\n {2}[A-Za-z_$][\w$]*:/);
    const body = nextKey > 0 ? rest.slice(0, nextKey + 1) : rest;
    assert.ok(body.includes('/admin/super-admins'),
      `${name} no longer calls the super-admin route`);
    if (verb) {
      assert.ok(body.includes(`method: '${verb}'`), `${name} stopped using ${verb}`);
      assert.ok(/\$\{userId\}/.test(body), `${name} stopped naming the target`);
    }
  }
});
