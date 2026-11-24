/**
 * D6733 (#6733) — Retry sync: `POST /api/admin/licences/:uid/sync/retry`
 * re-sends a licence's owed copy now, through the cron's own push.
 *
 *   - success: the branch accepts, the pending row is cleared and the branch revision recorded;
 *   - failure: the attempt is recorded as a cron attempt is (attempts + 1, `last_attempt_at`,
 *     `failure_code`), so the cron's 60-minute window counts from it;
 *   - nothing pending: refused with `nothing_pending`, and nothing is sent;
 *   - one at a time: a second press while an attempt runs is refused with `retry_in_flight`;
 *   - the gate: Super Admin only; a plain admin and a signed-out caller send nothing;
 *   - who retried and when go to `activity_logs` and `admin_audit_log`.
 *
 * Against the migrations' own DDL for `licence_push_pending` (295) and the
 * sync ledger (202611071927).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/licence_sync_retry_d6733.test.ts
 */
import test, { after, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import syncRetry, { SYNC_RETRY_LEASE_SECONDS } from '../src/routes/admin_licence_sync_retry.ts';
import { retryPendingLicencePushes, LICENCE_PUSH_RETRY_WINDOW_MINUTES } from '../src/services/licencePush.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const ADMIN = 2;
const LIC = 'lic_fr';
const NOW = Date.parse('2026-11-15T12:00:00.000Z');

before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind(...args: any[]) { b = coerce(args); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

const ERRORS = { Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403, 'HQ only': 403 } as Record<string, 401 | 403>;
const app = new Hono<any>();
app.route('/api/admin/licences', syncRetry);
app.onError((err: any, c) => {
  const s = ERRORS[String(err?.message || '')];
  if (s) return c.json({ detail: err.message, code: err.message }, s);
  throw err;
});

const dir = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const syncLedgerDdl = () => {
  const m295 = readFileSync(resolve(dir, '295_licence_push_pending.sql'), 'utf8').replace(/^--.*$/gm, '');
  const m4686 = readFileSync(resolve(dir, '202611071927_licence_sync_revision.sql'), 'utf8')
    .replace(/^--.*$/gm, '').split(';').filter((x) => x.trim() && !/branch_licence/.test(x)).join(';\n');
  return `${m295};\n${m4686};`;
};

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT,
      uid TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT);
    CREATE TABLE user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT,
      assurance_level TEXT, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT,
      last_step_up_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT,
      user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE territory_licences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, licence_ref TEXT, entity_id INTEGER,
      legal_entity_name TEXT, brand_name TEXT, registered_address TEXT,
      signatory_name TEXT, signatory_title TEXT, status TEXT NOT NULL DEFAULT 'active',
      term_years INTEGER, annual_fee_cents INTEGER, currency TEXT, revenue_share_bps INTEGER,
      token_split_bps INTEGER, starts_on TEXT, renews_on TEXT, suspended_at TEXT,
      terminated_at TEXT, status_note TEXT, updated_at TEXT, kind TEXT DEFAULT 'subsidiary',
      revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, country_code TEXT UNIQUE, created_at TEXT);
    CREATE TABLE licence_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, seat_type TEXT, seats_licensed INTEGER, created_at TEXT);
    CREATE TABLE licence_contracts (id INTEGER PRIMARY KEY, licence_uid TEXT, template_version INTEGER);
    CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT, code TEXT, hostname TEXT, status TEXT);
  `);
  db.exec(syncLedgerDdl());
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(ADMIN, 'admin', 'Adam', 'adam@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, ADMIN]) {
    db.prepare(`INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))`)
      .run(id, `totp-${id}`);
  }
  db.prepare(`INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?, 'AXL-001', 'Axal VC France SAS', 'Axal VC France', 'active')`).run(LIC);
  db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (1, 'FR')").run();
  db.prepare("INSERT INTO licence_deployments (licence_uid, code, hostname, status) VALUES (?, 'fr', 'fr.axal.vc', 'linked')").run(LIC);
  // HQ numbered revision 143; the branch last accepted 142.
  db.prepare("INSERT INTO licence_sync_state (licence_id, hq_revision, branch_revision, last_success_at) VALUES (1, 143, 142, '2026-11-08T09:00:00.000Z')").run();
  return db;
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
/** A copy owed: revision 143 failed `unreachable` once, `minutes` ago. */
function owe(db: InstanceType<typeof DatabaseSync>, minutes: number) {
  db.prepare(
    `INSERT INTO licence_push_pending (licence_id, code, reason, attempts, first_failed_at, last_attempt_at, revision, failure_code)
     VALUES (1, 'fr', 'The branch did not accept the licence.', 1, ?, ?, 143, 'unreachable')`,
  ).run(ago(minutes), ago(minutes));
}
const pending = (db: any) => db.prepare('SELECT * FROM licence_push_pending').all() as any[];
const syncState = (db: any) => db.prepare('SELECT * FROM licence_sync_state WHERE licence_id = 1').get() as any;
const logs = (db: any) => db.prepare("SELECT action, details, user_id FROM activity_logs WHERE action = 'licence_sync_retried'").all() as any[];
const audits = (db: any) => {
  try { return db.prepare("SELECT admin_user_id, action, filters_json FROM admin_audit_log WHERE action = 'licence_sync_retried'").all() as any[]; } catch { return []; }
};

/** A branch binding that records calls; `gate` holds its answer until released, and `reached` resolves on the first call. */
function branch(mode: { throws?: boolean; gate?: Promise<void> } = {}) {
  const calls: any[] = [];
  let arrived!: () => void;
  const reached = new Promise<void>((r) => { arrived = r; });
  return {
    calls,
    reached,
    binding: {
      applyLicence: async (r: any) => {
        calls.push(r);
        arrived();
        if (mode.gate) await mode.gate;
        if (mode.throws) throw new Error('branch unreachable');
        return { ok: true, hq_revision: r.hq_revision };
      },
    },
  };
}

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
const envOf = (db: any, b: { binding: any }) => ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: makeD1(db), BRANCH_FR: b.binding });
async function retry(db: any, b: { binding: any }, opts: { as?: number | null; uid?: string } = {}) {
  const as = opts.as === undefined ? SUPER : opts.as;
  const res = await app.request(`/api/admin/licences/${opts.uid ?? LIC}/sync/retry`, {
    method: 'POST',
    headers: as === null ? {} : { Authorization: `Bearer ${await token(as)}` },
  }, envOf(db, b));
  let body: any = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

test('D6733: Retry sync sends the owed copy now, inside the cron window, and the branch accepting it clears the row', async () => {
  const db = freshDb();
  owe(db, 10); // inside the cron's 60-minute window: the cron would not send it yet
  const b = branch();
  const r = await retry(db, b);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(b.calls.length, 1, 'one copy sent');
  assert.equal(b.calls[0].hq_revision, 144, 'under a new revision, read fresh');
  assert.equal(r.body.status, 'active', 'the ledger retry response keeps its status');
  assert.equal(r.body.pushed.ok, true);
  assert.equal(r.body.pushed.revision, 144);
  assert.equal(pending(db).length, 0, 'the owed copy landed, so nothing stays owed');
  assert.deepEqual([syncState(db).hq_revision, syncState(db).branch_revision], [144, 144]);
  assert.equal(r.body.sync.pending, null, 'the answer carries the record after the attempt');
  assert.equal(r.body.sync.branch_revision, 144);
});

test('D6733: a failed retry is recorded as a cron attempt is, and the cron’s 60-minute window counts from it', async () => {
  const db = freshDb();
  owe(db, 10);
  const b = branch({ throws: true });
  const r = await retry(db, b);
  assert.equal(r.status, 200, 'the attempt ran; the branch’s failure is reported, never thrown (D111)');
  assert.equal(r.body.pushed.ok, false);
  assert.equal(r.body.pushed.failure_code, 'unreachable');
  const [row] = pending(db);
  assert.equal(row.attempts, 2, 'the attempt is counted');
  assert.equal(row.revision, 144, 'the row stands for the revision this attempt carried');
  assert.equal(row.failure_code, 'unreachable');
  const at = Date.parse(row.last_attempt_at);
  assert.equal(at, NOW, 'last_attempt_at is the time of the manual attempt');
  assert.equal(r.body.sync.pending.attempts, 2);
  assert.equal(r.body.sync.pending.last_attempt_at, row.last_attempt_at);

  // The cron leaves the row alone until 60 minutes after THIS attempt, then sends it.
  const cron = branch();
  const env = envOf(db, cron) as any;
  const inside = await retryPendingLicencePushes(env, new Date(at + (LICENCE_PUSH_RETRY_WINDOW_MINUTES - 1) * 60_000)) as any;
  assert.equal(inside.tried, 0, 'the cron re-sent inside the window that started at the manual retry');
  const past = await retryPendingLicencePushes(env, new Date(at + LICENCE_PUSH_RETRY_WINDOW_MINUTES * 60_000)) as any;
  assert.equal(past.tried, 1);
  assert.equal(cron.calls.length, 1);
});

test('D6733: nothing is sent when no copy is owed — refused with nothing_pending', async () => {
  const db = freshDb();
  const b = branch();
  const r = await retry(db, b);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'nothing_pending');
  assert.equal(r.body.message, 'No copy is owed to the branch, so nothing was sent.');
  assert.equal(b.calls.length, 0, 'a copy was sent when none was owed');
  assert.equal(syncState(db).hq_revision, 143, 'no revision was spent');
  assert.equal(logs(db).length, 0, 'nothing ran, so nothing is logged as retried');
});

test('D6733: one manual retry at a time — a second press while an attempt runs is refused and sends nothing', async () => {
  const db = freshDb();
  owe(db, 90);
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const b = branch({ gate });
  const first = retry(db, b);
  // Let the first request claim the row and reach the branch (#7471): wait on the stub's own
  // signal, raced with the request, so a request that never reaches the branch still fails here.
  await Promise.race([b.reached, first]);
  assert.equal(b.calls.length, 1, 'the first retry is at the branch');
  const second = await retry(db, b);
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'retry_in_flight');
  assert.equal(b.calls.length, 1, 'the second press sent a second copy');
  // While the push runs, the cron does not take the row either: the claim dated it now.
  const cron = await retryPendingLicencePushes(envOf(db, branch()) as any, new Date()) as any;
  assert.equal(cron.tried, 0, 'the cron took a row a manual retry was sending');
  release();
  const done = await first;
  assert.equal(done.status, 200);
  assert.equal(done.body.pushed.ok, true);
  assert.equal(logs(db).length, 1, 'one retry ran, one is logged');
});

test('D6733: the lease is SYNC_RETRY_LEASE_SECONDS from the last attempt, then a retry may run again', async () => {
  const db = freshDb();
  owe(db, (SYNC_RETRY_LEASE_SECONDS - 30) / 60);
  const b = branch();
  const r = await retry(db, b);
  assert.equal(r.body.error, 'retry_in_flight', 'an attempt under the lease ago still holds the row');
  assert.equal(b.calls.length, 0);
  db.prepare('UPDATE licence_push_pending SET last_attempt_at = ?').run(ago((SYNC_RETRY_LEASE_SECONDS + 30) / 60));
  const again = await retry(db, b);
  assert.equal(again.status, 200);
  assert.equal(b.calls.length, 1);
});

test('D6733: the activity log names who retried and when', async () => {
  const db = freshDb();
  owe(db, 10);
  const r = await retry(db, branch({ throws: true }));
  assert.equal(r.status, 200);
  const [log] = logs(db);
  assert.ok(log, 'activity_logs records the retry');
  assert.equal(log.user_id, SUPER, 'it names who pressed it');
  const detail = JSON.parse(log.details);
  assert.equal(detail.licence_uid, LIC);
  assert.equal(detail.attempted_at, pending(db)[0].last_attempt_at, 'and when: the attempt the row records');
  assert.deepEqual([detail.revision, detail.accepted, detail.failure_code], [144, false, 'unreachable']);
  const [audit] = audits(db);
  assert.ok(audit, 'admin_audit_log records it too (D159)');
  assert.equal(audit.admin_user_id, SUPER);
});

test('D6733: Super Admin only — a plain admin and a signed-out caller are refused and send nothing', async () => {
  for (const [who, as, status] of [['plain admin', ADMIN, 403], ['signed out', null, 401]] as const) {
    const db = freshDb();
    owe(db, 90);
    const b = branch();
    const r = await retry(db, b, { as });
    assert.equal(r.status, status, who);
    assert.equal(b.calls.length, 0, `${who}: a copy was sent`);
    assert.equal(pending(db)[0].attempts, 1, `${who}: the row was touched`);
    assert.equal(pending(db)[0].last_attempt_at, pending(db)[0].first_failed_at, `${who}: the row was claimed`);
    assert.equal(logs(db).length, 0, who);
  }
});

test('D6733: an unknown licence is 404 not_found', async () => {
  const db = freshDb();
  owe(db, 90);
  const b = branch();
  const r = await retry(db, b, { uid: 'lic_nope' });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'not_found');
  assert.equal(b.calls.length, 0);
});

test('D6733 integration: a draft is not issued, even if a pending row exists', async () => {
  const db = freshDb();
  db.prepare("UPDATE territory_licences SET status = 'draft' WHERE uid = ?").run(LIC);
  owe(db, 10);
  const b = branch();
  const result = await retry(db, b);
  assert.deepEqual([result.status, result.body.error, b.calls.length], [409, 'not_issued', 0]);
  assert.equal(syncState(db).hq_revision, 143, 'a draft spends no revision');
});
