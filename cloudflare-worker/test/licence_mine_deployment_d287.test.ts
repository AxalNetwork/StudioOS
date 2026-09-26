/**
 * D287 — the HQ arm of /api/licence/mine carries the licence's deployment.
 *
 * WHAT IS PINNED. `deployment` is read by `licence_uid` in its own try:
 * "not requested" means there is no row and never a stored value; `live` is
 * the worker's one rule (`linked`, migration 258's last step) and `failed`
 * is never live; a read that fails answers `readable: false` with a reason
 * while the rest of the payload still answers 200; and the field carries no
 * time, because `requested_at` is the request and `updated_at` is whichever
 * write came last, and neither is a step's.
 *
 * THE FIXTURE SLICES `licence_deployments` OFF MIGRATION 258, constraints and
 * defaults included (`status … DEFAULT 'requested'`, `licence_uid UNIQUE`),
 * for the reason licence_domain_d197 gives for 280: a hand-written table
 * that relaxed one would let this suite go green against a table production
 * does not have. The rest of the fixture is D197's, which already drives
 * /licence/mine end to end.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/licence_mine_deployment_d287.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import licence, { DEPLOYMENT_LIVE_STATUS, deploymentIsLive, deploymentField } from '../src/routes/licence.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 2;
const OTHER = 3;
const NOBODY = 5;
const LIC = 'lic_d287';
const LIC2 = 'lic_d287_b';

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
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

const ERRORS = { Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>;
const app = new Hono<any>();
app.route('/licence', licence);
app.onError((err: any, c) => {
  const s = ERRORS[String(err?.message || '')];
  if (s) return c.json({ detail: err.message, code: err.message }, s);
  throw err;
});

/** One table's CREATE, sliced whole off its migration. */
function ddl(file: string, table: string): string {
  const sql = readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');
  const at = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(at > 0, `${file} no longer declares ${table} — re-point this fixture`);
  const end = sql.indexOf('\n);', at);
  assert.ok(end > at, `${file}: the CREATE does not terminate`);
  return sql.slice(at, end + 3);
}

function freshDb(opts: { deployments?: boolean } = {}) {
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
    CREATE TABLE admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER, action TEXT,
      viewed_user_id INTEGER, filters_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE territory_licences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, licence_ref TEXT, entity_id INTEGER,
      legal_entity_name TEXT, brand_name TEXT, registered_address TEXT,
      signatory_name TEXT, signatory_title TEXT, status TEXT NOT NULL DEFAULT 'active',
      term_years INTEGER, annual_fee_cents INTEGER, currency TEXT, revenue_share_bps INTEGER,
      token_split_bps INTEGER, starts_on TEXT, renews_on TEXT, suspended_at TEXT,
      terminated_at TEXT, status_note TEXT, updated_at TEXT, kind TEXT NOT NULL DEFAULT 'subsidiary',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE, admin_role TEXT NOT NULL DEFAULT 'principal',
      granted_by_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, country_code TEXT);
    CREATE TABLE licence_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, seat_type TEXT, seats_licensed INTEGER);
    CREATE TABLE licence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, event TEXT,
      detail_json TEXT, note TEXT, actor_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(ddl('280_licence_domains.sql', 'licence_domains'));
  if (opts.deployments !== false) db.exec(ddl('258_licence_deployments.sql', 'licence_deployments'));

  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(HOLDER, 'admin', 'Hana', 'hana@axal.example');
  u.run(OTHER, 'admin', 'Otto', 'otto@axal.example');
  u.run(NOBODY, 'admin', 'Nia', 'nia@axal.example');
  for (const id of [HOLDER, OTHER, NOBODY]) {
    db.prepare(
      `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
       VALUES (?, ?, 'totp', 'totp', datetime('now'))`,
    ).run(id, `totp-${id}`);
  }
  const lic = db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status)
     VALUES (?,?,?,?, 'active')`,
  );
  lic.run(LIC, 'AXL-001', 'Axal VC France SAS', 'Axal VC France');
  lic.run(LIC2, 'AXL-002', 'Nordics Holdings AB', 'Axal VC Nordics');
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(HOLDER);
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (2, ?, 'principal')").run(OTHER);
  return db;
}

/** A deployment row as admin_deployments.ts's INSERT writes it, at one status. */
function deploy(db: any, uid: string, code: string, status: string, note: string | null = null) {
  db.prepare(
    `INSERT INTO licence_deployments
       (licence_uid, code, hostname, worker_name, d1_name, status, status_note, requested_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-01 10:00:00', '2026-09-02 11:00:00')`,
  ).run(uid, code, `${code}.axal.vc`, `studioos-${code}`, `studioos-${code}`, status, note);
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: makeD1(db) });

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function mine(db: any, who = HOLDER) {
  const res = await app.request('/licence/mine', {
    method: 'GET', headers: { Authorization: `Bearer ${await token(who)}` },
  }, env(db));
  let out: any = null;
  try { out = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: out };
}

/* ── the rule ─────────────────────────────────────────────────────────── */

test('live is linked, the last step, and nothing else — failed least of all', () => {
  assert.equal(DEPLOYMENT_LIVE_STATUS, 'linked');
  assert.equal(deploymentIsLive('linked'), true);
  for (const s of ['requested', 'database_created', 'schema_applied', 'secrets_present', 'principal_seeded',
    'worker_live', 'hostname_active', 'failed', '', null, undefined]) {
    assert.equal(deploymentIsLive(s), false, `${String(s)} counted as live`);
  }
});

/* ── the field on /mine ───────────────────────────────────────────────── */

test('a requested deployment answers requested and not live, with no time on it', async () => {
  const db = freshDb();
  deploy(db, LIC, 'fr', 'requested');
  const r = await mine(db);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.deployment, {
    readable: true, requested: true, live: false, code: 'fr', hostname: 'fr.axal.vc', status: 'requested', status_note: null,
  });
  // The row carries requested_at and updated_at; the field carries neither,
  // nor any other time, because none of them is a step's.
  for (const k of Object.keys(r.body.deployment)) assert.doesNotMatch(k, /_at$/, `${k} is a time on the field`);
  assert.ok(r.body.licence && r.body.licence.brand_name === 'Axal VC France', 'the rest of the payload is unchanged');
});

test('"not requested" is the absence of a row, never a stored value', async () => {
  const db = freshDb();
  const none = await mine(db);
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.deployment, { readable: true, requested: false, live: false });
  // A row that happens to carry the words is still a request that exists.
  deploy(db, LIC, 'fr', 'not_requested');
  const odd = await mine(db);
  assert.equal(odd.body.deployment.requested, true, 'a stored status read as "not requested"');
  assert.equal(odd.body.deployment.live, false);
  // Another licence's row is not this licence's.
  const db2 = freshDb();
  deploy(db2, LIC2, 'no', 'linked');
  assert.deepEqual((await mine(db2)).body.deployment, { readable: true, requested: false, live: false });
  assert.equal((await mine(db2, OTHER)).body.deployment.live, true);
});

test('the field is live only at linked; every earlier step and failed are not', async () => {
  for (const status of ['database_created', 'schema_applied', 'secrets_present', 'principal_seeded', 'worker_live', 'hostname_active']) {
    const db = freshDb();
    deploy(db, LIC, 'fr', status);
    const d = (await mine(db)).body.deployment;
    assert.equal(d.live, false, `${status} answered live`);
    assert.equal(d.status, status);
  }
  const live = freshDb();
  deploy(live, LIC, 'fr', 'linked');
  assert.equal((await mine(live)).body.deployment.live, true);
  const failed = freshDb();
  deploy(failed, LIC, 'fr', 'failed', 'GITHUB_ACCESS_TOKEN is not set on this Worker.');
  const f = (await mine(failed)).body.deployment;
  assert.equal(f.live, false, 'failed answered live');
  assert.equal(f.status, 'failed');
  assert.equal(f.status_note, 'GITHUB_ACCESS_TOKEN is not set on this Worker.');
});

test('a read that fails answers unreadable with a reason, and the licence still answers 200', async () => {
  const db = freshDb({ deployments: false });
  const r = await mine(db);
  assert.equal(r.status, 200, 'the deployment read took the whole payload down with it');
  assert.equal(r.body.deployment.readable, false);
  assert.match(String(r.body.deployment.reason), /could not be read/);
  assert.equal(r.body.deployment.requested, undefined, 'an unreadable read claimed a request state');
  assert.equal(r.body.deployment.live, undefined, 'an unreadable read claimed liveness');
  assert.equal(r.body.licence.brand_name, 'Axal VC France');
  // The helper on its own says the same.
  const direct = await deploymentField(env(db) as any, LIC);
  assert.equal(direct.readable, false);
});

test('an admin who administers no licence still gets the 404, with no deployment', async () => {
  const db = freshDb();
  const r = await mine(db, NOBODY);
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'no_licence');
  assert.equal(r.body.deployment, undefined);
});
