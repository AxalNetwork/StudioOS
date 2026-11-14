/**
 * The counterpart's role travels with the relationship row.
 *
 * `GET /partnernet/relationships` returned the counterpart's id, email and
 * name and nothing else — so the investor Network desk's `Founders` chip had
 * nothing to narrow on and sat disabled with a reason that named the missing
 * column. The route now selects `users.role` for both sides of the tie and
 * returns it as `other.role`.
 *
 * Pinned against the real route (the Hono app, a signed JWT, in-memory
 * SQLite), both ways round: the counterpart is the B side of one row and the
 * A side of another, and both must carry their role.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import partnernet from '../src/routes/partnernet.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const INVESTOR = 42;
// Ids chosen so the investor is the B side of one tie and the A side of the
// other — `partner_relationships` stores a pair low-id first, and the route's
// `partner_a_id === user.id` branch has to be exercised both ways.
const FOUNDER = 30;
const ADVISOR = 51;

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
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
    -- The canonical shape from partnernet.ts's ensureSchema, declared here so
    -- the fixture does not depend on the route's bootstrap having run first.
    CREATE TABLE partner_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_a_id INTEGER NOT NULL,
      partner_b_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL,
      strength_score REAL DEFAULT 50,
      metadata TEXT DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CHECK (partner_a_id < partner_b_id),
      CHECK (strength_score >= 0 AND strength_score <= 100)
    );
    CREATE TABLE company_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, company_name TEXT NOT NULL);
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      role_in_company TEXT NOT NULL DEFAULT 'Member', is_primary_admin INTEGER NOT NULL DEFAULT 0
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(INVESTOR, 'investor', 'Ingrid Investor', 'investor@example.test');
  u.run(FOUNDER, 'founder', 'Fred Founder', 'founder@example.test');
  u.run(ADVISOR, 'advisor', 'Ada Advisor', 'advisor@example.test');
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function relationships(db: any): Promise<any[]> {
  const headers = { Authorization: `Bearer ${await token(INVESTOR, 'investor')}` };
  const res = await partnernet.request('/relationships', { headers }, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  assert.equal(res.status, 200);
  return (await res.json()) as any[];
}

test('the counterpart role is returned on both sides of the pair ordering', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type, strength_score, metadata)
              VALUES (?, ?, 'co_investor', 60, '{}')`).run(FOUNDER, INVESTOR);
  db.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type, strength_score, metadata)
              VALUES (?, ?, 'advisor_mentee', 70, '{}')`).run(INVESTOR, ADVISOR);

  const rows = await relationships(db);
  assert.equal(rows.length, 2);
  const founder = rows.find((r) => r.other.id === FOUNDER);
  const advisor = rows.find((r) => r.other.id === ADVISOR);
  assert.equal(founder?.other.role, 'founder', 'the A-side counterpart carries its role');
  assert.equal(advisor?.other.role, 'advisor', 'the B-side counterpart carries its role');
  // And the fields the row already carried are not displaced.
  assert.equal(founder?.other.name, 'Fred Founder');
  assert.equal(advisor?.other.email, 'advisor@example.test');
});

test('a counterpart whose user row is gone carries no role rather than a wrong one', async () => {
  const db = freshDb();
  // The LEFT JOINs miss: no user row for id 999. The row still lists — the
  // tie exists — with the counterpart's facts null rather than invented.
  db.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type, strength_score, metadata)
              VALUES (?, ?, 'strategic_alliance', 40, '{}')`).run(INVESTOR, 999);
  const rows = await relationships(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].other.id, 999);
  assert.equal(rows[0].other.role, null);
});

test('D572 part 3: each party\'s own company, read from their account at query time, both ways round', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type, strength_score, metadata)
              VALUES (?, ?, 'co_investor', 60, '{}')`).run(FOUNDER, INVESTOR);
  db.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type, strength_score, metadata)
              VALUES (?, ?, 'advisor_mentee', 70, '{}')`).run(INVESTOR, ADVISOR);
  const co = db.prepare('INSERT INTO company_profiles (company_name) VALUES (?)');
  const link = db.prepare('INSERT INTO user_company_links (company_id, user_id, is_primary_admin) VALUES (?, ?, ?)');
  co.run('Side Project'); co.run('Fred Robotics'); co.run('Ingrid Capital');
  link.run(1, FOUNDER, 0);   // an older link the founder does not run
  link.run(2, FOUNDER, 1);   // the one they are primary admin of wins
  link.run(3, INVESTOR, 0);  // the only link: it is the investor's company

  let rows = await relationships(db);
  const founder = rows.find((r) => r.other.id === FOUNDER);
  const advisor = rows.find((r) => r.other.id === ADVISOR);
  assert.equal(founder?.other.company, 'Fred Robotics', 'the A-side counterpart carries their primary company');
  assert.equal(advisor?.other.company, null, 'a counterpart with no company reads as not recorded, never as mine');
  assert.equal(founder?.my_company, 'Ingrid Capital', 'my own company, from the A side');
  assert.equal(advisor?.my_company, 'Ingrid Capital', 'my own company, from the B side');
  assert.ok(!('a_company' in founder) && !('b_company' in founder), 'the raw per-side columns leaked');

  // Read at query time: a rename shows on the next read, with nothing stored on the tie.
  db.prepare(`UPDATE company_profiles SET company_name = 'Fred Robotics Inc.' WHERE id = 2`).run();
  rows = await relationships(db);
  assert.equal(rows.find((r) => r.other.id === FOUNDER)?.other.company, 'Fred Robotics Inc.');
});

test('D572 part 3: a company read that fails is said as unreadable, and the book still lists', async () => {
  const db = freshDb();
  db.exec('DROP TABLE company_profiles');
  db.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type, strength_score, metadata)
              VALUES (?, ?, 'co_investor', 60, '{}')`).run(FOUNDER, INVESTOR);
  const w = console.warn; console.warn = () => {};
  try {
    const rows = await relationships(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].companies_unreadable, true);
    assert.equal(rows[0].other.company, null);
  } finally { console.warn = w; }
});
