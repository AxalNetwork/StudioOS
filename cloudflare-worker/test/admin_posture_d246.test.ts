/**
 * D246 — GET /api/advisor/admin-posture, on real SQLite.
 *
 * What it guards: "recorded" is the ledger's predicate (the one /answered and
 * /progress use), never the presence of a value; a column DEFAULT is never an
 * answer; the count is the bank's; only the caller's rows are read; and a
 * store that cannot be read says so once rather than as eleven empty fields.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/admin_posture_d246.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import advisor from '../src/routes/advisor.ts';
import { ADMIN_BANK } from '../src/services/advisor/banks/admin.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 7;
const OTHER = 8;

/** user_advisor_extras sliced off migration 276, not retyped. */
function extrasDdl(): string {
  const sql = readFileSync(new URL('../sql/migrations/276_advisor_field_sources_remainder.sql', import.meta.url), 'utf8');
  const m = sql.match(/CREATE TABLE IF NOT EXISTS user_advisor_extras \([\s\S]*?\);/);
  assert.ok(m, 'migration 276 no longer creates user_advisor_extras');
  return m[0];
}

function fixture({ withExtras = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY, timezone TEXT DEFAULT 'UTC',
                                digest_frequency TEXT DEFAULT 'weekly');
    CREATE TABLE advisor_conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL, persona TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active',
      current_question_id TEXT, total_questions INTEGER NOT NULL DEFAULT 0, answered_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE advisor_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, question_id TEXT NOT NULL, raw_value TEXT, saved_to_table TEXT,
      saved_to_column TEXT, saved_to_id TEXT, saved_status TEXT NOT NULL, saved_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(conversation_id, question_id));
    ${withExtras ? extrasDdl() : ''}
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(ME, 'admin', 'Sue', 'sue@axal.example');
  u.run(OTHER, 'admin', 'Ola', 'ola@axal.example');
  return db;
}

const app = new Hono<any>();
app.route('/advisor', advisor);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 403));

async function posture(db: InstanceType<typeof DatabaseSync>, query = '') {
  const token = await new SignJWT({ user_id: ME, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/advisor/admin-posture${query}`, { headers: { Authorization: `Bearer ${token}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  assert.equal(res.status, 200);
  return res.json() as Promise<any>;
}

const byId = (body: any, id: string) => body.fields.find((f: any) => f.id === id);

function seed(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`INSERT INTO advisor_conversations (id, uid, user_id, persona) VALUES (1, 'c-me', ${ME}, 'admin');`);
  db.exec(`INSERT INTO advisor_conversations (id, uid, user_id, persona) VALUES (2, 'c-other', ${OTHER}, 'admin');`);
  const a = db.prepare('INSERT INTO advisor_answers (conversation_id, user_id, question_id, raw_value, saved_status) VALUES (?,?,?,?,?)');
  a.run(1, ME, 'admin.oversight.risk_tolerance', 'Balanced', 'saved');
  a.run(1, ME, 'admin.oversight.escalation_threshold', null, 'skipped');
  a.run(1, ME, 'admin.governance.access_review_cadence', 'Quarterly', 'noop');
  // Another admin's answers, in a conversation of their own.
  a.run(2, OTHER, 'admin.operations.intake_priority', 'Speed to decision', 'saved');
  a.run(2, OTHER, 'admin.preferences.digest_freq', 'Daily', 'saved');
  db.exec(`INSERT INTO user_advisor_extras (user_id, extras_json) VALUES
    (${ME}, '{"admin.oversight.risk_tolerance":"Balanced"}'),
    (${OTHER}, '{"admin.operations.intake_priority":"Speed to decision"}');`);
  // Column defaults for both users: never an answer.
  db.exec(`INSERT INTO user_settings (user_id) VALUES (${ME}), (${OTHER});`);
}

test('answered, skipped and unasked are three states, and the count is the ledger\'s over the bank', async () => {
  const db = fixture();
  seed(db);
  const body = await posture(db);
  assert.equal(body.available, true);
  assert.equal(body.bank_size, ADMIN_BANK.length);
  assert.equal(body.fields.length, ADMIN_BANK.length);
  assert.deepEqual(body.fields.map((f: any) => f.id), ADMIN_BANK.map((q) => q.id));

  const risk = byId(body, 'admin.oversight.risk_tolerance');
  assert.equal(risk.state, 'recorded');
  assert.equal(risk.value, 'Balanced');
  assert.equal(risk.section, 'OVERSIGHT');

  assert.equal(byId(body, 'admin.oversight.escalation_threshold').state, 'skipped', 'a skip read as recorded or as unasked');
  assert.equal(byId(body, 'admin.oversight.escalation_threshold').value, null);
  assert.equal(byId(body, 'admin.oversight.review_cadence').state, 'not_recorded');

  // A 'noop' capture is answered by the ledger's predicate even though its
  // store holds no value — so the count (2) is not the values shown (1).
  const noop = byId(body, 'admin.governance.access_review_cadence');
  assert.equal(noop.state, 'recorded');
  assert.equal(noop.value, null);
  assert.match(noop.value_reason, /no value/);
  assert.equal(body.recorded, 2);
  assert.equal(body.fields.filter((f: any) => f.value !== null).length, 1);
});

test('a column default is never an answer: the digest and the timezone read not recorded', async () => {
  const db = fixture();
  seed(db);
  // Explicit non-default values in the settings row, and still no ledger row.
  db.exec(`UPDATE user_settings SET digest_frequency = 'daily', timezone = 'Europe/Paris' WHERE user_id = ${ME};`);
  const body = await posture(db);
  for (const id of ['admin.preferences.digest_freq', 'admin.preferences.timezone']) {
    assert.equal(byId(body, id).state, 'not_recorded', `${id} read a settings column as an answer`);
    assert.equal(byId(body, id).value, null);
  }
  assert.doesNotMatch(JSON.stringify(body), /weekly|daily|Europe\/Paris|UTC/);

  // Once the ledger has it, the digest's value is read from its column.
  db.prepare('INSERT INTO advisor_answers (conversation_id, user_id, question_id, saved_status) VALUES (1, ?, ?, ?)')
    .run(ME, 'admin.preferences.digest_freq', 'saved');
  const after = await posture(db);
  assert.equal(byId(after, 'admin.preferences.digest_freq').state, 'recorded');
  assert.equal(byId(after, 'admin.preferences.digest_freq').value, 'daily');
});

test('a second admin\'s answers never appear, whatever the request names', async () => {
  const db = fixture();
  seed(db);
  for (const q of ['', `?user_id=${OTHER}`, `?user=${OTHER}&id=${OTHER}`]) {
    const body = await posture(db, q);
    assert.equal(byId(body, 'admin.operations.intake_priority').state, 'not_recorded', `leaked via "${q}"`);
    assert.doesNotMatch(JSON.stringify(body), /Speed to decision/);
    assert.equal(body.recorded, 2);
  }
});

test('a missing extras store reads available: false, not eleven empty fields', async () => {
  const db = fixture({ withExtras: false });
  const body = await posture(db);
  assert.equal(body.available, false);
  assert.equal(body.fields, undefined);
  assert.equal(body.bank_size, ADMIN_BANK.length);
  assert.match(body.reason, /not a claim that none are recorded/);
});

test('every bank question has a posture label, so a new question is not labelled with its prompt', () => {
  const src = readFileSync(new URL('../src/routes/advisor.ts', import.meta.url), 'utf8');
  for (const q of ADMIN_BANK) assert.ok(src.includes(`'${q.id}': '`), `${q.id} has no posture label`);
});
