/**
 * D451 — licence agreement leaves draft through createAndSendEnvelope.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminLicences from '../src/routes/admin_licences.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 7;
const SIGNER = 8;

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
    async batch(x: any[]) {
      const out: any[] = [];
      for (const st of x || []) out.push(await st.run());
      return out;
    },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT,
      assurance_level TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      licence_ref TEXT UNIQUE NOT NULL, entity_id INTEGER, legal_entity_name TEXT NOT NULL,
      brand_name TEXT NOT NULL, registered_address TEXT, signatory_name TEXT, signatory_title TEXT,
      status TEXT NOT NULL DEFAULT 'draft', term_years INTEGER, annual_fee_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'EUR', revenue_share_bps INTEGER, token_split_bps INTEGER,
      starts_on TEXT, renews_on TEXT, suspended_at TEXT, terminated_at TEXT, status_note TEXT,
      created_by_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      country_code TEXT NOT NULL UNIQUE);
    CREATE TABLE licence_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      seat_type TEXT NOT NULL, seats_licensed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE licence_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE, admin_role TEXT NOT NULL DEFAULT 'principal',
      created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE licence_events (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      event TEXT NOT NULL, detail_json TEXT, note TEXT, actor_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE licence_contracts (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      licence_uid TEXT NOT NULL, template_slug TEXT NOT NULL, template_version INTEGER NOT NULL,
      template_title TEXT NOT NULL, body_md TEXT NOT NULL, unfilled_fields TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft', envelope_uid TEXT, superseded_at TEXT,
      created_by_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT, signed_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE legal_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'gp', body_md TEXT NOT NULL DEFAULT '',
      merge_fields TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1, is_stub INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP, updated_at TIMESTAMP, created_by INTEGER, updated_by INTEGER);
    CREATE TABLE legal_template_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL,
      slug TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL,
      body_md TEXT NOT NULL, merge_fields TEXT NOT NULL DEFAULT '[]', created_at TIMESTAMP,
      created_by INTEGER, UNIQUE(template_id, version));
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT,
      user_id INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)').run(HOLDER, 'admin', 'Sue', 'sue@axal.example');
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)').run(SIGNER, 'admin', 'Marie', 'marie@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  db.prepare(
    `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
     VALUES (?, ?, 'totp', 'totp', datetime('now'))`,
  ).run(HOLDER, `totp-${HOLDER}`);
  db.prepare(
    `INSERT INTO territory_licences
       (id, uid, licence_ref, legal_entity_name, brand_name, signatory_name, signatory_title, status,
        term_years, annual_fee_cents, currency, revenue_share_bps, token_split_bps, starts_on, renews_on)
     VALUES (1,'lic_fr','AXL-001','Axal VC France SAS','Axal VC France','Marie Dubois','DG','active',
             5,9000000,'EUR',3500,3050,'2026-01-01','2027-01-01')`,
  ).run();
  db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (1, ?)').run('FR');
  db.prepare('INSERT INTO licence_seats (licence_id, seat_type, seats_licensed) VALUES (1, ?, 325)').run('founder');
  db.prepare('INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, ?)').run(SIGNER, 'principal');
  db.prepare(
    `INSERT INTO legal_templates (slug, title, category, body_md, version, is_active)
     VALUES ('licence_agreement','Territory licence agreement','gp',?,4,1)`,
  ).run('AGREEMENT for {{legal_entity_name}} in {{territory}} at {{annual_fee}}.');
  db.prepare(
    `INSERT INTO licence_contracts
       (uid, licence_uid, template_slug, template_version, template_title, body_md, unfilled_fields, status)
     VALUES ('ctr_1','lic_fr','licence_agreement',4,'Territory licence agreement',
             'AGREEMENT for Axal VC France SAS in FR at EUR 90,000.00.','[]','draft')`,
  ).run();
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/licences', adminLicences);
app.onError((err: any, c) => {
  const msg = String(err?.message || '');
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  return c.json({ detail: msg }, 403);
});

async function token(userId: number) {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: InstanceType<typeof DatabaseSync>, path: string, init: RequestInit = {}) {
  const env = {
    APP_URL: 'https://axal.vc', PUBLIC_BASE_URL: 'https://axal.vc',
    OAUTH_CALLBACK_BASE_URL: 'https://app.axal.vc', PUBLIC_MARKETING_URL: 'https://axal.vc',
    DB: makeD1(db), JWT_SECRET, ENVIRONMENT: 'development',
  };
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(HOLDER)}` };
  const res = await app.request(`/api/admin/licences${path}`, { ...init, headers }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('send writes envelope_uid and derives signed from a completed envelope', async () => {
  const db = freshDb();
  const sent = await call(db, '/lic_fr/contract/ctr_1/send', { method: 'POST' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.ok(sent.body.envelope_uuid);
  assert.equal(sent.body.status, 'sent');

  const row = db.prepare('SELECT envelope_uid, status, sent_at FROM licence_contracts WHERE uid = ?').get('ctr_1') as any;
  assert.equal(row.envelope_uid, sent.body.envelope_uuid);
  assert.equal(row.status, 'sent');
  assert.ok(row.sent_at);

  db.prepare(`UPDATE esign_envelopes SET status = 'completed', completed_at = datetime('now') WHERE envelope_uuid = ?`)
    .run(sent.body.envelope_uuid);

  const read = await call(db, '/lic_fr/contract', { method: 'GET' });
  assert.equal(read.status, 200);
  const current = read.body.contracts.find((c: any) => c.uid === 'ctr_1');
  assert.equal(current.status, 'signed');
  assert.equal(current.countersignature.recorded, false);
  assert.match(current.countersignature.reason, /Session 13/);
});

test('migration 331 widens licence_events for contract_sent', () => {
  const sql = readFileSync(
    resolve(REPO_ROOT, 'cloudflare-worker/sql/migrations/331_licence_event_contract_sent.sql'),
    'utf8',
  );
  assert.match(sql, /'contract_sent'/);
});
