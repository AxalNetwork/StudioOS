/**
 * Terminating a licence deprovisions the people who administered it (D145).
 *
 * WHAT WAS LEFT BEHIND. Terminate released the territory, set the status and —
 * since D139 — withdrew the licence's open compliance notices. It never touched
 * `users.role`, `licence_admins` or `is_active`, so afterwards the licence's
 * administrators still held `role = 'admin'` over a licence that no longer
 * exists. That is the unscoped admin D134's door was built to make unreachable,
 * arriving through the back.
 *
 * WHY THE HELPER IS EXPORTED AND TESTED DIRECTLY. The sequence is the thing
 * with invariants — demote before detach, skip the elevation holder, report
 * rather than throw — and driving it through the whole route would need a
 * fixture for eight tables to exercise three. `util/supportSessionSweep.ts` was
 * extracted for exactly this reason and says so in its own header. The WIRING
 * (that terminate calls it, and calls it after the notification) is pinned
 * separately by reading the route's source, because no unit test can see it.
 *
 * REAL SQLITE, NOT A STUB. The helper's correctness is in what the rows look
 * like afterwards — a role revoked but a binding left, or the reverse, is the
 * defect — and only real statements can show that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deprovisionLicenceAdmins, unbindBranchAdmins } from '../src/routes/admin_licences.ts';

const ACTOR = { id: 1, name: 'HQ Holder', email: 'hq@axal.test' };
const LICENCE = 42;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
        _sql: sql,
        _binds: () => b,
      };
      return api;
    },
    async batch(stmts: any[]) {
      // D1's batch is sequential and all-or-nothing enough for this shape; the
      // helper's own try/catch owns the failure path.
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

function seedDb({ holders = [] as number[], withSuperAdmins = true, withLicenceAdmins = true } = {}) {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER);
  `);
  if (withLicenceAdmins) {
    db.exec('CREATE TABLE licence_admins (licence_id INTEGER, user_id INTEGER UNIQUE, admin_role TEXT)');
  }
  if (withSuperAdmins) db.exec('CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY)');
  db.prepare("INSERT INTO users (id,email,name,role,is_active) VALUES (1,'hq@axal.test','HQ Holder','admin',1)").run();
  db.prepare("INSERT INTO users (id,email,name,role,is_active) VALUES (7,'p@fr.test','Margot','admin',1)").run();
  db.prepare("INSERT INTO users (id,email,name,role,is_active) VALUES (8,'d@fr.test','Luc','admin',1)").run();
  if (withLicenceAdmins) {
    db.prepare('INSERT INTO licence_admins (licence_id,user_id,admin_role) VALUES (?,7,?)').run(LICENCE, 'principal');
    db.prepare('INSERT INTO licence_admins (licence_id,user_id,admin_role) VALUES (?,8,?)').run(LICENCE, 'delegate');
  }
  if (withSuperAdmins) for (const h of holders) db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(h);
  return db;
}

const userRow = (db: any, id: number) => db.prepare('SELECT role, is_active FROM users WHERE id = ?').get(id);
const bindings = (db: any) => db.prepare('SELECT user_id FROM licence_admins WHERE licence_id = ?').all(LICENCE).map((r: any) => r.user_id);

test('both administrators are demoted, detached and deactivated', async () => {
  const db = seedDb();
  const out = await deprovisionLicenceAdmins({ DB: makeD1(db) } as any, LICENCE, ACTOR, 'payment default');

  assert.equal(out.ok, true);
  assert.equal(out.demoted, 2);
  assert.equal(out.detached, 2);
  assert.equal(out.deactivated, 2);
  assert.deepEqual(out.skipped, []);

  for (const id of [7, 8]) {
    const u = userRow(db, id) as any;
    assert.equal(u.role, 'exploring', 'the admin role must be revoked');
    assert.equal(u.is_active, 0, 'and the account deactivated');
  }
  assert.deepEqual(bindings(db), [], 'and the licence binding removed');
  db.close();
});

test('NO ADMIN IS LEFT BOUND TO A LICENCE THEY NO LONGER ADMINISTER, and none unbound while still admin', async () => {
  // The two halves of the D134 invariant, asserted together because either one
  // alone is satisfied by doing nothing.
  const db = seedDb();
  await deprovisionLicenceAdmins({ DB: makeD1(db) } as any, LICENCE, ACTOR, 'payment default');
  const stillAdminAndBound = db.prepare(
    "SELECT COUNT(*) AS n FROM licence_admins la JOIN users u ON u.id = la.user_id WHERE u.role = 'admin'",
  ).get() as any;
  const adminWithNoBinding = db.prepare(
    "SELECT COUNT(*) AS n FROM users u WHERE u.role = 'admin' AND u.id IN (7,8)",
  ).get() as any;
  assert.equal(Number(stillAdminAndBound.n), 0);
  assert.equal(Number(adminWithNoBinding.n), 0);
  db.close();
});

test('a Super Admin holder is skipped with its reason, and keeps everything', async () => {
  const db = seedDb({ holders: [7] });
  const out = await deprovisionLicenceAdmins({ DB: makeD1(db) } as any, LICENCE, ACTOR, 'payment default');

  assert.equal(out.demoted, 1, 'only the non-holder is demoted');
  assert.deepEqual(out.skipped.map((s: any) => s.user_id), [7]);
  assert.match(out.skipped[0].reason, /Super Admin elevation/);

  const holder = userRow(db, 7) as any;
  assert.equal(holder.role, 'admin', 'the elevation sits ON the admin role — demoting the holder breaks it');
  assert.equal(holder.is_active, 1);
  assert.deepEqual(bindings(db), [7], 'and the holder keeps the binding too');
  db.close();
});

test('an unreadable super_admins table demotes NOBODY — it fails closed', async () => {
  // Failing open here could strip the elevation's holder of the role it sits
  // on, which is unrecoverable through the API. A manual cleanup is cheaper.
  const db = seedDb({ withSuperAdmins: false });
  const out = await deprovisionLicenceAdmins({ DB: makeD1(db) } as any, LICENCE, ACTOR, 'payment default');

  assert.equal(out.ok, false);
  assert.equal(out.demoted, 0);
  assert.match(String(out.reason), /could not be read/);
  assert.match(String(out.reason), /termination itself is recorded/);
  for (const id of [7, 8]) assert.equal((userRow(db, id) as any).role, 'admin');
  db.close();
});

test('an unreadable licence_admins reports rather than throwing', async () => {
  const db = seedDb({ withLicenceAdmins: false });
  const out = await deprovisionLicenceAdmins({ DB: makeD1(db) } as any, LICENCE, ACTOR, 'payment default');
  assert.equal(out.ok, false);
  assert.equal(out.demoted, 0);
  assert.match(String(out.reason), /termination itself is recorded/);
  db.close();
});

test('a licence with no administrators is a clean no-op, not a failure', async () => {
  const db = seedDb();
  db.prepare('DELETE FROM licence_admins').run();
  const out = await deprovisionLicenceAdmins({ DB: makeD1(db) } as any, LICENCE, ACTOR, 'payment default');
  assert.deepEqual(out, { ok: true, demoted: 0, detached: 0, deactivated: 0, skipped: [] });
  db.close();
});

test('both sides of the audit are written, and name the cause', async () => {
  const db = seedDb();
  await deprovisionLicenceAdmins({ DB: makeD1(db) } as any, LICENCE, ACTOR, 'payment default');
  const rows = db.prepare('SELECT action, details, user_id FROM activity_logs ORDER BY id').all() as any[];
  const actorRows = rows.filter((r) => r.action === 'role_changed');
  const targetRows = rows.filter((r) => r.action === 'your_role_changed');
  assert.equal(actorRows.length, 2, 'one actor-side row per administrator');
  assert.equal(targetRows.length, 2, 'and one addressed to each of them');
  // The reader must be able to tell WHY, not just that it happened.
  assert.match(targetRows[0].details, /licence you\s+administered was terminated/);
  assert.match(targetRows[0].details, /payment default/, 'the operator\'s own reason is carried');
  assert.deepEqual(targetRows.map((r) => r.user_id).sort(), [7, 8]);
  // Only the two names already in the audit allowlist — a new action would be
  // invisible in every reader until three sweeps had been done.
  assert.deepEqual([...new Set(rows.map((r) => r.action))].sort(), ['role_changed', 'your_role_changed']);
  db.close();
});

test('running it twice is a no-op the second time', async () => {
  const db = seedDb();
  const first = await deprovisionLicenceAdmins({ DB: makeD1(db) } as any, LICENCE, ACTOR, 'payment default');
  const second = await deprovisionLicenceAdmins({ DB: makeD1(db) } as any, LICENCE, ACTOR, 'payment default');
  assert.equal(first.demoted, 2);
  assert.equal(second.demoted, 0, 'the bindings are gone, so there is nobody left to find');
  assert.deepEqual(second.skipped, []);
  db.close();
});

/* The wiring, which no unit test above can see. */

const ROUTE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_licences.ts'), 'utf8');

test('terminate calls it, and calls it AFTER the notification', async () => {
  const at = ROUTE.indexOf("r.post('/:uid/terminate'");
  assert.ok(at > 0);
  const body = ROUTE.slice(at, ROUTE.indexOf('\n});', at));
  const notify = body.indexOf('notifyLicenceAdmins(');
  const deprov = body.indexOf('deprovisionLicenceAdmins(');
  assert.ok(notify > 0, 'terminate must still notify the administrators');
  assert.ok(deprov > 0, 'terminate must deprovision them');
  assert.ok(
    notify < deprov,
    'deprovisioning before notifying sends the termination mail to nobody — the bindings are how they are found',
  );
});

test('the result is reported as its own field, never folded into ok', async () => {
  const at = ROUTE.indexOf("r.post('/:uid/terminate'");
  const body = ROUTE.slice(at, ROUTE.indexOf('\n});', at));
  assert.match(body, /admins_deprovisioned: adminsDeprovisioned/, 'the caller must see what happened per account');
  // D139's precedent, and the reason: a recorded termination must not be undone
  // by a failure in the cleanup after it.
  assert.match(body, /notices_withdrawn: noticesWithdrawn/, 'and D139\'s field must still be reported beside it');
});

test('no new licence_events value is written — 187\'s CHECK is not widened here', () => {
  const at = ROUTE.indexOf('export async function deprovisionLicenceAdmins');
  const helper = ROUTE.slice(at, ROUTE.indexOf('\nr.post(', at));
  assert.ok(
    !helper.includes('logEvent('),
    'a new licence_events value needs a migration to widen the CHECK — D139 learned that the expensive way',
  );
});

/* D262 — the branch's own administrators. */

const SECRET = 'synthetic-hq-rpc-secret-not-a-credential';
const branchEnv = (stub: unknown, extra: Record<string, unknown> = {}) =>
  ({ HQ_RPC_SECRET: SECRET, BRANCH_FR: stub, ...extra }) as any;

test('D262: a branch that throws is reported, never thrown — the termination stands', async () => {
  const stub = { async unbindAdmin() { throw new Error('rpc: fr did not answer'); } };
  const out = await unbindBranchAdmins(branchEnv(stub), 'fr', 'HQ Holder', 'the agreement has ended');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'fr');
  assert.match(String(out.reason), /termination is recorded/);
  assert.match(String(out.reason), /fr did not answer/);
});

test('D262: no deployment, no secret and no binding are each a reported reason, and the branch is not called', async () => {
  let calls = 0;
  const stub = { async unbindAdmin() { calls += 1; return { unbound: [], skipped: [] }; } };
  const none = await unbindBranchAdmins(branchEnv(stub), null, 'HQ Holder', 'n');
  assert.equal(none.ok, false);
  assert.match(String(none.reason), /no branch deployment/);
  const noSecret = await unbindBranchAdmins(branchEnv(stub, { HQ_RPC_SECRET: '' }), 'fr', 'HQ Holder', 'n');
  assert.equal(noSecret.ok, false);
  assert.match(String(noSecret.reason), /HQ_RPC_SECRET/);
  const unbound = await unbindBranchAdmins(branchEnv(stub), 'de', 'HQ Holder', 'n');
  assert.equal(unbound.ok, false);
  assert.match(String(unbound.reason), /No branch Worker is bound for de/);
  assert.equal(calls, 0, 'the branch was called on a path that should have stopped short of it');
});

test('D262: a branch that answers is asked with the secret first and no target, and its count is reported', async () => {
  const seen: unknown[][] = [];
  const stub = { async unbindAdmin(...args: unknown[]) { seen.push(args); return { unbound: [{ id: 3 }, { id: 4 }], skipped: [] }; } };
  const out = await unbindBranchAdmins(branchEnv(stub), 'fr', 'HQ Holder', 'the agreement has ended');
  assert.deepEqual(out, { ok: true, code: 'fr', unbound: 2, skipped: [] });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], SECRET);
  assert.ok(!('target_user_id' in (seen[0][1] as object)));
});

test('D262: terminate calls it AFTER the push, reports it as its own field, and never rethrows', () => {
  const at = ROUTE.indexOf("r.post('/:uid/terminate'");
  const body = ROUTE.slice(at, ROUTE.indexOf('\n});', at));
  const push = body.indexOf('pushLicenceToBranch(');
  const unbind = body.indexOf('unbindBranchAdmins(');
  assert.ok(push > 0 && unbind > push, 'the branch must hold `terminated` before its administrators are unbound');
  assert.match(body, /branch_admins_unbound: branchAdminsUnbound/);
  const helper = ROUTE.slice(ROUTE.indexOf('export async function unbindBranchAdmins'), at);
  assert.doesNotMatch(helper, /\bthrow\b/, 'the helper throws: a failed cleanup would undo a recorded termination');
});
