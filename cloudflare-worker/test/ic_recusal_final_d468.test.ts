/**
 * D468 — a recusal is final.
 *
 * `POST /api/ic/:uid/vote` upserted, so a member who recused could later vote
 * yes, no or abstain on the same decision (or re-recuse with a different
 * declaration) and the recusal disappeared. Once recused, a later vote is now
 * refused with `409 recusal_is_final`, and the stored vote, its declaration
 * and the tally stay as they were. Voting first and recusing later is still
 * allowed, and so is an ordinary change of vote.
 *
 * The REAL `ic` router against real SQLite; the fixture is
 * ic_conditions_minutes.test.ts's, with a switch for a driver that does not
 * report `meta.changes`.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ic_recusal_final_d468.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import ic from '../src/routes/ic.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const AUTHOR = 10;
const COLLEAGUE = 11;
const ADMIN = 12;
const CO = 21;
const PROJ = 7;
const DEAL = 71;
const DEC = 'dec-alpha';
const MTG = 'mtg-alpha';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>, opts: { noChanges?: boolean; afterPriorRead?: (() => void) | null } = {}) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() {
          const row = db.prepare(sql).get(...b) ?? null;
          // A competing request that commits between the vote route's read of
          // the prior vote and its write.
          if (opts.afterPriorRead && /^SELECT vote FROM ic_votes/.test(sql)) { const h = opts.afterPriorRead; opts.afterPriorRead = null; h(); }
          return row;
        },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return opts.noChanges
            ? { meta: { last_row_id: Number(r.lastInsertRowid) } }
            : { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
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
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT,
      investor_seat_primary_user_id INTEGER, investor_tier TEXT,
      investor_subscription_status TEXT, subscription_tier TEXT, partner_id INTEGER
    );
    CREATE TABLE user_company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, is_primary_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, uid TEXT, name TEXT, sector TEXT, stage TEXT,
      status TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE deals (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER);
    CREATE TABLE ic_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      project_id INTEGER, deal_id INTEGER, title TEXT NOT NULL, memo TEXT,
      terms_json TEXT, status TEXT NOT NULL DEFAULT 'draft', decision TEXT,
      outcome TEXT, created_by INTEGER, decided_at TEXT, dd_case_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      company_id INTEGER
    );
    CREATE TABLE ic_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ic_decision_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, vote TEXT NOT NULL, rationale TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ic_decision_id, user_id)
    );
    CREATE TABLE decision_journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, owner_user_id INTEGER,
      project_id INTEGER, deal_id INTEGER, ic_decision_id INTEGER,
      decision TEXT, conviction TEXT, thesis TEXT, outcome_status TEXT,
      decided_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE ic_conditions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      ic_decision_id INTEGER NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT, resolved_by INTEGER
    );
    CREATE TABLE ic_meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, agenda TEXT, start_at TEXT NOT NULL,
      duration_min INTEGER NOT NULL DEFAULT 60, deal_id INTEGER,
      organizer_user_id INTEGER NOT NULL, location_kind TEXT NOT NULL DEFAULT 'video',
      location_uri TEXT, status TEXT NOT NULL DEFAULT 'scheduled',
      cancelled_at TEXT, cancel_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      minutes TEXT, minutes_recorded_by INTEGER, minutes_recorded_at TEXT
    );
    CREATE TABLE ic_meeting_attendees (
      id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, rsvp TEXT NOT NULL DEFAULT 'invited',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(meeting_id, user_id)
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)');
  u.run(AUTHOR, 'investor', 'Ann Author');
  u.run(COLLEAGUE, 'investor', 'Col Colleague');
  u.run(ADMIN, 'admin', 'Ada Admin');
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(CO, AUTHOR);
  db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (?, ?)').run(CO, COLLEAGUE);
  db.prepare('INSERT INTO projects (id, uid, name) VALUES (?, ?, ?)').run(PROJ, 'p-alpha', 'Alpha');
  db.prepare('INSERT INTO deals (id, uid, project_id) VALUES (?, ?, ?)').run(DEAL, 'd-alpha', PROJ);
  db.prepare(
    `INSERT INTO ic_decisions (uid, project_id, deal_id, title, status, created_by, company_id)
     VALUES (?, ?, ?, ?, 'voting', ?, ?)`,
  ).run(DEC, PROJ, DEAL, 'Alpha — IC review', AUTHOR, CO);
  db.prepare(
    `INSERT INTO ic_meetings (uid, title, start_at, deal_id, organizer_user_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(MTG, 'Alpha IC', '2026-09-20 15:00', DEAL, AUTHOR);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
let NO_CHANGES = false;
let AFTER_PRIOR_READ: (() => void) | null = null;
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, { noChanges: NO_CHANGES, afterPriorRead: AFTER_PRIOR_READ }) });

type Who = { user: number; role: string };
const author = { user: AUTHOR, role: 'investor' };
const colleague = { user: COLLEAGUE, role: 'investor' };

async function call(
  who: Who,
  path: string,
  init: { method?: string; body?: any } = {},
  db: InstanceType<typeof DatabaseSync> = freshDb(),
): Promise<{ status: number; body: any; db: InstanceType<typeof DatabaseSync> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    'Content-Type': 'application/json',
  };
  const res = await ic.request(path, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env(db));
  const body = await res.json().catch(() => null);
  return { status: res.status, body, db };
}


const vote = (who: Who, db: InstanceType<typeof DatabaseSync>, v: string, rationale?: string) =>
  call(who, `/${DEC}/vote`, { method: 'POST', body: rationale === undefined ? { vote: v } : { vote: v, rationale } }, db);
const stored = (db: InstanceType<typeof DatabaseSync>, user: number) =>
  db.prepare(`SELECT v.vote, v.rationale FROM ic_votes v JOIN ic_decisions d ON d.id = v.ic_decision_id
               WHERE d.uid = ? AND v.user_id = ?`).get(DEC, user) as any;

test('recuse, then vote yes: refused with recusal_is_final, and the stored vote stays recused', async () => {
  const db = freshDb();
  const r1 = await vote(colleague, db, 'recused', 'angel in the company');
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const r2 = await vote(colleague, db, 'yes', 'changed my mind');
  assert.equal(r2.status, 409);
  assert.equal(r2.body.error, 'recusal_is_final');
  assert.match(r2.body.message, /recusal is final/);
  assert.deepEqual({ ...stored(db, COLLEAGUE) }, { vote: 'recused', rationale: 'angel in the company' });
  const detail = await call(author, `/${DEC}`, {}, db);
  assert.deepEqual(detail.body.tally, { yes: 0, no: 0, abstain: 0, recused: 1 }, 'the tally keeps the recusal');
});

test('no, abstain, or a fresh declaration after a recusal is refused the same way', async () => {
  for (const [v, why] of [['no', 'x'], ['abstain', undefined], ['recused', 'a different declaration'], ['recused', 'board seat at a competitor']] as const) {
    const db = freshDb();
    await vote(colleague, db, 'recused', 'board seat at a competitor');
    const r = await vote(colleague, db, v, why);
    assert.equal(r.status, 409, v);
    assert.equal(r.body.error, 'recusal_is_final', v);
    assert.deepEqual({ ...stored(db, COLLEAGUE) }, { vote: 'recused', rationale: 'board seat at a competitor' }, v);
  }
});

test('a refused vote writes no decision-journal draft', async () => {
  const db = freshDb();
  await vote(colleague, db, 'recused', 'angel in the company');
  await vote(colleague, db, 'yes', 'strong team');
  const n = (db.prepare('SELECT COUNT(*) AS n FROM decision_journal_entries WHERE owner_user_id = ?').get(COLLEAGUE) as any).n;
  assert.equal(n, 0);
});

test('a driver that reports no row count is still refused, an identical replay included (the prior vote is read first)', async () => {
  NO_CHANGES = true;
  try {
    const db = freshDb();
    const r1 = await vote(colleague, db, 'recused', 'angel in the company');
    assert.equal(r1.status, 200, 'a first recusal is not mistaken for a refusal');
    const r2 = await vote(colleague, db, 'yes', 'x');
    assert.equal(r2.status, 409);
    assert.equal(r2.body.error, 'recusal_is_final');
    assert.equal(stored(db, COLLEAGUE).vote, 'recused');
    // An identical replay leaves the stored row equal to the request, so only
    // knowing the recusal was there BEFORE the write can refuse it.
    const r3 = await vote(colleague, db, 'recused', 'angel in the company');
    assert.equal(r3.status, 409, 'an identical replay of a recusal is refused too');
    assert.equal(r3.body.error, 'recusal_is_final');
  } finally { NO_CHANGES = false; }
});

test('a recusal that lands between the read and the write still wins: the upsert never overwrites it', async () => {
  const db = freshDb();
  await vote(colleague, db, 'yes', 'team');
  AFTER_PRIOR_READ = () => {
    db.prepare(`UPDATE ic_votes SET vote = 'recused', rationale = 'raced declaration'
                 WHERE user_id = ? AND ic_decision_id = (SELECT id FROM ic_decisions WHERE uid = ?)`).run(COLLEAGUE, DEC);
  };
  try {
    const r = await vote(colleague, db, 'no', 'market');
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error, 'recusal_is_final');
    assert.deepEqual({ ...stored(db, COLLEAGUE) }, { vote: 'recused', rationale: 'raced declaration' });
  } finally { AFTER_PRIOR_READ = null; }
});

test('controls: a vote may still change, and a voter may still recuse after voting', async () => {
  const db = freshDb();
  assert.equal((await vote(colleague, db, 'yes', 'team')).status, 200);
  assert.equal((await vote(colleague, db, 'no', 'market')).status, 200);
  assert.equal(stored(db, COLLEAGUE).vote, 'no');
  const r = await vote(colleague, db, 'recused', 'learned of a conflict');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual({ ...stored(db, COLLEAGUE) }, { vote: 'recused', rationale: 'learned of a conflict' });
});
