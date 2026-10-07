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
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import journal from '../src/routes/journal.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, splitStatements, stripForeignKeys } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const INVESTOR_ID = 10;

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const MIGRATION_415 = readFileSync(
  new URL('../sql/migrations/415_decision_journal_edited_after_outcome.sql', import.meta.url),
  'utf8',
);

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
  `);

  db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'decision_journal_entries')));
  for (const st of splitStatements(MIGRATION_415)) {
    db.exec(st);
  }

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

test('a later tags-only edit keeps an existing edited_after_outcome_at stamp', async () => {
  const db = setupDb();
  const app = createApp();

  const created = await req(app, db, 'POST', '/api/journal', {
    project_uid: 'p-1',
    decision: 'invest',
    thesis: 'Initial thesis statement',
    tags: ['initial-tag'],
  });
  assert.equal(created.status, 201);
  const uid = created.body.uid;

  await req(app, db, 'POST', `/api/journal/${uid}/outcome`, {
    outcome_status: 'hit',
  });

  // First edit modifies thesis -> stamps edited_after_outcome_at
  const firstEdit = await req(app, db, 'PUT', `/api/journal/${uid}`, {
    thesis: 'Modified thesis after outcome',
  });
  assert.equal(firstEdit.status, 200);
  const initialStamp = firstEdit.body.edited_after_outcome_at;
  assert.ok(initialStamp, 'first post-outcome edit must stamp');

  // Second edit only changes tags -> existing stamp must be preserved exactly
  const secondEdit = await req(app, db, 'PUT', `/api/journal/${uid}`, {
    tags: ['updated-tag'],
  });
  assert.equal(secondEdit.status, 200);
  assert.equal(
    secondEdit.body.edited_after_outcome_at,
    initialStamp,
    'tags-only edit after prior stamp must keep original stamp',
  );

  const row = db.prepare('SELECT edited_after_outcome_at FROM decision_journal_entries WHERE uid = ?').get(uid) as any;
  assert.equal(row.edited_after_outcome_at, initialStamp);
});

// Test each of the seven core fields: changed stamps, unchanged leaves null
const coreFieldScenarios = [
  {
    field: 'thesis',
    initial: 'Original thesis with at least 10 chars',
    changed: 'Changed thesis with sufficient length',
    unchanged: 'Original thesis with at least 10 chars',
  },
  {
    field: 'key_risks',
    initial: 'Initial regulatory risk',
    changed: 'Subsequent competitor pricing risk',
    unchanged: 'Initial regulatory risk',
  },
  {
    field: 'expected_outcome',
    initial: '3x within 3 years',
    changed: '5x within 4 years',
    unchanged: '3x within 3 years',
  },
  {
    field: 'decision',
    initial: 'invest',
    changed: 'pass',
    unchanged: 'invest',
  },
  {
    field: 'conviction',
    initial: 3,
    changed: 4,
    unchanged: 3,
  },
  {
    field: 'expected_multiple',
    initial: 2.5,
    changed: 4.0,
    unchanged: 2.5,
  },
  {
    field: 'expected_timeline_months',
    initial: 18,
    changed: 36,
    unchanged: 18,
  },
];

for (const sc of coreFieldScenarios) {
  test(`core field '${sc.field}': changed stamps edited_after_outcome_at, unchanged leaves null`, async () => {
    const db = setupDb();
    const app = createApp();

    // 1. Unchanged case
    const initPayload: Record<string, any> = {
      project_uid: 'p-1',
      decision: 'invest',
      thesis: 'Base standard thesis with valid length',
    };
    initPayload[sc.field] = sc.initial;

    const resUnchanged = await req(app, db, 'POST', '/api/journal', initPayload);
    assert.equal(resUnchanged.status, 201);
    const uidUnchanged = resUnchanged.body.uid;

    await req(app, db, 'POST', `/api/journal/${uidUnchanged}/outcome`, { outcome_status: 'hit' });

    // Send unchanged value
    const putUnchanged = await req(app, db, 'PUT', `/api/journal/${uidUnchanged}`, {
      [sc.field]: sc.unchanged,
    });
    assert.equal(putUnchanged.status, 200);
    assert.equal(
      putUnchanged.body.edited_after_outcome_at,
      null,
      `Unchanged '${sc.field}' must leave edited_after_outcome_at as null`,
    );

    // 2. Changed case
    const resChanged = await req(app, db, 'POST', '/api/journal', initPayload);
    assert.equal(resChanged.status, 201);
    const uidChanged = resChanged.body.uid;

    await req(app, db, 'POST', `/api/journal/${uidChanged}/outcome`, { outcome_status: 'hit' });

    // Send changed value
    const putChanged = await req(app, db, 'PUT', `/api/journal/${uidChanged}`, {
      [sc.field]: sc.changed,
    });
    assert.equal(putChanged.status, 200);
    assert.ok(
      putChanged.body.edited_after_outcome_at,
      `Changed '${sc.field}' must stamp edited_after_outcome_at`,
    );
  });
}
