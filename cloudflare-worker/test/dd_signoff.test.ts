/**
 * D466 — the DD sign-off: who returned the verdict, recorded at write
 * (migration 339's `dd_sections.signed_off_by`).
 *
 * The signer was derivable from `dd_reviewers.responded_at` when an ASSIGNED
 * reviewer returned the verdict, and absent entirely when an admin overrode —
 * no reviewer row, no signer. The column is stamped on every verdict write,
 * so both paths record alike, and the case read carries the signer's name. A
 * section completed before the column existed renders unrecorded, never a
 * guessed signer.
 *
 * Harness: the real router against in-memory SQLite with a signed JWT, the
 * app's onError mapping replicated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import dd from '../src/routes/dd.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  if (msg === 'Forbidden' || msg === 'Admin required') return c.json({ detail: msg }, 403);
  console.error('[test] unhandled:', err);
  return c.json({ detail: 'Internal server error' }, 500);
});
app.route('/api/dd', dd);

const REVIEWER = 60;
const ADMIN = 44;
const OWNER = 45;
const CASE = 'case-alpha';

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
    async batch(x: any[]) { return x; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, email TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER
    );
    CREATE TABLE dd_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      subject_label TEXT, subject_type TEXT, owner_user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'open', risk_score REAL, risk_band TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE dd_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL,
      section_key TEXT NOT NULL, title TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0,
      status TEXT NOT NULL DEFAULT 'pending', assignee_user_id INTEGER,
      verdict TEXT, reviewer_notes_enc TEXT, reviewer_signed_nda_at TEXT,
      completed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      signed_off_by INTEGER
    );
    CREATE TABLE dd_reviewers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL,
      section_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'reviewer', invited_at TEXT, responded_at TEXT,
      magic_link_jti TEXT, nda_signed_at TEXT,
      UNIQUE(section_id, user_id)
    );
    CREATE TABLE dd_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, section_id INTEGER,
      filename TEXT, mime_type TEXT, size_bytes INTEGER, uploaded_by_user_id INTEGER,
      created_at TEXT
    );
    CREATE TABLE dd_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL,
      section_id INTEGER, source_id INTEGER, source_kind TEXT, severity TEXT,
      title TEXT, evidence_url TEXT, detail_enc TEXT, subject_name_enc TEXT,
      evidence_excerpt_enc TEXT, resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE dd_checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL,
      section_id INTEGER, status TEXT, severity TEXT, note_enc TEXT
    );
    CREATE TABLE dd_external_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, connector TEXT,
      status TEXT, records_count INTEGER, findings_emitted INTEGER,
      error_message TEXT, started_at TEXT, completed_at TEXT
    );
    CREATE TABLE dd_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER,
      created_by_user_id INTEGER, created_at TEXT
    );
    CREATE TABLE dd_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER,
      actor_user_id INTEGER, actor_email_hash TEXT, action TEXT,
      target_type TEXT, target_id INTEGER, details_enc TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(REVIEWER, 'partner', 'Rae Reviewer', 'reviewer@example.test');
  u.run(ADMIN, 'admin', 'Ada Admin', 'admin@example.test');
  u.run(OWNER, 'partner', 'Owen Owner', 'owner@example.test');
  db.prepare(`INSERT INTO dd_cases (uid, subject_label, subject_type, owner_user_id) VALUES (?, 'Alpha', 'company', ?)`).run(CASE, OWNER);
  db.prepare(`INSERT INTO dd_sections (case_id, section_key, title, status) VALUES (1, 'team', 'Team', 'assigned')`).run();
  db.prepare(`INSERT INTO dd_sections (case_id, section_key, title, status) VALUES (1, 'legal', 'Legal', 'assigned')`).run();
  // Section 1 has an assigned reviewer; section 2 is the admin-override path.
  db.prepare('INSERT INTO dd_reviewers (case_id, section_id, user_id) VALUES (1, 1, ?)').run(REVIEWER);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  who: { user: number; role: string },
  path: string,
  init: { method?: string; body?: any } = {},
  db: InstanceType<typeof DatabaseSync> = freshDb(),
): Promise<{ status: number; body: any; db: InstanceType<typeof DatabaseSync> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    'Content-Type': 'application/json',
  };
  const res = await app.request(path, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  const body = await res.json().catch(() => null);
  return { status: res.status, body, db };
}

test('a reviewer’s verdict records the signer, and the case read carries their name', async () => {
  const db = freshDb();
  // The NDA artifact the non-admin path requires.
  db.prepare(`INSERT INTO dd_attachments (case_id, section_id, filename, uploaded_by_user_id) VALUES (1, 1, 'nda.pdf', ?)`).run(REVIEWER);
  const r = await call({ user: REVIEWER, role: 'partner' }, `/api/dd/cases/${CASE}/sections/1/verdict`, {
    method: 'POST', body: { verdict: 'pass' },
  }, db);
  assert.equal(r.status, 200);
  const row = db.prepare('SELECT signed_off_by FROM dd_sections WHERE id = 1').get() as any;
  assert.equal(row.signed_off_by, REVIEWER, 'the signer is who returned the verdict');

  const read = await call({ user: ADMIN, role: 'admin' }, `/api/dd/cases/${CASE}`, {}, db);
  const section = (read.body.sections || []).find((s: any) => s.id === 1);
  assert.equal(section?.signed_off_by_name, 'Rae Reviewer', 'the case read carries the signer’s name');
});

test('an admin override records the signer too — the gap the column closes', async () => {
  const db = freshDb();
  // Section 2 has NO reviewer row for the admin: the path that used to record
  // no signer.
  const r = await call({ user: ADMIN, role: 'admin' }, `/api/dd/cases/${CASE}/sections/2/verdict`, {
    method: 'POST', body: { verdict: 'warn' },
  }, db);
  assert.equal(r.status, 200);
  const row = db.prepare('SELECT signed_off_by FROM dd_sections WHERE id = 2').get() as any;
  assert.equal(row.signed_off_by, ADMIN, 'an admin override records the signer now');
});

test('a section completed before the column existed reads unrecorded, not a guessed signer', async () => {
  const db = freshDb();
  db.prepare(`UPDATE dd_sections SET status = 'completed', verdict = 'pass', completed_at = '2026-08-01' WHERE id = 1`).run();
  const read = await call({ user: ADMIN, role: 'admin' }, `/api/dd/cases/${CASE}`, {}, db);
  const section = (read.body.sections || []).find((s: any) => s.id === 1);
  assert.equal(section?.signed_off_by_name, null, 'no signer is recorded, and none is invented');
});
