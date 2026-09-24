/**
 * D229 — `network_profiles.kind` is validated the same way on create and
 * update.
 *
 * POST used to silently rewrite an unrecognized or garbage `kind` to
 * 'mentor' (`sanitizeKind(body.kind) || 'mentor'`), so a client typo or a
 * retired value read back as if the operator had deliberately chosen
 * 'mentor' — a silently rewritten field reading as stored. PUT already
 * refused the same input with 400 `invalid_kind`. POST now matches PUT: an
 * explicitly-given, unrecognized kind is refused; only a genuinely omitted
 * kind gets a default, and that default is 'advisor' — the role's current
 * name — not the retired 'mentor'.
 *
 * Driven against the real Hono route (`admin_network_profiles.ts`) and real
 * `node:sqlite` (schema from `schema_baseline.sql`), with a minted admin JWT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import networkProfiles from '../src/routes/admin_network_profiles.ts';
import { fillAxalSpinoutDemoDay } from '../src/services/decks/axalSpinoutDemoDay.ts';
import { displayNetworkKind } from '../src/services/networkProfilesSchema.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN_ID = 900;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(ddl('users'));
  db.exec(ddl('network_profiles'));
  db.prepare(
    `INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Holder', 'holder@example.test', 1)`,
  ).run(ADMIN_ID);
  return db;
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x; return api; },
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

async function adminToken(): Promise<string> {
  return new SignJWT({ user_id: ADMIN_ID, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: InstanceType<typeof DatabaseSync>, path: string, init: RequestInit = {}) {
  const jwt = await adminToken();
  const res = await networkProfiles.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body };
}

test('POST: an explicitly unrecognized kind is refused, the same as PUT — not silently stored as mentor', async () => {
  const db = freshDb();
  const { status, body } = await call(db, '/', {
    method: 'POST',
    body: JSON.stringify({ name: 'Ada', kind: 'wizard' }),
  });
  assert.equal(status, 400);
  assert.equal(body.error, 'invalid_kind');
  const rows = db.prepare('SELECT * FROM network_profiles').all();
  assert.deepEqual(rows, [], 'a refused create must not insert a row');
});

test('POST: an omitted kind defaults to advisor, not the retired mentor', async () => {
  const db = freshDb();
  const { status, body } = await call(db, '/', {
    method: 'POST',
    body: JSON.stringify({ name: 'Bea' }),
  });
  assert.equal(status, 201);
  const row: any = db.prepare('SELECT kind FROM network_profiles WHERE id = ?').get(body.id);
  assert.equal(row.kind, 'advisor');
});

test('POST: an explicitly valid kind is stored as given', async () => {
  const db = freshDb();
  const { status, body } = await call(db, '/', {
    method: 'POST',
    body: JSON.stringify({ name: 'Cass', kind: 'investor' }),
  });
  assert.equal(status, 201);
  const row: any = db.prepare('SELECT kind FROM network_profiles WHERE id = ?').get(body.id);
  assert.equal(row.kind, 'investor');
});

test('POST: a blank-string kind is treated as omitted, not as an unrecognized value', async () => {
  const db = freshDb();
  const { status, body } = await call(db, '/', {
    method: 'POST',
    body: JSON.stringify({ name: 'Dee', kind: '   ' }),
  });
  assert.equal(status, 201, 'a blank kind is an omission, not a client error');
  const row: any = db.prepare('SELECT kind FROM network_profiles WHERE id = ?').get(body.id);
  assert.equal(row.kind, 'advisor');
});

test('PUT: an unrecognized kind is still refused (unchanged behavior, held as the reference)', async () => {
  const db = freshDb();
  db.prepare(
    `INSERT INTO network_profiles (id, name, kind, display_order, is_active) VALUES (1, 'Existing', 'advisor', 0, 1)`,
  ).run();
  const { status, body } = await call(db, '/1', {
    method: 'PUT',
    body: JSON.stringify({ kind: 'wizard' }),
  });
  assert.equal(status, 400);
  assert.equal(body.error, 'invalid_kind');
  const row: any = db.prepare('SELECT kind FROM network_profiles WHERE id = 1').get();
  assert.equal(row.kind, 'advisor', 'a refused update must not change the stored kind');
});

test('displayNetworkKind: mentor reads as advisor; every other kind reads as itself', () => {
  assert.equal(displayNetworkKind('mentor'), 'advisor');
  assert.equal(displayNetworkKind('advisor'), 'advisor');
  assert.equal(displayNetworkKind('partner'), 'partner');
  assert.equal(displayNetworkKind('investor'), 'investor');
  assert.equal(displayNetworkKind('garbage'), 'advisor', 'an unrecognized kind falls back to the default, not through');
});

test('the deck shows a legacy "mentor" row as Advisor, without rewriting the stored value', async () => {
  const project = { id: 1, founder_id: 1, name: 'Test Co', sector: 'B2B SaaS' };
  const user = {
    id: 1, name: 'Founder', display_name: 'Founder', email: 'f@test.co',
    spinout_lab_active: 1, spinout_lab_week: 4, spinout_lab_started_at: null,
  };
  const profileRow = {
    id: 1, name: 'Legacy Row', kind: 'mentor', role: 'Ops', company: '', bio: '',
    linkedin_url: null, photo_r2_key: null, skills_json: '[]',
  };
  const resolve2 = (sql: string) => {
    const s = sql.toLowerCase();
    if (s.includes('from network_profiles')) {
      return { first: async () => profileRow, all: async () => ({ results: [profileRow] }) };
    }
    if (s.includes('from projects')) return { first: async () => project, all: async () => ({ results: [project] }) };
    if (s.includes('from users')) return { first: async () => user, all: async () => ({ results: [user] }) };
    return { first: async () => null, all: async () => ({ results: [] }) };
  };
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (..._args: any[]) => ({
            first: () => resolve2(sql).first(),
            all: () => resolve2(sql).all(),
            run: async () => ({ success: true }),
          }),
          first: () => resolve2(sql).first(),
          all: () => resolve2(sql).all(),
          run: async () => ({ success: true }),
        };
      },
      batch: async (_stmts: any[]) => [],
      exec: async (_sql: string) => ({ count: 0, duration: 0 }),
    },
  } as any;
  const data = await fillAxalSpinoutDemoDay(env, 1, 1);
  assert.equal(data.mentor_network.profiles[0]?.kind, 'advisor', 'a legacy mentor row must display as advisor');
  assert.deepEqual(
    data.mentor_network.network,
    [{ category: 'Advisors', count: 1 }],
    'the network breakdown must bucket a legacy mentor row under Advisors, not Mentors',
  );
});
