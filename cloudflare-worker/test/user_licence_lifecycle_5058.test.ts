/**
 * D5058 (#5058) — user licence lifecycle on the shared `licences` identity, over real SQLite and every migration.
 *
 * Pinned, from the issue's acceptance criteria:
 *   · one account holds several user licences at once, each with its own status and revision;
 *   · suspending one licence does not suspend another; the access union follows the suspended one only;
 *   · holding a user licence never makes an account Admin;
 *   · a stale lifecycle write is refused (409) and writes nothing;
 *   · the history records which licence changed, from what, to what, and why;
 *   · a renewal is a new term: earlier terms and their agreement versions stay recorded.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/user_licence_lifecycle_5058.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { mount as userLicencesMount } from '../src/routes/admin_user_licences.ts';
import { heldLicences, grantLicence, revokeLicence } from '../src/services/accountLicences.ts';
import { TRANSITIONS } from '../src/services/userLicences.ts';

const SECRET = ['d5058', 'user', 'licence', 'fixture', 'secret'].join('-');
const ADMIN = 1, SUPER = 2, FOUNDER = 10, PARTNER = 11, OTHER_ADMIN = 12;
const REASON = 'Agreed at the November HQ review.';

function fixture() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Admin One', 'admin1@example.test');
  u.run(SUPER, 'admin', 'Super Two', 'super2@example.test');
  u.run(FOUNDER, 'founder', 'Founder Ten', 'founder10@example.test');
  u.run(PARTNER, 'partner', 'Partner Eleven', 'partner11@example.test');
  u.run(OTHER_ADMIN, 'admin', 'Admin Twelve', 'admin12@example.test');
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))");
  for (const id of [ADMIN, SUPER, FOUNDER]) s.run(id, `totp-${id}`);
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route(userLicencesMount.path, userLicencesMount.router);
  async function call(who: number, method: string, path: string, body?: unknown) {
    const token = await new SignJWT({ user_id: who, jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, env));
      let json: any = null; try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const all = (sql: string, ...a: unknown[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
  return { db, env, call, one, all };
}

/** Re-runs the migration on the same database: the backfill finds every row and inserts nothing. */
function rerunMigration(db: DatabaseSync) {
  db.exec(readFileSync(new URL('../sql/migrations/202611100834_user_licence_lifecycle.sql', import.meta.url), 'utf8'));
}

const list = (call: any, who: number, id: number) => call(who, 'GET', `/api/admin/accounts/${id}/user-licences`);
const status = (call: any, uid: string, action: string, rev: number, who = ADMIN, reason = REASON) =>
  call(who, 'POST', `/api/admin/user-licences/${uid}/status`, { action, expected_revision: rev, reason });

test('the backfill gives every primary licence and every grant a licences row, once, and ends nothing', async () => {
  const { db, env, all, one } = fixture();
  // The fixture's users were inserted after the migration ran, so backfill them now.
  rerunMigration(db);
  const rows = all("SELECT uid, licence_ref, licence_type, holder_id, status, revision FROM licences WHERE licence_family = 'user' ORDER BY holder_id");
  assert.deepEqual(rows.map((r) => [r.holder_id, r.licence_type, r.status]), [['10', 'founder', 'active'], ['11', 'operating_partner', 'active']]);
  assert.equal(one("SELECT COUNT(*) AS n FROM user_licence_events WHERE action = 'backfill'").n, 2);
  rerunMigration(db);
  assert.equal(all("SELECT uid FROM licences WHERE licence_family = 'user'").length, 2, 'a second run inserts nothing');
  assert.equal(one("SELECT COUNT(*) AS n FROM user_licence_events").n, 2);
  assert.equal(all("SELECT uid FROM licences WHERE licence_family = 'user' AND holder_id IN ('1','2','12')").length, 0, 'an Admin role is not a licence');
  assert.deepEqual(await heldLicences(env.DB, { id: FOUNDER, role: 'founder' }), ['founder'], 'backfilled access is unchanged');
});

test('one account holds several licences; suspending one leaves the other, and the access union follows', async () => {
  const { db, env, call, one } = fixture();
  rerunMigration(db);
  assert.equal(await grantLicence(env.DB, { userId: FOUNDER, licence: 'investor', actorId: ADMIN, source: 'admin' }), 'granted');
  assert.equal(await grantLicence(env.DB, { userId: FOUNDER, licence: 'advisor', actorId: ADMIN, source: 'admin' }), 'granted');
  assert.deepEqual(await heldLicences(env.DB, { id: FOUNDER, role: 'founder' }), ['founder', 'investor', 'advisor']);
  const read = await list(call, ADMIN, FOUNDER);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  const byType = Object.fromEntries(read.body.licences.map((l: any) => [l.licence_type, l]));
  assert.equal(byType.founder.is_primary, true);
  assert.equal(byType.investor.is_primary, false);
  assert.equal(byType.investor.status, 'active');

  // Suspend the additional Investor licence: Founder is untouched, Investor's access row is closed.
  const inv = await status(call, byType.investor.uid, 'suspend', byType.investor.revision);
  assert.equal(inv.status, 200, JSON.stringify(inv.body));
  assert.equal(inv.body.licence.status, 'suspended');
  assert.deepEqual(await heldLicences(env.DB, { id: FOUNDER, role: 'founder' }), ['founder', 'advisor']);
  assert.equal(one("SELECT revoked_at FROM account_licences WHERE user_id = ? AND licence = 'advisor'", FOUNDER).revoked_at, null, 'the Advisor access row was not touched');
  assert.equal(one("SELECT status, revision FROM licences WHERE uid = ?", byType.founder.uid).status, 'active');
  assert.equal(one("SELECT revision FROM licences WHERE uid = ?", byType.founder.uid).revision, byType.founder.revision, 'the other licence did not move');
  assert.ok(one("SELECT revoked_at FROM account_licences WHERE user_id = ? AND licence = 'investor'", FOUNDER).revoked_at);

  // Suspend the PRIMARY Founder licence: its access goes, Investor stays as it is (suspended), role is unchanged.
  const fnd = await status(call, byType.founder.uid, 'suspend', byType.founder.revision);
  assert.equal(fnd.status, 200);
  assert.deepEqual(await heldLicences(env.DB, { id: FOUNDER, role: 'founder' }), ['advisor']);
  assert.equal(one('SELECT role FROM users WHERE id = ?', FOUNDER).role, 'founder', 'users.role is never written');
  // Resume Investor alone.
  const back = await status(call, byType.investor.uid, 'resume', inv.body.licence.revision);
  assert.equal(back.status, 200);
  assert.deepEqual(await heldLicences(env.DB, { id: FOUNDER, role: 'founder' }), ['investor', 'advisor']);
  assert.equal(one("SELECT revoked_at FROM account_licences WHERE user_id = ? AND licence = 'investor'", FOUNDER).revoked_at, null);
});

test('a stale or impossible write is refused and writes nothing', async () => {
  const { db, call, one } = fixture();
  rerunMigration(db);
  const l = (await list(call, ADMIN, PARTNER)).body.licences[0];
  assert.equal(l.licence_type, 'operating_partner');
  const ok = await status(call, l.uid, 'suspend', l.revision);
  assert.equal(ok.status, 200);
  const stale = await status(call, l.uid, 'resume', l.revision);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'licence_changed');
  assert.equal(stale.body.current.status, 'suspended');
  assert.equal(one('SELECT status FROM licences WHERE uid = ?', l.uid).status, 'suspended');
  const bad = await status(call, l.uid, 'renewal_pending', ok.body.licence.revision);
  assert.equal(bad.status, 409);
  assert.equal(bad.body.error, 'invalid_transition');
  const events = one("SELECT COUNT(*) AS n FROM user_licence_events WHERE licence_uid = ?", l.uid).n;
  assert.equal(events, 2, 'backfill + one suspend; the refused writes recorded nothing');
  assert.equal((await status(call, l.uid, 'suspend', ok.body.licence.revision, ADMIN, '')).status, 400, 'a reason is required');
  assert.equal((await status(call, l.uid, 'nonsense', ok.body.licence.revision)).status, 400);
  assert.equal((await call(FOUNDER, 'POST', `/api/admin/user-licences/${l.uid}/status`, { action: 'resume', expected_revision: ok.body.licence.revision, reason: REASON })).status, 403, 'only an Admin');
});

test('two writes from the same revision at once: one lands, the other is a 409 and writes nothing', async () => {
  const { db, call, one } = fixture();
  rerunMigration(db);
  const l = (await list(call, ADMIN, PARTNER)).body.licences[0];
  const [x, y] = await Promise.all([status(call, l.uid, 'suspend', l.revision), status(call, l.uid, 'terminate', l.revision)]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  const row = one('SELECT status, revision FROM licences WHERE uid = ?', l.uid);
  assert.equal(row.revision, l.revision + 1, 'exactly one write landed');
  assert.equal(one("SELECT COUNT(*) AS n FROM user_licence_events WHERE licence_uid = ? AND action <> 'backfill'", l.uid).n, 1);
});

test('history says which licence changed, from what, to what, at which revision, why and by whom', async () => {
  const { db, call } = fixture();
  rerunMigration(db);
  const l = (await list(call, ADMIN, FOUNDER)).body.licences[0];
  await status(call, l.uid, 'suspend', l.revision);
  const h = (await list(call, ADMIN, FOUNDER)).body.history;
  const e = h.find((x: any) => x.action === 'suspend');
  assert.equal(e.licence_uid, l.uid);
  assert.equal(e.licence_type, 'founder');
  assert.equal(e.from_status, 'active');
  assert.equal(e.to_status, 'suspended');
  assert.equal(e.revision, l.revision + 1);
  assert.equal(e.reason, REASON);
  assert.equal(e.actor_id, ADMIN);
  assert.throws(() => db.exec('DELETE FROM user_licence_events'), /append-only/);
  assert.throws(() => db.exec("UPDATE user_licence_events SET reason = 'x'"), /append-only/);
});

test('renewal is an explicit new term: earlier terms and agreement versions stay; no silent extension', async () => {
  const { db, call, all } = fixture();
  rerunMigration(db);
  let l = (await list(call, ADMIN, FOUNDER)).body.licences[0];
  const renew = (body: Record<string, unknown>) => call(ADMIN, 'POST', `/api/admin/user-licences/${l.uid}/renew`, { reason: REASON, ...body });
  const first = await renew({ expected_revision: l.revision, starts_on: '2026-01-01', ends_on: '2026-12-31', agreement_version: 'founder_licence@v1' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.term.term_no, 1);
  l = first.body.licence;
  assert.equal(l.ends_on, '2026-12-31');
  // Nothing extends it by itself: expiring it is a person's act, and the term stays as signed.
  const exp = await status(call, l.uid, 'expire', l.revision);
  assert.equal(exp.status, 200);
  l = exp.body.licence;
  assert.equal((await renew({ expected_revision: l.revision, starts_on: '2025-06-01', ends_on: '2027-12-31' })).body.error, 'renewal_overlaps');
  assert.equal((await renew({ expected_revision: l.revision, starts_on: '2027-01-01', ends_on: '2026-01-01' })).status, 400);
  const second = await renew({ expected_revision: l.revision, starts_on: '2027-01-01', ends_on: '2027-12-31', agreement_version: 'founder_licence@v2', renewal_terms: { notice_days: 60 } });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.licence.status, 'active');
  assert.equal(second.body.term.term_no, 2);
  const terms = all('SELECT term_no, starts_on, ends_on, agreement_version FROM user_licence_terms WHERE licence_uid = ? ORDER BY term_no', l.uid);
  assert.deepEqual(terms, [
    { term_no: 1, starts_on: '2026-01-01', ends_on: '2026-12-31', agreement_version: 'founder_licence@v1' },
    { term_no: 2, starts_on: '2027-01-01', ends_on: '2027-12-31', agreement_version: 'founder_licence@v2' },
  ]);
  assert.throws(() => db.exec("UPDATE user_licence_terms SET ends_on = '2030-01-01'"), /append-only/);
  assert.equal((await renew({ expected_revision: l.revision, starts_on: '2028-01-01' })).status, 409, 'a stale renewal is refused');
  const term = await status(call, l.uid, 'terminate', second.body.licence.revision);
  assert.equal(term.status, 200);
  assert.equal((await renew({ expected_revision: term.body.licence.revision, starts_on: '2029-01-01' })).body.error, 'invalid_transition', 'a terminated licence is not renewed');
});

test('no licence makes an account Admin, and another Admin\'s account needs a Super Admin', async () => {
  const { db, env, call, one } = fixture();
  rerunMigration(db);
  for (const k of ['founder', 'investor', 'advisor', 'partner']) await grantLicence(env.DB, { userId: PARTNER, licence: k, actorId: ADMIN, source: 'admin' });
  assert.equal(one('SELECT role FROM users WHERE id = ?', PARTNER).role, 'partner');
  for (const l of (await list(call, ADMIN, PARTNER)).body.licences) {
    await status(call, l.uid, 'suspend', l.revision);
  }
  assert.equal(one('SELECT role FROM users WHERE id = ?', PARTNER).role, 'partner');
  assert.ok(!Object.keys(TRANSITIONS).some((k) => /admin/i.test(k)), 'no lifecycle action names Admin');
  assert.equal((await list(call, ADMIN, OTHER_ADMIN)).status, 403);
  assert.equal((await list(call, SUPER, OTHER_ADMIN)).status, 200);
});

test('D4472\'s grant and revoke keep the shared row in step, and a re-grant re-opens the same licence', async () => {
  const { db, env, one, all } = fixture();
  rerunMigration(db);
  await grantLicence(env.DB, { userId: FOUNDER, licence: 'advisor', actorId: ADMIN, source: 'admin' });
  const row = one("SELECT uid, status, revision FROM licences WHERE licence_family = 'user' AND holder_id = '10' AND licence_type = 'advisor'");
  assert.equal(row.status, 'active');
  assert.equal(await revokeLicence(env.DB, { userId: FOUNDER, licence: 'advisor', actorId: ADMIN, source: 'admin' }), 'revoked');
  assert.equal(one('SELECT status FROM licences WHERE uid = ?', row.uid).status, 'terminated');
  assert.equal(await grantLicence(env.DB, { userId: FOUNDER, licence: 'advisor', actorId: ADMIN, source: 'admin' }), 'granted');
  const again = one('SELECT uid, status, revision FROM licences WHERE uid = ?', row.uid);
  assert.equal(again.status, 'active');
  assert.equal(again.revision, row.revision + 2);
  assert.deepEqual(all('SELECT action FROM user_licence_events WHERE licence_uid = ? ORDER BY id', row.uid).map((e) => e.action), ['grant', 'terminate', 'grant']);
  assert.equal(all("SELECT uid FROM licences WHERE licence_family = 'user' AND holder_id = '10' AND licence_type = 'advisor'").length, 1, 'one licence, never two');
});
