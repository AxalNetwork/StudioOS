/**
 * D624 (#1345) — an IC re-vote or recusal never silently rewrites or deletes
 * a graded decision-journal entry.
 *
 * The vote handler keeps an auto-drafted journal entry per voter. Once that
 * entry's outcome is recorded, a re-vote that changes its thesis or decision
 * stamps `edited_after_outcome_at` (D618's rule, as the journal's PUT keeps
 * it), and a recusal re-marks it 'other' and stamps it instead of deleting it.
 * Before the outcome, both behave as they did.
 *
 * The REAL `ic` router against real SQLite: ic_recusal_final_d468.test.ts's
 * fixture, with the journal table built from the baseline plus migration 415.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ic_vote_graded_journal_d624.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';

import ic, { gradedStamp } from '../src/routes/ic.ts';

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

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
function tableDdl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  if (at < 0) throw new Error(`${name} is missing from schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
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
  // The journal table as production has it: the baseline shape plus
  // migration 415's `edited_after_outcome_at` (D618).
  db.exec(tableDdl('decision_journal_entries'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/415_journal_edited_after_outcome.sql', 'utf8'));
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

const entry = (db: InstanceType<typeof DatabaseSync>, user: number) =>
  db.prepare(`SELECT id, decision, thesis, outcome_recorded_at, edited_after_outcome_at
                FROM decision_journal_entries WHERE owner_user_id = ?`).get(user) as any;
const grade = (db: InstanceType<typeof DatabaseSync>, user: number) =>
  db.prepare(`UPDATE decision_journal_entries SET outcome_status = 'realized', outcome_recorded_at = '2026-09-30T10:00:00.000Z'
               WHERE owner_user_id = ?`).run(user);

test('a re-vote before the outcome changes the draft and stamps nothing', async () => {
  const db = freshDb();
  await vote(colleague, db, 'yes', 'Strong team and a clear wedge.');
  const r = await vote(colleague, db, 'no', 'The market is smaller than the memo says.');
  assert.equal(r.status, 200);
  const e = entry(db, COLLEAGUE);
  assert.equal(e.decision, 'pass');
  assert.equal(e.thesis, 'The market is smaller than the memo says.');
  assert.equal(e.edited_after_outcome_at, null);
});

test('a re-vote after the outcome stamps the entry, whether it moves the decision or the thesis', async () => {
  const db = freshDb();
  await vote(colleague, db, 'yes', 'Strong team and a clear wedge.');
  grade(db, COLLEAGUE);
  const r = await vote(colleague, db, 'no', 'Strong team and a clear wedge.');
  assert.equal(r.status, 200, 'the vote itself is never blocked');
  let e = entry(db, COLLEAGUE);
  assert.equal(e.decision, 'pass');
  assert.ok(e.edited_after_outcome_at, 'a changed decision after the outcome left no trace');
  assert.equal(stored(db, COLLEAGUE).vote, 'no');

  const db2 = freshDb();
  await vote(colleague, db2, 'yes', 'Strong team and a clear wedge.');
  grade(db2, COLLEAGUE);
  await vote(colleague, db2, 'yes', 'A rewritten rationale.');
  e = entry(db2, COLLEAGUE);
  assert.equal(e.thesis, 'A rewritten rationale.');
  assert.ok(e.edited_after_outcome_at, 'a changed thesis after the outcome left no trace');
});

test('an identical re-vote after the outcome does not stamp, and keeps an earlier stamp', async () => {
  const db = freshDb();
  await vote(colleague, db, 'yes', 'Strong team and a clear wedge.');
  grade(db, COLLEAGUE);
  await vote(colleague, db, 'yes', 'Strong team and a clear wedge.');
  assert.equal(entry(db, COLLEAGUE).edited_after_outcome_at, null, 'a vote that changed nothing was stamped');

  await vote(colleague, db, 'no', 'Strong team and a clear wedge.');
  const first = entry(db, COLLEAGUE).edited_after_outcome_at;
  assert.ok(first);
  db.prepare(`UPDATE decision_journal_entries SET edited_after_outcome_at = '2026-10-01T00:00:00.000Z'`).run();
  await vote(colleague, db, 'no', 'Strong team and a clear wedge.');
  assert.equal(entry(db, COLLEAGUE).edited_after_outcome_at, '2026-10-01T00:00:00.000Z', 'an unchanged vote erased the earlier stamp');
});

test('a re-vote with no usable rationale keeps the hand-edited thesis, and stamps only for the decision', async () => {
  const db = freshDb();
  await vote(colleague, db, 'yes', 'Strong team and a clear wedge.');
  db.prepare(`UPDATE decision_journal_entries SET thesis = 'My own words, written later.'`).run();
  grade(db, COLLEAGUE);
  // Under three characters is no rationale for the journal: the thesis stays.
  await vote(colleague, db, 'yes', 'ok');
  let e = entry(db, COLLEAGUE);
  assert.equal(e.thesis, 'My own words, written later.', 'a short rationale overwrote the hand-edited thesis');
  assert.equal(e.edited_after_outcome_at, null, 'nothing graded changed, yet it was stamped');
  await vote(colleague, db, 'no', 'ok');
  e = entry(db, COLLEAGUE);
  assert.equal(e.thesis, 'My own words, written later.');
  assert.equal(e.decision, 'pass');
  assert.ok(e.edited_after_outcome_at, 'the changed decision left no trace');
});

test('a recusal after the outcome keeps the entry, re-marks it other and stamps it', async () => {
  const db = freshDb();
  await vote(colleague, db, 'yes', 'ok'); // under 3 characters: the fallback thesis
  assert.match(entry(db, COLLEAGUE)?.thesis || '', /^IC vote \(yes\)/, 'the fixture did not leave a fallback draft');
  grade(db, COLLEAGUE);
  const r = await vote(colleague, db, 'recused', 'angel in the company');
  assert.equal(r.status, 200);
  const e = entry(db, COLLEAGUE);
  assert.ok(e, 'a graded entry was deleted by a recusal');
  assert.equal(e.decision, 'other');
  assert.match(e.thesis, /^IC vote \(yes\)/, 'the graded thesis was rewritten');
  assert.ok(e.edited_after_outcome_at);
});

test('a recusal before the outcome behaves as before: the fallback draft goes, a written one becomes other', async () => {
  const db = freshDb();
  await vote(colleague, db, 'yes', 'ok'); // under 3 characters: the fallback thesis
  await vote(colleague, db, 'recused', 'angel in the company');
  assert.equal(entry(db, COLLEAGUE), undefined, 'the fallback draft survived a recusal');

  const db2 = freshDb();
  await vote(colleague, db2, 'yes', 'Strong team and a clear wedge.');
  await vote(colleague, db2, 'recused', 'angel in the company');
  const e = entry(db2, COLLEAGUE);
  assert.equal(e.decision, 'other');
  assert.equal(e.edited_after_outcome_at, null, 'an ungraded entry was stamped');
});

test('gradedStamp: the rule itself', () => {
  const base = { thesis: 'T', decision: 'invest', outcome_recorded_at: null, edited_after_outcome_at: null };
  assert.equal(gradedStamp(base, { thesis: 'U', decision: 'pass' }, 'now'), null, 'no outcome, no stamp');
  const graded = { ...base, outcome_recorded_at: 'x' };
  assert.equal(gradedStamp(graded, { thesis: 'T', decision: 'invest' }, 'now'), null);
  assert.equal(gradedStamp(graded, { thesis: 'U', decision: 'invest' }, 'now'), 'now');
  assert.equal(gradedStamp(graded, { thesis: 'T', decision: 'pass' }, 'now'), 'now');
  assert.equal(gradedStamp({ ...graded, edited_after_outcome_at: 'then' }, { thesis: 'T', decision: 'invest' }, 'now'), 'then');
});
