/**
 * The e-sign route on real SQLite, shared by the D410 and D411 tests.
 *
 * Real SQLite for the reason `_d1_sqlite.mjs` gives: the route's own
 * predicates, with their own binds, decide which rows exist, so a regression
 * in a scope or a key fails because the wrong rows appear. The batch runs in a
 * transaction because D1's does, and void (D411) depends on that.
 *
 * Not a test file (the leading underscore keeps it out of the glob).
 */
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import esign from '../src/routes/esign.ts';

export const app = new Hono<any>();
app.route('/', esign);
app.onError((err: any, c) => {
  if (String(err?.message || '') === 'Unauthorized') return c.json({ detail: 'Unauthorized' }, 401);
  throw err;
});

export const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
export const SENDER = 1;        // a founder who sends
export const OTHER_SENDER = 2;  // a second founder, a different tenant
export const RECIPIENT = 3;     // an investor with an account
export const STRANGER = 4;      // signed in, nothing to do with any envelope
export const ADMIN = 5;
export const EXPLORER = 6;  // an exploring account: /legal/send turns this role away

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
export function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const stmt = (sql: string) => {
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
  };
  return {
    prepare: stmt,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // D1 runs a batch as one transaction; so does this.
    async batch(x: any[]) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const st of x || []) out.push(await st.run());
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

export function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      founder_id INTEGER, partner_id INTEGER,
      founder_public_id TEXT, partner_public_id TEXT,
      access_level TEXT, kyc_status TEXT
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, role, email, name) VALUES
      (${SENDER},       'founder',  'sender@example.test',   'Sam Sender'),
      (${OTHER_SENDER}, 'founder',  'other@example.test',    'Olu Other'),
      (${RECIPIENT},    'investor', 'Investor@Example.test', 'Ivy Investor'),
      (${STRANGER},     'founder',  'stranger@example.test', 'Stu Stranger'),
      (${ADMIN},        'admin',    'admin@example.test',    'Ada Admin'),
      (${EXPLORER},     'exploring','explorer@example.test', 'Eli Explorer');
  `);
  return db;
}

// A private R2 stand-in: puts are kept, gets return what was put (or a
// placeholder PDF for a key a test seeded directly into D1).
export function fakeR2() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key: string, bytes: Uint8Array) { objects.set(key, bytes); },
    async get(key: string) {
      const bytes = objects.get(key) ?? new TextEncoder().encode('%PDF-1.4 placeholder');
      return { arrayBuffer: async () => bytes.slice().buffer };
    },
  };
}

export const envFor = (db: InstanceType<typeof DatabaseSync>, files = fakeR2(), extra: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test', DB: makeD1(db), FILES: files, ...extra });

export async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

export const ROLE: Record<number, string> = {
  [SENDER]: 'founder', [OTHER_SENDER]: 'founder', [RECIPIENT]: 'investor', [STRANGER]: 'founder', [ADMIN]: 'admin',
  [EXPLORER]: 'exploring',
};

export async function call(e: any, method: string, path: string, who: number | null, body?: any, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extraHeaders };
  if (who) headers.Authorization = `Bearer ${await token(who, ROLE[who])}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await app.request(path, init, e);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

