/**
 * D4707 (#4707) — licence history that names who did what, keeps what a write
 * replaced beside what it left, says how it ended, and pages instead of
 * stopping at a fixed cap.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_history_d4707.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { licenceRevisionAlters } from './_licence_revisions.mjs';
import { Hono } from 'hono';

import licences, { EVENTS_PAGE_MAX } from '../src/routes/admin_licences.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const LIC = 'lic_d4707';

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
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
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

const app = new Hono<any>();
app.route('/admin/licences', licences);
app.onError((err: any, c) => c.json({ detail: String(err?.message) }, String(err?.message) === 'Unauthorized' ? 401 : 403));

/** Migration 187's licence_events, then the real D4707 migration over it. */
function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const mig = (f: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${f}`), 'utf8');
  const m187 = mig('187_territory_licences.sql');
  const at = m187.indexOf('CREATE TABLE IF NOT EXISTS licence_events');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    -- D4694: a terms save is a money write, so it takes the TOTP session and step-up bar.
    CREATE TABLE user_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT,
      assurance_level TEXT, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT, last_step_up_at TEXT,
      created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT,
      user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER, action TEXT,
      viewed_user_id INTEGER, filters_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, licence_ref TEXT, entity_id INTEGER,
      legal_entity_name TEXT, brand_name TEXT, registered_address TEXT, signatory_name TEXT, signatory_title TEXT,
      status TEXT NOT NULL DEFAULT 'draft', term_years INTEGER, annual_fee_cents INTEGER, currency TEXT,
      revenue_share_bps INTEGER, token_split_bps INTEGER, starts_on TEXT, renews_on TEXT, suspended_at TEXT,
      terminated_at TEXT, status_note TEXT, updated_at TEXT, kind TEXT NOT NULL DEFAULT 'subsidiary',
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, country_code TEXT UNIQUE,
      created_at TEXT);
    CREATE TABLE licence_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, seat_type TEXT,
      seats_licensed INTEGER, created_at TEXT);
    CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT UNIQUE, code TEXT,
      hostname TEXT, status TEXT);
  `);
  db.exec(m187.slice(at, m187.indexOf(');', at) + 2));
  db.exec(licenceRevisionAlters('territory_licences'));
  db.exec(mig('202611062240_licence_event_changes.sql'));
  // Migration 269's seal: an event row can never be updated, so the outcome
  // has to be known when the row is written.
  const m269 = mig('269_audit_immutability.sql');
  for (const name of ['licence_events_block_update', 'licence_events_block_delete']) {
    const at = m269.indexOf(`CREATE TRIGGER IF NOT EXISTS ${name}`);
    db.exec(m269.slice(at, m269.indexOf('END;', at) + 4));
  }
  db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, 'admin', 'Sue', 'sue@axal.example')").run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, 'totp-1', 'totp', 'totp', datetime('now'))").run(SUPER);
  db.prepare(`INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status, term_years,
      annual_fee_cents, currency, renews_on) VALUES (?, 'AXL-047', 'Axal VC France SAS', 'Axal VC France', 'draft', 3, 1000000, 'EUR', '2027-01-01')`).run(LIC);
  db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (1, 'FR')").run();
  db.prepare("INSERT INTO licence_seats (licence_id, seat_type, seats_licensed) VALUES (1, 'founder', 5)").run();
  return db;
}

const env = (db: any) => ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: makeD1(db) });
async function call(db: any, path: string, method = 'GET', body?: unknown) {
  const tok = await new SignJWT({ user_id: SUPER, role: 'admin', jti: 'totp-1' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/admin/licences/${LIC}${path}`, {
    method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env(db));
  return { status: res.status, body: await res.json() as any };
}

test('a write records what it replaced beside what it left, and who made it', async () => {
  const db = freshDb();
  assert.equal((await call(db, '/territories', 'PUT', { countries: ['BE', 'FR'] })).status, 200);
  assert.equal((await call(db, '/seats', 'PUT', { seats: { founder: 8 } })).status, 200);
  assert.equal((await call(db, '/terms', 'PATCH', { term_years: 5, annual_fee_cents: 1200000, currency: 'EUR', reason: 'Renegotiated at the annual review', expected_revision: 0 })).status, 200);
  const r = await call(db, '/events');
  assert.equal(r.status, 200);
  const [terms, seats, territory] = r.body.items;
  assert.equal(territory.event, 'territory_changed');
  assert.deepEqual(territory.change, { recorded: true, before: { countries: ['FR'] }, after: { countries: ['BE', 'FR'] } });
  assert.equal(seats.change.before.founder, 5);
  assert.equal(seats.change.after.founder, 8);
  assert.equal(terms.change.before.term_years, 3);
  assert.equal(terms.change.after.term_years, 5);
  assert.equal(terms.change.before.annual_fee_cents, 1000000);
  assert.deepEqual(terms.actor, { state: 'known', id: SUPER, name: 'Sue' });
  assert.equal(terms.outcome, 'committed', 'no branch to push to: HQ\'s write is the whole write');
});

test('a write whose branch push did not land reads PARTIAL', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO licence_deployments (licence_uid, code, hostname, status) VALUES (?, 'fr', 'fr.axal.vc', 'linked')").run(LIC);
  assert.equal((await call(db, '/seats', 'PUT', { seats: { founder: 9 } })).status, 200);
  const [row] = (await call(db, '/events')).body.items;
  assert.equal(row.outcome, 'partial', 'HQ holds the change; the branch with no binding does not');
});

test('a status move records the status it left', async () => {
  const db = freshDb();
  db.exec("UPDATE territory_licences SET status = 'active'");
  assert.equal((await call(db, '/suspend', 'POST', { note: 'Fees unpaid since September.' })).status, 200);
  const [row] = (await call(db, '/events')).body.items;
  assert.deepEqual(row.change, { recorded: true, before: { status: 'active' }, after: { status: 'suspended' } });
  assert.equal(row.note, 'Fees unpaid since September.');
});

test('a row from before D4707 says Not recorded, never an empty change; a deleted actor is unknown, not nobody', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO licence_events (licence_id, event, detail_json, actor_user_id) VALUES (1, 'seats_changed', '{\"founder\":5}', 99)").run();
  db.prepare("INSERT INTO licence_events (licence_id, event) VALUES (1, 'created')").run();
  db.prepare("INSERT INTO licence_events (licence_id, event, before_json, after_json) VALUES (1, 'renewed', '{bad', '{}')").run();
  const [broken, created, legacy] = (await call(db, '/events')).body.items;
  assert.deepEqual(legacy.change, { recorded: false });
  assert.equal(legacy.outcome, null);
  assert.deepEqual(legacy.actor, { state: 'unknown', id: 99 });
  assert.deepEqual(legacy.detail, { founder: 5 });
  assert.deepEqual(created.actor, { state: 'none' });
  assert.deepEqual(broken.change, { recorded: true, readable: false }, 'unreadable is its own state');
});

test('history pages by id with no fixed cap: every row is reachable, none twice', async () => {
  const db = freshDb();
  const ins = db.prepare("INSERT INTO licence_events (licence_id, event, created_at) VALUES (1, 'renewed', '2026-01-01 00:00:00')");
  for (let i = 0; i < 250; i++) ins.run();
  const seen: number[] = [];
  let before: number | null = null;
  for (let pages = 0; pages < 10; pages++) {
    const r: any = await call(db, `/events?limit=100${before ? `&before=${before}` : ''}`);
    assert.equal(r.status, 200);
    seen.push(...r.body.items.map((x: any) => x.id));
    before = r.body.next_before;
    if (before === null) break;
  }
  assert.equal(seen.length, 250);
  assert.equal(new Set(seen).size, 250);
  assert.deepEqual(seen, [...seen].sort((a, b) => b - a), 'newest first');
  const big = await call(db, '/events?limit=5000');
  assert.equal(big.body.items.length, EVENTS_PAGE_MAX);
  assert.notEqual(big.body.next_before, null, 'a capped page says there is more');
  assert.equal((await call(db, '/events?before=abc')).status, 400);
});
