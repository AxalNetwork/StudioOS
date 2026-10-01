/**
 * D394 — the two Worker halves of Partner Home P2.
 *
 *   1. `GET /partner/delivery/board` gains `due_next_7_days` (and per row
 *      `milestones_due_7d`): open milestones due today or in the next six
 *      days, the Home's "Due this week" tile.
 *   2. `home/brief` joins `DRAFT_SURFACES`: the operating brief, drafted over
 *      the caller's OWN firm and nothing else.
 *
 * Harness: node:sqlite with the real migration files (208, 230–232), the
 * shape partner_delivery_routes.test.ts uses, and a stub AI that records the
 * prompt the model would have seen (founder_draft_surfaces.test.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import partnerDelivery from '../src/routes/partner_delivery.ts';
import research from '../src/routes/research.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const OURS = 60;       // partner_id 1
const THEIRS = 62;     // partner_id 2
const UNLINKED = 66;   // role partner, no firm
const FOUNDER = 64;
const OUR_ENG = 901;
const THEIR_ENG = 902;

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

const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, company TEXT, email TEXT UNIQUE NOT NULL,
      specialization TEXT, status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE founder_needs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      budget_min REAL, budget_max REAL, timeline TEXT, status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE engagements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, quote_id INTEGER NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL, price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      delivered_at TEXT, delivery_notes TEXT, cancelled_at TEXT, cancel_reason TEXT,
      invoice_id TEXT, invoiced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE research_zone_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      owner_user_id INTEGER NOT NULL, surface TEXT NOT NULL, scope_key TEXT,
      body TEXT NOT NULL, model TEXT, cost_micro_usd INTEGER NOT NULL DEFAULT 0,
      accepted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(migration('208_partner_delivery_stores'));
  db.exec(migration('230_partner_capacity'));
  db.exec(migration('231_partner_internal_hours'));
  db.exec(migration('232_partner_engagement_health'));

  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(OURS, 'partner', 1, 'Ours', 'ours@example.com');
  u.run(THEIRS, 'partner', 2, 'Theirs', 'theirs@example.com');
  u.run(UNLINKED, 'partner', null, 'Nobody', 'nobody@example.com');
  u.run(FOUNDER, 'founder', null, 'Verwood', 'fran@example.com');
  db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)').run(1, 'p-1', 'Ours', 'ours@example.com');
  db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)').run(2, 'p-2', 'Theirs', 'theirs@example.com');
  const n = db.prepare('INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES (?,?,?,?,?,?,?)');
  n.run(501, 'need-1', 9, FOUNDER, 'engineering', 'Payments migration', 'x');
  n.run(502, 'need-2', 9, FOUNDER, 'design', 'Their brand refresh', 'y');
  const e = db.prepare(`INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
                        VALUES (?,?,?,?,?,?,?,?)`);
  e.run(OUR_ENG, 'e-ours', 501, 601, 1, FOUNDER, 9, 42000);
  e.run(THEIR_ENG, 'e-theirs', 502, 602, 2, FOUNDER, 9, 15000);
  return db;
}

function milestone(db: any, eng: number, dueAt: string | null, done = false) {
  db.prepare(`INSERT INTO engagement_milestones (uid, engagement_id, title, due_at, completed_at) VALUES (?,?,?,?,?)`)
    .run(`m-${Math.random().toString(36).slice(2)}`, eng, 'Milestone', dueAt, done ? new Date().toISOString() : null);
}

async function token(userId: number, role: string) {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function board(db: any, userId: number) {
  const res = await partnerDelivery.request('/board', {
    headers: { Authorization: `Bearer ${await token(userId, 'partner')}` },
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

async function brief(db: any, userId: number): Promise<{ status: number; prompt: string | null }> {
  let prompt: string | null = null;
  const AI = {
    run: async (_model: string, payload: any) => {
      const messages = payload?.messages || [];
      prompt = String(messages[messages.length - 1]?.content ?? '');
      return { response: 'a drafted paragraph' };
    },
  };
  const res = await research.fetch(new Request('http://x/drafts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(userId, 'partner')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ surface: 'home/brief' }),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), AI } as any);
  return { status: res.status, prompt };
}

// ── Due this week ───────────────────────────────────────────────────────────

test('D394: due this week counts open milestones due today through six days out, and nothing else', async () => {
  const db = freshDb();
  milestone(db, OUR_ENG, day(0));          // today — counts
  milestone(db, OUR_ENG, day(6));          // sixth day — counts
  milestone(db, OUR_ENG, day(7));          // a week out — does not
  milestone(db, OUR_ENG, day(-1));         // overdue — not "due this week"
  milestone(db, OUR_ENG, day(2), true);    // done — does not
  milestone(db, OUR_ENG, null);            // undated — does not
  milestone(db, THEIR_ENG, day(1));        // another firm's — never
  const r = await board(db, OURS);
  assert.equal(r.status, 200);
  assert.equal(r.body.due_next_7_days, 2);
  const row = r.body.items.find((i: any) => i.engagement_id === OUR_ENG);
  assert.equal(row.milestones_due_7d, 2);
  assert.ok(!r.body.items.some((i: any) => i.engagement_id === THEIR_ENG), 'another firm\'s engagement never comes back');
});

test('D394: an empty board counts zero due, because it read the milestones and found none', async () => {
  const r = await board(freshDb(), OURS);
  assert.equal(r.body.due_next_7_days, 0);
});

// ── The operating brief ─────────────────────────────────────────────────────

test('D394: home/brief is a known surface, drafted over the caller\'s own firm only', async () => {
  const db = freshDb();
  milestone(db, OUR_ENG, day(2));
  milestone(db, THEIR_ENG, day(2));
  const r = await brief(db, OURS);
  assert.equal(r.status, 201);
  assert.ok(r.prompt, 'the model was reached');
  assert.match(r.prompt!, /Payments migration/);
  assert.match(r.prompt!, /1 milestone\(s\) due in the next seven days/);
  assert.doesNotMatch(r.prompt!, /Their brand refresh/, 'another firm\'s engagement reached the prompt');
  assert.match(r.prompt!, /Do not tell the firm what to do/);
  assert.doesNotMatch(r.prompt!, /recommend/i);
});

test('D394: an engagement with nothing recorded is handed over as unrated, not healthy', async () => {
  const r = await brief(freshDb(), OURS);
  assert.equal(r.status, 201);
  assert.match(r.prompt!, /NOTHING RECORDED — unrated, not healthy/);
});

test('D394: a sign-in with no firm gets nothing_to_draft and the model is never reached', async () => {
  const r = await brief(freshDb(), UNLINKED);
  assert.equal(r.status, 409);
  assert.equal(r.prompt, null);
});

test('D394: an embedded seat is described as recorded by the firm, never as granted by the client', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO engagement_seats (uid, engagement_id, holder_user_id, scope) VALUES (?,?,?,?)`)
    .run('s-1', OUR_ENG, OURS, 'Board, KPIs');
  const r = await brief(db, OURS);
  assert.match(r.prompt!, /embedded seat, scope as recorded by the firm: Board, KPIs/);
  assert.doesNotMatch(r.prompt!, /granted by/i);
});
