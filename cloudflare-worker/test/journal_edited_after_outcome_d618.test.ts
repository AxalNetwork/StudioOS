/**
 * D618 (#1315) — record when a decision journal entry's core thesis/decision
 * fields are edited after its outcome has been recorded.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/journal_edited_after_outcome_d618.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import journal from '../src/routes/journal.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const INVESTOR_ID = 10;

function setupDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      uid TEXT,
      name TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'investor',
      is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      uid TEXT,
      name TEXT,
      status TEXT,
      deleted_at TEXT
    );
    CREATE TABLE watchlist_items (
      id INTEGER PRIMARY KEY,
      uid TEXT,
      owner_user_id INTEGER,
      external_name TEXT,
      status TEXT
    );
    CREATE TABLE decision_journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT NOT NULL UNIQUE,
      owner_user_id INTEGER NOT NULL,
      project_id INTEGER,
      deal_id INTEGER,
      watchlist_item_id INTEGER,
      decision TEXT NOT NULL,
      thesis TEXT NOT NULL,
      key_risks TEXT,
      expected_outcome TEXT,
      conviction INTEGER,
      expected_multiple REAL,
      expected_timeline_months INTEGER,
      tags_json TEXT NOT NULL DEFAULT '[]',
      decided_at TEXT,
      outcome_status TEXT NOT NULL DEFAULT 'pending',
      outcome_notes TEXT,
      outcome_actual_multiple REAL,
      outcome_recorded_at TEXT,
      edited_after_outcome_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.prepare(`INSERT INTO users (id, uid, name, email, role) VALUES (?, 'u-inv', 'Investor One', 'inv@example.com', 'investor')`).run(
    INVESTOR_ID,
  );
  db.prepare(`INSERT INTO projects (id, uid, name, status) VALUES (1, 'p-1', 'Project One', 'active')`).run();

  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({
    JWT_SECRET,
    ENVIRONMENT: 'development',
    APP_URL: 'https://axal.vc',
    DB: d1Over(db),
  }) as any;

function createApp() {
  const app = new Hono();
  app.route('/api/journal', journal);
  return app;
}

async function req(
  app: Hono,
  db: InstanceType<typeof DatabaseSync>,
  method: string,
  path: string,
  body?: unknown,
) {
  const jwt = await new SignJWT({ user_id: INVESTOR_ID, role: 'investor' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));

  const res = await app.request(
    path,
    {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env(db),
  );

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body: json };
}

test('an edit before the outcome leaves edited_after_outcome_at null', async () => {
  const db = setupDb();
  const app = createApp();

  const created = await req(app, db, 'POST', '/api/journal', {
    project_uid: 'p-1',
    decision: 'invest',
    thesis: 'Original thesis on market growth opportunities',
    conviction: 4,
    tags: ['ai', 'b2b'],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.edited_after_outcome_at, null);

  const uid = created.body.uid;

  const edited = await req(app, db, 'PUT', `/api/journal/${uid}`, {
    thesis: 'Updated thesis with deeper competitor analysis',
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.edited_after_outcome_at, null);

  const row = db.prepare('SELECT edited_after_outcome_at FROM decision_journal_entries WHERE uid = ?').get(uid) as any;
  assert.equal(row.edited_after_outcome_at, null);
});

test('an edit after the outcome stamps edited_after_outcome_at and reads return it', async () => {
  const db = setupDb();
  const app = createApp();

  const created = await req(app, db, 'POST', '/api/journal', {
    project_uid: 'p-1',
    decision: 'invest',
    thesis: 'Original thesis before outcome is known',
    conviction: 3,
  });
  assert.equal(created.status, 201);
  const uid = created.body.uid;

  const outcomeRes = await req(app, db, 'POST', `/api/journal/${uid}/outcome`, {
    outcome_status: 'hit',
    outcome_notes: 'Target hit within 12 months',
  });
  assert.equal(outcomeRes.status, 200);
  assert.ok(outcomeRes.body.outcome_recorded_at);
  assert.equal(outcomeRes.body.edited_after_outcome_at, null);

  // Edit core thesis after outcome
  const edited = await req(app, db, 'PUT', `/api/journal/${uid}`, {
    thesis: 'Revised post-hoc thesis changing original claim',
  });
  assert.equal(edited.status, 200);
  assert.ok(edited.body.edited_after_outcome_at, 'edited_after_outcome_at must be stamped');

  const row = db.prepare('SELECT edited_after_outcome_at FROM decision_journal_entries WHERE uid = ?').get(uid) as any;
  assert.equal(row.edited_after_outcome_at, edited.body.edited_after_outcome_at);

  // GET /:uid returns it
  const single = await req(app, db, 'GET', `/api/journal/${uid}`);
  assert.equal(single.status, 200);
  assert.equal(single.body.edited_after_outcome_at, edited.body.edited_after_outcome_at);

  // GET / list returns it
  const list = await req(app, db, 'GET', '/api/journal');
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].edited_after_outcome_at, edited.body.edited_after_outcome_at);
});

test('a tags-only change after the outcome does NOT stamp edited_after_outcome_at', async () => {
  const db = setupDb();
  const app = createApp();

  const created = await req(app, db, 'POST', '/api/journal', {
    project_uid: 'p-1',
    decision: 'invest',
    thesis: 'Solid thesis that will not change',
    tags: ['initial'],
  });
  assert.equal(created.status, 201);
  const uid = created.body.uid;

  await req(app, db, 'POST', `/api/journal/${uid}/outcome`, {
    outcome_status: 'hit',
  });

  const edited = await req(app, db, 'PUT', `/api/journal/${uid}`, {
    tags: ['initial', 'retagged'],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.edited_after_outcome_at, null, 'tags-only edit must not stamp edited_after_outcome_at');

  const row = db.prepare('SELECT edited_after_outcome_at FROM decision_journal_entries WHERE uid = ?').get(uid) as any;
  assert.equal(row.edited_after_outcome_at, null);
});

test('sending unchanged core values after the outcome does NOT stamp edited_after_outcome_at', async () => {
  const db = setupDb();
  const app = createApp();

  const initialThesis = 'Original stable thesis statement here';
  const created = await req(app, db, 'POST', '/api/journal', {
    project_uid: 'p-1',
    decision: 'invest',
    thesis: initialThesis,
    conviction: 5,
  });
  assert.equal(created.status, 201);
  const uid = created.body.uid;

  await req(app, db, 'POST', `/api/journal/${uid}/outcome`, {
    outcome_status: 'miss',
  });

  // Re-send identical thesis and conviction
  const edited = await req(app, db, 'PUT', `/api/journal/${uid}`, {
    thesis: initialThesis,
    conviction: 5,
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.edited_after_outcome_at, null, 'identical values must not stamp edited_after_outcome_at');

  const row = db.prepare('SELECT edited_after_outcome_at FROM decision_journal_entries WHERE uid = ?').get(uid) as any;
  assert.equal(row.edited_after_outcome_at, null);
});
